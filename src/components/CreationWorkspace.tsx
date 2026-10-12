import { getConversationLabel, t } from '../lib/i18n'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { flushAgentConversationsToIndexedDB } from '../lib/agentConversationPersistence'
import AgentWorkspace from './AgentWorkspace'
import CreationContext from './CreationContext'
import InputBar from './InputBar'
import GalleryResults from './gallery/GalleryResults'
import RecentHistory from './gallery/RecentHistory'
import DraftUndoNotice from './input/DraftUndoNotice'

function CreationDrawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useCloseOnEscape(open, onClose)
  usePreventBackgroundScroll(open, ref)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => previous?.focus()
  }, [open])
  return createPortal(<div className="gallery-shelf-overlay creation-drawer-overlay" hidden={!open} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={ref} className="creation-drawer" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const controls = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}><div className="creation-panel-heading"><h2><button type="button" className="creation-panel-toggle" aria-label={t(`折叠${title}`, `Collapse ${title}`)} aria-expanded={true} onClick={onClose}><span aria-hidden="true">‹</span><span>{title}</span></button></h2><button type="button" aria-label={t(`关闭${title}`, `Close ${title}`)} onClick={onClose}>×</button></div>{children}</div></div>, document.body)
}

export default function CreationWorkspace({ onAllHistory }: { onAllHistory: () => void }) {
  const [paramsHost, setParamsHost] = useState<HTMLDivElement | null>(null)
  const [drawer, setDrawer] = useState<'params' | 'history' | null>(null)
  const [focus, setFocus] = useState<'auto' | 'conversation' | 'result'>('auto')
  const conversation = useStore((state) => state.agentConversations.find((item) => item.id === state.activeAgentConversationId))
  const saveError = useStore((state) => state.agentConversationSaveError)
  const sidebarCollapsed = useStore((state) => state.agentSidebarCollapsed)
  useEffect(() => { if (!sidebarCollapsed) setFocus('conversation') }, [sidebarCollapsed])
  useEffect(() => {
    const compose = () => setFocus('auto')
    window.addEventListener('playground-compose', compose)
    return () => window.removeEventListener('playground-compose', compose)
  }, [])
  const running = conversation?.rounds.some((round) => round.status === 'running')
  return <main className="creation-workspace" aria-label={t('对话创作工作区', 'Creative chat workspace')} data-focus={focus}>
    <div className="creation-toolbar">
      <h1>{conversation ? getConversationLabel(conversation) : t('新建创作', 'New creation')}</h1>
      <div className="creation-view-controls" aria-label={t('工作区视图', 'Workspace view')}>
        <button type="button" aria-pressed={focus === 'auto'} onClick={() => setFocus('auto')}><span className="creation-desktop-label">{t('左右分栏', 'Split view')}</span><span className="creation-mobile-label">{t('对话', 'Chat')}</span></button>
        <button type="button" className="creation-conversation-focus" aria-pressed={focus === 'conversation'} onClick={() => setFocus('conversation')}>{t('展开对话', 'Expand chat')}</button>
        <button type="button" aria-pressed={focus === 'result'} onClick={() => setFocus('result')}>{t('聚焦图片', 'Focus images')}</button>
      </div>
      <div className="creation-toolbar-actions"><button type="button" className="creation-params-button" aria-label={t('生图参数', 'Image settings')} aria-expanded={drawer === 'params'} aria-haspopup="dialog" onClick={() => setDrawer('params')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
        <span className="creation-params-copy"><span>{t('生图参数', 'Image settings')}</span><small>{t('模型 · 尺寸 · 张数', 'Model · Size · Count')}</small></span>
      </button><button type="button" aria-expanded={drawer === 'history'} aria-haspopup="dialog" onClick={() => setDrawer('history')}>{t('最近生成', 'Recent generations')}</button></div>
    </div>
    <div className="creation-panes">
      <section className="creation-center" aria-label={t('创作对话', 'Creative chat')} hidden={focus === 'result'}>
        <div className="creation-conversation-heading"><h2>{t('创作对话', 'Creative chat')}</h2><span role="status">{running ? t('正在处理…', 'Working…') : t('可讨论，也可附图修改', 'Discuss ideas or attach images to edit')}</span></div>
        <div id="creation-conversation" className="creation-conversation"><AgentWorkspace /></div>
        {saveError && <div role="alert" className="creation-save-error">{saveError}<button type="button" onClick={() => void flushAgentConversationsToIndexedDB()}>{t('重试保存对话', 'Retry saving chat')}</button></div>}
        <CreationContext key={conversation?.id ?? 'new'} />
        <InputBar creation paramsTarget={paramsHost} />
        <DraftUndoNotice />
      </section>
      <section className="creation-results-panel" aria-label={t('图片比较与历史', 'Image comparison and history')} hidden={focus === 'conversation'}>
        <GalleryResults key={conversation?.id ?? 'new'} />
        <RecentHistory compact onAllHistory={onAllHistory} onExpand={() => setDrawer('history')} />
      </section>
    </div>
    <CreationDrawer open={drawer !== null} title={drawer === 'history' ? t('最近生成', 'Recent generations') : t('生图参数', 'Image settings')} onClose={() => setDrawer(null)}>
      <div className="creation-params-scroll" hidden={drawer !== 'params'} ref={setParamsHost} />
      {drawer === 'history' && <RecentHistory onAllHistory={() => { setDrawer(null); onAllHistory() }} onApply={() => setDrawer(null)} />}
    </CreationDrawer>
  </main>
}
