import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { LeisureSettings } from '../settings.ts'
import { LEISURE_SETTINGS_NAMESPACE } from '../shared.ts'
import { LeisureClientController } from './controller.ts'
import { LeisureTimeQueueCard } from './LeisureTimeQueueCard.tsx'
import { en, zh, type LeisureLocaleKey } from './locales.ts'
import { installStyles } from './styles.ts'

const NS = 'settings.leisure-time-queue'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** LeisureTimeQueue management-card copy. */
    'settings.leisure-time-queue': LeisureLocaleKey
  }
}

/** Services required by the browser management card. */
export const inject = ['connection', 'locale', 'remote', 'remote.session', 'sessions', 'slots', 'settingsScope', 'uiWorkspace']

/** Register locale copy and the keyed card in Settings → Plugins. */
export function apply(ctx: Context): void {
  installStyles()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'leisure-time-queue: client locale')
  const scope = ctx.settingsScope.bind<LeisureSettings>({ namespace: LEISURE_SETTINGS_NAMESPACE })
  const controller = new LeisureClientController(ctx, scope)
  ctx.effect(() => () => controller.dispose(), 'leisure-time-queue: client controller')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: LEISURE_SETTINGS_NAMESPACE,
    locale: NS,
    inject: () => controller.inject(),
  }, LeisureTimeQueueCard))
}
