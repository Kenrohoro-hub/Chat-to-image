import type { PromptTemplate } from '../types'
import { promptExampleVersion } from './promptExamples'
import { desktopApi, isLocalService } from './desktop'
import { normalizePromptTemplates, normalizePersonalPromptLibrary } from './promptTemplates'
import type { LibraryPrompt, PromptSourceId } from './promptSources'

export interface PromptStorageStatus { directory: string; ready: boolean; busy: boolean; message: string; error: string }
export interface PromptCatalog { items: PromptTemplate[]; promptCategories?: string[]; updatedAt: number; cleared: boolean; revision: string; examplesAdded?: boolean; examplesVersion?: number }
export interface StoredPromptCatalog { catalog: PromptCatalog | null; images: string[] }
export interface PromptStorageLocation { directory: string; message?: string; preferences: { removed: PromptSourceId[]; examplesAdded: boolean; examplesVersion?: number } | null }
let status: PromptStorageStatus = { directory: '', ready: false, busy: false, message: '', error: '' }
let initializing: Promise<PromptStorageStatus> | undefined
let personalRevision = ''
let personalWrites = 0
let personalQueue: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()
export const getPromptStorageStatus = () => status
export const subscribePromptStorage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const hasPersonalPromptWrites = () => personalWrites > 0
export function updatePromptStorage(patch: Partial<PromptStorageStatus>) { status = { ...status, ...patch }; listeners.forEach((listener) => listener()) }

export function initPromptStorage(): Promise<PromptStorageStatus> {
  if (!initializing) initializing = (async () => {
    const location = isLocalService() ? await (await desktopApi()).prompt_storage('status', {}) as PromptStorageLocation : { directory: '', preferences: null }
    if (location.preferences) localStorage.setItem('prompt-library-removed-v1', JSON.stringify(location.preferences.removed))
    updatePromptStorage({ directory: location.directory, ready: true, error: '' })
    return status
  })().catch((err) => { updatePromptStorage({ ready: true, error: err instanceof Error ? err.message : '提示词保存位置无法读取。' }); throw err })
  return initializing
}

export async function promptStorageCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  await initPromptStorage()
  if (status.error) throw new Error(status.error)
  return (await desktopApi()).prompt_storage(action, { ...payload, directory: status.directory }) as Promise<T>
}

export function ensurePromptStorageIdle() {
  if (status.busy) throw new Error('正在更换提示词保存位置，请等待复制完成。')
}

export function diskPrompts(catalog: PromptCatalog): LibraryPrompt[] {
  const items = normalizePromptTemplates(catalog.items)
  if (items.length !== catalog.items.length) throw new Error('提示词文件中有无效条目，原文件已保留。')
  return items.map((item) => ({ ...item, category: item.category || '未分类' }))
}

export async function loadPersonalPromptStorage() {
  const current = await initPromptStorage()
  if (!current.directory) return null
  const result = await promptStorageCall<StoredPromptCatalog>('catalog_read', { source: 'personal' })
  if (!result.catalog) throw new Error('个人提示词文件缺失，已保留当前入口的数据，请检查保存位置。')
  const items = normalizePromptTemplates(result.catalog.items)
  if (items.length !== result.catalog.items.length) throw new Error('个人提示词文件格式错误，未覆盖当前入口数据。')
  personalRevision = result.catalog.revision
  if (result.catalog.examplesVersion) localStorage.setItem('prompt-examples-version', String(result.catalog.examplesVersion))
  else localStorage.removeItem('prompt-examples-version')
  if (result.catalog.examplesAdded) localStorage.setItem('prompt-examples-added-v1', '1')
  else localStorage.removeItem('prompt-examples-added-v1')
  return normalizePersonalPromptLibrary(items, result.catalog.promptCategories)
}

export function savePersonalPromptChange(getItems: () => PromptTemplate[], apply: (items: PromptTemplate[], categories: string[]) => void, getCategories: () => string[] | undefined = () => undefined): Promise<boolean> {
  personalWrites++
  const work = personalQueue.catch(() => undefined).then(async () => {
    const current = await initPromptStorage()
    ensurePromptStorageIdle()
    const personal = normalizePersonalPromptLibrary(getItems(), getCategories())
    const items = personal.promptTemplates
    if (current.directory) {
      const result = await promptStorageCall<StoredPromptCatalog>('catalog_write', { source: 'personal', items, promptCategories: personal.promptCategories, updatedAt: Date.now(), revision: personalRevision, examplesAdded: localStorage.getItem('prompt-examples-added-v1') === '1' || items.some((item) => item.id.startsWith('example-')), examplesVersion: Math.max(Number(localStorage.getItem('prompt-examples-version')) || 0, items.reduce((version, item) => Math.max(version, promptExampleVersion(item)), 0)) })
      personalRevision = result.catalog!.revision
    }
    apply(items, personal.promptCategories)
    return true
  }).finally(() => { personalWrites-- })
  personalQueue = work
  return work
}

export async function savePromptSourcePreferences(removed: PromptSourceId[]) {
  ensurePromptStorageIdle()
  const current = await initPromptStorage()
  if (current.directory) await promptStorageCall('preferences', { preferences: { removed, examplesAdded: localStorage.getItem('prompt-examples-added-v1') === '1', examplesVersion: Number(localStorage.getItem('prompt-examples-version')) || 0 } })
  localStorage.setItem('prompt-library-removed-v1', JSON.stringify(removed))
}

export function activatePromptDirectory(location: PromptStorageLocation, revision: string) {
  personalRevision = revision
  if (location.preferences?.examplesVersion) localStorage.setItem('prompt-examples-version', String(location.preferences.examplesVersion))
  else localStorage.removeItem('prompt-examples-version')
  if (location.preferences?.examplesAdded) localStorage.setItem('prompt-examples-added-v1', '1')
  else localStorage.removeItem('prompt-examples-added-v1')
  if (location.preferences) localStorage.setItem('prompt-library-removed-v1', JSON.stringify(location.preferences.removed))
  updatePromptStorage({ directory: location.directory, ready: true, busy: false, error: '', message: location.message || '保存位置已切换，旧位置的数据保留。' })
  initializing = Promise.resolve(status)
}
