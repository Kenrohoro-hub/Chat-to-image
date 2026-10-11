import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'
import { validateImageModelParams } from './imageModelCapabilities'
import { callImageApi } from './api'

describe('image model capabilities', () => {
  const profile = createDefaultOpenAIProfile({ model: 'test-image', imageCapabilities: { 'test-image': { sizes: ['512x512'], qualities: ['high'], formats: ['webp'], transparent: false, maxInputImages: 0 } } })
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
  it('persists model rules and adapts draft parameters without applying generic size limits', () => {
    expect(settings.profiles[0].imageCapabilities).toEqual(profile.imageCapabilities)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, transparent_output: true }, settings)).toMatchObject({ size: '512x512', quality: 'high', output_format: 'webp', transparent_output: false })
  })
  it('rejects unsupported requests before submitting and permits local transparency', async () => {
    await expect(callImageApi({ settings, params: DEFAULT_PARAMS, prompt: 'test', inputImageDataUrls: [] })).rejects.toThrow('尺寸')
    const params = { ...DEFAULT_PARAMS, size: '512x512', quality: 'high' as const, output_format: 'webp' as const }
    expect(() => validateImageModelParams(profile, params, 1, false)).toThrow('参考图')
    expect(() => validateImageModelParams(profile, params, 0, true)).toThrow('透明')
    expect(() => validateImageModelParams(profile, params, 0, false)).not.toThrow()
  })
  it('uses the actual image model for Responses and leaves unknown models alone', () => {
    expect(() => validateImageModelParams({ ...profile, model: 'unknown' }, DEFAULT_PARAMS, 16, true)).not.toThrow()
    expect(() => validateImageModelParams({ ...profile, model: 'chat', apiMode: 'responses', imageGenerationModel: 'test-image' }, DEFAULT_PARAMS, 0, false)).toThrow('尺寸')
  })
})
