import { useEffect, useMemo, useState } from 'react'
import { IconCloseOutline16, IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { LeisureCardFace, LeisureClientState } from './controller.ts'
import type { LeisureLocaleKey } from './locales.ts'
import { sessionIdentity } from './session-label.ts'

interface ModelChoice {
  readonly key: string
  readonly provider: string
  readonly model: string
}

const PERMISSION_PRESETS = [
  { id: 'read-only', label: 'permissionReadOnly' },
  { id: 'workspace-write', label: 'permissionWorkspaceWrite' },
  { id: 'danger-full-access', label: 'permissionFullAccess' },
] as const satisfies readonly { readonly id: string; readonly label: LeisureLocaleKey }[]

function modelKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

function modelChoices(state: LeisureClientState): ModelChoice[] {
  return state.modelCatalog?.groups.flatMap(group => group.models.map(model => ({
    key: modelKey(group.id, model.id),
    provider: group.id,
    model: model.id,
  }))) ?? []
}

function utcDateTime(value: string): string | undefined {
  if (value === '') return ''
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined
}

function generatedTitle(prompt: string): string {
  const line = prompt.split(/\r?\n/u).map(value => value.trim()).find(Boolean) ?? ''
  return line.length <= 60 ? line : `${line.slice(0, 57)}…`
}

export type TaskCreateFormProps = InjectFace<LeisureCardFace> & {
  readonly t: (key: LeisureLocaleKey) => string
  readonly fixedSessionId?: string | undefined
  readonly preferredSessionId?: string | undefined
  readonly initialPrompt?: string | undefined
  readonly compact?: boolean
  readonly onCreated?: () => void
  readonly onCancel?: () => void
}

/** Shared task creator used by Settings, the Session header, and the sidebar. */
export function TaskCreateForm(props: TaskCreateFormProps) {
  const state = props.useLeisureQueue(snapshot => snapshot)
  const fixedSessionId = props.fixedSessionId
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>(fixedSessionId === undefined ? 'existing' : 'existing')
  const [targetSessionId, setTargetSessionId] = useState(fixedSessionId ?? props.preferredSessionId ?? '')
  const [cwd, setCwd] = useState('')
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [permissionPreset, setPermissionPreset] = useState('workspace-write')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState(props.initialPrompt ?? '')
  const [notBefore, setNotBefore] = useState('')
  const [advanced, setAdvanced] = useState(!props.compact)
  const [validation, setValidation] = useState<string | undefined>()

  const choices = useMemo(() => modelChoices(state), [state.modelCatalog])
  const choicesKey = choices.map(choice => choice.key).join('\n')

  useEffect(() => {
    if (fixedSessionId !== undefined) {
      setTargetSessionId(fixedSessionId)
      setTargetMode('existing')
      return
    }
    if (state.sessions.length === 0) {
      setTargetSessionId('')
      setTargetMode('new')
      return
    }
    if (state.sessions.some(session => session.sessionId === targetSessionId)) return
    const preferred = props.preferredSessionId !== undefined
      ? state.sessions.find(session => session.sessionId === props.preferredSessionId)
      : undefined
    setTargetSessionId(preferred?.sessionId ?? state.sessions[0]?.sessionId ?? '')
  }, [fixedSessionId, props.preferredSessionId, state.sessions, targetSessionId])

  useEffect(() => {
    if (choices.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (choices.some(choice => choice.key === selectedModelKey)) return
    const preferredKey = state.modelCatalog === undefined
      ? ''
      : modelKey(state.modelCatalog.default.provider, state.modelCatalog.default.model)
    setSelectedModelKey(choices.find(choice => choice.key === preferredKey)?.key ?? choices[0]?.key ?? '')
  }, [choicesKey, choices, selectedModelKey, state.modelCatalog])

  const selectedModel = choices.find(choice => choice.key === selectedModelKey)

  const chooseWorkingDirectory = (): void => {
    void props.pickDirectory().then((path) => {
      if (path !== null) setCwd(path)
    })
  }

  const createTask = (): void => {
    const normalizedPrompt = prompt.trim()
    const normalizedTitle = title.trim() || generatedTitle(normalizedPrompt)
    if (normalizedPrompt === '' || normalizedTitle === '') {
      setValidation(props.t('promptRequired'))
      return
    }
    if (targetMode === 'existing' && targetSessionId === '') {
      setValidation(props.t('sessionRequired'))
      return
    }
    if (targetMode === 'new' && selectedModel === undefined) {
      setValidation(props.t('modelRequired'))
      return
    }
    const instant = utcDateTime(notBefore)
    if (instant === undefined) {
      setValidation(props.t('operationFailed'))
      return
    }
    setValidation(undefined)
    const task = {
      title: normalizedTitle,
      prompt: normalizedPrompt,
      ...(instant === '' ? {} : { notBefore: instant }),
    }
    const operation = targetMode === 'existing'
      ? props.createTask(targetSessionId, task)
      : props.createSessionTask({
          ...task,
          ...(cwd.trim() === '' ? {} : { cwd: cwd.trim() }),
          provider: selectedModel?.provider ?? '',
          model: selectedModel?.model ?? '',
          permissionPreset,
        })
    void operation.then((ok) => {
      if (!ok) return
      setTitle('')
      setPrompt('')
      setNotBefore('')
      props.onCreated?.()
    })
  }

  return (
    <div className={`ltq-createForm${props.compact ? ' ltq-createFormCompact' : ''}`}>
      {fixedSessionId === undefined
        ? (
          <div className="ltq-grid">
            <label className="ltq-field">
              <span className="ltq-label">{props.t('createTarget')}</span>
              <select className="ltq-select" value={targetMode} disabled={state.busy} onChange={event => { setTargetMode(event.target.value as 'existing' | 'new') }}>
                <option value="existing" disabled={state.sessions.length === 0}>{props.t('targetExisting')}</option>
                <option value="new">{props.t('targetNew')}</option>
              </select>
            </label>
            {targetMode === 'existing'
              ? (
                <label className="ltq-field">
                  <span className="ltq-label">{props.t('existingSession')}</span>
                  <select className="ltq-select" value={targetSessionId} disabled={state.busy || state.sessions.length === 0} onChange={event => { setTargetSessionId(event.target.value) }}>
                    {state.sessions.map(session => <option key={session.sessionId} value={session.sessionId}>{sessionIdentity(session.title, session.sessionId)}</option>)}
                  </select>
                </label>
              )
              : (
                <>
                  <label className="ltq-field">
                    <span className="ltq-label">{props.t('model')}</span>
                    <select className="ltq-select" value={selectedModelKey} disabled={state.busy || choices.length === 0} onChange={event => { setSelectedModelKey(event.target.value) }}>
                      {state.modelCatalog?.groups.map(group => (
                        <optgroup label={group.name} key={group.id}>
                          {group.models.map(model => <option key={model.id} value={modelKey(group.id, model.id)}>{model.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {state.modelCatalog === undefined && state.modelError === undefined ? <span className="ltq-muted">{props.t('modelLoading')}</span> : null}
                    {state.modelCatalog !== undefined && choices.length === 0 ? <span className="ltq-muted">{props.t('modelUnavailable')}</span> : null}
                    {state.modelError !== undefined ? <span className="ltq-error">{state.modelError}</span> : null}
                  </label>
                  <label className="ltq-field">
                    <span className="ltq-label">{props.t('permission')}</span>
                    <select className="ltq-select" value={permissionPreset} disabled={state.busy} onChange={event => { setPermissionPreset(event.target.value) }}>
                      {PERMISSION_PRESETS.map(option => <option key={option.id} value={option.id}>{props.t(option.label)}</option>)}
                    </select>
                  </label>
                  <div className="ltq-field ltq-fieldwide">
                    <span className="ltq-label">{props.t('workingDirectory')}</span>
                    <div className="ltq-pathPicker">
                      <div className={`ltq-pathValue${cwd === '' ? ' ltq-pathPlaceholder' : ''}`} title={cwd === '' ? undefined : cwd}>
                        <span>{cwd === '' ? props.t('workingDirectoryHint') : cwd}</span>
                      </div>
                      <button className="ltq-button ltq-pathButton" type="button" disabled={state.busy} onClick={chooseWorkingDirectory}>
                        <IconFolderOpenOutline16 />
                        <span>{props.t('chooseWorkingDirectory')}</span>
                      </button>
                      {cwd === '' ? null : (
                        <button className="ltq-button ltq-iconButton" type="button" disabled={state.busy} aria-label={props.t('clearWorkingDirectory')} title={props.t('clearWorkingDirectory')} onClick={() => { setCwd('') }}>
                          <IconCloseOutline16 />
                        </button>
                      )}
                    </div>
                    <span className="ltq-muted">{props.t('newSessionHint')}</span>
                  </div>
                </>
              )}
          </div>
        )
        : (
          <div className="ltq-fixedTarget">
            <span className="ltq-label">{props.t('createTarget')}</span>
            <span>{sessionIdentity(state.sessions.find(session => session.sessionId === fixedSessionId)?.title, fixedSessionId)}</span>
          </div>
        )}

      <div className="ltq-grid ltq-createFields">
        <label className="ltq-field">
          <span className="ltq-label">{props.t('taskTitleOptional')}</span>
          <input className="ltq-input" value={title} disabled={state.busy} placeholder={props.t('taskTitleAuto')} onChange={event => { setTitle(event.target.value) }} />
        </label>
        {!props.compact || advanced
          ? <label className="ltq-field"><span className="ltq-label">{props.t('notBefore')}</span><input className="ltq-input" type="datetime-local" value={notBefore} disabled={state.busy} onChange={event => { setNotBefore(event.target.value) }} /></label>
          : null}
        <label className="ltq-field ltq-fieldwide">
          <span className="ltq-label">{props.t('taskPrompt')}</span>
          <textarea className="ltq-textarea ltq-createPrompt" autoFocus={props.compact} value={prompt} disabled={state.busy} onChange={event => { setPrompt(event.target.value) }} />
        </label>
      </div>
      {props.compact
        ? <button className="ltq-linkButton" type="button" disabled={state.busy} onClick={() => { setAdvanced(value => !value) }}>{props.t(advanced ? 'hideAdvanced' : 'showAdvanced')}</button>
        : null}
      {validation !== undefined ? <p className="ltq-error" role="status">{validation}</p> : null}
      {state.error !== undefined ? <p className="ltq-error" role="status">{state.error}</p> : null}
      <div className="ltq-actions ltq-createActions">
        {props.onCancel !== undefined ? <button className="ltq-button" type="button" disabled={state.busy} onClick={props.onCancel}>{props.t('cancel')}</button> : null}
        <button className="ltq-button ltq-buttonPrimary" type="button" disabled={state.busy} onClick={createTask}>{state.busy ? props.t('saving') : props.t('create')}</button>
      </div>
    </div>
  )
}
