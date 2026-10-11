import { useEffect, useState } from 'react'
import { useStore, reuseConfig } from '../../store'
import { getCurrentCreationTasks } from '../../lib/creationResults'
import { downloadImageIds } from '../../lib/downloadImages'
import { sendTaskToAgent } from '../../lib/workspaceTransfer'
import GalleryImage from './GalleryImage'

export default function GalleryResults() {
  const tasks = useStore((state) => state.tasks)
  const conversation = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId))
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const setDetailTaskId = useStore((state) => state.setDetailTaskId)
  const openFavoritePicker = useStore((state) => state.openFavoritePicker)
  const showToast = useStore((state) => state.showToast)
  const [selection, setSelection] = useState<{ taskId: string; imageId: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const current = getCurrentCreationTasks(conversation, tasks)
  const images = current.flatMap((task) => task.outputImages.map((id, index) => ({ task, id, index })))
  const selected = images.find((image) => image.task.id === selection?.taskId && image.id === selection.imageId) ?? images[images.length - 1]
  const running = current.some((task) => task.status === 'running')
  const busy = Boolean(conversation?.rounds.some((round) => round.status === 'running'))
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const run = (action: Promise<unknown>) => { void action.catch(() => showToast('操作未完成，请重试。', 'error')) }
  const target = current.reduce((count, task) => count + task.params.n, 0)
  return <section className="gallery-results" aria-label="当前生成结果">
    <div className="gallery-results-heading"><h2>结果比较</h2><span role="status">{current.length ? `${running ? '正在生成 · ' : '当前分支 · '}${images.length} / ${target} 张` : '讨论想法，或直接开始生成'}</span></div>
    <div className="gallery-results-scroll">
      {!current.length && <div className="gallery-empty-results"><span className="creation-empty-symbol" aria-hidden="true">✧</span><p>你的下一张作品，从这里开始</p><span>在对话中讨论构图，或明确说“生成一张…”</span><span>只有图像 API 也可以使用“直接生成”</span></div>}
      {current.filter((task) => task.status === 'running' || task.error || task.outputErrors?.length || !task.outputImages.length).map((task) => <div className="creation-result-status" key={task.id} role={task.error || task.outputErrors?.length ? 'alert' : 'status'}>
        <span>{task.status === 'running' ? `正在生成 · ${task.outputImages.length} / ${task.params.n} 张 · ${Math.max(0, Math.floor((now - task.createdAt) / 1000))} 秒` : task.error || (task.outputErrors?.length ? `部分图片生成失败，已保留 ${task.outputImages.length} 张结果。` : '此任务暂无可显示的图片。')}</span><button type="button" onClick={() => setDetailTaskId(task.id)}>查看任务详情</button>
      </div>)}
      <div className="creation-compare-grid">
        {images.map((image) => {
          const round = conversation?.rounds.find((entry) => entry.id === image.task.agentRoundId || entry.outputTaskIds.includes(image.task.id))
          const active = selected === image
          const size = image.task.actualParamsByImage?.[image.id]?.size || image.task.actualParams?.size || image.task.params.size
          return <article className="creation-compare-card" key={`${image.task.id}:${image.id}`} data-selected={active}>
            <button type="button" className="creation-compare-select" aria-pressed={active} aria-label={`选择第 ${round?.index ?? 1} 轮第 ${image.index + 1} 张图片`} onClick={() => setSelection({ taskId: image.task.id, imageId: image.id })}>
              <span className="creation-compare-label"><span>第 {round?.index ?? 1} 轮 · 第 {image.index + 1} 张</span><span>{active ? '● 已选中' : '○ 选择'}</span></span>
              <span className="creation-compare-preview"><GalleryImage id={image.id} alt={`第 ${round?.index ?? 1} 轮生成图片 ${image.index + 1}`} /></span>
              <span className="creation-compare-meta"><span>{image.task.apiModel || '当前图像模型'}</span><span>{size}</span></span>
            </button>
          </article>
        })}
      </div>
    </div>
    {selected && <div className="creation-selected-actions" aria-label="所选图片操作">
      <div><button type="button" className="creation-edit-selected" disabled={busy} onClick={() => run(sendTaskToAgent({ ...selected.task, outputImages: [selected.id] }, false))}>继续修改</button><button type="button" disabled={busy} onClick={() => run(sendTaskToAgent({ ...selected.task, outputImages: [selected.id] }, true))}>蒙版编辑</button><button type="button" onClick={() => run(downloadImageIds([selected.id], 'chat-to-image').then((result) => { if (result.failCount) showToast('下载失败，请重试。', 'error') }))}>下载</button><button type="button" onClick={() => setLightboxImageId(selected.id, images.map((image) => image.id))}>放大图片</button></div>
      <div><button type="button" disabled={busy} onClick={() => run(reuseConfig(selected.task))}>复用提示词与参数</button><button type="button" onClick={() => openFavoritePicker([selected.task.id])}>{selected.task.isFavorite ? '管理收藏' : '收藏作品'}</button><button type="button" onClick={() => setDetailTaskId(selected.task.id)}>提示词与详情</button></div>
    </div>}
  </section>
}
