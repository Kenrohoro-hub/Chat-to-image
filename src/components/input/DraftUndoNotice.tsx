import { useStore } from '../../store'
import { isCurrentCreationDraft, undoCreationDraft } from '../../lib/creationDraft'

export default function DraftUndoNotice() {
  const undo = useStore((state) => state.creationDraftUndo)
  useStore((state) => state.prompt)
  useStore((state) => state.inputImages)
  useStore((state) => state.maskDraft)
  useStore((state) => state.activeAgentConversationId)
  const conversation = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId))
  if (!undo || !isCurrentCreationDraft(undo.after) || conversation?.rounds.some((round) => round.status === 'running')) return null
  return <div className="creation-draft-undo" role="status"><span>已替换草稿</span><button type="button" onClick={undoCreationDraft}>撤销替换</button><button type="button" aria-label="关闭撤销提示" onClick={() => useStore.setState({ creationDraftUndo: null })}>×</button></div>
}
