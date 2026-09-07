import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { createTaskMessage, taskIdFromMessage, taskView } from './domain.ts'
import { evaluateIdlePolicy } from './idle.ts'
import { LeisureQueueManager } from './manager.ts'
import type { QueueStore } from './store.ts'
import type { Config, LeisureDashboard, LeisureTimeTask, QueueState } from './types.ts'
import { registerLeisureTimeTools } from './tools.ts'

interface Owner {
  readonly agent: Agent
  disposeTools: () => void
}

function replaceTask(state: QueueState, task: LeisureTimeTask): QueueState {
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

function outcomeMessage(reason: SessionEvent<'turn/end'>['data']['reason']): string | undefined {
  return reason.kind === 'error' ? reason.error.message : undefined
}

/** Global FIFO coordinator across every live root agent owned by this Harness process. */
export class LeisureTimeCoordinator {
  private readonly owners = new Map<string, Owner>()
  private readonly disposers: Array<() => void> = []
  private timer: ReturnType<typeof setInterval> | undefined
  private drive: Promise<void> | undefined
  private requested = false
  private stopping = false
  readonly manager: LeisureQueueManager
  private readonly config: () => Config

  constructor(
    private readonly ctx: Context,
    config: Config | (() => Config),
    private readonly store: QueueStore,
  ) {
    this.config = typeof config === 'function' ? config : () => config
    this.manager = new LeisureQueueManager(store, this.config, () => this.requestDrive())
  }

  /** Attach lifecycle observers, current roots, and the periodic schedule check. */
  start(): void {
    this.disposers.push(this.ctx.on('agent/created', ({ agent }) => { void this.attach(agent) }))
    this.disposers.push(this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent) }))
    this.disposers.push(this.ctx.on('agent/status', ({ agent }) => {
      const owner = this.owners.get(agent.id)
      if (owner === undefined || owner.agent !== agent) return
      this.requestDrive()
    }))
    this.disposers.push(this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      void this.onClaimed(agent, message, turn)
    }))
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') void this.onTurnEnd(session.id, event)
    }))
    for (const agent of this.ctx.agents.roots()) void this.attach(agent)
    this.timer = setInterval(() => this.requestDrive(), this.config().pollIntervalSeconds * 1000)
    this.requestDrive()
  }

  /** Stop timers, tools, and future dispatch while leaving durable tasks untouched. */
  async dispose(): Promise<void> {
    this.stopping = true
    if (this.timer !== undefined) clearInterval(this.timer)
    for (const dispose of this.disposers.reverse()) dispose()
    for (const owner of this.owners.values()) owner.disposeTools()
    this.owners.clear()
    if (this.drive !== undefined) await this.drive.catch(() => undefined)
  }

  /** Coalesce lifecycle, tool, timer, and completion triggers. */
  requestDrive(): void {
    if (this.stopping || !this.config().enabled) return
    this.requested = true
    if (this.drive !== undefined) return
    const run = this.ctx.agents.withoutInitiator(async () => {
      while (this.requested && !this.stopping) {
        this.requested = false
        await this.driveOnce()
      }
    })
    this.drive = run
    void run.then(
      () => { this.retire(run) },
      (cause: unknown) => {
        this.ctx.logger.warn(`leisure-time-queue: coordinator failed: ${cause instanceof Error ? cause.message : String(cause)}`)
        this.retire(run)
      },
    )
  }

  private retire(run: Promise<void>): void {
    if (this.drive !== run) return
    this.drive = undefined
    if (this.requested && !this.stopping) this.requestDrive()
  }

  private async attach(agent: Agent): Promise<void> {
    if (this.stopping || this.owners.has(agent.id) || !this.ctx.agents.roots().includes(agent)) return
    const owner: Owner = { agent, disposeTools: () => {} }
    owner.disposeTools = registerLeisureTimeTools(agent, this.manager)
    this.owners.set(agent.id, owner)
    await this.reconcile(agent)
    this.requestDrive()
  }

  private detach(agent: Agent): void {
    const owner = this.owners.get(agent.id)
    if (owner === undefined || owner.agent !== agent) return
    owner.disposeTools()
    this.owners.delete(agent.id)
  }

  private async reconcile(agent: Agent): Promise<void> {
    const pendingIds = new Set<string>(
      [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
        .filter(message => message.source.kind === 'plugin' && message.source.plugin === 'leisure-time-queue')
        .map(message => message.id),
    )
    await this.store.mutate(state => {
      let changed = false
      const now = new Date().toISOString()
      const tasks = state.tasks.map(task => {
        if (task.sessionId !== agent.id) return task
        if (task.status === 'dispatched' && task.messageId !== undefined && pendingIds.has(task.messageId)) return task
        if (task.status !== 'dispatched' && task.status !== 'running') return task
        changed = true
        if (task.continuationRound >= task.maxContinuationRounds) {
          const recovered = withoutExecution(task)
          return { ...recovered, status: 'failed' as const, updatedAt: now, finishedAt: now, outcome: { kind: 'orphaned' } }
        }
        const recovered = withoutExecution(task)
        return { ...recovered, status: 'queued' as const, updatedAt: now, continuationRound: task.continuationRound + 1 }
      })
      return { state: changed ? { ...state, tasks } : state, value: undefined }
    })
  }

  private async onClaimed(agent: Agent, message: UserMessage, turn: number): Promise<void> {
    const id = taskIdFromMessage(message)
    if (id === undefined) return
    await this.store.mutate(state => {
      const task = state.tasks.find(candidate => candidate.id === id && candidate.sessionId === agent.id)
      if (task === undefined || task.status !== 'dispatched' || task.messageId !== message.id) return { state, value: undefined }
      const now = new Date().toISOString()
      return {
        state: replaceTask(state, { ...task, status: 'running', turn, startedAt: task.startedAt ?? now, updatedAt: now }),
        value: undefined,
      }
    })
  }

  private async onTurnEnd(sessionId: string, event: SessionEvent<'turn/end'>): Promise<void> {
    await this.store.mutate(state => {
      const task = state.tasks.find(candidate => candidate.sessionId === sessionId && candidate.status === 'running' && candidate.turn === event.data.turn)
      if (task === undefined) return { state, value: undefined }
      const now = new Date().toISOString()
      if (event.data.reason.kind === 'max-tokens' && task.continuationRound < task.maxContinuationRounds) {
        const continuation = withoutExecution(task)
        return {
          state: replaceTask(state, {
            ...continuation,
            status: 'queued',
            continuationRound: task.continuationRound + 1,
            updatedAt: now,
            outcome: { kind: 'max-tokens' },
          }),
          value: undefined,
        }
      }
      const status = event.data.reason.kind === 'completed'
        ? 'completed' as const
        : event.data.reason.kind === 'aborted'
          ? 'cancelled' as const
          : 'failed' as const
      const message = outcomeMessage(event.data.reason)
      return {
        state: replaceTask(state, {
          ...task,
          status,
          updatedAt: now,
          finishedAt: now,
          outcome: {
            kind: event.data.reason.kind,
            ...(message === undefined ? {} : { message }),
          },
        }),
        value: undefined,
      }
    })
    this.requestDrive()
  }

  private async driveOnce(): Promise<void> {
    if (this.stopping) return
    const state = await this.store.snapshot()
    const config = this.config()
    const inFlight = state.tasks.filter(task => task.status === 'dispatched' || task.status === 'running').length
    let capacity = config.maxConcurrentTasks - inFlight
    if (capacity <= 0) return
    const now = Date.now()
    const busySessions = new Set(state.tasks
      .filter(task => task.status === 'dispatched' || task.status === 'running')
      .map(task => task.sessionId))
    const candidates = state.tasks
      .filter(task => task.status === 'queued' && (task.notBefore === undefined || Date.parse(task.notBefore) <= now))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    for (const task of candidates) {
      if (capacity <= 0 || this.stopping) break
      const owner = this.owners.get(task.sessionId)
      if (owner === undefined || owner.agent.status !== 'idle' || busySessions.has(task.sessionId)) continue
      const policy = state.policies[task.sessionId] ?? config.defaultPolicy
      const decision = evaluateIdlePolicy(policy, now)
      if (task.forceNextRun !== true && !decision.eligible) continue
      if (await this.dispatch(owner.agent, task)) {
        capacity -= 1
        busySessions.add(task.sessionId)
      }
    }
  }

  /** Return the currently attached root Agent for one session id. */
  agentFor(sessionId: string): Agent | undefined {
    return this.owners.get(sessionId)?.agent
  }

  /** Project durable queue state and live Agent status for the Web dashboard. */
  async dashboard(): Promise<LeisureDashboard> {
    const state = await this.store.snapshot()
    const config = this.config()
    const ids = new Set<string>([
      ...this.owners.keys(),
      ...Object.keys(state.policies),
      ...state.tasks.map(task => task.sessionId),
    ])
    const sessions = [...ids].map(sessionId => {
      const agent = this.owners.get(sessionId)?.agent
      const policy = state.policies[sessionId] ?? config.defaultPolicy
      return {
        sessionId,
        live: agent !== undefined,
        ...(agent === undefined ? {} : { agentStatus: agent.status }),
        usingDefaultPolicy: state.policies[sessionId] === undefined,
        policy,
        decision: evaluateIdlePolicy(policy, Date.now()),
        tasks: state.tasks
          .filter(task => task.sessionId === sessionId)
          .map(task => taskView(task, state))
          .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
      }
    }).toSorted((left, right) => Number(right.live) - Number(left.live) || left.sessionId.localeCompare(right.sessionId))
    return {
      enabled: config.enabled,
      generatedAt: new Date().toISOString(),
      sessions,
    }
  }

  private async dispatch(agent: Agent, selected: LeisureTimeTask): Promise<boolean> {
    try {
      return await agent.runMaintenance(async signal => {
        signal.throwIfAborted()
        const message = createTaskMessage(selected)
        const admitted = await this.store.mutate(state => {
          const task = state.tasks.find(candidate => candidate.id === selected.id)
          if (task === undefined || task.status !== 'queued') return { state, value: false }
          const queued = { ...task }
          delete queued.forceNextRun
          const updated: LeisureTimeTask = {
            ...queued,
            status: 'dispatched',
            messageId: message.id,
            updatedAt: new Date().toISOString(),
          }
          return { state: replaceTask(state, updated), value: true }
        })
        if (!admitted) return false
        try {
          signal.throwIfAborted()
          agent.followup(message)
          return true
        } catch (cause: unknown) {
          await this.store.mutate(state => {
            const task = state.tasks.find(candidate => candidate.id === selected.id)
            if (task === undefined || task.status !== 'dispatched' || task.messageId !== message.id) return { state, value: undefined }
            const retry = withoutExecution(task)
            return {
              state: replaceTask(state, {
                ...retry,
                status: 'queued',
                updatedAt: new Date().toISOString(),
                outcome: { kind: 'dispatch-error', message: cause instanceof Error ? cause.message : String(cause) },
              }),
              value: undefined,
            }
          })
          return false
        }
      })
    } catch {
      return false
    }
  }
}
