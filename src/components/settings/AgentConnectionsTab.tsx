import { useEffect, useState } from 'react'
import { desktopApi, isDesktop, type AgentConnectionAction, type AgentConnectionStatus } from '../../lib/desktop'


export default function AgentConnectionsTab() {
  const [status, setStatus] = useState<AgentConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const desktop = isDesktop()

  useEffect(() => {
    if (!desktop) return
    let active = true
    setBusy(true)
    void desktopApi().then((api) => api.agent_connections('status')).then((value) => {
      if (active) setStatus(value)
    }).catch((err: unknown) => {
      console.warn('Agent connection status failed', err)
      if (active) setError(err instanceof Error ? err.message : '无法读取连接状态。')
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [desktop])

  const run = async (action: AgentConnectionAction, target?: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const next = await (await desktopApi()).agent_connections(action, target)
      setStatus(next)
      setMessage(action === 'status' ? '本地检查完成。接入文件就绪不代表 Agent 已加载或供应商已验证。' :
        `${action === 'disconnect' ? '已断开所选连接。' : '连接文件已就绪，请重新打开 Agent 会话读取。'}${next.result?.backup ? `备份位置：${next.result.backup}` : ''}`)
    } catch (err) {
      console.warn('Agent connection operation failed', err)
      setError(err instanceof Error ? err.message : '连接操作未完成，请重试。')
    } finally { setBusy(false) }
  }

  const command = status ? '& ' + status.manual_command.map((part) => `'${part.replace(/'/g, "''")}'`).join(' ') + ' agent-guide' : ''

  return <section className="space-y-4" aria-label="Agent 连接" aria-busy={busy}>
    <div>
      <h4 className="font-semibold">连接外部 Agent</h4>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">连接后，Codex、Claude Code、Cursor 或 DeepSeek Harness 可按你的请求调用本工具生成和编辑图片。关闭桌面窗口后仍可使用。</p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">连接操作立即生效。API 配置仍需在 API 配置页保存；连接不会改变 Agent 的全局生图偏好。</p>
    </div>
    {!desktop ? <div className="rounded-xl border p-4 text-sm">
      <p>请打开 run-app.cmd，在桌面窗口选择要连接的 Agent。</p>
      <p className="mt-2">也可从项目目录运行以下命令，使用指南中的完整路径从其他目录调用：</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-white/5">{'.\\chat-to-image.cmd agent-guide\n.\\chat-to-image.cmd agents status\n.\\chat-to-image.cmd agents connect --target codex'}</pre>
    </div> : <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" disabled={busy} onClick={() => void run('status')} className="rounded-lg border px-3 py-2 disabled:opacity-50">{busy ? '处理中…' : '检查连接'}</button>
        {status && <span>{status.runtime_ready ? 'CLI 本地运行检查通过' : 'CLI 运行环境待修复'}</span>}
      </div>
      {status?.targets.map((row) => <div key={row.id} className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong className="text-sm">{row.label}</strong>
          <div className="flex gap-2">
            {row.status === 'missing' && <button type="button" disabled={busy || !status.runtime_ready} onClick={() => void run('connect', row.id)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">连接 {row.label}</button>}
            {(row.status === 'connected' || row.status === 'stale') && <>
              <button type="button" disabled={busy || !status.runtime_ready} onClick={() => void run('update', row.id)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">更新 {row.label}</button>
              <button type="button" disabled={busy} onClick={() => void run('disconnect', row.id)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">断开 {row.label}</button>
            </>}
          </div>
        </div>
        <p className="mt-2 text-sm">{row.message}</p>
        <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{row.path || '目录无法定位'}</p>
      </div>)}
      {command && <details className="rounded-xl border p-4 text-sm">
        <summary className="cursor-pointer">手动调用命令</summary>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">按当前电脑的项目位置自动生成。启动脚本自动寻找 Python 并读取当前项目配置；换电脑或移动项目后重新打开此页，复制新命令。</p>
        <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-3 text-xs dark:bg-white/5">{command}</pre>
        <button type="button" className="mt-3 rounded-lg border px-3 py-2 text-xs" onClick={() => void navigator.clipboard.writeText(command).then(() => setMessage('命令已复制。')).catch(() => setError('无法访问剪贴板，请手动选择命令复制。'))}>复制调用命令</button>
      </details>}
    </>}
    {error && <p role="alert" className="break-all text-sm text-red-600 dark:text-red-400">{error}</p>}
    {message && <p role="status" className="break-all text-sm">{message}</p>}
  </section>
}
