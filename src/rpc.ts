import type { Context } from '@deepseek-ai/cordis'
import type { LeisureQueueManager } from './manager.ts'
import type { LeisureTimeCoordinator } from './runtime.ts'
import { LEISURE_RPC_CHANNEL } from './shared.ts'
import type { IdlePolicy, LeisureOperationError } from './types.ts'

interface RpcFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcFailure }

type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>

interface HostConnection {
  readonly rpc: {
    handle(channel: string, handler: RpcHandler): () => Promise<void>
  }
}

export { LEISURE_RPC_CHANNEL }

function connectionOf(ctx: Context): HostConnection {
  return Reflect.get(ctx, 'connection') as unknown as HostConnection
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('payload must be an object')
  }
  return value as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = input[key]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

function operationError(value: unknown): value is LeisureOperationError {
  return typeof value === 'object' && value !== null
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
}

function success<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function failure(code: string, message: string, details: object = {}): RpcResult<never> {
  return { ok: false, error: { code, message, details } }
}

async function mutate(
  coordinator: LeisureTimeCoordinator,
  operation: () => Promise<unknown>,
): Promise<RpcResult<unknown>> {
  const result = await operation()
  if (operationError(result)) return failure(`leisure/${result.code}`, result.message)
  return success(await coordinator.dashboard())
}

async function knownSession(coordinator: LeisureTimeCoordinator, sessionId: string): Promise<boolean> {
  const dashboard = await coordinator.dashboard()
  return dashboard.sessions.some(session => session.sessionId === sessionId)
}

/** Build the generic Connection handler used by the Web dashboard. */
export function createLeisureRpcHandler(coordinator: LeisureTimeCoordinator): RpcHandler {
  const manager: LeisureQueueManager = coordinator.manager
  return async (endpoint, payload, signal) => {
    signal.throwIfAborted()
    try {
      if (endpoint === 'dashboard') return success(await coordinator.dashboard())
      const input = record(payload)
      const sessionId = stringField(input, 'sessionId') as string
      if (endpoint === 'task.create') {
        return await mutate(coordinator, () => manager.create(sessionId, {
          title: stringField(input, 'title') as string,
          prompt: stringField(input, 'prompt') as string,
          ...(stringField(input, 'notBefore', true) === undefined
            ? {}
            : { notBefore: stringField(input, 'notBefore', true) as string }),
        }))
      }
      if (!(await knownSession(coordinator, sessionId))) {
        return failure('leisure/session-not-found', 'The selected session is not known to LeisureTimeQueue.', { sessionId })
      }
      signal.throwIfAborted()
      if (endpoint === 'schedule.save') {
        return await mutate(coordinator, () => manager.configureSchedule(sessionId, {
          timeZone: input['timeZone'],
          windows: input['windows'],
        }))
      }
      if (endpoint === 'schedule.reset') {
        return await mutate(coordinator, () => manager.configureSchedule(sessionId, { reset: true }))
      }
      if (endpoint === 'task.update') {
        const title = stringField(input, 'title', true)
        const prompt = stringField(input, 'prompt', true)
        const notBefore = stringField(input, 'notBefore', true)
        return await mutate(coordinator, () => manager.update(sessionId, {
          id: stringField(input, 'id') as string,
          ...(title === undefined ? {} : { title }),
          ...(prompt === undefined ? {} : { prompt }),
          ...(notBefore === undefined ? {} : { notBefore }),
        }))
      }
      const id = stringField(input, 'id') as string
      const agent = coordinator.agentFor(sessionId)
      if (endpoint === 'task.pause') return await mutate(coordinator, () => manager.pause(sessionId, id, agent))
      if (endpoint === 'task.resume') return await mutate(coordinator, () => manager.resume(sessionId, id))
      if (endpoint === 'task.cancel') return await mutate(coordinator, () => manager.cancel(sessionId, id, agent))
      if (endpoint === 'task.retry') return await mutate(coordinator, () => manager.retry(sessionId, id))
      if (endpoint === 'task.delete') return await mutate(coordinator, () => manager.delete(sessionId, id))
      if (endpoint === 'task.run-now') return await mutate(coordinator, () => manager.runNow(sessionId, id))
      return failure('leisure/not-found', `Unknown LeisureTimeQueue endpoint: ${endpoint}`)
    } catch (cause: unknown) {
      return failure('leisure/bad-request', cause instanceof Error ? cause.message : String(cause))
    }
  }
}

/** Register the management channel through Harness browser trust and authentication. */
export function installLeisureRpc(ctx: Context, coordinator: LeisureTimeCoordinator): void {
  connectionOf(ctx).rpc.handle(LEISURE_RPC_CHANNEL, createLeisureRpcHandler(coordinator))
}

/** Normalize a browser-provided schedule through the Host validator. */
export function policyPayload(value: IdlePolicy): { readonly timeZone: string; readonly windows: IdlePolicy['windows'] } {
  return { timeZone: value.timeZone, windows: value.windows }
}
