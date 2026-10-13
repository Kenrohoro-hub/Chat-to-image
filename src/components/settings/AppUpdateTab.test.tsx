// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppUpdateState } from '../../lib/desktop'
import AppUpdateTab from './AppUpdateTab'

const state = vi.hoisted(() => ({
  tasks: [] as { status: string }[],
  agentConversations: [] as { rounds: { status: string }[] }[],
  settings: { persistInputOnRestart: true },
  prompt: '',
  inputImages: [] as unknown[],
  maskDraft: null as unknown,
  maskEditorImageId: null as string | null,
  galleryInputDraft: null as unknown,
  agentInputDrafts: {} as Record<string, unknown>,
  agentConversationSaveError: '',
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
}))
const api = vi.hoisted(() => ({ app_update: vi.fn() }))
const flush = vi.hoisted(() => ({ settings: vi.fn(), conversations: vi.fn() }))
vi.mock('../../lib/desktop', () => ({ desktopApi: async () => api, isDesktop: () => true, isLocalService: () => true, flushDesktopSettings: flush.settings }))
vi.mock('../../lib/agentConversationPersistence', () => ({ flushAgentConversationsToIndexedDB: flush.conversations }))
vi.mock('../../lib/dataOperations', () => ({ hasActiveDataOperations: (tasks: { status: string }[], chats: { rounds: { status: string }[] }[]) => tasks.some((task) => task.status === 'running') || chats.some((chat) => chat.rounds.some((round) => round.status === 'running')) }))
vi.mock('../../lib/inputDraftState', () => ({ isEmptyAgentInputDraft: (draft: { prompt?: string }) => !draft.prompt }))
vi.mock('../../store', () => ({ useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) }))

let root: Root
const current: AppUpdateState = { status: 'current', currentVersion: '1.2.3', latestVersion: '1.2.3', releaseUrl: 'https://github.com/example/releases', notes: '', available: false, canInstall: false, downloaded: 0, total: 0, error: '' }
const available: AppUpdateState = { ...current, status: 'available', latestVersion: '1.3.0', available: true, canInstall: true, total: 100, notes: 'Bug fixes\nPerformance improvements' }
const ready: AppUpdateState = { ...available, status: 'ready', canInstall: true, downloaded: 100, total: 100 }
const mount = async (props = { hasUnsavedChanges: false, busy: false }) => { await act(async () => root.render(<AppUpdateTab {...props} />)) }
const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === label)!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  vi.useFakeTimers()
  state.tasks = []
  state.agentConversations = []
  state.settings = { persistInputOnRestart: true }
  state.prompt = ''
  state.inputImages = []
  state.maskDraft = null
  state.maskEditorImageId = null
  state.galleryInputDraft = null
  state.agentInputDrafts = {}
  state.agentConversationSaveError = ''
  api.app_update.mockReset().mockResolvedValue(current)
  flush.settings.mockReset().mockResolvedValue(undefined)
  flush.conversations.mockReset().mockResolvedValue(true)
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => {
  await act(() => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

it('shows the current version and latest status', async () => {
  await mount()
  expect(document.body.textContent).toContain('当前已是最新版本。')
  expect(document.body.textContent).toContain('当前版本：v1.2.3')
  expect(api.app_update.mock.calls.map(([action]) => action)).toEqual(['status'])
})

it('checks for a new version and shows its plain text release notes', async () => {
  api.app_update.mockResolvedValueOnce(current).mockResolvedValueOnce(available)
  await mount()
  await act(async () => button('检查更新').click())
  expect(document.body.textContent).toContain('发现新版本 v1.3.0')
  expect(document.body.textContent).toContain('Bug fixes\nPerformance improvements')
  expect(document.querySelector('a')?.getAttribute('href')).toBe('https://github.com/example/releases')
})

it('shows check errors and allows retry', async () => {
  api.app_update.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, status: 'error', error: 'Network unavailable' }).mockResolvedValueOnce(current)
  await mount()
  await act(async () => button('检查更新').click())
  expect(document.body.textContent).toContain('Network unavailable')
  await act(async () => button('检查更新').click())
  expect(api.app_update).toHaveBeenLastCalledWith('check')
  expect(document.body.textContent).toContain('当前已是最新版本。')
})

it('polls download progress to ready and installs only after confirmation', async () => {
  api.app_update.mockResolvedValueOnce(current).mockResolvedValueOnce(available).mockResolvedValueOnce({ ...available, status: 'downloading', downloaded: 25, total: 100 }).mockResolvedValueOnce(ready)
  await mount()
  await act(async () => button('检查更新').click())
  await act(async () => button('下载更新').click())
  expect(api.app_update).not.toHaveBeenCalledWith('install')
  expect(document.body.textContent).toContain('正在下载更新… 25%')
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(document.body.textContent).toContain('退出并安装')
  expect(api.app_update).not.toHaveBeenCalledWith('install')
  await act(async () => button('退出并安装').click())
  const confirm = state.setConfirmDialog.mock.calls[state.setConfirmDialog.mock.calls.length - 1]?.[0]
  expect(confirm.confirmText).toBe('退出并安装')
  await act(async () => confirm.action())
  expect(flush.settings).toHaveBeenCalledOnce()
  expect(flush.conversations).toHaveBeenCalledOnce()
  expect(api.app_update).toHaveBeenLastCalledWith('install')
})

it('rejects installation while work is running or settings are unsaved', async () => {
  api.app_update.mockResolvedValue(ready)
  await mount()
  state.tasks = [{ status: 'running' }]
  await act(async () => button('退出并安装').click())
  expect(state.setConfirmDialog).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('生图或对话仍在运行')
  state.tasks = []
  await act(async () => root.render(<AppUpdateTab hasUnsavedChanges busy={false} />))
  await act(async () => button('退出并安装').click())
  expect(state.setConfirmDialog).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('设置中有未保存的更改')
})

it('resumes polling when the saved update state is checking', async () => {
  api.app_update.mockResolvedValueOnce({ ...current, status: 'checking' }).mockResolvedValueOnce(current)
  await mount()
  expect(api.app_update.mock.calls.map(([action]) => action)).toEqual(['status'])
  expect(document.body.textContent).toContain('检查中…')
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(api.app_update.mock.calls.map(([action]) => action)).toEqual(['status', 'status'])
  expect(document.body.textContent).toContain('当前已是最新版本。')
})

it('closes confirmation and reports a settings flush failure without installing', async () => {
  api.app_update.mockResolvedValue(ready)
  flush.settings.mockRejectedValueOnce(new Error('Settings save failed'))
  await mount()
  await act(async () => button('退出并安装').click())
  const confirm = state.setConfirmDialog.mock.calls[0][0]
  await act(async () => expect(await confirm.action()).toBe(true))
  expect(api.app_update).not.toHaveBeenCalledWith('install')
  expect(state.showToast).toHaveBeenCalledWith('Settings save failed', 'error')
  expect(document.body.textContent).toContain('Settings save failed')
})
