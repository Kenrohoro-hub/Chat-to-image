import { getUiLanguage, t } from '../../lib/i18n'
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
  const run = (action: Promise<void>) => { void action.then(() => onApply?.()).catch(() => showToast(t('历史复用未完成，请重试。', 'Failed to reuse history. Please retry.'), 'error')) }
  if (compact) return <section className="creation-history-strip" aria-label={t('最近生成历史', 'Recent generation history')}>
    <div className="creation-strip-heading"><h2>{t('最近生成', 'Recent generations')}</h2><div><button type="button" onClick={onExpand}>{t('展开操作', 'Show actions')}</button><button type="button" onClick={onAllHistory}>{t('全部历史 ↗', 'All history ↗')}</button></div></div>
    <div className="creation-history-thumbnails">
      {!recent.length && <p className="creation-history-empty">{t('生成的作品会保留在这里', 'Generated images will appear here')}</p>}
      {recent.map((task) => <button type="button" key={task.id} className="creation-history-preview" aria-label={t(`预览历史：${task.prompt}`, `Preview history: ${task.prompt}`)} title={task.prompt} draggable={task.outputImages.length > 0} onDragStart={(event) => { event.dataTransfer.setData('text/plain', `agent-image:${task.outputImages[0]}`); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => task.outputImages.length ? setLightboxImageId(task.outputImages[0], task.outputImages) : setDetailTaskId(task.id)}>
        {task.outputImages.length ? <GalleryImage id={task.outputImages[0]} alt={t('历史作品', 'History image')} /> : <span>{task.status === 'running' ? t('生成中…', 'Generating…') : t('未完成', 'Incomplete')}</span>}
        {task.outputImages.length > 1 && <small>{task.outputImages.length} {t('张', ' images')}</small>}
      </button>)}
    </div>
  </section>
  return <section className="creation-history" aria-label={t('最近生成历史', 'Recent generation history')}>
    <div className="creation-panel-heading"><h2>{t('最近生成', 'Recent generations')}</h2><button type="button" onClick={onAllHistory}>{t('全部历史 ↗', 'All history ↗')}</button></div>
    <div className="creation-history-scroll">
      {!recent.length && <p className="creation-history-empty">{t('生成的作品会保留在这里', 'Generated images will appear here')}</p>}
      {recent.map((task) => <article key={task.id} className="creation-history-item">
        <button type="button" className="creation-history-preview" aria-label={t(`预览历史：${task.prompt}`, `Preview history: ${task.prompt}`)} draggable={task.outputImages.length > 0} onDragStart={(event) => { event.dataTransfer.setData('text/plain', `agent-image:${task.outputImages[selected[task.id] ?? 0]}`); event.dataTransfer.effectAllowed = 'copy' }} onClick={() => task.outputImages.length ? setLightboxImageId(task.outputImages[selected[task.id] ?? 0], task.outputImages) : setDetailTaskId(task.id)}>
          {task.outputImages.length ? <GalleryImage id={task.outputImages[selected[task.id] ?? 0]} alt={t('历史作品', 'History image')} /> : <span>{task.status === 'running' ? t('生成中…', 'Generating…') : t('未完成', 'Incomplete')}</span>}
          {task.outputImages.length > 1 && <small>{task.outputImages.length} {t('张', ' images')}</small>}
        </button>
        <p title={task.prompt}>{task.prompt}</p>
        <div className="creation-history-meta"><span>{task.isExample ? t('内置示例', 'Built-in sample') : task.status === 'running' ? t('生成中', 'Generating') : task.status === 'error' ? t('未完成', 'Incomplete') : task.outputErrors?.length ? t('部分完成', 'Partially completed') : t('已完成', 'Completed')}</span><time>{new Date(task.createdAt).toLocaleTimeString(getUiLanguage(), { hour: '2-digit', minute: '2-digit' })}</time></div>
        <div className="creation-history-actions">
          {task.outputImages.length > 1 && <select aria-label={t(`选择历史图片：${task.prompt}`, `Select history image: ${task.prompt}`)} value={selected[task.id] ?? 0} onChange={(event) => setSelected((current) => ({ ...current, [task.id]: Number(event.target.value) }))}>{task.outputImages.map((id, index) => <option key={id} value={index}>{t(`第 ${index + 1} 张`, `Image ${index + 1}`)}</option>)}</select>}
          {task.outputImages.length > 0 && <button type="button" disabled={busy} onClick={() => run(editOutputs({ ...task, outputImages: [task.outputImages[selected[task.id] ?? 0]] }))}>{t('加入当前参考', 'Add to references')}</button>}
          <button type="button" disabled={busy} onClick={() => run(reuseConfig(task))}>{t('复用', 'Reuse')}</button>
          <button type="button" onClick={() => setDetailTaskId(task.id)}>{t('详情', 'Details')}</button>
          <button type="button" className="text-red-600 disabled:opacity-40 disabled:cursor-not-allowed dark:text-red-400" aria-label={t(`删除历史：${task.prompt}`, `Delete history: ${task.prompt}`)} disabled={task.status === 'running'} title={task.status === 'running' ? t('请先停止生成，再删除任务', 'Stop generation before deleting the task') : t('删除任务', 'Delete task')} onClick={() => setConfirmDialog({
            title: t('删除任务', 'Delete task'),
            message: t('确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。', 'Delete this task? Associated images will also be removed if no other task uses them.'),
            action: () => removeTask(task),
          })}>{t('删除', 'Delete')}</button>
        </div>
      </article>)}
    </div>
  </section>
}
