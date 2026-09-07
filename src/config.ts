import type { Config as PluginConfig, IdlePolicy, IdleWindow, Weekday } from './types.ts'

const WEEKDAYS = new Set<Weekday>(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/

/** Safe default: no automatic execution until the user configures a window. */
export const DEFAULT_IDLE_POLICY: IdlePolicy = Object.freeze({
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  windows: Object.freeze([]),
})

/** Default plugin configuration. */
export const DEFAULT_CONFIG: PluginConfig = Object.freeze({
  enabled: true,
  storageFile: '.dsh/leisure-time-queue.json',
  pollIntervalSeconds: 15,
  dailyCreateLimit: 3,
  maxConcurrentTasks: 1,
  maxContinuationRounds: 3,
  defaultPolicy: DEFAULT_IDLE_POLICY,
})

/** Configuration validation failure with a field path. */
export class ConfigError extends TypeError {
  constructor(
    message: string,
    readonly path: readonly (string | number)[] = [],
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

function record(value: unknown, path: readonly (string | number)[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError('expected an object', path)
  }
  return value as Record<string, unknown>
}

function finiteInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  path: readonly (string | number)[],
): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || (resolved as number) < minimum || (resolved as number) > maximum) {
    throw new ConfigError(`expected an integer from ${minimum} through ${maximum}`, path)
  }
  return resolved as number
}

function timeZone(value: unknown, fallback: string, path: readonly (string | number)[]): string {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'string' || resolved.length === 0 || resolved.trim() !== resolved) {
    throw new ConfigError('expected a non-empty IANA time zone', path)
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: resolved }).resolvedOptions().timeZone
  } catch {
    throw new ConfigError('expected a valid IANA time zone', path)
  }
}

function window(value: unknown, index: number): IdleWindow {
  const input = record(value, ['windows', index])
  for (const key of Object.keys(input)) {
    if (key !== 'days' && key !== 'start' && key !== 'end') {
      throw new ConfigError(`unknown property ${key}`, ['windows', index, key])
    }
  }
  if (!Array.isArray(input['days']) || input['days'].length === 0) {
    throw new ConfigError('expected at least one weekday', ['windows', index, 'days'])
  }
  const days = input['days'].map((day, dayIndex) => {
    if (typeof day !== 'string' || !WEEKDAYS.has(day as Weekday)) {
      throw new ConfigError('expected sun, mon, tue, wed, thu, fri, or sat', ['windows', index, 'days', dayIndex])
    }
    return day as Weekday
  })
  const start = input['start']
  const end = input['end']
  if (typeof start !== 'string' || !TIME.test(start)) {
    throw new ConfigError('expected HH:mm from 00:00 through 24:00', ['windows', index, 'start'])
  }
  if (typeof end !== 'string' || !TIME.test(end)) {
    throw new ConfigError('expected HH:mm from 00:00 through 24:00', ['windows', index, 'end'])
  }
  if (start === '24:00') throw new ConfigError('a window cannot start at 24:00', ['windows', index, 'start'])
  if (start === end) throw new ConfigError('start and end must differ', ['windows', index])
  return Object.freeze({ days: Object.freeze([...new Set(days)]), start, end })
}

/** Validate and fill a complete user-defined execution schedule. */
export function normalizeIdlePolicy(value: unknown, fallback: IdlePolicy = DEFAULT_IDLE_POLICY): IdlePolicy {
  const input = value === undefined ? {} : record(value, [])
  for (const key of Object.keys(input)) {
    if (key !== 'timeZone' && key !== 'windows') {
      throw new ConfigError(`unknown property ${key}`, [key])
    }
  }
  const windowsValue = input['windows'] ?? fallback.windows
  if (!Array.isArray(windowsValue)) throw new ConfigError('expected an array', ['windows'])
  const windows = windowsValue.map((entry, index) => window(entry, index))
  return Object.freeze({
    timeZone: timeZone(input['timeZone'], fallback.timeZone, ['timeZone']),
    windows: Object.freeze(windows),
  })
}

/** Validate and fill the Cordis plugin configuration. */
export function normalizeConfig(value: unknown): PluginConfig {
  const input = value === undefined ? {} : record(value, [])
  const allowed = new Set([
    'enabled', 'storageFile', 'pollIntervalSeconds', 'dailyCreateLimit',
    'maxConcurrentTasks', 'maxContinuationRounds', 'defaultPolicy',
  ])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new ConfigError(`unknown property ${key}`, [key])
  }
  const enabled = input['enabled'] ?? DEFAULT_CONFIG.enabled
  if (typeof enabled !== 'boolean') throw new ConfigError('expected a boolean', ['enabled'])
  const storageFile = input['storageFile'] ?? DEFAULT_CONFIG.storageFile
  if (typeof storageFile !== 'string' || storageFile.trim().length === 0) {
    throw new ConfigError('expected a non-empty path', ['storageFile'])
  }
  return Object.freeze({
    enabled,
    storageFile,
    pollIntervalSeconds: finiteInteger(input['pollIntervalSeconds'], DEFAULT_CONFIG.pollIntervalSeconds, 1, 3600, ['pollIntervalSeconds']),
    dailyCreateLimit: finiteInteger(input['dailyCreateLimit'], DEFAULT_CONFIG.dailyCreateLimit, 1, 1000, ['dailyCreateLimit']),
    maxConcurrentTasks: finiteInteger(input['maxConcurrentTasks'], DEFAULT_CONFIG.maxConcurrentTasks, 1, 16, ['maxConcurrentTasks']),
    maxContinuationRounds: finiteInteger(input['maxContinuationRounds'], DEFAULT_CONFIG.maxContinuationRounds, 0, 20, ['maxContinuationRounds']),
    defaultPolicy: normalizeIdlePolicy(input['defaultPolicy'], DEFAULT_IDLE_POLICY),
  })
}

/** Standard Schema consumed directly by Cordis before plugin application. */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'leisure-time-queue',
    validate(value: unknown) {
      try {
        return { value: normalizeConfig(value) }
      } catch (error: unknown) {
        if (error instanceof ConfigError) {
          return { issues: [{ message: error.message, path: [...error.path] }] }
        }
        return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
      }
    },
  },
}
