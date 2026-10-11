import type { AppSettings } from '../../types'
import Select from '../Select'
import PreferenceToggle from './PreferenceToggle'

interface GeneralSettingsTabProps {
  draft: AppSettings
  zipDownloadRouteSummary: string
  commitSettings: (nextDraft: AppSettings) => void
  onOpenZipDownloadRouteManager: () => void
  toggleTaskCompletionNotification: () => Promise<void>
}

export default function GeneralSettingsTab({ draft, zipDownloadRouteSummary, commitSettings, onOpenZipDownloadRouteManager, toggleTaskCompletionNotification }: GeneralSettingsTabProps) {
  const cardClass = 'space-y-3 rounded-xl border border-gray-200/80 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.02]'
  return <div className="space-y-4">
    <div><h3 className="text-base font-semibold">使用习惯</h3><p className="mt-1 text-xs text-gray-500">外观、输入与生成偏好，集中在这里调整。</p></div>
    <section className={cardClass} aria-label="外观">
      <h4 className="text-sm font-semibold">外观</h4>
      <label className="flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">界面外观<select aria-label="界面外观" className="rounded-lg border bg-background p-2" value={draft.theme ?? 'system'} onChange={(event) => commitSettings({ ...draft, theme: event.target.value as AppSettings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    </section>
    <section className={cardClass} aria-label="输入">
      <h4 className="text-sm font-semibold">输入</h4>
      <div className="hidden sm:block">
        <div className="flex items-center justify-between gap-3"><span className="text-sm text-gray-600 dark:text-gray-300">任务提交方式</span><div className="w-36 shrink-0"><Select value={draft.enterSubmit ? 'enter' : 'ctrl-enter'} onChange={(value) => commitSettings({ ...draft, enterSubmit: value === 'enter' })} options={[{ label: navigator.userAgent.includes('Mac') ? '⌘ + Enter' : 'Ctrl + Enter', value: 'ctrl-enter' }, { label: 'Enter', value: 'enter' }]} className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-xs dark:border-white/10" /></div></div>
        <p className="mt-2 text-xs text-gray-500">使用组合键发送时，Enter 换行；使用 Enter 发送时，Shift + Enter 换行。</p>
      </div>
      <div className="sm:hidden"><label className="flex flex-col gap-2 text-sm">任务提交方式<select aria-label="任务提交方式" className="w-full min-w-0 rounded-lg border bg-background p-2 text-xs" value={draft.enterSubmit ? 'enter' : 'button'} onChange={(event) => commitSettings({ ...draft, enterSubmit: event.target.value === 'enter' })}><option value="button">发送按钮</option><option value="enter">回车 / 发送按钮</option></select></label></div>
      <PreferenceToggle label="重启后恢复输入框" description="保留提示词和参考图，下次打开继续编辑。关闭后下次以空输入框开始。" checked={draft.persistInputOnRestart} onChange={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })} />
    </section>
    <section className={cardClass} aria-label="图像生成">
      <h4 className="text-sm font-semibold">图像生成</h4>
      <PreferenceToggle label="成功后保留重试按钮" description="在任务卡片和详情页快速重新生成，方便比较不同结果。" checked={draft.alwaysShowRetryButton} onChange={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })} />
      <PreferenceToggle label="允许模型优化提示词" description="允许服务商按其策略改写提示词；关闭时会附加尽量保留原文的要求。" checked={draft.allowPromptRewrite} onChange={() => commitSettings({ ...draft, allowPromptRewrite: !draft.allowPromptRewrite })} />
    </section>
    <section className={cardClass} aria-label="下载与通知">
      <h4 className="text-sm font-semibold">下载与通知</h4>
      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm text-gray-600 dark:text-gray-300">压缩包批量下载</p><p className="mt-1 text-xs leading-relaxed text-gray-500">{zipDownloadRouteSummary}</p></div><button type="button" onClick={onOpenZipDownloadRouteManager} className="min-h-11 shrink-0 rounded-lg border border-gray-200 px-3 text-xs dark:border-white/10">管理途径</button></div>
      <PreferenceToggle label="任务完成后发送系统通知" description="图像生成或对话完成后提醒你；首次开启时需要允许浏览器通知。" checked={draft.taskCompletionNotification} onChange={() => { void toggleTaskCompletionNotification() }} />
    </section>
  </div>
}
