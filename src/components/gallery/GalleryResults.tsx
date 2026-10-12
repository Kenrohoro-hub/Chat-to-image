import { t } from '../../lib/i18n'
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
  const run = (action: Promise<unknown>) => { void action.catch(() => showToast(t('操作未完成，请重试。', 'Action incomplete. Please retry.'), 'error')) }
  const target = current.reduce((count, task) => count + task.params.n, 0)
  return <section className="gallery-results" aria-label={t('当前生成结果', 'Current results')}>
    <div className="gallery-results-heading"><h2>{t('结果比较', 'Compare results')}</h2><span role="status">{current.length ? t(`${running ? '正在生成 · ' : '当前分支 · '}${images.length} / ${target} 张`, `${running ? 'Generating · ' : 'Current branch · '}${images.length} / ${target} images`) : t('讨论想法，或直接开始生成', 'Discuss ideas or start generating')}</span></div>
    <div className="gallery-results-scroll">
      {!current.length && <div className="gallery-empty-results"><span className="creation-empty-symbol" aria-hidden="true">✧</span><p>{t('你的下一张作品，从这里开始', 'Your next creation starts here')}</p><span>{t('在对话中讨论构图，或明确说“生成一张…”', 'Discuss the composition in chat, or explicitly ask to generate an image.')}</span><span>{t('只有图像 API 也可以使用“直接生成”', 'With only an image API, use Generate directly.')}</span></div>}
      {current.filter((task) => task.status === 'running' || task.error || task.outputErrors?.length || !task.outputImages.length).map((task) => <div className="creation-result-status" key={task.id} role={task.error || task.outputErrors?.length ? 'alert' : 'status'}>
        <span>{task.status === 'running' ? t(`正在生成 · ${task.outputImages.length} / ${task.params.n} 张 · ${Math.max(0, Math.floor((now - task.createdAt) / 1000))} 秒`, `Generating · ${task.outputImages.length} / ${task.params.n} images · ${Math.max(0, Math.floor((now - task.createdAt) / 1000))} s`) : task.error || (task.outputErrors?.length ? t(`部分图片生成失败，已保留 ${task.outputImages.length} 张结果。`, `Some images failed to generate. ${task.outputImages.length} results were kept.`) : t('此任务暂无可显示的图片。', 'This task has no images to show yet.'))}</span><button type="button" onClick={() => setDetailTaskId(task.id)}>{t('查看任务详情', 'View task details')}</button>
      </div>)}
      <div className="creation-compare-grid">
        {images.map((image) => {
          const round = conversation?.rounds.find((entry) => entry.id === image.task.agentRoundId || entry.outputTaskIds.includes(image.task.id))
          const active = selected === image
          const size = image.task.actualParamsByImage?.[image.id]?.size || image.task.actualParams?.size || image.task.params.size
          return <article className="creation-compare-card" key={`${image.task.id}:${image.id}`} data-selected={active}>
            <button type="button" className="creation-compare-select" aria-pressed={active} aria-label={t(`选择第 ${round?.index ?? 1} 轮第 ${image.index + 1} 张图片`, `Select image ${image.index + 1} from turn ${round?.index ?? 1}`)} onClick={() => setSelection({ taskId: image.task.id, imageId: image.id })}>
              <span className="creation-compare-label"><span>{t(`第 ${round?.index ?? 1} 轮 · 第 ${image.index + 1} 张`, `Turn ${round?.index ?? 1} · Image ${image.index + 1}`)}</span><span>{active ? t('● 已选中', '● Selected') : t('○ 选择', '○ Select')}</span></span>
              <span className="creation-compare-preview"><GalleryImage id={image.id} alt={t(`第 ${round?.index ?? 1} 轮生成图片 ${image.index + 1}`, `Turn ${round?.index ?? 1}, generated image ${image.index + 1}`)} /></span>
              <span className="creation-compare-meta"><span>{image.task.apiModel || t('当前图像模型', 'Current image model')}</span><span>{size}</span></span>
            </button>
          </article>
        })}
      </div>
    </div>
    {selected && <div className="creation-selected-actions" aria-label={t('所选图片操作', 'Selected image actions')}>
      <div><button type="button" className="creation-edit-selected" disabled={busy} onClick={() => run(sendTaskToAgent({ ...selected.task, outputImages: [selected.id] }, false))}>{t('继续修改', 'Continue editing')}</button><button type="button" disabled={busy} onClick={() => run(sendTaskToAgent({ ...selected.task, outputImages: [selected.id] }, true))}>{t('蒙版编辑', 'Mask editing')}</button><button type="button" onClick={() => run(downloadImageIds([selected.id], 'chat-to-image').then((result) => { if (result.failCount) showToast(t('下载失败，请重试。', 'Download failed. Please retry.'), 'error') }))}>{t('下载', 'Download')}</button><button type="button" onClick={() => setLightboxImageId(selected.id, images.map((image) => image.id))}>{t('放大图片', 'Enlarge image')}</button></div>
      <div><button type="button" disabled={busy} onClick={() => run(reuseConfig(selected.task))}>{t('复用提示词与参数', 'Reuse prompt and settings')}</button><button type="button" onClick={() => openFavoritePicker([selected.task.id])}>{selected.task.isFavorite ? t('管理收藏', 'Manage favorites') : t('收藏作品', 'Favorite image')}</button><button type="button" onClick={() => setDetailTaskId(selected.task.id)}>{t('提示词与详情', 'Prompt and details')}</button></div>
    </div>}
  </section>
}
