import { useEffect, useRef, useState } from 'react'
import type { ApiProfile } from '../../types'
import ImageCapabilitiesSettings from './ImageCapabilitiesSettings'
import ModelCatalogDialog from './ModelCatalogDialog'

export default function ModelSettings({ profile, agent, locked, onChange, onFetch }: {
  profile: ApiProfile
  agent: boolean
  locked: boolean
  onChange: (patch: Partial<ApiProfile>) => void
  onFetch: () => Promise<NonNullable<ApiProfile['modelCatalog']>>
}) {
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const alive = useRef(0)
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const selected = profile.models ?? [profile.model]
  const catalog = profile.modelCatalog
  const ids = selected.filter((id) => selected.length <= 4 || id.toLowerCase().includes(query.trim().toLowerCase()))
  const changeModels = (models: string[]) => onChange({ models, model: models.includes(profile.model) ? profile.model : models[0] ?? '' })
  useEffect(() => {
    alive.current++
    setLoading(false)
    setMessage('')
    setCandidates(null)
    return () => { alive.current++ }
  }, [profile.id, profile.baseUrl, profile.apiKey, profile.apiProxy])
  const fetchModels = async (select = false) => {
    const attempt = ++alive.current
    const started = performance.now()
    setLoading(true)
    setMessage('')
    setFailed(false)
    try {
      const result = await onFetch()
      if (alive.current === attempt) {
        setMessage(`连接成功，模型目录可访问 · ${Math.round(performance.now() - started)} ms · 返回 ${result.ids.length} 个模型。${result.ids.length ? '可在模型选择弹窗中添加。' : '目录为空，可手动添加模型。'}`)
        if (select && result.ids.length) setCandidates(result.ids)
      }
    } catch (error) {
      if (alive.current === attempt) { setFailed(true); setMessage(error instanceof Error ? error.message : '连接检查失败，原有模型选择已保留。') }
    } finally { if (alive.current === attempt) setLoading(false) }
  }
  return <section className="model-settings" aria-label={agent ? '对话模型管理' : '图像模型管理'}>
    <div><h4 className="text-sm font-semibold">连接与模型</h4><p className="mt-1 text-xs leading-relaxed text-gray-500">先填写地址与 Key，再测试连接或获取模型。两项操作均只读取模型目录，不发送生图或对话请求。</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading || locked} onClick={() => void fetchModels()}>{loading ? '正在检查…' : '测试连通'}</button><button type="button" disabled={loading || locked} onClick={() => void fetchModels(true)}>获取模型</button></div>
    {message && <p role="status" className={`rounded-lg p-3 text-xs leading-relaxed ${failed ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-white/10"><h4 className="text-sm font-medium">已启用{agent ? '对话' : '图像'}模型 <small>{selected.length} 个</small></h4>{catalog && <button type="button" disabled={locked || catalog.stale || !catalog.ids.length} onClick={() => setCandidates(catalog.ids)}>从已获取目录选择</button>}</div>
    {selected.length > 4 && <input type="search" aria-label="搜索已启用模型" placeholder="搜索已启用模型" value={query} onChange={(event) => setQuery(event.target.value)} />}
    <div className="model-catalog">
      {ids.map((id) => <div className="model-catalog-row flex-wrap sm:flex-nowrap" key={id}>
        <span className="min-w-0 basis-full break-all text-sm sm:flex-1 sm:basis-auto">{id}</span>
        <div className="ml-auto flex shrink-0 gap-1"><button type="button" disabled={locked || profile.model === id} aria-label={`将 ${id} 设为默认`} onClick={() => onChange({ model: id })}>{profile.model === id ? '默认' : '设为默认'}</button><button type="button" disabled={locked || selected.length <= 1} aria-label={`移除 ${id}`} onClick={() => changeModels(selected.filter((item) => item !== id))}>移除</button></div>
      </div>)}
      {!ids.length && <p className="py-3 text-xs text-gray-500">没有匹配模型。可获取目录或手动添加。</p>}
    </div>
    {candidates && <ModelCatalogDialog ids={candidates} selected={selected} profileName={profile.name} onClose={() => setCandidates(null)} onAdd={(models) => { changeModels([...new Set([...selected, ...models])]); setCandidates(null) }} />}
    <div className="flex gap-2"><input aria-label="手动添加模型" placeholder="手动添加模型 ID，多个用逗号分隔" value={manual} disabled={locked} onChange={(event) => setManual(event.target.value)} /><button type="button" disabled={locked || !manual.trim()} onClick={() => { changeModels([...new Set([...selected, ...manual.split(/[,，\n]/).map((id) => id.trim()).filter(Boolean)])]); setManual('') }}>添加</button></div>
    <p className="text-xs text-gray-500">{catalog ? `最近更新：${new Date(catalog.fetchedAt).toLocaleString()}${catalog.stale ? ' · 连接已修改，请重新获取' : ''}` : '供应商不提供模型列表时，可手动添加'}。目录可访问仅表示该接口可用，不代表生图、对话及 Key 的全部权限已验证。</p>
    {!agent && <ImageCapabilitiesSettings profile={profile} locked={locked} onChange={onChange} />}
    {agent && selected.length > 0 && <details><summary>模型能力（按服务商说明设置）</summary><p className="text-xs text-gray-500">未确认看图能力时，只传图片引用和文字描述；工具能力未确认时允许尝试，失败会明确提示。</p>{selected.map((id) => <div className="model-capabilities" key={id}><span>{id}</span>{(['vision', 'tools', 'reasoning'] as const).map((field) => <label key={field}>{field === 'vision' ? '看图' : field === 'tools' ? '工具调用' : '支持推理参数'}<select aria-label={`${id} ${field === 'vision' ? '看图' : field === 'tools' ? '工具调用' : '支持推理参数'}`} disabled={locked} value={profile.modelCapabilities?.[id]?.[field] === undefined ? '' : String(profile.modelCapabilities[id][field])} onChange={(event) => onChange({ modelCapabilities: { ...profile.modelCapabilities, [id]: { ...profile.modelCapabilities?.[id], [field]: event.target.value === '' ? undefined : event.target.value === 'true' } } })}><option value="">未确认</option><option value="true">支持</option><option value="false">不支持</option></select></label>)}</div>)}</details>}
  </section>
}
