import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IdlePolicy, QueueState } from './types.ts'

function initialState(): QueueState {
  return Object.freeze({ version: 1, nextId: 1, tasks: Object.freeze([]), policies: Object.freeze({}) })
}

function decodeState(value: unknown): QueueState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('queue state must be an object')
  const input = value as Record<string, unknown>
  if (input['version'] !== 1 || !Number.isSafeInteger(input['nextId']) || (input['nextId'] as number) < 1) {
    throw new Error('queue state version or nextId is invalid')
  }
  if (!Array.isArray(input['tasks'])) throw new Error('queue state tasks must be an array')
  if (typeof input['policies'] !== 'object' || input['policies'] === null || Array.isArray(input['policies'])) {
    throw new Error('queue state policies must be an object')
  }
  return structuredClone(value) as QueueState
}

/** Serialized atomic JSON store for queue state. */
export class QueueStore {
  private tail: Promise<void> = Promise.resolve()

  constructor(readonly file: string) {}

  /** Read one detached state snapshot after prior mutations settle. */
  snapshot(): Promise<QueueState> {
    return this.serial(async () => this.read())
  }

  /** Apply and atomically persist one serialized state mutation. */
  mutate<T>(operation: (state: QueueState) => { readonly state: QueueState; readonly value: T }): Promise<T> {
    return this.serial(async () => {
      const current = await this.read()
      const result = operation(current)
      await this.write(result.state)
      return result.value
    })
  }

  /** Store a complete per-session policy. */
  setPolicy(sessionId: string, policy: IdlePolicy | undefined): Promise<void> {
    return this.mutate(state => {
      const policies = { ...state.policies }
      if (policy === undefined) delete policies[sessionId]
      else policies[sessionId] = policy
      return { state: { ...state, policies }, value: undefined }
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private async read(): Promise<QueueState> {
    try {
      return decodeState(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initialState()
      throw error
    }
  }

  private async write(state: QueueState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}
