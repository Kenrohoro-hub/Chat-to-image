import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { getImageProtocol } from './imageProtocol'
import { dataUrlToBlob } from './canvasImage'

vi.mock('./canvasImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canvasImage')>()
  return {
    ...actual,
    dataUrlToBlob: vi.fn(async () => new Blob([new Uint8Array(32)], { type: 'image/png' })),
    loadImage: vi.fn(async () => ({ naturalWidth: 1024, naturalHeight: 1024 }) as HTMLImageElement),
  }
})

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const imageUrl = `data:image/png;base64,${png}`

function settingsFor(profile: ReturnType<typeof createDefaultOpenAIProfile>) {
  return normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
}

function imageResponse() {
  return new Response(JSON.stringify({ data: [{ b64_json: png }] }))
}

describe('native JSON image protocols', () => {
  afterEach(() => vi.restoreAllMocks())

  it('selects explicit and automatic protocols only for OpenAI Images profiles', () => {
    const profile = createDefaultOpenAIProfile({ model: 'doubao-seedream-5-0-pro-260123' })
    expect(getImageProtocol(profile)).toBe('seedream')
    expect(getImageProtocol({ ...profile, imageProtocol: 'openai' })).toBe('openai')
    expect(getImageProtocol({ ...profile, model: 'qwen-image-3.0-pro' })).toBe('qwen')
    expect(getImageProtocol({ ...profile, baseUrl: 'https://ark.cn-beijing.volces.com', model: 'ep-123' })).toBe('seedream')
    expect(getImageProtocol({ ...profile, apiMode: 'responses' })).toBe('openai')
  })

  it('sends Seedream generation as one native JSON request with real format metadata', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: 'secret',
      model: 'doubao-seedream-5-0-pro-260123',
      imageProtocol: 'seedream',
      responseFormatB64Json: true,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => imageResponse())
    const result = await callImageApi({
      settings: settingsFor(profile),
      prompt: 'a paper crane',
      params: { ...DEFAULT_PARAMS, size: '1024x1024', output_format: 'jpeg', n: 3 },
      inputImageDataUrls: [],
    })
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' })
    expect(body).toEqual({
      model: profile.model,
      prompt: 'a paper crane',
      size: '1024x1024',
      output_format: 'jpeg',
      response_format: 'b64_json',
    })
    expect(JSON.stringify(body)).not.toMatch(/quality|moderation|compression|\bn\b|stream/)
    expect(result.images).toEqual([imageUrl, imageUrl, imageUrl])
    expect(result.failedRequests).toEqual([])
    expect(result.actualParams?.output_format).toBe('png')
    expect(result.warnings?.[0]).toContain('jpeg')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(String(init?.body))).not.toHaveProperty('n')
  })

  it('sends Seedream edits to the same JSON endpoint and accepts multiple reference URLs', async () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'seedream-5.0-lite',
      imageProtocol: 'seedream',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    await callImageApi({
      settings: settingsFor(profile),
      prompt: 'combine the references',
      params: { ...DEFAULT_PARAMS, output_format: 'png' },
      inputImageDataUrls: [imageUrl, imageUrl],
    })
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(body.image).toEqual([imageUrl, imageUrl])
    expect(body).not.toHaveProperty('size')
    expect(body).not.toHaveProperty('n')
  })

  it('sends Qwen-Image requests to the official compatible endpoint with image and auto size', async () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com',
      apiKey: 'secret',
      model: 'qwen-image-3.0-pro',
      imageProtocol: 'qwen',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    const result = await callImageApi({
      settings: settingsFor(profile),
      prompt: 'edit these',
      params: { ...DEFAULT_PARAMS, output_format: 'webp' },
      inputImageDataUrls: [imageUrl, imageUrl],
    })
    const [url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(url).toBe('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' })
    expect(body).toEqual({ model: profile.model, prompt: 'edit these', image: [imageUrl, imageUrl], size: 'auto', n: 1 })
    expect(result.images).toEqual([imageUrl])
    expect(result.failedRequests).toBeUndefined()
    expect(result.actualParams?.output_format).toBe('png')
    expect(result.warnings?.[0]).toContain('webp')
  })

  it('respects third-party Qwen v1 paths and rejects unsupported edits before fetch', async () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://relay.example/custom/v1',
      model: 'qwen-image-2.1-pro',
      imageProtocol: 'qwen',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    await callImageApi({ settings: settingsFor(profile), prompt: 'p', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/custom/v1/images/generations')
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: DEFAULT_PARAMS, inputImageDataUrls: [], maskDataUrl: 'mask' })).rejects.toThrow(/遮罩|mask/i)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: DEFAULT_PARAMS, inputImageDataUrls: [], nativeTransparentBackground: true })).rejects.toThrow(/透明背景|transparent/i)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: { ...DEFAULT_PARAMS, size: '6000x1000' }, inputImageDataUrls: [] })).rejects.toThrow(/不支持|does not support/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported Seedream sizes and WebP without retrying failed HTTP requests', async () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      model: 'seedream-4.0',
      imageProtocol: 'seedream',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream error', { status: 503 }))
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: { ...DEFAULT_PARAMS, size: '512x512' }, inputImageDataUrls: [] })).rejects.toThrow(/不支持|does not support/i)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: { ...DEFAULT_PARAMS, output_format: 'webp' }, inputImageDataUrls: [] })).rejects.toThrow(/WebP/)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'p', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('upstream error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicit OpenAI override on the existing Images endpoint', async () => {
    const profile = createDefaultOpenAIProfile({
      model: 'doubao-seedream-5-0-pro-260123',
      imageProtocol: 'openai',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    await callImageApi({ settings: settingsFor(profile), prompt: 'p', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
  })

  it('enables native Seedream transparency only with one alpha PNG on 5.0 Pro/Flash', async () => {
    const profile = createDefaultOpenAIProfile({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'seedream-5.0-pro',
      imageProtocol: 'seedream',
    })
    vi.mocked(dataUrlToBlob).mockResolvedValueOnce(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 16, 0, 0, 0, 16, 8, 6])], { type: 'image/png' }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse())
    await callImageApi({
      settings: settingsFor(profile),
      prompt: 'transparent icon',
      params: { ...DEFAULT_PARAMS, size: '1024x1024', output_format: 'png' },
      inputImageDataUrls: [imageUrl],
      nativeTransparentBackground: true,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).background).toBe('transparent')
  })
})
