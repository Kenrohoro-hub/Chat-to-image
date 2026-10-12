import { getCategoryLabel, getUiLanguage, t } from '../../lib/i18n'
import { getPromptStorageStatus, subscribePromptStorage } from '../../lib/promptStorage'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PromptTemplate } from '../../types'
import { promptExamples, promptExampleVersion, PROMPT_EXAMPLES_VERSION } from '../../lib/promptExamples'
import { useStore } from '../../store'
import { promptLibraries, getRemovedPromptSources, setRemovedPromptSources } from '../../lib/promptLibrary'
import { PROMPT_SOURCES, promptSourceName, type LibraryPrompt, type PromptSourceId } from '../../lib/promptSources'
import { takePromptImageToGallery, takePromptToGallery } from '../../lib/workspaceTransfer'
import PromptDetail from './PromptDetail'
import PromptCategoryManager from './PromptCategoryManager'
import PromptImage from './PromptImage'
import { DragHandleIcon } from '../icons'

type Source = PromptSourceId | 'personal'

export default function PromptWorkspace({ startWithDraft = false }: { startWithDraft?: boolean }) {
  const templates = useStore((state) => state.promptTemplates)
  const personalCategories = useStore((state) => state.promptCategories)
  const defaultCategory = personalCategories.includes('默认') ? '默认' : personalCategories[0]
  const storage = useSyncExternalStore(subscribePromptStorage, getPromptStorageStatus)
  const prompt = useStore((state) => state.prompt)
  const [removed, setRemoved] = useState(getRemovedPromptSources)
  const sites = PROMPT_SOURCES.filter((entry) => !removed.includes(entry.id))
  const [source, setSource] = useState<Source>(startWithDraft ? 'personal' : sites[0]?.id ?? 'personal')
  const [items, setItems] = useState<LibraryPrompt[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [managingCategories, setManagingCategories] = useState(false)
  const [draggedCategory, setDraggedCategory] = useState('')
  const [dropTarget, setDropTarget] = useState<{ name: string; after: boolean } | null>(null)
  const [sorting, setSorting] = useState(false)
  const [page, setPage] = useState(0)
  const site = PROMPT_SOURCES.find((item) => item.id === source) ?? PROMPT_SOURCES[0]
  const library = promptLibraries[site.id]
  const cacheStatus = useSyncExternalStore(library.subscribe, library.getStatus)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PromptTemplate | null>(startWithDraft ? { id: '', title: '', content: prompt, category: defaultCategory, createdAt: 0, updatedAt: 0 } : null)
  const [deleted, setDeleted] = useState<PromptTemplate | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      const version = Number(localStorage.getItem('prompt-examples-version')) || 0
      if (version >= PROMPT_EXAMPLES_VERSION) return
      const state = useStore.getState()
      void state.setPromptTemplates((current) => [...current, ...promptExamples.filter((example) => promptExampleVersion(example) > version && !current.some((item) => item.id === example.id))]).then((saved) => { if (saved) { localStorage.setItem('prompt-examples-added-v1', '1'); localStorage.setItem('prompt-examples-version', String(PROMPT_EXAMPLES_VERSION)) } }).catch((err) => console.warn('Prompt examples could not be saved', err))
    } catch (err) {
      console.warn('Prompt examples could not be saved', err)
      useStore.getState().showToast(t('示例保存失败，请检查本地存储空间。', 'Failed to save samples. Check local storage space.'), 'error')
    }
  }, [])
  useEffect(() => {
    if (source === 'personal') return
    let active = true
    setLoading(true)
    setError('')
    library.load().then((data) => { if (active) setItems(data) }).catch((err) => {
      console.warn('Prompt library load failed', err)
      if (active) setError(err instanceof Error ? err.message : t(`暂时无法连接 ${site.name}，请检查网络后重试。`, `Cannot connect to ${site.name}. Check your network and retry.`))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [source, library, site.name, storage.directory])
  useEffect(() => { grid.current?.scrollTo?.({ top: 0 }) }, [source, category, query, page])
  const categories = new Map<string, number>(source === 'personal' ? personalCategories.map((name) => [name, 0]) : [])
  for (const item of source === 'personal' ? templates : items) {
    const names = source === 'personal' ? [item.category || defaultCategory] : item.categories ?? [item.category!]
    for (const name of names) categories.set(name, (categories.get(name) ?? 0) + 1)
  }
  const categoryEntries = source === 'personal' ? [...categories] : [...categories].sort(([a], [b]) => a.localeCompare(b, getUiLanguage()))
  const pool = source !== 'personal' ? items.filter((item) => !category || (item.categories ?? [item.category]).includes(category)) : templates.filter((item) => !category || (item.category || defaultCategory) === category)
  const keyword = query.trim().toLowerCase()
  const filtered = pool.filter((item) => `${item.title}\n${item.content}`.toLowerCase().includes(keyword))
  const pages = Math.max(1, Math.ceil(filtered.length / 24))
  const currentPage = Math.min(page, pages - 1)
  const isSaved = (item: PromptTemplate) => templates.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content)
  const reorderCategory = async (from: string, to: string, after: boolean) => {
    if (sorting || storage.busy || from === to) return
    setSorting(true)
    try {
      await useStore.getState().setPromptTemplates((current) => current, (current) => {
        if (!current.includes(from) || !current.includes(to)) return current
        const next = current.filter((name) => name !== from)
        next.splice(next.indexOf(to) + Number(after), 0, from)
        return next
      })
    } finally { setSorting(false) }
  }
  const collect = async (item: PromptTemplate) => {
    const state = useStore.getState()
    if (state.promptTemplates.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content)) return
    const now = Date.now()
    const saved = await state.setPromptTemplates((current) => current.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content) ? current : [{ id: crypto.randomUUID(), title: item.title, content: item.content, category: defaultCategory, categories: item.categories, sourcePromptId: item.sourcePromptId, sourceUrl: item.sourceUrl, previewUrl: item.previewUrl, createdAt: now, updatedAt: now }, ...current])
    if (!saved) return
    state.showToast(t('已收藏到个人提示词', 'Saved to personal prompts'), 'success')
  }
  const refresh = async () => {
    setError('')
    try { const data = await library.load(true); if (sourceRef.current === source) { setItems(data); if (category && !data.some((item) => (item.categories ?? [item.category]).includes(category))) setCategory('') } }
    catch (err) { if (sourceRef.current === source) setError(err instanceof Error ? err.message : t('刷新失败，原缓存已保留。', 'Refresh failed. The existing cache was kept.')) }
  }
  const preload = () => {
    const run = () => { void library.preload(category).catch((err) => useStore.getState().showToast(err instanceof Error ? err.message : t('预载失败，请重试。', 'Preload failed. Please retry.'), 'error')) }
    if (category) { run(); return }
    useStore.getState().setConfirmDialog({ title: t(`预载 ${site.name} 全部分类？`, `Preload all categories from ${site.name}?`), message: t(`将预载全部 ${items.length} 条提示词的预览图，可能消耗较多流量和存储空间。已保存的图片会跳过，过程中可以取消。搜索关键词不会缩小预载范围。`, `Preview images for all ${items.length} prompts will be preloaded. This may use substantial bandwidth and storage. Saved images are skipped, and you can cancel. Search terms do not limit the preload scope.`), confirmText: t('开始预载全部', 'Preload all'), action: run })
  }
  const clearCache = () => useStore.getState().setConfirmDialog({
    title: t(`清除 ${site.name} 预载数据？`, `Clear preloaded data from ${site.name}?`), message: t(`将清除 ${site.name} 在当前入口保存的全部目录、正文和预览图，包括其他分类。个人提示词及收藏正文保留；${storage.directory ? '收藏中已经预载的图片也会保留。' : '其预览图将恢复联网加载。'}清除后需点击刷新重新载入。`, `All ${site.name} catalogs, text, and preview images saved for this entry will be cleared, including other categories. Personal prompts and favorite text are kept. ${storage.directory ? 'Preloaded images in favorites will also be kept.' : 'Their previews will load online again.'} Click Refresh to reload afterward.`), tone: 'danger', confirmText: t('确认清除', 'Confirm clear'), awaitAction: true,
    action: async () => {
      try {
        await library.clear()
        if (sourceRef.current !== source) return
        setItems([])
        setCategory('')
        setQuery('')
        setPage(0)
        setError('')
      } catch (err) { useStore.getState().showToast(err instanceof Error ? err.message : t('清除失败，请重试。', 'Failed to clear. Please retry.'), 'error'); return false }
    },
  })
  const removeLibrary = () => useStore.getState().setConfirmDialog({
    title: t(`删除 ${site.name} 提示词库？`, `Delete the ${site.name} prompt library?`), message: t('将移除这个网站入口，并清除它的全部目录、正文和预载图片。个人收藏及其他网站库保留。以后可以恢复入口，数据需重新刷新。', 'This website entry and all its catalogs, text, and preloaded images will be removed. Personal favorites and other libraries are kept. The entry can be restored later, but its data must be refreshed.'), tone: 'danger', confirmText: t('删除提示词库', 'Delete prompt library'), awaitAction: true,
    action: async () => {
      try {
        await library.clear()
        const next = [...removed, site.id]
        await setRemovedPromptSources(next)
        setRemoved(next)
        if (sourceRef.current === site.id) { setSource('personal'); setItems([]); setCategory(''); setQuery(''); setPage(0) }
        useStore.getState().showToast(t(`${site.name} 已删除，个人收藏保留。`, `${site.name} deleted. Personal favorites kept.`), 'success')
      } catch (err) { useStore.getState().showToast(err instanceof Error ? err.message : t('删除失败，请重试。', 'Failed to delete. Please retry.'), 'error'); return false }
    },
  })
  return <main className="prompt-workspace" aria-label={t('提示词库工作区', 'Prompt library workspace')}>
    <header className="prompt-workspace-heading"><div><span>{t('挑选灵感，带回创作', 'Find inspiration for your next creation')}</span><h1>{t('提示词库', 'Prompt library')}</h1></div><div className="prompt-heading-actions"><button type="button" disabled={!prompt.trim()} onClick={() => { setSource('personal'); if (source !== 'personal') setCategory(''); setSelected({ id: '', title: '', content: prompt, category: source === 'personal' && category ? category : defaultCategory, createdAt: 0, updatedAt: 0 }) }}>{t('保存当前草稿', 'Save current draft')}</button><button type="button" className="prompt-primary" onClick={() => { setSource('personal'); if (source !== 'personal') setCategory(''); setSelected({ id: '', title: '', content: '', category: source === 'personal' && category ? category : defaultCategory, createdAt: 0, updatedAt: 0 }) }}>{t('＋ 新建提示词', '＋ New prompt')}</button></div></header>
    <nav className="prompt-sources" aria-label={t('提示词库来源', 'Prompt library sources')}>
      <div className="prompt-source-heading"><span>{t('选择提示词库', 'Choose a prompt library')}<span className="prompt-source-hint">{t('横向滑动切换', 'Swipe horizontally to switch')}</span></span>{removed.length > 0 && <details className="prompt-removed-sources"><summary>{t('已删除的库（', 'Removed libraries (')}{removed.length}）</summary>{PROMPT_SOURCES.filter((entry) => removed.includes(entry.id)).map((entry) => <button type="button" key={entry.id} aria-label={t(`恢复 ${entry.name} 提示词库`, `Restore the ${entry.name} prompt library`)} onClick={async () => { try { const next = removed.filter((id) => id !== entry.id); await setRemovedPromptSources(next); setRemoved(next); setSource(entry.id); setItems([]); setCategory(''); setQuery(''); setPage(0) } catch { useStore.getState().showToast(t('恢复失败，请检查本地存储空间。', 'Failed to restore. Check local storage space.'), 'error') } }}><span>{entry.name}</span><small>{t('恢复', 'Restore')}</small></button>)}</details>}</div>
      <div className="prompt-source-row">
        <div className="prompt-local-sources">{([['personal', t('个人提示词', 'Personal prompts'), templates.length]] as const).map(([key, label, count]) => <button type="button" key={key} aria-label={label} aria-pressed={source === key} onClick={() => { setSource(key); setCategory(''); setQuery(''); setPage(0) }}><span>{label}</span><small>{count}</small></button>)}</div>
        <div className="prompt-source-divider" role="separator" aria-label={t('网络提示词库', 'Online prompt libraries')}><span>{t('网络提示词库', 'Online prompt libraries')}</span></div>
        <div className="prompt-network-sources">{sites.map((entry) => <button type="button" key={entry.id} className="prompt-site-button" aria-label={entry.name} aria-pressed={source === entry.id} onClick={() => { if (source === entry.id) return; setSource(entry.id); setItems([]); setCategory(''); setQuery(''); setPage(0) }}><span className="prompt-site-mark" aria-hidden="true">{entry.mark}</span><span className="prompt-site-name">{entry.name}<small>{entry.description}</small></span><small className="prompt-source-count">{promptLibraries[entry.id].getStatus().itemCount || ''}</small></button>)}</div>
      </div>
    </nav>
    <div className="prompt-workspace-body" data-personal={source === 'personal'}>
      <aside className="prompt-categories" aria-label={t('提示词分类', 'Prompt category')} data-expanded={categoriesOpen}>
        <p>{source === 'youmind' ? t('参考图需求', 'Reference image requirements') : t('主题分类', 'Category')}<span>{categories.size}</span></p>
        <button type="button" className="prompt-category-toggle" aria-expanded={categoriesOpen} aria-controls="prompt-category-options" onClick={() => setCategoriesOpen(!categoriesOpen)}><span>{category ? getCategoryLabel(category) : t('全部分类', 'All categories')}</span><span>{categoriesOpen ? t('收起分类 −', 'Collapse categories −') : t('选择分类 ＋', 'Choose category ＋')}</span></button>
        {source === 'personal' && <button type="button" className="prompt-manage-categories" aria-expanded={managingCategories} onClick={() => setManagingCategories(!managingCategories)}>{managingCategories ? t('收起管理', 'Close management') : t('管理分类', 'Manage categories')}</button>}
        {source === 'personal' && managingCategories && <PromptCategoryManager onChange={(from, to) => { if (category === from && from) setCategory(to); setPage(0) }} />}
        {source === 'personal' && <p className="prompt-category-sort-hint">{sorting ? t('正在保存顺序…', 'Saving order…') : t('拖动分类调整顺序', 'Drag categories to reorder')}</p>}
        <div className="prompt-category-list" id="prompt-category-options" aria-busy={sorting}>
          <button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setPage(0); setCategoriesOpen(false) }}><span>{t('全部分类', 'All categories')}</span><small>{source === 'personal' ? templates.length : items.length}</small></button>
          {categoryEntries.map(([name, count], index) => <button type="button" key={name} aria-pressed={category === name}
            draggable={source === 'personal' && !sorting && !storage.busy}
            title={source === 'personal' ? t('拖动排序，或按 Alt + ↑ / ↓ 调整', 'Drag to reorder, or press Alt + ↑ / ↓') : undefined}
            data-dragging={draggedCategory === name || undefined}
            data-drop={dropTarget && dropTarget.name === name ? dropTarget.after ? 'after' : 'before' : undefined}
            onDragStart={(event) => {
              if (source !== 'personal' || sorting || storage.busy) { event.preventDefault(); return }
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', name)
              setDraggedCategory(name)
            }}
            onDragOver={(event) => {
              if (source !== 'personal' || !draggedCategory || draggedCategory === name) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const rect = event.currentTarget.getBoundingClientRect()
              setDropTarget({ name, after: event.clientY >= rect.top + rect.height / 2 })
            }}
            onDragLeave={() => setDropTarget((current) => current?.name === name ? null : current)}
            onDragEnd={() => { setDraggedCategory(''); setDropTarget(null) }}
            onDrop={(event) => {
              if (source !== 'personal' || !draggedCategory) return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              void reorderCategory(draggedCategory, name, event.clientY >= rect.top + rect.height / 2)
              setDraggedCategory('')
              setDropTarget(null)
            }}
            onKeyDown={(event) => {
              if (source !== 'personal' || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault()
              const after = event.key === 'ArrowDown'
              const target = categoryEntries[index + (after ? 1 : -1)]
              if (target) void reorderCategory(name, target[0], after)
            }}
            onClick={() => { setCategory(name); setPage(0); setCategoriesOpen(false) }}
          ><span className="prompt-category-name">{source === 'personal' && <DragHandleIcon aria-hidden="true" />}{getCategoryLabel(name)}</span><small>{count}</small></button>)}
        </div>
      </aside>
      <section className="prompt-catalog" aria-label={t('提示词列表', 'Prompt list')}>
        <div className="prompt-catalog-toolbar">
          <div className="prompt-catalog-controls">
            <div className="prompt-catalog-info">
              <div className="prompt-catalog-title"><h2>{source !== 'personal' ? site.name : t('个人提示词', 'Personal prompts')}</h2>{category && <span className="prompt-category-tag">{getCategoryLabel(category)}</span>}<span role="status">{source !== 'personal' && loading ? t('正在加载…', 'Loading…') : t(`${filtered.length} 条提示词`, `${filtered.length} prompts`)}</span></div>
              {source !== 'personal' && <a className="prompt-site-home" href={site.home} target="_blank" rel="noopener noreferrer" aria-label={t(`${site.name} 官网首页：${site.home}`, `${site.name} website: ${site.home}`)} title={site.home}>{t('官网首页 ↗', 'Website ↗')}</a>}
            </div>
            <input type="search" aria-label={t('搜索提示词', 'Search prompts')} placeholder={t('搜索名称或提示词正文…', 'Search names or prompt content…')} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
            {source !== 'personal' && <div className="prompt-cache-actions">
              <div><button type="button" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={() => void refresh()}>{t('刷新', 'Refresh')}</button><button type="button" className="prompt-preload-button" disabled={storage.busy || !!cacheStatus.busy || loading || !items.length} onClick={preload}>{category ? t('预载当前分类', 'Preload current category') : t('预载全部', 'Preload all')}</button></div>
              <div className="prompt-cache-maintenance"><button type="button" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={clearCache}>{t('清除预载数据', 'Clear preloaded data')}</button><button type="button" className="prompt-delete-library" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={removeLibrary}>{t('删除提示词库', 'Delete prompt library')}</button></div>
            </div>}
          </div>
          {source !== 'personal' && <div className="prompt-cache-panel">
            <div className="prompt-cache-meta"><span>{cacheStatus.updatedAt ? t(`目录更新于 ${new Date(cacheStatus.updatedAt).toLocaleString('zh-CN')}`, `Catalog updated ${new Date(cacheStatus.updatedAt).toLocaleString(getUiLanguage())}`) : t('目录与正文自动保存在本地', 'Catalog and prompt text are saved locally')}</span><span>{t('全库已预载', 'Library preloaded')} {cacheStatus.imageCount} {t('张图片', ' images')}</span><span>{t('预载范围：', 'Preload scope:')}{category ? getCategoryLabel(category) : t('全部分类', 'All categories')}</span></div>
            {cacheStatus.busy === 'preloading' && <div className="prompt-cache-progress"><label>{t('正在预载 ·', 'Preloading ·')} {getCategoryLabel(cacheStatus.scope)}<progress aria-label={t('图片预载进度', 'Image preload progress')} max={cacheStatus.total || 1} value={cacheStatus.done} /></label><span>{cacheStatus.done} / {cacheStatus.total}{cacheStatus.failed > 0 ? t(` · ${cacheStatus.failed} 张失败`, ` · ${cacheStatus.failed} failed`) : ''}</span><button type="button" onClick={library.cancel}>{t('取消预载', 'Cancel preload')}</button></div>}
            <p role="status">{cacheStatus.busy === 'loading' ? cacheStatus.message || t('正在读取目录…', 'Loading catalog…') : cacheStatus.message || t('包含正文和图片，重复预载会跳过已有图片。', 'Includes text and images. Existing images are skipped when preloading again.')}</p>
          </div>}
        </div>
        {error && source !== 'personal' && <div className="prompt-cache-error" role="alert"><span>{error}</span><button type="button" disabled={!!cacheStatus.busy} onClick={() => void refresh()}>{t('重新加载', 'Reload')}</button></div>}
        {deleted && <div className="prompt-undo" role="status">{t('已删除“', 'Deleted “')}{deleted.title}”<button type="button" onClick={async () => { const state = useStore.getState(); if (await state.setPromptTemplates((current) => current.some((item) => item.id === deleted.id) ? current : [{ ...deleted, category: state.promptCategories.includes(deleted.category || '') ? deleted.category : state.promptCategories[0] }, ...current])) setDeleted(null) }}>{t('撤销删除', 'Undo deletion')}</button></div>}
        <div className="prompt-grid-scroll" ref={grid}>
          {source !== 'personal' && loading ? <p className="prompt-empty" role="status">{t('正在加载', 'Loading')} {site.name}…</p> : !filtered.length ? <div className="prompt-empty"><h3>{source === 'personal' && !query ? category ? t('这个分类还没有提示词', 'No prompts in this category yet') : t('还没有个人提示词', 'No personal prompts yet') : source !== 'personal' && cacheStatus.cleared ? t('本地缓存已清除', 'Local cache cleared') : t('没有匹配的提示词', 'No matching prompts')}</h3><p>{source === 'personal' && !query ? t('从网络提示词库收藏喜欢的内容，或新建一条自己的提示词。', 'Favorite content from an online prompt library, or create your own prompt.') : source !== 'personal' && cacheStatus.cleared ? t(`点击刷新，重新载入 ${site.name} 的提示词目录。`, `Click Refresh to reload the ${site.name} prompt catalog.`) : t('试试其他关键词或分类。', 'Try another keyword or category.')}</p></div> : <div className="prompt-card-grid">{filtered.slice(currentPage * 24, (currentPage + 1) * 24).map((item) => <article className="prompt-card" key={item.id}>
            <button type="button" className="prompt-card-open" aria-label={t(`查看提示词：${item.title}`, `View prompt: ${item.title}`)} onClick={() => setSelected(item)}>
              <div className="prompt-card-preview">{item.previewUrl ? <><span className="prompt-card-image-fallback">{t('正在加载预览…', 'Loading preview…')}</span><PromptImage src={item.previewUrl} alt={item.title} loading="lazy" onLoad={(event) => { event.currentTarget.hidden = false }} referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const label = event.currentTarget.previousElementSibling; if (label) label.textContent = t('预览暂不可用', 'Preview unavailable') }} /></> : <div className="prompt-card-excerpt"><span aria-hidden="true">Aa</span><p>{item.content}</p></div>}<span className="prompt-card-preview-label">{t('查看详情 ↗', 'View details ↗')}</span></div>
              <div className="prompt-card-title"><h3>{item.title}</h3><span>{item.category ? getCategoryLabel(item.category) : item.sourceUrl ? t(`来自 ${promptSourceName(item)}`, `From ${promptSourceName(item)}`) : promptExamples.some((example) => example.id === item.id) ? t('展示示例 · 可编辑或删除', 'Sample · Can be edited or deleted') : t('文字提示词', 'Text prompt')}</span></div>
            </button>
            <div className="prompt-card-actions"><button type="button" onClick={() => takePromptToGallery(item.content)}>{t('引用提示词', 'Use prompt')}</button>{source === 'personal' ? <button type="button" onClick={() => setSelected(item)}>{t('查看 / 编辑', 'View / Edit')}</button> : <button type="button" disabled={isSaved(item)} onClick={() => collect(item)}>{isSaved(item) ? t('已收藏', 'Favorited') : t('收藏', 'Favorite')}</button>}</div>
          </article>)}</div>}
        </div>
        <div className="prompt-pagination"><span>{t(`第 ${currentPage + 1} / ${pages} 页`, `Page ${currentPage + 1} / ${pages}`)}</span><div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('上一页', 'Previous')}</button><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t('下一页', 'Next')}</button></div></div>
      </section>
    </div>
    {selected && <PromptDetail key={selected.id} item={selected} categories={personalCategories} personal={source === 'personal'} saved={isSaved(selected)} onClose={() => setSelected(null)} onUse={() => { if (takePromptToGallery(selected.content)) setSelected(null) }} onUseImage={async (includePrompt) => { if (await takePromptImageToGallery(selected, includePrompt)) setSelected(null) }} onCollect={() => collect(selected)} onSave={async (title, content, promptCategory) => {
      const state = useStore.getState()
      const now = Date.now()
      const item = { ...selected, id: selected.id || crypto.randomUUID(), title, content, category: promptCategory, createdAt: selected.createdAt || now, updatedAt: now }
      if (!await state.setPromptTemplates((current) => selected.id ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current])) return false
      setSelected((current) => current?.id === selected.id ? item : current)
      setQuery('')
      if (category) setCategory(promptCategory)
      setPage(0)
      state.showToast(t('提示词已保存', 'Prompt saved'), 'success')
      return true
    }} onDelete={async () => { const state = useStore.getState(); if (await state.setPromptTemplates((current) => current.filter((item) => item.id !== selected.id))) { setDeleted(selected); setSelected(null) } }} />}
  </main>
}
