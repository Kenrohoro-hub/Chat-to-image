// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ call: vi.fn(), personal: [] as unknown[], busy: false }))
vi.mock('./desktop', () => ({ isLocalService: () => true, desktopApi: async () => ({ prompt_storage: mock.call }) }))
vi.mock('../store', () => ({ useStore: { getState: () => ({ promptTemplates: mock.personal }), setState: vi.fn() } }))
vi.mock('./promptLibrary', () => ({ promptLibraries: { garden: { getStatus: () => ({ busy: mock.busy }) } }, resetPromptLibraries: vi.fn(), getRemovedPromptSources: () => [] }))
const item = { id: 'personal-1', title: '收藏', content: '柔光', createdAt: 0, updatedAt: 0 }
beforeEach(() => { localStorage.clear(); mock.personal = [item]; mock.busy = false; mock.call.mockReset() })
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

it('serializes personal writes and keeps the last saved state when a write fails', async () => {
  mock.call.mockImplementation(async (action: string) => action === 'status' ? { directory: 'C:/old', preferences: null } : { catalog: { items: [item], revision: 'r1', updatedAt: 0 }, images: [] })
  const storage = await import('./promptStorage')
  let saved = (await storage.loadPersonalPromptStorage())!
  mock.call.mockRejectedValueOnce(new Error('disk full'))
  await expect(storage.savePersonalPromptChange(() => [], (items) => { saved = items })).rejects.toThrow('disk full')
  expect(saved).toEqual([item])
  mock.call.mockResolvedValue({ catalog: { revision: 'r2' }, images: [] })
  const first = storage.savePersonalPromptChange(() => [...saved, { ...item, id: 'two' }], (items) => { saved = items })
  const second = storage.savePersonalPromptChange(() => [...saved, { ...item, id: 'three' }], (items) => { saved = items })
  await Promise.all([first, second])
  expect(saved.map((entry) => entry.id)).toEqual(['personal-1', 'two', 'three'])
  expect(mock.call.mock.lastCall![1].revision).toBe('r2')
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
    if (action === 'catalog_read') return { catalog: { items: [item], revision: 'latest' }, images: [] }
    if (action === 'commit') return { directory: 'C:/new', preferences: { removed: [], examplesAdded: true } }
    throw new Error('unexpected write')
  })
  const { changePromptDirectory } = await import('./promptStorageMigration')
  await changePromptDirectory('C:/new')
  expect(mock.call.mock.calls.some(([action]) => action === 'catalog_write')).toBe(false)
  const { useStore } = await import('../store')
  expect(useStore.setState).toHaveBeenLastCalledWith({ promptTemplates: [expect.objectContaining(item)] })
})
