import { t } from '../../lib/i18n'
import { useEffect, useState } from 'react'
import type { ApiProfile, AppSettings, TaskParams } from '../../types'
import { calculateImageSize, formatImageRatio, getImageSizeTier, normalizeImageSize, normalizeCodexCliImageSize, type SizeTier } from '../../lib/size'
import { getImageModelCapabilities } from '../../lib/imageModelCapabilities'
import GalleryModelPicker from './GalleryModelPicker'

const RATIOS = ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']
const TIERS: SizeTier[] = ['1K', '2K', '4K']

export default function GalleryParams({ params, setParams, profile, model, settings, onSelectModel, allowAuto, qualities, maxCount, outputCompressionInput, setOutputCompressionInput, commitOutputCompression, onConfigure }: {
  params: TaskParams
  setParams: (patch: Partial<TaskParams>) => void
  profile: ApiProfile
  model: string
  settings: AppSettings
  onSelectModel: (profileId: string, model: string) => void
  allowAuto: boolean
  qualities: { label: string; value: string }[]
  maxCount: number
  outputCompressionInput: string
  setOutputCompressionInput: (value: string) => void
  commitOutputCompression: () => void
  onConfigure: () => void
}) {
  const rule = getImageModelCapabilities(profile)
  const nativeTransparencyUnavailable = rule?.transparent === false && profile.transparentBackgroundMethod !== 'local'
  const dimensions = params.size.match(/^(\d+)x(\d+)$/)
  const [width, setWidth] = useState(dimensions?.[1] ?? '1024')
  const [height, setHeight] = useState(dimensions?.[2] ?? '1024')
  const [count, setCount] = useState(String(params.n))
  const [hint, setHint] = useState('')
  useEffect(() => { const match = params.size.match(/^(\d+)x(\d+)$/); if (match) { setWidth(match[1]); setHeight(match[2]) } }, [params.size])
  useEffect(() => setCount(String(params.n)), [params.n])
  const preset = TIERS.flatMap((tier) => RATIOS.map((ratio) => ({ tier, ratio, size: calculateImageSize(tier, ratio) }))).find((item) => item.size === params.size)
  const tier = preset?.tier ?? getImageSizeTier(params.size)
  const ratio = preset?.ratio ?? (dimensions ? `${dimensions[1]}:${dimensions[2]}` : '1:1')
  const normalize = profile.codexCli ? normalizeCodexCliImageSize : normalizeImageSize
  const updateSize = (next: string) => { const normalized = normalize(next); setParams({ size: normalized }); setHint(normalized !== next ? t(`已按模型限制调整为 ${normalized}`, `Adjusted to ${normalized} to match the model's limits`) : '') }
  const commitSize = () => {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) { setHint(t('请输入有效的正整数宽度和高度。', 'Enter valid positive integers for width and height.')); return }
    updateSize(`${w}x${h}`)
  }
  const commitCount = () => { const n = Number(count); const value = Number.isFinite(n) ? Math.max(1, Math.min(maxCount, Math.floor(n))) : params.n; setCount(String(value)); setParams({ n: value }) }
  const labels: Record<string, string> = { auto: t('自动', 'Auto'), high: t('高', 'High'), medium: t('中', 'Medium'), low: t('低', 'Low'), xhigh: t('极高', 'Very high'), max: t('最高', 'Maximum') }
  const isFalProvider = profile.provider === 'fal'
  const compressionDisabled = params.output_format === 'png' || isFalProvider

  return <div className="gallery-params">
    <GalleryModelPicker settings={settings} profile={profile} model={model} onSelectModel={onSelectModel} onConfigure={onConfigure} />
    <fieldset className="gallery-control"><legend>{t('质量', 'Quality')}</legend><div className="gallery-choice-row">{qualities.map((quality) => <button type="button" disabled={profile.codexCli} aria-pressed={params.quality === quality.value} key={quality.value} onClick={() => setParams({ quality: quality.value as TaskParams['quality'] })}>{labels[quality.value] ?? quality.label}</button>)}</div></fieldset>
    {rule?.sizes ? <fieldset className="gallery-control"><legend>{t('尺寸', 'Size')}</legend><div className="gallery-choice-row">{rule.sizes.map((size) => <button type="button" key={size} aria-pressed={params.size === size} onClick={() => setParams({ size })}>{size === 'auto' ? t('自动', 'Auto') : size}</button>)}</div><p className="gallery-field-hint">{t('按此模型已配置的尺寸显示', 'Shows sizes configured for this model')}</p></fieldset> : <>
    <div className="gallery-control"><div className="gallery-control-label"><span>{t('尺寸', 'Size')}</span><span className="gallery-field-hint">{t('16 倍数对齐', 'Aligned to multiples of 16')}</span></div><div className="gallery-dimensions"><label><span>W</span><input aria-label={t('图片宽度', 'Image width')} type="number" min={16} step={16} value={width} onChange={(event) => setWidth(event.target.value)} onBlur={commitSize} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitSize() } }} /></label><button type="button" aria-label={t('交换宽高', 'Swap width and height')} onClick={() => { setWidth(height); setHeight(width); updateSize(`${height}x${width}`) }}>⇄</button><label><span>H</span><input aria-label={t('图片高度', 'Image height')} type="number" min={16} step={16} value={height} onChange={(event) => setHeight(event.target.value)} onBlur={commitSize} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitSize() } }} /></label></div><p className="gallery-field-hint">{params.size === 'auto' ? t('尺寸由模型自动决定', 'The model chooses the size') : t(`实际尺寸 ${params.size} · ${dimensions ? formatImageRatio(Number(dimensions[1]), Number(dimensions[2])) : ''}`, `Actual size ${params.size} · ${dimensions ? formatImageRatio(Number(dimensions[1]), Number(dimensions[2])) : ''}`)}</p>{hint && <p className="gallery-field-hint" role="status">{hint}</p>}</div>
    <fieldset className="gallery-control"><legend>{t('分辨率', 'Resolution')}</legend><div className="gallery-choice-row">{TIERS.map((value) => <button type="button" key={value} disabled={profile.codexCli && value !== '1K'} aria-pressed={params.size !== 'auto' && tier === value} onClick={() => { const size = calculateImageSize(value, ratio); if (size) updateSize(size) }}>{value.toLowerCase()}</button>)}{allowAuto && <button type="button" aria-pressed={params.size === 'auto'} onClick={() => setParams({ size: 'auto' })}>{t('自动', 'Auto')}</button>}</div></fieldset>
    <fieldset className="gallery-control"><legend>{t('宽高比', 'Aspect ratio')}</legend><div className="gallery-ratio-grid">{RATIOS.map((value) => { const parts = value.split(':').map(Number); return <button type="button" key={value} aria-pressed={params.size !== 'auto' && preset?.ratio === value} onClick={() => { const size = calculateImageSize(tier, value); if (size) updateSize(size) }}><span className="gallery-ratio-icon" style={{ aspectRatio: `${parts[0]} / ${parts[1]}`, width: parts[0] >= parts[1] ? 25 : undefined, height: parts[0] < parts[1] ? 25 : undefined }} />{value}</button> })}{allowAuto && <button type="button" aria-pressed={params.size === 'auto'} onClick={() => setParams({ size: 'auto' })}>{t('自动', 'Auto')}</button>}</div></fieldset>
    </>}
    <div className="gallery-control gallery-toggle-row"><div><span>{t('透明背景', 'Transparent background')}</span><p className="gallery-field-hint">{nativeTransparencyUnavailable ? t('此模型不支持原生透明，可在设置改用本地处理', 'This model does not support native transparency. Select local processing in Settings.') : t('PNG / WebP 可用，按模型能力处理', 'Available for PNG / WebP, depending on model capabilities')}</p></div><button type="button" role="switch" aria-label={t('透明背景', 'Transparent background')} aria-checked={params.transparent_output && params.output_format !== 'jpeg'} disabled={params.output_format === 'jpeg' || nativeTransparencyUnavailable} onClick={() => setParams({ transparent_output: !params.transparent_output })}><span /></button></div>
    <fieldset className="gallery-control"><legend>{t('格式', 'Format')}</legend><div className="gallery-choice-row">{(rule?.formats ?? ['png', 'jpeg', 'webp'] as const).map((value) => <button type="button" key={value} aria-pressed={params.output_format === value} onClick={() => setParams({ output_format: value, ...(value === 'png' ? { output_compression: null } : {}), ...(value === 'jpeg' ? { transparent_output: false } : {}) })}>{value === 'webp' ? 'WebP' : value.toUpperCase()}</button>)}</div></fieldset>
    <div className="gallery-control"><label className="gallery-control-label" htmlFor="gallery-compression">{t('压缩率', 'Compression')}</label><div className="gallery-compression"><input id="gallery-compression" aria-label={t('压缩率', 'Compression')} type="number" min={0} max={100} placeholder={t('自动', 'Auto')} disabled={compressionDisabled} value={outputCompressionInput} onChange={(event) => setOutputCompressionInput(event.target.value)} onBlur={commitOutputCompression} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitOutputCompression() } }} /><button type="button" disabled={compressionDisabled} aria-pressed={params.output_compression == null} onClick={() => { setOutputCompressionInput(''); setParams({ output_compression: null }) }}>{t('自动', 'Auto')}</button></div><p className="gallery-field-hint">{isFalProvider ? t('当前接口不支持压缩率', 'This API does not support compression') : t('JPEG / WebP 可设置 0–100，留空由接口决定', 'JPEG / WebP: 0–100. Leave blank to let the API decide.')}</p></div>
    <fieldset className="gallery-control"><legend>{t('审核', 'Moderation')}</legend><div className="gallery-choice-row">{(['auto', 'low'] as const).map((value) => <button type="button" key={value} disabled={isFalProvider} aria-pressed={(isFalProvider ? 'auto' : params.moderation) === value} onClick={() => setParams({ moderation: value })}>{labels[value]}</button>)}</div>{isFalProvider && <p className="gallery-field-hint">{t('当前接口不支持审核参数', 'This API does not support moderation parameters')}</p>}</fieldset>
    {rule?.maxInputImages !== undefined && <p className="gallery-field-hint">{t('此模型', 'This model ')}{rule.maxInputImages === 0 ? t('不支持参考图', 'does not support reference images') : t(`最多支持 ${rule.maxInputImages} 张参考图`, `supports up to ${rule.maxInputImages} reference images`)}</p>}
    <fieldset className="gallery-control"><legend>{t('生成张数', 'Image count')}</legend><div className="gallery-count-grid">{Array.from({ length: Math.min(10, maxCount) }, (_, index) => index + 1).map((value) => <button type="button" key={value} aria-pressed={params.n === value} onClick={() => setParams({ n: value })}>{value} {t('张', ' images')}</button>)}<input type="number" aria-label={t('自定义生成张数', 'Custom image count')} min={1} max={maxCount} value={count} onChange={(event) => setCount(event.target.value)} onBlur={commitCount} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitCount() } }} /></div><p className="gallery-field-hint">{t('当前接口最多', 'API limit: ')} {maxCount} {t('张', ' images')}</p></fieldset>
  </div>
}
