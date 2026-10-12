import { t } from './i18n'
import { API_MAX_IMAGES, type ApiProfile, type ImageModelCapabilities, type TaskParams } from '../types'
import { getImageGenerationModel } from './imageModels'

export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const

export function normalizeImageCapabilities(input: unknown): ApiProfile['imageCapabilities'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const entries = Object.entries(input).flatMap(([model, value]) => {
    if (!model.trim() || !value || typeof value !== 'object' || Array.isArray(value)) return []
    const raw = value as Record<string, unknown>
    const rule: ImageModelCapabilities = {}
    if (Array.isArray(raw.sizes)) {
      const sizes = [...new Set(raw.sizes.filter((size): size is string => typeof size === 'string').map((size) => size.trim().toLowerCase().replace('×', 'x')).filter((size) => size === 'auto' || /^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(size)))]
      if (sizes.length) rule.sizes = sizes
    }
    if (Array.isArray(raw.qualities)) { const values = IMAGE_QUALITIES.filter((value) => (raw.qualities as unknown[]).includes(value)); if (values.length) rule.qualities = values }
    if (Array.isArray(raw.formats)) { const values = IMAGE_FORMATS.filter((value) => (raw.formats as unknown[]).includes(value)); if (values.length) rule.formats = values }
    if (typeof raw.transparent === 'boolean') rule.transparent = raw.transparent
    if (typeof raw.maxInputImages === 'number' && Number.isInteger(raw.maxInputImages) && raw.maxInputImages >= 0 && raw.maxInputImages <= API_MAX_IMAGES) rule.maxInputImages = raw.maxInputImages
    return Object.keys(rule).length ? [[model.trim(), rule] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function getImageModelCapabilities(profile: ApiProfile) {
  return profile.imageCapabilities?.[getImageGenerationModel(profile)]
}

export function validateImageModelParams(profile: ApiProfile, params: TaskParams, inputCount: number, nativeTransparent: boolean) {
  const rule = getImageModelCapabilities(profile)
  if (!rule) return
  const prefix = t(`模型 ${getImageGenerationModel(profile)}：`, `Model ${getImageGenerationModel(profile)}: `)
  if (rule.sizes && !rule.sizes.includes(params.size)) throw new Error(t(`${prefix}尺寸仅支持 ${rule.sizes.join('、')}。`, `${prefix}Supported sizes: ${rule.sizes.join(', ')}.`))
  if (rule.qualities && !rule.qualities.includes(params.quality)) throw new Error(t(`${prefix}质量仅支持 ${rule.qualities.join('、')}。`, `${prefix}Supported quality levels: ${rule.qualities.join(', ')}.`))
  if (rule.formats && !rule.formats.includes(params.output_format)) throw new Error(t(`${prefix}格式仅支持 ${rule.formats.join('、')}。`, `${prefix}Supported formats: ${rule.formats.join(', ')}.`))
  if (rule.transparent === false && nativeTransparent) throw new Error(t(`${prefix}不支持原生透明背景，请关闭透明背景或在设置中选择本地处理。`, `${prefix}Native transparent backgrounds are not supported. Disable transparency or select local processing in settings.`))
  if (rule.maxInputImages !== undefined && inputCount > rule.maxInputImages) throw new Error(t(`${prefix}最多支持 ${rule.maxInputImages} 张参考图，当前为 ${inputCount} 张。`, `${prefix}Up to ${rule.maxInputImages} reference images are supported; ${inputCount} are attached.`))
}
