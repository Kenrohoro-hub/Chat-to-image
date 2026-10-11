// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exportData, useStore } from '../store'
import { buildExportZip, getExportZipPlan } from './exportZip'
import { readBackupReceipt, recordBackupReceipt } from './backupStatus'
vi.mock('./exportZip', async (load) => ({ ...await load<typeof import('./exportZip')>(), buildExportZip: vi.fn(), getExportZipPlan: vi.fn() }))
const part = { imageIds: [], tasks: [], agentConversations: [], includeBaseData: true }
beforeEach(() => {
  localStorage.clear()
  useStore.setState({ tasks: [], agentConversations: [] })
  vi.mocked(getExportZipPlan).mockReturnValue([part, part])
  vi.mocked(buildExportZip).mockReset().mockResolvedValue({ bytes: new Uint8Array([1]) } as Awaited<ReturnType<typeof buildExportZip>>)
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('records the requested parts after every ZIP is prepared', async () => {
  await exportData({ exportConfig: true, exportTasks: false })
  expect(readBackupReceipt()).toMatchObject({ parts: 2, config: true, works: false })
})
it('retains the previous receipt when a later part fails', async () => {
  const old = { requestedAt: 123, parts: 1, config: false, works: true }
  recordBackupReceipt(old)
  vi.mocked(buildExportZip).mockResolvedValueOnce({ bytes: new Uint8Array([1]) } as Awaited<ReturnType<typeof buildExportZip>>).mockRejectedValueOnce(new Error('test failure'))
  await exportData({ exportConfig: true, exportTasks: false })
  expect(readBackupReceipt()).toEqual(old)
})
