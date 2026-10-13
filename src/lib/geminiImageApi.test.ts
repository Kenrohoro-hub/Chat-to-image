import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { callImageApi } from './api'
import { usesGeminiImageApi } from './geminiImageApi'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

function settingsFor(profile: ReturnType<typeof createDefaultOpenAIProfile>) {
  return normalizeSettings({ activeProfileId: profile.id, profiles: [profile] })
}

describe('Gemini image API', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses Gemini for auto Gemini models but honors explicit OpenAI protocol', () => {
    const profile = createDefaultOpenAIProfile({ model: 'models/gemini-3-pro-image-preview' })
    expect(usesGeminiImageApi(profile)).toBe(true)
    expect(usesGeminiImageApi({ ...profile, imageProtocol: 'openai' })).toBe(false)
    expect(usesGeminiImageApi({ ...profile, imageProtocol: 'gemini', provider: 'fal' })).toBe(false)
  })

  it('sends native Gemini generateContent requests with image references and mapped size', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'gemini',
      baseUrl: 'https://gemini.example/v1beta/',
      apiKey: 'secret-key',
      model: 'models/gemini-3-pro-image-preview',
      imageProtocol: 'gemini',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).startsWith('data:')) return new Response(new Blob([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], { type: 'image/png' }))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }))
    })

    const result = await callImageApi({
      settings: settingsFor(profile),
      prompt: 'make a variation',
      params: { ...DEFAULT_PARAMS, size: '1024x1536', output_format: 'jpeg' },
      inputImageDataUrls: [`data:image/png;base64,${png}`],
    })

    const [url, init] = fetchMock.mock.calls[1]
    const body = JSON.parse(String(init?.body))
    expect(url).toBe('https://gemini.example/v1beta/models/gemini-3-pro-image-preview:generateContent')
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'secret-key' })
    expect(String(url)).not.toContain('secret-key')
    expect(body.contents[0].parts).toEqual([
      { text: 'make a variation' },
      { inlineData: { mimeType: 'image/png', data: png } },
    ])
    expect(body.generationConfig).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '2:3', imageSize: '1K' },
    })
    expect(JSON.stringify(body)).not.toMatch(/quality|output_format/)
    expect(result.images[0]).toBe(`data:image/png;base64,${png}`)
    expect(result.actualParams?.output_format).toBe('png')
    expect(result.actualParams?.size).toBeUndefined()
    expect(result.warnings?.[0]).toContain('jpeg')
  })

  it('accepts snake_case response parts and omits imageConfig for auto size', async () => {
    const profile = createDefaultOpenAIProfile({ imageProtocol: 'gemini', model: 'gemini-image' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: png } }] } }],
    })))
    await callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'] })
  })

  it.each([
    ['https://gemini.example', 'https://gemini.example/v1beta/models/gemini-image:generateContent'],
    ['https://gemini.example/v1', 'https://gemini.example/v1beta/models/gemini-image:generateContent'],
    ['https://gemini.example/v1beta', 'https://gemini.example/v1beta/models/gemini-image:generateContent'],
  ])('normalizes Gemini base URL %s', async (baseUrl, expectedUrl) => {
    const profile = createDefaultOpenAIProfile({ imageProtocol: 'gemini', baseUrl, model: 'gemini-image' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: png } }] } }],
    })))
    await callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(fetchMock.mock.calls[0][0]).toBe(expectedUrl)
  })

  it('maps large sizes to the nearest supported ratio and 4K', async () => {
    const profile = createDefaultOpenAIProfile({ imageProtocol: 'gemini', model: 'gemini-image' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: png } }] } }],
    })))
    await callImageApi({
      settings: settingsFor(profile),
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '3000x1000' },
      inputImageDataUrls: [],
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).generationConfig.imageConfig).toEqual({ aspectRatio: '21:9', imageSize: '4K' })
  })
  it('uses an already specified model endpoint without appending another endpoint', async () => {
    const profile = createDefaultOpenAIProfile({
      imageProtocol: 'gemini',
      baseUrl: 'https://gemini.example/v1beta/models/old-model:streamGenerateContent',
      model: 'gemini-3-pro-image-preview',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: png } }] } }],
    })))
    await callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.example/v1beta/models/gemini-3-pro-image-preview:generateContent')
  })

  it('rejects unsupported edits and responses without a real image', async () => {
    const profile = createDefaultOpenAIProfile({ imageProtocol: 'gemini', model: 'gemini-image' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] })))
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [], maskDataUrl: 'mask' })).rejects.toThrow(/遮罩|mask/i)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [], nativeTransparentBackground: true })).rejects.toThrow(/透明背景|transparent/i)
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow(/未返回可识别|no recognizable/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }))
    await expect(callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('bad key')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps an explicitly OpenAI Gemini-named profile on the OpenAI endpoint', async () => {
    const profile = createDefaultOpenAIProfile({
      imageProtocol: 'openai',
      model: 'gemini-3-pro-image-preview',
      apiKey: 'key',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png }] })))
    await callImageApi({ settings: settingsFor(profile), prompt: 'prompt', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer key' })
  })
})
