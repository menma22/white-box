import type { Task } from '@white-box/core/types'

export const contextFields = ['notes', 'problems', 'decisions', 'nextContext'] as const
export type ContextDraft = Record<typeof contextFields[number], string>

export function contextDraft(task: Task): ContextDraft {
  return { notes: task.notes, problems: task.problems ?? '', decisions: task.decisions ?? '', nextContext: task.nextContext ?? '' }
}

export function receiveContext(draft: ContextDraft, saved: ContextDraft, incoming: ContextDraft, pending: Partial<ContextDraft> | null) {
  const next = { ...draft }
  let conflict = false
  for (const field of contextFields) {
    if (draft[field] === saved[field]) next[field] = incoming[field]
    else if (incoming[field] !== saved[field] && incoming[field] !== draft[field] && incoming[field] !== pending?.[field]) conflict = true
  }
  return { draft: next, conflict }
}

export function acknowledgeContext(saved: ContextDraft, expected: Partial<ContextDraft>, patch: Partial<ContextDraft>): ContextDraft {
  const unchanged = Object.fromEntries(contextFields.filter((field) => Object.hasOwn(patch, field) && (saved[field] === expected[field] || saved[field] === patch[field])).map((field) => [field, patch[field]]))
  return { ...saved, ...unchanged }
}
