// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import ConversationList from './ConversationList'

const { state, remove } = vi.hoisted(() => ({
  state: {
    activeAgentConversationId: 'idle', agentConversationsLoaded: true,
    agentGeneratingTitleIds: {}, agentEditingConversationId: null,
    agentConversations: [] as AgentConversation[], tasks: [] as TaskRecord[],
    setActiveAgentConversationId: vi.fn(), renameAgentConversation: vi.fn(),
  },
  remove: vi.fn(),
}))
vi.mock('../store', () => ({ useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) }))
vi.mock('../lib/agentConversationActions', () => ({ confirmDeleteAgentConversation: vi.fn(), confirmDeleteAgentConversations: remove }))
let root: Root

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  remove.mockClear()
  state.setActiveAgentConversationId.mockClear()
  state.agentConversations = ['idle', 'image', 'reply'].map((id) => ({ id, title: id, createdAt: 1, updatedAt: 1, messages: [], rounds: id === 'reply' ? [{ id: 'reply-round', status: 'running', outputTaskIds: [] } as unknown as AgentRound] : [] }))
  state.tasks = [{ id: 'image-task', status: 'running', agentConversationId: 'image' } as TaskRecord]
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<ConversationList />))
})
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('labels image and reply activity separately and selects multiple rows without switching conversations', async () => {
  expect(document.querySelector('[data-kind="image"]')?.textContent).toBe('生图中')
  expect(document.querySelector('[data-kind="reply"]')?.textContent).toBe('回复中')
  await act(() => document.querySelector<HTMLButtonElement>('.conversation-list-heading button')!.click())
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="全选当前搜索结果"]')!.click())
  expect(document.querySelectorAll('input.conversation-select:checked')).toHaveLength(3)
  expect(state.setActiveAgentConversationId).not.toHaveBeenCalled()
  expect(document.querySelector('.conversation-batch-actions')?.textContent).toContain('2 个选中的对话仍在运行')
  await act(() => document.querySelector<HTMLButtonElement>('.conversation-batch-actions button')!.click())
  expect(remove).toHaveBeenCalledWith(['idle', 'image', 'reply'])
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="选择对话：reply"]')!.click())
  expect(document.querySelectorAll('input.conversation-select:checked')).toHaveLength(2)
})

it('limits select-all to search matches and clears selection when the search changes', async () => {
  await act(() => document.querySelector<HTMLButtonElement>('.conversation-list-heading button')!.click())
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索对话"]')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'idle')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelectorAll('.conversation-row')).toHaveLength(1)
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="全选当前搜索结果"]')!.click())
  await act(() => document.querySelector<HTMLButtonElement>('.conversation-batch-actions button')!.click())
  expect(remove).toHaveBeenCalledWith(['idle'])
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="清除对话搜索"]')!.click())
  expect(document.querySelectorAll('.conversation-row')).toHaveLength(3)
  expect(document.querySelectorAll('input.conversation-select:checked')).toHaveLength(0)
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'idle')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => document.querySelector<HTMLInputElement>('[aria-label="全选当前搜索结果"]')!.click())
  await act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelectorAll('.conversation-row')).toHaveLength(3)
  expect(document.querySelectorAll('input.conversation-select:checked')).toHaveLength(0)
})
