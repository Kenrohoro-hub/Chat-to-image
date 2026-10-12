import { t } from './i18n'
import type { AppSettings } from '../types'
import { validateApiProfile } from './apiProfiles'

export function getGalleryModelGroups(settings: AppSettings) {
  const groups = settings.profiles
    .filter((profile) => profile.provider === 'openai' && profile.apiMode === 'images' && !settings.failover?.disabledIds.includes(profile.id) && !validateApiProfile(profile))
    .map((profile) => {
      let host = ''
      try { host = new URL(profile.baseUrl.includes('://') ? profile.baseUrl : `https://${profile.baseUrl}`).hostname } catch { /* 已导入的地址可能尚未填写完整。 */ }
      return { id: profile.id, name: profile.name, host, label: host ? `${profile.name} · ${host}` : profile.name, models: profile.models ?? [profile.model] }
    })
    .filter((group) => group.models.length > 0)
  return groups.map((group, index) => ({
    ...group,
    label: groups.filter((item) => item.label === group.label).length > 1 ? t(`${group.label}（配置 ${index + 1}）`, `${group.label} (profile ${index + 1})`) : group.label,
  }))
}

export function selectGalleryModel(settings: AppSettings, profileId: string, model: string): Partial<AppSettings> | null {
  const group = getGalleryModelGroups(settings).find((item) => item.id === profileId)
  if (!group || (model && !group.models.includes(model))) return null
  return {
    activeProfileId: profileId,
    galleryModel: model,
    ...(settings.failover?.slots.includes(profileId) ? { failover: { ...settings.failover, primaryId: profileId } } : {}),
  }
}
