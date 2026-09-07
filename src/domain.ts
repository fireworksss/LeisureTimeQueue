import { randomUUID } from 'node:crypto'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { LeisureTimeTask, LeisureTimeTaskView, QueueState, TaskStatus } from './types.ts'

const FRAME_ID = /^leisure_time_task_id_json: (.+)$/m

/** Return a canonical UTC instant or reject malformed input. */
export function optionalFutureInstant(value: string | undefined, now = Date.now()): string | undefined {
  if (value === undefined) return undefined
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch) || epoch <= now) throw new Error('not_before must be a future RFC 3339 date-time')
  return new Date(epoch).toISOString()
}

/** Build the durable task view returned by tools. */
export function taskView(task: LeisureTimeTask, state: QueueState): LeisureTimeTaskView {
  const queued = state.tasks
    .filter(candidate => candidate.status === 'queued')
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  const index = queued.findIndex(candidate => candidate.id === task.id)
  return {
    ...task,
    ...(index < 0 ? {} : { globalQueuePosition: index + 1 }),
  }
}

/** Create the plugin-authored user message that starts or continues one task. */
export function createTaskMessage(task: LeisureTimeTask): UserMessage {
  const continuation = task.continuationRound === 0
    ? 'Execute task_prompt_json as the user-authored queued coding task.'
    : 'Continue the same queued coding task from the existing conversation and workspace state.'
  const text = [
    '[LEISURE TIME QUEUE TASK]',
    continuation,
    'Work autonomously until the task is complete or a real user decision is required.',
    `leisure_time_task_id_json: ${JSON.stringify(task.id)}`,
    `continuation_round: ${task.continuationRound}`,
    `task_title_json: ${JSON.stringify(task.title)}`,
    `task_prompt_json: ${JSON.stringify(task.prompt)}`,
  ].join('\n')
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: Object.freeze({ kind: 'plugin', plugin: 'leisure-time-queue' }),
  }) as UserMessage
}

/** Recover a task id from a plugin dispatch message, including after process restart. */
export function taskIdFromMessage(message: UserMessage): string | undefined {
  if (message.source.kind !== 'plugin' || message.source.plugin !== 'leisure-time-queue') return undefined
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
  const raw = FRAME_ID.exec(text)?.[1]
  if (raw === undefined) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** Whether a state is terminal and safe to delete or retry. */
export function terminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
