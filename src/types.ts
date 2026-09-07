import type { SessionId } from '@deepseek-ai/dsh-session'

/** Weekday identifiers used by configured execution windows. */
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

/** One local wall-clock window; days identify the day on which the window starts. */
export interface IdleWindow {
  readonly days: readonly Weekday[]
  readonly start: string
  readonly end: string
}

/** Per-session schedule deciding when queued work may start. */
export interface IdlePolicy {
  readonly timeZone: string
  readonly windows: readonly IdleWindow[]
}

/** Validated Cordis plugin configuration. */
export interface Config {
  readonly enabled: boolean
  readonly storageFile: string
  readonly pollIntervalSeconds: number
  readonly dailyCreateLimit: number
  readonly maxConcurrentTasks: number
  readonly maxContinuationRounds: number
  readonly defaultPolicy: IdlePolicy
}

/** Durable lifecycle states exposed by task management tools. */
export type TaskStatus =
  | 'queued'
  | 'paused'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Durable one-shot LeisureTimeQueue task. */
export interface LeisureTimeTask {
  readonly id: string
  readonly sessionId: SessionId
  readonly title: string
  readonly prompt: string
  readonly status: TaskStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly notBefore?: string
  readonly forceNextRun?: true
  readonly messageId?: string
  readonly turn?: number
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly continuationRound: number
  readonly maxContinuationRounds: number
  readonly outcome?: {
    readonly kind: string
    readonly message?: string
  }
}

/** Task data displayed by tools and the Web dashboard. */
export interface LeisureTimeTaskView extends LeisureTimeTask {
  readonly globalQueuePosition?: number
}

/** Stable operation error returned to model tools and the Web controller. */
export interface LeisureOperationError {
  readonly code: string
  readonly message: string
}

/** Versioned JSON file owned by the plugin. */
export interface QueueState {
  readonly version: 1
  readonly nextId: number
  readonly tasks: readonly LeisureTimeTask[]
  readonly policies: Readonly<Record<string, IdlePolicy>>
}

/** Result of evaluating the configured execution schedule. */
export interface IdleDecision {
  readonly eligible: boolean
  readonly localTime: string
  readonly insideWindow: boolean
  readonly reasons: readonly string[]
}

/** One session row in the Web management dashboard. */
export interface LeisureDashboardSession {
  readonly sessionId: string
  readonly live: boolean
  readonly agentStatus?: 'idle' | 'running'
  readonly usingDefaultPolicy: boolean
  readonly policy: IdlePolicy
  readonly decision: IdleDecision
  readonly tasks: readonly LeisureTimeTaskView[]
}

/** Browser-safe snapshot returned by the authenticated management channel. */
export interface LeisureDashboard {
  readonly enabled: boolean
  readonly generatedAt: string
  readonly sessions: readonly LeisureDashboardSession[]
}
