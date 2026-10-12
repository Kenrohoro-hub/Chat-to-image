import { useEffect, useRef, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import FeatureIntroTab from './settings/FeatureIntroTab'
import { CloseIcon } from './icons'
import { getUiLanguage, setUiLanguage, t } from '../lib/i18n'

export default function WelcomeModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [hideNextTime, setHideNextTime] = useState(false)
  const [error, setError] = useState('')
  const language = getUiLanguage()
  usePreventBackgroundScroll(true, scroll)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  const close = () => {
    if (hideNextTime) {
      try { localStorage.setItem('chat-to-image-hide-welcome', '1') }
      catch { setError(t('无法保存关闭偏好，请允许本地存储后重试，或取消勾选后继续。', 'Unable to save this preference. Allow local storage and retry, or uncheck the option to continue.')); return }
    }
    onClose()
  }
  useCloseOnEscape(true, close)
  return <dialog ref={dialog} aria-labelledby="welcome-title" onCancel={(event) => { event.preventDefault(); close() }} className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-sm dark:bg-gray-900 dark:text-gray-100">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/10"><h2 id="welcome-title" className="font-semibold">{t('欢迎使用 Chat to image', 'Welcome to Chat to image')}</h2><button type="button" aria-label={t('关闭功能介绍', 'Close introduction')} onClick={close} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"><CloseIcon className="h-5 w-5" /></button></header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2 dark:border-white/10" role="group" aria-label={t('界面语言', 'Interface language')}>
        <span className="mr-1 text-xs text-gray-500">{t('界面语言', 'Interface language')}</span>
        {(['zh-CN', 'en'] as const).map((value) => <button key={value} type="button" aria-pressed={language === value} onClick={() => { if (language === value) return; try { setUiLanguage(value); window.location.reload() } catch { setError(t('无法保存语言选择，请允许本地存储后重试。', 'Unable to save the language selection. Allow local storage and try again.')) } }} className={`min-h-9 rounded-lg border px-3 text-xs ${language === value ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5'}`}>{value === 'zh-CN' ? '中文' : 'English'}</button>)}
      </div>
      <div ref={scroll} className="min-h-0 overflow-y-auto p-4 sm:p-5"><FeatureIntroTab /></div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 dark:border-white/10"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={hideNextTime} onChange={(event) => setHideNextTime(event.target.checked)} />{t('不再自动显示此介绍', 'Do not show this introduction automatically')}</label><button type="button" onClick={close} className="min-h-11 rounded-xl bg-gray-900 px-5 text-sm text-white dark:bg-gray-100 dark:text-gray-900">{t('开始使用', 'Get started')}</button>{error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}</footer>
    </div>
  </dialog>
}
