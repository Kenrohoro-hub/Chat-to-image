import { t } from '../../lib/i18n'
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
  return <div className="creation-draft-undo" role="status"><span>{t('已替换草稿', 'Draft replaced')}</span><button type="button" onClick={undoCreationDraft}>{t('撤销替换', 'Undo replacement')}</button><button type="button" aria-label={t('关闭撤销提示', 'Dismiss undo notice')} onClick={() => useStore.setState({ creationDraftUndo: null })}>×</button></div>
}
