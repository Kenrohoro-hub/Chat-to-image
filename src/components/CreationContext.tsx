import { t } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { getCreationContext, startConversationWithImages } from '../lib/creationContext'
import GalleryImage from './gallery/GalleryImage'

export default function CreationContext() {
  const conversation = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId))
  const tasks = useStore((state) => state.tasks)
  const inputImages = useStore((state) => state.inputImages)
  const context = useMemo(() => getCreationContext(conversation, tasks, inputImages), [conversation, tasks, inputImages])
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const running = conversation?.rounds.some((round) => round.status === 'running')
  const selectedIds = selected.filter((id) => context.imageIds.includes(id))
  return <details className="creation-context" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{t('当前上下文 ·', 'Current context ·')} {context.rounds} {t('轮 ·', ' turns ·')} {context.imageIds.length} {t('张图片', ' images')}</summary>
    <p>{t('当前分支的历史轮次与可引用图片（去重），不等于实际发送数量或用量。携图新开对话只带所选图片和参数，保留原对话及草稿，不发送请求。', 'Previous turns and unique available images in this branch; these counts do not represent actual requests or usage. A new chat carries only the selected images and settings, keeps the original chat and draft, and sends no request.')}</p>
    <div className="creation-context-images">{expanded && context.imageIds.map((id, index) => <label key={id}><input type="checkbox" aria-label={t(`携带图片 ${index + 1}`, `Carried image ${index + 1}`)} checked={selectedIds.includes(id)} disabled={busy} onChange={(event) => setSelected(event.target.checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id))} /><GalleryImage id={id} alt={t(`上下文图片 ${index + 1}`, `Context image ${index + 1}`)} /><span>{t('图片', 'Image')} {index + 1}</span></label>)}</div>
    <button type="button" disabled={busy || running || !selectedIds.length} onClick={async () => {
      setBusy(true)
      setError('')
      try { await startConversationWithImages(selectedIds) } catch (err) { setError(err instanceof Error ? err.message : t('新建失败，请重试。', 'Failed to create. Please retry.')) } finally { setBusy(false) }
    }}>{busy ? t('正在准备…', 'Preparing…') : t(`携带 ${selectedIds.length} 张图片新开对话`, `New chat with ${selectedIds.length} images`)}</button>
    {running && <p>{t('请先停止当前对话。', 'Stop the current chat first.')}</p>}{error && <p role="alert">{error}</p>}
  </details>
}
