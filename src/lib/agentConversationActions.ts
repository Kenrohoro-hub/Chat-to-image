import { removeMultipleTasks, useStore } from '../store'
import { getAgentConversationActivity, getAgentConversationTaskIds } from './agentConversationState'
import { flushAgentConversationsToIndexedDB } from './agentConversationPersistence'

export function confirmDeleteAgentConversation(id: string) {
  confirmDeleteAgentConversations([id])
}

export function confirmDeleteAgentConversations(ids: string[]) {
  const state = useStore.getState()
  const selected = state.agentConversations.filter((item) => ids.includes(item.id))
  if (!selected.length) return
  const blocked = selected.filter((item) => getAgentConversationActivity(item, state.tasks))
  const targets = selected.filter((item) => !blocked.includes(item))
  const runningNote = blocked.length ? `\n\n${blocked.length} 个对话正在生图或回复，本次保留：${blocked.map((item) => `「${item.title || '新对话'}」`).join('、')}。请进入对话停止任务，或等待完成后再删除。` : ''
  if (!targets.length) {
    state.setConfirmDialog({ title: '运行中的对话暂不能删除', message: runningNote.trim(), icon: 'info', showCancel: false, confirmText: '我知道了', action: () => {} })
    return
  }
  const taskIds = [...new Set(targets.flatMap((item) => getAgentConversationTaskIds(item, state.tasks)))]
  const imageCount = new Set(state.tasks.filter((task) => taskIds.includes(task.id)).flatMap((task) => task.outputImages)).size
  state.setConfirmDialog({
    title: targets.length === 1 ? '删除对话' : `删除 ${targets.length} 个对话`,
    message: `删除${targets.length === 1 ? `「${targets[0].title || '新对话'}」` : `选中的 ${targets.length} 个对话`}？对话记录和草稿将被删除，已生成的图片默认保留在生成历史。${runningNote}`,
    confirmText: `删除${targets.length > 1 ? ` ${targets.length} 个对话` : '对话'}`,
    checkbox: taskIds.length ? {
      label: imageCount ? `同时删除关联任务和图片（${imageCount} 张）` : `同时删除关联任务（${taskIds.length} 个）`,
      tone: 'danger',
    } : undefined,
    awaitAction: true,
    action: async (deleteImages = false) => {
      const current = useStore.getState()
      const remaining = current.agentConversations.filter((item) => targets.some((target) => target.id === item.id))
      const deletable = remaining.filter((item) => !getAgentConversationActivity(item, current.tasks))
      const relatedIds = [...new Set(deletable.flatMap((item) => getAgentConversationTaskIds(item, current.tasks)))]
      try {
        if (deleteImages) await removeMultipleTasks(relatedIds)
        for (const item of deletable) useStore.getState().deleteAgentConversation(item.id)
        const retained = selected.filter((item) => useStore.getState().agentConversations.some((target) => target.id === item.id))
        const deleted = remaining.filter((item) => !useStore.getState().agentConversations.some((target) => target.id === item.id)).length
        if (await flushAgentConversationsToIndexedDB()) {
          current.showToast(retained.length ? `已删除 ${deleted} 个对话；${retained.length} 个运行中的对话已保留` : `已删除 ${deleted} 个对话`, retained.length ? 'info' : 'success')
        }
        return true
      } catch (err) {
        console.error('删除对话失败', err)
        current.showToast('删除失败，请重试', 'error')
        return false
      }
    },
  })
}
