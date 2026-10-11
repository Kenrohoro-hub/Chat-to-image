import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { normalizeGardenPrompts } from './promptSources'

const bridge = vi.hoisted(() => ({ download: vi.fn(), read: vi.fn(), hero: vi.fn(), storage: vi.fn(), local: true }))
vi.mock('./desktop', () => ({ desktopApi: async () => ({ prompt_storage: bridge.storage, download_prompt_image: bridge.download, read_youmind_prompts: bridge.read, read_heroprompt_posts: bridge.hero }), isLocalService: () => bridge.local }))
const nativeFetch = globalThis.fetch
const records = [1, 2, 3, 4].map((id) => ({ id, title: `提示词${id}`, prompt: `正文${id}`, category: id === 4 ? '插画' : '摄影', image: `images/${id}.png` }))
let stores: Map<string, Map<string, Response>>
let entries: Map<string, Response>
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; keys: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
let network: ReturnType<typeof vi.fn>
beforeEach(() => {
  entries = new Map()
  cache = {
    match: vi.fn(async (url: string) => entries.get(url)?.clone()),
    put: vi.fn(async (url: string, response: Response) => { entries.set(url, response.clone()) }),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
  }
  stores = new Map([['prompt-library-shuixian-v1', entries]])
  vi.stubGlobal('caches', { open: vi.fn(async (name: string) => {
    if (name === 'prompt-library-shuixian-v1') return cache
    const data = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, data)
    return { match: async (url: string) => data.get(url)?.clone(), put: async (url: string, response: Response) => { data.set(url, response.clone()) }, keys: async () => [...data.keys()].map((url) => new Request(url)), delete: async (request: Request) => data.delete(request.url) }
  }) })
  network = vi.fn(async (url: string) => url.startsWith('data:') ? nativeFetch(url) : new Response(JSON.stringify(records)))
  vi.stubGlobal('fetch', network)
  bridge.local = true
  bridge.storage.mockReset().mockResolvedValue({ directory: '', preferences: null })
  bridge.hero.mockReset().mockResolvedValue({ prompts: [{ id: 'test', i18nContent: { en: { title: 'Hero', prompt: 'light' } } }], totalPages: 1 })
  bridge.read.mockReset().mockResolvedValue({ prompts: [{ id: 1, title: '参考图', content: '山水', media: ['https://cms-assets.youmind.com/media/1.png'] }], totalPages: 1 })
  bridge.download.mockReset().mockResolvedValue({ dataUrl: 'data:image/png;base64,aGVsbG8=' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.restoreAllMocks() })

it('validates website data and never accepts external preview paths', () => {
  expect(normalizeGardenPrompts([records[0], null, { ...records[0], prompt: '' }])).toEqual([expect.objectContaining({ id: 'garden-1', content: '正文1', previewUrl: 'https://r2.qqsrc.com/images/1.png' })])
  expect(normalizeGardenPrompts([{ ...records[0], image: 'https://evil.example/a' }, { ...records[0], image: 'images/../../a' }]).every((entry) => !entry.previewUrl)).toBe(true)
  expect(() => normalizeGardenPrompts({})).toThrow('格式')
})

it('restores the complete catalog after restart without fetching and refreshes explicitly', async () => {
  const first = (await import('./promptLibrary')).promptLibraries.garden
  expect(await first.load()).toHaveLength(4)
  vi.resetModules()
  const restarted = (await import('./promptLibrary')).promptLibraries.garden
  expect(await restarted.load()).toHaveLength(4)
  expect(network).toHaveBeenCalledTimes(3)
  await restarted.load(true)
  expect(network).toHaveBeenCalledTimes(6)
  network.mockResolvedValue(new Response('', { status: 503 }))
  await expect(restarted.load(true)).rejects.toThrow('503')
  expect(await restarted.load()).toHaveLength(4)
  vi.resetModules()
  expect(await ((await import('./promptLibrary')).promptLibraries.garden).load()).toHaveLength(4)
})

it('rejects malformed and empty refresh results while preserving old content', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  network.mockImplementation(async () => new Response('[]'))
  await expect(garden.load(true)).rejects.toThrow('空目录')
  expect(await garden.load()).toHaveLength(4)
})

it('preloads only the selected category, skips saved images, and completes all on demand', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  await garden.preload('插画')
  expect(bridge.download.mock.calls.map(([url]) => url)).toEqual(['https://r2.qqsrc.com/images/4.png'])
  expect(await (await import('./promptLibrary')).getCachedPromptImage('https://r2.qqsrc.com/images/4.png')).toBeInstanceOf(Blob)
  await garden.preload()
  expect(bridge.download).toHaveBeenCalledTimes(4)
  expect(garden.getStatus()).toMatchObject({ busy: '', imageCount: 4, done: 4, failed: 0 })
})

it('preserves partial successes and retries only failed images', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  bridge.download.mockRejectedValueOnce(new Error('offline'))
  await garden.preload('摄影')
  expect(garden.getStatus()).toMatchObject({ imageCount: 2, failed: 1 })
  await garden.preload('摄影')
  expect(bridge.download).toHaveBeenCalledTimes(4)
  expect(garden.getStatus()).toMatchObject({ imageCount: 3, failed: 0 })
})

it('cancels in-flight work, prevents overlap, and resumes later', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  let release!: (value: { dataUrl: string }) => void
  bridge.download.mockImplementation(() => new Promise((resolve) => { release = resolve }))
  const pending = garden.preload('插画')
  await vi.waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1))
  await expect(garden.clear()).rejects.toThrow('当前')
  await expect(garden.load(true)).rejects.toThrow('当前')
  garden.cancel()
  release({ dataUrl: 'data:image/png;base64,aGVsbG8=' })
  await pending
  expect(garden.getStatus()).toMatchObject({ busy: '', imageCount: 0, message: '预载已取消，已保存的数据保留。' })
  bridge.download.mockResolvedValue({ dataUrl: 'data:image/png;base64,aGVsbG8=' })
  await garden.preload('插画')
  expect(garden.getStatus().imageCount).toBe(1)
})

it('reports exhausted storage and keeps the catalog', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  cache.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
  await garden.preload('插画')
  expect(garden.getStatus().message).toContain('空间不足')
  expect(await garden.load()).toHaveLength(4)
})

it('clears only its own cache and does not redownload on reopening until refresh', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  await garden.preload('插画')
  await garden.clear()
  expect(entries.size).toBe(1)
  expect(garden.getStatus()).toMatchObject({ cleared: true, imageCount: 0 })
  network.mockClear()
  vi.resetModules()
  const restarted = (await import('./promptLibrary')).promptLibraries.garden
  expect(await restarted.load()).toEqual([])
  expect(network).not.toHaveBeenCalled()
  expect(await restarted.load(true)).toHaveLength(4)
  expect(vi.mocked(caches.open).mock.calls.every(([name]) => name === 'prompt-library-shuixian-v1')).toBe(true)
})

it('explains the local-entry requirement instead of claiming image preload succeeded', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  bridge.local = false
  await expect(garden.preload()).rejects.toThrow('本机网页')
  expect(bridge.download).not.toHaveBeenCalled()
})

it('reports partial clearing failure without losing the catalog and can retry', async () => {
  const garden = (await import('./promptLibrary')).promptLibraries.garden
  await garden.load()
  await garden.preload('插画')
  cache.delete.mockRejectedValueOnce(new Error('disk'))
  await expect(garden.clear()).rejects.toThrow('清除失败')
  expect(garden.getStatus()).toMatchObject({ busy: '', cleared: false, imageCount: 1 })
  expect(await garden.load()).toHaveLength(4)
  await garden.clear()
  expect(garden.getStatus()).toMatchObject({ cleared: true, imageCount: 0 })
})

it('isolates three sites across preload, clear and restart', async () => {
  const fill = { templates: { config: [{ id: 'a', name: '填空', content: '{{color}}', tags: ['摄影', '产品'], imageUrl: 'https://s3.bmp.ovh/imgs/1.png' }] }, banks: { defaults: { color: '红色' } } }
  network.mockImplementation(async (url: string) => url.startsWith('data:') ? nativeFetch(url) : new Response(JSON.stringify(url.includes('/templates.json') ? fill.templates : url.includes('/banks.json') ? fill.banks : records)))
  const { promptLibraries, getCachedPromptImage } = await import('./promptLibrary')
  await Promise.all(['garden', 'promptfill', 'youmind'].map((id) => promptLibraries[id as keyof typeof promptLibraries].load()))
  await promptLibraries.promptfill.preload('产品')
  await promptLibraries.youmind.preload()
  expect(bridge.download).toHaveBeenCalledTimes(2)
  await promptLibraries.garden.clear()
  expect(await getCachedPromptImage('https://s3.bmp.ovh/imgs/1.png')).toBeInstanceOf(Blob)
  network.mockClear()
  bridge.read.mockClear()
  vi.resetModules()
  const restarted = (await import('./promptLibrary')).promptLibraries
  expect(await restarted.garden.load()).toEqual([])
  expect((await restarted.promptfill.load())[0].content).toBe('红色')
  expect(await restarted.youmind.load()).toHaveLength(1)
  expect(network).not.toHaveBeenCalled()
  expect(bridge.read).not.toHaveBeenCalled()
  await restarted.promptfill.clear()
  expect(stores.get('prompt-library-youmind-v1')!.size).toBe(2)
})

it('loads all YouMind pages despite short pages and preserves cached data on a failed refresh', async () => {
  bridge.read.mockImplementation(async (page: number) => ({ prompts: [{ id: page, title: `页${page}`, content: '正文' }], totalPages: 4 }))
  const site = (await import('./promptLibrary')).promptLibraries.youmind
  expect((await site.load()).map((item) => item.id)).toEqual(['youmind-1', 'youmind-2', 'youmind-3', 'youmind-4'])
  bridge.read.mockRejectedValueOnce(new Error('连接失败'))
  await expect(site.load(true)).rejects.toThrow('连接失败')
  expect(await site.load()).toHaveLength(4)
})

it('persists library removal without deleting other libraries and restores an empty entry', async () => {
  const { getRemovedPromptSources, setRemovedPromptSources } = await import('./promptLibrary')
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value) } })
  const site = (await import('./promptLibrary')).promptLibraries.garden
  await site.load()
  await site.clear()
  await setRemovedPromptSources(['garden'])
  vi.resetModules()
  expect(getRemovedPromptSources()).toEqual(['garden'])
  const restarted = await import('./promptLibrary')
  expect(restarted.getRemovedPromptSources()).toEqual(['garden'])
  await setRemovedPromptSources([])
  expect(await restarted.promptLibraries.garden.load()).toEqual([])
  saved.set('prompt-library-removed-v1', JSON.stringify(['unknown', 'garden', 'garden']))
  expect(getRemovedPromptSources()).toEqual(['garden'])
})

it('paginates Pixto and Hero catalogs and keeps distinct Nano model caches', async () => {
  network.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('web-styles') ? { code: 0, data: { current_page: Number(new URL(url).searchParams.get('page')), last_page: 2, data: [{ id: Number(new URL(url).searchParams.get('page')), name: '风格', pre_prompt: '柔光' }] } } : [{ id: 'same', title: '海报', prompt: '纸质海报' }])))
  bridge.hero.mockImplementation(async (page: number) => ({ prompts: [{ id: `hero-${page}`, i18nContent: { en: { title: 'Hero', prompt: 'light' } } }], totalPages: 2 }))
  const sites = (await import('./promptLibrary')).promptLibraries
  expect(await sites.pixto.load()).toHaveLength(2)
  expect(await sites.hero.load()).toHaveLength(2)
  expect((await sites.nano.load())[0].id).toBe('nano-same')
  expect((await sites.nanoimage.load())[0].id).toBe('nanoimage-same')
  await sites.nanoimage.clear()
  vi.resetModules()
  const restarted = (await import('./promptLibrary')).promptLibraries
  expect(await restarted.nanoimage.load()).toEqual([])
  expect(await restarted.nano.load()).toHaveLength(1)
})


it('uses file catalogs and images without refetching, and preserves them on refresh failure', async () => {
  const items = normalizeGardenPrompts(records)
  const snapshot = { items, updatedAt: 10, cleared: false, revision: 'r1' }
  bridge.storage.mockImplementation(async (action: string) => {
    if (action === 'status') return { directory: 'C:/test/提示词库', preferences: null }
    if (action === 'catalog_read') return { catalog: snapshot, images: ['https://r2.qqsrc.com/images/4.png'] }
    if (action === 'image_read') return { dataUrl: 'data:image/png;base64,aGVsbG8=' }
    return { ok: true }
  })
  const { promptLibraries, getCachedPromptImage } = await import('./promptLibrary')
  expect(await promptLibraries.garden.load()).toHaveLength(4)
  expect(network).not.toHaveBeenCalled()
  await promptLibraries.garden.preload('插画')
  expect(bridge.download).not.toHaveBeenCalled()
  expect(await getCachedPromptImage('https://r2.qqsrc.com/images/4.png')).toBeInstanceOf(Blob)
  network.mockRejectedValue(new Error('offline'))
  await expect(promptLibraries.garden.load(true)).rejects.toThrow('offline')
  expect(await promptLibraries.garden.load()).toHaveLength(4)
  await promptLibraries.garden.clear()
  expect(bridge.storage).toHaveBeenCalledWith('clear', { source: 'garden', directory: 'C:/test/提示词库' })
  expect(await promptLibraries.garden.load()).toEqual([])
})
