import { afterEach, expect, it, vi } from 'vitest'
import { commitAgentConversationChanges, putTask } from './db'
import type { AgentConversation, TaskRecord } from '../types'

afterEach(() => vi.unstubAllGlobals())

it('waits for transaction commit and rejects an abort after request success', async () => {
  const request = { result: 'task-id', error: null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
  const tx = { error: null as Error | null, oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, objectStore: () => ({ put: () => request }) }
  vi.stubGlobal('indexedDB', { open: () => {
    const opened = { result: { transaction: () => tx }, onsuccess: null as (() => void) | null }
    queueMicrotask(() => opened.onsuccess?.())
    return opened
  } })
  let committed = false
  const first = putTask({ id: 'task-id' } as TaskRecord).then(() => { committed = true })
  await vi.waitFor(() => expect(tx.oncomplete).toBeTypeOf('function'))
  request.onsuccess?.()
  await Promise.resolve()
  expect(committed).toBe(false)
  tx.oncomplete?.()
  await first
  expect(committed).toBe(true)

  tx.oncomplete = null
  const second = putTask({ id: 'task-id' } as TaskRecord)
  const rejection = expect(second).rejects.toThrow('storage aborted')
  await vi.waitFor(() => expect(tx.oncomplete).toBeTypeOf('function'))
  request.onsuccess?.()
  tx.error = new Error('storage aborted')
  tx.onabort?.()
  await rejection
})

it('commits changed conversations and deletions together and rejects transaction abort', async () => {
  const writes: string[] = []
  const tx = { error: null as Error | null, oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
    objectStore: () => ({ put: (item: AgentConversation) => { writes.push(`put:${item.id}`) }, delete: (id: string) => { writes.push(`delete:${id}`) } }) }
  vi.stubGlobal('indexedDB', { open: () => {
    const opened = { result: { transaction: () => tx }, onsuccess: null as (() => void) | null }
    queueMicrotask(() => opened.onsuccess?.())
    return opened
  } })
  const saving = commitAgentConversationChanges([{ id: 'changed' } as AgentConversation], ['removed'])
  const rejection = expect(saving).rejects.toThrow('数据库事务已中止')
  await vi.waitFor(() => expect(tx.onabort).toBeTypeOf('function'))
  expect(writes).toEqual(['put:changed', 'delete:removed'])
  tx.onabort?.()
  await rejection
})
