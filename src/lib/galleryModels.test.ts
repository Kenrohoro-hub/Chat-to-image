import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, getActiveApiProfile, getAgentImageApiProfile } from './apiProfiles'
import { getGalleryModelGroups, selectGalleryModel } from './galleryModels'
import { normalizeWorkspaceSettings } from './workspaceSettings'

const first = createDefaultOpenAIProfile({ id: 'first', name: '服务甲', baseUrl: 'https://a.example/v1', apiKey: 'fake-a', apiProxy: false, model: 'default-a', models: ['default-a', 'shared-image'] })
const second = createDefaultOpenAIProfile({ id: 'second', name: '服务乙', baseUrl: 'https://b.example/v1', apiKey: 'fake-b', apiProxy: false, model: 'default-b', models: ['default-b', 'shared-image'] })

describe('gallery service and model selection', () => {
  it('keeps identical model names under distinct services and selects their own connection', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [first, second], activeProfileId: first.id })
    const groups = getGalleryModelGroups(settings)
    expect(groups.map((group) => group.label)).toEqual(['服务甲 · a.example', '服务乙 · b.example'])
    expect(groups.filter((group) => group.models.includes('shared-image'))).toHaveLength(2)
    const patch = selectGalleryModel(settings, second.id, 'shared-image')
    const selected = normalizeWorkspaceSettings({ ...settings, ...patch })
    expect(selected.failover?.primaryId).toBe(second.id)
    expect(getActiveApiProfile(selected)).toMatchObject({ id: second.id, baseUrl: second.baseUrl, apiKey: second.apiKey, model: 'shared-image' })
    expect(selected.profiles.find((profile) => profile.id === second.id)?.model).toBe('default-b')
    expect(getAgentImageApiProfile(selected)?.model).toBe('shared-image')
    expect(normalizeWorkspaceSettings(selected)).toEqual(selected)
    const automatic = normalizeWorkspaceSettings({ ...selected, ...selectGalleryModel(selected, second.id, '') })
    expect(automatic.galleryModel).toBe('')
    expect(getActiveApiProfile(automatic).model).toBe('default-b')
  })

  it('excludes disabled, incomplete and text services and directory-only models', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [first, second, { ...first, id: 'missing-key', apiKey: '' }, { ...first, id: 'text', apiMode: 'responses' }],
      failover: { enabled: true, primaryId: first.id, slots: [first.id, second.id], disabledIds: [second.id] } })
    expect(getGalleryModelGroups(settings).map((group) => group.id)).toEqual([first.id])
    expect(selectGalleryModel(settings, second.id, 'shared-image')).toBeNull()
    expect(selectGalleryModel(settings, first.id, 'directory-only')).toBeNull()
    expect(selectGalleryModel(settings, 'missing', 'shared-image')).toBeNull()
    expect(getGalleryModelGroups(normalizeWorkspaceSettings({}))).toEqual([])
  })

  it('distinguishes profiles with the same name and hostname', () => {
    const groups = getGalleryModelGroups(normalizeWorkspaceSettings({ profiles: [first, { ...first, id: 'other' }] }))
    expect(groups[0].label).not.toBe(groups[1].label)
    expect(groups.map((group) => group.id)).toEqual(['first', 'other'])
  })
})
