import { t } from './i18n'
import type { ApiProfile, AppSettings } from '../types'
import { getAgentApiCandidates, validateApiProfile } from './apiProfiles'

export class AgentApiRejection extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function withAgentFallback<T>(
  settings: AppSettings | undefined,
  selected: ApiProfile,
  request: (profile: ApiProfile) => Promise<T>,
  signal?: AbortSignal,
  onProfileSelected?: (profile: ApiProfile, reason?: string) => void | Promise<void>,
): Promise<T> {
  const pooled = settings?.agentFailover?.slots.includes(selected.id)
  const candidates = pooled ? getAgentApiCandidates(settings!) : [selected]
  let reason = ''
  for (const profile of candidates) {
    if (signal?.aborted) throw new DOMException(t('请求已取消', 'Request canceled'), 'AbortError')
    if (pooled && validateApiProfile(profile)) {
      reason = t(`Agent 方案「${profile.name}」配置不完整，已跳过。`, `Agent profile “${profile.name}” is incomplete and was skipped.`)
      continue
    }
    await onProfileSelected?.(profile, reason ? t(`${reason} 改用「${profile.name}」。`, `${reason} Switching to “${profile.name}”.`) : undefined)
    try {
      return await request(profile)
    } catch (error) {
      if (signal?.aborted || !(error instanceof AgentApiRejection) || ![401, 402, 403, 404, 429].includes(error.status)) throw error
      reason = t(`Agent 方案「${profile.name}」被接口拒绝（HTTP ${error.status}）。`, `Agent profile “${profile.name}” was rejected by the API (HTTP ${error.status}).`)
      if (profile === candidates[candidates.length - 1]) throw error
    }
  }
  throw new Error(t('Agent 没有已启用且配置完整的 Responses 方案，请检查 API 配置。', 'No enabled, complete Responses profile is available for Agent. Check your API profiles.'))
}
