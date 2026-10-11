import { useEffect, useRef, useState } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import FeatureIntroTab from './settings/FeatureIntroTab'
import { CloseIcon } from './icons'

export default function WelcomeModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [hideNextTime, setHideNextTime] = useState(false)
  const [error, setError] = useState('')
  usePreventBackgroundScroll(true, scroll)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  const close = () => {
    if (hideNextTime) {
      try { localStorage.setItem('chat-to-image-hide-welcome', '1') }
      catch { setError('无法保存关闭偏好，请允许本地存储后重试，或取消勾选后继续。'); return }
    }
    onClose()
  }
  useCloseOnEscape(true, close)
  return <dialog ref={dialog} aria-labelledby="welcome-title" onCancel={(event) => { event.preventDefault(); close() }} className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-sm dark:bg-gray-900 dark:text-gray-100">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/10"><h2 id="welcome-title" className="font-semibold">欢迎使用 Chat to image</h2><button type="button" aria-label="关闭功能介绍" onClick={close} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"><CloseIcon className="h-5 w-5" /></button></header>
      <div ref={scroll} className="min-h-0 overflow-y-auto p-4 sm:p-5"><FeatureIntroTab /></div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 dark:border-white/10"><label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={hideNextTime} onChange={(event) => setHideNextTime(event.target.checked)} />不再自动显示此介绍</label><button type="button" onClick={close} className="min-h-11 rounded-xl bg-gray-900 px-5 text-sm text-white dark:bg-gray-100 dark:text-gray-900">开始使用</button>{error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}</footer>
    </div>
  </dialog>
}
