---
name: leisure-time-queue
description: Use when the user wants to queue non-urgent coding work, inspect or manage queued work, or configure the weekly time windows when DeepSeek Harness may start it.
---

# LeisureTimeQueue

Use the `leisure_*` tools to manage durable, one-shot coding tasks for the current session.

When creating a task:

1. Make the prompt self-contained: state scope, expected files or output, constraints, and verification.
2. Use `leisure_create`; do not promise an exact start time. Tasks are globally FIFO among live sessions and begin only inside the configured time windows when their owner is available.
3. Recommend committing current Git changes before autonomous write-heavy work.

Use `leisure_schedule_status` before explaining why a task is waiting. Use `leisure_schedule_configure` when the user defines execution hours. Weekly windows use IANA time zones and `sun` through `sat`; an overnight window such as `22:00` to `07:00` starts on each listed day. An empty window list disables automatic execution.

Lifecycle operations:

- `leisure_update`: queued or paused tasks only.
- `leisure_pause`: queued or dispatched-but-not-started tasks.
- `leisure_resume`: paused tasks.
- `leisure_cancel`: queued, paused, or dispatched tasks. Use the normal Harness cancel control for running work.
- `leisure_retry`: failed or cancelled tasks.
- `leisure_delete`: terminal tasks only.
- `leisure_run_now`: bypass the configured time window once; the agent must still be available.

Task execution occurs as a normal plugin-authored follow-up in the owning session and uses that session's configured model, tools, permissions, and billing.
