// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../../types'
import RecentHistory from './RecentHistory'

const mock = vi.hoisted(() => ({
  state: { tasks: [] as TaskRecord[], agentConversations: [], activeAgentConversationId: null, setLightboxImageId: vi.fn(), setDetailTaskId: vi.fn(), setConfirmDialog: vi.fn(), showToast: vi.fn() },
  removeTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../store', () => ({ useStore: (select: (state: typeof mock.state) => unknown) => select(mock.state), removeTask: mock.removeTask, editOutputs: vi.fn(), reuseConfig: vi.fn() }))
vi.mock('./GalleryImage', () => ({ default: () => null }))
let root: ReturnType<typeof createRoot>
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = '' })

it('requires confirmation for the selected task and disables deletion while generating', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const tasks = [{ id: 'first', prompt: '第一张', createdAt: 1, status: 'done', outputImages: ['image-1'] }, { id: 'second', prompt: '第二张', createdAt: 2, status: 'done', outputImages: ['image-2'] }, { id: 'running', prompt: '生成中的图片', createdAt: 3, status: 'running', outputImages: [] }] as TaskRecord[]
  mock.state.tasks = tasks
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<RecentHistory onAllHistory={() => {}} />))
  const running = document.querySelector<HTMLButtonElement>('[aria-label="删除历史：生成中的图片"]')!
  expect(running.disabled).toBe(true)
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="删除历史：第二张"]')!.click())
  expect(mock.removeTask).not.toHaveBeenCalled()
  const dialog = mock.state.setConfirmDialog.mock.calls[0][0]
  expect(dialog.title).toBe('删除任务')
  await dialog.action()
  expect(mock.removeTask).toHaveBeenCalledExactlyOnceWith(tasks[1])
})
