import { DEFAULT_PARAMS, REASONING_EFFORT_VALUES, type AgentConversation, type AppSettings, type ReasoningEffort, type TaskParams } from '../types'

export function getAgentImageParams(conversation?: AgentConversation, fallback: TaskParams = DEFAULT_PARAMS): TaskParams {
  return conversation?.imageParams ?? fallback
}

export function getAgentPreferences(settings: AppSettings): NonNullable<AgentConversation['preferences']> {
  return { agentModel: settings.agentModel ?? '', agentReasoningEffort: settings.agentReasoningEffort ?? '', agentWebSearch: settings.agentWebSearch, agentImageTools: true }
}

export function withConversationPreferences(settings: AppSettings, conversation?: AgentConversation): AppSettings {
  return { ...settings, ...conversation?.preferences, agentImageTools: true, agentReasoningEffort: conversation?.preferences?.agentReasoningEffort ?? settings.agentReasoningEffort ?? '' }
}

export function normalizeAgentPreferences(value: unknown): AgentConversation['preferences'] {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return { agentModel: typeof record.agentModel === 'string' ? record.agentModel.trim() : '', agentWebSearch: record.agentWebSearch === true, agentImageTools: true,
    agentReasoningEffort: REASONING_EFFORT_VALUES.includes(record.agentReasoningEffort as ReasoningEffort) ? record.agentReasoningEffort as ReasoningEffort : '' }
}
