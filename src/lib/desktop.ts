import { getUiLanguage, t } from './i18n'
import type { AppSettings, TaskParams } from '../types'
import type { CallApiResult } from './imageApiShared'

interface DesktopResult extends CallApiResult {
  ok: boolean
  warnings: string[]
  usedProfile?: { id: string; name: string; model: string }
  error?: { message: string }
}

export type AgentConnectionAction = 'status' | 'connect' | 'update' | 'disconnect'

export interface AgentConnectionStatus {
  ok: boolean
  runtime_ready: boolean
  command: string[]
  manual_command: string[]
  targets: {
    id: 'codex' | 'claude' | 'cursor' | 'deepseek-harness'
    label: string
    path: string
    status: 'missing' | 'connected' | 'stale' | 'modified' | 'conflict' | 'error'
    message: string
    invocation: string[]
  }[]
  result?: { ok: boolean; changed: boolean; backup: string; target: string } | null
}

interface DesktopApi {
  set_ui_language(language: 'zh-CN' | 'en'): Promise<void>
  prompt_storage(action: string, payload: Record<string, unknown>): Promise<unknown>
  choose_prompt_directory(): Promise<string | null>
  read_heroprompt_posts(page: number): Promise<{ prompts: unknown[]; totalPages: number }>
  read_youmind_prompts(page: number): Promise<{ prompts: unknown[]; totalPages: number }>
  download_prompt_image(url: string): Promise<{ dataUrl: string }>
  agent_connections(action: AgentConnectionAction, target?: string): Promise<AgentConnectionStatus>
  cancel_generation(requestId: string): Promise<{ ok: boolean }>
  list_models(profileId: string | Pick<import('../types').ApiProfile, 'baseUrl' | 'apiKey'>): Promise<NonNullable<import('../types').ApiProfile['modelCatalog']>>
  load_settings(): Promise<SettingsSnapshot>
  recover_settings(revision: string): Promise<{ ok: boolean; revision: string }>
  save_settings(settings: AppSettings, revision: string): Promise<{ ok: boolean; revision: string }>
  status(): Promise<{ running: number; revision: string; lastUsedId?: string; failed: Record<string, number>; events: { profileId: string; ok: boolean; reason: string; time: number }[] }>
  reset_routes(): Promise<{ ok: boolean }>
  generate(value: { requestId?: string; profileId: string; model?: string; prompt: string; params: TaskParams; inputImageDataUrls: string[]; maskDataUrl?: string; nativeTransparentBackground?: boolean }): Promise<DesktopResult>
}

export interface SettingsSnapshot {
  settings: Partial<AppSettings> | null
  revision: string
  error?: string
}

declare global {
  interface Window {
    __PLAYGROUND_DESKTOP__?: boolean
    __PLAYGROUND_LOCAL__?: boolean
    pywebview?: { api: DesktopApi }
  }
}

export const isDesktop = () => typeof window !== 'undefined' && window.__PLAYGROUND_DESKTOP__ === true
export const isLocalService = () => isDesktop() || (typeof window !== 'undefined' && window.__PLAYGROUND_LOCAL__ === true)

let token = ''

async function localCall<T>(method: string, args: unknown[], retry = true): Promise<T> {
  if (!token) {
    const response = await fetch('/__local/session', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(t('无法连接本机服务，请重新打开网页。', 'Cannot connect to the local service. Reopen the page.'))
    token = (await response.json()).token
  }
  const response = await fetch('/__local/api', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Sync': token, 'X-Playground-Language': getUiLanguage() },
    body: JSON.stringify({ method, args }),
    signal: method === 'generate' ? undefined : AbortSignal.timeout(method === 'prompt_storage' ? 600000 : method === 'list_models' ? 25000 : ['read_youmind_prompts', 'read_heroprompt_posts'].includes(method) ? 45000 : 15000),
  })
  if (response.status === 403 && retry) {
    token = ''
    return localCall(method, args, false)
  }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || t('本机服务请求失败，请重试。', 'Local service request failed. Try again.'))
  return result
}

const localApi: DesktopApi = {
  set_ui_language: () => Promise.resolve(),
  prompt_storage: (action, payload) => localCall('prompt_storage', [action, payload]),
  choose_prompt_directory: () => Promise.reject(new Error(t('请从桌面窗口选择目录，或手动填写路径。', 'Choose a folder in the desktop window, or enter a path manually.'))),
  read_heroprompt_posts: (page) => localCall('read_heroprompt_posts', [page]),
  read_youmind_prompts: (page) => localCall('read_youmind_prompts', [page]),
  download_prompt_image: (url) => localCall('download_prompt_image', [url]),
  agent_connections: () => Promise.reject(new Error(t('请在桌面窗口管理 Agent 连接。', 'Manage Agent connections in the desktop window.'))),
  load_settings: () => localCall('load_settings', []),
  recover_settings: (revision) => localCall('recover_settings', [revision]),
  save_settings: (settings, revision) => localCall('save_settings', [settings, revision]),
  status: () => localCall('status', []),
  reset_routes: () => localCall('reset_routes', []),
  list_models: (profile) => localCall('list_models', [profile]),
  generate: (value) => localCall('generate', [value]),
  cancel_generation: (requestId) => localCall('cancel_generation', [requestId]),
}

export function usesDesktopPool(settings: AppSettings, profileId: string) {
  return isLocalService() && Boolean(settings.failover?.slots.includes(profileId))
}

export async function desktopApi(): Promise<DesktopApi> {
  if (!isLocalService()) throw new Error(t('请从桌面或本机网页入口打开。', 'Open the app through the desktop or local browser entry.'))
  if (!isDesktop()) return localApi
  if (typeof window.pywebview?.api?.load_settings === 'function') {
    await window.pywebview.api.set_ui_language(getUiLanguage())
    return window.pywebview.api
  }
  await new Promise<void>((resolve, reject) => {
    const ready = () => { clearTimeout(timer); resolve() }
    const timer = window.setTimeout(() => {
      window.removeEventListener('pywebviewready', ready)
      reject(new Error(t('桌面连接未就绪，请关闭窗口后重新打开。', 'The desktop connection is not ready. Close and reopen the window.')))
    }, 15000)
    window.addEventListener('pywebviewready', ready, { once: true })
  })
  if (typeof window.pywebview?.api?.load_settings !== 'function') throw new Error(t('无法连接桌面服务。', 'Cannot connect to the desktop service.'))
  await window.pywebview.api.set_ui_language(getUiLanguage())
  return window.pywebview.api
}

let ready = false
let saveQueue: Promise<unknown> = Promise.resolve()
let savedSettings = ''
let revision = ''
let pendingSaves = 0
let applying = false
export let desktopSaveError = ''

export function allowDesktopSave(snapshot: SettingsSnapshot, settings: AppSettings) {
  if (snapshot.error) throw new Error(snapshot.error)
  revision = snapshot.revision
  savedSettings = snapshot.revision === '0' ? '' : JSON.stringify(settings)
  ready = true
}

export function getSettingsRevision() { return revision }

export async function syncDesktopSettings(nextRevision: string, apply: (settings: Partial<AppSettings>) => AppSettings) {
  if (!ready || pendingSaves || revision === nextRevision) return
  const currentRevision = revision
  const snapshot = await (await desktopApi()).load_settings()
  if (snapshot.error) throw new Error(snapshot.error)
  if (pendingSaves || revision !== currentRevision || !snapshot.settings || revision === snapshot.revision) return
  applying = true
  try {
    savedSettings = JSON.stringify(apply(snapshot.settings))
    revision = snapshot.revision
    desktopSaveError = ''
    saveQueue = Promise.resolve()
    window.dispatchEvent(new Event('playground-settings-status'))
  } finally { applying = false }
}

export function saveDesktopSettings(settings: AppSettings, expectedRevision?: string) {
  if (applying) return Promise.resolve()
  if (!ready) return Promise.reject(new Error(t('桌面设置尚未加载，未覆盖已有配置。', 'Desktop settings have not loaded. Existing settings were not overwritten.')))
  const body = JSON.stringify(settings)
  pendingSaves++
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    try {
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new Error(t('配置已在另一窗口更新。当前草稿已保留；请关闭设置后重新打开，再应用修改。', 'Settings changed in another window. Your draft is preserved. Close and reopen settings before applying changes.'))
      }
      if (body !== savedSettings) {
        const result = await (await desktopApi()).save_settings(settings, expectedRevision ?? revision)
        if (!result.ok) throw new Error(t('本机设置保存失败。', 'Could not save local settings.'))
        revision = result.revision
        savedSettings = body
      }
      desktopSaveError = ''
    } catch (error) {
      desktopSaveError = error instanceof Error ? error.message : t('设置未保存到本机，请重试。', 'Settings were not saved locally. Try again.')
      throw new Error(desktopSaveError)
    } finally {
      pendingSaves--
      window.dispatchEvent(new Event('playground-settings-status'))
    }
  })
  return saveQueue
}

export async function flushDesktopSettings() {
  if (!ready) throw new Error(t('桌面设置尚未加载，请重新打开窗口。', 'Desktop settings have not loaded. Reopen the window.'))
  await saveQueue
  if (desktopSaveError) throw new Error(desktopSaveError)
}
