// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { readBackupReceipt, recordBackupReceipt } from './backupStatus'
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('records scope and parts only when requested, and ignores malformed local data', () => {
  expect(readBackupReceipt()).toBeNull()
  const receipt = { requestedAt: 123, parts: 2, config: false, works: true }
  expect(recordBackupReceipt(receipt)).toBe(true)
  expect(readBackupReceipt()).toEqual(receipt)
  localStorage.setItem('chat-to-image-last-export', '{bad')
  expect(readBackupReceipt()).toBeNull()
})
it('does not turn a metadata storage failure into a failed export', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  expect(recordBackupReceipt({ requestedAt: 123, parts: 1, config: true, works: false })).toBe(false)
})
