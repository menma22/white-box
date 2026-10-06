import { useEffect, useRef, useState } from 'react'
import { onFlushRequested } from './bridge'
import { EditorFlush } from './editor-flush'

const participants = new Set<() => Promise<boolean>>()
let windowEditorFlush: EditorFlush | null = null

export async function runEditorAction(action: () => void | Promise<void>): Promise<boolean> {
  if (windowEditorFlush) return windowEditorFlush.run(crypto.randomUUID(), action)
  if (!await flushDraftParticipants()) return false
  await action()
  return true
}

export function useDraftParticipant(flush: () => Promise<boolean>) {
  const callback = useRef(flush)
  callback.current = flush
  useEffect(() => {
    const participant = () => callback.current()
    participants.add(participant)
    return () => { participants.delete(participant) }
  }, [])
}

export async function flushDraftParticipants(): Promise<boolean> {
  for (const participant of [...participants]) if (!await participant()) return false
  return true
}

export function useEditorFlush(flush: () => Promise<boolean>) {
  const callback = useRef(flush)
  callback.current = flush
  const [state, setState] = useState({ frozen: false, error: '' })
  const controller = useRef<EditorFlush | null>(null)
  if (!controller.current) controller.current = new EditorFlush(async () => await callback.current() && await flushDraftParticipants(), setState)
  const editorFlush = controller.current
  useEffect(() => {
    windowEditorFlush = editorFlush
    const unregister = onFlushRequested((request) => editorFlush.prepare(request.id), (id) => editorFlush.release(id))
    const key = (event: KeyboardEvent) => {
      if (!editorFlush.snapshot().frozen) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => { if (windowEditorFlush === editorFlush) windowEditorFlush = null; unregister(); window.removeEventListener('keydown', key, true) }
  }, [editorFlush])
  return { ...state, isFrozen: () => editorFlush.snapshot().frozen, run: (action: () => void | Promise<void>) => editorFlush.run(crypto.randomUUID(), action) }
}
