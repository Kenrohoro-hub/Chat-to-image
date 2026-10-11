import type { AgentConversation, TaskRecord } from '../types'
import { getActiveAgentRounds } from './agentConversationState'

export function getCurrentCreationTasks(conversation: AgentConversation | undefined, tasks: TaskRecord[]) {
  if (!conversation) return []
  const rounds = getActiveAgentRounds(conversation)
  return tasks.filter((task) => rounds.some((round) => round.outputTaskIds.includes(task.id) || (task.agentConversationId === conversation.id && task.agentRoundId === round.id))).sort((a, b) => a.createdAt - b.createdAt)
}
