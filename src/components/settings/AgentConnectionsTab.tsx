import { useEffect, useState } from 'react'
import { desktopApi, isDesktop, type AgentConnectionAction, type AgentConnectionStatus } from '../../lib/desktop'
import { t } from '../../lib/i18n'


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
      if (active) setError(err instanceof Error ? err.message : t('无法读取连接状态。', 'Unable to read connection status.'))
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
      setMessage(action === 'status' ? t('本地检查完成。接入文件就绪不代表 Agent 已加载或供应商已验证。', 'Local check complete. Ready connection files do not confirm that the agent has loaded them or that the provider works.') :
        `${action === 'disconnect' ? t('已断开所选连接。', 'Selected connection disconnected.') : t('连接文件已就绪，请重新打开 Agent 会话读取。', 'Connection files are ready. Reopen your agent session to load them.')}${next.result?.backup ? t(`备份位置：${next.result.backup}`, ` Backup location: ${next.result.backup}`) : ''}`)
    } catch (err) {
      console.warn('Agent connection operation failed', err)
      setError(err instanceof Error ? err.message : t('连接操作未完成，请重试。', 'Connection could not be completed. Please try again.'))
    } finally { setBusy(false) }
  }

  const command = status ? '& ' + status.manual_command.map((part) => `'${part.replace(/'/g, "''")}'`).join(' ') + ' agent-guide' : ''

  return <section className="space-y-4" aria-label={t('Agent 连接', 'Agent connections')} aria-busy={busy}>
    <div>
      <h4 className="font-semibold">{t('连接外部 Agent', 'Connect external agents')}</h4>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('连接后，Codex、Claude Code、Cursor 或 DeepSeek Harness 可按你的请求调用本工具生成和编辑图片。关闭桌面窗口后仍可使用。', 'Once connected, Codex, Claude Code, Cursor, or DeepSeek Harness can use this tool to generate and edit images at your request, even after you close the desktop window.')}</p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('连接操作立即生效。API 配置仍需在 API 配置页保存；连接不会改变 Agent 的全局生图偏好。', 'Connection changes take effect immediately. Save API changes on the API profiles page. Connecting does not change the agent\'s global image generation preferences.')}</p>
    </div>
    {!desktop ? <div className="rounded-xl border p-4 text-sm">
      <p>{t('请打开 run-app.cmd，在桌面窗口选择要连接的 Agent。', 'Open run-app.cmd and select the agent to connect in the desktop window.')}</p>
      <p className="mt-2">{t('也可从项目目录运行以下命令，使用指南中的完整路径从其他目录调用：', 'You can also run these commands from the project folder. Use the full paths from the guide when calling from another folder:')}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-white/5">{'.\\chat-to-image.cmd agent-guide\n.\\chat-to-image.cmd agents status\n.\\chat-to-image.cmd agents connect --target codex'}</pre>
    </div> : <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" disabled={busy} onClick={() => void run('status')} className="rounded-lg border px-3 py-2 disabled:opacity-50">{busy ? t('处理中…', 'Working…') : t('检查连接', 'Check connections')}</button>
        {status && <span>{status.runtime_ready ? t('CLI 本地运行检查通过', 'Local CLI runtime check passed') : t('CLI 运行环境待修复', 'CLI runtime needs repair')}</span>}
      </div>
      {status?.targets.map((row) => <div key={row.id} className="rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <strong className="text-sm">{row.label}</strong>
          <div className="flex gap-2">
            {row.status === 'missing' && <button type="button" disabled={busy || !status.runtime_ready} onClick={() => void run('connect', row.id)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{t('连接', 'Connect')} {row.label}</button>}
            {(row.status === 'connected' || row.status === 'stale') && <>
              <button type="button" disabled={busy || !status.runtime_ready} onClick={() => void run('update', row.id)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">{t('更新', 'Update')} {row.label}</button>
              <button type="button" disabled={busy} onClick={() => void run('disconnect', row.id)} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">{t('断开', 'Disconnect')} {row.label}</button>
            </>}
          </div>
        </div>
        <p className="mt-2 text-sm">{row.message}</p>
        <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{row.path || t('目录无法定位', 'Folder could not be located')}</p>
      </div>)}
      {command && <details className="rounded-xl border p-4 text-sm">
        <summary className="cursor-pointer">{t('手动调用命令', 'Manual command')}</summary>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('按当前电脑的项目位置自动生成。启动脚本自动寻找 Python 并读取当前项目配置；换电脑或移动项目后重新打开此页，复制新命令。', 'Generated from this computer\'s project location. The launcher finds Python and reads this project\'s configuration. Reopen this page and copy the new command after moving the project or changing computers.')}</p>
        <pre className="mt-3 whitespace-pre-wrap break-all rounded-lg bg-gray-100 p-3 text-xs dark:bg-white/5">{command}</pre>
        <button type="button" className="mt-3 rounded-lg border px-3 py-2 text-xs" onClick={() => void navigator.clipboard.writeText(command).then(() => setMessage(t('命令已复制。', 'Command copied.'))).catch(() => setError(t('无法访问剪贴板，请手动选择命令复制。', 'Clipboard access failed. Select and copy the command manually.')))}>{t('复制调用命令', 'Copy command')}</button>
      </details>}
    </>}
    {error && <p role="alert" className="break-all text-sm text-red-600 dark:text-red-400">{error}</p>}
    {message && <p role="status" className="break-all text-sm">{message}</p>}
  </section>
}
