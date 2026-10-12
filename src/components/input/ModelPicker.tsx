import { t } from '../../lib/i18n'
import { useRef, useState } from 'react'

export default function ModelPicker({ label, value, models, automatic, disabled, onChange }: {
  label: string; value: string; models: string[]; automatic: string; disabled?: boolean; onChange: (model: string) => void
}) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDetailsElement>(null)
  const choose = (model: string) => { onChange(model); if (ref.current) ref.current.open = false; setQuery('') }
  return <details className="model-picker" ref={ref} onKeyDown={(event) => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus() } }}>
    <summary aria-label={label} aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault() }}>{value || automatic}<span>⌄</span></summary>
    <div className="model-picker-menu"><input type="search" autoComplete="off" aria-label={t(`搜索${label}`, `Search ${label}`)} placeholder={t('搜索模型…', 'Search models…')} value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
      <div className="model-picker-options"><button type="button" disabled={disabled} aria-pressed={!value} onClick={() => choose('')}>{automatic}</button>{models.filter((id) => id.toLowerCase().includes(query.toLowerCase())).map((id) => <button type="button" key={id} disabled={disabled} aria-pressed={id === value} onClick={() => choose(id)}>{id}</button>)}{!models.length && <p>{t('请先在 API 配置中启用模型。', 'Enable a model in API profiles first.')}</p>}</div>
    </div>
  </details>
}
