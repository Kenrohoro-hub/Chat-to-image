import { t } from './i18n'
import { DEFAULT_STREAM_PARTIAL_IMAGES, type ApiProfile, type CustomProviderDefinition, type CustomProviderPollMapping, type CustomProviderResultMapping, type CustomProviderSubmitMapping, type ImageApiResponse, type ImageResponseItem, type ResponsesApiResponse, type ResponsesOutputItem, type TaskParams } from '../types'
import { dataUrlToBlob, imageDataUrlToPngBlob, loadImage, maskDataUrlToPngBlob } from './canvasImage'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import {
  assertImageInputPayloadSize,
  assertMaskEditFileSize,
  detectBase64ImageFormat,
  appendStreamingFormatHint,
  maybeAppendStreamingHint,
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  getDataUrlDecodedByteSize,
  getDataUrlEncodedByteSize,
  getResponsesImageResultBase64,
  isDataUrl,
  isHttpUrl,
  mergeActualParams,
  maybeAppendTransparentBackgroundHint,
  maybeAppendImageToolDroppedHint,
  MIME_MAP,
  normalizeBase64Image,
  pickActualParams,
  PROMPT_REWRITE_GUARD_PREFIX,
} from './imageApiShared'
import { getImageGenerationModel } from './imageModels'
import { isEventStreamResponse, readJsonServerSentEvents } from './serverSentEvents'
import { prependCodexCliSizePrompt } from './size'
import { getImageProtocol } from './imageProtocol'

function getStreamPartialImages(profile: ApiProfile): number {
  return profile.streamPartialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES
}

function appendQuery(path: string, query?: Record<string, string>): string {
  if (!query || !Object.keys(query).length) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) params.set(key, value)
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
}

function createOpenAICompatiblePaths() {
  return {
    generationPath: 'images/generations',
    editPath: 'images/edits',
  }
}

function getByPath(source: unknown, path: string | undefined): unknown {
  if (!path) return source
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (current == null) return undefined
    if (/^\d+$/.test(key) && Array.isArray(current)) return current[Number(key)]
    if (typeof current === 'object') return (current as Record<string, unknown>)[key]
    return undefined
  }, source)
}

function getAllByPath(source: unknown, path: string | undefined): unknown[] {
  if (!path) return [source]
  const parts = path.split('.').filter(Boolean)
  let current: unknown[] = [source]

  for (const key of parts) {
    const next: unknown[] = []
    for (const item of current) {
      if (item == null) continue
      if (key === '*') {
        if (Array.isArray(item)) next.push(...item)
        else if (typeof item === 'object') next.push(...Object.values(item as Record<string, unknown>))
        continue
      }
      if (/^\d+$/.test(key) && Array.isArray(item)) {
        next.push(item[Number(key)])
        continue
      }
      if (typeof item === 'object') next.push((item as Record<string, unknown>)[key])
    }
    current = next
  }

  return current.flatMap((item) => Array.isArray(item) ? item : [item]).filter((item) => item != null)
}

function normalizeImageApiPayload(value: unknown): ImageApiResponse {
  if (Array.isArray(value)) return { data: value as ImageApiResponse['data'] }
  if (value && typeof value === 'object') return value as ImageApiResponse
  return { data: [] }
}

function createRequestHeaders(profile: ApiProfile): Record<string, string> {
  return {
    Authorization: `Bearer ${profile.apiKey}`,
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getStringValue(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function getNumberValue(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStreamEventErrorMessage(event: Record<string, unknown>): string | null {
  const error = event.error
  if (isRecordValue(error)) {
    const message = getStringValue(error, 'message')
    if (message) return message
  }
  if (typeof error === 'string' && error.trim()) return error

  const type = getStringValue(event, 'type')
  if (type?.endsWith('.failed')) {
    return getStringValue(event, 'message') ?? t('流式请求失败', 'Streaming request failed')
  }
  return null
}

function createResponsesImageTool(
  params: TaskParams,
  isEdit: boolean,
  profile: ApiProfile,
  maskDataUrl?: string,
  nativeTransparentBackground?: boolean,
): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action: isEdit ? 'edit' : 'generate',
    output_format: params.output_format,
    moderation: params.moderation,
  }
  const imageModel = getImageGenerationModel(profile)
  if (imageModel) tool.model = imageModel

  if (!profile.codexCli) {
    tool.size = params.size
  }

  if (profile.streamImages) {
    tool.partial_images = getStreamPartialImages(profile)
  }

  if (!profile.codexCli) {
    tool.quality = params.quality
  }

  if (params.output_format !== 'png' && params.output_compression != null) {
    tool.output_compression = params.output_compression
  }

  if (nativeTransparentBackground) {
    tool.background = 'transparent'
  }

  if (maskDataUrl) {
    tool.input_image_mask = {
      image_url: maskDataUrl,
    }
  }

  return tool
}

function createResponsesInput(prompt: string, inputImageDataUrls: string[], allowPromptRewrite: boolean): unknown {
  const text = allowPromptRewrite ? prompt : `${PROMPT_REWRITE_GUARD_PREFIX}\n${prompt}`
  if (!inputImageDataUrls.length) return text

  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        ...inputImageDataUrls.map((dataUrl) => ({
          type: 'input_image',
          image_url: dataUrl,
        })),
      ],
    },
  ]
}

function parseResponsesImageResults(payload: ResponsesApiResponse, fallbackMime: string): Array<{
  image: string
  actualParams?: Partial<TaskParams>
  revisedPrompt?: string
}> {
  const output = payload.output
  if (!Array.isArray(output) || !output.length) {
    const err = new Error(t('接口未返回图片数据', 'The API returned no image data'))
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const results: Array<{ image: string; actualParams?: Partial<TaskParams>; revisedPrompt?: string }> = []

  for (const item of output) {
    if (item?.type !== 'image_generation_call') continue

    const b64 = getResponsesImageResultBase64(item.result)
    if (b64) {
      results.push({
        image: normalizeBase64Image(b64, fallbackMime),
        actualParams: mergeActualParams(pickActualParams(item)),
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      })
    }
  }

  if (!results.length) {
    const err = new Error(t('接口没有返回可识别的图片数据，请查看原始响应内容确认服务商实际返回的数据结构。如果使用的是中转或兼容接口，建议创建并使用「自定义服务商」配置。', 'The API returned no recognizable image data. Check the raw response for its structure. For a relay or compatible API, configure a custom provider.'))
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  return results
}

async function parseImagesApiResponse(payload: ImageApiResponse, mime: string, signal?: AbortSignal): Promise<CallApiResult> {
  const data = payload.data
  if (!Array.isArray(data) || !data.length) {
    const err = new Error(t('接口没有返回图片数据，请查看原始响应内容确认服务商实际返回的数据结构。如果使用的是中转或兼容接口，建议创建并使用「自定义服务商」配置。', 'The API returned no image data. Check the raw response for its structure. For a relay or compatible API, configure a custom provider.'))
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const images: string[] = []
  const rawImageUrls = data.map((item) => item.url).filter(isHttpUrl)
  const revisedPrompts: Array<string | undefined> = []
  try {
    for (const item of data) {
      const b64 = item.b64_json
      if (b64) {
        images.push(normalizeBase64Image(b64, mime))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
        continue
      }

      if (isHttpUrl(item.url) || isDataUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(item.url, mime, signal))
        revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
      }
    }
  } catch (err) {
    if (rawImageUrls.length > 0 && err instanceof Error) {
      (err as any).rawImageUrls = rawImageUrls
    }
    throw err
  }

  if (!images.length) {
    const err = new Error(t('接口没有返回可识别的图片数据，请查看原始响应内容确认服务商实际返回的数据结构。如果使用的是中转或兼容接口，建议创建并使用「自定义服务商」配置。', 'The API returned no recognizable image data. Check the raw response for its structure. For a relay or compatible API, configure a custom provider.'))
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const actualParams = mergeActualParams(
    pickActualParams(payload),
  )
  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

function eventToImageResponseItem(event: Record<string, unknown>): ImageResponseItem {
  return {
    b64_json: getStringValue(event, 'b64_json'),
    url: getStringValue(event, 'url'),
    revised_prompt: getStringValue(event, 'revised_prompt'),
    size: getStringValue(event, 'size'),
    quality: getStringValue(event, 'quality'),
    output_format: getStringValue(event, 'output_format'),
    output_compression: getNumberValue(event, 'output_compression'),
    moderation: getStringValue(event, 'moderation'),
  }
}

async function parseImagesApiStreamResponse(
  response: Response,
  mime: string,
  onPartialImage?: CallApiOptions['onPartialImage'],
  signal?: AbortSignal,
): Promise<CallApiResult> {
  const completedItems: ImageResponseItem[] = []
  let resultPayload: ImageApiResponse | null = null

  await readJsonServerSentEvents(response, (event) => {
    const type = getStringValue(event, 'type')
    const object = getStringValue(event, 'object')
    if (type === 'image_generation.partial_image' || type === 'image_edit.partial_image') {
      const b64 = getStringValue(event, 'b64_json')
      if (b64) {
        onPartialImage?.({
          image: normalizeBase64Image(b64, mime),
          partialImageIndex: getNumberValue(event, 'partial_image_index'),
        })
      }
      return
    }

    if (object === 'image.generation.result' || object === 'image.edit.result') {
      resultPayload = normalizeImageApiPayload(event)
      return
    }

    if (type === 'image_generation.completed' || type === 'image_edit.completed') {
      completedItems.push(eventToImageResponseItem(event))
    }
  }, {
    signals: [signal],
    formatErrorMessage: appendStreamingFormatHint,
    getEventErrorMessage: getStreamEventErrorMessage,
  })

  if (resultPayload) {
    return parseImagesApiResponse(resultPayload, mime)
  }

  if (!completedItems.length) {
    throw new Error(t('流式接口未返回最终图片数据', 'The streaming API returned no final image data'))
  }

  const images: string[] = []
  const rawImageUrls = completedItems.map((item) => item.url).filter(isHttpUrl)
  try {
    for (const item of completedItems) {
      if (item.b64_json) {
        images.push(normalizeBase64Image(item.b64_json, mime))
        continue
      }
      if (isHttpUrl(item.url) || isDataUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(item.url, mime, signal))
      }
    }
  } catch (err) {
    if (rawImageUrls.length > 0 && err instanceof Error) {
      (err as any).rawImageUrls = rawImageUrls
    }
    throw err
  }
  if (!images.length) throw new Error(t('流式接口未返回可用图片数据', 'The streaming API returned no usable image data'))

  const actualParamsList = completedItems.map((item) => mergeActualParams(pickActualParams(item)))
  const actualParams = mergeActualParams(
    actualParamsList[0],
    images.length > 1 ? { n: images.length } : undefined,
  )
  return {
    images,
    actualParams,
    actualParamsList,
    revisedPrompts: completedItems.map((item) => item.revised_prompt),
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

function getResponsesStreamPayload(event: Record<string, unknown>): ResponsesApiResponse | null {
  const response = event.response
  if (isRecordValue(response)) return response as ResponsesApiResponse

  const item = event.item
  if (isRecordValue(item) && item.type === 'image_generation_call') {
    return { output: [item as ResponsesOutputItem] }
  }

  return null
}

async function parseResponsesApiStreamResponse(
  response: Response,
  mime: string,
  onPartialImage?: CallApiOptions['onPartialImage'],
): Promise<CallApiResult> {
  let completedPayload: ResponsesApiResponse | null = null
  const outputItems: ResponsesOutputItem[] = []

  await readJsonServerSentEvents(response, (event) => {
    const type = getStringValue(event, 'type')
    if (type === 'response.image_generation_call.partial_image') {
      const b64 = getStringValue(event, 'partial_image_b64')
      if (b64) {
        onPartialImage?.({
          image: normalizeBase64Image(b64, mime),
          partialImageIndex: getNumberValue(event, 'partial_image_index'),
        })
      }
      return
    }

    const payload = getResponsesStreamPayload(event)
    if (!payload) return

    if (type === 'response.output_item.done' && Array.isArray(payload.output)) {
      outputItems.push(...payload.output)
      return
    }

    completedPayload = payload
  }, {
    formatErrorMessage: appendStreamingFormatHint,
    getEventErrorMessage: getStreamEventErrorMessage,
  })

  const payload = completedPayload ?? (outputItems.length ? { output: outputItems } : null)
  if (!payload) throw new Error(t('流式接口未返回最终图片数据', 'The streaming API returned no final image data'))

  let imageResults: ReturnType<typeof parseResponsesImageResults>
  try {
    imageResults = parseResponsesImageResults(payload, mime)
  } catch (err) {
    const collectedImageItems = outputItems.filter((item) => getResponsesImageResultBase64(item.result))
    if (collectedImageItems.length === 0) throw err
    imageResults = parseResponsesImageResults({ output: collectedImageItems }, mime)
  }
  const actualParams = mergeActualParams(imageResults[0]?.actualParams ?? {})
  return {
    images: imageResults.map((result) => result.image),
    actualParams,
    actualParamsList: imageResults.map((result) => mergeActualParams(result.actualParams ?? {})),
    revisedPrompts: imageResults.map((result) => result.revisedPrompt),
  }
}

export async function callOpenAICompatibleImageApi(opts: CallApiOptions, profile: ApiProfile, customProvider?: CustomProviderDefinition | null): Promise<CallApiResult> {
  if (customProvider) {
    const n = opts.params.n > 0 ? opts.params.n : 1
    const submitMapping = opts.inputImageDataUrls.length > 0 && customProvider.editSubmit
      ? customProvider.editSubmit
      : customProvider.submit
    const isAsync = Boolean(submitMapping.taskIdPath)
    if (profile.codexCli && n > 1 && !isAsync) return callCustomHttpImageApiConcurrent(opts, profile, customProvider, n)
    return callCustomHttpImageApi(opts, profile, customProvider)
  }

  return profile.apiMode === 'responses'
    ? callResponsesImageApi(opts, profile)
    : callImagesApi(opts, profile)
}

async function callImagesApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  const protocol = getImageProtocol(profile)
  if (protocol === 'openai' && (profile.codexCli || (profile.streamImages && n > 1)) && n > 1) {
    return callImagesApiConcurrent(opts, profile, n)
  }

  return callImagesApiSingle(opts, profile)
}

async function callImagesApiConcurrent(opts: CallApiOptions, profile: ApiProfile, n: number): Promise<CallApiResult> {
  const singleOpts = {
    ...opts,
    params: {
      ...opts.params,
      n: 1,
      ...(profile.codexCli ? { quality: 'auto' as const } : {}),
    },
  }
  const results = await Promise.allSettled(
    Array.from({ length: n }).map((_, requestIndex) => callImagesApiSingle({
      ...singleOpts,
      onPartialImage: opts.onPartialImage
        ? (partial) => opts.onPartialImage?.({ ...partial, requestIndex })
        : undefined,
    }, profile)),
  )

  return mergeConcurrentApiResults(results)
}

async function callImagesApiSingle(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const { prompt: originalPrompt, params, inputImageDataUrls } = opts
  const protocol = getImageProtocol(profile)
  const sizePrompt = profile.codexCli && !opts.skipCodexCliSizePrompt
    ? prependCodexCliSizePrompt(originalPrompt, params.size)
    : originalPrompt
  const prompt = profile.codexCli && !opts.settings.allowPromptRewrite
    ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${sizePrompt}`
    : sizePrompt
  const isEdit = inputImageDataUrls.length > 0
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const requestHeaders = createRequestHeaders(profile)
  const paths = createOpenAICompatiblePaths()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  const abortFromCaller = () => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    let response: Response

    if (protocol === 'seedream' || protocol === 'qwen') {
      const request = await createNativeJsonImageRequest(opts, profile, protocol)
      response = await fetch(request.url, {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
    } else if (isEdit) {
      const formData = new FormData()
      formData.append('model', profile.model)
      formData.append('prompt', prompt)
      if (!profile.codexCli) {
        formData.append('size', params.size)
      }
      formData.append('output_format', params.output_format)
      formData.append('moderation', params.moderation)
      if (opts.nativeTransparentBackground) {
        formData.append('background', 'transparent')
      }

      if (!profile.codexCli) {
        formData.append('quality', params.quality)
      }

      if (params.output_format !== 'png' && params.output_compression != null) {
        formData.append('output_compression', String(params.output_compression))
      }
      if (params.n > 1) {
        formData.append('n', String(params.n))
      }
      if (profile.responseFormatB64Json) {
        formData.append('response_format', 'b64_json')
      }
      if (profile.streamImages) {
        formData.append('stream', 'true')
        formData.append('partial_images', String(getStreamPartialImages(profile)))
      }

      const imageBlobs: Blob[] = []
      for (let i = 0; i < inputImageDataUrls.length; i++) {
        const dataUrl = inputImageDataUrls[i]
        const blob = opts.maskDataUrl && i === 0
          ? await imageDataUrlToPngBlob(dataUrl)
          : await dataUrlToBlob(dataUrl)
        imageBlobs.push(blob)
      }

      const maskBlob = opts.maskDataUrl ? await maskDataUrlToPngBlob(opts.maskDataUrl) : null
      if (opts.maskDataUrl) {
        assertMaskEditFileSize(t('遮罩主图文件', 'Original image file for mask'), imageBlobs[0]?.size ?? 0)
        assertMaskEditFileSize(t('遮罩文件', 'Mask file'), maskBlob?.size ?? 0)
      }
      assertImageInputPayloadSize(
        imageBlobs.reduce((sum, blob) => sum + blob.size, 0) + (maskBlob?.size ?? 0),
      )

      for (let i = 0; i < imageBlobs.length; i++) {
        const blob = imageBlobs[i]
        const ext = blob.type.split('/')[1] || 'png'
        formData.append('image[]', blob, `input-${i + 1}.${ext}`)
      }

      if (maskBlob) {
        formData.append('mask', maskBlob, 'mask.png')
      }

      response = await fetch(buildApiUrl(profile.baseUrl, paths.editPath, proxyConfig, useApiProxy), {
        method: 'POST',
        headers: requestHeaders,
        cache: 'no-store',
        body: formData,
        signal: controller.signal,
      })
    } else {
      const body: Record<string, unknown> = {
        model: profile.model,
        prompt,
        output_format: params.output_format,
        moderation: params.moderation,
      }

      if (opts.nativeTransparentBackground) {
        body.background = 'transparent'
      }

      if (!profile.codexCli) {
        body.size = params.size
      }

      if (!profile.codexCli) {
        body.quality = params.quality
      }

      if (params.output_format !== 'png' && params.output_compression != null) {
        body.output_compression = params.output_compression
      }
      if (params.n > 1) {
        body.n = params.n
      }
      if (profile.responseFormatB64Json) {
        body.response_format = 'b64_json'
      }
      if (profile.streamImages) {
        body.stream = true
        body.partial_images = getStreamPartialImages(profile)
      }

      response = await fetch(buildApiUrl(profile.baseUrl, paths.generationPath, proxyConfig, useApiProxy), {
        method: 'POST',
        headers: {
          ...requestHeaders,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    }

    if (!response.ok) {
      const errorMessage = await getApiErrorMessage(response)
      throw new Error(maybeAppendStreamingHint(errorMessage, response.status, protocol === 'openai' && profile.streamImages))
    }

    if (protocol === 'openai' && profile.streamImages && isEventStreamResponse(response)) {
      return parseImagesApiStreamResponse(response, mime, opts.onPartialImage, controller.signal)
    }

    const payload = await response.json() as unknown
    return protocol === 'seedream' || protocol === 'qwen'
      ? parseNativeJsonImageResponse(payload, mime, controller.signal, params.output_format)
      : parseImagesApiResponse(payload as ImageApiResponse, mime, controller.signal)
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', abortFromCaller)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function getTaskState(payload: unknown, poll: CustomProviderPollMapping): 'success' | 'failure' | 'pending' {
  const status = getByPath(payload, poll.statusPath)
  const statusText = typeof status === 'string' ? status : String(status ?? '')
  if (poll.successValues.includes(statusText)) return 'success'
  if (poll.failureValues.includes(statusText)) return 'failure'
  return 'pending'
}

function isRecoverablePollingError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isRetryablePollingStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function buildTaskPath(path: string, taskId: string): string {
  return path
    .replace(/\{task_id\}/g, encodeURIComponent(taskId))
    .replace(/\{taskId\}/g, encodeURIComponent(taskId))
}

function resolveTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    return getByPath(context, value.slice(1))
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, context)).filter((item) => item !== undefined && item !== null)
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, resolveTemplateValue(item, context)] as const)
      .filter(([, item]) => item !== undefined && item !== null && (!Array.isArray(item) || item.length > 0))
    return Object.fromEntries(entries)
  }
  return value
}

function createCustomProviderContext(opts: CallApiOptions, profile: ApiProfile) {
  const sizePrompt = profile.codexCli && !opts.skipCodexCliSizePrompt
    ? prependCodexCliSizePrompt(opts.prompt, opts.params.size)
    : opts.prompt
  const prompt = profile.codexCli && !opts.settings.allowPromptRewrite
    ? `${PROMPT_REWRITE_GUARD_PREFIX}\n${sizePrompt}`
    : sizePrompt
  const params = {
    ...opts.params,
    ...(profile.codexCli ? { size: undefined, quality: undefined } : {}),
    ...(opts.nativeTransparentBackground ? { background: 'transparent' } : {}),
  }

  return {
    profile,
    prompt,
    params,
    inputImages: {
      dataUrls: opts.inputImageDataUrls.length ? opts.inputImageDataUrls : undefined,
      count: opts.inputImageDataUrls.length,
    },
    mask: {
      dataUrl: opts.maskDataUrl,
    },
  }
}

function renderQuery(query: Record<string, string> | undefined, context: Record<string, unknown>): Record<string, string> | undefined {
  if (!query) return undefined
  const entries = Object.entries(query)
    .map(([key, value]) => [key, resolveTemplateValue(value, context)] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => [key, String(value)] as const)
  return entries.length ? Object.fromEntries(entries) : undefined
}

async function createCustomMultipartBody(mapping: CustomProviderSubmitMapping, opts: CallApiOptions, context: Record<string, unknown>): Promise<FormData> {
  const formData = new FormData()
  const body = resolveTemplateValue(mapping.body ?? {}, context)
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) formData.append(key, String(item))
      } else {
        formData.append(key, String(value))
      }
    }
  }

  const needsInputImages = mapping.files?.some((file) => file.source === 'inputImages')
  const needsMask = mapping.files?.some((file) => file.source === 'mask')
  const imageBlobs: Blob[] = []
  if (needsInputImages) {
    for (let i = 0; i < opts.inputImageDataUrls.length; i++) {
      const dataUrl = opts.inputImageDataUrls[i]
      const blob = opts.maskDataUrl && i === 0 ? await imageDataUrlToPngBlob(dataUrl) : await dataUrlToBlob(dataUrl)
      imageBlobs.push(blob)
    }
  }
  const maskBlob = needsMask && opts.maskDataUrl ? await maskDataUrlToPngBlob(opts.maskDataUrl) : null
  if (opts.maskDataUrl && (needsInputImages || needsMask)) {
    assertMaskEditFileSize(t('遮罩主图文件', 'Original image file for mask'), imageBlobs[0]?.size ?? 0)
    assertMaskEditFileSize(t('遮罩文件', 'Mask file'), maskBlob?.size ?? 0)
  }
  assertImageInputPayloadSize(imageBlobs.reduce((sum, blob) => sum + blob.size, 0) + (maskBlob?.size ?? 0))

  for (const file of mapping.files ?? []) {
    if (file.source === 'inputImages') {
      for (let i = 0; i < imageBlobs.length; i++) {
        const blob = imageBlobs[i]
        const ext = blob.type.split('/')[1] || 'png'
        formData.append(file.field, blob, `input-${i + 1}.${ext}`)
      }
    } else if (file.source === 'mask' && maskBlob) {
      formData.append(file.field, maskBlob, 'mask.png')
    }
  }

  return formData
}

async function extractCustomImages(payload: unknown, result: CustomProviderResultMapping, mime: string, signal?: AbortSignal): Promise<CallApiResult> {
  const images: string[] = []
  const imageUrls = (result.imageUrlPaths ?? []).flatMap((path) =>
    getAllByPath(payload, path).filter((value): value is string => isHttpUrl(value) || isDataUrl(value)),
  )
  const rawImageUrls = imageUrls.filter(isHttpUrl)
  try {
    for (const path of result.b64JsonPaths ?? []) {
      for (const value of getAllByPath(payload, path)) {
        if (typeof value === 'string' && value.trim()) images.push(normalizeBase64Image(value, mime))
      }
    }
    for (const url of imageUrls) {
      images.push(await fetchImageUrlAsDataUrl(url, mime, signal))
    }
  } catch (err) {
    if (rawImageUrls.length > 0 && err instanceof Error) {
      (err as any).rawImageUrls = rawImageUrls
    }
    throw err
  }

  if (!images.length) {
    const err = new Error(t('接口没有返回可识别的图片数据，请查看原始响应内容确认接口实际返回的数据结构，并根据 API 文档调整「自定义服务商」配置中的结果提取路径。', 'The API returned no recognizable image data. Check the raw response and adjust the custom provider result extraction paths using the API documentation.'))
    ;(err as any).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }
  return { images, ...(rawImageUrls.length ? { rawImageUrls } : {}) }
}

async function submitCustomRequest(mapping: CustomProviderSubmitMapping, opts: CallApiOptions, profile: ApiProfile, controller: AbortController, proxyConfig: ReturnType<typeof readClientDevProxyConfig>, useApiProxy: boolean): Promise<unknown> {
  const requestHeaders = createRequestHeaders(profile)
  const context = createCustomProviderContext(opts, profile)
  const method = mapping.method ?? 'POST'
  const contentType = mapping.contentType ?? 'json'
  const path = appendQuery(mapping.path, renderQuery(mapping.query, context))
  const headers: Record<string, string> = { ...requestHeaders }
  let body: BodyInit | undefined

  if (method !== 'GET') {
    if (contentType === 'multipart') {
      const formData = await createCustomMultipartBody(mapping, opts, context)
      if (profile.responseFormatB64Json) {
        formData.append('response_format', 'b64_json')
      }
      body = formData
    } else {
      assertImageInputPayloadSize(
        opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0) +
          (opts.maskDataUrl ? getDataUrlEncodedByteSize(opts.maskDataUrl) : 0),
      )
      headers['Content-Type'] = 'application/json'
      const resolved = resolveTemplateValue(mapping.body ?? {}, context)
      if (profile.responseFormatB64Json && resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
        (resolved as Record<string, unknown>).response_format = 'b64_json'
      }
      body = JSON.stringify(resolved)
    }
  }

  const response = await fetch(buildApiUrl(profile.baseUrl, path, proxyConfig, useApiProxy), {
    method,
    headers,
    cache: 'no-store',
    body,
    signal: controller.signal,
  })

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response)
    throw new Error(maybeAppendStreamingHint(errorMessage, response.status, profile.streamImages))
  }
  return response.json()
}

async function pollCustomTaskResult(
  profile: ApiProfile,
  poll: CustomProviderPollMapping,
  taskId: string,
  mime: string,
  signal?: AbortSignal,
): Promise<CallApiResult> {
  const proxyConfig = readClientDevProxyConfig()
  const requestHeaders = createRequestHeaders(profile)
  let isFirstPoll = true

  while (true) {
    if (isFirstPoll) {
      isFirstPoll = false
    } else if (signal) {
      await sleep((poll.intervalSeconds ?? 5) * 1000, signal)
    } else {
      await new Promise((resolve) => setTimeout(resolve, (poll.intervalSeconds ?? 5) * 1000))
    }

    const taskPath = appendQuery(buildTaskPath(poll.path, taskId), poll.query)
    let taskPayload: unknown
    try {
      const taskResponse = await fetch(buildApiUrl(profile.baseUrl, taskPath, proxyConfig, false), {
        method: poll.method ?? 'GET',
        headers: requestHeaders,
        cache: 'no-store',
        signal,
      })

      if (!taskResponse.ok) {
        if (isRetryablePollingStatus(taskResponse.status)) continue
        throw new Error(await getApiErrorMessage(taskResponse))
      }

      taskPayload = await taskResponse.json()
    } catch (err) {
      if (!signal?.aborted && isRecoverablePollingError(err)) continue
      throw err
    }

    const state = getTaskState(taskPayload, poll)
    if (state === 'failure') {
      const message = getByPath(taskPayload, poll.errorPath) || getByPath(taskPayload, 'message') || getByPath(taskPayload, 'data.fail_reason') || getByPath(taskPayload, 'error.message')
      const errorMessage = typeof message === 'string' && message.trim() ? message : t('异步任务失败', 'Asynchronous task failed')
      throw new Error(maybeAppendTransparentBackgroundHint(errorMessage))
    }
    if (state === 'success') {
      try {
        return await extractCustomImages(taskPayload, poll.result, mime, signal)
      } catch (err) {
        if (!signal?.aborted && isRecoverablePollingError(err)) continue
        throw err
      }
    }
  }
}

export async function getCustomQueuedImageResult(
  profile: ApiProfile,
  customProvider: CustomProviderDefinition,
  taskId: string,
  params: TaskParams,
): Promise<CallApiResult> {
  if (!customProvider.poll) throw new Error(t('自定义异步任务缺少 poll 配置', 'The custom asynchronous task has no poll settings'))
  const mime = MIME_MAP[params.output_format] || 'image/png'
  return pollCustomTaskResult(profile, customProvider.poll, taskId, mime)
}

async function callCustomHttpImageApi(opts: CallApiOptions, profile: ApiProfile, customProvider: CustomProviderDefinition): Promise<CallApiResult> {
  const { params, inputImageDataUrls } = opts
  const isEdit = inputImageDataUrls.length > 0
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    const proxyConfig = readClientDevProxyConfig()
    const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
    const submitMapping = isEdit && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
    if (useApiProxy && (submitMapping.method ?? 'POST') !== 'POST') {
      throw new Error(t('API 代理暂不支持使用 GET 提交的自定义服务商。请关闭 API 代理，或改用 POST 提交的自定义服务商配置。', 'The API proxy does not support custom providers that submit using GET. Disable the proxy or use a provider that submits using POST.'))
    }
    if (useApiProxy && (submitMapping.taskIdPath || customProvider.poll)) {
      throw new Error(t('API 代理暂不支持使用异步任务的自定义服务商。请关闭 API 代理，或改用同步返回图片的自定义服务商配置。', 'The API proxy does not support asynchronous custom providers. Disable the proxy or use a provider that returns images synchronously.'))
    }
    const submitPayload = await submitCustomRequest(submitMapping, opts, profile, controller, proxyConfig, useApiProxy)
    const taskIdValue = submitMapping.taskIdPath ? getByPath(submitPayload, submitMapping.taskIdPath) : undefined
    const taskId = typeof taskIdValue === 'string' ? taskIdValue.trim() : String(taskIdValue ?? '').trim()
    if (submitMapping.taskIdPath && !taskId) {
      const err = new Error(t('无法从响应中提取异步任务 ID，请查看原始响应内容确认接口实际返回的数据结构，并根据 API 文档调整「自定义服务商」配置中的 taskIdPath。', 'Cannot extract the asynchronous task ID. Check the raw response and adjust taskIdPath in the custom provider settings using the API documentation.'))
      ;(err as any).rawResponsePayload = JSON.stringify(submitPayload, null, 2)
      throw err
    }
    if (!taskId) return extractCustomImages(submitPayload, submitMapping.result ?? {}, mime, controller.signal)
    if (!customProvider.poll) throw new Error(t('异步接口返回了 task_id，但服务商配置缺少 poll', 'The asynchronous API returned task_id, but the provider has no poll settings'))
    opts.onCustomTaskEnqueued?.({ taskId })
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    return pollCustomTaskResult(profile, customProvider.poll, taskId, mime, controller.signal)
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function mergeConcurrentApiResults(results: PromiseSettledResult<CallApiResult>[]): CallApiResult {
  const successfulResults = results
    .filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled')
    .map((result) => result.value)
  if (!successfulResults.length) {
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')!
    throw firstError.reason
  }

  const images = successfulResults.flatMap((result) => result.images)
  const actualParamsList = successfulResults.flatMap((result) =>
    result.actualParamsList?.length ? result.actualParamsList : result.images.map(() => result.actualParams),
  )
  const revisedPrompts = successfulResults.flatMap((result) =>
    result.revisedPrompts?.length ? result.revisedPrompts : result.images.map(() => undefined),
  )
  const rawImageUrls = successfulResults.flatMap((result) => result.rawImageUrls ?? [])
  const failedRequests = results.flatMap((result, requestIndex) =>
    result.status === 'rejected' ? [{ requestIndex, error: getErrorMessage(result.reason) }] : [],
  )

  return {
    images,
    actualParams: mergeActualParams(successfulResults[0].actualParams ?? {}, { n: images.length }),
    actualParamsList,
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
    ...(failedRequests.length ? { failedRequests } : {}),
  }
}

async function callCustomHttpImageApiConcurrent(
  opts: CallApiOptions,
  profile: ApiProfile,
  customProvider: CustomProviderDefinition,
  n: number,
): Promise<CallApiResult> {
  const results = await Promise.allSettled(Array.from({ length: n }).map(() => callCustomHttpImageApi({
    ...opts,
    params: { ...opts.params, n: 1 },
  }, profile, customProvider)))
  return mergeConcurrentApiResults(results)
}

async function callResponsesImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  if (n === 1) {
    return callResponsesImageApiSingle(opts, profile)
  }

  const promises = Array.from({ length: n }).map((_, requestIndex) => callResponsesImageApiSingle({
    ...opts,
    onPartialImage: opts.onPartialImage
      ? (partial) => opts.onPartialImage?.({ ...partial, requestIndex })
      : undefined,
  }, profile))
  const results = await Promise.allSettled(promises)
  return mergeConcurrentApiResults(results)
}

async function callResponsesImageApiSingle(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const { prompt, params, inputImageDataUrls } = opts
  const requestPrompt = profile.codexCli && !opts.skipCodexCliSizePrompt
    ? prependCodexCliSizePrompt(prompt, params.size)
    : prompt
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(profile.apiProxy, proxyConfig)
  const requestHeaders = createRequestHeaders(profile)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)

  try {
    if (opts.maskDataUrl) {
      assertMaskEditFileSize(t('遮罩主图文件', 'Original image file for mask'), getDataUrlDecodedByteSize(inputImageDataUrls[0] ?? ''))
      assertMaskEditFileSize(t('遮罩文件', 'Mask file'), getDataUrlDecodedByteSize(opts.maskDataUrl))
    }
    assertImageInputPayloadSize(
      inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0) +
        (opts.maskDataUrl ? getDataUrlEncodedByteSize(opts.maskDataUrl) : 0),
    )

    const body: Record<string, unknown> = {
      model: profile.model,
      input: createResponsesInput(requestPrompt, inputImageDataUrls, opts.settings.allowPromptRewrite),
      tools: [createResponsesImageTool(params, inputImageDataUrls.length > 0, profile, opts.maskDataUrl, opts.nativeTransparentBackground)],
      tool_choice: 'required',
    }
    if (profile.reasoningEffort) body.reasoning = { effort: profile.reasoningEffort }
    if (profile.streamImages) {
      body.stream = true
    }

    const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxyConfig, useApiProxy), {
      method: 'POST',
      headers: {
        ...requestHeaders,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorMessage = await getApiErrorMessage(response)
      throw new Error(maybeAppendStreamingHint(maybeAppendImageToolDroppedHint(errorMessage), response.status, profile.streamImages))
    }

    if (profile.streamImages && isEventStreamResponse(response)) {
      return parseResponsesApiStreamResponse(response, mime, opts.onPartialImage)
    }

    const payload = await response.json() as ResponsesApiResponse
    const imageResults = parseResponsesImageResults(payload, mime)
    const actualParams = mergeActualParams(
      imageResults[0]?.actualParams ?? {},
    )
    return {
      images: imageResults.map((result) => result.image),
      actualParams,
      actualParamsList: imageResults.map((result) =>
        mergeActualParams(result.actualParams ?? {}),
      ),
      revisedPrompts: imageResults.map((result) => result.revisedPrompt),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function getNativeImagesEndpoint(profile: ApiProfile, protocol: 'seedream' | 'qwen'): string {
  const base = profile.baseUrl.trim().replace(/\/+$/, '')
  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(base) ? base : `https://${base}`
  const url = new URL(input)
  let path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/images/generations')) return url.href
  if (!path) path = protocol === 'seedream' ? '/api/v3' : '/compatible-mode/v1'
  url.pathname = `${path}/images/generations`
  return url.href
}

function getSeedreamModelInfo(model: string) {
  const id = model.toLowerCase()
  const tier = /seedream-5[.-]0-(pro|flash|lite)(?:-|$)/.exec(id)?.[1]
  const is45 = /seedream-4[.-]5(?:-|$)/.test(id)
  const is4 = /seedream-4(?:[.-]0)?(?:-|$)/.test(id)
  return {
    tier,
    isKnownV5: Boolean(tier),
    supportsTransparency: tier === 'pro' || tier === 'flash',
    maxImages: tier === 'pro' || tier === 'flash' || !tier && !is45 && !is4 ? 10 : 14,
    minPixels: tier === 'lite' || is45 ? 3686400 : 921600,
    maxPixels: tier === 'pro' || tier === 'flash' || !tier && !is45 && !is4 ? 4624220 : 16777216,
  }
}

function getSizeDimensions(size: string): [number, number] | null {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

function validateNativeOutputSize(size: string, protocol: 'seedream' | 'qwen', profile: ApiProfile) {
  if (size === 'auto') return
  const dimensions = getSizeDimensions(size)
  if (!dimensions) throw new Error(t('图片尺寸格式无效，请使用“宽x高”。', 'Invalid image size. Use “widthxheight”.'))
  const [width, height] = dimensions
  const pixels = width * height
  const ratio = width / height
  if (protocol === 'seedream') {
    const model = getSeedreamModelInfo(profile.model)
    if (ratio < 1 / 16 || ratio > 16 || pixels < model.minPixels || pixels > model.maxPixels) {
      throw new Error(t(`Seedream 当前模型不支持 ${size}。请使用符合该模型像素数与 1:16 至 16:1 比例范围的尺寸。`, `Seedream does not support ${size}. Choose dimensions within this model's pixel limits and 1:16 to 16:1 aspect ratio.`))
    }
    return
  }
  if (pixels < 262144 || pixels > 4194304 || ratio < 1 / 8 || ratio > 8) {
    throw new Error(t(`Qwen-Image 不支持 ${size}。请使用 262144–4194304 像素、最长边不超过 8000 且宽高比在 1:8 至 8:1 范围内的尺寸。`, `Qwen-Image does not support ${size}. Use 262,144–4,194,304 pixels, sides up to 8,000, and a 1:8 to 8:1 aspect ratio.`))
  }
}

async function createNativeJsonImageRequest(opts: CallApiOptions, profile: ApiProfile, protocol: 'seedream' | 'qwen') {
  if (opts.maskDataUrl) throw new Error(t(`${protocol === 'seedream' ? 'Seedream' : 'Qwen-Image'} 不支持遮罩编辑。`, `${protocol === 'seedream' ? 'Seedream' : 'Qwen-Image'} does not support mask editing.`))
  if (protocol === 'qwen' && opts.nativeTransparentBackground) {
    throw new Error(t('Qwen-Image 不支持原生透明背景，请改用本地透明背景处理。', 'Qwen-Image does not support native transparent backgrounds. Use local transparency processing.'))
  }
  if (protocol === 'seedream' && opts.params.output_format === 'webp') {
    throw new Error(t('Seedream 不支持 WebP 输出，请改用 PNG 或 JPEG。', 'Seedream does not support WebP output. Choose PNG or JPEG.'))
  }

  const proxyConfig = readClientDevProxyConfig()
  if (shouldUseApiProxy(profile.apiProxy, proxyConfig)) {
    throw new Error(t('当前 API 代理不支持该图片协议路径，请关闭 API 代理或配置直连。', 'The current API proxy does not support this image protocol path. Disable API proxy or configure a direct connection.'))
  }
  validateNativeOutputSize(opts.params.size, protocol, profile)

  const blobs = await Promise.all(opts.inputImageDataUrls.map((dataUrl) => dataUrlToBlob(dataUrl)))
  const images = await Promise.all(opts.inputImageDataUrls.map((dataUrl) => loadImage(dataUrl)))
  assertImageInputPayloadSize(blobs.reduce((sum, blob) => sum + blob.size, 0))
  if (protocol === 'seedream') {
    const model = getSeedreamModelInfo(profile.model)
    if (opts.inputImageDataUrls.length > model.maxImages) throw new Error(t(`Seedream 最多支持 ${model.maxImages} 张参考图。`, `Seedream supports up to ${model.maxImages} reference images.`))
    if (blobs.some((blob) => blob.size > 30 * 1024 * 1024)) throw new Error(t('Seedream 单张参考图不能超过 30 MB。', 'Seedream reference images cannot exceed 30 MB each.'))
    if (images.some((image) => image.naturalWidth <= 14 || image.naturalHeight <= 14 || image.naturalWidth * image.naturalHeight > 36000000 || image.naturalWidth / image.naturalHeight < 1 / 16 || image.naturalWidth / image.naturalHeight > 16)) throw new Error(t('Seedream 参考图尺寸超出支持范围。', 'Seedream reference image dimensions are outside the supported limits.'))
    if (opts.nativeTransparentBackground) {
      if (!model.supportsTransparency || blobs.length !== 1 || opts.params.output_format !== 'png') {
        throw new Error(t('Seedream 原生透明背景仅支持 5.0 Pro/Flash、单张带透明通道的 PNG 参考图和 PNG 输出。', 'Native Seedream transparency requires 5.0 Pro/Flash, one PNG reference with an alpha channel, and PNG output.'))
      }
      const input = new Uint8Array(await blobs[0].arrayBuffer())
      if (blobs[0].type !== 'image/png' || input.length < 26 || input[0] !== 0x89 || input[1] !== 0x50 || input[2] !== 0x4e || input[3] !== 0x47 || input[12] !== 0x49 || input[13] !== 0x48 || input[14] !== 0x44 || input[15] !== 0x52 || input[25] !== 4 && input[25] !== 6) {
        throw new Error(t('Seedream 原生透明背景需要带透明通道的 PNG 参考图。', 'Native Seedream transparency requires a PNG reference with an alpha channel.'))
      }
    }
  } else {
    const model = profile.model.toLowerCase().replace('models/', '')
    const maxImages = model.startsWith('qwen-image-2.1') ? 10 : 3
    if (opts.inputImageDataUrls.length > maxImages) throw new Error(t(`该 Qwen-Image 模型最多支持 ${maxImages} 张参考图。`, `This Qwen-Image model supports up to ${maxImages} reference images.`))
    if (blobs.some((blob) => blob.size > 10 * 1024 * 1024)) throw new Error(t('Qwen-Image 单张参考图不能超过 10 MB。', 'Qwen-Image reference images cannot exceed 10 MB each.'))
    if (images.some((image) => image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 8000 || image.naturalHeight > 8000 || image.naturalWidth / image.naturalHeight < 1 / 10 || image.naturalWidth / image.naturalHeight > 10)) throw new Error(t('Qwen-Image 参考图尺寸超出支持范围。', 'Qwen-Image reference image dimensions are outside the supported limits.'))
  }

  const body: Record<string, unknown> = { model: profile.model, prompt: opts.prompt }
  if (opts.inputImageDataUrls.length === 1) body.image = opts.inputImageDataUrls[0]
  if (opts.inputImageDataUrls.length > 1) body.image = opts.inputImageDataUrls
  if (protocol === 'qwen' || opts.params.size !== 'auto') body.size = opts.params.size
  if (protocol === 'qwen') body.n = 1
  if (protocol === 'seedream') {
    const model = getSeedreamModelInfo(profile.model)
    if (model.isKnownV5) body.output_format = opts.params.output_format
    body.response_format = profile.responseFormatB64Json ? 'b64_json' : 'url'
    if (opts.nativeTransparentBackground) body.background = 'transparent'
  }
  return { url: getNativeImagesEndpoint(profile, protocol), body }
}

async function parseNativeJsonImageResponse(
  payload: unknown,
  mime: string,
  signal: AbortSignal,
  requestedFormat: TaskParams['output_format'],
): Promise<CallApiResult> {
  const record = isRecordValue(payload) ? payload : {}
  const safePayload = { ...record, data: Array.isArray(record.data) ? record.data.filter(isRecordValue) : [] } as ImageApiResponse
  const parsed = await parseImagesApiResponse(safePayload, mime, signal)
  const valid = parsed.images.flatMap((image, index) => {
    const data = /^data:[^,]*;base64,([\s\S]+)$/i.exec(image)?.[1]
    const actual = data ? detectBase64ImageFormat(data) : null
    return actual ? [{ image: 'data:' + actual.mimeType + ';base64,' + data, format: actual.format, index }] : []
  })
  if (!valid.length) throw new Error(t('接口返回的数据不是有效的 PNG、JPEG 或 WebP 图片。', 'The API response did not contain a valid PNG, JPEG, or WebP image.'))
  const formats = valid.map((item) => item.format)
  const actualParamsList = formats.map((output_format) => ({ output_format }))
  return {
    ...parsed,
    images: valid.map((item) => item.image),
    actualParams: actualParamsList[0],
    actualParamsList,
    revisedPrompts: valid.map((item) => parsed.revisedPrompts?.[item.index]),
    warnings: formats.some((format) => format !== requestedFormat)
      ? [t(`实际返回 ${[...new Set(formats)].join('、')} 图片，与请求的 ${requestedFormat} 格式不同。`, `The API returned ${[...new Set(formats)].join(', ')} images instead of the requested ${requestedFormat} format.`)]
      : parsed.warnings,
  }
}
