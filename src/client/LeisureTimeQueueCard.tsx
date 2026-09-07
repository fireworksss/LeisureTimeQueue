import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { IconCloseOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_CONFIG, normalizeIdlePolicy } from '../config.ts'
import type { LeisureSettings } from '../settings.ts'
import type {
  IdlePolicy,
  LeisureDashboardSession,
  LeisureTimeTaskView,
  TaskStatus,
  Weekday,
} from '../types.ts'
import type { LeisureCardFace, LeisureClientState } from './controller.ts'
import type { LeisureLocaleKey } from './locales.ts'
import { sessionIdentity } from './session-label.ts'
import { systemTimeZone, timeZoneOptions } from './timezones.ts'

const NS = 'settings.leisure-time-queue'
const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_KEYS: Record<Weekday, LeisureLocaleKey> = {
  sun: 'daySun', mon: 'dayMon', tue: 'dayTue', wed: 'dayWed',
  thu: 'dayThu', fri: 'dayFri', sat: 'daySat',
}

interface WindowDraft {
  days: Weekday[]
  start: string
  end: string
}

interface PolicyDraft {
  timeZone: string
  windows: WindowDraft[]
}

interface SettingsDraft {
  enabled: boolean
  dailyCreateLimit: number
  maxConcurrentTasks: number
  maxContinuationRounds: number
  defaultPolicy: PolicyDraft
}

interface EditDraft {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly notBefore: string
}

interface ModelChoice {
  readonly key: string
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  readonly efforts: readonly { readonly id: string; readonly name: string }[]
  readonly defaultEffort?: string
}

const PERMISSION_PRESETS = [
  { id: 'read-only', label: 'permissionReadOnly' },
  { id: 'workspace-write', label: 'permissionWorkspaceWrite' },
  { id: 'danger-full-access', label: 'permissionFullAccess' },
] as const satisfies readonly { readonly id: string; readonly label: LeisureLocaleKey }[]

/** Props supplied by the settings plugin slot and this package's controller. */
export type LeisureTimeQueueCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<typeof NS>
  & InjectFace<LeisureCardFace>

function policyDraft(policy: IdlePolicy): PolicyDraft {
  return {
    timeZone: policy.timeZone,
    windows: policy.windows.map(window => ({ days: [...window.days], start: window.start, end: window.end })),
  }
}

function settingsDraft(settings: LeisureSettings): SettingsDraft {
  return { ...settings, defaultPolicy: policyDraft(settings.defaultPolicy) }
}

function validPolicy(draft: PolicyDraft): IdlePolicy | undefined {
  try {
    return normalizeIdlePolicy(draft, DEFAULT_CONFIG.defaultPolicy)
  } catch {
    return undefined
  }
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

function modelKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

function modelChoices(state: LeisureClientState): ModelChoice[] {
  return state.modelCatalog?.groups.flatMap(group => group.models.map(model => ({
    key: modelKey(group.id, model.id),
    provider: group.id,
    providerName: group.name,
    model: model.id,
    modelName: model.name,
    efforts: model.reasoning?.efforts ?? [],
    ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
  }))) ?? []
}

function supportedReasoningEffort(choice: ModelChoice | undefined, ...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && choice?.efforts.some(effort => effort.id === candidate) === true) return candidate
  }
  return ''
}

function ScheduleEditor(props: {
  readonly draft: PolicyDraft
  readonly disabled: boolean
  readonly t: (key: LeisureLocaleKey) => string
  readonly onChange: (draft: PolicyDraft) => void
}) {
  const localTimeZone = useMemo(() => systemTimeZone(), [])
  const timeZones = useMemo(() => timeZoneOptions(props.draft.timeZone), [props.draft.timeZone])
  const setWindow = (index: number, next: WindowDraft): void => {
    props.onChange({ ...props.draft, windows: props.draft.windows.map((window, at) => at === index ? next : window) })
  }
  return (
    <div className="ltq-grid">
      <label className="ltq-field ltq-fieldwide">
        <span className="ltq-label">{props.t('timeZone')}</span>
        <select
          className="ltq-select"
          value={props.draft.timeZone}
          disabled={props.disabled}
          onChange={event => { props.onChange({ ...props.draft, timeZone: event.target.value }) }}
        >
          {timeZones.map(zone => (
            <option value={zone} key={zone}>
              {zone}{zone === localTimeZone ? ` (${props.t('systemTimeZone')})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="ltq-field ltq-fieldwide">
        <span className="ltq-label">{props.t('windows')}</span>
        <div className="ltq-windows">
          {props.draft.windows.length === 0 ? <p className="ltq-muted">{props.t('noWindows')}</p> : null}
          {props.draft.windows.map((window, index) => (
            <div className="ltq-window" key={index}>
              <div className="ltq-windowtop">
                <div className="ltq-days">
                  {WEEKDAYS.map(day => (
                    <label className="ltq-day" key={day}>
                      <input
                        type="checkbox"
                        checked={window.days.includes(day)}
                        disabled={props.disabled}
                        onChange={() => {
                          const days = window.days.includes(day)
                            ? window.days.filter(value => value !== day)
                            : [...window.days, day]
                          setWindow(index, { ...window, days })
                        }}
                      />
                      {props.t(DAY_KEYS[day])}
                    </label>
                  ))}
                </div>
                <label className="ltq-field">
                  <span className="ltq-label">{props.t('start')}</span>
                  <input className="ltq-input" value={window.start} disabled={props.disabled} placeholder="HH:mm" onChange={event => { setWindow(index, { ...window, start: event.target.value }) }} />
                </label>
                <label className="ltq-field">
                  <span className="ltq-label">{props.t('end')}</span>
                  <input className="ltq-input" value={window.end} disabled={props.disabled} placeholder="HH:mm" onChange={event => { setWindow(index, { ...window, end: event.target.value }) }} />
                </label>
                <button className="ltq-button" type="button" disabled={props.disabled} onClick={() => { props.onChange({ ...props.draft, windows: props.draft.windows.filter((_, at) => at !== index) }) }}>
                  {props.t('removeWindow')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="ltq-actions">
          <button className="ltq-button" type="button" disabled={props.disabled} onClick={() => { props.onChange({ ...props.draft, windows: [...props.draft.windows, { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '22:00', end: '07:00' }] }) }}>
            {props.t('addWindow')}
          </button>
        </div>
      </div>
    </div>
  )
}

function actionButtons(
  task: LeisureTimeTaskView,
  busy: boolean,
  t: (key: LeisureLocaleKey) => string,
  run: (action: string) => void,
  edit: () => void,
) {
  const buttons: Array<[string, LeisureLocaleKey]> = []
  if (task.status === 'queued') buttons.push(['pause', 'pause'], ['run-now', 'runNow'], ['cancel', 'cancel'])
  if (task.status === 'paused') buttons.push(['resume', 'resume'], ['run-now', 'runNow'], ['cancel', 'cancel'])
  if (task.status === 'dispatched') buttons.push(['pause', 'pause'], ['cancel', 'cancel'])
  if (task.status === 'failed' || task.status === 'cancelled') buttons.push(['retry', 'retry'], ['delete', 'delete'])
  if (task.status === 'completed') buttons.push(['delete', 'delete'])
  return (
    <div className="ltq-actions">
      {task.status === 'queued' || task.status === 'paused'
        ? <button className="ltq-button" type="button" disabled={busy} onClick={edit}>{t('edit')}</button>
        : null}
      {buttons.map(([action, key]) => (
        <button
          className={`ltq-button${action === 'delete' || action === 'cancel' ? ' ltq-buttonDanger' : ''}`}
          type="button"
          disabled={busy}
          key={action}
          onClick={() => { run(action) }}
        >
          {t(key)}
        </button>
      ))}
    </div>
  )
}

/** Render the complete visual management card inside Settings → Plugins. */
export function LeisureTimeQueueCard(props: LeisureTimeQueueCardProps) {
  const { t } = props
  const state = props.useLeisureQueue(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const settings = state.settings.value
  const [globalDraft, setGlobalDraft] = useState<SettingsDraft>(() => settingsDraft(settings ?? DEFAULT_CONFIG))
  const [selectedId, setSelectedId] = useState('')
  const selected = state.dashboard?.sessions.find(session => session.sessionId === selectedId)
  const [sessionDraft, setSessionDraft] = useState<PolicyDraft>(() => policyDraft(DEFAULT_CONFIG.defaultPolicy))
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing')
  const [targetSessionId, setTargetSessionId] = useState('')
  const [cwd, setCwd] = useState('')
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')
  const [permissionPreset, setPermissionPreset] = useState('workspace-write')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [notBefore, setNotBefore] = useState('')
  const [editDraft, setEditDraft] = useState<EditDraft | undefined>()
  const [validation, setValidation] = useState<string | undefined>()

  const settingsKey = settings === undefined ? '' : JSON.stringify(settings)
  useEffect(() => {
    if (settings !== undefined) setGlobalDraft(settingsDraft(settings))
  }, [settingsKey])

  const sessionsKey = state.dashboard?.sessions.map(session => session.sessionId).join('\n') ?? ''
  useEffect(() => {
    const sessions = state.dashboard?.sessions ?? []
    if (sessions.length === 0) {
      setSelectedId('')
      return
    }
    if (!sessions.some(session => session.sessionId === selectedId)) setSelectedId(sessions[0]?.sessionId ?? '')
  }, [sessionsKey, selectedId])

  const targetSessionsKey = state.sessions.map(session => session.sessionId).join('\n')
  useEffect(() => {
    if (state.sessions.length === 0) {
      setTargetSessionId('')
      setTargetMode('new')
      return
    }
    if (!state.sessions.some(session => session.sessionId === targetSessionId)) {
      setTargetSessionId(state.sessions[0]?.sessionId ?? '')
    }
  }, [targetSessionsKey, targetSessionId])

  const choices = useMemo(() => modelChoices(state), [state.modelCatalog])
  const sessionTitles = useMemo(
    () => new Map(state.sessions.map(session => [session.sessionId, session.title] as const)),
    [state.sessions],
  )
  const choicesKey = choices.map(choice => `${choice.key}:${choice.efforts.map(effort => effort.id).join(',')}`).join('\n')
  useEffect(() => {
    if (choices.length === 0) {
      setSelectedModelKey('')
      setReasoningEffort('')
      return
    }
    if (choices.some(choice => choice.key === selectedModelKey)) return
    const preferredKey = state.modelCatalog === undefined
      ? ''
      : modelKey(state.modelCatalog.default.provider, state.modelCatalog.default.model)
    const preferred = choices.find(choice => choice.key === preferredKey) ?? choices[0]
    setSelectedModelKey(preferred?.key ?? '')
    setReasoningEffort(supportedReasoningEffort(
      preferred,
      preferred?.key === preferredKey ? state.modelCatalog?.default.reasoningEffort : undefined,
      preferred?.defaultEffort,
    ))
  }, [choicesKey, selectedModelKey, state.modelCatalog])

  const selectedPolicyKey = selected === undefined ? '' : `${selected.sessionId}:${JSON.stringify(selected.policy)}`
  useEffect(() => {
    if (selected !== undefined) setSessionDraft(policyDraft(selected.policy))
    setEditDraft(undefined)
  }, [selectedPolicyKey])

  const globalPolicy = useMemo(() => validPolicy(globalDraft.defaultPolicy), [globalDraft])
  const sessionPolicy = useMemo(() => validPolicy(sessionDraft), [sessionDraft])
  const selectedModel = choices.find(choice => choice.key === selectedModelKey)
  const disabled = state.busy || !state.settings.writable

  const saveGlobal = (): void => {
    if (globalPolicy === undefined) {
      setValidation(t('invalidSchedule'))
      return
    }
    setValidation(undefined)
    void props.saveGlobal({ ...globalDraft, defaultPolicy: globalPolicy })
  }

  const saveSession = (): void => {
    if (selected === undefined || sessionPolicy === undefined) {
      setValidation(t('invalidSchedule'))
      return
    }
    setValidation(undefined)
    void props.saveSession(selected.sessionId, sessionPolicy)
  }

  const createTask = (): void => {
    if (title.trim() === '' || prompt.trim() === '') {
      setValidation(t('emptyRequired'))
      return
    }
    if (targetMode === 'existing' && targetSessionId === '') {
      setValidation(t('sessionRequired'))
      return
    }
    if (targetMode === 'new' && selectedModel === undefined) {
      setValidation(t('modelRequired'))
      return
    }
    const instant = utcDateTime(notBefore)
    if (instant === undefined) {
      setValidation(t('operationFailed'))
      return
    }
    setValidation(undefined)
    const task = {
      title: title.trim(),
      prompt: prompt.trim(),
      ...(instant === '' ? {} : { notBefore: instant }),
    }
    const selectedEffort = supportedReasoningEffort(selectedModel, reasoningEffort)
    const operation = targetMode === 'existing'
      ? props.createTask(targetSessionId, task)
      : props.createSessionTask({
          ...task,
          ...(cwd.trim() === '' ? {} : { cwd: cwd.trim() }),
          provider: selectedModel?.provider ?? '',
          model: selectedModel?.model ?? '',
          ...(selectedEffort === '' ? {} : { reasoningEffort: selectedEffort }),
          permissionPreset,
        })
    void operation.then(() => {
      setTitle('')
      setPrompt('')
      setNotBefore('')
    })
  }

  const saveEdit = (): void => {
    if (selected === undefined || editDraft === undefined || editDraft.title.trim() === '' || editDraft.prompt.trim() === '') {
      setValidation(t('emptyRequired'))
      return
    }
    const instant = utcDateTime(editDraft.notBefore)
    if (instant === undefined) {
      setValidation(t('operationFailed'))
      return
    }
    setValidation(undefined)
    void props.updateTask(selected.sessionId, { ...editDraft, notBefore: instant }).then(() => { setEditDraft(undefined) })
  }

  const runAction = (task: LeisureTimeTaskView, action: string): void => {
    if (selected === undefined) return
    if (action === 'delete' && typeof confirm === 'function' && !confirm(t('confirmDelete'))) return
    void props.taskAction(selected.sessionId, action, task.id)
  }

  const chooseModel = (key: string): void => {
    const choice = choices.find(candidate => candidate.key === key)
    setSelectedModelKey(key)
    setReasoningEffort(supportedReasoningEffort(choice, choice?.defaultEffort))
  }

  const chooseWorkingDirectory = (): void => {
    void props.pickDirectory().then((path) => {
      if (path !== null) setCwd(path)
    })
  }

  return (
    <li className="ltq-card">
      <button className="ltq-header" type="button" aria-expanded={open} aria-label={t(open ? 'collapse' : 'expand')} onClick={() => { setOpen(!open) }}>
        <span className="ltq-headcopy">
          <span className="ltq-name">{t('title')}</span>
          <span className="ltq-description">{t('description')}</span>
        </span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open
        ? (
          <div className="ltq-body">
            <div className="ltq-section">
              <div className="ltq-actions">
                <button className="ltq-button" type="button" disabled={state.busy} onClick={props.refresh}>{t('refresh')}</button>
                {state.status === 'loading' ? <span className="ltq-muted">{t('loading')}</span> : null}
              </div>
              {state.error !== undefined ? <p className="ltq-error" role="status">{state.error}</p> : null}
              {validation !== undefined ? <p className="ltq-error" role="status">{validation}</p> : null}
            </div>
            {settings !== undefined
              ? (
                <section className="ltq-section">
                  <div className="ltq-sectionhead">
                    <div><h3>{t('globalTitle')}</h3><p className="ltq-muted">{t('globalHint')}</p></div>
                    <div className="ltq-actions">
                      <button className="ltq-button" type="button" disabled={disabled} onClick={() => { void props.resetGlobal() }}>{t('reset')}</button>
                      <button className="ltq-button ltq-buttonPrimary" type="button" disabled={disabled || globalPolicy === undefined} onClick={saveGlobal}>{t(state.busy ? 'saving' : 'save')}</button>
                    </div>
                  </div>
                  <div className="ltq-grid">
                    <label className="ltq-toggle ltq-fieldwide"><input type="checkbox" checked={globalDraft.enabled} disabled={disabled} onChange={event => { setGlobalDraft({ ...globalDraft, enabled: event.target.checked }) }} />{t('enabled')}</label>
                    <label className="ltq-field"><span className="ltq-label">{t('dailyLimit')}</span><input className="ltq-input" type="number" min="1" max="100" value={globalDraft.dailyCreateLimit} disabled={disabled} onChange={event => { setGlobalDraft({ ...globalDraft, dailyCreateLimit: Number(event.target.value) }) }} /></label>
                    <label className="ltq-field"><span className="ltq-label">{t('concurrency')}</span><input className="ltq-input" type="number" min="1" max="16" value={globalDraft.maxConcurrentTasks} disabled={disabled} onChange={event => { setGlobalDraft({ ...globalDraft, maxConcurrentTasks: Number(event.target.value) }) }} /></label>
                    <label className="ltq-field"><span className="ltq-label">{t('continuations')}</span><input className="ltq-input" type="number" min="0" max="20" value={globalDraft.maxContinuationRounds} disabled={disabled} onChange={event => { setGlobalDraft({ ...globalDraft, maxContinuationRounds: Number(event.target.value) }) }} /></label>
                  </div>
                  <h4>{t('scheduleTitle')}</h4>
                  <ScheduleEditor draft={globalDraft.defaultPolicy} disabled={disabled} t={t} onChange={defaultPolicy => { setGlobalDraft({ ...globalDraft, defaultPolicy }) }} />
                </section>
              )
              : null}
            <section className="ltq-section">
              <div className="ltq-sectionhead"><div><h3>{t('createTitle')}</h3><p className="ltq-muted">{t('createHint')}</p></div></div>
              <div className="ltq-grid">
                <label className="ltq-field">
                  <span className="ltq-label">{t('createTarget')}</span>
                  <select className="ltq-select" value={targetMode} disabled={state.busy} onChange={event => { setTargetMode(event.target.value as 'existing' | 'new') }}>
                    <option value="existing" disabled={state.sessions.length === 0}>{t('targetExisting')}</option>
                    <option value="new">{t('targetNew')}</option>
                  </select>
                </label>
                {targetMode === 'existing'
                  ? (
                    <label className="ltq-field">
                      <span className="ltq-label">{t('existingSession')}</span>
                      <select className="ltq-select" value={targetSessionId} disabled={state.busy || state.sessions.length === 0} onChange={event => { setTargetSessionId(event.target.value) }}>
                        {state.sessions.map(session => <option key={session.sessionId} value={session.sessionId}>{sessionIdentity(session.title, session.sessionId)}</option>)}
                      </select>
                    </label>
                  )
                  : (
                    <>
                      <label className="ltq-field">
                        <span className="ltq-label">{t('model')}</span>
                        <select className="ltq-select" value={selectedModelKey} disabled={state.busy || choices.length === 0} onChange={event => { chooseModel(event.target.value) }}>
                          {state.modelCatalog?.groups.map(group => (
                            <optgroup label={group.name} key={group.id}>
                              {group.models.map(model => <option key={model.id} value={modelKey(group.id, model.id)}>{model.name}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {state.modelCatalog === undefined && state.modelError === undefined ? <span className="ltq-muted">{t('modelLoading')}</span> : null}
                        {state.modelCatalog !== undefined && choices.length === 0 ? <span className="ltq-muted">{t('modelUnavailable')}</span> : null}
                        {state.modelError !== undefined ? <span className="ltq-error">{state.modelError}</span> : null}
                      </label>
                      {selectedModel !== undefined && selectedModel.efforts.length > 0
                        ? (
                          <label className="ltq-field">
                            <span className="ltq-label">{t('reasoningEffort')}</span>
                            <select className="ltq-select" value={reasoningEffort} disabled={state.busy} onChange={event => { setReasoningEffort(event.target.value) }}>
                              <option value="">{t('reasoningDefault')}</option>
                              {selectedModel.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
                            </select>
                          </label>
                        )
                        : null}
                      <label className="ltq-field">
                        <span className="ltq-label">{t('permission')}</span>
                        <select className="ltq-select" value={permissionPreset} disabled={state.busy} onChange={event => { setPermissionPreset(event.target.value) }}>
                          {PERMISSION_PRESETS.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
                        </select>
                      </label>
                      <div className="ltq-field">
                        <span className="ltq-label">{t('workingDirectory')}</span>
                        <div className="ltq-pathPicker">
                          <div className={`ltq-pathValue${cwd === '' ? ' ltq-pathPlaceholder' : ''}`} title={cwd === '' ? undefined : cwd}>
                            <span>{cwd === '' ? t('workingDirectoryHint') : cwd}</span>
                          </div>
                          <button className="ltq-button ltq-pathButton" type="button" disabled={state.busy} onClick={chooseWorkingDirectory}>
                            <IconFolderOpenOutline16 />
                            <span>{t('chooseWorkingDirectory')}</span>
                          </button>
                          {cwd === ''
                            ? null
                            : (
                              <button className="ltq-button ltq-iconButton" type="button" disabled={state.busy} aria-label={t('clearWorkingDirectory')} title={t('clearWorkingDirectory')} onClick={() => { setCwd('') }}>
                                <IconCloseOutline16 />
                              </button>
                            )}
                        </div>
                      </div>
                      <p className="ltq-muted ltq-fieldwide">{t('newSessionHint')}</p>
                    </>
                  )}
                <label className="ltq-field"><span className="ltq-label">{t('taskTitle')}</span><input className="ltq-input" value={title} disabled={state.busy} onChange={event => { setTitle(event.target.value) }} /></label>
                <label className="ltq-field"><span className="ltq-label">{t('notBefore')}</span><input className="ltq-input" type="datetime-local" value={notBefore} disabled={state.busy} onChange={event => { setNotBefore(event.target.value) }} /></label>
                <label className="ltq-field ltq-fieldwide"><span className="ltq-label">{t('taskPrompt')}</span><textarea className="ltq-textarea" value={prompt} disabled={state.busy} onChange={event => { setPrompt(event.target.value) }} /></label>
              </div>
              <div className="ltq-actions"><button className="ltq-button ltq-buttonPrimary" type="button" disabled={state.busy} onClick={createTask}>{t('create')}</button></div>
            </section>
            <section className="ltq-section">
              <div className="ltq-sectionhead"><h3>{t('sessionTitle')}</h3></div>
              {(state.dashboard?.sessions.length ?? 0) === 0
                ? <p className="ltq-muted">{t('noSessions')}</p>
                : (
                  <>
                    <label className="ltq-field">
                      <span className="ltq-label">{t('session')}</span>
                      <select className="ltq-select" value={selectedId} disabled={state.busy} onChange={event => { setSelectedId(event.target.value) }}>
                        {state.dashboard?.sessions.map(session => (
                          <option key={session.sessionId} value={session.sessionId}>
                            {sessionIdentity(sessionTitles.get(session.sessionId), session.sessionId)} · {t(session.live ? 'sessionLive' : 'sessionCold')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selected !== undefined ? <SessionPanel {...props} session={selected} draft={sessionDraft} setDraft={setSessionDraft} sessionPolicy={sessionPolicy} disabled={state.busy} onSaveSession={saveSession} editDraft={editDraft} setEditDraft={setEditDraft} saveEdit={saveEdit} runAction={runAction} /> : null}
                  </>
                )}
            </section>
          </div>
        )
        : null}
    </li>
  )
}

function SessionPanel(props: LeisureTimeQueueCardProps & {
  readonly session: LeisureDashboardSession
  readonly draft: PolicyDraft
  readonly setDraft: (draft: PolicyDraft) => void
  readonly sessionPolicy: IdlePolicy | undefined
  readonly disabled: boolean
  readonly onSaveSession: () => void
  readonly editDraft: EditDraft | undefined
  readonly setEditDraft: (value: EditDraft | undefined) => void
  readonly saveEdit: () => void
  readonly runAction: (task: LeisureTimeTaskView, action: string) => void
}) {
  const { t, session } = props
  return (
    <>
      <div className="ltq-badges">
        <span className="ltq-badge">{t(session.live ? 'sessionLive' : 'sessionCold')}</span>
        {session.agentStatus !== undefined ? <span className="ltq-badge">{t(session.agentStatus === 'idle' ? 'agentIdle' : 'agentRunning')}</span> : null}
        <span className="ltq-badge">{t(session.usingDefaultPolicy ? 'usingDefault' : 'usingOverride')}</span>
        <span className={`ltq-badge${session.decision.eligible ? ' ltq-badgeGood' : ''}`}>{t(session.decision.eligible ? 'eligible' : 'ineligible')}</span>
      </div>
      <div className="ltq-section">
        <div className="ltq-sectionhead">
          <h4>{t('scheduleTitle')}</h4>
          <div className="ltq-actions">
            <button className="ltq-button" type="button" disabled={props.disabled || session.usingDefaultPolicy} onClick={() => { void props.resetSession(session.sessionId) }}>{t('resetSession')}</button>
            <button className="ltq-button ltq-buttonPrimary" type="button" disabled={props.disabled || props.sessionPolicy === undefined} onClick={props.onSaveSession}>{t('saveSession')}</button>
          </div>
        </div>
        <ScheduleEditor draft={props.draft} disabled={props.disabled} t={t} onChange={props.setDraft} />
      </div>
      <div className="ltq-section">
        <div className="ltq-sectionhead"><h4>{t('tasksTitle')}</h4></div>
        {session.tasks.length === 0 ? <p className="ltq-muted">{t('noTasks')}</p> : null}
        <div className="ltq-tasks">
          {session.tasks.map(task => (
            <article className="ltq-task" key={task.id}>
              {props.editDraft?.id === task.id
                ? (
                  <>
                    <div className="ltq-grid">
                      <label className="ltq-field"><span className="ltq-label">{t('taskTitle')}</span><input className="ltq-input" value={props.editDraft.title} disabled={props.disabled} onChange={event => { props.setEditDraft({ ...props.editDraft as EditDraft, title: event.target.value }) }} /></label>
                      <label className="ltq-field"><span className="ltq-label">{t('notBefore')}</span><input className="ltq-input" type="datetime-local" value={props.editDraft.notBefore} disabled={props.disabled} onChange={event => { props.setEditDraft({ ...props.editDraft as EditDraft, notBefore: event.target.value }) }} /></label>
                      <label className="ltq-field ltq-fieldwide"><span className="ltq-label">{t('taskPrompt')}</span><textarea className="ltq-textarea" value={props.editDraft.prompt} disabled={props.disabled} onChange={event => { props.setEditDraft({ ...props.editDraft as EditDraft, prompt: event.target.value }) }} /></label>
                    </div>
                    <div className="ltq-actions"><button className="ltq-button" type="button" disabled={props.disabled} onClick={() => { props.setEditDraft(undefined) }}>{t('discardEdit')}</button><button className="ltq-button ltq-buttonPrimary" type="button" disabled={props.disabled} onClick={props.saveEdit}>{t('saveEdit')}</button></div>
                  </>
                )
                : (
                  <>
                    <div className="ltq-taskhead"><span className="ltq-tasktitle">{task.title}</span><span className="ltq-badge">{t(statusKey(task.status))}</span></div>
                    <p className="ltq-taskprompt">{task.prompt}</p>
                    <div className="ltq-taskmeta">
                      {task.globalQueuePosition === undefined ? null : <span>{t('queuePosition')}: {task.globalQueuePosition}</span>}
                      <span>{t('updated')}: {new Date(task.updatedAt).toLocaleString()}</span>
                    </div>
                    {actionButtons(task, props.disabled, t, action => { props.runAction(task, action) }, () => { props.setEditDraft({ id: task.id, title: task.title, prompt: task.prompt, notBefore: localDateTime(task.notBefore) }) })}
                  </>
                )}
            </article>
          ))}
        </div>
      </div>
    </>
  )
}
