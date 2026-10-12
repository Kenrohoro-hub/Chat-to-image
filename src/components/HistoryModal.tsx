import { t } from '../lib/i18n'
import { useEffect, useRef, type RefObject } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import ConversationList from './ConversationList'
import { CloseIcon, HistoryIcon } from './icons'

export default function HistoryModal({ onClose, ignoreOutsideClickRef }: { onClose: () => void; ignoreOutsideClickRef?: RefObject<HTMLElement | null> }) {
  const modalRef = useRef<HTMLDivElement>(null)
  const confirmDialogOpen = useStore((state) => Boolean(state.confirmDialog))
  useCloseOnEscape(true, onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modalRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => {
      useStore.getState().setAgentEditingConversationId(null)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    const outside = (event: MouseEvent | TouchEvent) => {
      if (confirmDialogOpen || ignoreOutsideClickRef?.current?.contains(event.target as Node)) return
      if (!modalRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('touchstart', outside, true)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('touchstart', outside, true)
    }
  }, [confirmDialogOpen, ignoreOutsideClickRef, onClose])
  return <div ref={modalRef} id="conversation-history" role="dialog" aria-label={t('对话历史', 'Chat history')} className="conversation-history-popover" onKeyDown={(event) => {
    if (event.key !== 'Tab' || confirmDialogOpen) return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')).filter((element) => element.getClientRects().length)
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <div className="conversation-history-heading"><div><h2><HistoryIcon className="h-4 w-4" aria-hidden="true" />{t('对话历史', 'Chat history')}</h2><p>{t('继续之前的创作，或多选整理对话', 'Continue previous creations or select chats to organize')}</p></div><button type="button" aria-label={t('关闭对话历史', 'Close chat history')} onClick={onClose}><CloseIcon className="h-4 w-4" /></button></div>
    <ConversationList history onOpen={() => { useStore.getState().setAppMode('agent'); onClose() }} />
  </div>
}
