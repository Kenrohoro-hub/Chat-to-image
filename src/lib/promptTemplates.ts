import type { PromptTemplate } from '../types'
import { promptExampleVersion } from './promptExamples'

export const DEFAULT_PROMPT_CATEGORIES = ['默认', '漫画', 'agnet形象']

export function normalizePersonalPromptLibrary(items: unknown, categories: unknown, now = Date.now()) {
  const promptCategories = [...new Set(Array.isArray(categories)
    ? categories.filter((name): name is string => typeof name === 'string' && !!name.trim() && name.trim().length <= 200).map((name) => name.trim())
    : DEFAULT_PROMPT_CATEGORIES)]
  if (!promptCategories.length) promptCategories.push('默认')
  const promptTemplates = normalizePromptTemplates(items, now).map((item) => {
    const version = promptExampleVersion(item)
    const suggested = version === 4 ? '漫画' : version === 3 ? 'agnet形象' : '默认'
    const existing = !Array.isArray(categories) && item.category === '未分类' ? undefined : item.category
    const category = existing || (promptCategories.includes(suggested) ? suggested : promptCategories[0])
    if (!promptCategories.includes(category)) promptCategories.push(category)
    return { ...item, category }
  })
  return { promptTemplates, promptCategories }
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

export function normalizePromptTemplates(value: unknown, now = Date.now()): PromptTemplate[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !item.title.trim() || typeof item.content !== 'string' || !item.content.trim() || ids.has(item.id)) return []
    ids.add(item.id)
    return [{ category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : undefined, categories: Array.isArray(item.categories) ? item.categories.filter((name: unknown): name is string => typeof name === 'string' && !!name.trim()) : undefined, sourcePromptId: typeof item.sourcePromptId === 'string' ? item.sourcePromptId : undefined, sourceUrl: safeUrl(item.sourceUrl), previewUrl: typeof item.previewUrl === 'string' && /^\/prompt-examples\/[a-z0-9-]+\.(png|jpg|webp)$/.test(item.previewUrl) ? item.previewUrl : safeUrl(item.previewUrl), id: item.id, title: item.title.trim(), content: item.content.trim(), createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : now, updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : now }]
  })
}

export function mergePromptTemplates(current: PromptTemplate[], incoming: unknown) {
  const merged = [...current]
  for (const item of normalizePromptTemplates(incoming)) {
    const existing = merged.find((template) => template.id === item.id)
    if (existing?.title === item.title && existing.content === item.content && existing.sourceUrl === item.sourceUrl && existing.previewUrl === item.previewUrl && existing.sourcePromptId === item.sourcePromptId && (!item.category || existing.category === item.category) && JSON.stringify(existing.categories) === JSON.stringify(item.categories)) continue
    merged.push(existing ? { ...item, id: crypto.randomUUID(), title: `${item.title}（导入）` } : item)
  }
  return merged
}
