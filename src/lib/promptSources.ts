import type { PromptTemplate } from '../types'
import { desktopApi, isLocalService } from './desktop'

export interface LibraryPrompt extends PromptTemplate { category: string; categories?: string[] }
export const PROMPT_SOURCES = [
  { id: 'garden', name: '水仙', mark: '水', description: '在线提示词', home: 'https://prompt.qqsrc.com/', cache: 'prompt-library-shuixian-v1' },
  { id: 'promptfill', name: 'PromptFill', mark: 'P', description: '提示词填空器', home: 'https://promptfill.tanshilong.com/explore', cache: 'prompt-library-promptfill-v1' },
  { id: 'youmind', name: 'YouMind', mark: 'Y', description: 'Nano Banana Pro', home: 'https://youmind.com/zh-CN/nano-banana-pro-prompts', cache: 'prompt-library-youmind-v1' },
  { id: 'pixto', name: 'PixtoAI', mark: 'P', description: '图片风格', home: 'https://www.pixtoai.com/styles/', cache: 'prompt-library-pixto-v1' },
  { id: 'nanoimage', name: 'NanoPrompts GPT-2', mark: 'G', description: 'GPT-image-2', home: 'https://nanoprompts.org/zh/gpt-image-2', cache: 'prompt-library-nanoimage-v1' },
  { id: 'nano', name: 'NanoPrompts', mark: 'N', description: 'Nano Banana', home: 'https://nanoprompts.org/zh', cache: 'prompt-library-nano-v1' },
  { id: 'hero', name: 'HeroPrompt', mark: 'H', description: '多语言提示词', home: 'https://heroprompt.sortes.ai/zh', cache: 'prompt-library-hero-v1' },
] as const
export type PromptSourceId = typeof PROMPT_SOURCES[number]['id']

const IMAGE_PREFIXES = [
  'https://r2.qqsrc.com/images/', 'https://cms-assets.youmind.com/media/',
  'https://cdn.youmindassets.com/gen-images/', 'https://s3.bmp.ovh/imgs/',
  'https://s41.ax1x.com/', 'https://img.wjwj.top/',
  'https://banana-prompt.nanoprompts.org/', 'https://turing-img.animelook.top/pic/',
  'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/',
]
export function promptImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.includes('..')) return undefined
  try {
    const url = new URL(value)
    if (value.startsWith('https://pbs.twimg.com/media/')) {
      if (!/^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpg|png|webp))?$/.test(url.pathname) || url.hash || url.username || url.password) return undefined
      if (url.search && (Array.from(url.searchParams.keys()).sort().join(',') !== 'format,name' || !['jpg', 'png', 'webp'].includes(url.searchParams.get('format') || '') || !['orig', 'large', 'medium', 'small'].includes(url.searchParams.get('name') || ''))) return undefined
      return url.href
    }
    return IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix)) && /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9_./-]+$/.test(value) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
function localized(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const text = value as Record<string, unknown>
  return typeof text.cn === 'string' && text.cn.trim() ? text.cn.trim() : typeof text.en === 'string' ? text.en.trim() : ''
}

export function normalizeGardenPrompts(value: unknown): LibraryPrompt[] {
  if (!Array.isArray(value)) throw new Error('水仙的数据格式已变化，请稍后重试。')
  return value.flatMap((item) => {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.title !== 'string' || !item.title.trim() || typeof item.prompt !== 'string' || !item.prompt.trim()) return []
    return [{ id: `garden-${item.id}`, sourcePromptId: `garden-${item.id}`, title: item.title.trim(), content: item.prompt.trim(),
      category: typeof item.category === 'string' ? item.category : '未分类', sourceUrl: `https://prompt.qqsrc.com/detail.html?id=${item.id}`,
      previewUrl: typeof item.image === 'string' ? promptImageUrl(`https://r2.qqsrc.com/${item.image}`) : undefined, createdAt: 0, updatedAt: 0 }]
  })
}

export function normalizePromptFill(value: unknown): LibraryPrompt[] {
  const data = value as { templates?: { config?: unknown }; banks?: { defaults?: Record<string, unknown> } } | null
  if (!Array.isArray(data?.templates?.config) || !data.banks?.defaults || typeof data.banks.defaults !== 'object') throw new Error('PromptFill 的模板格式已变化，请刷新重试。')
  return data.templates.config.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || item.type === 'video') return []
    const title = localized(item.name)
    const counts: Record<string, number> = {}
    const content = localized(item.content).replace(/\{\{(.*?)\}\}/g, (match, body: string) => {
      const index = body.indexOf(':')
      const key = (index < 0 ? body : body.slice(0, index)).trim()
      const inline = index < 0 ? '' : body.slice(index + 1).replace(/^:/, '').trim()
      const occurrence = counts[key] ?? 0
      counts[key] = occurrence + 1
      return localized(item.selections?.[`${key}-${occurrence}`]) || localized(item.selections?.[key]) || inline || localized(data.banks!.defaults![key.replace(/_\d+$/, '')]) || match
    })
    if (!title || !content) return []
    const categories: string[] = Array.isArray(item.tags) ? [...new Set<string>(item.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && !!tag.trim()).map((tag: string) => tag.trim()))] : []
    const id = `promptfill-${item.id}`
    return [{ id, sourcePromptId: id, title, content, categories: categories.length ? categories : ['未分类'], category: categories[0] || '未分类',
      sourceUrl: 'https://promptfill.tanshilong.com/explore', previewUrl: promptImageUrl(item.imageUrl), createdAt: 0, updatedAt: 0 }]
  })
}

export function normalizeYouMind(value: unknown): LibraryPrompt[] {
  if (!Array.isArray(value)) throw new Error('YouMind 的目录格式已变化，请刷新重试。')
  return value.flatMap((item) => {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.title !== 'string' || !item.title.trim()) return []
    const text = localized(item.translatedContent) || localized(item.content)
    if (!text) return []
    const content = text.replace(/\{argument\s+[^{}]*?default=(?:"([^"{}]*)"|'([^'{}]*)')[^{}]*\}/g, (_, double: string, single: string) => double ?? single)
    const id = `youmind-${item.id}`
    return [{ id, sourcePromptId: id, title: item.title.trim(), content, category: item.needReferenceImages === true ? '需要参考图' : '无需参考图',
      sourceUrl: `https://youmind.com/zh-CN/nano-banana-pro-prompts/explore?id=${item.id}`,
      previewUrl: promptImageUrl(Array.isArray(item.media) ? item.media[0] : undefined), createdAt: 0, updatedAt: 0 }]
  })
}
export function normalizePromptSource(id: PromptSourceId, value: unknown): LibraryPrompt[] {
  if (id === 'garden') return normalizeGardenPrompts(value)
  if (id === 'promptfill') return normalizePromptFill(value)
  if (id === 'youmind') return normalizeYouMind(value)
  if (!Array.isArray(value)) throw new Error('网站目录格式已变化，请刷新重试。')
  const site = PROMPT_SOURCES.find((source) => source.id === id)!
  const labels: Record<string, string> = { Trending: '热门', Artistic: '艺术', Character: '角色', 'Image Editing': '图片编辑', 'Info Viz': '信息可视化', Lab: '创意实验', Manga: '漫画', Map: '地图', Marketing: '营销', Portrait: '人像', 'Product Design': '产品设计', Spatial: '空间', Editing: '图片编辑', 'Multi-image': '多图融合', Product: '产品', 'Style Transfer': '风格转换', 'Text & Poster': '图文海报' }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    if (id === 'pixto') {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || item.category_id === 48) return []
      const title = localized(item.name)
      const content = [localized(item.pre_prompt), localized(item.fe_prompt)].filter(Boolean).join('\n\n')
      if (!title || !content) return []
      const key = `pixto-${item.id}`
      return [{ id: key, sourcePromptId: key, title, content, category: localized(item.category?.name) || '未分类', sourceUrl: `https://www.pixtoai.com/style/${item.id}/`, previewUrl: promptImageUrl(item.logo), createdAt: 0, updatedAt: 0 }]
    }
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id)) return []
    const key = `${id}-${item.id}`
    if (id === 'hero') {
      const cn = item.i18nContent?.['zh-CN']
      const en = item.i18nContent?.en
      const title = localized(cn?.title) || localized(en?.title)
      const content = (localized(cn?.prompt) || localized(en?.prompt)).replace(/\{\{([^{}]+)\}\}/g, (match, body: string) => body.split('|').length >= 3 ? body.split('|').slice(2).join('|').trim() || match : match)
      if (!title || !content) return []
      const tags = item.tagsArray?.['zh-CN']?.length ? item.tagsArray['zh-CN'] : item.tagsArray?.en
      const categories = Array.isArray(tags) ? [...new Set<string>(tags.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()))] : []
      return [{ id: key, sourcePromptId: key, title, content, categories: categories.length ? categories : ['未分类'], category: categories[0] || '未分类', sourceUrl: `https://heroprompt.sortes.ai/zh/posts/${item.id}`, previewUrl: promptImageUrl(item.imageUrl), createdAt: 0, updatedAt: 0 }]
    }
    const title = localized(item.title)
    const content = localized(item.prompt)
    if (!title || !content) return []
    return [{ id: key, sourcePromptId: key, title, content, category: localized(item.category_label) || (typeof labels[item.category] === 'string' ? labels[item.category] : localized(item.category)) || '未分类', sourceUrl: typeof item.link === 'string' && item.link.startsWith('/zh/') ? `https://nanoprompts.org${item.link}` : site.home, previewUrl: promptImageUrl(item.image_url), createdAt: 0, updatedAt: 0 }]
  })
}

async function fetchJson(url: string) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`目录读取失败（HTTP ${response.status}），原缓存已保留。`)
  return response.json()
}
export async function fetchPromptSource(id: PromptSourceId, progress: (message: string) => void): Promise<unknown> {
  if (id === 'garden') {
    const parts = await Promise.all([1, 2, 3].map(async (part) => {
      const data = await fetchJson(`https://prompt.qqsrc.com/data/prompts.part${part}.json`)
      if (!normalizeGardenPrompts(data).length) throw new Error('水仙返回了空目录，原缓存已保留。')
      return data as unknown[]
    }))
    return parts.flat()
  }
  if (id === 'promptfill') {
    const [templates, banks] = await Promise.all(['templates', 'banks'].map((name) => fetchJson(`https://promptfill.tanshilong.com/data/${name}.json`)))
    return { templates, banks }
  }
  if (id === 'nano' || id === 'nanoimage') return fetchJson(`https://nanoprompts.org/assets/data/${id === 'nano' ? 'prompts_zh' : 'prompts_gpt_image_2_zh'}.json`)
  const site = PROMPT_SOURCES.find((source) => source.id === id)!
  if (id !== 'pixto' && !isLocalService()) throw new Error(`${site.name} 目录请使用桌面或本机网页入口读取。`)
  const api = id === 'pixto' ? undefined : await desktopApi()
  const readPage = async (page: number): Promise<{ prompts: unknown[]; totalPages: number }> => {
    if (id === 'youmind') return api!.read_youmind_prompts(page)
    if (id === 'hero') return api!.read_heroprompt_posts(page)
    const payload = await fetchJson(`https://camera.animelook.top/api/normal/web-styles?page=${page}`)
    const data = payload?.data
    if (payload?.code !== 0 || !Array.isArray(data?.data) || data.current_page !== page || !Number.isSafeInteger(data.last_page) || data.last_page < 1 || data.last_page > 1000) throw new Error('PixtoAI 目录格式已变化，原缓存已保留。')
    return { prompts: data.data, totalPages: data.last_page }
  }
  const first = await readPage(1)
  const pages = [first.prompts]
  let next = 2
  let done = 1
  progress(`正在读取 ${site.name} 目录：${done} / ${first.totalPages} 页`)
  let stopped = false
  const workers = await Promise.allSettled(Array.from({ length: Math.min(3, first.totalPages - 1) }, async () => {
    while (!stopped && next <= first.totalPages) {
      const page = next++
      const data = await readPage(page).catch((err) => { stopped = true; throw err })
      pages[page - 1] = data.prompts
      done++
      progress(`正在读取 ${site.name} 目录：${done} / ${first.totalPages} 页`)
    }
  }))
  const failed = workers.find((worker) => worker.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return pages.flat()
}

export function promptSourceName(item: PromptTemplate) {
  const source = PROMPT_SOURCES.find((entry) => item.sourcePromptId?.startsWith(`${entry.id}-`) || item.id.startsWith(`${entry.id}-`)) ?? PROMPT_SOURCES.find((entry) => item.sourceUrl?.startsWith(entry.home))
  return source?.name || '网络提示词库'
}
