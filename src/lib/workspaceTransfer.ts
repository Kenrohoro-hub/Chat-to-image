import { t } from './i18n'
import { API_MAX_IMAGES, type PromptTemplate, type TaskRecord } from '../types'
import { useStore, reuseConfig, setCurrentAgentPreferences, deleteImageIfUnreferenced } from '../store'
import { applyCreationDraft, captureCreationDraft } from './creationDraft'
import { blobToDataUrl } from './dataUrl'
import { storeImage } from './db'
import { desktopApi } from './desktop'
import { cacheImage, ensureImageCached } from './imageCache'
import { getCachedPromptImage } from './promptLibrary'
import { promptImageUrl } from './promptSources'

export function takePromptToGallery(prompt: string) {
  const state = useStore.getState()
  state.setAppMode('agent')
  const before = captureCreationDraft()
  return applyCreationDraft(before, { prompt })
}

export async function takePromptImageToGallery(item: PromptTemplate, includePrompt = false) {
  const state = useStore.getState()
  const url = item.previewUrl
  if (!url) { state.showToast(t('这条提示词没有预览图。', 'This prompt has no preview image.'), 'info'); return false }
  state.setAppMode('agent')
  const before = captureCreationDraft()
  if (before.inputImages.length >= API_MAX_IMAGES) { state.showToast(t(`参考图最多 ${API_MAX_IMAGES} 张，请移除部分参考图后重试。`, `Up to ${API_MAX_IMAGES} reference images are allowed. Remove some and try again.`), 'info'); return false }
  try {
    let blob: Blob | null = null
    try { blob = await getCachedPromptImage(url) } catch (err) { console.warn('Prompt image cache read failed', err) }
    const dataUrl = blob ? await blobToDataUrl(blob) : promptImageUrl(url)
      ? (await (await desktopApi()).download_prompt_image(url)).dataUrl
      : await (async () => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(t('预览图下载失败。', 'Could not download the preview image.'))
        return blobToDataUrl(await response.blob())
      })()
    if (!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/.test(dataUrl)) throw new Error(t('预览图不是支持的图片格式。', 'The preview is not a supported image format.'))
    const id = await storeImage(dataUrl, 'upload')
    cacheImage(id, dataUrl)
    const inputImages = before.inputImages.some((img) => img.id === id) ? before.inputImages : [...before.inputImages, { id, dataUrl }]
    const applied = applyCreationDraft(before, { ...(includePrompt ? { prompt: item.content } : {}), inputImages })
    if (!applied) await deleteImageIfUnreferenced(id)
    return applied
  } catch (err) {
    console.warn('Prompt image reference failed', err)
    useStore.getState().showToast(t(`引用图片失败：${err instanceof Error ? err.message : '请重试。'}`, `Could not use the image: ${err instanceof Error ? err.message : 'Try again.'}`), 'error')
    return false
  }
}

export async function openTaskInGallery(task: TaskRecord) {
  useStore.getState().setAppMode('agent')
  await reuseConfig(task)
  useStore.getState().setDetailTaskId(null)
}

export async function sendTaskToAgent(task: TaskRecord, mask = false) {
  const state = useStore.getState()
  state.setAppMode('agent')
  if (useStore.getState().appMode !== 'agent') return
  const current = useStore.getState()
  const conversation = current.agentConversations.find((item) => item.id === current.activeAgentConversationId)
  if (conversation?.rounds.some((round) => round.status === 'running')) { current.showToast(t('请先停止当前对话，再添加编辑图片。', 'Stop the current conversation before adding an image to edit.'), 'info'); return }
  const before = captureCreationDraft()
  const id = task.outputImages[0]
  if (!id) return
  const dataUrl = await ensureImageCached(id)
  if (!dataUrl) throw new Error(t('图片已不存在，原草稿已保留。', 'The image no longer exists. Your draft is preserved.'))
  if (!applyCreationDraft(before, { prompt: '', inputImages: [{ id, dataUrl }], maskDraft: null, maskEditorImageId: mask ? id : null })) return
  setCurrentAgentPreferences({ agentImageTools: true })
  useStore.getState().setDetailTaskId(null)
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-bar] [contenteditable="true"]')?.focus())
}

export function openTaskConversation(task: TaskRecord) {
  const state = useStore.getState()
  if (!task.agentConversationId || !state.agentConversations.some((item) => item.id === task.agentConversationId)) { state.showToast(t('原对话已不存在。', 'The original conversation no longer exists.'), 'info'); return }
  state.setAppMode('agent')
  state.setActiveAgentConversationId(task.agentConversationId)
  state.setDetailTaskId(null)
}
