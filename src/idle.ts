import type { IdleDecision, IdlePolicy, IdleWindow, Weekday } from './types.ts'

const ORDER: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function minutes(value: string): number {
  if (value === '24:00') return 24 * 60
  const [hour = '0', minute = '0'] = value.split(':')
  return Number(hour) * 60 + Number(minute)
}

function localParts(now: number, timeZone: string): { day: Weekday; minute: number; text: string } {
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]))
  const day = parts['weekday']?.toLowerCase() as Weekday
  return {
    day,
    minute: Number(parts['hour']) * 60 + Number(parts['minute']),
    text: `${parts['year']}-${parts['month']}-${parts['day']} ${parts['hour']}:${parts['minute']}:${parts['second']} ${timeZone}`,
  }
}

function windowContains(window: IdleWindow, day: Weekday, minute: number): boolean {
  const start = minutes(window.start)
  const end = minutes(window.end)
  if (start < end) return window.days.includes(day) && minute >= start && minute < end
  const previous = ORDER[(ORDER.indexOf(day) + 6) % 7] as Weekday
  return (window.days.includes(day) && minute >= start)
    || (window.days.includes(previous) && minute < end)
}

/** Evaluate the user-defined execution schedule at one explicit instant. */
export function evaluateIdlePolicy(
  policy: IdlePolicy,
  now: number,
): IdleDecision {
  const local = localParts(now, policy.timeZone)
  const insideWindow = policy.windows.some(window => windowContains(window, local.day, local.minute))
  const reasons: string[] = []
  if (policy.windows.length === 0) reasons.push('no execution windows are configured')
  else if (!insideWindow) reasons.push('current local time is outside every configured execution window')
  return Object.freeze({
    eligible: insideWindow,
    localTime: local.text,
    insideWindow,
    reasons: Object.freeze(reasons),
  })
}
