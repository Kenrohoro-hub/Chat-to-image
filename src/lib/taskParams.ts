import { DEFAULT_PARAMS, type TaskParams } from '../types'

export function normalizeTaskParams(value: unknown, fallback = DEFAULT_PARAMS): TaskParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return fallback
  const params = value as Record<string, unknown>
  return {
    size: typeof params.size === 'string' ? params.size : fallback.size,
    quality: params.quality === 'auto' || params.quality === 'low' || params.quality === 'medium' || params.quality === 'high' || params.quality === 'xhigh' || params.quality === 'max'
      ? params.quality
      : fallback.quality,
    output_format: params.output_format === 'png' || params.output_format === 'jpeg' || params.output_format === 'webp' ? params.output_format : fallback.output_format,
    output_compression: params.output_compression === null || (typeof params.output_compression === 'number' && Number.isFinite(params.output_compression))
      ? params.output_compression
      : fallback.output_compression,
    moderation: params.moderation === 'auto' || params.moderation === 'low' ? params.moderation : fallback.moderation,
    n: typeof params.n === 'number' && Number.isFinite(params.n) ? params.n : fallback.n,
    transparent_output: typeof params.transparent_output === 'boolean' ? params.transparent_output : fallback.transparent_output,
  }
}
