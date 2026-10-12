import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '../types'
import { MAX_API_PROFILES } from '../lib/apiProfiles'
import { desktopApi, isLocalService } from '../lib/desktop'
import { getUiLanguage, t } from '../lib/i18n'

export default function ApiProfileList({ draft, onChange, group, editingId, onEdit, onAdd, children }: {
  draft: AppSettings
  onChange: (settings: AppSettings) => void
  group: 'gallery' | 'agent'
  editingId: string | null
  onEdit: (id: string) => void
  onAdd: () => void
  children: ReactNode
}) {
  const agent = group === 'agent'
  const field = agent ? 'agentFailover' : 'failover'
  const selection = agent ? 'agentTextProfileId' : 'activeProfileId'
  const label = agent ? t('Agent', 'Chat') : t('画廊', 'Image')
  const pool = draft[field] ?? { enabled: true, primaryId: '', slots: [], disabledIds: [] }
  const profiles = draft.profiles.filter((p) => p.provider === 'openai' && p.apiMode === (agent ? 'responses' : 'images'))
    .sort((a, b) => { const order = (id: string) => pool.slots.includes(id) ? pool.slots.indexOf(id) : 100; return order(a.id) - order(b.id) })
  const [events, setEvents] = useState<{ profileId: string; reason: string; ok: boolean; time: number }[]>([])
  const refresh = async () => { if (isLocalService()) { try { setEvents((await (await desktopApi()).status()).events) } catch { /* 主窗口显示连接状态。 */ } } }
  useEffect(() => { void refresh() }, [])
  const changePool = (patch: Partial<typeof pool>) => onChange({ ...draft, [field]: { ...pool, ...patch } })
  return <section className="api-profile-list" aria-label={t(`${label} API 配置列表`, `${label} API profiles`)}>
    <div className="pool-heading"><div><h4>{label} {t('API 配置', 'API profiles')} <small>{t('已添加', 'Added')} {profiles.length} / {MAX_API_PROFILES}</small></h4><p>{agent ? t('Responses 用于对话；明确生图请求交给画廊 Images。', 'Responses handles chat; explicit image requests use the image service\'s Images API.') : t('Images 用于生成与编辑；使用配置中的默认图像模型。', 'Images handles generation and editing with this profile\'s default image model.')}</p></div><label><input type="checkbox" checked={pool.enabled} onChange={(e) => changePool({ enabled: e.target.checked })} />{t('自动切换备用', 'Automatically switch to backups')}</label></div>
    <div className="api-profile-rows">
      {profiles.map((profile) => {
        const id = profile.id
        const index = pool.slots.indexOf(id)
        const independent = index < 0
        const primary = independent ? draft[selection] === id : pool.primaryId === id && pool.slots.includes(draft[selection] ?? '')
        const enabled = !pool.disabledIds.includes(id)
        return <div className={`api-profile-row ${editingId === id ? 'expanded' : ''}`} key={id}>
          <div className="api-profile-summary">
            <button className="pool-edit" aria-expanded={editingId === id} onClick={() => onEdit(id)}><span className="pool-badge">{independent ? (primary ? t('独立 · 当前', 'Independent · Current') : t('独立使用', 'Independent')) : primary ? t('主用', 'Primary') : t('备用', 'Backup')}</span><strong>{profile.name}</strong><small>{profile.model || t('未选择模型', 'No model selected')} {t('· 已选', ' · Selected')} {profile.models?.length ?? 1} {t('个 ·', ' ·')} {profile.apiKey && profile.baseUrl ? t('已填写连接', 'Connection entered') : t('待填写连接', 'Connection needed')}</small></button>
            <div className="pool-actions">
              <button disabled={primary} onClick={() => onChange({ ...draft, [selection]: id, [field]: { ...pool, ...(independent ? {} : { primaryId: id, disabledIds: pool.disabledIds.filter((item) => item !== id) }) } })}>{primary ? t('当前主用', 'Current primary') : t('设为主用', 'Set as primary')}</button>
              {!independent && <><label><input type="checkbox" aria-label={t(`启用 ${profile.name}`, `Enable ${profile.name}`)} checked={enabled} onChange={() => changePool({ disabledIds: enabled ? [...pool.disabledIds, id] : pool.disabledIds.filter((item) => item !== id) })} />{enabled ? t('启用', 'Enabled') : t('停用', 'Disabled')}</label><button aria-label={t(`上移 ${profile.name}`, `Move ${profile.name} up`)} disabled={index <= 0} onClick={() => { const slots = [...pool.slots]; [slots[index - 1], slots[index]] = [slots[index], slots[index - 1]]; changePool({ slots }) }}>↑</button></>}
            </div>
          </div>
          {editingId === id && <div className="api-profile-editor">{children}</div>}
        </div>
      })}
    </div>
    <button className="api-add-button" disabled={profiles.length >= MAX_API_PROFILES} onClick={onAdd}>{t('＋ 添加 API 配置', '＋ Add API profile')}</button>
    <p className="pool-help" role="status">{profiles.length >= MAX_API_PROFILES ? t('本组已达 10 套上限，删除配置后可继续添加。', 'This group has reached its 10-profile limit. Delete a profile to add another.') : t('按需添加，停用配置仍计入总数。修改后请保存。', 'Add profiles as needed. Disabled profiles count toward the limit. Save after making changes.')}{pool.slots.length > 0 && (pool.enabled ? pool.slots.every((id) => pool.disabledIds.includes(id)) : pool.disabledIds.includes(pool.primaryId)) && t(' 当前没有启用的主备方案。', ' No primary or backup profile is currently enabled.')}</p>
    <p className="pool-help">{t('备用按列表顺序接替；明确拒绝才切换，超时或断线不重复提交。', 'Backups are tried in list order only after an explicit rejection. Timeouts and disconnections do not resubmit the request.')}{!agent && t('流式、代理及特殊模式独立使用，不参与同步 Images 主备。', ' Streaming, proxy, and special modes operate independently of synchronous Images failover.')}{!agent && !isLocalService() && t('画廊自动切换需从桌面或本机网页入口使用。', ' Image failover requires the desktop app or local web page.')}</p>
    {!agent && isLocalService() && <details className="route-events" onToggle={(e) => { if (e.currentTarget.open) void refresh() }}><summary>{t('最近调用结果', 'Recent request results')}</summary>{events.slice(-5).reverse().map((event, index) => <p key={index}>{new Date(event.time * 1000).toLocaleTimeString(getUiLanguage())} · {draft.profiles.find((p) => p.id === event.profileId)?.name ?? t('已移除方案', 'Removed profile')} · {event.ok ? t('接口已受理', 'Request accepted') : event.reason}</p>)}{!events.length && <p>{t('尚无请求记录，填写连接不代表验证成功。', 'No requests yet. Entering connection details does not verify the service.')}</p>}<button onClick={async () => { await (await desktopApi()).reset_routes(); await refresh() }}>{t('清除冷却状态', 'Clear cooldowns')}</button></details>}
  </section>
}
