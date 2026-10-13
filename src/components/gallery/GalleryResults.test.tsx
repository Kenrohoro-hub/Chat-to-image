// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AgentConversation, type TaskRecord } from '../../types'
import GalleryResults from './GalleryResults'

const mock = vi.hoisted(() => ({ state: { tasks: [] as TaskRecord[], agentConversations: [] as AgentConversation[], activeAgentConversationId: 'chat', setLightboxImageId: vi.fn(), setDetailTaskId: vi.fn(), openFavoritePicker: vi.fn(), showToast: vi.fn() }, edit: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue({ failCount: 0 }), reuse: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../store', () => ({ useStore: (select: (state: typeof mock.state) => unknown) => select(mock.state), reuseConfig: mock.reuse }))
vi.mock('../../lib/workspaceTransfer', () => ({ sendTaskToAgent: mock.edit }))
vi.mock('../../lib/downloadImages', () => ({ downloadImageIds: mock.download }))
vi.mock('./GalleryImage', () => ({ default: ({ id }: { id: string }) => <img alt={id} /> }))
let root: ReturnType<typeof createRoot>
afterEach(async () => { if (root) await act(() => root.unmount()); vi.clearAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('compares active branch images and routes every action to the selected image', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.state.tasks = ['old', 'new', 'other'].map((id, i) => ({ id, agentConversationId: 'chat', agentRoundId: id, prompt: id, params: DEFAULT_PARAMS, createdAt: i + 1, status: 'done', outputImages: [`${id}-1`, `${id}-2`] })) as TaskRecord[]
  mock.state.agentConversations = [{ id: 'chat', activeRoundId: 'new', rounds: ['old', 'new', 'other'].map((id, i) => ({ id, index: i + 1, parentRoundId: i ? 'old' : null, outputTaskIds: [id], status: 'done' })) }] as AgentConversation[]
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<GalleryResults />))
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.creation-compare-select')]
  expect(buttons()).toHaveLength(4)
  expect(buttons()[3].getAttribute('aria-pressed')).toBe('true')
  await act(() => buttons()[0].click())
  expect(buttons()[0].getAttribute('aria-pressed')).toBe('true')
  expect(mock.state.setLightboxImageId).toHaveBeenCalledWith('old-1', ['old-1', 'old-2', 'new-1', 'new-2'])
  const button = (label: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === label)!
  await act(() => button('继续修改').click())
  expect(mock.edit).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'old', outputImages: ['old-1'] }), false)
  await act(() => button('蒙版编辑').click())
  expect(mock.edit).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'old', outputImages: ['old-1'] }), true)
  await act(() => button('下载').click())
  expect(mock.download).toHaveBeenCalledWith(['old-1'], 'chat-to-image')

  mock.state.tasks = mock.state.tasks.filter((task) => task.id !== 'old')
  await act(() => root.render(<GalleryResults />))
  expect(buttons()).toHaveLength(2)
  expect(buttons()[1].getAttribute('aria-pressed')).toBe('true')
  mock.state.tasks[0] = { ...mock.state.tasks[0], status: 'error', error: '部分失败', outputErrors: [{ requestIndex: 1, error: '失败' }] } as TaskRecord
  mock.state.agentConversations[0].rounds[1].status = 'running'
  await act(() => root.render(<GalleryResults />))
  expect(button('继续修改').disabled).toBe(true)
  expect(button('蒙版编辑').disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('部分失败')
  expect(buttons()).toHaveLength(2)
})

