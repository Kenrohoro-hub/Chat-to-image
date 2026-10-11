import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../types'

const state = vi.hoisted(() => ({ agentConversations: [] as AgentConversation[], agentConversationSaveError: null as string | null }))
const stored = vi.hoisted(() => new Map<string, AgentConversation>())
vi.mock('../store', () => ({ useStore: { getState: () => state, setState: (patch: Partial<typeof state>) => Object.assign(state, patch) } }))
vi.mock('./db', () => ({ commitAgentConversationChanges: vi.fn(async (changed: AgentConversation[], removed: string[]) => {
  for (const item of changed) stored.set(item.id, item)
  for (const id of removed) stored.delete(id)
}) }))
import { commitAgentConversationChanges } from './db'
import { flushAgentConversationsToIndexedDB, initializeAgentConversationPersistence, scheduleAgentConversationSave } from './agentConversationPersistence'

const conversation = (id: string, title = id): AgentConversation => ({ id, title, createdAt: 1, updatedAt: 1, activeRoundId: null, rounds: [], messages: [] })

beforeEach(async () => {
  await flushAgentConversationsToIndexedDB()
  stored.clear()
  state.agentConversations = []
  state.agentConversationSaveError = null
  initializeAgentConversationPersistence([])
  vi.mocked(commitAgentConversationChanges).mockClear()
})
afterEach(async () => { await flushAgentConversationsToIndexedDB(); vi.useRealTimers(); vi.restoreAllMocks() })

it('only writes the changed conversation', async () => {
  const first = conversation('first')
  const second = conversation('second')
  state.agentConversations = [first, second]
  await flushAgentConversationsToIndexedDB()
  vi.mocked(commitAgentConversationChanges).mockClear()
  state.agentConversations = [{ ...first, title: '修改' }, second]
  await flushAgentConversationsToIndexedDB()
  expect(commitAgentConversationChanges).toHaveBeenCalledTimes(1)
  expect(vi.mocked(commitAgentConversationChanges).mock.calls[0][0].map((item) => item.id)).toEqual(['first'])
})

it('combines 100 streaming deltas into two commits and saves the full final text', async () => {
  vi.useFakeTimers()
  let text = ''
  for (let index = 0; index < 100; index++) {
    text += '字'
    state.agentConversations = [conversation('stream', text)]
    scheduleAgentConversationSave(true)
    await vi.advanceTimersByTimeAsync(5)
  }
  expect(commitAgentConversationChanges).toHaveBeenCalledTimes(1)
  await flushAgentConversationsToIndexedDB()
  expect(commitAgentConversationChanges).toHaveBeenCalledTimes(2)
  expect(stored.get('stream')?.title).toBe(text)
})

it('does not revive deleted conversations when a slow write overlaps an import', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = vi.mocked(commitAgentConversationChanges).getMockImplementation()!
  vi.mocked(commitAgentConversationChanges).mockImplementationOnce(async (changed, removed) => {
    await gate
    return original(changed, removed)
  })
  state.agentConversations = [conversation('deleted')]
  const saving = flushAgentConversationsToIndexedDB()
  await Promise.resolve()
  await Promise.resolve()
  state.agentConversations = [conversation('imported')]
  const queued = flushAgentConversationsToIndexedDB()
  release()
  await Promise.all([saving, queued])
  expect([...stored.keys()]).toEqual(['imported'])
})

it('retains the uncommitted snapshot after failure and supports explicit retry', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  state.agentConversations = [conversation('unsaved')]
  vi.mocked(commitAgentConversationChanges).mockRejectedValueOnce(new Error('disk full'))
  expect(await flushAgentConversationsToIndexedDB()).toBe(false)
  expect(state.agentConversationSaveError).toContain('重试')
  expect(stored.size).toBe(0)
  expect(await flushAgentConversationsToIndexedDB()).toBe(true)
  expect(stored.has('unsaved')).toBe(true)
  expect(state.agentConversationSaveError).toBeNull()
})
