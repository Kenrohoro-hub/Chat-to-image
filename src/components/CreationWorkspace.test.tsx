// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import CreationWorkspace from './CreationWorkspace'

const state = vi.hoisted(() => ({ tasks: [] as TaskRecord[], agentConversations: [], activeAgentConversationId: null, agentSidebarCollapsed: true, agentConversationSaveError: '', setLightboxImageId: vi.fn(), setDetailTaskId: vi.fn(), setConfirmDialog: vi.fn(), showToast: vi.fn() }))
vi.mock('../store', () => ({ useStore: (select: (value: typeof state) => unknown) => select(state), removeTask: vi.fn(), editOutputs: vi.fn(), reuseConfig: vi.fn() }))
vi.mock('../lib/agentConversationPersistence', () => ({ flushAgentConversationsToIndexedDB: vi.fn() }))
vi.mock('./CreationContext', () => ({ default: () => null }))
vi.mock('./AgentWorkspace', () => ({ default: () => <div>对话记录</div> }))
vi.mock('./gallery/GalleryResults', () => ({ default: () => <div>结果比较</div> }))
vi.mock('./gallery/GalleryImage', () => ({ default: () => null }))
vi.mock('./input/DraftUndoNotice', () => ({ default: () => null }))
vi.mock('./InputBar', () => ({ default: ({ paramsTarget }: { paramsTarget: HTMLDivElement | null }) => <><textarea aria-label="草稿" />{paramsTarget && createPortal(<input aria-label="test width" defaultValue="1536" />, paramsTarget)}</> }))
let root: ReturnType<typeof createRoot>
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('keeps the composer and parameters mounted across focused views and drawer changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.tasks = [{ id: 'history', prompt: '历史作品', params: DEFAULT_PARAMS, createdAt: 1, status: 'done', outputImages: ['first', 'second'] }] as TaskRecord[]
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<CreationWorkspace onAllHistory={() => {}} />))
  expect(document.querySelector('.creation-panes > .creation-center')).not.toBeNull()
  expect(document.querySelector('.creation-results-panel .creation-history-strip')).not.toBeNull()
  const button = (label: string) => [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label || el.textContent === label)!
  const draft = document.querySelector('textarea')!
  draft.value = '保留草稿'
  await act(() => button('聚焦图片').click())
  expect(draft.closest<HTMLElement>('.creation-center')!.hidden).toBe(true)
  await act(() => window.dispatchEvent(new Event('playground-compose')))
  expect(draft.closest<HTMLElement>('.creation-center')!.hidden).toBe(false)
  expect(document.querySelector('textarea')).toBe(draft)
  expect(draft.value).toBe('保留草稿')
  await act(() => button('生图参数').click())
  const params = document.querySelector<HTMLInputElement>('[aria-label="test width"]')!
  params.value = '2048'
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="关闭生图参数"]')!.click())
  await act(() => button('最近生成').click())
  expect(document.querySelector('select')).not.toBeNull()
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="关闭最近生成"]')!.click())
  await act(() => button('生图参数').click())
  expect(document.querySelector('[aria-label="test width"]')).toBe(params)
  expect(params.value).toBe('2048')
})
