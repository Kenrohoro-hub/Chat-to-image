import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, importCustomProviderSettingsFromJson, normalizeSettings } from './apiProfiles'
import { buildSettingsFromUrlParams } from './urlSettings'

describe('profile settings URL imports', () => {
  it('imports built-in profiles and accepts legacy empty providers', () => {
    const profile = createDefaultOpenAIProfile({ id: 'built-in', apiKey: 'key' })
    const url = new URL('https://playground.example.com')
    url.searchParams.set('settings', JSON.stringify({ profiles: [profile] }))
    const settingsJson = url.searchParams.get('settings')!

    expect(JSON.parse(settingsJson)).not.toHaveProperty('customProviders')
    expect(importCustomProviderSettingsFromJson(settingsJson).profiles).toHaveLength(1)
    expect(buildSettingsFromUrlParams(DEFAULT_SETTINGS, url.searchParams).profiles).toHaveLength(1)

    const legacy = JSON.stringify({ customProviders: [], profiles: JSON.parse(settingsJson).profiles })
    expect(importCustomProviderSettingsFromJson(legacy).profiles).toHaveLength(1)
    expect(buildSettingsFromUrlParams(DEFAULT_SETTINGS, new URLSearchParams({ settings: legacy })).profiles).toHaveLength(1)
  })

  it('imports custom profiles without converting them to OpenAI', () => {
    const provider = { id: 'custom-provider', name: 'Custom Provider', submit: { path: 'generate' } }
    const profile = createDefaultOpenAIProfile({
      provider: provider.id,
      apiKey: 'secret-key',
      model: 'custom-model',
    })
    const url = new URL('https://playground.example.com')
    url.searchParams.set('settings', JSON.stringify({
      customProviders: [provider],
      profiles: [{ ...profile, id: undefined, isDefault: undefined }],
    }))
    const next = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...buildSettingsFromUrlParams(DEFAULT_SETTINGS, url.searchParams),
    })

    expect(next.activeProfileId).not.toBe(profile.id)
    expect(next.customProviders).toEqual([expect.objectContaining({
      id: provider.id,
      submit: expect.objectContaining({ path: 'generate' }),
    })])
    expect(next.profiles[0]).toMatchObject({
      provider: provider.id,
      apiKey: 'secret-key',
      model: 'custom-model',
    })
  })
})
