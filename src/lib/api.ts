import { t } from './i18n'
import { validateImageModelParams } from './imageModelCapabilities'
import { runImageBatch } from './imageBatch'
import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callGeminiImageApi, usesGeminiImageApi } from './geminiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import { getImageProtocol } from './imageProtocol'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { desktopApi, flushDesktopSettings, isLocalService } from './desktop'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'
export { usesGeminiImageApi }

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  validateImageModelParams(profile, opts.params, opts.inputImageDataUrls.length, opts.nativeTransparentBackground === true)
  const provider = getCustomProviderDefinition(opts.settings, profile.provider)
  const mapping = opts.inputImageDataUrls.length && provider?.editSubmit ? provider.editSubmit : provider?.submit
  const split = profile.provider === 'openai' || (profile.codexCli && provider && !mapping?.taskIdPath)
  const count = split ? Math.max(1, Math.floor(opts.params.n)) : 1
  return runImageBatch(count, (index) => callImageApiSingle({
    ...opts,
    params: split ? { ...opts.params, n: 1 } : opts.params,
    onPartialImage: opts.onPartialImage ? (partial) => opts.onPartialImage?.({ ...partial, requestIndex: index }) : undefined,
  }), opts.signal, opts.onImageCompleted, opts.onRequestStarted)
}

async function callImageApiSingle(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (isLocalService() && profile.provider === 'openai' && profile.apiMode === 'images' && !profile.codexCli && !profile.apiProxy && (getImageProtocol(profile) !== 'openai' || !profile.streamImages)) {
    await flushDesktopSettings()
    const api = await desktopApi()
    opts.signal?.throwIfAborted()
    const requestId = crypto.randomUUID()
    const cancel = () => { void api.cancel_generation(requestId).catch(() => undefined) }
    opts.signal?.addEventListener('abort', cancel, { once: true })
    try {
      const result = await api.generate({
        requestId,
        profileId: profile.id,
        model: opts.settings.galleryModel || undefined,
        prompt: opts.prompt,
        params: opts.params,
        inputImageDataUrls: opts.inputImageDataUrls,
        maskDataUrl: opts.maskDataUrl,
        nativeTransparentBackground: opts.nativeTransparentBackground,
      })
      if (!result.images.length) opts.signal?.throwIfAborted()
      if (!result.ok && !result.images.length) throw new Error([result.error?.message ?? t('生成失败，请查看 API 配置。', 'Generation failed. Check your API profiles.'), ...result.warnings].join('\n'))
      return {
        ...result,
        failedRequests: !result.ok ? Array.from({ length: Math.max(1, opts.params.n - result.images.length) }, (_, i) => ({ requestIndex: result.images.length + i, error: result.error?.message ?? t('任务未完成', 'Task incomplete') })) : undefined,
      }
    } finally { opts.signal?.removeEventListener('abort', cancel) }
  }
  if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)
  if (usesGeminiImageApi(profile)) return callGeminiImageApi(opts, profile)

  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
