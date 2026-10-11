import { useStore, editOutputs, reuseConfig, removeTask } from '../../store'
import { useState } from 'react'
import GalleryImage from './GalleryImage'

export default function RecentHistory({ onAllHistory, onApply, compact = false, onExpand }: { onAllHistory: () => void; onApply?: () => void; compact?: boolean; onExpand?: () => void }) {
  const [selected, setSelected] = useState<Record<string, number>>({})
  const tasks = useStore((state) => state.tasks)
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const busy = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId)?.rounds.some((round) => round.status === 'running'))
  const showToast = useStore((state) => state.showToast)
  const recent = [...tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
  const run = (action: Promise<void>) => { void action.then(() => onApply?.()).catch(() => showToast('历史复用未完成，请重试。', 'error')) }
  if (compact) return <section className="creation-history-strip" aria-label="最近生成历史">
    <div className="creation-strip-heading"><h2>最近生成</h2><div><button type="button" onClick={onExpand}>展开操作</button><button type="button" onClick={onAllHistory}>全部历史 ↗</button></div></div>
    <div className="creation-history-thumbnails">
      {!recent.length && <p className="creation-history-empty">生成的作品会保留在这里</p>}
      {recent.map((task) => <button type="button" key={task.id} className="creation-history-preview" aria-label={`预览历史：${task.prompt}`} title={task.prompt} onClick={() => task.outputImages.length ? setLightboxImageId(task.outputImages[0], task.outputImages) : setDetailTaskId(task.id)}>
        {task.outputImages.length ? <GalleryImage id={task.outputImages[0]} alt="历史作品" /> : <span>{task.status === 'running' ? '生成中…' : '未完成'}</span>}
        {task.outputImages.length > 1 && <small>{task.outputImages.length} 张</small>}
      </button>)}
    </div>
  </section>
  return <section className="creation-history" aria-label="最近生成历史">
    <div className="creation-panel-heading"><h2>最近生成</h2><button type="button" onClick={onAllHistory}>全部历史 ↗</button></div>
    <div className="creation-history-scroll">
      {!recent.length && <p className="creation-history-empty">生成的作品会保留在这里</p>}
      {recent.map((task) => <article key={task.id} className="creation-history-item">
        <button type="button" className="creation-history-preview" aria-label={`预览历史：${task.prompt}`} onClick={() => task.outputImages.length ? setLightboxImageId(task.outputImages[selected[task.id] ?? 0], task.outputImages) : setDetailTaskId(task.id)}>
          {task.outputImages.length ? <GalleryImage id={task.outputImages[selected[task.id] ?? 0]} alt="历史作品" /> : <span>{task.status === 'running' ? '生成中…' : '未完成'}</span>}
          {task.outputImages.length > 1 && <small>{task.outputImages.length} 张</small>}
        </button>
        <p title={task.prompt}>{task.prompt}</p>
        <div className="creation-history-meta"><span>{task.isExample ? '内置示例' : task.status === 'running' ? '生成中' : task.status === 'error' ? '未完成' : task.outputErrors?.length ? '部分完成' : '已完成'}</span><time>{new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
        <div className="creation-history-actions">
          {task.outputImages.length > 1 && <select aria-label={`选择历史图片：${task.prompt}`} value={selected[task.id] ?? 0} onChange={(event) => setSelected((current) => ({ ...current, [task.id]: Number(event.target.value) }))}>{task.outputImages.map((id, index) => <option key={id} value={index}>第 {index + 1} 张</option>)}</select>}
          {task.outputImages.length > 0 && <button type="button" disabled={busy} onClick={() => run(editOutputs({ ...task, outputImages: [task.outputImages[selected[task.id] ?? 0]] }))}>加入当前参考</button>}
          <button type="button" disabled={busy} onClick={() => run(reuseConfig(task))}>复用</button>
          <button type="button" onClick={() => setDetailTaskId(task.id)}>详情</button>
          <button type="button" className="text-red-600 disabled:opacity-40 disabled:cursor-not-allowed dark:text-red-400" aria-label={`删除历史：${task.prompt}`} disabled={task.status === 'running'} title={task.status === 'running' ? '请先停止生成，再删除任务' : '删除任务'} onClick={() => setConfirmDialog({
            title: '删除任务',
            message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
            action: () => removeTask(task),
          })}>删除</button>
        </div>
      </article>)}
    </div>
  </section>
}
