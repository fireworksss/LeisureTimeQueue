/** LeisureTimeQueue plugin for DeepSeek Harness. */

import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { Config } from './config.ts'
import type { Config as PluginConfig } from './types.ts'
import { installLeisureRpc } from './rpc.ts'
import { LeisureTimeCoordinator } from './runtime.ts'
import {
  configFromSettings,
  LEISURE_SETTINGS_NAMESPACE,
  LeisureSettingsSchema,
  settingsFromConfig,
  type LeisureSettings,
  validateLeisureSettings,
} from './settings.ts'
import { QueueStore } from './store.ts'

export { Config }
export type * from './types.ts'
export { evaluateIdlePolicy } from './idle.ts'
export { normalizeConfig, normalizeIdlePolicy } from './config.ts'
export { QueueStore } from './store.ts'
export { LeisureTimeCoordinator } from './runtime.ts'
export {
  LEISURE_SETTINGS_NAMESPACE,
  LeisureSettingsSchema,
  configFromSettings,
  settingsFromConfig,
  validateLeisureSettings,
} from './settings.ts'
export { LEISURE_RPC_CHANNEL, createLeisureRpcHandler, installLeisureRpc } from './rpc.ts'

/** Cordis function-plugin name. */
export const name = 'leisure-time-queue'
/** Services required to manage tools, live root agents, and their sessions. */
export const inject = ['agents', 'tools', 'sessions']

/** Install the queue coordinator and dispose it with the Cordis fiber. */
export function apply(ctx: Context, config: PluginConfig): void {
  const storageFile = isAbsolute(config.storageFile)
    ? config.storageFile
    : resolve(process.cwd(), config.storageFile)
  const baseSettings = settingsFromConfig(config)
  let settingsSource: () => LeisureSettings = () => baseSettings
  const currentConfig = (): PluginConfig => configFromSettings(config, settingsSource())
  const coordinator = new LeisureTimeCoordinator(ctx, currentConfig, new QueueStore(storageFile))
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, LEISURE_SETTINGS_NAMESPACE, LeisureSettingsSchema, baseSettings, {
      validate: validateLeisureSettings,
      setSource: (current) => { settingsSource = current },
      onChange: () => { coordinator.requestDrive() },
    })
  })
  ctx.inject(['connection'], (connectionCtx) => {
    installLeisureRpc(connectionCtx, coordinator)
  })
  ctx.effect(() => {
    coordinator.start()
    return () => coordinator.dispose()
  }, 'leisure-time-queue.lifecycle()')
}
