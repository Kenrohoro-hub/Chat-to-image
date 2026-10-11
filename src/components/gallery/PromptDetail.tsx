import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PromptTemplate } from '../../types'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../hooks/usePreventBackgroundScroll'
import { getPromptImageRevision, subscribePromptImages } from '../../lib/promptLibrary'
import PromptImage from './PromptImage'

export default function PromptDetail({ item, categories, personal, saved, onClose, onUse, onUseImage, onCollect, onSave, onDelete }: {
  item: PromptTemplate
  categories: string[]
  personal: boolean
  saved: boolean
  onClose: () => void
  onUse: () => void
  onUseImage: (includePrompt: boolean) => Promise<void>
  onCollect: () => void
  onSave: (title: string, content: string, category: string) => Promise<boolean>
  onDelete: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(!item.id)
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.content)
  const [category, setCategory] = useState(item.category || categories[0])
  const [zoom, setZoom] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [usingImage, setUsingImage] = useState(false)
  const revision = useSyncExternalStore(subscribePromptImages, getPromptImageRevision)
  useEffect(() => setImageFailed(false), [revision])
  const panel = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, () => { if (zoom) setZoom(false); else if (editing && item.id) setEditing(false); else onClose() })
  usePreventBackgroundScroll(true, panel)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>(item.id ? 'button' : 'input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const referenceImage = async (includePrompt: boolean) => {
    if (usingImage) return
    setUsingImage(true)
    try { await onUseImage(includePrompt) } finally { setUsingImage(false) }
  }
  return createPortal(<div className="prompt-detail-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="prompt-detail" data-zoom={zoom} ref={panel} role="dialog" aria-modal="true" aria-labelledby="prompt-detail-title" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]') ?? []).filter((el) => !el.closest('[hidden]'))
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header><div><span>{editing ? '编辑个人提示词' : '提示词详情'}</span><h2 id="prompt-detail-title">{item.title || '新建提示词'}</h2></div><button type="button" aria-label="关闭提示词详情" onClick={onClose}>×</button></header>
      <div className="prompt-detail-body">
        <div className="prompt-detail-preview">
          {item.previewUrl && !imageFailed ? <><button type="button" className="prompt-detail-image" aria-label={zoom ? '还原预览' : '放大预览'} onClick={() => setZoom(!zoom)}><PromptImage src={item.previewUrl} alt={item.title} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /></button><button type="button" className="prompt-zoom" onClick={() => setZoom(!zoom)}>{zoom ? '还原预览' : '放大预览'}</button></> : <div className="prompt-no-preview"><span aria-hidden="true">Aa</span><p>{imageFailed ? '预览图暂时无法加载' : '文字提示词'}</p></div>}
        </div>
        <div className="prompt-detail-copy" hidden={zoom}>
          {editing ? <form onSubmit={async (event) => { event.preventDefault(); if (saving || !title.trim() || !content.trim()) return; setSaving(true); try { if (await onSave(title.trim(), content.trim(), category)) setEditing(false) } finally { setSaving(false) } }}>
            <label>名称<input aria-label="提示词名称" value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus /></label>
            <label>主题分类<select aria-label="提示词分类" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="prompt-content-field">提示词内容<textarea aria-label="提示词内容" value={content} onChange={(event) => setContent(event.target.value)} required /></label>
            <div className="prompt-detail-actions"><button type="submit" className="prompt-primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button><button type="button" onClick={() => { if (!item.id) onClose(); else { setEditing(false); setTitle(item.title); setContent(item.content); setCategory(item.category || categories[0]) } }}>取消</button></div>
          </form> : <>
            <div className="prompt-detail-text-wrap"><div className="prompt-detail-label"><span>{personal ? `主题分类 · ${item.category || categories[0]}` : '完整提示词'}</span><span>{item.content.length} 字符</span></div><p className="prompt-detail-text">{item.content}</p></div>
            <footer>
              <p>{usingImage ? '正在读取预览图…' : '引用提示词只替换草稿文字；引用图片会把预览图加入参考图。不会自动生成。'}</p>
              <div className="prompt-detail-actions">
                <button type="button" className="prompt-primary" aria-label="引用当前提示词" disabled={usingImage} onClick={onUse}>引用提示词</button>
                <button type="button" disabled={!item.previewUrl || usingImage} title={!item.previewUrl ? '这条提示词没有预览图' : undefined} onClick={() => void referenceImage(false)}>引用图片</button>
                <button type="button" disabled={!item.previewUrl || usingImage} title={!item.previewUrl ? '这条提示词没有预览图' : undefined} onClick={() => void referenceImage(true)}>引用提示词和图片</button>
                {personal ? <><button type="button" disabled={usingImage} onClick={() => { setTitle(item.title); setContent(item.content); setCategory(item.category || categories[0]); setEditing(true) }}>编辑</button><button type="button" disabled={usingImage} onClick={onDelete}>删除</button></> : <button type="button" aria-label="收藏提示词" disabled={saved || usingImage} onClick={onCollect}>{saved ? '已收藏' : '收藏'}</button>}
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 ↗</a>}
              </div>
            </footer>
          </>}
        </div>
      </div>
    </div>
  </div>, document.body)
}
