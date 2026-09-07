import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LeisureQueueManager } from './manager.ts'
import type { TaskStatus } from './types.ts'

function output(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const OUTPUT = { schema: {}, render: output } as const

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): ToolDefinition['parameters'] {
  return { type: 'object', properties, additionalProperties: false, ...(required.length === 0 ? {} : { required }) }
}

function textProperty(description: string): Record<string, unknown> {
  return { type: 'string', description }
}

function generic(
  name: string,
  description: string,
  parameters: ToolDefinition['parameters'],
  execute: ToolDefinition['execute'],
): ToolDefinition {
  return { name, description, parameters, output: OUTPUT, execute }
}

/** Register model-callable queue and execution-schedule tools in one agent scope. */
export function registerLeisureTimeTools(agent: Agent, manager: LeisureQueueManager): () => void {
  const disposers: Array<() => void> = []
  const register = (definition: ToolDefinition): void => { disposers.push(agent.ctx.tools.register(definition)) }
  const wrongAgent = (execAgent: Agent | undefined): Record<string, unknown> | undefined => execAgent === agent
    ? undefined
    : { code: 'wrong_agent', message: 'The tool was called outside its owning session.' }

  register(generic(
    'leisure_create',
    'Create one durable, one-shot coding task for the current session. It waits in a global FIFO queue and starts only when this session is live, the agent is available, and the current time is inside a user-configured execution window.',
    objectSchema({
      title: textProperty('Short task title.'),
      prompt: textProperty('Complete self-contained task instructions, including expected output and verification.'),
      not_before: textProperty('Optional future RFC 3339 instant before which the task must not run.'),
    }, ['title', 'prompt']),
    async (raw, exec) => {
      const rejected = wrongAgent(exec.agent)
      if (rejected !== undefined) return rejected
      exec.signal.throwIfAborted()
      const args = raw as { title: string; prompt: string; not_before?: string }
      return await manager.create(agent.id, {
        title: args.title,
        prompt: args.prompt,
        ...(args.not_before === undefined ? {} : { notBefore: args.not_before }),
      })
    },
  ))

  register(generic(
    'leisure_list',
    'List LeisureTimeQueue tasks owned by the current session, including lifecycle state and global queue position.',
    objectSchema({ status: { type: 'string', enum: ['queued', 'paused', 'dispatched', 'running', 'completed', 'failed', 'cancelled'] } }),
    async (raw, exec) => {
      const rejected = wrongAgent(exec.agent)
      if (rejected !== undefined) return rejected
      exec.signal.throwIfAborted()
      return await manager.list(agent.id, (raw as { status?: TaskStatus }).status)
    },
  ))

  register(generic(
    'leisure_update',
    'Edit the title, prompt, or not-before time of a queued or paused task.',
    objectSchema({
      id: textProperty('Task id returned by leisure_create or leisure_list.'),
      title: textProperty('Replacement title.'),
      prompt: textProperty('Replacement complete task instructions.'),
      not_before: textProperty('Replacement future RFC 3339 instant. An empty string clears it.'),
    }, ['id']),
    async (raw, exec) => {
      const rejected = wrongAgent(exec.agent)
      if (rejected !== undefined) return rejected
      exec.signal.throwIfAborted()
      const args = raw as { id: string; title?: string; prompt?: string; not_before?: string }
      return await manager.update(agent.id, {
        id: args.id,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(args.not_before === undefined ? {} : { notBefore: args.not_before }),
      })
    },
  ))

  const taskAction = (
    name: string,
    description: string,
    action: (id: string) => Promise<unknown>,
  ): void => register(generic(name, description, objectSchema({ id: textProperty('Task id.') }, ['id']), async (raw, exec) => {
    const rejected = wrongAgent(exec.agent)
    if (rejected !== undefined) return rejected
    exec.signal.throwIfAborted()
    return await action((raw as { id: string }).id)
  }))

  taskAction('leisure_pause', 'Pause a queued task, or retract a dispatched task that has not started.', id => manager.pause(agent.id, id, agent))
  taskAction('leisure_resume', 'Return a paused task to the global FIFO queue.', id => manager.resume(agent.id, id))
  taskAction('leisure_cancel', 'Cancel a queued, paused, or dispatched task. Running work must be interrupted with the normal Harness cancel control.', id => manager.cancel(agent.id, id, agent))
  taskAction('leisure_retry', 'Return a failed or cancelled task to the queue while preserving its conversation context.', id => manager.retry(agent.id, id))
  taskAction('leisure_delete', 'Permanently delete a completed, failed, or cancelled task record.', id => manager.delete(agent.id, id))
  taskAction('leisure_run_now', 'Move a queued or paused task to the front of admission by bypassing its configured execution window once. The owning agent still must be available.', id => manager.runNow(agent.id, id))

  register(generic(
    'leisure_schedule_configure',
    'Configure the weekly local-time windows in which queued tasks may start for the current session. An empty windows list disables automatic execution.',
    objectSchema({
      reset: { type: 'boolean', description: 'Remove the session override and return to plugin defaults.' },
      timeZone: textProperty('IANA time zone such as Asia/Shanghai.'),
      windows: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            days: { type: 'array', items: { type: 'string', enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] } },
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['days', 'start', 'end'],
        },
      },
    }),
    async (raw, exec) => {
      const rejected = wrongAgent(exec.agent)
      if (rejected !== undefined) return rejected
      exec.signal.throwIfAborted()
      const args = raw as { reset?: boolean; timeZone?: unknown; windows?: unknown }
      return await manager.configureSchedule(agent.id, args)
    },
  ))

  register(generic(
    'leisure_schedule_status',
    'Show the current session execution schedule, whether the current time is eligible, and why queued work is waiting.',
    objectSchema({}),
    async (_raw, exec) => {
      const rejected = wrongAgent(exec.agent)
      if (rejected !== undefined) return rejected
      exec.signal.throwIfAborted()
      return await manager.scheduleStatus(agent.id, agent.status)
    },
  ))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
