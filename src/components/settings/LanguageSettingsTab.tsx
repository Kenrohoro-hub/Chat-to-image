import { getUiLanguage, t, type UiLanguagePreference } from '../../lib/i18n'

interface LanguageSettingsTabProps {
  value: UiLanguagePreference
  onChange: (value: UiLanguagePreference) => void
}

export default function LanguageSettingsTab({ value, onChange }: LanguageSettingsTabProps) {
  return <div className="space-y-4">
    <div><h3 className="text-base font-semibold">{t('语言', 'Language')}</h3><p className="mt-1 text-xs text-gray-500">{t('选择界面语言，与欢迎页的语言按钮共用同一份选择。', 'Choose the interface language. This uses the same preference as the welcome page.')}</p></div>
    <section className="space-y-3 rounded-xl border border-gray-200/80 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.02]" aria-label={t('界面语言', 'Interface language')}>
      <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300">{t('界面语言', 'Interface language')}<select aria-label={t('界面语言', 'Interface language')} className="min-h-11 rounded-lg border bg-background px-3 py-2" value={value} onChange={(event) => onChange(event.target.value as UiLanguagePreference)}><option value="system">{t('跟随系统', 'Follow system')}</option><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      <p className="text-xs leading-relaxed text-gray-500">{t('跟随系统时，中文系统显示中文，其他系统语言显示英文。桌面版读取 Windows 显示语言，网页版读取浏览器首选语言。', 'Following the system uses Chinese for Chinese languages and English for all other languages. The desktop app reads the Windows display language; the web app reads the browser’s preferred language.')}</p>
      <p className="text-xs text-gray-500">{t('当前显示语言：', 'Current interface language: ')}{getUiLanguage() === 'zh-CN' ? '中文' : 'English'}</p>
      <p className="text-xs leading-relaxed text-gray-500">{t('点击“保存配置”后保存全部设置草稿并刷新界面。运行中的任务请先完成或停止；需要保留输入草稿时，请开启“重启后恢复输入框”。', 'Save configuration saves all settings drafts and reloads the interface. Finish or stop running tasks first. Enable Restore input after restarting to keep input drafts.')}</p>
    </section>
  </div>
}
