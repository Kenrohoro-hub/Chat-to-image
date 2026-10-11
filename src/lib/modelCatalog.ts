import { REASONING_EFFORT_VALUES, type ReasoningEffort, type ApiProfile } from '../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { desktopApi, isLocalService } from './desktop'

export function normalizeModelCatalog(input: unknown): ApiProfile['modelCatalog'] {
  if (!input || typeof input !== 'object') return undefined
  const value = input as Record<string, unknown>
  if (!Array.isArray(value.ids) || typeof value.fetchedAt !== 'number') return undefined
  return { ids: [...new Set(value.ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))], fetchedAt: value.fetchedAt, stale: value.stale === true }
}

export function normalizeModelCapabilities(input: unknown): ApiProfile['modelCapabilities'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  return Object.fromEntries(Object.entries(input).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object') return []
    const record = value as Record<string, unknown>
    return [[id, { vision: typeof record.vision === 'boolean' ? record.vision : undefined, tools: typeof record.tools === 'boolean' ? record.tools : undefined, reasoning: typeof record.reasoning === 'boolean' ? record.reasoning : undefined, reasoningEfforts: Array.isArray(record.reasoningEfforts) ? record.reasoningEfforts.filter((value): value is ReasoningEffort => REASONING_EFFORT_VALUES.includes(value as ReasoningEffort)) : undefined }]]
  }))
}

export async function fetchModelCatalog(profile: ApiProfile): Promise<NonNullable<ApiProfile['modelCatalog']>> {
  const address = profile.baseUrl.trim()
  let url: URL
  try { url = new URL(address.includes('://') ? address : `https://${address}`) }
  catch { throw new Error('请填写有效的 API 地址。') }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须是 HTTP(S) 地址，不能包含凭据或查询参数。')
  const key = profile.apiKey.trim()
  if (!key || /[\r\n]/.test(key)) throw new Error('请填写有效的 API Key。')
  try {
    if (isLocalService()) return await (await desktopApi()).list_models({ baseUrl: address, apiKey: key })
    const response = await fetch(buildApiUrl(address, '/models', readClientDevProxyConfig(), shouldUseApiProxy(profile.apiProxy)), {
      headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error(`模型目录访问失败（HTTP ${response.status}）。`)
    const result = await response.json()
    if (!Array.isArray(result?.data)) throw new Error('服务未返回兼容的模型目录，可手动添加。')
    return { ids: [...new Set<string>(result.data.flatMap((item: { id?: unknown }) => typeof item?.id === 'string' && item.id.trim() ? [item.id.trim()] : []))], fetchedAt: Date.now() }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/401|403/.test(message)) throw new Error('鉴权或访问被拒绝（HTTP 401/403），请核对 Key、账户权限与接口地址。')
    if (/404|405/.test(message)) throw new Error('该地址未提供模型目录（HTTP 404/405）。请核对地址，或按服务商说明手动添加模型。')
    if (/429/.test(message)) throw new Error('请求受限（HTTP 429），请稍后再试并检查服务商额度。')
    if (/HTTP 5\d\d/.test(message)) throw new Error('服务商暂时不可用（HTTP 5xx），请稍后重试。')
    if (/HTTP 3\d\d/.test(message)) throw new Error('接口发生重定向，已停止请求。请直接填写服务商提供的最终接口地址。')
    if (error instanceof Error && /TimeoutError|AbortError/.test(error.name) || /超时/.test(message)) throw new Error('模型目录请求超时，请检查网络后重试；未发送生图或对话请求。')
    if (error instanceof SyntaxError || /格式|兼容|大小限制/.test(message)) throw new Error('服务未返回兼容的模型目录，可按服务商说明手动添加模型。')
    throw new Error('无法访问模型目录，请检查地址与网络。普通网页还需服务商允许跨域；原有模型选择已保留。')
  }
}
