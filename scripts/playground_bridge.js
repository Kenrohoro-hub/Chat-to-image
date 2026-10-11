(() => {
  let token = '__CODEX_SYNC_TOKEN__'
  let nextProbe = Date.now() + 5000
  let last = ''
  let pending = false
  const badge = document.createElement('button')
  badge.type = 'button'
  badge.textContent = 'Codex：检查配置'
  badge.title = '将此浏览器当前选中的图片 API 配置同步到本机 Codex。点击重新同步。'
  Object.assign(badge.style, {
    position: 'fixed', bottom: '12px', right: '12px', zIndex: '9999',
    padding: '7px 11px', borderRadius: '8px', border: '1px solid #737373',
    background: '#171717', color: '#fff', font: '12px system-ui', cursor: 'pointer',
  })
  document.body.append(badge)

  async function sync(force = false) {
    if (pending) return
    try {
      const raw = localStorage.getItem('gpt-image-playground')
      // 新浏览器尚无配置时，保留其他已授权浏览器同步的配置。
      if (!raw) {
        badge.textContent = 'Codex：此浏览器未配置'
        badge.title = '新设备或新浏览器请先在设置中导入或填写 API 配置，完成后会自动同步。'
        return
      }
      const settings = JSON.parse(raw)?.state?.settings
      if (!settings) throw new Error('无效的网页配置')
      const selected = Array.isArray(settings.profiles)
        ? settings.profiles.find((profile) => profile.id === settings.activeProfileId)
        : settings
      const profile = {}
      for (const field of ['id', 'name', 'provider', 'baseUrl', 'model', 'apiMode', 'apiKey', 'codexCli', 'apiProxy', 'streamImages', 'responseFormatB64Json']) {
        if (selected?.[field] !== undefined) profile[field] = selected[field]
      }
      const body = JSON.stringify({ profile })
      pending = true
      // 服务重启会更换令牌，即使配置未变也必须重新同步。
      if (force || Date.now() >= nextProbe) {
        const session = await fetch('/__codex/session', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (!session.ok) throw new Error('同步服务尚未升级或暂不可用')
        const current = await session.json()
        if (typeof current.token !== 'string' || !/^[a-f0-9]{64}$/.test(current.token)) throw new Error('无效的同步会话')
        if (token !== current.token) {
          token = current.token
          last = ''
        }
        nextProbe = Date.now() + 5000
      }
      if (!force && body === last) return
      const response = await fetch('/__codex/config', {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json', 'X-Codex-Sync': token }, body,
      })
      const status = await response.json()
      if (!response.ok) throw new Error('同步服务不可用，请刷新网页重试。')
      last = body
      badge.textContent = status.synced ? 'Codex：已同步' : 'Codex：需要检查配置'
      badge.title = status.message
    } catch {
      last = ''
      nextProbe = 0
      badge.textContent = 'Codex：等待服务，自动重试'
      badge.title = '请运行 run-app.cmd 或 run-sync.cmd；服务恢复后会自动重连。点击也可重试。'
    } finally {
      pending = false
    }
  }
  badge.addEventListener('click', () => sync(true))
  window.addEventListener('storage', () => sync())
  window.addEventListener('focus', () => sync())
  setInterval(() => sync(), 1500)
  sync()
})()
