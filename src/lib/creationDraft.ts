import { t } from './i18n'
import type { CreationDraftSnapshot } from '../types'
import { useStore } from '../store'
import { getAgentImageParams } from './agentPreferences'
import { syncActiveInputDraft } from './inputDraftState'

export function captureCreationDraft(): CreationDraftSnapshot {
  const state = useStore.getState()
  const conversation = state.agentConversations.find((item) => item.id === state.activeAgentConversationId)
  return { conversationId: state.activeAgentConversationId, prompt: state.prompt, inputImages: state.inputImages, maskDraft: state.maskDraft, maskEditorImageId: state.maskEditorImageId, params: getAgentImageParams(conversation, state.params) }
}

export function isCurrentCreationDraft(draft: CreationDraftSnapshot) {
  const current = captureCreationDraft()
  return useStore.getState().appMode === 'agent' && current.conversationId === draft.conversationId && current.prompt === draft.prompt && current.inputImages === draft.inputImages && current.maskDraft === draft.maskDraft && current.maskEditorImageId === draft.maskEditorImageId && current.params === draft.params
}

export function applyCreationDraft(before: CreationDraftSnapshot, patch: Partial<CreationDraftSnapshot>, undo = true) {
  const state = useStore.getState()
  const conversation = state.agentConversations.find((item) => item.id === before.conversationId)
  if (!isCurrentCreationDraft(before) || conversation?.rounds.some((round) => round.status === 'running')) {
    state.showToast(t('草稿或对话已改变，请重新应用。', 'The draft or conversation changed. Apply it again.'), 'info')
    return false
  }
  const next = { ...before, ...patch }
  useStore.setState((current) => ({
    ...syncActiveInputDraft(current, { prompt: next.prompt, inputImages: next.inputImages, maskDraft: next.maskDraft, maskEditorImageId: next.maskEditorImageId }),
    ...(conversation && next.params !== before.params ? { agentConversations: current.agentConversations.map((item) => item.id === conversation.id ? { ...item, imageParams: next.params, updatedAt: Date.now() } : item) } : {}),
    ...(!conversation ? { params: next.params } : {}),
    creationDraftUndo: undo ? { before, after: next } : null,
  }))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('playground-compose'))
  return true
}

export function undoCreationDraft() {
  const undo = useStore.getState().creationDraftUndo
  if (!undo) return
  if (applyCreationDraft(undo.after, undo.before, false)) useStore.getState().showToast(t('已恢复替换前的草稿', 'Restored the previous draft'), 'info')
  else useStore.setState({ creationDraftUndo: null })
}
