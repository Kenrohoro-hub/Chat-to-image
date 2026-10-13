import { describe, expect, it } from 'vitest'
import { filterAgentVisionInput, parseImageToolArguments } from './agentImageTools'
import { normalizeSettings } from './apiProfiles'
import { normalizeAgentConversations } from './agentConversationState'
import { getAgentPreferences, withConversationPreferences } from './agentPreferences'

describe('Agent image boundaries and conversation preferences', () => {
  it('keeps references but removes pixels until vision support is confirmed', () => {
    const input = [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,mock' }, { type: 'input_text', text: '<ref id="image-1" />' }] }]
    const filtered = JSON.stringify(filterAgentVisionInput(input, false))
    expect(filtered).not.toContain('base64')
    expect(filtered).toContain('image-1')
    expect(filtered).toContain('do not claim to see it')
    expect(filterAgentVisionInput(input, true)).toBe(input)
  })
  it('only copies supported explicit image overrides', () => {
    expect(parseImageToolArguments({ prompt: ' draw ', quality: 'invalid', output_format: 'png', transparent_output: true })).toEqual({ id: 'image', prompt: 'draw', params: { output_format: 'png', transparent_output: true } })
    expect(parseImageToolArguments({ prompt: '' })).toBeNull()
  })
  it('accepts only valid explicit image counts', () => {
    expect(parseImageToolArguments({ prompt: 'cat', n: 2 })?.params.n).toBe(2)
    expect(parseImageToolArguments({ prompt: 'cat' })?.params.n).toBeUndefined()
    for (const n of [0, -1, 1.5, 17, '2', null, NaN, Infinity]) {
      expect(parseImageToolArguments({ prompt: 'cat', n })).toBeNull()
    }
  })
  it('persists conversation choices separately from new-conversation defaults', () => {
    const settings = normalizeSettings({ agentModel: 'chat-a', agentWebSearch: false, agentImageTools: false })
    const conversations = normalizeAgentConversations(JSON.parse(JSON.stringify([{ id: 'one', title: 'one', createdAt: 1, updatedAt: 1, rounds: [], messages: [], preferences: { agentModel: 'chat-b', agentWebSearch: true, agentImageTools: true } }])))
    expect(conversations[0].preferences?.agentModel).toBe('chat-b')
    expect(withConversationPreferences(settings, conversations[0]).agentImageTools).toBe(true)
    expect(getAgentPreferences(settings)).toEqual({ agentModel: 'chat-a', agentWebSearch: false, agentImageTools: true, agentReasoningEffort: '' })
  })
})
