import type { TaskRecord } from '../types'
import { useState } from 'react'
import { useStore } from '../store'
import { openTaskInGallery, sendTaskToAgent, openTaskConversation } from '../lib/workspaceTransfer'

export default function TaskWorkspaceActions({ task }: { task: TaskRecord }) {
  const [index, setIndex] = useState(0)
  const agent = useStore((state) => state.appMode === 'agent')
  const showToast = useStore((state) => state.showToast)
  const run = (action: Promise<void>) => { void action.catch((error) => showToast(error instanceof Error ? error.message : '无法打开图片', 'error')) }
  if (!task.outputImages.length) return null
  const selected = { ...task, outputImages: [task.outputImages[index] ?? task.outputImages[0]] }
  return <div className="flex flex-wrap gap-3 border-t border-gray-200 px-3 py-2 text-xs dark:border-white/10" onClick={(event) => event.stopPropagation()}>
    {task.outputImages.length > 1 && <select aria-label="选择操作图片" value={index} onChange={(event) => setIndex(Number(event.target.value))}>{task.outputImages.map((id, idx) => <option value={idx} key={id}>第 {idx + 1} 张</option>)}</select>}
    <button type="button" onClick={() => run(sendTaskToAgent(selected))}>在当前对话修改</button>
    {agent && <><button type="button" onClick={() => run(sendTaskToAgent(selected, true))}>蒙版修改</button><button type="button" onClick={() => run(openTaskInGallery(task))}>复用提示词与参数</button></>}
    {task.agentConversationId && <button type="button" onClick={() => openTaskConversation(task)}>打开原对话</button>}
  </div>
}
