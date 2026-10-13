import type { ApiProfile } from '../types'

export type ImageProtocol = 'openai' | 'gemini' | 'seedream' | 'qwen'

export function getImageProtocol(profile: ApiProfile): ImageProtocol {
  if (profile.provider !== 'openai' || profile.apiMode !== 'images') return 'openai'
  const protocol: string | undefined = profile.imageProtocol
  if (protocol === 'gemini' || protocol === 'seedream' || protocol === 'qwen' || protocol === 'openai') return protocol
  const model = profile.model.replace(/^models\//, '').toLowerCase()
  if (model.startsWith('gemini-')) return 'gemini'
  if (model.startsWith('seedream-') || model.startsWith('doubao-seedream-')) return 'seedream'
  if (model.startsWith('qwen-image')) return 'qwen'
  try {
    const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(profile.baseUrl) ? profile.baseUrl : `https://${profile.baseUrl}`
    if (/^ark\.[^.]+\.volces\.com$/i.test(new URL(input).hostname)) return 'seedream'
  } catch {
    return 'openai'
  }
  return 'openai'
}
