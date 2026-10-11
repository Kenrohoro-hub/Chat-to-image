import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '../types'
import { MAX_API_PROFILES } from '../lib/apiProfiles'
import { desktopApi, isLocalService } from '../lib/desktop'

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
  const label = agent ? 'Agent' : '画廊'
  const pool = draft[field] ?? { enabled: true, primaryId: '', slots: [], disabledIds: [] }
  const profiles = draft.profiles.filter((p) => p.provider === 'openai' && p.apiMode === (agent ? 'responses' : 'images'))
    .sort((a, b) => { const order = (id: string) => pool.slots.includes(id) ? pool.slots.indexOf(id) : 100; return order(a.id) - order(b.id) })
  const [events, setEvents] = useState<{ profileId: string; reason: string; ok: boolean; time: number }[]>([])
  const refresh = async () => { if (isLocalService()) { try { setEvents((await (await desktopApi()).status()).events) } catch { /* 主窗口显示连接状态。 */ } } }
  useEffect(() => { void refresh() }, [])
  const changePool = (patch: Partial<typeof pool>) => onChange({ ...draft, [field]: { ...pool, ...patch } })
  return <section className="api-profile-list" aria-label={`${label} API 配置列表`}>
    <div className="pool-heading"><div><h4>{label} API 配置 <small>已添加 {profiles.length} / {MAX_API_PROFILES}</small></h4><p>{agent ? 'Responses 用于对话；明确生图请求交给画廊 Images。' : 'Images 用于生成与编辑；使用配置中的默认图像模型。'}</p></div><label><input type="checkbox" checked={pool.enabled} onChange={(e) => changePool({ enabled: e.target.checked })} />自动切换备用</label></div>
    <div className="api-profile-rows">
      {profiles.map((profile) => {
        const id = profile.id
        const index = pool.slots.indexOf(id)
        const independent = index < 0
        const primary = independent ? draft[selection] === id : pool.primaryId === id && pool.slots.includes(draft[selection] ?? '')
        const enabled = !pool.disabledIds.includes(id)
        return <div className={`api-profile-row ${editingId === id ? 'expanded' : ''}`} key={id}>
          <div className="api-profile-summary">
            <button className="pool-edit" aria-expanded={editingId === id} onClick={() => onEdit(id)}><span className="pool-badge">{independent ? (primary ? '独立 · 当前' : '独立使用') : primary ? '主用' : '备用'}</span><strong>{profile.name}</strong><small>{profile.model || '未选择模型'} · 已选 {profile.models?.length ?? 1} 个 · {profile.apiKey && profile.baseUrl ? '已填写连接' : '待填写连接'}</small></button>
            <div className="pool-actions">
              <button disabled={primary} onClick={() => onChange({ ...draft, [selection]: id, [field]: { ...pool, ...(independent ? {} : { primaryId: id, disabledIds: pool.disabledIds.filter((item) => item !== id) }) } })}>{primary ? '当前主用' : '设为主用'}</button>
              {!independent && <><label><input type="checkbox" aria-label={`启用 ${profile.name}`} checked={enabled} onChange={() => changePool({ disabledIds: enabled ? [...pool.disabledIds, id] : pool.disabledIds.filter((item) => item !== id) })} />{enabled ? '启用' : '停用'}</label><button aria-label={`上移 ${profile.name}`} disabled={index <= 0} onClick={() => { const slots = [...pool.slots]; [slots[index - 1], slots[index]] = [slots[index], slots[index - 1]]; changePool({ slots }) }}>↑</button></>}
            </div>
          </div>
          {editingId === id && <div className="api-profile-editor">{children}</div>}
        </div>
      })}
    </div>
    <button className="api-add-button" disabled={profiles.length >= MAX_API_PROFILES} onClick={onAdd}>＋ 添加 API 配置</button>
    <p className="pool-help" role="status">{profiles.length >= MAX_API_PROFILES ? '本组已达 10 套上限，删除配置后可继续添加。' : '按需添加，停用配置仍计入总数。修改后请保存。'}{pool.slots.length > 0 && (pool.enabled ? pool.slots.every((id) => pool.disabledIds.includes(id)) : pool.disabledIds.includes(pool.primaryId)) && ' 当前没有启用的主备方案。'}</p>
    <p className="pool-help">备用按列表顺序接替；明确拒绝才切换，超时或断线不重复提交。{!agent && '流式、代理及特殊模式独立使用，不参与同步 Images 主备。'}{!agent && !isLocalService() && '画廊自动切换需从桌面或本机网页入口使用。'}</p>
    {!agent && isLocalService() && <details className="route-events" onToggle={(e) => { if (e.currentTarget.open) void refresh() }}><summary>最近调用结果</summary>{events.slice(-5).reverse().map((event, index) => <p key={index}>{new Date(event.time * 1000).toLocaleTimeString()} · {draft.profiles.find((p) => p.id === event.profileId)?.name ?? '已移除方案'} · {event.ok ? '接口已受理' : event.reason}</p>)}{!events.length && <p>尚无请求记录，填写连接不代表验证成功。</p>}<button onClick={async () => { await (await desktopApi()).reset_routes(); await refresh() }}>清除冷却状态</button></details>}
  </section>
}
