import type { AgentConversation } from '../types'
import { useStore } from '../store'
import { commitAgentConversationChanges } from './db'
import { getPersistableAgentConversations } from './agentResponseState'

let committed: AgentConversation[] = []
let tail: Promise<unknown> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<boolean> | null = null
let requested = false

export function initializeAgentConversationPersistence(conversations: AgentConversation[]) {
  committed = conversations
}

// 任务关联清理和普通会话保存共用串行入口，避免较旧的写入复活已删除内容。
export function persistAgentConversationChanges(write: (changed: AgentConversation[], removed: string[]) => Promise<unknown>) {
  const operation = tail.then(async () => {
    const current = useStore.getState().agentConversations
    const previous = new Map(committed.map((item) => [item.id, item]))
    const ids = new Set(current.map((item) => item.id))
    const changed = current.filter((item) => previous.get(item.id) !== item)
    const removed = committed.filter((item) => !ids.has(item.id)).map((item) => item.id)
    await write(getPersistableAgentConversations(changed), removed)
    committed = current
    useStore.setState({ agentConversationSaveError: null })
  })
  tail = operation.catch(() => undefined)
  return operation
}

export function flushAgentConversationsToIndexedDB(): Promise<boolean> {
  clearTimeout(timer)
  timer = undefined
  if (pending) {
    requested = true
    return pending
  }
  pending = (async () => {
    try {
      do {
        requested = false
        await persistAgentConversationChanges(async (changed, removed) => {
          if (changed.length || removed.length) await commitAgentConversationChanges(changed, removed)
        })
      } while (requested)
      return true
    } catch (err) {
      console.warn('保存创作对话失败', err)
      useStore.setState({ agentConversationSaveError: '创作对话尚未保存，请重试保存。' })
      return false
    } finally {
      pending = null
    }
  })()
  return pending
}

export function scheduleAgentConversationSave(streaming: boolean) {
  if (!streaming) { void flushAgentConversationsToIndexedDB(); return }
  if (timer !== undefined) return
  timer = setTimeout(() => { timer = undefined; void flushAgentConversationsToIndexedDB() }, 300)
}
