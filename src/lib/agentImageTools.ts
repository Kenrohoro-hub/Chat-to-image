import { API_MAX_IMAGES, type TaskParams } from '../types'

export interface ImageToolArguments { id: string; prompt: string; params: Partial<TaskParams> }

export function parseImageToolArguments(value: unknown): ImageToolArguments | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) return null
  const params: Partial<TaskParams> = {}
  if (record.n !== undefined) {
    if (typeof record.n !== 'number' || !Number.isInteger(record.n) || record.n < 1 || record.n > API_MAX_IMAGES) return null
    params.n = record.n
  }
  if (typeof record.size === 'string') params.size = record.size
  if (['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(record.quality))) params.quality = record.quality as TaskParams['quality']
  if (['png', 'jpeg', 'webp'].includes(String(record.output_format))) params.output_format = record.output_format as TaskParams['output_format']
  if (typeof record.transparent_output === 'boolean') params.transparent_output = record.transparent_output
  return { id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : 'image', prompt: record.prompt.trim(), params }
}

export function filterAgentVisionInput(input: unknown, vision: boolean): unknown {
  if (vision || !Array.isArray(input)) return input
  return input.map((item) => item && typeof item === 'object' && Array.isArray(item.content)
    ? { ...item, content: item.content.map((part: { type?: string }) => part.type === 'input_image' ? { type: 'input_text', text: '[Image reference only. Image pixels are unavailable to this model; do not claim to see it. Use the reference ID for editing.]' } : part) }
    : item)
}
