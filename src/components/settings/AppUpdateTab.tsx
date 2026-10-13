import { useEffect, useRef, useState } from 'react'
import { desktopApi, flushDesktopSettings, isDesktop, isLocalService, type AppUpdateState } from '../../lib/desktop'
import { t } from '../../lib/i18n'
import { hasActiveDataOperations } from '../../lib/dataOperations'
import { isEmptyAgentInputDraft } from '../../lib/inputDraftState'
import { flushAgentConversationsToIndexedDB } from '../../lib/agentConversationPersistence'
import { useStore } from '../../store'

const RELEASE_URL = 'https://github.com/Kenrohoro-hub/Chat-to-image/releases/latest'

export default function AppUpdateTab({ hasUnsavedChanges, busy }: { hasUnsavedChanges: boolean; busy: boolean }) {
  const [status, setStatus] = useState<AppUpdateState | null>(null)
  const [workingAction, setWorkingAction] = useState<'check' | 'download' | null>(null)
  const working = workingAction !== null
  const [error, setError] = useState('')
  const [guardMessage, setGuardMessage] = useState('')
  const local = isLocalService()
  const desktop = isDesktop()
  const hasRunningOperations = useStore((s) => hasActiveDataOperations(s.tasks, s.agentConversations))
  const hasUnrestoredDraft = useStore((s) => !s.settings.persistInputOnRestart && (Boolean(s.prompt || s.inputImages.length || s.maskDraft || s.maskEditorImageId || (s.galleryInputDraft && !isEmptyAgentInputDraft(s.galleryInputDraft)) || Object.values(s.agentInputDrafts).some((item) => !isEmptyAgentInputDraft(item)))))
  const busyRef = useRef(busy)
  const unsavedRef = useRef(hasUnsavedChanges)
  const mountedRef = useRef(false)
  busyRef.current = busy
  unsavedRef.current = hasUnsavedChanges

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!local) return
    let active = true
    void desktopApi().then((api) => api.app_update('status')).then((value) => {
      if (active) setStatus(value)
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : t('无法读取更新状态。', 'Unable to read update status.'))
    })
    return () => { active = false }
  }, [local])

  useEffect(() => {
    if (status?.status !== 'checking' && status?.status !== 'downloading') return
    let active = true
    let nextStatus: AppUpdateState['status'] = status.status
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await (await desktopApi()).app_update('status')
        if (!active) return
        nextStatus = next.status
        setStatus(next)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : t('无法读取更新进度。', 'Unable to read update progress.'))
      } finally {
        if (active && (nextStatus === 'checking' || nextStatus === 'downloading')) timer = window.setTimeout(poll, 1000)
      }
    }
    timer = window.setTimeout(poll, 1000)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [status?.status])

  const run = async (action: 'check' | 'download') => {
    if (working) return
    setWorkingAction(action)
    setError('')
    setGuardMessage('')
    if (action === 'check') setStatus((current) => ({ ...(current ?? { currentVersion: __APP_VERSION__, latestVersion: null, releaseUrl: RELEASE_URL, notes: '', available: false, canInstall: false, downloaded: 0, total: 0, error: '' }), status: 'checking', error: '' }))
    try {
      const next = await (await desktopApi()).app_update(action)
      if (mountedRef.current) {
        setStatus(next)
        if (next.status === 'error') setError(next.error || t('更新操作失败，请重试。', 'Update failed. Try again.'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('更新操作失败，请重试。', 'Update failed. Try again.')
      if (mountedRef.current) {
        setError(message)
        if (action === 'check') setStatus((current) => ({ ...(current ?? { currentVersion: __APP_VERSION__, latestVersion: null, releaseUrl: RELEASE_URL, notes: '', available: false, canInstall: false, downloaded: 0, total: 0, error: '' }), status: 'error', error: message }))
      }
    } finally {
      if (mountedRef.current) setWorkingAction(null)
    }
  }

  const getInstallGuard = () => {
    if (busyRef.current) return t('正在保存或导入、导出数据，请完成后再安装更新。', 'Settings are saving or data is being imported or exported. Finish first, then install the update.')
    if (unsavedRef.current) return t('设置中有未保存的更改，请先保存或取消更改再安装更新。', 'Settings have unsaved changes. Save or discard them before installing the update.')
    const state = useStore.getState()
    if (hasActiveDataOperations(state.tasks, state.agentConversations)) return t('生图或对话仍在运行，请完成或停止任务后再安装更新。', 'Image generation or chat is still running. Finish or stop it before installing the update.')
    if (!state.settings.persistInputOnRestart && (state.prompt || state.inputImages.length || state.maskDraft || state.maskEditorImageId || (state.galleryInputDraft && !isEmptyAgentInputDraft(state.galleryInputDraft)) || Object.values(state.agentInputDrafts).some((item) => !isEmptyAgentInputDraft(item)))) {
      return t('当前已关闭重启后恢复输入。请先保存或清空输入草稿，或开启“重启后恢复输入框”，再安装更新。', 'Input restoration is off. Save or clear input drafts, or enable Restore input after restarting before installing the update.')
    }
    return ''
  }

  const install = () => {
    if (!desktop || status?.status !== 'ready' || !status.canInstall) return
    const blocked = getInstallGuard()
    if (blocked) { setGuardMessage(blocked); return }
    setGuardMessage('')
    useStore.getState().setConfirmDialog({
      title: t('退出并安装更新', 'Exit and install update'),
      message: t('安装会沿用当前安装目录并关闭桌面应用。请保存配置草稿，并先关闭其他本机网页或 CLI 任务；此检查只能确认桌面应用自身没有生图任务。确认后将启动安装程序。', 'The update will use the current installation folder and close the desktop app. Save settings drafts and close other local web or CLI tasks first; this check can only verify image generation in the desktop app itself. The installer will start after confirmation.'),
      confirmText: t('退出并安装', 'Exit and install'),
      awaitAction: true,
      action: async () => {
        const before = getInstallGuard()
        if (before) {
          if (mountedRef.current) setGuardMessage(before)
          useStore.getState().showToast(before, 'error')
          return true
        }
        try {
          await flushDesktopSettings()
          if (!await flushAgentConversationsToIndexedDB()) throw new Error(useStore.getState().agentConversationSaveError || t('对话尚未保存，请重试后再安装。', 'Conversations have not been saved. Try again before installing.'))
          const after = getInstallGuard()
          if (after) {
            if (mountedRef.current) setGuardMessage(after)
            useStore.getState().showToast(after, 'error')
            return true
          }
          const next = await (await desktopApi()).app_update('install')
          if (mountedRef.current) setStatus(next)
          if (next.status === 'error') throw new Error(next.error || t('安装未能启动，请重试。', 'The installer could not start. Try again.'))
          return true
        } catch (err) {
          const message = err instanceof Error ? err.message : t('安装未能启动，请重试。', 'The installer could not start. Try again.')
          if (mountedRef.current) setError(message)
          useStore.getState().showToast(message, 'error')
          return true
        }
      },
    })
  }

  const releaseUrl = status?.releaseUrl || RELEASE_URL
  const downloading = status?.status === 'downloading'
  const checking = status?.status === 'checking'
  const progress = status?.total ? Math.min(100, Math.round(status.downloaded * 100 / status.total)) : 0

  return <section className="space-y-4" aria-label={t('检查更新', 'Check for updates')} aria-busy={working || checking || downloading}>
    <div>
      <h4 className="font-semibold">{t('应用更新', 'App updates')}</h4>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('更新检查与配置保存相互独立。升级前请保存配置草稿；下载完成后需确认退出并安装。', 'Update checks are separate from settings. Save settings drafts before upgrading. After download, confirm before exiting and installing.')}</p>
    </div>
    {!local ? <div className="space-y-2 rounded-xl border p-4 text-sm">
      <p>{t(`当前版本：v${__APP_VERSION__}`, `Current version: v${__APP_VERSION__}`)}</p>
      <a className="text-blue-600 underline dark:text-blue-400" href={RELEASE_URL} target="_blank" rel="noreferrer">{t('查看 GitHub 发布页', 'View GitHub releases')}</a>
    </div> : <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{t(`当前版本：v${status?.currentVersion || __APP_VERSION__}`, `Current version: v${status?.currentVersion || __APP_VERSION__}`)}</span>
        <button type="button" disabled={working || checking || downloading} onClick={() => void run('check')} className="rounded-lg border px-3 py-2 disabled:opacity-50">{checking || workingAction === 'check' ? t('检查中…', 'Checking…') : t('检查更新', 'Check for updates')}</button>
      </div>
      {status?.status === 'current' && <p role="status" className="text-sm text-green-700 dark:text-green-400">{t('当前已是最新版本。', 'You are using the latest version.')}</p>}
      {status?.status === 'available' && <div className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-white/10">
        <p className="font-medium">{t(`发现新版本 v${status.latestVersion}`, `Version ${status.latestVersion} is available`)}</p>
        {status.notes && <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{status.notes}</p>}
        {desktop && status.canInstall && status.total > 0 && <button type="button" disabled={working || checking || downloading} onClick={() => void run('download')} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{t('下载更新', 'Download update')}</button>}
        {!desktop && <p className="text-sm text-gray-500">{t('本机网页可检查更新；请在桌面应用中下载并安装。', 'The local web page can check for updates. Download and install from the desktop app.')}</p>}
        {desktop && !status.canInstall && <p className="text-sm text-gray-500">{t('当前运行的是源码版本，请更新源码并重新构建，或到发布页下载安装版。', 'This is a source build. Update the source and rebuild, or download the installer from the release page.')}</p>}
        {desktop && status.canInstall && !status.total && <p className="text-sm text-gray-500">{status.error || t('当前版本没有可用的桌面安装包，请从发布页查看。', 'No desktop installer is available for this version. See the release page.')}</p>}
      </div>}
      {downloading && <div className="space-y-2" role="status">
        <p className="text-sm">{t(`正在下载更新… ${progress}%`, `Downloading update… ${progress}%`)}</p>
        <progress className="w-full" value={status.downloaded} max={status.total || undefined} />
      </div>}
      {status?.status === 'ready' && <div className="space-y-3 rounded-xl border border-green-200 p-4 dark:border-green-400/20">
        <p className="text-sm text-green-700 dark:text-green-400">{t(`v${status.latestVersion} 已下载完成。`, `v${status.latestVersion} has downloaded.`)}</p>
        <button type="button" disabled={!desktop || !status.canInstall || working || busy || hasUnsavedChanges} onClick={install} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{t('退出并安装', 'Exit and install')}</button>
      </div>}
      {status?.status === 'error' && status.available && desktop && status.canInstall && status.total > 0 && <button type="button" disabled={working || downloading} onClick={() => void run('download')} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t('重新下载', 'Retry download')}</button>}
      {status?.status === 'installing' && <p role="status" className="text-sm">{t('正在启动安装程序…', 'Starting the installer…')}</p>}
      <a className="text-sm text-blue-600 underline dark:text-blue-400" href={releaseUrl} target="_blank" rel="noreferrer">{t('查看发布页', 'View release page')}</a>
    </>}
    {(guardMessage || error || status?.status === 'error' && status.error) && <p role="alert" className="break-all text-sm text-red-600 dark:text-red-400">{guardMessage || error || status?.error}</p>}
    {status?.status === 'ready' && (busy || hasUnsavedChanges || hasRunningOperations || hasUnrestoredDraft) && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{getInstallGuard()}</p>}
  </section>
}
