import { useStore } from '../store'
import { desktopApi } from './desktop'
import { blobToDataUrl } from './dataUrl'
import { PROMPT_SOURCES, normalizePromptSource, promptImageUrl } from './promptSources'
import { promptLibraries, resetPromptLibraries, getRemovedPromptSources } from './promptLibrary'
import { diskPrompts, activatePromptDirectory, hasPersonalPromptWrites, initPromptStorage, updatePromptStorage, getPromptStorageStatus, type PromptStorageLocation, type StoredPromptCatalog } from './promptStorage'

export async function changePromptDirectory(directory: string, cleanPrevious = false) {
  await initPromptStorage()
  if (getPromptStorageStatus().busy || hasPersonalPromptWrites() || Object.values(promptLibraries).some((library) => library.getStatus().busy)) throw new Error('请等待提示词保存、刷新或预载完成后再更换位置。')
  const previous = getPromptStorageStatus().directory
  const api = await desktopApi()
  updatePromptStorage({ busy: true, message: '正在复制已有提示词文件，请勿关闭工具…' })
  let pending: { migration: string; directory: string; temporaryDirectory: string } | undefined
  try {
    pending = await api.prompt_storage('prepare', { directory }) as typeof pending
    const migration = pending!.migration
    const categories = new Map<string, { category: string; categories?: string[] }>()
    if (!previous && typeof caches !== 'undefined') {
      for (const source of PROMPT_SOURCES) {
        const cache = await caches.open(source.cache)
        const catalogUrl = new URL('/__local_catalog__', source.home).href
        const response = await cache.match(catalogUrl)
        if (!response) continue
        const snapshot = await response.json()
        if (!snapshot || snapshot.items === undefined || !Number.isFinite(snapshot.updatedAt)) throw new Error(`${source.name} 的旧目录格式错误，未切换保存位置。`)
        const items = snapshot.cleared === true ? [] : [...new Map(normalizePromptSource(source.id, snapshot.items).map((item) => [item.id, item])).values()]
        items.forEach((item) => categories.set(item.sourcePromptId || item.id, { category: item.category, categories: item.categories }))
        updatePromptStorage({ message: `正在复制 ${source.name}：${items.length} 条提示词…` })
        await api.prompt_storage('catalog_write', { migration, source: source.id, items, updatedAt: snapshot.updatedAt, cleared: snapshot.cleared === true })
        const images = (await cache.keys()).filter((key) => key.url !== catalogUrl && promptImageUrl(key.url))
        for (let index = 0; index < images.length; index++) {
          const key = images[index]
          const saved = await cache.match(key)
          if (!saved) throw new Error(`${source.name} 的旧图片在复制时变化，请重试。`)
          updatePromptStorage({ message: `正在复制 ${source.name} 图片：${index + 1} / ${images.length}` })
          await api.prompt_storage('image_write', { migration, source: source.id, url: key.url, category: items.find((item) => item.previewUrl === key.url)?.category || '未分类', dataUrl: await blobToDataUrl(await saved.blob()) })
        }
      }
    }
    const copied = previous ? await api.prompt_storage('catalog_read', { migration, source: 'personal' }) as StoredPromptCatalog : null
    if (copied && !copied.catalog) throw new Error('复制后的个人提示词文件缺失，未切换保存位置。')
    const personal = copied ? diskPrompts(copied.catalog!) : useStore.getState().promptTemplates.map((item) => item.category ? item : { ...item, ...categories.get(item.sourcePromptId || ''), category: categories.get(item.sourcePromptId || '')?.category || '未分类' })
    updatePromptStorage({ message: '正在保存个人提示词、收藏和目录偏好…' })
    const examplesAdded = localStorage.getItem('prompt-examples-added-v1') === '1'
    const saved = copied ?? await api.prompt_storage('catalog_write', { migration, source: 'personal', items: personal, updatedAt: Date.now(), examplesAdded }) as StoredPromptCatalog
    const location = await api.prompt_storage('commit', { migration, cleanPrevious, preferences: { removed: getRemovedPromptSources(), examplesAdded } }) as PromptStorageLocation
    pending = undefined
    activatePromptDirectory(location, saved.catalog!.revision)
    resetPromptLibraries()
    useStore.setState({ promptTemplates: personal })
  } catch (err) {
    if (pending) {
      try { await api.prompt_storage('abort', { migration: pending.migration }) }
      catch (cleanup) { throw new Error(`${err instanceof Error ? err.message : '复制失败'}；临时副本未能清理：${pending.temporaryDirectory}。${cleanup instanceof Error ? cleanup.message : ''}`) }
    }
    throw err
  } finally {
    updatePromptStorage({ busy: false, message: getPromptStorageStatus().directory === previous ? '位置未切换，原数据保留。' : getPromptStorageStatus().message })
  }
}
