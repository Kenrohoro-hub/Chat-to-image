import { describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'

describe('desktop profile pool', () => {
  const profiles = Array.from({ length: 7 }, (_, i) => createDefaultOpenAIProfile({ id: `p${i}`, name: `Profile ${i}`, apiProxy: false }))
  it('includes all dynamic standard configurations without deleting existing profiles', () => {
    const settings = normalizeSettings({ profiles })
    expect(settings.profiles).toHaveLength(7)
    expect(settings.failover?.slots).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
  })
  it('preserves ordered backups and explicit primary disablement', () => {
    const settings = normalizeSettings({ profiles, theme: 'dark', failover: { enabled: true, primaryId: 'p3', slots: ['p4', 'p3', 'p2'], disabledIds: ['p3', 'p2'] } })
    expect(settings.theme).toBe('dark')
    expect(settings.failover).toEqual({ enabled: true, primaryId: 'p3', slots: ['p4', 'p3', 'p2', 'p0', 'p1', 'p5', 'p6'], disabledIds: ['p3', 'p2'] })
  })
  it('lets a single primary be disabled and enabled without creating backups', () => {
    const settings = normalizeSettings({ profiles: [profiles[0]], failover: { enabled: true, primaryId: 'p0', slots: ['p0'], disabledIds: ['p0', 'missing'] } })
    expect(settings.failover?.disabledIds).toEqual(['p0'])
    expect(normalizeSettings({ ...settings, failover: { ...settings.failover!, disabledIds: [] } }).failover?.disabledIds).toEqual([])
  })
  it('removes incompatible or deleted references but retains advanced profiles', () => {
    const settings = normalizeSettings({ profiles: profiles.map((p) => p.id === 'p0' ? { ...p, streamImages: true } : p), failover: { enabled: false, primaryId: 'p0', slots: ['p0', 'missing', 'p1'], disabledIds: [] } })
    expect(settings.profiles).toHaveLength(7)
    expect(settings.failover).toEqual({ enabled: false, primaryId: 'p1', slots: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], disabledIds: [] })
  })
})
