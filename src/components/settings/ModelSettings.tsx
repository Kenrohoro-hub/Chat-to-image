import { useEffect, useRef, useState } from 'react'
import type { ApiProfile } from '../../types'
import ImageCapabilitiesSettings from './ImageCapabilitiesSettings'
import ModelCatalogDialog from './ModelCatalogDialog'
import { getUiLanguage, t } from '../../lib/i18n'

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
        const elapsed = Math.round(performance.now() - started)
        setMessage(t(`连接成功，模型目录可访问 · ${elapsed} ms · 返回 ${result.ids.length} 个模型。`, `Connected; model catalog available · ${elapsed} ms · ${result.ids.length} models returned. `) + (result.ids.length ? t('可在模型选择弹窗中添加。', 'Add models in the selection dialog.') : t('目录为空，可手动添加模型。', 'The catalog is empty. Add models manually.')))
        if (select && result.ids.length) setCandidates(result.ids)
      }
    } catch (error) {
      if (alive.current === attempt) { setFailed(true); setMessage(error instanceof Error ? error.message : t('连接检查失败，原有模型选择已保留。', 'Connection check failed. Your model selection was kept.')) }
    } finally { if (alive.current === attempt) setLoading(false) }
  }
  return <section className="model-settings" aria-label={agent ? t('对话模型管理', 'Chat model management') : t('图像模型管理', 'Image model management')}>
    <div><h4 className="text-sm font-semibold">{t('连接与模型', 'Connection and models')}</h4><p className="mt-1 text-xs leading-relaxed text-gray-500">{t('先填写地址与 Key，再测试连接或获取模型。两项操作均只读取模型目录，不发送生图或对话请求。', 'Enter the URL and API key, then test the connection or fetch models. Both actions only read the model catalog; they do not generate images or send chat messages.')}</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading || locked} onClick={() => void fetchModels()}>{loading ? t('正在检查…', 'Checking…') : t('测试连通', 'Test connection')}</button><button type="button" disabled={loading || locked} onClick={() => void fetchModels(true)}>{t('获取模型', 'Fetch models')}</button></div>
    {message && <p role="status" className={`rounded-lg p-3 text-xs leading-relaxed ${failed ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-white/10"><h4 className="text-sm font-medium">{agent ? t('已启用对话模型', 'Enabled chat models') : t('已启用图像模型', 'Enabled image models')} <small>{t(`${selected.length} 个`, `${selected.length}`)}</small></h4>{catalog && <button type="button" disabled={locked || catalog.stale || !catalog.ids.length} onClick={() => setCandidates(catalog.ids)}>{t('从已获取目录选择', 'Select from fetched catalog')}</button>}</div>
    {selected.length > 4 && <input type="search" aria-label={t('搜索已启用模型', 'Search enabled models')} placeholder={t('搜索已启用模型', 'Search enabled models')} value={query} onChange={(event) => setQuery(event.target.value)} />}
    <div className="model-catalog">
      {ids.map((id) => <div className="model-catalog-row flex-wrap sm:flex-nowrap" key={id}>
        <span className="min-w-0 basis-full break-all text-sm sm:flex-1 sm:basis-auto">{id}</span>
        <div className="ml-auto flex shrink-0 gap-1"><button type="button" disabled={locked || profile.model === id} aria-label={t(`将 ${id} 设为默认`, `Set ${id} as default`)} onClick={() => onChange({ model: id })}>{profile.model === id ? t('默认', 'Default') : t('设为默认', 'Set as default')}</button><button type="button" disabled={locked || selected.length <= 1} aria-label={t(`移除 ${id}`, `Remove ${id}`)} onClick={() => changeModels(selected.filter((item) => item !== id))}>{t('移除', 'Remove')}</button></div>
      </div>)}
      {!ids.length && <p className="py-3 text-xs text-gray-500">{t('没有匹配模型。可获取目录或手动添加。', 'No matching models. Fetch the catalog or add a model manually.')}</p>}
    </div>
    {candidates && <ModelCatalogDialog ids={candidates} selected={selected} profileName={profile.name} onClose={() => setCandidates(null)} onAdd={(models) => { changeModels([...new Set([...selected, ...models])]); setCandidates(null) }} />}
    <div className="flex gap-2"><input aria-label={t('手动添加模型', 'Add models manually')} placeholder={t('手动添加模型 ID，多个用逗号分隔', 'Enter model IDs, separated by commas')} value={manual} disabled={locked} onChange={(event) => setManual(event.target.value)} /><button type="button" disabled={locked || !manual.trim()} onClick={() => { changeModels([...new Set([...selected, ...manual.split(/[,，\n]/).map((id) => id.trim()).filter(Boolean)])]); setManual('') }}>{t('添加', 'Add')}</button></div>
    <p className="text-xs text-gray-500">{catalog ? t(`最近更新：${new Date(catalog.fetchedAt).toLocaleString(getUiLanguage())}`, `Last updated: ${new Date(catalog.fetchedAt).toLocaleString(getUiLanguage())}`) + (catalog.stale ? t(' · 连接已修改，请重新获取', ' · Connection changed; fetch again') : '') : t('供应商不提供模型列表时，可手动添加', 'Add models manually if the provider does not offer a catalog')}{t('。目录可访问仅表示该接口可用，不代表生图、对话及 Key 的全部权限已验证。', '. Catalog access only verifies that endpoint, not image generation, chat, or all permissions of your API key.')}</p>
    {!agent && <ImageCapabilitiesSettings profile={profile} locked={locked} onChange={onChange} />}
    {agent && selected.length > 0 && <details><summary>{t('模型能力（按服务商说明设置）', 'Model capabilities (from provider documentation)')}</summary><p className="text-xs text-gray-500">{t('未确认看图能力时，只传图片引用和文字描述；工具能力未确认时允许尝试，失败会明确提示。', 'When vision is unconfirmed, only image references and text descriptions are sent. Unconfirmed tool support can be tried; failures are reported.')}</p>{selected.map((id) => <div className="model-capabilities" key={id}><span>{id}</span>{(['vision', 'tools', 'reasoning'] as const).map((field) => <label key={field}>{field === 'vision' ? t('看图', 'Vision') : field === 'tools' ? t('工具调用', 'Tool calling') : t('支持推理参数', 'Reasoning parameters')}<select aria-label={`${id} ${field === 'vision' ? t('看图', 'Vision') : field === 'tools' ? t('工具调用', 'Tool calling') : t('支持推理参数', 'Reasoning parameters')}`} disabled={locked} value={profile.modelCapabilities?.[id]?.[field] === undefined ? '' : String(profile.modelCapabilities[id][field])} onChange={(event) => onChange({ modelCapabilities: { ...profile.modelCapabilities, [id]: { ...profile.modelCapabilities?.[id], [field]: event.target.value === '' ? undefined : event.target.value === 'true' } } })}><option value="">{t('未确认', 'Unconfirmed')}</option><option value="true">{t('支持', 'Supported')}</option><option value="false">{t('不支持', 'Unsupported')}</option></select></label>)}</div>)}</details>}
  </section>
}
