import { getPromptStorageStatus, subscribePromptStorage } from '../../lib/promptStorage'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PromptTemplate } from '../../types'
import { useStore } from '../../store'
import { promptLibraries, getRemovedPromptSources, setRemovedPromptSources } from '../../lib/promptLibrary'
import { PROMPT_SOURCES, promptSourceName, type LibraryPrompt, type PromptSourceId } from '../../lib/promptSources'
import { takePromptToGallery } from '../../lib/workspaceTransfer'
import PromptDetail from './PromptDetail'
import PromptImage from './PromptImage'

type Source = PromptSourceId | 'personal'
const examples: PromptTemplate[] = [
  { id: 'example-product', title: '产品摄影', content: '为一只白色陶瓷咖啡杯拍摄极简产品照片，暖白背景，柔和侧光，细腻釉面，留出充足留白。', createdAt: 0, updatedAt: 0 },
  { id: 'example-illustration', title: '创意插画', content: '画一幅温暖的纸艺插画：一艘小船漂浮在云海中，橘色落日，层叠纸张质感，简洁而富有想象力。', createdAt: 0, updatedAt: 0 },
  { id: 'example-scene', title: '场景设计', content: '设计一间雨天的街角书店，落地窗透出温暖灯光，窗外湿润路面，电影感构图，安静的蓝调时刻。', createdAt: 0, updatedAt: 0 },
]

export default function PromptWorkspace({ startWithDraft = false }: { startWithDraft?: boolean }) {
  const templates = useStore((state) => state.promptTemplates)
  const storage = useSyncExternalStore(subscribePromptStorage, getPromptStorageStatus)
  const prompt = useStore((state) => state.prompt)
  const [removed, setRemoved] = useState(getRemovedPromptSources)
  const sites = PROMPT_SOURCES.filter((entry) => !removed.includes(entry.id))
  const [source, setSource] = useState<Source>(startWithDraft ? 'personal' : sites[0]?.id ?? 'personal')
  const [items, setItems] = useState<LibraryPrompt[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [page, setPage] = useState(0)
  const site = PROMPT_SOURCES.find((item) => item.id === source) ?? PROMPT_SOURCES[0]
  const library = promptLibraries[site.id]
  const cacheStatus = useSyncExternalStore(library.subscribe, library.getStatus)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PromptTemplate | null>(startWithDraft ? { id: '', title: '', content: prompt, createdAt: 0, updatedAt: 0 } : null)
  const [deleted, setDeleted] = useState<PromptTemplate | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try {
      if (localStorage.getItem('prompt-examples-added-v1')) return
      const state = useStore.getState()
      void state.setPromptTemplates((current) => [...current, ...examples.filter((example) => !current.some((item) => item.id === example.id))]).then((saved) => { if (saved) localStorage.setItem('prompt-examples-added-v1', '1') }).catch((err) => console.warn('Prompt examples could not be saved', err))
    } catch (err) {
      console.warn('Prompt examples could not be saved', err)
      useStore.getState().showToast('示例保存失败，请检查本地存储空间。', 'error')
    }
  }, [])
  useEffect(() => {
    if (source === 'personal') return
    let active = true
    setLoading(true)
    setError('')
    library.load().then((data) => { if (active) setItems(data) }).catch((err) => {
      console.warn('Prompt library load failed', err)
      if (active) setError(err instanceof Error ? err.message : `暂时无法连接 ${site.name}，请检查网络后重试。`)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [source, library, site.name, storage.directory])
  useEffect(() => { grid.current?.scrollTo?.({ top: 0 }) }, [source, category, query, page])
  const categories = new Map<string, number>()
  for (const item of items) for (const name of item.categories ?? [item.category]) categories.set(name, (categories.get(name) ?? 0) + 1)
  const pool = source !== 'personal' ? items.filter((item) => !category || (item.categories ?? [item.category]).includes(category)) : templates
  const keyword = query.trim().toLowerCase()
  const filtered = pool.filter((item) => `${item.title}\n${item.content}`.toLowerCase().includes(keyword))
  const pages = Math.max(1, Math.ceil(filtered.length / 24))
  const currentPage = Math.min(page, pages - 1)
  const isSaved = (item: PromptTemplate) => templates.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content)
  const collect = async (item: PromptTemplate) => {
    const state = useStore.getState()
    if (state.promptTemplates.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content)) return
    const now = Date.now()
    const saved = await state.setPromptTemplates((current) => current.some((entry) => item.sourcePromptId && entry.sourcePromptId ? item.sourcePromptId === entry.sourcePromptId : item.sourceUrl ? entry.sourceUrl === item.sourceUrl : entry.title === item.title && entry.content === item.content) ? current : [{ id: crypto.randomUUID(), title: item.title, content: item.content, category: item.category, categories: item.categories, sourcePromptId: item.sourcePromptId, sourceUrl: item.sourceUrl, previewUrl: item.previewUrl, createdAt: now, updatedAt: now }, ...current])
    if (!saved) return
    state.showToast('已收藏到个人提示词', 'success')
  }
  const refresh = async () => {
    setError('')
    try { const data = await library.load(true); if (sourceRef.current === source) { setItems(data); if (category && !data.some((item) => (item.categories ?? [item.category]).includes(category))) setCategory('') } }
    catch (err) { if (sourceRef.current === source) setError(err instanceof Error ? err.message : '刷新失败，原缓存已保留。') }
  }
  const preload = () => {
    const run = () => { void library.preload(category).catch((err) => useStore.getState().showToast(err instanceof Error ? err.message : '预载失败，请重试。', 'error')) }
    if (category) { run(); return }
    useStore.getState().setConfirmDialog({ title: `预载 ${site.name} 全部分类？`, message: `将预载全部 ${items.length} 条提示词的预览图，可能消耗较多流量和存储空间。已保存的图片会跳过，过程中可以取消。搜索关键词不会缩小预载范围。`, confirmText: '开始预载全部', action: run })
  }
  const clearCache = () => useStore.getState().setConfirmDialog({
    title: `清除 ${site.name} 预载数据？`, message: `将清除 ${site.name} 在当前入口保存的全部目录、正文和预览图，包括其他分类。个人提示词及收藏正文保留；${storage.directory ? '收藏中已经预载的图片也会保留。' : '其预览图将恢复联网加载。'}清除后需点击刷新重新载入。`, tone: 'danger', confirmText: '确认清除', awaitAction: true,
    action: async () => {
      try {
        await library.clear()
        if (sourceRef.current !== source) return
        setItems([])
        setCategory('')
        setQuery('')
        setPage(0)
        setError('')
      } catch (err) { useStore.getState().showToast(err instanceof Error ? err.message : '清除失败，请重试。', 'error'); return false }
    },
  })
  const removeLibrary = () => useStore.getState().setConfirmDialog({
    title: `删除 ${site.name} 提示词库？`, message: `将移除这个网站入口，并清除它的全部目录、正文和预载图片。个人收藏及其他网站库保留。以后可以恢复入口，数据需重新刷新。`, tone: 'danger', confirmText: '删除提示词库', awaitAction: true,
    action: async () => {
      try {
        await library.clear()
        const next = [...removed, site.id]
        await setRemovedPromptSources(next)
        setRemoved(next)
        if (sourceRef.current === site.id) { setSource('personal'); setItems([]); setCategory(''); setQuery(''); setPage(0) }
        useStore.getState().showToast(`${site.name} 已删除，个人收藏保留。`, 'success')
      } catch (err) { useStore.getState().showToast(err instanceof Error ? err.message : '删除失败，请重试。', 'error'); return false }
    },
  })
  return <main className="prompt-workspace" aria-label="提示词库工作区">
    <header className="prompt-workspace-heading"><div><span>挑选灵感，带回创作</span><h1>提示词库</h1></div><div className="prompt-heading-actions"><button type="button" disabled={!prompt.trim()} onClick={() => { setSource('personal'); setSelected({ id: '', title: '', content: prompt, createdAt: 0, updatedAt: 0 }) }}>保存当前草稿</button><button type="button" className="prompt-primary" onClick={() => { setSource('personal'); setSelected({ id: '', title: '', content: '', createdAt: 0, updatedAt: 0 }) }}>＋ 新建提示词</button></div></header>
    <nav className="prompt-sources" aria-label="提示词库来源">
      <div className="prompt-source-heading"><span>选择提示词库<span className="prompt-source-hint">横向滑动切换</span></span>{removed.length > 0 && <details className="prompt-removed-sources"><summary>已删除的库（{removed.length}）</summary>{PROMPT_SOURCES.filter((entry) => removed.includes(entry.id)).map((entry) => <button type="button" key={entry.id} aria-label={`恢复 ${entry.name} 提示词库`} onClick={async () => { try { const next = removed.filter((id) => id !== entry.id); await setRemovedPromptSources(next); setRemoved(next); setSource(entry.id); setItems([]); setCategory(''); setQuery(''); setPage(0) } catch { useStore.getState().showToast('恢复失败，请检查本地存储空间。', 'error') } }}><span>{entry.name}</span><small>恢复</small></button>)}</details>}</div>
      <div className="prompt-source-row">
        <div className="prompt-local-sources">{([['personal', '个人提示词', templates.length]] as const).map(([key, label, count]) => <button type="button" key={key} aria-label={label} aria-pressed={source === key} onClick={() => { setSource(key); setCategory(''); setQuery(''); setPage(0) }}><span>{label}</span><small>{count}</small></button>)}</div>
        <div className="prompt-source-divider" role="separator" aria-label="网络提示词库"><span>网络提示词库</span></div>
        <div className="prompt-network-sources">{sites.map((entry) => <button type="button" key={entry.id} className="prompt-site-button" aria-label={entry.name} aria-pressed={source === entry.id} onClick={() => { if (source === entry.id) return; setSource(entry.id); setItems([]); setCategory(''); setQuery(''); setPage(0) }}><span className="prompt-site-mark" aria-hidden="true">{entry.mark}</span><span className="prompt-site-name">{entry.name}<small>{entry.description}</small></span><small className="prompt-source-count">{promptLibraries[entry.id].getStatus().itemCount || ''}</small></button>)}</div>
      </div>
    </nav>
    <div className="prompt-workspace-body" data-personal={source === 'personal'}>
      {source !== 'personal' && <aside className="prompt-categories" aria-label="提示词分类" data-expanded={categoriesOpen}>
        <p>{source === 'youmind' ? '参考图需求' : '主题分类'}<span>{categories.size}</span></p>
        <button type="button" className="prompt-category-toggle" aria-expanded={categoriesOpen} aria-controls="prompt-category-options" onClick={() => setCategoriesOpen(!categoriesOpen)}><span>{category || '全部分类'}</span><span>{categoriesOpen ? '收起分类 −' : '选择分类 ＋'}</span></button>
        <div className="prompt-category-list" id="prompt-category-options"><button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setPage(0); setCategoriesOpen(false) }}><span>全部分类</span><small>{items.length}</small></button>{[...categories].sort(([a], [b]) => a.localeCompare(b, 'zh-CN')).map(([name, count]) => <button type="button" key={name} aria-pressed={category === name} onClick={() => { setCategory(name); setPage(0); setCategoriesOpen(false) }}><span>{name}</span><small>{count}</small></button>)}</div>
      </aside>}
      <section className="prompt-catalog" aria-label="提示词列表">
        <div className="prompt-catalog-toolbar">
          <div className="prompt-catalog-controls">
            <div className="prompt-catalog-info">
              <div className="prompt-catalog-title"><h2>{source !== 'personal' ? site.name : '个人提示词'}</h2>{source !== 'personal' && category && <span className="prompt-category-tag">{category}</span>}<span role="status">{source !== 'personal' && loading ? '正在加载…' : `${filtered.length} 条提示词`}</span></div>
              {source !== 'personal' && <a className="prompt-site-home" href={site.home} target="_blank" rel="noopener noreferrer" aria-label={`${site.name} 官网首页：${site.home}`} title={site.home}>官网首页 ↗</a>}
            </div>
            <input type="search" aria-label="搜索提示词" placeholder="搜索名称或提示词正文…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
            {source !== 'personal' && <div className="prompt-cache-actions">
              <div><button type="button" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={() => void refresh()}>刷新</button><button type="button" className="prompt-preload-button" disabled={storage.busy || !!cacheStatus.busy || loading || !items.length} onClick={preload}>{category ? '预载当前分类' : '预载全部'}</button></div>
              <div className="prompt-cache-maintenance"><button type="button" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={clearCache}>清除预载数据</button><button type="button" className="prompt-delete-library" disabled={storage.busy || !!cacheStatus.busy || loading} onClick={removeLibrary}>删除提示词库</button></div>
            </div>}
          </div>
          {source !== 'personal' && <div className="prompt-cache-panel">
            <div className="prompt-cache-meta"><span>{cacheStatus.updatedAt ? `目录更新于 ${new Date(cacheStatus.updatedAt).toLocaleString('zh-CN')}` : '目录与正文自动保存在本地'}</span><span>全库已预载 {cacheStatus.imageCount} 张图片</span><span>预载范围：{category || '全部分类'}</span></div>
            {cacheStatus.busy === 'preloading' && <div className="prompt-cache-progress"><label>正在预载 · {cacheStatus.scope}<progress aria-label="图片预载进度" max={cacheStatus.total || 1} value={cacheStatus.done} /></label><span>{cacheStatus.done} / {cacheStatus.total}{cacheStatus.failed > 0 ? ` · ${cacheStatus.failed} 张失败` : ''}</span><button type="button" onClick={library.cancel}>取消预载</button></div>}
            <p role="status">{cacheStatus.busy === 'loading' ? cacheStatus.message || '正在读取目录…' : cacheStatus.message || '包含正文和图片，重复预载会跳过已有图片。'}</p>
          </div>}
        </div>
        {error && source !== 'personal' && <div className="prompt-cache-error" role="alert"><span>{error}</span><button type="button" disabled={!!cacheStatus.busy} onClick={() => void refresh()}>重新加载</button></div>}
        {deleted && <div className="prompt-undo" role="status">已删除“{deleted.title}”<button type="button" onClick={async () => { const state = useStore.getState(); if (await state.setPromptTemplates((current) => current.some((item) => item.id === deleted.id) ? current : [deleted, ...current])) setDeleted(null) }}>撤销删除</button></div>}
        <div className="prompt-grid-scroll" ref={grid}>
          {source !== 'personal' && loading ? <p className="prompt-empty" role="status">正在加载 {site.name}…</p> : !filtered.length ? <div className="prompt-empty"><h3>{source === 'personal' && !query ? '还没有个人提示词' : source !== 'personal' && cacheStatus.cleared ? '本地缓存已清除' : '没有匹配的提示词'}</h3><p>{source === 'personal' && !query ? '从网络提示词库收藏喜欢的内容，或新建一条自己的提示词。' : source !== 'personal' && cacheStatus.cleared ? `点击刷新，重新载入 ${site.name} 的提示词目录。` : '试试其他关键词或分类。'}</p></div> : <div className="prompt-card-grid">{filtered.slice(currentPage * 24, (currentPage + 1) * 24).map((item) => <article className="prompt-card" key={item.id}>
            <button type="button" className="prompt-card-open" aria-label={`查看提示词：${item.title}`} onClick={() => setSelected(item)}>
              <div className="prompt-card-preview">{item.previewUrl ? <><span className="prompt-card-image-fallback">正在加载预览…</span><PromptImage src={item.previewUrl} alt={item.title} loading="lazy" onLoad={(event) => { event.currentTarget.hidden = false }} referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; const label = event.currentTarget.previousElementSibling; if (label) label.textContent = '预览暂不可用' }} /></> : <div className="prompt-card-excerpt"><span aria-hidden="true">Aa</span><p>{item.content}</p></div>}<span className="prompt-card-preview-label">查看详情 ↗</span></div>
              <div className="prompt-card-title"><h3>{item.title}</h3><span>{'category' in item ? String(item.category) : item.sourceUrl ? `来自 ${promptSourceName(item)}` : examples.some((example) => example.id === item.id) ? '展示示例 · 可编辑或删除' : '文字提示词'}</span></div>
            </button>
            <div className="prompt-card-actions"><button type="button" onClick={() => takePromptToGallery(item.content)}>一键使用</button>{source === 'personal' ? <button type="button" onClick={() => setSelected(item)}>查看 / 编辑</button> : <button type="button" disabled={isSaved(item)} onClick={() => collect(item)}>{isSaved(item) ? '已收藏' : '收藏'}</button>}</div>
          </article>)}</div>}
        </div>
        <div className="prompt-pagination"><span>第 {currentPage + 1} / {pages} 页</span><div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
      </section>
    </div>
    {selected && <PromptDetail key={selected.id} item={selected} personal={source === 'personal'} saved={isSaved(selected)} onClose={() => setSelected(null)} onUse={() => { if (takePromptToGallery(selected.content)) setSelected(null) }} onCollect={() => collect(selected)} onSave={async (title, content) => {
      const state = useStore.getState()
      const now = Date.now()
      const item = { ...selected, id: selected.id || crypto.randomUUID(), title, content, createdAt: selected.createdAt || now, updatedAt: now }
      if (!await state.setPromptTemplates((current) => selected.id ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current])) return false
      setSelected((current) => current?.id === selected.id ? item : current)
      setQuery('')
      setPage(0)
      state.showToast('提示词已保存', 'success')
      return true
    }} onDelete={async () => { const state = useStore.getState(); if (await state.setPromptTemplates((current) => current.filter((item) => item.id !== selected.id))) { setDeleted(selected); setSelected(null) } }} />}
  </main>
}
