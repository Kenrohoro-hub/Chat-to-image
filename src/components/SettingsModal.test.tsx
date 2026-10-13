// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConversation, AgentInputDraft, AppSettings, InputImage, TaskRecord } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'
import { getUiLanguagePreference } from '../lib/i18n'
import SettingsModal from './SettingsModal'

const state = vi.hoisted(() => ({
  showSettings: true,
  settingsTabRequest: 'language',
  settings: {} as AppSettings,
  tasks: [] as TaskRecord[],
  agentConversations: [] as AgentConversation[],
  prompt: '',
  inputImages: [] as InputImage[],
  galleryInputDraft: null as AgentInputDraft | null,
  agentInputDrafts: {} as Record<string, AgentInputDraft>,
  reusedTaskApiProfileId: null,
  setShowSettings: vi.fn(),
  setSettings: vi.fn(),
  dismissPresetProfile: vi.fn(),
  setReusedTaskApiProfile: vi.fn(),
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
}))
const calls = vi.hoisted(() => ({ save: vi.fn(), flush: vi.fn() }))
vi.mock('../store', () => ({ useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) }))
vi.mock('../lib/desktop', () => ({ getSettingsRevision: () => 'test-revision', isLocalService: () => true, saveDesktopSettings: calls.save }))
vi.mock('../lib/agentConversationPersistence', () => ({ flushAgentConversationsToIndexedDB: calls.flush }))
vi.mock('./ApiProfileList', () => ({ default: ({ children }: { children: import('react').ReactNode }) => children }))
vi.mock('./settings/DataManagementTab', () => ({ default: () => null }))
vi.mock('./settings/FeatureIntroTab', () => ({ default: () => null }))
vi.mock('./settings/ModelSettings', () => ({ default: () => null }))
vi.mock('./settings/ApiDiagnostics', () => ({ default: () => null }))
vi.mock('./settings/GeneralSettingsTab', () => ({ default: () => null }))
vi.mock('./settings/AgentConnectionsTab', () => ({ default: () => null }))
vi.mock('./settings/AgentPreferences', () => ({ default: () => null }))
vi.mock('./MarkdownRenderer', () => ({ default: () => null }))

let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  calls.save.mockReset().mockResolvedValue(undefined)
  calls.flush.mockReset().mockResolvedValue(true)
  localStorage.removeItem('chat-to-image-ui-language')
  window.__PLAYGROUND_UI_LANGUAGE__ = 'zh-CN'
  Object.assign(state, { showSettings: true, settings: normalizeSettings(DEFAULT_SETTINGS), tasks: [], agentConversations: [], prompt: '', inputImages: [], galleryInputDraft: null, agentInputDrafts: {} })
  state.setSettings.mockImplementation((next: AppSettings) => { state.settings = next })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => {
  await act(() => root.unmount())
  localStorage.removeItem('chat-to-image-ui-language')
  delete window.__PLAYGROUND_UI_LANGUAGE__
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const mount = async () => { await act(() => root.render(<SettingsModal />)) }
const selector = () => document.querySelector<HTMLSelectElement>('select[aria-label="界面语言"]')!
const button = (text: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
const choose = async (value: string) => { await act(() => { selector().value = value; selector().dispatchEvent(new Event('change', { bubbles: true })) }) }
const save = async () => { await act(() => button('保存配置').click()) }
const draft = (prompt: string): AgentInputDraft => ({ prompt, inputImages: [], maskDraft: null, maskEditorImageId: null })

it('saves the selected image protocol in the profile', async () => {
  await mount()
  await act(() => button('API 配置').click())
  const protocol = [...document.querySelectorAll('span')].find((item) => item.textContent === '自动（Gemini/Seedream/Qwen 模型使用原生协议）')!
  expect(protocol).toBeTruthy()
  await act(() => protocol.parentElement!.click())
  await act(() => document.querySelector<HTMLElement>('[data-option-value="seedream"]')!.click())
  await save()
  expect(state.settings.profiles[0].imageProtocol).toBe('seedream')
  expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({ profiles: expect.arrayContaining([expect.objectContaining({ imageProtocol: 'seedream' })]) }), 'test-revision')
})

it('keeps the selected language in the draft and asks before closing unsaved changes', async () => {
  await mount()
  expect(selector().value).toBe('system')
  await choose('en')
  expect(selector().value).toBe('en')
  expect(getUiLanguagePreference()).toBe('system')
  expect(calls.save).not.toHaveBeenCalled()
  await act(() => document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click())
  expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '有未保存的更改' }))
  expect(state.setShowSettings).not.toHaveBeenCalled()
})

it('discards the language draft without changing the previously saved preference', async () => {
  localStorage.setItem('chat-to-image-ui-language', 'zh-CN')
  await mount()
  await choose('en')
  await act(() => button('取消未保存更改').click())
  expect(selector().value).toBe('zh-CN')
  expect(getUiLanguagePreference()).toBe('zh-CN')
  expect(calls.save).not.toHaveBeenCalled()
})

it('blocks language refresh during running or recovering work but allows an unchanged language save', async () => {
  await mount()
  await choose('en')
  for (const tasks of [[{ status: 'running' }], [{ status: 'error', falRecoverable: true }], [{ status: 'error', customRecoverable: true }]]) {
    state.tasks = tasks as TaskRecord[]
    await save()
  }
  state.tasks = []
  state.agentConversations = [{ rounds: [{ status: 'running' }] }] as AgentConversation[]
  await save()
  expect(calls.save).not.toHaveBeenCalled()
  expect(calls.flush).not.toHaveBeenCalled()
  expect(getUiLanguagePreference()).toBe('system')
  await choose('system')
  await save()
  expect(calls.save).toHaveBeenCalledOnce()
  expect(state.setSettings).toHaveBeenCalledOnce()
})

it('keeps the old language if saving ordinary settings fails', async () => {
  calls.save.mockRejectedValueOnce(new Error('Disk unavailable'))
  await mount()
  await choose('en')
  await save()
  expect(calls.flush).toHaveBeenCalledOnce()
  expect(calls.save).toHaveBeenCalledOnce()
  expect(state.setSettings).not.toHaveBeenCalled()
  expect(getUiLanguagePreference()).toBe('system')
  expect(state.showToast).toHaveBeenCalledWith('Disk unavailable', 'error')
})

it('protects current and per-workspace drafts when restart restoration is disabled', async () => {
  state.settings = normalizeSettings({ ...DEFAULT_SETTINGS, persistInputOnRestart: false })
  await mount()
  await choose('en')
  state.prompt = 'unsaved current prompt'
  await save()
  state.prompt = ''
  state.inputImages = [{ id: 'reference', dataUrl: 'data:image/png;base64,test' }]
  await save()
  state.inputImages = []
  state.galleryInputDraft = draft('unsaved gallery prompt')
  await save()
  state.galleryInputDraft = null
  state.agentInputDrafts = { chat: draft('unsaved conversation prompt') }
  await save()
  expect(calls.save).not.toHaveBeenCalled()
  expect(calls.flush).not.toHaveBeenCalled()
  expect(getUiLanguagePreference()).toBe('system')
})

it('keeps settings and language unchanged when conversation persistence fails', async () => {
  calls.flush.mockResolvedValueOnce(false)
  await mount()
  await choose('en')
  await save()
  expect(calls.flush).toHaveBeenCalledOnce()
  expect(calls.save).not.toHaveBeenCalled()
  expect(state.setSettings).not.toHaveBeenCalled()
  expect(getUiLanguagePreference()).toBe('system')
  expect(state.showToast).toHaveBeenCalledWith(expect.any(String), 'error')
})
