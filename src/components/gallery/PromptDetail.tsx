import { getCategoryLabel, t } from '../../lib/i18n'
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
      <header><div><span>{editing ? t('编辑个人提示词', 'Edit personal prompt') : t('提示词详情', 'Prompt details')}</span><h2 id="prompt-detail-title">{item.title || t('新建提示词', 'New prompt')}</h2></div><button type="button" aria-label={t('关闭提示词详情', 'Close prompt details')} onClick={onClose}>×</button></header>
      <div className="prompt-detail-body">
        <div className="prompt-detail-preview">
          {item.previewUrl && !imageFailed ? <><button type="button" className="prompt-detail-image" aria-label={zoom ? t('还原预览', 'Reset preview') : t('放大预览', 'Enlarge preview')} onClick={() => setZoom(!zoom)}><PromptImage src={item.previewUrl} alt={item.title} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /></button><button type="button" className="prompt-zoom" onClick={() => setZoom(!zoom)}>{zoom ? t('还原预览', 'Reset preview') : t('放大预览', 'Enlarge preview')}</button></> : <div className="prompt-no-preview"><span aria-hidden="true">Aa</span><p>{imageFailed ? t('预览图暂时无法加载', 'Preview image is unavailable') : t('文字提示词', 'Text prompt')}</p></div>}
        </div>
        <div className="prompt-detail-copy" hidden={zoom}>
          {editing ? <form onSubmit={async (event) => { event.preventDefault(); if (saving || !title.trim() || !content.trim()) return; setSaving(true); try { if (await onSave(title.trim(), content.trim(), category)) setEditing(false) } finally { setSaving(false) } }}>
            <label>{t('名称', 'Name')}<input aria-label={t('提示词名称', 'Prompt name')} value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus /></label>
            <label>{t('主题分类', 'Category')}<select aria-label={t('提示词分类', 'Prompt category')} value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((name) => <option key={name} value={name}>{getCategoryLabel(name)}</option>)}</select></label>
            <label className="prompt-content-field">{t('提示词内容', 'Prompt content')}<textarea aria-label={t('提示词内容', 'Prompt content')} value={content} onChange={(event) => setContent(event.target.value)} required /></label>
            <div className="prompt-detail-actions"><button type="submit" className="prompt-primary" disabled={saving}>{saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}</button><button type="button" onClick={() => { if (!item.id) onClose(); else { setEditing(false); setTitle(item.title); setContent(item.content); setCategory(item.category || categories[0]) } }}>{t('取消', 'Cancel')}</button></div>
          </form> : <>
            <div className="prompt-detail-text-wrap"><div className="prompt-detail-label"><span>{personal ? t(`主题分类 · ${item.category || categories[0]}`, `Category · ${getCategoryLabel(item.category || categories[0])}`) : t('完整提示词', 'Full prompt')}</span><span>{item.content.length} {t('字符', ' characters')}</span></div><p className="prompt-detail-text">{item.content}</p></div>
            <footer>
              <p>{usingImage ? t('正在读取预览图…', 'Loading preview image…') : t('引用提示词只替换草稿文字；引用图片会把预览图加入参考图。不会自动生成。', 'Use prompt replaces the draft text. Use image adds the preview as a reference image. Neither starts generation automatically.')}</p>
              <div className="prompt-detail-actions">
                <button type="button" className="prompt-primary" aria-label={t('引用当前提示词', 'Use current prompt')} disabled={usingImage} onClick={onUse}>{t('引用提示词', 'Use prompt')}</button>
                <button type="button" disabled={!item.previewUrl || usingImage} title={!item.previewUrl ? t('这条提示词没有预览图', 'This prompt has no preview image') : undefined} onClick={() => void referenceImage(false)}>{t('引用图片', 'Use image')}</button>
                <button type="button" disabled={!item.previewUrl || usingImage} title={!item.previewUrl ? t('这条提示词没有预览图', 'This prompt has no preview image') : undefined} onClick={() => void referenceImage(true)}>{t('引用提示词和图片', 'Use prompt and image')}</button>
                {personal ? <><button type="button" disabled={usingImage} onClick={() => { setTitle(item.title); setContent(item.content); setCategory(item.category || categories[0]); setEditing(true) }}>{t('编辑', 'Edit')}</button><button type="button" disabled={usingImage} onClick={onDelete}>{t('删除', 'Delete')}</button></> : <button type="button" aria-label={t('收藏提示词', 'Favorite prompt')} disabled={saved || usingImage} onClick={onCollect}>{saved ? t('已收藏', 'Favorited') : t('收藏', 'Favorite')}</button>}
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{t('查看来源 ↗', 'View source ↗')}</a>}
              </div>
            </footer>
          </>}
        </div>
      </div>
    </div>
  </div>, document.body)
}
