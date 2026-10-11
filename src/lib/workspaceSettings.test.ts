import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, getAgentTextApiProfile } from './apiProfiles'
import { normalizeWorkspaceSettings } from './workspaceSettings'

const gallery = createDefaultOpenAIProfile({ id: 'gallery', apiKey: 'mock-gallery', apiProxy: false })
const agent = createDefaultOpenAIProfile({ id: 'agent', apiMode: 'responses', model: 'gpt-test', apiKey: 'mock-agent', apiProxy: false })

describe('separate workspace API groups', () => {
  it('keeps a gallery choice separate from the service default and Agent models', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [{ ...gallery, model: 'default-image', models: ['default-image', 'chosen-image'] }, agent], activeProfileId: gallery.id, galleryModel: 'chosen-image' })
    expect(settings.galleryModel).toBe('chosen-image')
    expect(settings.profiles[0].model).toBe('default-image')
    expect(getAgentTextApiProfile(settings)?.model).toBe(agent.model)
    expect(normalizeWorkspaceSettings(settings)).toEqual(settings)
    expect(normalizeWorkspaceSettings({ ...settings, galleryModel: 'removed-model' }).galleryModel).toBe('')
  })
  it('moves a legacy active Responses profile into Agent without changing its credentials', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [agent], activeProfileId: agent.id })
    expect(settings.profiles.find((p) => p.id === agent.id)).toMatchObject(agent)
    expect(settings.activeProfileId).not.toBe(agent.id)
    expect(settings.agentTextProfileId).toBe(agent.id)
    expect(settings.agentApiConfigMode).toBe('native')
    expect(settings.agentFailover?.slots).toEqual(['agent'])
    expect(settings.failover?.slots).toEqual([settings.activeProfileId])
    expect(normalizeWorkspaceSettings(settings)).toEqual(settings)
  })
  it('preserves two independent dynamic groups without truncating stored configurations', () => {
    const profiles = Array.from({ length: 6 }, (_, i) => [{ ...gallery, id: `g${i}` }, { ...agent, id: `a${i}` }]).flat()
    const settings = normalizeWorkspaceSettings({ profiles, activeProfileId: 'g3', agentTextProfileId: 'a2' })
    expect(settings.profiles).toHaveLength(12)
    expect(settings.failover?.slots).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5'])
    expect(settings.agentFailover?.slots).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'])
    expect(settings.activeProfileId).toBe('g3')
    expect(settings.agentFailover?.primaryId).toBe('a2')
  })
  it('does not change the gallery when editing Agent and respects disabled Agent primary', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [gallery, agent], activeProfileId: gallery.id,
      agentFailover: { enabled: false, primaryId: agent.id, slots: [agent.id], disabledIds: [agent.id] } })
    expect(settings.activeProfileId).toBe(gallery.id)
    expect(getAgentTextApiProfile(settings)).toBeNull()
    expect(settings.failover?.disabledIds).toEqual([])
    const enabled = normalizeWorkspaceSettings({ ...settings, agentFailover: { ...settings.agentFailover!, disabledIds: [] } })
    expect(getAgentTextApiProfile(enabled)?.id).toBe(agent.id)
    expect(enabled.failover).toEqual(settings.failover)
  })
  it('persists a cleaned model list and chat choices without affecting gallery settings', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [gallery, { ...agent, models: [' chat-a ', 'chat-b', 'chat-a', ''] }], agentModel: 'chat-b', agentImageTools: true })
    expect(settings.profiles.find((p) => p.id === agent.id)?.models).toEqual(['chat-a', 'chat-b'])
    expect(getAgentTextApiProfile(settings)?.model).toBe('chat-b')
    expect(settings.profiles.find((p) => p.id === gallery.id)).toMatchObject(gallery)
    expect(normalizeWorkspaceSettings(settings)).toEqual(settings)
    expect(normalizeWorkspaceSettings({ profiles: [gallery, agent] }).agentImageTools).toBe(true)
  })
  it('removes cross-group references while preserving valid order and disablement', () => {
    const settings = normalizeWorkspaceSettings({ profiles: [gallery, agent], activeProfileId: gallery.id,
      agentFailover: { enabled: true, primaryId: gallery.id, slots: [gallery.id, agent.id, 'missing'], disabledIds: [gallery.id, agent.id] } })
    expect(settings.agentFailover).toEqual({ enabled: true, primaryId: agent.id, slots: [agent.id], disabledIds: [agent.id] })
    expect(settings.failover?.slots).toEqual([gallery.id])
  })
})
