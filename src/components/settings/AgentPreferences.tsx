import type { AppSettings } from '../../types'
import { getAgentApiCandidates, getAgentModels } from '../../lib/apiProfiles'
import PreferenceToggle from './PreferenceToggle'
import { t } from '../../lib/i18n'

interface AgentPreferencesProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

export default function AgentPreferences({ draft, commitSettings }: AgentPreferencesProps) {
  return <section className="mt-4 space-y-3 rounded-xl border border-gray-200/80 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.02]" aria-label={t('对话习惯', 'Chat preferences')}>
    <h4 className="text-sm font-semibold">{t('对话习惯', 'Chat preferences')}</h4>
    <p className="text-xs leading-relaxed text-gray-500">{t('默认模型和联网设置用于新对话；已有对话可在输入区调整。', 'The default model and web search settings apply to new conversations. Adjust existing conversations in the composer.')}</p>
    <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">{t('新对话默认模型', 'Default model for new conversations')}<select aria-label={t('新对话默认模型', 'Default model for new conversations')} className="min-w-0 max-w-full rounded-lg border bg-background p-2 text-xs sm:max-w-[65%]" value={draft.agentModel ?? ''} onChange={(event) => commitSettings({ ...draft, agentModel: event.target.value })}><option value="">{t('自动使用主备默认模型', 'Use the primary or backup profile\'s default model')}</option>{[...new Set(getAgentApiCandidates({ ...draft, agentModel: '' }).flatMap(getAgentModels))].map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
    <PreferenceToggle label={t('新对话默认开启网络搜索', 'Enable web search for new conversations')} description={t('使用服务商的联网搜索，支持情况与费用以服务商说明为准。', 'Uses the provider\'s web search. Availability and pricing depend on the provider.')} checked={draft.agentWebSearch} onChange={() => commitSettings({ ...draft, agentWebSearch: !draft.agentWebSearch })} />
    <PreferenceToggle label={t('发送后滚动到最新消息', 'Scroll to the latest message after sending')} description={t('发送成功后自动到达对话底部，便于查看接下来的回复。', 'Scroll to the bottom after sending successfully so you can follow the reply.')} checked={draft.agentScrollToBottomAfterSubmit} onChange={() => commitSettings({ ...draft, agentScrollToBottomAfterSubmit: !draft.agentScrollToBottomAfterSubmit })} />
    <PreferenceToggle label={t('绘图提示词优化', 'Image prompt optimization')} description={t('整理绘图需求、区分参考图用途，改图时明确修改范围和保留项，并沿用当前分支已确认的要求。默认开启；保存后对所有对话的下一次请求生效。关闭恢复基础对话规则，不影响“只优化提示词”按钮；“直接生成”不经过此优化。', 'Organizes image requirements and reference roles, specifies what to change and preserve, and carries forward confirmed requirements in the current branch. Enabled by default; saving applies it to the next request in every conversation. Turning it off restores basic chat rules and keeps Optimize prompt only available. Generate directly bypasses this optimization.')} checked={draft.agentPromptOptimization} onChange={() => commitSettings({ ...draft, agentPromptOptimization: !draft.agentPromptOptimization })} />
    <details className="border-t border-gray-200 pt-3 dark:border-white/10"><summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">{t('高级偏好', 'Advanced preferences')}</summary>
      <PreferenceToggle label={t('优化数学公式显示', 'Improve math formatting')} description={t('提示模型使用适合本工具展示的公式格式。', 'Ask the model to use math notation this tool can display.')} checked={draft.agentMathFormattingPrompt} onChange={() => commitSettings({ ...draft, agentMathFormattingPrompt: !draft.agentMathFormattingPrompt })} />
    </details>
  </section>
}
