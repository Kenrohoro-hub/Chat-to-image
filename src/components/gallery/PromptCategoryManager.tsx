import { getCategoryLabel, t } from '../../lib/i18n'
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
      if (!next) { setError(t('请输入分类名称。', 'Enter a category name.')); return }
      if (state.promptCategories.some((category) => category !== editing && category === next)) { setError(t('这个分类名称已存在。', 'This category name already exists.')); return }
      setBusy(true)
      setError('')
      try {
        const saved = await state.setPromptTemplates(
          (current) => editing ? current.map((item) => item.category === editing ? { ...item, category: next, updatedAt: Date.now() } : item) : current,
          (current) => editing ? current.map((category) => category === editing ? next : category) : [...current, next],
        )
        if (!saved) { setError(t('分类未能保存，请重试。', 'Failed to save category. Please retry.')); return }
        onChange(editing, next)
        setEditing('')
        setName('')
      } finally { setBusy(false) }
    }}>
      <label htmlFor="prompt-category-name">{editing ? t('重命名分类', 'Rename category') : t('新建分类', 'New category')}</label>
      <input id="prompt-category-name" aria-label={t('分类名称', 'Category name')} maxLength={200} value={name} onChange={(event) => { setName(event.target.value); setError('') }} disabled={busy} />
      <div><button type="submit" disabled={busy}>{busy ? t('保存中…', 'Saving…') : editing ? t('保存名称', 'Save name') : t('创建分类', 'Create category')}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(''); setName(''); setError('') }}>{t('取消', 'Cancel')}</button>}</div>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="prompt-category-manage-list">{categories.map((category) => <div className="prompt-category-manage-row" key={category}>
      <span title={getCategoryLabel(category)}>{getCategoryLabel(category)}</span>
      <div><button type="button" aria-label={t(`重命名分类：${category}`, `Rename category: ${getCategoryLabel(category)}`)} disabled={busy} onClick={() => { setEditing(category); setName(category); setError('') }}>{t('改名', 'Rename')}</button><button type="button" aria-label={t(`删除分类：${category}`, `Delete category: ${getCategoryLabel(category)}`)} disabled={busy || categories.length === 1} onClick={() => {
        const target = categories.find((name) => name !== category)!
        useStore.getState().setConfirmDialog({
          title: t(`删除“${category}”分类？`, `Delete category “${getCategoryLabel(category)}”?`),
          message: t(`该分类下的提示词将移到“${target}”，正文和图片都会保留。`, `Prompts in this category will move to “${getCategoryLabel(target)}”. Their text and images will be kept.`),
          confirmText: t('删除分类', 'Delete category'), tone: 'danger', awaitAction: true,
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
      }}>{t('删除', 'Delete')}</button></div>
    </div>)}</div>
    <p className="prompt-category-note">{t('删除分类会保留提示词；至少保留一个分类。', 'Deleting a category keeps its prompts. Keep at least one category.')}</p>
  </div>
}
