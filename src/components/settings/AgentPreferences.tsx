import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, type AppSettings } from '../../types'
import { normalizeAgentMaxToolRounds, getAgentApiCandidates, getAgentModels } from '../../lib/apiProfiles'
import PreferenceToggle from './PreferenceToggle'

interface AgentPreferencesProps {
  draft: AppSettings
  agentMaxToolRoundsInput: string
  setAgentMaxToolRoundsInput: (value: string) => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
}

export default function AgentPreferences({ draft, agentMaxToolRoundsInput, setAgentMaxToolRoundsInput, commitSettings, commitAgentMaxToolRounds }: AgentPreferencesProps) {
  return <section className="mt-4 space-y-3 rounded-xl border border-gray-200/80 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.02]" aria-label="对话习惯">
    <h4 className="text-sm font-semibold">对话习惯</h4>
    <p className="text-xs leading-relaxed text-gray-500">默认模型和联网设置用于新对话；已有对话可在输入区调整。</p>
    <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">新对话默认模型<select aria-label="新对话默认模型" className="min-w-0 max-w-full rounded-lg border bg-background p-2 text-xs sm:max-w-[65%]" value={draft.agentModel ?? ''} onChange={(event) => commitSettings({ ...draft, agentModel: event.target.value })}><option value="">自动使用主备默认模型</option>{[...new Set(getAgentApiCandidates({ ...draft, agentModel: '' }).flatMap(getAgentModels))].map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
    <PreferenceToggle label="新对话默认开启网络搜索" description="使用服务商的联网搜索，支持情况与费用以服务商说明为准。" checked={draft.agentWebSearch} onChange={() => {
      const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === '' ? DEFAULT_AGENT_MAX_TOOL_ROUNDS : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
      setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
      commitSettings({ ...draft, agentMaxToolRounds, agentWebSearch: !draft.agentWebSearch })
    }} />
    <PreferenceToggle label="发送后滚动到最新消息" description="发送成功后自动到达对话底部，便于查看接下来的回复。" checked={draft.agentScrollToBottomAfterSubmit} onChange={() => commitSettings({ ...draft, agentScrollToBottomAfterSubmit: !draft.agentScrollToBottomAfterSubmit })} />
    <PreferenceToggle label="绘图提示词优化" description="整理绘图需求、区分参考图用途，改图时明确修改范围和保留项，并沿用当前分支已确认的要求。默认开启；保存后对所有对话的下一次请求生效。关闭恢复基础对话规则，不影响“只优化提示词”按钮；“直接生成”不经过此优化。" checked={draft.agentPromptOptimization} onChange={() => commitSettings({ ...draft, agentPromptOptimization: !draft.agentPromptOptimization })} />
    <details className="border-t border-gray-200 pt-3 dark:border-white/10"><summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">高级偏好</summary>
      <label className="mt-4 flex items-center justify-between gap-3 text-sm"><span>连续工具调用上限<span className="mt-1 block text-xs text-gray-500">默认 1 次，不自动迭代生图；可设置 1–50 次。</span></span><input aria-label="连续工具调用上限" value={agentMaxToolRoundsInput} onChange={(event) => setAgentMaxToolRoundsInput(event.target.value)} onBlur={commitAgentMaxToolRounds} type="number" min={1} max={50} className="w-20 rounded-lg border border-gray-200 bg-transparent p-2 text-sm dark:border-white/10" /></label>
      <PreferenceToggle label="优化数学公式显示" description="提示模型使用适合本工具展示的公式格式。" checked={draft.agentMathFormattingPrompt} onChange={() => commitSettings({ ...draft, agentMathFormattingPrompt: !draft.agentMathFormattingPrompt })} />
    </details>
  </section>
}
