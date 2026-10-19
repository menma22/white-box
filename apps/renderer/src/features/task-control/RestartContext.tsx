import type { Task } from '@white-box/core/types'

export function RestartContext({ task }: { task: Task | null | undefined }) {
  if (!task || !task.nextContext?.trim() && !task.notes.trim()) return null
  return <section className="restart-context" aria-label="再開の手がかり">
    {task.nextContext?.trim() && <p><strong>再開の手がかり </strong>{task.nextContext}</p>}
    {!task.nextContext?.trim() && task.notes.trim() && <p><strong>メモ </strong>{task.notes}</p>}
  </section>
}
