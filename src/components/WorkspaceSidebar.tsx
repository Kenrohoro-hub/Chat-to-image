import { t } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import ConversationList from './ConversationList'
import { flushAgentConversationsToIndexedDB } from '../lib/agentConversationPersistence'
import { desktopApi, desktopSaveError, isLocalService, saveDesktopSettings, syncDesktopSettings } from '../lib/desktop'

function NavIcon({ path }: { path: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}

export default function WorkspaceSidebar({ view, onNavigate }: { view: 'new' | 'history' | 'prompts'; onNavigate: (view: 'new' | 'history' | 'prompts') => void }) {
  const appMode = useStore((state) => state.appMode)
  const filterFavorite = useStore((state) => state.filterFavorite)
  const taskCount = useStore((state) => state.tasks.length)
  const conversationSaveError = useStore((state) => state.agentConversationSaveError)
  const [saveError, setSaveError] = useState('')
  useEffect(() => {
    const update = () => setSaveError(desktopSaveError)
    window.addEventListener('playground-settings-status', update)
    return () => window.removeEventListener('playground-settings-status', update)
  }, [])
  useEffect(() => {
    if (!isLocalService()) return
    let stopped = false
    let updating = false
    const update = async () => {
      if (stopped || updating) return
      updating = true
      try {
        const next = await (await desktopApi()).status()
        if (stopped) return
        await syncDesktopSettings(next.revision, (settings) => {
          useStore.getState().setSettings(settings)
          return useStore.getState().settings
        })
      } catch { /* 保存失败由独立提示处理，下轮继续同步。 */ }
      finally { updating = false }
    }
    void update()
    const timer = window.setInterval(update, 5000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])
  const navigate = (next: 'new' | 'history' | 'prompts' | 'favorites' | 'agent') => {
    if (next === 'prompts') { onNavigate('prompts'); return }
    const state = useStore.getState()
    state.setAppMode(next === 'agent' || next === 'new' ? 'agent' : 'gallery')
    state.setFilterFavorite(next === 'favorites')
    state.setSearchQuery('')
    state.setFilterStatus('all')
    onNavigate(next === 'new' ? 'new' : 'history')
    if (next === 'new') {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-bar] [contenteditable="true"]')?.focus())
    }
  }
  const current = view === 'prompts' ? 'prompts' : appMode === 'agent' ? 'new' : filterFavorite ? 'favorites' : view
  return (
    <aside className="workspace-sidebar" aria-label={t('主导航', 'Main navigation')}>
      <div className="workspace-brand"><span className="brand-symbol">C</span><div>Chat to image<span>{t('你的图像工作室', 'Your image studio')}</span></div></div>
      <nav className="workspace-nav">
        {([
          ['new', t('创作', 'Create'), 'M12 5v14M5 12h14'],
          ['history', t('生成历史', 'History'), 'M3 12a9 9 0 1 0 3-6.7M3 3v5h5M12 7v5l3 2'],
          ['prompts', t('提示词库', 'Prompt library'), 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2'],
          ['favorites', t('我的收藏', 'Favorites'), 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
        ] as const).map(([key, label, path]) => <button key={key} aria-label={label} title={label} aria-current={current === key ? 'page' : undefined} onClick={() => navigate(key)}><NavIcon path={path} /><span>{label}</span>{key === 'history' && <small>{taskCount}</small>}</button>)}
      </nav>
      {current === 'new' && <div className="creation-sessions">
        <button type="button" className="conversation-new" aria-label={t('新建创作对话', 'New creative chat')} title={t('新建对话', 'New chat')} onClick={() => useStore.getState().createAgentConversation()}>＋ <span>{t('新建对话', 'New chat')}</span></button>
        <ConversationList />
        <button type="button" className="conversation-all" aria-label={t('全部创作对话', 'All creative chats')} title={t('全部对话', 'All chats')} onClick={() => useStore.getState().setAgentSidebarCollapsed(false)}>☰ <span>{t('全部对话', 'All chats')}</span></button>
      </div>}
      {current !== 'new' && <div className="sidebar-note"><span>{t('从想法，到画面。', 'From idea to image.')}</span><p>{t('先讨论，再生成。选择一张作品，继续修改。', 'Discuss, then generate. Choose an image to keep editing.')}</p></div>}
      <div className="sidebar-bottom">
        {current !== 'new' && conversationSaveError && <div role="alert" className="save-error">{conversationSaveError}<button type="button" onClick={() => void flushAgentConversationsToIndexedDB()}>{t('重试保存对话', 'Retry saving chat')}</button></div>}
        {saveError && <div role="alert" className="save-error">{saveError}<button onClick={() => void saveDesktopSettings(useStore.getState().settings).catch(() => undefined)}>{t('重试保存', 'Retry saving')}</button></div>}
        <div className="workspace-nav"><button aria-label={t('设置与 API', 'Settings & API')} title={t('设置与 API', 'Settings & API')} onClick={() => useStore.getState().setShowSettings(true)}><NavIcon path="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /><span>{t('设置与 API', 'Settings & API')}</span><small>⚙</small></button></div>
      </div>
    </aside>
  )
}
