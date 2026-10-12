import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { CloseIcon } from '../icons'
import { t } from '../../lib/i18n'

export default function ModelCatalogDialog({ ids, selected, profileName, onClose, onAdd }: {
  ids: string[]
  selected: string[]
  profileName: string
  onClose: () => void
  onAdd: (ids: string[]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(() => ids.filter((id) => !selected.includes(id)))
  const visible = ids.filter((id) => id.toLowerCase().includes(query.trim().toLowerCase()))
  const available = visible.filter((id) => !selected.includes(id))
  const allChecked = available.length > 0 && available.every((id) => pending.includes(id))
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, list)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return createPortal(<dialog ref={dialog} aria-labelledby="model-catalog-title" onCancel={(event) => { event.preventDefault(); onClose() }} className="m-auto w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-sm dark:bg-gray-900 dark:text-gray-100">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/10"><div className="min-w-0"><h2 id="model-catalog-title" className="font-semibold">{t('选择要添加的模型', 'Select models to add')}</h2><p className="mt-1 break-words text-xs leading-5 text-gray-500">{profileName} {t('· 获取到', ' · Fetched')} {ids.length} {t('个模型，已启用项会保留。', 'models. Enabled models will be kept.')}</p></div><button type="button" aria-label={t('关闭模型选择', 'Close model selection')} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"><CloseIcon className="h-5 w-5" /></button></header>
      <div className="shrink-0 space-y-3 px-5 py-4"><input type="search" aria-label={t('搜索候选模型', 'Search available models')} autoFocus placeholder={t('搜索模型名称或 ID', 'Search model name or ID')} value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-white/15" /><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-gray-500">{t('显示', 'Showing')} {visible.length} {t('个 · 待添加', ' · To add')} {pending.length} {t('个', '')}</span><button type="button" disabled={!available.length} onClick={() => setPending(allChecked ? pending.filter((id) => !available.includes(id)) : [...new Set([...pending, ...available])])} className="rounded-lg px-2 py-1.5 text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-white/5">{allChecked ? t('取消全选当前结果', 'Deselect current results') : t('全选当前结果', 'Select current results')}</button></div></div>
      <div ref={list} className="min-h-0 max-h-80 overflow-y-auto border-y border-gray-100 px-5 dark:border-white/10">
        {visible.map((id) => <label key={id} className={`flex min-h-12 items-center gap-3 border-b border-gray-100 py-3 last:border-0 dark:border-white/5 ${selected.includes(id) ? 'text-gray-400' : 'cursor-pointer'}`}><input type="checkbox" aria-label={id} disabled={selected.includes(id)} checked={selected.includes(id) || pending.includes(id)} onChange={(event) => setPending(event.target.checked ? [...pending, id] : pending.filter((item) => item !== id))} className="h-4 w-4 shrink-0 accent-blue-500" /><span className="min-w-0 flex-1 break-all text-sm">{id}</span>{selected.includes(id) && <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[11px] dark:bg-white/5">{t('已启用', 'Enabled')}</span>}</label>)}
        {!visible.length && <p className="py-10 text-center text-sm text-gray-500">{t('没有匹配模型，试试其他关键词。', 'No matching models. Try another search.')}</p>}
      </div>
      <footer className="shrink-0 px-5 py-4"><p className="mb-3 text-xs leading-5 text-gray-500">{t('这里只选择要使用的模型，具体能力以服务商说明为准。', 'Select the models you want to use. Check the provider\'s documentation for their capabilities.')}</p><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm dark:border-white/15">{t('取消', 'Cancel')}</button><button type="button" disabled={!pending.length} onClick={() => onAdd(pending)} className="min-h-10 rounded-xl bg-gray-900 px-4 text-sm text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">{t(`添加所选（${pending.length}）`, `Add selected (${pending.length})`)}</button></div></footer>
    </div>
  </dialog>, document.body)
}
