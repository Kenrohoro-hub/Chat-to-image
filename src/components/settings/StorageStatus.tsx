import { useEffect, useState } from 'react'
import { isDesktop, isLocalService } from '../../lib/desktop'
import { readBackupReceipt } from '../../lib/backupStatus'
import { getUiLanguage, t } from '../../lib/i18n'

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
  return <section className="rounded-xl border border-gray-200 p-4 dark:border-white/10 space-y-2 text-xs" aria-label={t('存储与备份状态', 'Storage and backup status')}>
    <h4 className="font-bold">{t('存储与备份状态', 'Storage and backup status')}</h4>
    <p>{t('当前入口：', 'Current entry point: ')}{isDesktop() ? t('Windows 桌面', 'Windows desktop') : isLocalService() ? t('本机浏览器', 'Local browser') : t('独立网页', 'Standalone web page')}{t('。作品和对话属于当前入口的本机存储，桌面与不同浏览器不共享历史。提示词库可在下方另选保存位置。', '. Images and conversations are stored locally for this entry point. The desktop app and different browsers have separate histories. Choose a separate prompt library location below.')}</p>
    <p>{isLocalService() ? t('共享配置：项目 user-config 文件夹，密钥绑定 Windows 账户。', 'Shared configuration: the project\'s user-config folder. Keys are tied to your Windows account.') : t('配置：当前浏览器站点存储。', 'Configuration: this browser\'s site storage.')}{t('CLI 图片位于调用结果所示的本机输出目录，不在此处历史中。', ' CLI images are saved in the local output folder shown in the command result and are not part of this history.')}</p>
    <p role="status">{t('站点占用估算：', 'Estimated site storage: ')}{loading ? t('正在读取…', 'Reading…') : estimate?.usage != null ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB${estimate.quota != null ? t(` / 站点配额 ${(estimate.quota / 1024 / 1024).toFixed(0)} MB`, ` / site quota ${(estimate.quota / 1024 / 1024).toFixed(0)} MB`) : t(' / 配额未知', ' / quota unknown')}` : t('当前环境无法获取', 'Unavailable in this environment')}{t('。这是整个站点的估算，可能包括缓存；不包含项目配置文件、CLI 图片和自定义目录中的提示词数据。', '. This estimate covers the whole site and may include caches. It excludes project configuration, CLI images, and prompts in custom folders.')}</p>
    <button type="button" disabled={loading} className="underline" onClick={() => { setReceipt(readBackupReceipt()); setRefresh((value) => value + 1) }}>{t('刷新存储信息', 'Refresh storage information')}</button>
    <p>{t('最近完整发起导出：', 'Last complete export requested: ')}{receipt ? t(`${new Date(receipt.requestedAt).toLocaleString(getUiLanguage())}，${receipt.parts} 个 ZIP；包含`, `${new Date(receipt.requestedAt).toLocaleString(getUiLanguage())}, ${receipt.parts} ZIP files; includes `) + [receipt.config && t('配置', 'configuration'), receipt.works && t('作品、对话与提示词', 'images, conversations, and prompts')].filter(Boolean).join(t('、', ', ')) : t('本入口暂无记录（旧版本导出未记录）', 'No record for this entry point (older exports were not recorded)')}{t('。', '.')}</p>
    <p>{t('只有全部分片生成并请求下载后才记录。请在下载目录核对文件，浏览器无法确认最终落盘；此记录随站点数据清理而消失。', 'Recorded only after all parts are generated and download requests are sent. Check files in your downloads folder; the browser cannot confirm they were saved. Clearing site data also clears this record.')}</p>
  </section>
}
