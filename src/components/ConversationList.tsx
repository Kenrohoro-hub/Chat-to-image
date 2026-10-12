import { getConversationLabel, getUiLanguage, t } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import { getAgentConversationActivity, getConversationSearchText } from '../lib/agentConversationState'
import { confirmDeleteAgentConversation, confirmDeleteAgentConversations } from '../lib/agentConversationActions'
import { CloseIcon, EditIcon, TrashIcon } from './icons'

export default function ConversationList({ onOpen, history = false }: { onOpen?: () => void; history?: boolean }) {
  const activeId = useStore((state) => state.activeAgentConversationId)
  const loaded = useStore((state) => state.agentConversationsLoaded)
  const generatingTitles = useStore((state) => state.agentGeneratingTitleIds)
  const [query, setQuery] = useState('')
  const [managing, setManaging] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const requestedEditingId = useStore((state) => state.agentEditingConversationId)
  const count = useStore((state) => state.agentConversations.length)
  const sessions = useStore(useShallow((state) => [...state.agentConversations]
    .filter((item) => !query.trim() || getConversationSearchText(item).includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((item) => JSON.stringify([item.id, item.title, Math.floor(item.updatedAt / 60000), getAgentConversationActivity(item, state.tasks), getConversationLabel(item)]))))
  const [actionsId, setActionsId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const rows = sessions.map((item) => JSON.parse(item) as [string, string, number, 'image' | 'reply' | null, string])
  const selected = selectedIds.filter((id) => rows.some((row) => row[0] === id))
  const runningCount = rows.filter((row) => row[3]).length
  const selectedRunning = rows.filter((row) => row[3] && selected.includes(row[0])).length
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row[0]))
  const toggle = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  useEffect(() => { setQuery(''); setSelectedIds([]); setEditing(null); setActionsId(null) }, [activeId])
  useEffect(() => {
    if (!history || !requestedEditingId) return
    const item = useStore.getState().agentConversations.find((entry) => entry.id === requestedEditingId)
    if (item) { setEditing({ id: item.id, title: item.title }); setManaging(false) }
  }, [history, requestedEditingId])

  return <section className="conversation-list" aria-label={t('创作对话列表', 'Creative chats')}>
    <div className="conversation-list-heading"><h2>{history ? t('全部对话', 'All chats') : t('对话', 'Chat')} <span>{count}</span></h2><button type="button" aria-pressed={managing} disabled={!count} onClick={() => { setManaging(!managing); setSelectedIds([]); setEditing(null); setActionsId(null) }}>{managing ? t('完成', 'Done') : t('多选', 'Select multiple')}</button></div>
    <div className="conversation-search">
      <input type="search" aria-label={t('搜索对话', 'Search chats')} placeholder={t('搜索标题或对话内容', 'Search titles or chat content')} value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIds([]) }} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); setSelectedIds([]) } }} />
      {query && <button type="button" aria-label={t('清除对话搜索', 'Clear chat search')} onClick={() => { setQuery(''); setSelectedIds([]) }}><CloseIcon className="h-3.5 w-3.5" /></button>}
    </div>
    {managing && <div className="conversation-selection-heading"><label><input type="checkbox" aria-label={t('全选当前搜索结果', 'Select all search results')} checked={allSelected} disabled={!rows.length} onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row[0]))} />{t('全选', 'Select all')}{query.trim() ? t('搜索结果', 'Search results') : ''}</label><span role="status">{t('已选', 'Selected')} {selected.length} {t('个', ' items')}</span></div>}
    {runningCount > 0 && <p className="conversation-running-note">{runningCount} {t('个对话运行中，删除时会保留', ' chats are running and will be kept when deleting')}</p>}
    <div className="conversation-list-scroll">
      {!rows.length && <p className="conversation-empty">{!loaded ? t('正在读取对话…', 'Loading chats…') : query.trim() ? t('没有匹配的对话', 'No matching chats') : t('还没有对话，点击上方新建', 'No chats yet. Create one above.')}</p>}
      {rows.map(([id, rawTitle, minute, activity, label]) => {
        const title = label || t('新对话', 'New chat')
        return <div key={id} className="conversation-row" data-active={activeId === id} data-selected={managing && selected.includes(id)} onKeyDown={(event) => {
          if (event.key !== 'Escape' || (!editing && !actionsId)) return
          event.stopPropagation()
          setEditing(null)
          setActionsId(null)
          const row = event.currentTarget
          requestAnimationFrame(() => row.querySelector<HTMLButtonElement>('.conversation-open')?.focus())
        }}>
          {editing?.id === id ? <form className="conversation-rename" onSubmit={(event) => {
            event.preventDefault()
            if (!editing.title.trim() || generatingTitles[id]) return
            useStore.getState().renameAgentConversation(id, editing.title.trim())
            setEditing(null)
            setActionsId(null)
            setQuery('')
            const row = event.currentTarget.parentElement
            requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>('.conversation-open')?.focus())
          }}>
            <input aria-label={t(`对话标题：${title}`, `Chat title: ${title}`)} value={editing.title} onChange={(event) => setEditing({ id, title: event.target.value })} autoFocus maxLength={200} />
            <div><button type="submit" disabled={!editing.title.trim() || generatingTitles[id]}>{t('保存', 'Save')}</button><button type="button" onClick={(event) => {
              const row = event.currentTarget.closest('.conversation-row')
              setEditing(null)
              requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>('.conversation-open')?.focus())
            }}>{t('取消', 'Cancel')}</button></div>
          </form> : <>
            <div className="conversation-row-main">
              {managing && <input className="conversation-select" type="checkbox" aria-label={t(`选择对话：${title}`, `Select chat: ${title}`)} checked={selected.includes(id)} onChange={() => toggle(id)} />}
              <button type="button" className="conversation-open" title={title} aria-label={t(`${managing ? '勾选对话' : '打开对话'}：${title}`, `${managing ? 'Select chat' : 'Open chat'}: ${title}`)} aria-pressed={managing ? selected.includes(id) : undefined} aria-current={activeId === id ? 'true' : undefined} onClick={() => {
                if (managing) { toggle(id); return }
                useStore.getState().setActiveAgentConversationId(id)
                setActionsId(null)
                onOpen?.()
              }}><span>{title}</span><small className="conversation-meta">{activity && <span className="conversation-activity" data-kind={activity}><i aria-hidden="true" />{activity === 'image' ? t('生图中', 'Generating images') : t('回复中', 'Replying')}</span>}<time dateTime={new Date(minute * 60000).toISOString()}>{new Date(minute * 60000).toLocaleString(getUiLanguage(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></small></button>
              {!managing && <button type="button" className="conversation-more" aria-label={t(`对话操作：${title}`, `Chat actions: ${title}`)} aria-expanded={actionsId === id} onClick={() => setActionsId(actionsId === id ? null : id)}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>}
            </div>
            {actionsId === id && <div className="conversation-actions">
              <button type="button" disabled={generatingTitles[id]} onClick={() => setEditing({ id, title: rawTitle || title })}><EditIcon className="h-3.5 w-3.5" />{t('改名', 'Rename')}</button>
              <button type="button" className="conversation-delete" onClick={() => confirmDeleteAgentConversation(id)}><TrashIcon className="h-3.5 w-3.5" />{t('删除', 'Delete')}</button>
              {activity && <small>{activity === 'image' ? t('正在生图', 'Generating images') : t('正在回复', 'Replying')}{t('，停止或完成后可删除', '; stop or wait for completion before deleting')}</small>}
            </div>}
          </>}
        </div>
      })}
    </div>
    {managing && <div className="conversation-batch-actions">{selectedRunning > 0 && <p>{selectedRunning} {t('个选中的对话仍在运行，本次保留。', ' selected chats are still running and will be kept.')}</p>}<button type="button" disabled={!selected.length} onClick={() => confirmDeleteAgentConversations(selected)}><TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />{t('删除所选', 'Delete selected')}{selected.length ? `（${selected.length}）` : ''}</button></div>}
  </section>
}
