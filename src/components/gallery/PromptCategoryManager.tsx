import { useState } from 'react'
import { useStore } from '../../store'

export default function PromptCategoryManager({ onChange }: { onChange: (from: string, to: string) => void }) {
  const categories = useStore((state) => state.promptCategories)
  const [editing, setEditing] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="prompt-category-manager">
    <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      const next = name.trim()
      const state = useStore.getState()
      if (!next) { setError('请输入分类名称。'); return }
      if (state.promptCategories.some((category) => category !== editing && category === next)) { setError('这个分类名称已存在。'); return }
      setBusy(true)
      setError('')
      try {
        const saved = await state.setPromptTemplates(
          (current) => editing ? current.map((item) => item.category === editing ? { ...item, category: next, updatedAt: Date.now() } : item) : current,
          (current) => editing ? current.map((category) => category === editing ? next : category) : [...current, next],
        )
        if (!saved) { setError('分类未能保存，请重试。'); return }
        onChange(editing, next)
        setEditing('')
        setName('')
      } finally { setBusy(false) }
    }}>
      <label htmlFor="prompt-category-name">{editing ? '重命名分类' : '新建分类'}</label>
      <input id="prompt-category-name" aria-label="分类名称" maxLength={200} value={name} onChange={(event) => { setName(event.target.value); setError('') }} disabled={busy} />
      <div><button type="submit" disabled={busy}>{busy ? '保存中…' : editing ? '保存名称' : '创建分类'}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setName(''); setError('') }}>取消</button>}</div>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="prompt-category-manage-list">{categories.map((category) => <div className="prompt-category-manage-row" key={category}>
      <span title={category}>{category}</span>
      <div><button type="button" aria-label={`重命名分类：${category}`} disabled={busy} onClick={() => { setEditing(category); setName(category); setError('') }}>改名</button><button type="button" aria-label={`删除分类：${category}`} disabled={busy || categories.length === 1} onClick={() => {
        const target = categories.find((name) => name !== category)!
        useStore.getState().setConfirmDialog({
          title: `删除“${category}”分类？`,
          message: `该分类下的提示词将移到“${target}”，正文和图片都会保留。`,
          confirmText: '删除分类', tone: 'danger', awaitAction: true,
          action: async () => {
            const state = useStore.getState()
            const next = state.promptCategories.find((name) => name !== category)
            if (!next) return false
            const saved = await state.setPromptTemplates(
              (current) => current.map((item) => item.category === category ? { ...item, category: next, updatedAt: Date.now() } : item),
              (current) => current.filter((name) => name !== category),
            )
            if (!saved) return false
            onChange(category, next)
            if (editing === category) { setEditing(''); setName(''); setError('') }
          },
        })
      }}>删除</button></div>
    </div>)}</div>
    <p className="prompt-category-note">删除分类会保留提示词；至少保留一个分类。</p>
  </div>
}
