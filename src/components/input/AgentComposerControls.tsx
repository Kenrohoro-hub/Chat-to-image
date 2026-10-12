import { t } from '../../lib/i18n'
import { REASONING_EFFORT_VALUES, type ReasoningEffort } from '../../types'
import { withConversationPreferences } from '../../lib/agentPreferences'
import { useStore, setCurrentAgentPreferences } from '../../store'
import { getAgentApiCandidates, getAgentModels, validateApiProfile } from '../../lib/apiProfiles'
import ModelPicker from './ModelPicker'

interface AgentComposerControlsProps {
  running: boolean
  canSubmit: boolean
  atImageLimit: boolean
  onAttach: () => void
  onSubmit: () => void
  onStop: () => void
  onTemplates?: () => void
  onSaveTemplate?: () => void
  onOptimize?: () => void
  onGenerate?: () => void
}

export default function AgentComposerControls({ running, canSubmit, atImageLimit, onAttach, onSubmit, onStop, onTemplates, onSaveTemplate, onOptimize, onGenerate }: AgentComposerControlsProps) {
  const saved = useStore((state) => state.settings)
  const conversation = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId))
  const settings = withConversationPreferences(saved, conversation)
  const setSettings = setCurrentAgentPreferences
  const setShowSettings = useStore((state) => state.setShowSettings)
  const candidates = getAgentApiCandidates({ ...settings, agentModel: '' }).filter((profile) => !validateApiProfile(profile))
  const models = [...new Set(candidates.flatMap(getAgentModels))]
  const selected = settings.agentModel ?? ''
  const unavailable = Boolean(selected && !models.includes(selected))
  const configured = candidates.length > 0 && !unavailable
  const hasPrompt = useStore((state) => Boolean(state.prompt.trim()))
  const current = candidates.find((profile) => !selected || getAgentModels(profile).includes(selected))
  const capabilities = current?.modelCapabilities?.[selected || current.model]
  return <div className="agent-composer-controls">
    {onGenerate && <div className="creation-shortcuts">
      <button type="button" disabled={running || !hasPrompt} onClick={configured ? onOptimize : () => setShowSettings(true, 'agent-api')}>{t('只优化提示词', 'Optimize prompt only')}</button>
      <button type="button" onClick={onTemplates}>{t('提示词库', 'Prompt library')}</button>
      <button type="button" disabled={!hasPrompt} onClick={onSaveTemplate}>{t('保存提示词', 'Save prompt')}</button>
      <button type="button" disabled={running || !hasPrompt} onClick={onGenerate}>{t('直接生成', 'Generate directly')}</button>
    </div>}
    <div className="agent-composer-toolbar">
      <button type="button" onClick={onAttach} disabled={atImageLimit || running} aria-label={t('添加图片附件', 'Attach images')} className="agent-tool-button">＋ <span>{t('图片', 'Image')}</span></button>
      <ModelPicker label={t('对话模型', 'Chat model')} value={selected} models={models} disabled={running} automatic={candidates.length ? t(`自动 · ${candidates[0].model}`, `Auto · ${candidates[0].model}`) : t('请配置对话模型', 'Configure a chat model')} onChange={(agentModel) => {
        const next = candidates.find((profile) => !agentModel || getAgentModels(profile).includes(agentModel))
        const capability = next?.modelCapabilities?.[agentModel || next.model]
        const effort = settings.agentReasoningEffort ?? ''
        setSettings({ agentModel, agentReasoningEffort: capability?.reasoning === false || (effort && capability?.reasoningEfforts && !capability.reasoningEfforts.includes(effort)) ? '' : effort })
      }} />
      <label className="agent-effort-picker"><span className="sr-only">{t('推理强度', 'Reasoning effort')}</span><select aria-label={t('推理强度', 'Reasoning effort')} title={capabilities?.reasoning === false ? t('此模型不支持推理参数', 'This model does not support reasoning parameters') : t('默认由服务决定；未知能力可手动选择，拒绝会明确反馈', 'The service decides by default. For unknown capabilities, choose manually; rejection will be reported.')} disabled={running || capabilities?.reasoning === false} value={settings.agentReasoningEffort ?? ''} onChange={(event) => setSettings({ agentReasoningEffort: event.target.value as ReasoningEffort | '' })}><option value="">{t('强度 · 默认', 'Effort · Default')}</option>{(capabilities?.reasoningEfforts ?? REASONING_EFFORT_VALUES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" className="agent-tool-button" aria-pressed={settings.agentWebSearch} disabled={running} onClick={() => setSettings({ agentWebSearch: !settings.agentWebSearch })}>{t('联网搜索', 'Web search')}</button>
      <button type="button" className="agent-send-button" disabled={!running && configured && !canSubmit} onClick={running ? onStop : configured ? onSubmit : () => setShowSettings(true, 'agent-api')} aria-label={running ? t('停止回复', 'Stop reply') : t('发送消息', 'Send message')} title={running ? undefined : !configured ? t('请先在 Agent API 配置中启用所选模型，再发送消息。', 'Enable the selected model in Chat API profiles before sending a message.') : settings.enterSubmit ? t('Enter 发送 · Shift + Enter 换行', 'Enter to send · Shift + Enter for a new line') : t('Ctrl + Enter 发送 · Enter 换行', 'Ctrl + Enter to send · Enter for a new line')}>{running ? t('■ 停止', '■ Stop') : t('↑ 发送', '↑ Send')}</button>
    </div>
    {configured && !running && capabilities?.tools === false && <p className="agent-composer-hint">{t('此模型已标记不支持工具调用；可在回复下点击“按此提示词生图”，或更换模型。', 'This model does not support tool calls. Click Generate from this prompt below a reply, or choose another model.')}</p>}
    {(running || unavailable || !configured) && <p role="status" className="agent-composer-hint">{running ? t('正在处理，停止仅终止本地后续任务；已受理的远端生图可能继续。', 'Working. Stopping cancels subsequent local tasks; image generation already accepted by the remote service may continue.') : unavailable ? t('所选模型暂无已启用的可用方案，请更换模型或调整 API 配置。', 'No enabled profile is available for this model. Choose another model or update API profiles.') : t('先在 API 配置 → Agent 中填写服务与模型。', 'Set up the service and model in Chat API profiles first.')}</p>}
  </div>
}
