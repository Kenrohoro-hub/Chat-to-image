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
      <button type="button" disabled={running || !hasPrompt} onClick={configured ? onOptimize : () => setShowSettings(true, 'agent-api')}>只优化提示词</button>
      <button type="button" onClick={onTemplates}>提示词库</button>
      <button type="button" disabled={!hasPrompt} onClick={onSaveTemplate}>保存提示词</button>
      <button type="button" disabled={running || !hasPrompt} onClick={onGenerate}>直接生成</button>
    </div>}
    <div className="agent-composer-toolbar">
      <button type="button" onClick={onAttach} disabled={atImageLimit || running} aria-label="添加图片附件" className="agent-tool-button">＋ <span>图片</span></button>
      <ModelPicker label="对话模型" value={selected} models={models} disabled={running} automatic={candidates.length ? `自动 · ${candidates[0].model}` : '请配置对话模型'} onChange={(agentModel) => {
        const next = candidates.find((profile) => !agentModel || getAgentModels(profile).includes(agentModel))
        const capability = next?.modelCapabilities?.[agentModel || next.model]
        const effort = settings.agentReasoningEffort ?? ''
        setSettings({ agentModel, agentReasoningEffort: capability?.reasoning === false || (effort && capability?.reasoningEfforts && !capability.reasoningEfforts.includes(effort)) ? '' : effort })
      }} />
      <label className="agent-effort-picker"><span className="sr-only">推理强度</span><select aria-label="推理强度" title={capabilities?.reasoning === false ? '此模型不支持推理参数' : '默认由服务决定；未知能力可手动选择，拒绝会明确反馈'} disabled={running || capabilities?.reasoning === false} value={settings.agentReasoningEffort ?? ''} onChange={(event) => setSettings({ agentReasoningEffort: event.target.value as ReasoningEffort | '' })}><option value="">强度 · 默认</option>{(capabilities?.reasoningEfforts ?? REASONING_EFFORT_VALUES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" className="agent-tool-button" aria-pressed={settings.agentWebSearch} disabled={running} onClick={() => setSettings({ agentWebSearch: !settings.agentWebSearch })}>联网搜索</button>
      <button type="button" className="agent-send-button" disabled={!running && configured && !canSubmit} onClick={running ? onStop : configured ? onSubmit : () => setShowSettings(true, 'agent-api')} aria-label={running ? '停止回复' : '发送消息'} title={running ? undefined : !configured ? '请先在 Agent API 配置中启用所选模型，再发送消息。' : settings.enterSubmit ? 'Enter 发送 · Shift + Enter 换行' : 'Ctrl + Enter 发送 · Enter 换行'}>{running ? '■ 停止' : '↑ 发送'}</button>
    </div>
    {configured && !running && capabilities?.tools === false && <p className="agent-composer-hint">此模型已标记不支持工具调用；可在回复下点击“按此提示词生图”，或更换模型。</p>}
    {(running || unavailable || !configured) && <p role="status" className="agent-composer-hint">{running ? '正在处理，停止仅终止本地后续任务；已受理的远端生图可能继续。' : unavailable ? '所选模型暂无已启用的可用方案，请更换模型或调整 API 配置。' : '先在 API 配置 → Agent 中填写服务与模型。'}</p>}
  </div>
}
