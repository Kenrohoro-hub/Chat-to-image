import { useRef, useState } from 'react'
import { useStore, exportData, importData, clearData } from '../../store'
import { hasActiveDataOperations } from '../../lib/dataOperations'
import { isPresetConfigOnlyEnabled } from '../../lib/presetConfig'
import { Checkbox } from '../Checkbox'
import { TrashIcon, ExportIcon, ImportIcon } from '../icons'
import StorageStatus from './StorageStatus'
import PromptStorageSettings from './PromptStorageSettings'

export default function DataManagementTab({ isExportingData, isImportingData, setIsExportingData, setIsImportingData, onSettingsChanged }: {
  isExportingData: boolean
  isImportingData: boolean
  setIsExportingData: (value: boolean) => void
  setIsImportingData: (value: boolean) => void
  onSettingsChanged: () => void
}) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const hasRunningOperations = useStore((state) => hasActiveDataOperations(state.tasks, state.agentConversations))
  const presetConfigOnly = isPresetConfigOnlyEnabled()
  const [exportConfig, setExportConfig] = useState(true)
  const [exportTasks, setExportTasks] = useState(true)
  const [importConfig, setImportConfig] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
  const [clearConfig, setClearConfig] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const handleExport = async () => {
    if (exportTasks && hasRunningOperations) {
      showToast('当前有任务正在进行，请完成或停止后再导出', 'error')
      return
    }
    setIsExportingData(true)
    try {
      await exportData({ exportConfig, exportTasks })
    } finally {
      setIsExportingData(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) {
      if (importTasks && hasRunningOperations) {
        showToast('当前有任务正在进行，请完成或停止后再导入', 'error')
        e.target.value = ''
        return
      }
      setIsImportingData(true)
      try {
        const imported = await importData(files, { importConfig: presetConfigOnly ? false : importConfig, importTasks })
        if (imported) {
          onSettingsChanged()
        }
      } finally {
        setIsImportingData(false)
      }
    }
    e.target.value = ''
  }

  const handleClearAllData = async () => {
    await clearData({ clearConfig, clearTasks })
    onSettingsChanged()
  }


  return <div className="space-y-4">
    <StorageStatus />
    <PromptStorageSettings />

    <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ExportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">受浏览器文件大小限制，过大的备份将自动分片导出，请允许浏览器下载多个文件</p>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Checkbox
          checked={exportConfig}
          onChange={setExportConfig}
          label="包含配置"
        />
        <Checkbox
          checked={exportTasks}
          onChange={setExportTasks}
          label="包含作品、对话和个人提示词"
        />
      </div>
      <button
        onClick={handleExport}
        disabled={(!exportConfig && !exportTasks) || isExportingData}
        className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
      >
        {isExportingData ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            导出中...
          </>
        ) : (
          '导出所选数据'
        )}
      </button>
    </div>

    <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">支持一次导入多个普通备份；分片备份请一次性选中同一批次的全部分片</p>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {!presetConfigOnly && <Checkbox
          checked={importConfig}
          onChange={setImportConfig}
          label="包含配置"
        />}
        <Checkbox
          checked={importTasks}
          onChange={setImportTasks}
          label="包含作品、对话和个人提示词"
        />
      </div>
      <button
        onClick={() => importInputRef.current?.click()}
        disabled={(!(presetConfigOnly ? false : importConfig) && !importTasks) || isImportingData}
        className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
      >
        {isImportingData ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            导入中...
          </>
        ) : (
          '从 ZIP 导入所选数据'
        )}
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        multiple
        className="hidden"
        onChange={handleImport}
      />
    </div>

    <div className="rounded-2xl border border-red-100/50 bg-red-50/30 p-4 dark:border-red-500/10 dark:bg-red-500/5 space-y-4 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <TrashIcon className="w-4 h-4 text-red-500/90 dark:text-red-400" />
        <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Checkbox
          checked={clearConfig}
          onChange={setClearConfig}
          label="包含配置"
          tone="danger"
        />
        <Checkbox
          checked={clearTasks}
          onChange={setClearTasks}
          label="包含作品、对话和个人提示词"
          tone="danger"
        />
      </div>
      <button
        onClick={() =>
          setConfirmDialog({
            title: '清空所选数据',
            message: `确定要清空所选的数据吗？此操作不可恢复。`,
            action: () => handleClearAllData(),
          })
        }
        disabled={!clearConfig && !clearTasks}
        className="w-full rounded-xl bg-red-100/80 px-4 py-2.5 text-sm font-medium text-red-600 transition-all hover:bg-red-200 hover:text-red-700 disabled:opacity-50 disabled:hover:bg-red-100/80 disabled:hover:text-red-600 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 dark:hover:text-red-300 dark:disabled:hover:bg-red-500/10 dark:disabled:hover:text-red-400"
      >
        清空所选数据
      </button>
    </div>
  </div>
}
