export interface BackupReceipt { requestedAt: number; parts: number; config: boolean; works: boolean }
const KEY = 'chat-to-image-last-export'

export function readBackupReceipt(): BackupReceipt | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return value && Number.isFinite(value.requestedAt) && value.requestedAt > 0 && Number.isInteger(value.parts) && value.parts > 0 && typeof value.config === 'boolean' && typeof value.works === 'boolean' ? value : null
  } catch { return null }
}

export function recordBackupReceipt(receipt: BackupReceipt) {
  try { localStorage.setItem(KEY, JSON.stringify(receipt)); window.dispatchEvent(new Event('playground-backup-requested')); return true }
  catch { return false }
}
