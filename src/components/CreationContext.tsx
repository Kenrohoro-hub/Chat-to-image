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
    <summary>当前上下文 · {context.rounds} 轮 · {context.imageIds.length} 张图片</summary>
    <p>当前分支的历史轮次与可引用图片（去重），不等于实际发送数量或用量。携图新开对话只带所选图片和参数，保留原对话及草稿，不发送请求。</p>
    <div className="creation-context-images">{expanded && context.imageIds.map((id, index) => <label key={id}><input type="checkbox" aria-label={`携带图片 ${index + 1}`} checked={selectedIds.includes(id)} disabled={busy} onChange={(event) => setSelected(event.target.checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id))} /><GalleryImage id={id} alt={`上下文图片 ${index + 1}`} /><span>图片 {index + 1}</span></label>)}</div>
    <button type="button" disabled={busy || running || !selectedIds.length} onClick={async () => {
      setBusy(true)
      setError('')
      try { await startConversationWithImages(selectedIds) } catch (err) { setError(err instanceof Error ? err.message : '新建失败，请重试。') } finally { setBusy(false) }
    }}>{busy ? '正在准备…' : `携带 ${selectedIds.length} 张图片新开对话`}</button>
    {running && <p>请先停止当前对话。</p>}{error && <p role="alert">{error}</p>}
  </details>
}
