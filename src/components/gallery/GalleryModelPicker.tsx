import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiProfile, AppSettings } from '../../types'
import { getGalleryModelGroups } from '../../lib/galleryModels'
import { ChevronDownIcon } from '../icons'

export default function GalleryModelPicker({ settings, profile, model, onSelectModel, onConfigure }: {
  settings: AppSettings
  profile: ApiProfile
  model: string
  onSelectModel: (profileId: string, model: string) => void
  onConfigure: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 300, maxHeight: 340 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const groups = getGalleryModelGroups(settings)
  const selected = groups.find((group) => group.id === profile.id && group.models.includes(model))
  const automatic = !settings.galleryModel || settings.activeProfileId !== profile.id
  const defaultModel = settings.profiles.find((item) => item.id === profile.id)?.model || model
  const service = selected ? groups.filter((group) => group.name === selected.name).length > 1 ? selected.label : selected.name : ''
  const showSearch = groups.reduce((count, group) => count + group.models.length, 0) > 4
  const term = query.trim().toLowerCase()
  const filtered = groups.map((group) => ({ ...group, models: group.models.filter((id) => `${id} ${group.label}`.toLowerCase().includes(term)) })).filter((group) => group.models.length)
  const showAutomatic = Boolean(selected && (!term || '自动'.includes(term)))
  const options = [
    ...(showAutomatic ? [{ profileId: profile.id, model: '', selected: automatic }] : []),
    ...filtered.flatMap((group) => group.models.map((id) => ({ profileId: group.id, model: id, selected: !automatic && profile.id === group.id && model === id }))),
  ]
  const index = Math.min(active, options.length - 1)
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  const choose = (profileId: string, model: string) => { onSelectModel(profileId, model); close() }

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return }
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16)
      const below = window.innerHeight - rect.bottom - 14
      const above = rect.top - 14
      const height = Math.min(340, Math.max(below, above))
      const measured = Math.min(menuRef.current?.scrollHeight ?? height, height)
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: below >= measured ? rect.bottom + 6 : Math.max(8, rect.top - measured - 6), width, maxHeight: height })
    }
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false) }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', scroll, true) }
  }, [open, query])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    const outside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    if (showSearch) searchRef.current?.focus()
    else menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.focus()
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, index, query])

  let optionIndex = showAutomatic ? 1 : 0
  return <div className="gallery-control">
    <div className="gallery-control-label"><label htmlFor="gallery-model">模型</label><button type="button" onClick={onConfigure}>API 配置</button></div>
    <button id="gallery-model" ref={triggerRef} type="button" className="gallery-model" disabled={!groups.length} aria-label={`选择生图模型${selected ? `：${automatic ? '自动' : model}，${service}` : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? 'gallery-model-options' : undefined} title={selected ? `${automatic ? `自动 · ${defaultModel}` : model} · ${selected.label}` : '请先在 API 配置中启用图像模型'} onClick={() => {
      if (open) { close(); return }
      setQuery('')
      setActive(Math.max(0, options.findIndex((option) => option.selected)))
      setOpen(true)
    }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' && !open) { event.preventDefault(); triggerRef.current?.click() }
    }}><span className="gallery-model-copy"><span>{selected ? automatic ? '自动' : model : groups.length ? '选择模型' : '请先配置模型'}</span>{service && <small>{service}</small>}</span><ChevronDownIcon className="h-4 w-4 shrink-0" /></button>
    {!groups.length && <p className="gallery-field-hint">请在 API 配置中启用图像模型。</p>}
    {open && createPortal(<div ref={menuRef} className="gallery-model-menu" style={position} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== triggerRef.current) setOpen(false)
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key === 'Tab') { close(); return }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
        event.preventDefault()
        const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        setActive(next)
        if (!showSearch) menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.focus()
      }
      if (event.key === 'Enter' && options[index]) { event.preventDefault(); choose(options[index].profileId, options[index].model) }
    }}>
      {showSearch && <input ref={searchRef} type="search" role="combobox" aria-label="搜索生图模型" aria-expanded="true" aria-controls="gallery-model-options" aria-activedescendant={options[index] ? `gallery-model-option-${index}` : undefined} autoComplete="off" placeholder="搜索模型或服务商…" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} />}
      <div id="gallery-model-options" className="gallery-model-options" role="listbox" aria-label="生图模型">
        {showAutomatic && <button id="gallery-model-option-0" type="button" role="option" aria-selected={automatic} data-option-index={0} data-highlighted={index === 0} tabIndex={showSearch ? -1 : index === 0 ? 0 : -1} onFocus={() => setActive(0)} onPointerMove={() => setActive(0)} onClick={() => choose(profile.id, '')}><span>自动<small>使用方案默认模型</small></span>{automatic && <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>}</button>}
        {filtered.map((group) => <div key={group.id} role="group" aria-label={group.label}>
          <div className="gallery-model-group"><span>{group.label}</span></div>
          {group.models.map((id) => {
            const currentIndex = optionIndex++
            const picked = !automatic && profile.id === group.id && model === id
            return <button id={`gallery-model-option-${currentIndex}`} key={id} type="button" role="option" aria-selected={picked} aria-label={`${id}，${group.label}`} title={`${id} · ${group.label}`} data-option-index={currentIndex} data-highlighted={index === currentIndex} tabIndex={showSearch ? -1 : index === currentIndex ? 0 : -1} onFocus={() => setActive(currentIndex)} onPointerMove={() => setActive(currentIndex)} onClick={() => choose(group.id, id)}><span>{id}</span>{picked && <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>}</button>
          })}
        </div>)}
      </div>
      {!filtered.length && <p className="gallery-model-empty" role="status">没有匹配的模型</p>}
    </div>, document.body)}
  </div>
}
