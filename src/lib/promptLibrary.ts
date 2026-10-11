import { initPromptStorage, getPromptStorageStatus, promptStorageCall, diskPrompts, savePromptSourcePreferences, type StoredPromptCatalog } from './promptStorage'
import { desktopApi, isLocalService } from './desktop'
import { fetchPromptSource, normalizePromptSource, PROMPT_SOURCES, promptImageUrl, type LibraryPrompt, type PromptSourceId } from './promptSources'

let imageRevision = 0
const imageListeners = new Set<() => void>()
export const getPromptImageRevision = () => imageRevision
export const subscribePromptImages = (listener: () => void) => { imageListeners.add(listener); return () => { imageListeners.delete(listener) } }

function createLibrary(source: typeof PROMPT_SOURCES[number]) {
  const CACHE_NAME = source.cache
  const CATALOG_URL = new URL('/__local_catalog__', source.home).href
  let cached: LibraryPrompt[] | undefined
  let pending: Promise<LibraryPrompt[]> | undefined
  let preloadTask: Promise<void> | undefined
  let controller: AbortController | undefined
  let status = { busy: '' as '' | 'loading' | 'preloading' | 'clearing', updatedAt: 0, imageCount: 0, itemCount: 0, done: 0, total: 0, failed: 0, scope: '', message: '', revision: 0, cleared: false }
  const listeners = new Set<() => void>()
  const getStatus = () => status
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  function updateStatus(patch: Partial<typeof status>) {
    status = { ...status, ...patch }
    listeners.forEach((listener) => listener())
  }
  async function openCache() {
    if (typeof caches === 'undefined') throw new Error('当前环境不支持本地缓存，请从桌面或本机网页打开。')
    return caches.open(CACHE_NAME)
  }

  function load(refresh = false): Promise<LibraryPrompt[]> {
    if (getPromptStorageStatus().busy) return Promise.reject(new Error('正在更换提示词保存位置，请等待复制完成。'))
    if (status.busy === 'clearing' || (refresh && preloadTask)) return Promise.reject(new Error('请先结束当前缓存操作。'))
    if (pending) return pending
    if (!refresh && cached) return Promise.resolve(cached)
    updateStatus({ busy: 'loading', message: '' })
    pending = (async () => {
      if ((await initPromptStorage()).directory) {
        let result = await promptStorageCall<StoredPromptCatalog>('catalog_read', { source: source.id })
        if (refresh || !result.catalog) {
          const raw = await fetchPromptSource(source.id, (message) => updateStatus({ message }))
          const items = [...new Map(normalizePromptSource(source.id, raw).map((item) => [item.id, item])).values()]
          if (!items.length) throw new Error('未读取到提示词，原文件已保留。')
          result = await promptStorageCall<StoredPromptCatalog>('catalog_write', { source: source.id, items, updatedAt: Date.now() })
        }
        const saved = result.catalog!
        const items = diskPrompts(saved)
        cached = items
        updateStatus({ updatedAt: saved.updatedAt, imageCount: result.images.length, itemCount: items.length, cleared: saved.cleared, message: saved.cleared ? `${source.name} 的本地缓存已清除，点击刷新可重新载入。` : refresh ? '目录已刷新，已有图片保留。' : '' })
        return items
      }
      const cache = await openCache()
      const stored = !refresh && await cache.match(CATALOG_URL)
      let data: unknown
      let updatedAt: number
      if (stored) {
        const snapshot = await stored.json()
        if (!snapshot || snapshot.items === undefined || !Number.isFinite(snapshot.updatedAt)) throw new Error(`${source.name} 的本地目录无法读取，请点击刷新。`)
        data = snapshot.items
        updatedAt = snapshot.updatedAt
        if (snapshot.cleared === true) {
          cached = []
          updateStatus({ cleared: true, updatedAt: 0, imageCount: 0, itemCount: 0 })
          return cached
        }
      } else {
        data = await fetchPromptSource(source.id, (message) => updateStatus({ message }))
        updatedAt = Date.now()
      }
      const items = [...new Map(normalizePromptSource(source.id, data).map((item) => [item.id, item])).values()]
      if (!items.length) throw new Error('未读取到提示词，请点击刷新。')
      if (!stored) await cache.put(CATALOG_URL, new Response(JSON.stringify({ items: data, updatedAt }), { headers: { 'Content-Type': 'application/json' } }))
      cached = items
      const imageCount = (await cache.keys()).filter((key) => key.url !== CATALOG_URL).length
      updateStatus({ updatedAt, imageCount, itemCount: items.length, cleared: false, message: refresh ? '目录已刷新，原有预载图片保留。' : '' })
      return items
    })().catch((err) => { updateStatus({ message: err instanceof Error ? err.message : `${source.name} 加载失败，请重试。` }); throw err }).finally(() => { pending = undefined; updateStatus({ busy: '' }) })
    return pending
  }

  function preload(category = ''): Promise<void> {
    if (getPromptStorageStatus().busy) return Promise.reject(new Error('正在更换提示词保存位置，请等待复制完成。'))
    if (preloadTask) return preloadTask
    if (pending || status.busy) return Promise.reject(new Error('请等待当前缓存操作完成。'))
    if (!isLocalService()) return Promise.reject(new Error('图片预载请使用桌面或本机网页入口。'))
    if (!cached?.length) return Promise.reject(new Error('请先刷新并载入提示词目录。'))
    const urls = [...new Set(cached.filter((item) => !category || (item.categories ?? [item.category]).includes(category)).flatMap((item) => item.previewUrl ? [item.previewUrl] : []))]
    const abort = new AbortController()
    controller = abort
    updateStatus({ busy: 'preloading', scope: category || '全部分类', done: 0, total: urls.length, failed: 0, message: '' })
    preloadTask = (async () => {
      const fileStorage = !!(await initPromptStorage()).directory
      const cache = fileStorage ? null : await openCache()
      const saved = new Set(fileStorage ? (await promptStorageCall<StoredPromptCatalog>('catalog_read', { source: source.id })).images : [])
      const api = await desktopApi()
      let index = 0
      let savedCount = status.imageCount
      await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
        while (!abort.signal.aborted && index < urls.length) {
          const url = urls[index++]
          try {
            if (!(fileStorage ? saved.has(url) : await cache!.match(url))) {
              const result = await api.download_prompt_image(url)
              if (abort.signal.aborted) break
              if (fileStorage) {
                await promptStorageCall('image_write', { source: source.id, url, dataUrl: result.dataUrl, category: cached!.find((item) => item.previewUrl === url)?.category || '未分类' })
              } else {
                const blob = await (await fetch(result.dataUrl)).blob()
                if (abort.signal.aborted) break
                await cache!.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }))
              }
              savedCount++
            }
            updateStatus({ done: status.done + 1, imageCount: savedCount })
          } catch (err) {
            if (abort.signal.aborted) break
            console.warn('Prompt image preload failed', err)
            updateStatus({ failed: status.failed + 1, done: status.done + 1 })
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
              abort.abort()
              updateStatus({ message: '本地存储空间不足，已保存的图片保留；请清理空间后继续。' })
            }
          }
        }
      }))
      if (!status.message || status.message.startsWith('正在停止')) updateStatus({ message: abort.signal.aborted ? '预载已取消，已保存的数据保留。' : status.failed ? `预载结束，${status.failed} 张未完成；再次预载会补齐缺失图片。` : `“${status.scope}”预载完成，可离线查看。` })
    })().catch((err) => { updateStatus({ message: err instanceof Error ? err.message : '预载失败，请重试。' }); throw err }).finally(() => {
      controller = undefined
      preloadTask = undefined
      imageRevision++
      imageListeners.forEach((listener) => listener())
      updateStatus({ busy: '', revision: status.revision + 1 })
    })
    return preloadTask
  }

  function cancel() {
    controller?.abort()
    updateStatus({ message: '正在停止预载，已保存的数据会保留。' })
  }

  async function clear() {
    if (getPromptStorageStatus().busy) throw new Error('正在更换提示词保存位置，请等待复制完成。')
    if (pending || preloadTask || status.busy) throw new Error('请先结束当前缓存操作。')
    updateStatus({ busy: 'clearing', message: '' })
    try {
      if ((await initPromptStorage()).directory) {
        await promptStorageCall('clear', { source: source.id })
        cached = []
        updateStatus({ updatedAt: 0, imageCount: 0, itemCount: 0, done: 0, total: 0, failed: 0, cleared: true, message: `${source.name} 的本地数据已清除，点击刷新可重新载入。` })
        return
      }
      const cache = await openCache()
      const results = await Promise.allSettled((await cache.keys()).filter((key) => key.url !== CATALOG_URL).map((key) => cache.delete(key)))
      const imageCount = (await cache.keys()).filter((key) => key.url !== CATALOG_URL).length
      updateStatus({ imageCount })
      if (results.some((result) => result.status === 'rejected')) throw new Error('部分预载图片清除失败，请重试。')
      await cache.put(CATALOG_URL, new Response(JSON.stringify({ items: [], updatedAt: 0, cleared: true }), { headers: { 'Content-Type': 'application/json' } }))
      cached = []
      updateStatus({ updatedAt: 0, imageCount: 0, itemCount: 0, done: 0, total: 0, failed: 0, cleared: true, message: `${source.name} 的本地缓存已清除，点击刷新可重新载入。` })
    } catch (err) {
      updateStatus({ message: err instanceof Error ? err.message : '清除失败，请重试。' })
      throw err
    } finally { imageRevision++; imageListeners.forEach((listener) => listener()); updateStatus({ busy: '', revision: status.revision + 1 }) }
  }

  const reset = () => { cached = undefined; updateStatus({ itemCount: 0, imageCount: 0, updatedAt: 0, cleared: false, message: '' }) }
  return { load, preload, cancel, clear, subscribe, getStatus, reset }
}

export const promptLibraries = Object.fromEntries(PROMPT_SOURCES.map((source) => [source.id, createLibrary(source)])) as Record<PromptSourceId, ReturnType<typeof createLibrary>>

export async function getCachedPromptImage(url: string): Promise<Blob | null> {
  if (!promptImageUrl(url)) return null
  if ((await initPromptStorage()).directory) {
    const result = await promptStorageCall<{ dataUrl: string | null }>('image_read', { url })
    return result.dataUrl ? (await fetch(result.dataUrl)).blob() : null
  }
  if (typeof caches === 'undefined') return null
  for (const source of PROMPT_SOURCES) {
    const response = await (await caches.open(source.cache)).match(url)
    if (response) return response.blob()
  }
  return null
}

export function getRemovedPromptSources(): PromptSourceId[] {
  try {
    const value = JSON.parse(localStorage.getItem('prompt-library-removed-v1') || '[]')
    return Array.isArray(value) ? PROMPT_SOURCES.filter((source) => value.includes(source.id)).map((source) => source.id) : []
  } catch (err) { console.warn('Prompt source preferences could not be read', err); return [] }
}

export function setRemovedPromptSources(ids: PromptSourceId[]) {
  return savePromptSourcePreferences(ids)
}

export function resetPromptLibraries() {
  Object.values(promptLibraries).forEach((library) => library.reset())
  imageRevision++
  imageListeners.forEach((listener) => listener())
}
