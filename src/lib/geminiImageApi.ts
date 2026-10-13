import { t } from './i18n'
import type { ApiProfile, TaskParams } from '../types'
import { dataUrlToBlob } from './canvasImage'
import { readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { assertImageInputPayloadSize, getApiErrorMessage, type CallApiOptions, type CallApiResult } from './imageApiShared'

const GEMINI_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

export function usesGeminiImageApi(profile: ApiProfile): boolean {
  if (profile.provider !== 'openai' || profile.apiMode !== 'images') return false
  if (profile.imageProtocol === 'openai') return false
  if (profile.imageProtocol === 'gemini') return true
  return profile.model.replace(/^models\//, '').toLowerCase().startsWith('gemini-')
}

function getGeminiEndpoint(profile: ApiProfile): string {
  const base = profile.baseUrl.trim().replace(/\/+$/, '')
  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(base) ? base : `https://${base}`
  const model = profile.model.replace(/^models\//, '').replace(/:(?:streamGenerateContent|generateContent)$/, '')
  try {
    const url = new URL(input)
    const endpoint = /\/models\/[^/]+:(generateContent|streamGenerateContent)$/.exec(url.pathname)
    if (endpoint) {
      url.pathname = url.pathname.replace(/\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/, `/models/${encodeURIComponent(model)}:generateContent`)
      return url.href
    }
    url.pathname = url.pathname.replace(/\/v1$/, '/v1beta')
    if (!/\/v1beta$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}/v1beta`
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`
    return url.href
  } catch {
    return `${input}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  }
}

function getAspectRatio(size: string): string | undefined {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size)
  if (!match) return undefined
  const ratio = Number(match[1]) / Number(match[2])
  return GEMINI_ASPECT_RATIOS.reduce((closest, candidate) => {
    const [width, height] = candidate.split(':').map(Number)
    const [closestWidth, closestHeight] = closest.split(':').map(Number)
    return Math.abs(ratio - (width / height)) < Math.abs(ratio - (closestWidth / closestHeight)) ? candidate : closest
  })
}

function getImageSize(size: string): '1K' | '2K' | '4K' | undefined {
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size)
  if (!match) return undefined
  const longestSide = Math.max(Number(match[1]), Number(match[2]))
  return longestSide <= 1536 ? '1K' : longestSide <= 2560 ? '2K' : '4K'
}

function dataUrlParts(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (!match) throw new Error(t('Gemini 参考图必须是 Base64 图片数据。', 'Gemini reference images must be Base64 data URLs.'))
  return { mimeType: match[1], data: match[2] }
}

function getActualImageFormat(base64: string): { mimeType: string; format: TaskParams['output_format'] } | null {
  try {
    const bytes = atob(base64)
    if (bytes.length >= 45 && bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.slice(12, 16) === 'IHDR' && bytes.slice(-8, -4) === 'IEND') {
      return { mimeType: 'image/png', format: 'png' }
    }
    if (bytes.startsWith('\xff\xd8') && bytes.endsWith('\xff\xd9')) return { mimeType: 'image/jpeg', format: 'jpeg' }
    if (bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' && new DataView(Uint8Array.from(bytes, (char) => char.charCodeAt(0)).buffer).getUint32(4, true) === bytes.length - 8) {
      return { mimeType: 'image/webp', format: 'webp' }
    }
  } catch {
    return null
  }
  return null
}

export async function callGeminiImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (opts.maskDataUrl) throw new Error(t('Gemini 图片接口不支持遮罩编辑。', 'Gemini image generation does not support mask editing.'))
  if (opts.nativeTransparentBackground) throw new Error(t('Gemini 图片接口不支持原生透明背景，请改用本地透明背景处理。', 'Gemini image generation does not support native transparent backgrounds. Use local transparency processing.'))

  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  if (useApiProxy) throw new Error(t('当前 API 代理不支持 Gemini v1beta 请求，请关闭 API 代理或配置直连。', 'The current API proxy does not support Gemini v1beta requests. Disable API proxy or configure a direct connection.'))
  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }]
  let inputBytes = 0
  for (const imageDataUrl of opts.inputImageDataUrls) {
    const blob = await dataUrlToBlob(imageDataUrl)
    inputBytes += blob.size
    const image = dataUrlParts(imageDataUrl)
    parts.push({ inlineData: { mimeType: image.mimeType || blob.type || 'image/png', data: image.data } })
  }
  assertImageInputPayloadSize(inputBytes)

  const imageConfig = opts.params.size === 'auto'
    ? undefined
    : { aspectRatio: getAspectRatio(opts.params.size), imageSize: getImageSize(opts.params.size) }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(imageConfig ? { imageConfig } : {}),
    },
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const response = await fetch(getGeminiEndpoint(profile), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    const payload = await response.json() as { candidates?: unknown }
    const images: string[] = []
    const formats: TaskParams['output_format'][] = []
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
    for (const candidate of candidates) {
      const content = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>).content : null
      const rawParts = content && typeof content === 'object' ? (content as Record<string, unknown>).parts : null
      if (!Array.isArray(rawParts)) continue
      for (const part of rawParts) {
        if (!part || typeof part !== 'object') continue
        const record = part as Record<string, unknown>
        const inlineData = record.inlineData ?? record.inline_data
        if (!inlineData || typeof inlineData !== 'object') continue
        const image = inlineData as Record<string, unknown>
        if (typeof image.data !== 'string') continue
        const actual = getActualImageFormat(image.data)
        if (!actual) continue
        images.push(`data:${actual.mimeType};base64,${image.data}`)
        formats.push(actual.format)
      }
    }
    if (!images.length) throw new Error(t('Gemini 接口未返回可识别的 PNG、JPEG 或 WebP 图片。', 'Gemini returned no recognizable PNG, JPEG, or WebP image.'))
    const warnings = formats.some((format) => format !== opts.params.output_format)
      ? [t(`Gemini 实际返回 ${[...new Set(formats)].join('、')} 图片，与请求的 ${opts.params.output_format} 格式不同。`, `Gemini returned ${[...new Set(formats)].join(', ')} images instead of the requested ${opts.params.output_format} format.`)]
      : undefined
    const actualParams = { output_format: formats[0] }
    return { images, actualParams, actualParamsList: formats.map((output_format) => ({ ...actualParams, output_format })), warnings }
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', abortFromCaller)
  }
}
