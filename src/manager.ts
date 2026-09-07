import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { normalizeIdlePolicy } from './config.ts'
import { optionalFutureInstant, taskView, terminal } from './domain.ts'
import { evaluateIdlePolicy } from './idle.ts'
import type { QueueStore } from './store.ts'
import type {
  Config,
  IdlePolicy,
  LeisureOperationError,
  LeisureTimeTask,
  LeisureTimeTaskView,
  QueueState,
  TaskStatus,
} from './types.ts'

type ConfigSource = () => Config
type RequestDrive = () => void

/** Input accepted when a human or Agent creates a queued task. */
export interface CreateTaskInput {
  readonly title: string
  readonly prompt: string
  readonly notBefore?: string
}

/** Mutable fields accepted for a queued or paused task. */
export interface UpdateTaskInput {
  readonly id: string
  readonly title?: string
  readonly prompt?: string
  readonly notBefore?: string
}

function error(code: string, message: string): LeisureOperationError {
  return { code, message }
}

function localTasks(state: QueueState, sessionId: string): LeisureTimeTask[] {
  return state.tasks.filter(task => task.sessionId === sessionId)
}

function taskById(state: QueueState, sessionId: string, id: string): LeisureTimeTask | undefined {
  return state.tasks.find(task => task.id === id && task.sessionId === sessionId)
}

function replacement(state: QueueState, task: LeisureTimeTask): QueueState {
  return { ...state, tasks: state.tasks.map(candidate => candidate.id === task.id ? task : candidate) }
}

function withoutExecution(task: LeisureTimeTask): LeisureTimeTask {
  const copy = { ...task }
  delete copy.forceNextRun
  delete copy.messageId
  delete copy.turn
  delete copy.finishedAt
  delete copy.outcome
  return copy
}

/** Shared queue operations used by model tools and the authenticated Web dashboard. */
export class LeisureQueueManager {
  constructor(
    private readonly store: QueueStore,
    private readonly config: ConfigSource,
    private readonly requestDrive: RequestDrive,
  ) {}

  /** Create one durable task for a session. */
  async create(sessionId: string, input: CreateTaskInput): Promise<LeisureTimeTaskView | LeisureOperationError> {
    const title = input.title.trim()
    const prompt = input.prompt.trim()
    if (title.length === 0 || prompt.length === 0) return error('invalid_task', 'title and prompt must be non-empty.')
    let notBefore: string | undefined
    try {
      notBefore = optionalFutureInstant(input.notBefore)
    } catch (cause: unknown) {
      return error('invalid_not_before', cause instanceof Error ? cause.message : String(cause))
    }
    const config = this.config()
    const created = await this.store.mutate<LeisureTimeTaskView | LeisureOperationError>(state => {
      const cutoff = Date.now() - 86_400_000
      const recent = localTasks(state, sessionId).filter(task => Date.parse(task.createdAt) >= cutoff).length
      if (recent >= config.dailyCreateLimit) {
        return { state, value: error('daily_limit', `The per-session rolling 24-hour limit is ${config.dailyCreateLimit}.`) }
      }
      const now = new Date().toISOString()
      const task: LeisureTimeTask = {
        id: `leisure-${state.nextId}`,
        sessionId: sessionId as SessionId,
        title,
        prompt,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        continuationRound: 0,
        maxContinuationRounds: config.maxContinuationRounds,
        ...(notBefore === undefined ? {} : { notBefore }),
      }
      const next: QueueState = { ...state, nextId: state.nextId + 1, tasks: [...state.tasks, task] }
      return { state: next, value: taskView(task, next) }
    })
    this.requestDrive()
    return created
  }

  /** List task views owned by one session. */
  async list(sessionId: string, status?: TaskStatus): Promise<LeisureTimeTaskView[]> {
    const state = await this.store.snapshot()
    return localTasks(state, sessionId)
      .filter(task => status === undefined || task.status === status)
      .map(task => taskView(task, state))
  }

  /** Edit a queued or paused task. */
  async update(sessionId: string, input: UpdateTaskInput): Promise<LeisureTimeTaskView | LeisureOperationError> {
    let parsedNotBefore: string | undefined
    if (input.notBefore !== undefined && input.notBefore !== '') {
      try {
        parsedNotBefore = optionalFutureInstant(input.notBefore)
      } catch (cause: unknown) {
        return error('invalid_not_before', cause instanceof Error ? cause.message : String(cause))
      }
    }
    const value = await this.store.mutate<LeisureTimeTaskView | LeisureOperationError>(state => {
      const task = taskById(state, sessionId, input.id)
      if (task === undefined) return { state, value: error('task_not_found', 'No task with that id belongs to this session.') }
      if (task.status !== 'queued' && task.status !== 'paused') {
        return { state, value: error('invalid_state', 'Only queued or paused tasks can be edited.') }
      }
      const title = input.title === undefined ? task.title : input.title.trim()
      const prompt = input.prompt === undefined ? task.prompt : input.prompt.trim()
      if (title.length === 0 || prompt.length === 0) {
        return { state, value: error('invalid_task', 'title and prompt must be non-empty.') }
      }
      const base = input.notBefore === ''
        ? (() => {
            const copy = { ...task }
            delete copy.notBefore
            return copy
          })()
        : task
      const updated: LeisureTimeTask = {
        ...base,
        title,
        prompt,
        updatedAt: new Date().toISOString(),
        ...(parsedNotBefore === undefined ? {} : { notBefore: parsedNotBefore }),
      }
      const next = replacement(state, updated)
      return { state: next, value: taskView(updated, next) }
    })
    this.requestDrive()
    return value
  }

  /** Pause queued work or retract a dispatched message that has not started. */
  pause(sessionId: string, id: string, agent?: Agent): Promise<LeisureTimeTaskView | LeisureOperationError> {
    return this.transition(sessionId, id, ['queued', 'dispatched'], 'paused', agent)
  }

  /** Return paused work to the queue. */
  resume(sessionId: string, id: string): Promise<LeisureTimeTaskView | LeisureOperationError> {
    return this.transition(sessionId, id, ['paused'], 'queued')
  }

  /** Cancel queued, paused, or dispatched work. */
  cancel(sessionId: string, id: string, agent?: Agent): Promise<LeisureTimeTaskView | LeisureOperationError> {
    return this.transition(sessionId, id, ['queued', 'paused', 'dispatched'], 'cancelled', agent)
  }

  /** Retry failed or cancelled work. */
  retry(sessionId: string, id: string): Promise<LeisureTimeTaskView | LeisureOperationError> {
    return this.transition(sessionId, id, ['failed', 'cancelled'], 'queued')
  }

  /** Delete one terminal task record. */
  delete(sessionId: string, id: string): Promise<{ readonly id: string; readonly deleted: true } | LeisureOperationError> {
    return this.store.mutate<{ readonly id: string; readonly deleted: true } | LeisureOperationError>(state => {
      const task = taskById(state, sessionId, id)
      if (task === undefined) return { state, value: error('task_not_found', 'No task with that id belongs to this session.') }
      if (!terminal(task.status)) return { state, value: error('invalid_state', 'Only terminal tasks can be deleted.') }
      return {
        state: { ...state, tasks: state.tasks.filter(candidate => candidate.id !== id) },
        value: { id, deleted: true as const },
      }
    })
  }

  /** Bypass the schedule once and put the task back into admission. */
  async runNow(sessionId: string, id: string): Promise<LeisureTimeTaskView | LeisureOperationError> {
    const value = await this.store.mutate<LeisureTimeTaskView | LeisureOperationError>(state => {
      const task = taskById(state, sessionId, id)
      if (task === undefined) return { state, value: error('task_not_found', 'No task with that id belongs to this session.') }
      if (task.status !== 'queued' && task.status !== 'paused') {
        return { state, value: error('invalid_state', `Task is ${task.status}.`) }
      }
      const updated: LeisureTimeTask = {
        ...task,
        status: 'queued',
        forceNextRun: true,
        updatedAt: new Date().toISOString(),
      }
      const next = replacement(state, updated)
      return { state: next, value: taskView(updated, next) }
    })
    this.requestDrive()
    return value
  }

  /** Store or reset a complete per-session execution policy. */
  async configureSchedule(
    sessionId: string,
    input: { readonly reset?: boolean; readonly timeZone?: unknown; readonly windows?: unknown },
  ): Promise<{ readonly reset: boolean; readonly policy: IdlePolicy } | LeisureOperationError> {
    if (input.reset === true) {
      await this.store.setPolicy(sessionId, undefined)
      this.requestDrive()
      return { reset: true, policy: this.config().defaultPolicy }
    }
    const state = await this.store.snapshot()
    const base = state.policies[sessionId] ?? this.config().defaultPolicy
    let policy: IdlePolicy
    try {
      policy = normalizeIdlePolicy({ ...base, ...input }, base)
    } catch (cause: unknown) {
      return error('invalid_policy', cause instanceof Error ? cause.message : String(cause))
    }
    await this.store.setPolicy(sessionId, policy)
    this.requestDrive()
    return { reset: false, policy }
  }

  /** Explain one session's current schedule decision. */
  async scheduleStatus(sessionId: string, agentStatus?: 'idle' | 'running'): Promise<Record<string, unknown>> {
    const state = await this.store.snapshot()
    const config = this.config()
    const policy = state.policies[sessionId] ?? config.defaultPolicy
    return {
      enabled: config.enabled,
      ...(agentStatus === undefined ? {} : { agentStatus }),
      policy,
      decision: evaluateIdlePolicy(policy, Date.now()),
    }
  }

  /** Read the complete durable queue for dashboard projection. */
  snapshot(): Promise<QueueState> {
    return this.store.snapshot()
  }

  private async transition(
    sessionId: string,
    id: string,
    allowed: readonly TaskStatus[],
    nextStatus: TaskStatus,
    agent?: Agent,
  ): Promise<LeisureTimeTaskView | LeisureOperationError> {
    const value = await this.store.mutate<LeisureTimeTaskView | LeisureOperationError>(state => {
      const task = taskById(state, sessionId, id)
      if (task === undefined) return { state, value: error('task_not_found', 'No task with that id belongs to this session.') }
      if (!allowed.includes(task.status)) return { state, value: error('invalid_state', `Task is ${task.status}.`) }
      if (task.status === 'dispatched' && task.messageId !== undefined) agent?.inbox.remove(task.messageId as MessageId)
      const now = new Date().toISOString()
      const base = nextStatus === 'queued' ? withoutExecution(task) : task
      const updated: LeisureTimeTask = {
        ...base,
        status: nextStatus,
        updatedAt: now,
        ...(nextStatus === 'cancelled' ? { finishedAt: now, outcome: { kind: 'cancelled' } } : {}),
      }
      const next = replacement(state, updated)
      return { state: next, value: taskView(updated, next) }
    })
    this.requestDrive()
    return value
  }
}
