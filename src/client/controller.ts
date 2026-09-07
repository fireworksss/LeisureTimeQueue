import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote, ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { LEISURE_RPC_CHANNEL } from '../shared.ts'
import type { LeisureSettings } from '../settings.ts'
import type { IdlePolicy, LeisureDashboard } from '../types.ts'

/** Browser dashboard lifecycle and current Host/settings projections. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

export interface LeisureClientState {
  status: 'loading' | 'ready' | 'error'
  busy: boolean
  error?: string
  dashboard?: LeisureDashboard
  sessions: readonly LeisureSessionOption[]
  modelCatalog?: ModelCatalog
  modelError?: string
  settings: SettingsScopeSnapshot<LeisureSettings>
}

/** One existing Harness session offered as a task target. */
export interface LeisureSessionOption {
  readonly sessionId: string
  readonly title: string
  readonly cwd?: string
  readonly running: boolean
}

/** New Harness session fields applied before its first queued task is stored. */
export interface CreateSessionTaskInput {
  readonly cwd?: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly permissionPreset: string
  readonly title: string
  readonly prompt: string
  readonly notBefore?: string
}

/** Business face injected into the settings card. */
export interface LeisureCardFace {
  readonly hooks: { readonly leisureQueue: SnapshotStore<LeisureClientState> }
  readonly refresh: () => void
  readonly saveGlobal: (settings: LeisureSettings) => Promise<void>
  readonly resetGlobal: () => Promise<void>
  readonly saveSession: (sessionId: string, policy: IdlePolicy) => Promise<void>
  readonly resetSession: (sessionId: string) => Promise<void>
  readonly createTask: (sessionId: string, input: { title: string; prompt: string; notBefore?: string }) => Promise<void>
  readonly pickDirectory: () => Promise<string | null>
  readonly createSessionTask: (input: CreateSessionTaskInput) => Promise<void>
  readonly updateTask: (sessionId: string, input: { id: string; title: string; prompt: string; notBefore: string }) => Promise<void>
  readonly taskAction: (sessionId: string, action: string, id: string) => Promise<void>
}

interface RpcSuccess {
  readonly ok: true
  readonly value: unknown
}

interface RpcFailure {
  readonly ok: false
  readonly error: { readonly message: string }
}

function dashboard(value: unknown): LeisureDashboard {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { sessions?: unknown }).sessions)) {
    throw new TypeError('LeisureTimeQueue returned an invalid dashboard response.')
  }
  return value as LeisureDashboard
}

/** Own the polling and authenticated mutation flow for the settings card. */
export class LeisureClientController {
  readonly store: SnapshotStore<LeisureClientState>
  private readonly sessions: ISessions
  private readonly remote: ClientRemote
  private readonly uiWorkspace: UiWorkspace
  private readonly stopScope: () => void
  private readonly stopSessions: () => void
  private readonly stopReset: () => void
  private readonly timer: ReturnType<typeof setInterval>
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly scope: SettingsScope<LeisureSettings>,
  ) {
    this.sessions = Reflect.get(ctx, 'sessions') as unknown as ISessions
    this.remote = Reflect.get(ctx, 'remote') as ClientRemote
    this.uiWorkspace = Reflect.get(ctx, 'uiWorkspace') as UiWorkspace
    this.store = createSnapshotStore({
      status: 'loading',
      busy: false,
      sessions: this.sessionOptions(),
      settings: scope.getSnapshot(),
    })
    this.stopScope = scope.subscribe(() => {
      this.store.update(state => { state.settings = scope.getSnapshot() })
    })
    this.stopSessions = this.sessions.list.subscribe(() => {
      this.store.update(state => { state.sessions = this.sessionOptions() })
    })
    this.stopReset = ctx.on('connection/reset', () => { void this.refresh() })
    this.timer = setInterval(() => { void this.refresh(false) }, 5_000)
    void this.sessions.refresh().catch(() => undefined)
    void this.refresh()
  }

  /** Refresh Host state, optionally publishing a visible loading phase. */
  async refresh(showLoading = true): Promise<void> {
    if (this.disposed) return
    if (showLoading && this.store.getSnapshot().dashboard === undefined) {
      this.store.update(state => { state.status = 'loading'; delete state.error })
    }
    try {
      if (showLoading || this.store.getSnapshot().modelCatalog === undefined) {
        void this.sessions.refresh().catch(() => undefined)
        void this.loadModelCatalog()
      }
      const result = await this.call('dashboard', {})
      if (this.disposed) return
      this.store.update(state => {
        state.status = 'ready'
        state.dashboard = dashboard(result)
        delete state.error
      })
    } catch (cause: unknown) {
      if (this.disposed) return
      this.store.update(state => {
        state.status = 'error'
        state.error = cause instanceof Error ? cause.message : String(cause)
      })
    }
  }

  /** Persist global live settings through the Harness settings namespace. */
  saveGlobal(settings: LeisureSettings): Promise<void> {
    return this.run(async () => {
      await this.scope.mutate([
        { op: 'set', path: ['enabled'], value: settings.enabled },
        { op: 'set', path: ['dailyCreateLimit'], value: settings.dailyCreateLimit },
        { op: 'set', path: ['maxConcurrentTasks'], value: settings.maxConcurrentTasks },
        { op: 'set', path: ['maxContinuationRounds'], value: settings.maxContinuationRounds },
        {
          op: 'set',
          path: ['defaultPolicy'],
          value: {
            timeZone: settings.defaultPolicy.timeZone,
            windows: settings.defaultPolicy.windows.map(window => ({
              days: [...window.days],
              start: window.start,
              end: window.end,
            })),
          },
        },
      ])
      await this.refresh(false)
    })
  }

  /** Clear all user-layer global overrides. */
  resetGlobal(): Promise<void> {
    return this.run(async () => {
      await this.scope.mutate([
        { op: 'unset', path: ['enabled'] },
        { op: 'unset', path: ['dailyCreateLimit'] },
        { op: 'unset', path: ['maxConcurrentTasks'] },
        { op: 'unset', path: ['maxContinuationRounds'] },
        { op: 'unset', path: ['defaultPolicy'] },
      ])
      await this.refresh(false)
    })
  }

  /** Save a complete session schedule override. */
  saveSession(sessionId: string, policy: IdlePolicy): Promise<void> {
    return this.mutate('schedule.save', { sessionId, ...policy })
  }

  /** Remove a session schedule override. */
  resetSession(sessionId: string): Promise<void> {
    return this.mutate('schedule.reset', { sessionId })
  }

  /** Create one task from the visual form. */
  createTask(sessionId: string, input: { title: string; prompt: string; notBefore?: string }): Promise<void> {
    return this.mutate('task.create', { sessionId, ...input })
  }

  /** Open Harness's configured workspace directory picker. */
  async pickDirectory(): Promise<string | null> {
    if (this.disposed || this.store.getSnapshot().busy) return null
    this.store.update(state => { state.busy = true; delete state.error })
    try {
      return await this.uiWorkspace.pickDirectory()
    } catch (cause: unknown) {
      if (!this.disposed) {
        this.store.update(state => {
          state.status = state.dashboard === undefined ? 'error' : 'ready'
          state.error = cause instanceof Error ? cause.message : String(cause)
        })
      }
      return null
    } finally {
      if (!this.disposed) this.store.update(state => { state.busy = false })
    }
  }

  /** Create a native Harness session, configure it, then queue its first task. */
  createSessionTask(input: CreateSessionTaskInput): Promise<void> {
    return this.run(async () => {
      const cwd = input.cwd?.trim()
      const reasoningEffort = this.supportedReasoningEffort(input)
      const sessionId = await this.sessions.create(cwd === undefined || cwd === '' ? {} : { cwd })
      this.sessions.open(sessionId)
      const model = await this.remote.session.selectModel({
        sessionId,
        provider: input.provider,
        model: input.model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
      if (!model.ok) throw new Error(`${model.error.code}: ${model.error.message}`)
      const binding = this.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`The new Harness session ${String(sessionId)} is not addressable.`)
      const permission = await binding.session.command(`/permission ${input.permissionPreset}`)
      if (!permission.ok) throw new Error(`${permission.error.code}: ${permission.error.message}`)
      if (!permission.value.matched) throw new Error('The Harness permission command is not available.')
      const value = await this.call('task.create', {
        sessionId,
        title: input.title,
        prompt: input.prompt,
        ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
      })
      if (this.disposed) return
      this.store.update(state => {
        state.status = 'ready'
        state.dashboard = dashboard(value)
        state.sessions = this.sessionOptions()
      })
    })
  }

  /** Save editable fields for a queued or paused task. */
  updateTask(sessionId: string, input: { id: string; title: string; prompt: string; notBefore: string }): Promise<void> {
    return this.mutate('task.update', { sessionId, ...input })
  }

  /** Apply one named task transition. */
  taskAction(sessionId: string, action: string, id: string): Promise<void> {
    return this.mutate(`task.${action}`, { sessionId, id })
  }

  /** Release settings subscriptions, polling, and queued settings writes. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    this.stopReset()
    this.stopSessions()
    this.stopScope()
  }

  /** Build the renderer-injected card face. */
  inject(): LeisureCardFace {
    return {
      hooks: { leisureQueue: this.store },
      refresh: () => { void this.refresh() },
      saveGlobal: settings => this.saveGlobal(settings),
      resetGlobal: () => this.resetGlobal(),
      saveSession: (sessionId, policy) => this.saveSession(sessionId, policy),
      resetSession: sessionId => this.resetSession(sessionId),
      createTask: (sessionId, input) => this.createTask(sessionId, input),
      pickDirectory: () => this.pickDirectory(),
      createSessionTask: input => this.createSessionTask(input),
      updateTask: (sessionId, input) => this.updateTask(sessionId, input),
      taskAction: (sessionId, action, id) => this.taskAction(sessionId, action, id),
    }
  }

  private mutate(endpoint: string, payload: object): Promise<void> {
    return this.run(async () => {
      const value = await this.call(endpoint, payload)
      if (this.disposed) return
      this.store.update(state => {
        state.status = 'ready'
        state.dashboard = dashboard(value)
      })
    })
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.disposed || this.store.getSnapshot().busy) return
    this.store.update(state => { state.busy = true; delete state.error })
    try {
      await operation()
    } catch (cause: unknown) {
      if (!this.disposed) {
        this.store.update(state => {
          state.status = state.dashboard === undefined ? 'error' : 'ready'
          state.error = cause instanceof Error ? cause.message : String(cause)
        })
      }
    } finally {
      if (!this.disposed) this.store.update(state => { state.busy = false })
    }
  }

  private async call(endpoint: string, payload: object): Promise<unknown> {
    const result = await this.ctx.connection.rpc.call(LEISURE_RPC_CHANNEL, endpoint, payload) as RpcSuccess | RpcFailure
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  private sessionOptions(): LeisureSessionOption[] {
    const snapshot = this.sessions.list.getSnapshot()
    return snapshot.ids.flatMap((sessionId) => {
      const summary = snapshot.byId[sessionId]
      if (summary === undefined) return []
      return [{
        sessionId: String(summary.id),
        title: summary.displayTitle,
        ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
        running: summary.running,
      }]
    })
  }

  private supportedReasoningEffort(input: CreateSessionTaskInput): string | undefined {
    if (input.reasoningEffort === undefined) return undefined
    const groups = this.store.getSnapshot().modelCatalog?.groups ?? []
    const model = groups.find(group => group.id === input.provider)
      ?.models.find(candidate => candidate.id === input.model)
    return model?.reasoning?.efforts.some(effort => effort.id === input.reasoningEffort) === true
      ? input.reasoningEffort
      : undefined
  }

  private async loadModelCatalog(): Promise<void> {
    try {
      const response = await this.remote.session.modelCatalog()
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      if (this.disposed) return
      this.store.update(state => {
        state.modelCatalog = response.value
        delete state.modelError
      })
    } catch (cause: unknown) {
      if (this.disposed) return
      this.store.update(state => {
        state.modelError = cause instanceof Error ? cause.message : String(cause)
      })
    }
  }
}
