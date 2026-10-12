import type { AppSettings } from '../../types'
import Select from '../Select'
import PreferenceToggle from './PreferenceToggle'
import { t } from '../../lib/i18n'

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
    <div><h3 className="text-base font-semibold">{t('使用习惯', 'Preferences')}</h3><p className="mt-1 text-xs text-gray-500">{t('外观、输入与生成偏好，集中在这里调整。', 'Adjust appearance, input, and generation preferences here.')}</p></div>
    <section className={cardClass} aria-label={t('外观', 'Appearance')}>
      <h4 className="text-sm font-semibold">{t('外观', 'Appearance')}</h4>
      <label className="flex items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">{t('界面外观', 'Theme')}<select aria-label={t('界面外观', 'Theme')} className="rounded-lg border bg-background p-2" value={draft.theme ?? 'system'} onChange={(event) => commitSettings({ ...draft, theme: event.target.value as AppSettings['theme'] })}><option value="system">{t('跟随系统', 'System')}</option><option value="light">{t('浅色', 'Light')}</option><option value="dark">{t('深色', 'Dark')}</option></select></label>
    </section>
    <section className={cardClass} aria-label={t('输入', 'Input')}>
      <h4 className="text-sm font-semibold">{t('输入', 'Input')}</h4>
      <div className="hidden sm:block">
        <div className="flex items-center justify-between gap-3"><span className="text-sm text-gray-600 dark:text-gray-300">{t('任务提交方式', 'Send with')}</span><div className="w-36 shrink-0"><Select value={draft.enterSubmit ? 'enter' : 'ctrl-enter'} onChange={(value) => commitSettings({ ...draft, enterSubmit: value === 'enter' })} options={[{ label: navigator.userAgent.includes('Mac') ? '⌘ + Enter' : 'Ctrl + Enter', value: 'ctrl-enter' }, { label: 'Enter', value: 'enter' }]} className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-xs dark:border-white/10" /></div></div>
        <p className="mt-2 text-xs text-gray-500">{t('使用组合键发送时，Enter 换行；使用 Enter 发送时，Shift + Enter 换行。', 'When sending with a shortcut, Enter adds a new line. When sending with Enter, use Shift + Enter for a new line.')}</p>
      </div>
      <div className="sm:hidden"><label className="flex flex-col gap-2 text-sm">{t('任务提交方式', 'Send with')}<select aria-label={t('任务提交方式', 'Send with')} className="w-full min-w-0 rounded-lg border bg-background p-2 text-xs" value={draft.enterSubmit ? 'enter' : 'button'} onChange={(event) => commitSettings({ ...draft, enterSubmit: event.target.value === 'enter' })}><option value="button">{t('发送按钮', 'Send button')}</option><option value="enter">{t('回车 / 发送按钮', 'Enter / Send button')}</option></select></label></div>
      <PreferenceToggle label={t('重启后恢复输入框', 'Restore input after restarting')} description={t('保留提示词和参考图，下次打开继续编辑。关闭后下次以空输入框开始。', 'Keep your prompt and references for the next session. Turn off to start with an empty composer.')} checked={draft.persistInputOnRestart} onChange={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })} />
    </section>
    <section className={cardClass} aria-label={t('图像生成', 'Image generation')}>
      <h4 className="text-sm font-semibold">{t('图像生成', 'Image generation')}</h4>
      <PreferenceToggle label={t('成功后保留重试按钮', 'Keep retry available after success')} description={t('在任务卡片和详情页快速重新生成，方便比较不同结果。', 'Regenerate from task cards or details to compare results.')} checked={draft.alwaysShowRetryButton} onChange={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })} />
      <PreferenceToggle label={t('允许模型优化提示词', 'Allow the model to refine prompts')} description={t('允许服务商按其策略改写提示词；关闭时会附加尽量保留原文的要求。', 'Allow the provider to rewrite prompts. Turning this off adds a request to preserve your wording where possible.')} checked={draft.allowPromptRewrite} onChange={() => commitSettings({ ...draft, allowPromptRewrite: !draft.allowPromptRewrite })} />
    </section>
    <section className={cardClass} aria-label={t('下载与通知', 'Downloads and notifications')}>
      <h4 className="text-sm font-semibold">{t('下载与通知', 'Downloads and notifications')}</h4>
      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm text-gray-600 dark:text-gray-300">{t('压缩包批量下载', 'Download batches as ZIP')}</p><p className="mt-1 text-xs leading-relaxed text-gray-500">{zipDownloadRouteSummary}</p></div><button type="button" onClick={onOpenZipDownloadRouteManager} className="min-h-11 shrink-0 rounded-lg border border-gray-200 px-3 text-xs dark:border-white/10">{t('管理途径', 'Manage download actions')}</button></div>
      <PreferenceToggle label={t('任务完成后发送系统通知', 'Notify when tasks finish')} description={t('图像生成或对话完成后提醒你；首次开启时需要允许浏览器通知。', 'Receive a notification when generation or a chat reply finishes. Allow browser notifications when enabling this for the first time.')} checked={draft.taskCompletionNotification} onChange={() => { void toggleTaskCompletionNotification() }} />
    </section>
  </div>
}
