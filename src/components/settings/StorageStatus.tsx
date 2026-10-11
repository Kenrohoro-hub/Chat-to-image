import { useEffect, useState } from 'react'
import { isDesktop, isLocalService } from '../../lib/desktop'
import { readBackupReceipt } from '../../lib/backupStatus'

export default function StorageStatus() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [receipt, setReceipt] = useState(readBackupReceipt)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try { const value = await navigator.storage?.estimate?.(); if (alive) setEstimate(value ?? null) }
      catch { if (alive) setEstimate(null) }
      finally { if (alive) setLoading(false) }
    })()
    const update = () => setReceipt(readBackupReceipt())
    window.addEventListener('playground-backup-requested', update)
    return () => { alive = false; window.removeEventListener('playground-backup-requested', update) }
  }, [refresh])
  return <section className="rounded-xl border border-gray-200 p-4 dark:border-white/10 space-y-2 text-xs" aria-label="存储与备份状态">
    <h4 className="font-bold">存储与备份状态</h4>
    <p>当前入口：{isDesktop() ? 'Windows 桌面' : isLocalService() ? '本机浏览器' : '独立网页'}。作品和对话属于当前入口的本机存储，桌面与不同浏览器不共享历史。提示词库可在下方另选保存位置。</p>
    <p>{isLocalService() ? '共享配置：项目 user-config 文件夹，密钥绑定 Windows 账户。' : '配置：当前浏览器站点存储。'}CLI 图片位于调用结果所示的本机输出目录，不在此处历史中。</p>
    <p role="status">站点占用估算：{loading ? '正在读取…' : estimate?.usage != null ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB${estimate.quota != null ? ` / 站点配额 ${(estimate.quota / 1024 / 1024).toFixed(0)} MB` : ' / 配额未知'}` : '当前环境无法获取'}。这是整个站点的估算，可能包括缓存；不包含项目配置文件、CLI 图片和自定义目录中的提示词数据。</p>
    <button type="button" disabled={loading} className="underline" onClick={() => { setReceipt(readBackupReceipt()); setRefresh((value) => value + 1) }}>刷新存储信息</button>
    <p>最近完整发起导出：{receipt ? `${new Date(receipt.requestedAt).toLocaleString()}，${receipt.parts} 个 ZIP；包含${[receipt.config && '配置', receipt.works && '作品、对话与提示词'].filter(Boolean).join('、')}` : '本入口暂无记录（旧版本导出未记录）'}。</p>
    <p>只有全部分片生成并请求下载后才记录。请在下载目录核对文件，浏览器无法确认最终落盘；此记录随站点数据清理而消失。</p>
  </section>
}
