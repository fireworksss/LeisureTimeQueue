import { useMemo, useState } from 'react'
import {
  IconAlarmClockOutline16, IconEditOutline16, IconPlayOutline16, IconQueueOutline14,
  IconRefreshOutline14, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { LeisureCardFace } from './controller.ts'
import type { LeisureLocaleKey } from './locales.ts'
import { sessionIdentity } from './session-label.ts'
import { TaskCreateForm } from './TaskCreateForm.tsx'
import type { LeisureTimeTaskView, TaskStatus } from '../types.ts'

const NS = 'settings.leisure-time-queue'

type LeisureEntryFace = InjectFace<LeisureCardFace>

export type SessionQueueActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>
  & LeisureEntryFace

export type SidebarQueueActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>
  & LeisureEntryFace

interface QueueRow {
  readonly sessionId: string
  readonly sessionTitle: string | undefined
  readonly task: LeisureTimeTaskView
}

interface EditDraft {
  readonly sessionId: string
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly notBefore: string
}

function isActive(status: TaskStatus): boolean {
  return status === 'queued' || status === 'paused' || status === 'dispatched' || status === 'running'
}

function statusKey(status: TaskStatus): LeisureLocaleKey {
  switch (status) {
    case 'queued': return 'statusQueued'
    case 'paused': return 'statusPaused'
    case 'dispatched': return 'statusDispatched'
    case 'running': return 'statusRunning'
    case 'completed': return 'statusCompleted'
    case 'failed': return 'statusFailed'
    case 'cancelled': return 'statusCancelled'
  }
}

function localDateTime(instant: string | undefined): string {
  if (instant === undefined) return ''
  const date = new Date(instant)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function utcDateTime(value: string): string | undefined {
  if (value === '') return ''
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined
}

function actionList(status: TaskStatus): readonly { action: string; label: LeisureLocaleKey; danger?: boolean }[] {
  if (status === 'queued') return [
    { action: 'pause', label: 'pause' },
    { action: 'run-now', label: 'runNow' },
    { action: 'cancel', label: 'cancel', danger: true },
  ]
  if (status === 'paused') return [
    { action: 'resume', label: 'resume' },
    { action: 'run-now', label: 'runNow' },
    { action: 'cancel', label: 'cancel', danger: true },
  ]
  if (status === 'dispatched') return [
    { action: 'pause', label: 'pause' },
    { action: 'cancel', label: 'cancel', danger: true },
  ]
  if (status === 'failed' || status === 'cancelled') return [
    { action: 'retry', label: 'retry' },
    { action: 'delete', label: 'delete', danger: true },
  ]
  if (status === 'completed') return [{ action: 'delete', label: 'delete', danger: true }]
  return []
}

/** Current-session header action: capture the draft and queue it without leaving the conversation. */
export function SessionQueueAction(props: SessionQueueActionProps) {
  const { sessionId, t } = props
  const state = props.useLeisureQueue(snapshot => snapshot)
  const draft = props.useInput(snapshot => snapshot.draft)
  const [open, setOpen] = useState(false)
  const count = state.dashboard?.sessions.find(session => session.sessionId === String(sessionId))
    ?.tasks.filter(task => isActive(task.status)).length ?? 0
  const label = count > 0 ? t('sessionActionCount').replace('{count}', String(count)) : t('sessionAction')

  return (
    <>
      <Tooltip label={label} side="bottom" delayMs={400}>
        <button className="ltq-sessionAction" type="button" aria-label={label} onClick={() => { setOpen(true) }}>
          <IconAlarmClockOutline16 size={14} />
          <span>{t('sessionAction')}</span>
          {count > 0 ? <span className="ltq-headerCount">{count}</span> : null}
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('quickCreateTitle')}
        description={t('quickCreateHint')}
        closeLabel={t('close')}
        className="ltq-createModal"
      >
        <TaskCreateForm
          {...props}
          fixedSessionId={String(sessionId)}
          initialPrompt={draft}
          compact
          onCancel={() => { setOpen(false) }}
          onCreated={() => { setOpen(false) }}
        />
      </Modal>
    </>
  )
}

/** Sidebar footer entry: global task count, creation, and queue management. */
export function SidebarQueueAction(props: SidebarQueueActionProps) {
  const { wide, t } = props
  const state = props.useLeisureQueue(snapshot => snapshot)
  const currentSessionId = props.useSessions(snapshot => snapshot.current)
  const [open, setOpen] = useState(false)
  const activeCount = state.dashboard?.sessions.reduce(
    (sum, session) => sum + session.tasks.filter(task => isActive(task.status)).length,
    0,
  ) ?? 0
  const label = activeCount > 0
    ? t('sidebarActionCount').replace('{count}', String(activeCount))
    : t('sidebarAction')

  return (
    <>
      <Tooltip label={label} side="right" delayMs={wide ? 800 : 400} disabled={wide}>
        <button className={`ltq-sidebarAction${wide ? '' : ' ltq-sidebarActionRail'}`} type="button" aria-label={label} onClick={() => { setOpen(true) }}>
          <span className="ltq-sidebarIcon"><IconAlarmClockOutline16 size={16} /></span>
          {wide ? <span className="ltq-sidebarLabel">{t('sidebarAction')}</span> : null}
          {activeCount > 0 ? <span className="ltq-sidebarCount">{activeCount > 99 ? '99+' : activeCount}</span> : null}
        </button>
      </Tooltip>
      <QueueManagerModal
        {...props}
        open={open}
        preferredSessionId={currentSessionId === undefined ? undefined : String(currentSessionId)}
        onClose={() => { setOpen(false) }}
      />
    </>
  )
}

function QueueManagerModal(props: LeisureEntryFace & PropsLocale<typeof NS> & {
  readonly open: boolean
  readonly preferredSessionId?: string | undefined
  readonly onClose: () => void
}) {
  const { t } = props
  const state = props.useLeisureQueue(snapshot => snapshot)
  const [tab, setTab] = useState<'queue' | 'create'>('queue')
  const [edit, setEdit] = useState<EditDraft | undefined>()
  const [validation, setValidation] = useState<string | undefined>()
  const titleBySession = useMemo(
    () => new Map(state.sessions.map(session => [session.sessionId, session.title] as const)),
    [state.sessions],
  )
  const rows = useMemo<QueueRow[]>(() => {
    const values = state.dashboard?.sessions.flatMap(session => session.tasks.map(task => ({
      sessionId: session.sessionId,
      sessionTitle: titleBySession.get(session.sessionId),
      task,
    }))) ?? []
    return values.sort((left, right) => {
      const activeDifference = Number(isActive(right.task.status)) - Number(isActive(left.task.status))
      if (activeDifference !== 0) return activeDifference
      const queueDifference = (left.task.globalQueuePosition ?? Number.MAX_SAFE_INTEGER) - (right.task.globalQueuePosition ?? Number.MAX_SAFE_INTEGER)
      return queueDifference !== 0 ? queueDifference : Date.parse(right.task.updatedAt) - Date.parse(left.task.updatedAt)
    })
  }, [state.dashboard, titleBySession])
  const groups = [
    { key: 'active', title: t('queueActive'), rows: rows.filter(row => isActive(row.task.status)) },
    { key: 'attention', title: t('queueAttention'), rows: rows.filter(row => row.task.status === 'failed' || row.task.status === 'cancelled') },
    { key: 'history', title: t('queueHistory'), rows: rows.filter(row => row.task.status === 'completed') },
  ]

  const runAction = (row: QueueRow, action: string): void => {
    if (action === 'delete' && typeof confirm === 'function' && !confirm(t('confirmDelete'))) return
    void props.taskAction(row.sessionId, action, row.task.id)
  }

  const saveEdit = (): void => {
    if (edit === undefined || edit.title.trim() === '' || edit.prompt.trim() === '') {
      setValidation(t('emptyRequired'))
      return
    }
    const instant = utcDateTime(edit.notBefore)
    if (instant === undefined) {
      setValidation(t('operationFailed'))
      return
    }
    setValidation(undefined)
    void props.updateTask(edit.sessionId, { ...edit, notBefore: instant }).then((ok) => {
      if (ok) setEdit(undefined)
    })
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={t('managerTitle')}
      description={t('managerHint')}
      closeLabel={t('close')}
      className="ltq-managerModal"
      contentClassName="ltq-managerContent"
    >
      <div className="ltq-managerTabs" role="tablist" aria-label={t('managerTitle')}>
        <button className={`ltq-managerTab${tab === 'queue' ? ' ltq-managerTabActive' : ''}`} type="button" role="tab" aria-selected={tab === 'queue'} onClick={() => { setTab('queue') }}>
          <IconQueueOutline14 /> {t('queueTab')}
        </button>
        <button className={`ltq-managerTab${tab === 'create' ? ' ltq-managerTabActive' : ''}`} type="button" role="tab" aria-selected={tab === 'create'} onClick={() => { setTab('create') }}>
          <IconEditOutline16 size={14} /> {t('createTab')}
        </button>
        <button className="ltq-managerRefresh" type="button" disabled={state.busy} aria-label={t('refresh')} title={t('refresh')} onClick={props.refresh}>
          <IconRefreshOutline14 />
        </button>
      </div>

      {tab === 'create'
        ? (
          <TaskCreateForm
            {...props}
            preferredSessionId={props.preferredSessionId}
            onCancel={() => { setTab('queue') }}
            onCreated={() => { setTab('queue') }}
          />
        )
        : (
          <div className="ltq-managerQueue">
            {state.error !== undefined ? <p className="ltq-error" role="status">{state.error}</p> : null}
            {validation !== undefined ? <p className="ltq-error" role="status">{validation}</p> : null}
            {rows.length === 0 ? <p className="ltq-emptyState">{t('queueEmpty')}</p> : null}
            {groups.map(group => group.rows.length === 0 ? null : (
              <section className="ltq-queueGroup" key={group.key}>
                <h3>{group.title}<span>{group.rows.length}</span></h3>
                <div className="ltq-queueRows">
                  {group.rows.map(row => (
                    <article className="ltq-queueRow" key={`${row.sessionId}:${row.task.id}`}>
                      {edit?.id === row.task.id && edit.sessionId === row.sessionId
                        ? (
                          <div className="ltq-queueEdit">
                            <div className="ltq-grid">
                              <label className="ltq-field"><span className="ltq-label">{t('taskTitle')}</span><input className="ltq-input" value={edit.title} disabled={state.busy} onChange={event => { setEdit({ ...edit, title: event.target.value }) }} /></label>
                              <label className="ltq-field"><span className="ltq-label">{t('notBefore')}</span><input className="ltq-input" type="datetime-local" value={edit.notBefore} disabled={state.busy} onChange={event => { setEdit({ ...edit, notBefore: event.target.value }) }} /></label>
                              <label className="ltq-field ltq-fieldwide"><span className="ltq-label">{t('taskPrompt')}</span><textarea className="ltq-textarea" value={edit.prompt} disabled={state.busy} onChange={event => { setEdit({ ...edit, prompt: event.target.value }) }} /></label>
                            </div>
                            <div className="ltq-actions"><button className="ltq-button" type="button" disabled={state.busy} onClick={() => { setEdit(undefined) }}>{t('discardEdit')}</button><button className="ltq-button ltq-buttonPrimary" type="button" disabled={state.busy} onClick={saveEdit}>{t('saveEdit')}</button></div>
                          </div>
                        )
                        : (
                          <>
                            <div className="ltq-queueRowHead">
                              <button className="ltq-sessionLink" type="button" title={row.sessionId} onClick={() => { props.openSession(row.sessionId); props.onClose() }}>
                                {sessionIdentity(row.sessionTitle, row.sessionId)}
                              </button>
                              <span className="ltq-badge">{t(statusKey(row.task.status))}</span>
                            </div>
                            <strong>{row.task.title}</strong>
                            <p>{row.task.prompt}</p>
                            <div className="ltq-taskmeta">
                              {row.task.globalQueuePosition === undefined ? null : <span>{t('queuePosition')}: {row.task.globalQueuePosition}</span>}
                              <span>{t('updated')}: {new Date(row.task.updatedAt).toLocaleString()}</span>
                            </div>
                            <div className="ltq-actions">
                              {row.task.status === 'queued' || row.task.status === 'paused'
                                ? <button className="ltq-button" type="button" disabled={state.busy} onClick={() => { setEdit({ sessionId: row.sessionId, id: row.task.id, title: row.task.title, prompt: row.task.prompt, notBefore: localDateTime(row.task.notBefore) }) }}><IconEditOutline16 size={14} /> {t('edit')}</button>
                                : null}
                              {actionList(row.task.status).map(action => (
                                <button className={`ltq-button${action.danger === true ? ' ltq-buttonDanger' : ''}`} type="button" disabled={state.busy} key={action.action} onClick={() => { runAction(row, action.action) }}>
                                  {action.action === 'run-now' ? <IconPlayOutline16 size={14} /> : null} {t(action.label)}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
    </Modal>
  )
}
