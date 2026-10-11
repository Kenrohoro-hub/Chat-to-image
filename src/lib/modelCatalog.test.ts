import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelCatalog, normalizeModelCatalog } from './modelCatalog'
import { createDefaultOpenAIProfile, getActiveApiProfile, getAgentApiCandidates, normalizeSettings } from './apiProfiles'

afterEach(() => vi.unstubAllGlobals())
describe('model discovery and choices', () => {
  it('deduplicates directory IDs without changing selected models', async () => {
    const profile = createDefaultOpenAIProfile({ baseUrl: 'https://example.test/v1', apiKey: 'mock-key', models: ['chosen'], model: 'chosen' })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }, {}] })))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchModelCatalog(profile)).ids).toEqual(['a', 'b'])
    expect(fetch.mock.calls[0][0]).toBe('https://example.test/v1/models')
    expect(profile.models).toEqual(['chosen'])
    expect(fetch.mock.calls[0][1].redirect).toBe('error')
  })
  it('reports refusal and unsupported directories', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(fetchModelCatalog(createDefaultOpenAIProfile({ apiKey: 'mock-key' }))).rejects.toThrow('401')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(fetchModelCatalog(createDefaultOpenAIProfile({ apiKey: 'mock-key' }))).rejects.toThrow('手动添加')
  })
  it('rejects invalid credentials and addresses before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const baseUrl of ['', 'file:///tmp/key', 'https://user:pass@example.test', 'https://example.test?key=secret']) {
      await expect(fetchModelCatalog(createDefaultOpenAIProfile({ baseUrl, apiKey: 'mock-key' }))).rejects.toThrow('地址')
    }
    await expect(fetchModelCatalog(createDefaultOpenAIProfile({ apiKey: '' }))).rejects.toThrow('Key')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps errors safe and specific without suggesting a generation was submitted', async () => {
    const profile = createDefaultOpenAIProfile({ apiKey: 'mock-key' })
    for (const [status, expected] of [[404, '手动添加'], [429, '请求受限'], [503, '服务商暂时不可用']] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret upstream body', { status })))
      await expect(fetchModelCatalog(profile)).rejects.toThrow(expected)
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')))
    await expect(fetchModelCatalog(profile)).rejects.toThrow('未发送生图或对话请求')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>secret</html>')))
    await expect(fetchModelCatalog(profile)).rejects.toThrow('兼容的模型目录')
  })
  it('preserves independent defaults, catalogs and capabilities through settings', () => {
    const image = createDefaultOpenAIProfile({ id: 'image', models: ['first', 'chosen'], model: 'chosen', modelCatalog: { ids: ['chosen'], fetchedAt: 123, stale: true } })
    const text = createDefaultOpenAIProfile({ id: 'text', apiMode: 'responses', models: ['chat-a', 'chat-b'], model: 'chat-b', modelCapabilities: { 'chat-b': { vision: true, tools: false } } })
    const settings = normalizeSettings({ profiles: [image, text], activeProfileId: image.id, galleryModel: 'first', agentModel: 'chat-a' })
    expect(settings.profiles[0].model).toBe('chosen')
    expect(settings.profiles[0].models).toEqual(['first', 'chosen'])
    expect(settings.profiles[0].modelCatalog).toEqual(image.modelCatalog)
    expect(settings.profiles[1].modelCapabilities).toEqual(text.modelCapabilities)
    expect(settings.galleryModel).toBe('first')
    expect(getActiveApiProfile(settings).model).toBe('first')
    expect(getAgentApiCandidates(settings)[0].model).toBe('chat-a')
    expect(normalizeModelCatalog({ ids: ['a', null, ' a '], fetchedAt: 10 })?.ids).toEqual(['a'])
  })
})
