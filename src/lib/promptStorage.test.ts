// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PromptTemplate } from '../types'

const mock = vi.hoisted(() => ({ call: vi.fn(), personal: [] as unknown[], categories: ['默认', '漫画', 'agnet形象'], busy: false }))
vi.mock('./desktop', () => ({ isLocalService: () => true, desktopApi: async () => ({ prompt_storage: mock.call }) }))
vi.mock('../store', () => ({ useStore: { getState: () => ({ promptTemplates: mock.personal, promptCategories: mock.categories }), setState: vi.fn() } }))
vi.mock('./promptLibrary', () => ({ promptLibraries: { garden: { getStatus: () => ({ busy: mock.busy }) } }, resetPromptLibraries: vi.fn(), getRemovedPromptSources: () => [] }))
const item = { id: 'personal-1', title: '收藏', content: '柔光', category: '默认', createdAt: 0, updatedAt: 0 }
beforeEach(() => { localStorage.clear(); mock.personal = [item]; mock.categories = ['默认', '漫画', 'agnet形象']; mock.busy = false; mock.call.mockReset() })
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

it('serializes personal writes and keeps items and categories when a queued write fails', async () => {
  const categories = ['漫画', '默认', '空分类']
  mock.call.mockImplementation(async (action: string) => action === 'status' ? { directory: 'C:/old', preferences: null } : { catalog: { items: [item], promptCategories: categories, revision: 'r1', updatedAt: 0 }, images: [] })
  const storage = await import('./promptStorage')
  let saved: { promptTemplates: PromptTemplate[]; promptCategories: string[] } = (await storage.loadPersonalPromptStorage())!
  expect(saved.promptCategories).toEqual(categories)
  mock.call.mockRejectedValueOnce(new Error('disk full'))
  await expect(storage.savePersonalPromptChange(() => [], (items, promptCategories) => { saved = { promptTemplates: items, promptCategories } }, () => saved.promptCategories)).rejects.toThrow('disk full')
  expect(saved.promptTemplates).toEqual([item])
  expect(saved.promptCategories).toEqual(categories)
  mock.call.mockResolvedValue({ catalog: { revision: 'r2' }, images: [] })
  const first = storage.savePersonalPromptChange(() => [...saved.promptTemplates, { ...item, id: 'two' }], (items, promptCategories) => { saved = { promptTemplates: items, promptCategories } }, () => saved.promptCategories)
  const second = storage.savePersonalPromptChange(() => [...saved.promptTemplates, { ...item, id: 'three' }], (items, promptCategories) => { saved = { promptTemplates: items, promptCategories } }, () => saved.promptCategories)
  await Promise.all([first, second])
  expect(saved.promptTemplates.map((entry) => entry.id)).toEqual(['personal-1', 'two', 'three'])
  expect(saved.promptCategories).toEqual(categories)
  expect(mock.call.mock.lastCall![1].revision).toBe('r2')
})

it('loads and saves empty personal categories with the catalog', async () => {
  const promptCategories = ['默认', '空分类']
  mock.call.mockImplementation(async (action: string) => action === 'status' ? { directory: 'C:/old', preferences: null } : { catalog: { items: [], promptCategories, revision: 'r1', updatedAt: 0 }, images: [] })
  const storage = await import('./promptStorage')
  const personal = await storage.loadPersonalPromptStorage()
  expect(personal).toEqual({ promptTemplates: [], promptCategories })
  await storage.savePersonalPromptChange(() => personal!.promptTemplates, () => {}, () => personal!.promptCategories)
  expect(mock.call.mock.lastCall![1].promptCategories).toEqual(promptCategories)
  expect(mock.call.mock.lastCall![1].items).toEqual([])
})

it('activates a copied directory only after commit and aborts failed copies', async () => {
  mock.call.mockImplementation(async (action: string) => {
    if (action === 'status') return { directory: '', preferences: null }
    if (action === 'prepare') return { migration: 'token', directory: 'C:/new/提示词库', temporaryDirectory: 'C:/new/temp' }
    if (action === 'catalog_write') return { catalog: { revision: 'r2' }, images: [] }
    if (action === 'commit') throw new Error('full')
    return { ok: true }
  })
  const { changePromptDirectory } = await import('./promptStorageMigration')
  const storage = await import('./promptStorage')
  await expect(changePromptDirectory('C:/new')).rejects.toThrow('full')
  expect(storage.getPromptStorageStatus()).toMatchObject({ directory: '', busy: false })
  expect(mock.call).toHaveBeenCalledWith('abort', { migration: 'token' })
  mock.call.mockImplementation(async (action: string) => {
    if (action === 'prepare') return { migration: 'token', directory: 'C:/new/提示词库' }
    if (action === 'catalog_write') return { catalog: { revision: 'r2' } }
    if (action === 'commit') return { directory: 'C:/new/提示词库', preferences: { removed: [], examplesAdded: false } }
  })
  await changePromptDirectory('C:/new')
  expect(storage.getPromptStorageStatus()).toMatchObject({ directory: 'C:/new/提示词库', busy: false })
  mock.busy = true
  await expect(changePromptDirectory('C:/other')).rejects.toThrow('等待')
})


it('moves the latest disk personal catalog instead of overwriting it with stale window state', async () => {
  mock.personal = []
  mock.call.mockImplementation(async (action: string) => {
    if (action === 'status') return { directory: 'C:/old', preferences: null }
    if (action === 'prepare') return { migration: 'token', directory: 'C:/new' }
    if (action === 'catalog_read') return { catalog: { items: [item], promptCategories: ['默认', '迁移空类'], revision: 'latest' }, images: [] }
    if (action === 'commit') return { directory: 'C:/new', preferences: { removed: [], examplesAdded: true } }
    throw new Error('unexpected write')
  })
  const { changePromptDirectory } = await import('./promptStorageMigration')
  await changePromptDirectory('C:/new')
  expect(mock.call.mock.calls.some(([action]) => action === 'catalog_write')).toBe(false)
  const { useStore } = await import('../store')
  expect(useStore.setState).toHaveBeenLastCalledWith({ promptTemplates: [expect.objectContaining(item)], promptCategories: ['默认', '迁移空类'] })
})


it('restores the example version from disk and preserves it after all examples are deleted', async () => {
  mock.call.mockImplementation(async (action: string) => action === 'status' ? { directory: 'C:/old', preferences: null } : { catalog: { items: [], revision: 'r1', updatedAt: 0, examplesAdded: true, examplesVersion: 2 }, images: [] })
  const storage = await import('./promptStorage')
  await storage.loadPersonalPromptStorage()
  expect(localStorage.getItem('prompt-examples-version')).toBe('2')
  await storage.savePersonalPromptChange(() => [], () => {})
  expect(mock.call.mock.lastCall![1]).toMatchObject({ items: [], examplesVersion: 2 })
  storage.activatePromptDirectory({ directory: 'C:/other', preferences: { removed: [], examplesAdded: true } }, 'r2')
  expect(localStorage.getItem('prompt-examples-version')).toBeNull()
})

it('does not mark the new pack installed when saving only older examples', async () => {
  mock.call.mockImplementation(async (action: string) => action === 'status' ? { directory: 'C:/old', preferences: null } : { catalog: { revision: 'r1' } })
  const storage = await import('./promptStorage')
  await storage.savePersonalPromptChange(() => [{ ...item, id: 'example-curated-01' }], () => {})
  expect(mock.call.mock.lastCall![1].examplesVersion).toBe(2)
  await storage.savePersonalPromptChange(() => [{ ...item, id: 'example-zipzippipe-01' }], () => {})
  expect(mock.call.mock.lastCall![1].examplesVersion).toBe(3)
  await storage.savePersonalPromptChange(() => [{ ...item, id: 'example-ai-comic-01' }], () => {})
  expect(mock.call.mock.lastCall![1].examplesVersion).toBe(4)
})
