/** Build one human-facing session identity without duplicating an id fallback. */
export function sessionIdentity(title: string | undefined, sessionId: string): string {
  return title === undefined || title === '' || title === sessionId
    ? sessionId
    : `${title} · ${sessionId}`
}
