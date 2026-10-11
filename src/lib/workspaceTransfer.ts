import type { TaskRecord } from '../types'
import { useStore, reuseConfig, setCurrentAgentPreferences } from '../store'
import { applyCreationDraft, captureCreationDraft } from './creationDraft'
import { ensureImageCached } from './imageCache'

export function takePromptToGallery(prompt: string) {
  const state = useStore.getState()
  state.setAppMode('agent')
  const before = captureCreationDraft()
  return applyCreationDraft(before, { prompt })
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
  if (conversation?.rounds.some((round) => round.status === 'running')) { current.showToast('请先停止当前对话，再添加编辑图片。', 'info'); return }
  const before = captureCreationDraft()
  const id = task.outputImages[0]
  if (!id) return
  const dataUrl = await ensureImageCached(id)
  if (!dataUrl) throw new Error('图片已不存在，原草稿已保留。')
  if (!applyCreationDraft(before, { prompt: '', inputImages: [{ id, dataUrl }], maskDraft: null, maskEditorImageId: mask ? id : null })) return
  setCurrentAgentPreferences({ agentImageTools: true })
  useStore.getState().setDetailTaskId(null)
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-bar] [contenteditable="true"]')?.focus())
}

export function openTaskConversation(task: TaskRecord) {
  const state = useStore.getState()
  if (!task.agentConversationId || !state.agentConversations.some((item) => item.id === task.agentConversationId)) { state.showToast('原对话已不存在。', 'info'); return }
  state.setAppMode('agent')
  state.setActiveAgentConversationId(task.agentConversationId)
  state.setDetailTaskId(null)
}
