import Schema from '@deepseek-ai/schemastery'
import { normalizeIdlePolicy } from './config.ts'
import { LEISURE_SETTINGS_NAMESPACE } from './shared.ts'
import type { Config, IdlePolicy, IdleWindow, Weekday } from './types.ts'

export { LEISURE_SETTINGS_NAMESPACE }

/** Live configuration fields exposed to the Harness settings document. */
export interface LeisureSettings {
  readonly enabled: boolean
  readonly dailyCreateLimit: number
  readonly maxConcurrentTasks: number
  readonly maxContinuationRounds: number
  readonly defaultPolicy: IdlePolicy
}

const weekday = Schema.union([
  Schema.const('sun'), Schema.const('mon'), Schema.const('tue'), Schema.const('wed'),
  Schema.const('thu'), Schema.const('fri'), Schema.const('sat'),
]) as Schema<Weekday>

const idleWindow = Schema.object({
  days: Schema.array(weekday).required(),
  start: Schema.string().required(),
  end: Schema.string().required(),
}) as Schema<IdleWindow>

/** Serializable schema presented by Harness configuration surfaces. */
export const LeisureSettingsSchema = Schema.object({
  enabled: Schema.boolean().default(true),
  dailyCreateLimit: Schema.number().step(1).min(1).max(100).default(3),
  maxConcurrentTasks: Schema.number().step(1).min(1).max(16).default(1),
  maxContinuationRounds: Schema.number().step(1).min(0).max(20).default(3),
  defaultPolicy: Schema.object({
    timeZone: Schema.string().required(),
    windows: Schema.array(idleWindow).default([]),
  }).required(),
}) as Schema<LeisureSettings>

/** Select the live-editable subset of the Cordis entry configuration. */
export function settingsFromConfig(config: Config): LeisureSettings {
  return {
    enabled: config.enabled,
    dailyCreateLimit: config.dailyCreateLimit,
    maxConcurrentTasks: config.maxConcurrentTasks,
    maxContinuationRounds: config.maxContinuationRounds,
    defaultPolicy: config.defaultPolicy,
  }
}

/** Reject cross-field schedule values before Harness persists them. */
export function validateLeisureSettings(settings: LeisureSettings): void {
  normalizeIdlePolicy(settings.defaultPolicy, settings.defaultPolicy)
}

/** Overlay the current settings section onto the fixed plugin configuration. */
export function configFromSettings(config: Config, settings: LeisureSettings): Config {
  return {
    ...config,
    enabled: settings.enabled,
    dailyCreateLimit: settings.dailyCreateLimit,
    maxConcurrentTasks: settings.maxConcurrentTasks,
    maxContinuationRounds: settings.maxContinuationRounds,
    defaultPolicy: settings.defaultPolicy,
  }
}
