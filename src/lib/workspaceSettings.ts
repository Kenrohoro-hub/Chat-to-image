import type { AppSettings } from '../types'
import { createDefaultOpenAIProfile, isAgentTextApiProfile, normalizeSettings } from './apiProfiles'

export function normalizeWorkspaceSettings(input: Partial<AppSettings>): AppSettings {
  const settings = normalizeSettings(input)
  let gallery = settings.profiles.find((p) => p.id === settings.activeProfileId && p.provider === 'openai' && p.apiMode === 'images')
    ?? settings.profiles.find((p) => p.provider === 'openai' && p.apiMode === 'images')
  if (!gallery) {
    let id = 'gallery-default'
    while (settings.profiles.some((p) => p.id === id)) id += '-new'
    gallery = createDefaultOpenAIProfile({ id, name: '画廊方案 1', apiProxy: false })
    settings.profiles.push(gallery)
    if (!settings.failover?.slots.length) settings.failover = { enabled: true, primaryId: id, slots: [id], disabledIds: [] }
  }
  const agent = settings.profiles.find((p) => p.id === settings.agentTextProfileId && isAgentTextApiProfile(p))
    ?? settings.profiles.find(isAgentTextApiProfile)
  return normalizeSettings({ ...settings, agentImageTools: true, galleryModel: (gallery.models ?? [gallery.model]).includes(settings.galleryModel ?? '') ? settings.galleryModel : '', activeProfileId: gallery.id, agentApiConfigMode: 'native',
    agentTextProfileId: agent?.id ?? null, agentImageProfileId: gallery.id })
}
