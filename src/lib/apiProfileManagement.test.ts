import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, getApiProfileLimitError, normalizeSettings } from './apiProfiles'
import { getAgentPreferences, normalizeAgentPreferences, withConversationPreferences } from './agentPreferences'

describe('dynamic API groups and conversation preferences', () => {
  it('accepts ten per group including disabled profiles and rejects the eleventh', () => {
    const profiles = Array.from({ length: 10 }, (_, i) => [createDefaultOpenAIProfile({ id: `g${i}` }), createDefaultOpenAIProfile({ id: `a${i}`, apiMode: 'responses' })]).flat()
    expect(getApiProfileLimitError(profiles)).toBeNull()
    expect(getApiProfileLimitError([...profiles, createDefaultOpenAIProfile({ id: 'g10' })])).toContain('画廊最多')
    expect(getApiProfileLimitError([...profiles, createDefaultOpenAIProfile({ id: 'a10', apiMode: 'responses' })])).toContain('Agent最多')
    const settings = normalizeSettings({ profiles, failover: { enabled: true, slots: profiles.filter((p) => p.apiMode === 'images').map((p) => p.id), primaryId: 'g9', disabledIds: ['g2'] } })
    expect(settings.failover?.slots).toHaveLength(10)
    expect(settings.failover?.primaryId).toBe('g9')
    expect(settings.failover?.disabledIds).toEqual(['g2'])
    expect(settings.agentFailover?.slots).toHaveLength(10)
  })
  it('preserves oversized historical data while blocking new saves, instead of silently truncating', () => {
    const profiles = Array.from({ length: 11 }, (_, i) => createDefaultOpenAIProfile({ id: `g${i}` }))
    const settings = normalizeSettings({ profiles })
    expect(settings.profiles).toHaveLength(11)
    expect(settings.failover?.slots).toHaveLength(11)
    expect(getApiProfileLimitError(settings.profiles)).toContain('10')
  })
  it('old disabled preferences no longer disable gallery tools, while reasoning is per conversation', () => {
    const settings = normalizeSettings({ agentImageTools: false, agentReasoningEffort: 'low' })
    expect(getAgentPreferences(settings).agentImageTools).toBe(true)
    const preferences = normalizeAgentPreferences({ agentImageTools: false, agentModel: 'chat-b', agentReasoningEffort: 'high' })
    expect(preferences?.agentImageTools).toBe(true)
    expect(withConversationPreferences(settings, { preferences } as Parameters<typeof withConversationPreferences>[1]).agentReasoningEffort).toBe('high')
    expect(normalizeAgentPreferences({ agentReasoningEffort: 'invalid' })?.agentReasoningEffort).toBe('')
  })
})
