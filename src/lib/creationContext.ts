import type { AgentConversation, InputImage, TaskRecord } from '../types'
import { getActiveAgentRounds } from './agentConversationState'
import { captureCreationDraft, isCurrentCreationDraft } from './creationDraft'
import { saveActiveAgentInputDrafts } from './inputDraftState'
import { ensureImageCached } from './imageCache'
import { useStore } from '../store'

export function getCreationContext(conversation: AgentConversation | undefined, tasks: TaskRecord[], draftImages: InputImage[]) {
  const rounds = conversation ? getActiveAgentRounds(conversation) : []
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const images = new Set(draftImages.map((image) => image.id))
  for (const round of rounds) {
    for (const id of round.inputImageIds) images.add(id)
    for (const taskId of round.outputTaskIds) {
      for (const id of byId.get(taskId)?.outputImages ?? []) images.add(id)
    }
  }
  return { rounds: rounds.length, imageIds: [...images] }
}

export async function startConversationWithImages(imageIds: string[]) {
  const before = captureCreationDraft()
  const original = useStore.getState().agentConversations.find((item) => item.id === before.conversationId)
  if (original?.rounds.some((round) => round.status === 'running')) throw new Error('请先停止当前对话。')
  const inputImages = await Promise.all([...new Set(imageIds)].map(async (id) => {
    const dataUrl = await ensureImageCached(id)
    if (!dataUrl) throw new Error('所选图片已不存在，请重新选择；原对话保持不变。')
    return { id, dataUrl }
  }))
  const state = useStore.getState()
  if (!isCurrentCreationDraft(before) || state.agentConversations.find((item) => item.id === before.conversationId) !== original) throw new Error('对话或草稿已改变，请重新选择。')
  const id = crypto.randomUUID()
  const now = Date.now()
  useStore.setState({
    agentInputDrafts: { ...saveActiveAgentInputDrafts(state), [id]: { prompt: '', inputImages, maskDraft: null, maskEditorImageId: null } },
    agentConversations: [...state.agentConversations, { id, title: '新对话', createdAt: now, updatedAt: now, rounds: [], messages: [], activeRoundId: null, imageParams: { ...before.params }, preferences: original?.preferences ? { ...original.preferences } : undefined }],
    activeAgentConversationId: id, prompt: '', inputImages, maskDraft: null, maskEditorImageId: null,
    agentEditingRoundId: null, agentEditingConversationId: null, creationDraftUndo: null, agentSidebarCollapsed: true,
  })
  window.dispatchEvent(new Event('playground-compose'))
}
