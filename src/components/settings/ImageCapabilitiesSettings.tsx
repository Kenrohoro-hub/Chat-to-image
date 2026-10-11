import { useState } from 'react'
import type { ApiProfile, ImageModelCapabilities } from '../../types'
import { IMAGE_FORMATS, IMAGE_QUALITIES } from '../../lib/imageModelCapabilities'
import { getImageGenerationModel } from '../../lib/imageModels'

export default function ImageCapabilitiesSettings({ profile, locked, onChange }: { profile: ApiProfile; locked: boolean; onChange: (patch: Partial<ApiProfile>) => void }) {
  const models = profile.apiMode === 'responses' ? [getImageGenerationModel(profile)].filter(Boolean) : profile.models?.length ? profile.models : [profile.model]
  const [selected, setSelected] = useState('')
  const [sizeError, setSizeError] = useState('')
  const model = models.includes(selected) ? selected : models[0]
  const rule = profile.imageCapabilities?.[model] ?? {}
  const update = (patch: Partial<ImageModelCapabilities>) => onChange({ imageCapabilities: { ...profile.imageCapabilities, [model]: { ...rule, ...patch } } })
  const labels: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }
  if (!model) return null
  return <details className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
    <summary className="cursor-pointer text-sm font-medium">图像模型参数限制</summary>
    <p className="my-3 text-xs leading-relaxed text-gray-500">按服务商说明填写。留空沿用通用设置；模型目录通常不包含完整限制。保存后自动调整参数选项，并在提交前检查。</p>
    <fieldset disabled={locked} className="grid min-w-0 gap-4">
      <label className="grid min-w-0 gap-1 text-xs">选择图像模型<select aria-label="参数限制模型" className="w-full min-w-0" value={model} onChange={(event) => setSelected(event.target.value)}>{models.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
      <label className="grid gap-1 text-xs">允许尺寸（用逗号分隔）<input key={`${profile.id}/${model}/${rule.sizes?.join(',') ?? ''}`} aria-label="模型允许尺寸" defaultValue={rule.sizes?.join(', ') ?? ''} placeholder="如 auto, 1024x1024, 1536x1024；留空不限" onBlur={(event) => {
        const sizes = [...new Set(event.target.value.split(/[,，\n]/).map((value) => value.trim().toLowerCase().replace('×', 'x')).filter(Boolean))]
        if (sizes.some((size) => size !== 'auto' && !/^[1-9]\d{0,4}x[1-9]\d{0,4}$/.test(size))) { event.target.value = rule.sizes?.join(', ') ?? ''; setSizeError('尺寸格式无效，已保留原设置。请填写 auto 或宽x高，例如 1024x1024。'); return }
        setSizeError(''); update({ sizes: sizes.length ? sizes : undefined })
      }} onChange={() => setSizeError('')} />{sizeError && <span role="alert" className="text-red-600 dark:text-red-400">{sizeError}</span>}</label>
      <div className="grid gap-3 sm:grid-cols-2">{(['qualities', 'formats'] as const).map((field) => <div key={field}><span className="text-xs">{field === 'qualities' ? '允许质量' : '允许格式'}（不选表示不限）</span><div className="mt-2 flex flex-wrap gap-3">{(field === 'qualities' ? IMAGE_QUALITIES : IMAGE_FORMATS).map((value) => <label className="inline-flex items-center gap-1 text-xs" key={value}><input type="checkbox" checked={(rule[field] as readonly string[] | undefined)?.includes(value) ?? false} onChange={(event) => {
        const values = rule[field] as string[] | undefined ?? []
        const next = event.target.checked ? [...values, value] : values.filter((item) => item !== value)
        update({ [field]: next.length ? next : undefined })
      }} />{labels[value] ?? value.toUpperCase()}</label>)}</div></div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs">原生透明背景<select aria-label="模型原生透明背景" value={rule.transparent === undefined ? '' : String(rule.transparent)} onChange={(event) => update({ transparent: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">未确认</option><option value="true">支持</option><option value="false">不支持</option></select></label><label className="grid gap-1 text-xs">参考图上限（0 表示不支持）<input type="number" aria-label="模型参考图上限" min={0} max={16} placeholder="通用上限 16" value={rule.maxInputImages ?? ''} onChange={(event) => { const value = event.target.value; if (!value || (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 16)) update({ maxInputImages: value === '' ? undefined : Number(value) }) }} /></label></div>
    </fieldset>
  </details>
}
