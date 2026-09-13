import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { LeisureSettings } from '../settings.ts'
import { LEISURE_SETTINGS_NAMESPACE } from '../shared.ts'
import { LeisureClientController } from './controller.ts'
import { LeisureTimeQueueCard } from './LeisureTimeQueueCard.tsx'
import { SessionQueueAction, SidebarQueueAction } from './QuickAccess.tsx'
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
export const inject = ['connection', 'locale', 'remote', 'remote.session', 'sessions', 'slots', 'settingsScope', 'uiWorkspace', 'workspaces']

/** Register the settings card plus the Session-header and sidebar quick entries. */
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
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'leisure-time-queue',
    order: 15,
    locale: NS,
    inject: () => controller.inject(),
  }, SessionQueueAction))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'leisure-time-queue',
    order: 10,
    locale: NS,
    inject: () => controller.inject(),
  }, SidebarQueueAction))
}
