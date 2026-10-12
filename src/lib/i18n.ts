export type UiLanguage = 'zh-CN' | 'en'

declare global {
  interface Window {
    __PLAYGROUND_UI_LANGUAGE__?: string
  }
}

export function getUiLanguage(): UiLanguage {
  try {
    const selected = typeof localStorage !== 'undefined' ? localStorage.getItem('chat-to-image-ui-language') : null
    if (selected === 'zh-CN' || selected === 'en') return selected
  } catch { /* 本地存储被禁用时仍可按系统语言显示。 */ }
  const language = typeof window !== 'undefined' && window.__PLAYGROUND_UI_LANGUAGE__
    ? window.__PLAYGROUND_UI_LANGUAGE__
    : typeof navigator !== 'undefined' ? navigator.language || navigator.languages?.[0] || 'en' : 'en'
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en'
}

export function t(zh: string, en: string): string {
  return getUiLanguage() === 'zh-CN' ? zh : en
}

export function applyUiLanguage() {
  document.documentElement.lang = getUiLanguage()
}

export function getCategoryLabel(name: string): string {
  if (getUiLanguage() === 'zh-CN') return name
  const labels: Record<string, string> = {
    '默认': 'Default', '漫画': 'Comics', 'agnet形象': 'Agent characters', '未分类': 'Uncategorized',
    '需要参考图': 'Reference image required', '无需参考图': 'No reference image required',
    '热门': 'Popular', '艺术': 'Art', '角色': 'Characters', '图片编辑': 'Image editing',
    '信息可视化': 'Infographics', '创意实验': 'Creative experiments', '地图': 'Maps',
    '营销': 'Marketing', '人像': 'Portraits', '产品设计': 'Product design', '空间': 'Spaces',
    '多图融合': 'Image blending', '产品': 'Products', '风格转换': 'Style transfer', '图文海报': 'Posters',
  }
  return labels[name] ?? name
}

export function setUiLanguage(language: UiLanguage) {
  localStorage.setItem('chat-to-image-ui-language', language)
}

export function getFavoriteCollectionLabel(collection: { id: string; name: string }): string {
  return collection.id === '__default_favorites__' && collection.name === '默认'
    ? t('默认', 'Default') : collection.name
}

export function getConversationLabel(conversation: { title: string; rounds: unknown[] }): string {
  return !conversation.rounds.length && (conversation.title === '新对话' || conversation.title === 'New conversation')
    ? t('新对话', 'New conversation') : conversation.title
}
