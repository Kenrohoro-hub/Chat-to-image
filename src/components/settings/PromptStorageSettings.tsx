import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../../store'
import { desktopApi, isDesktop, isLocalService } from '../../lib/desktop'
import { getPromptStorageStatus, subscribePromptStorage, initPromptStorage } from '../../lib/promptStorage'
import { changePromptDirectory } from '../../lib/promptStorageMigration'
import { t } from '../../lib/i18n'

export default function PromptStorageSettings() {
  const state = useSyncExternalStore(subscribePromptStorage, getPromptStorageStatus)
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [cleanPrevious, setCleanPrevious] = useState(false)
  useEffect(() => { void initPromptStorage().catch((err) => setError(err instanceof Error ? err.message : t('无法读取保存位置。', 'Unable to read the storage location.'))) }, [])
  const choose = async () => {
    setChoosing(true)
    setError('')
    try { const path = await (await desktopApi()).choose_prompt_directory(); if (path) setDirectory(path) }
    catch (err) { setError(err instanceof Error ? err.message : t('无法选择目录。', 'Unable to choose a folder.')) }
    finally { setChoosing(false) }
  }
  const change = async () => {
    setError('')
    try { await changePromptDirectory(directory.trim(), cleanPrevious && !!state.directory); setDirectory(''); setCleanPrevious(false) }
    catch (err) { setError(err instanceof Error ? err.message : t('复制未完成，原位置保留。', 'Copy did not complete. The original location was kept.')) }
  }
  return <section className="rounded-xl border border-gray-200 p-4 dark:border-white/10 space-y-3 text-xs" aria-label={t('提示词库保存位置', 'Prompt library storage location')} aria-busy={state.busy}>
    <h4 className="text-sm font-bold">{t('提示词库保存位置', 'Prompt library storage location')}</h4>
    <p className="break-all">{t('当前：', 'Current: ')}{state.directory || t('应用内存储（当前入口）', 'In-app storage (this entry point)')}</p>
    <p className="text-gray-500 dark:text-gray-400">{t('包含网络提示词库、个人提示词、收藏和已预载图片。按“词库名称 / 主分类”整理正文与属性文件，分类下保存图片；其他标签保留在属性中。', 'Includes online libraries, personal prompts, favorites, and preloaded images. Text and metadata are organized by library name / main category, with images in each category. Other tags stay in metadata.')}</p>
    {isLocalService() ? <>
      <label className="block space-y-2"><span>{t('选择新的保存位置', 'Choose a new storage location')}</span><input type="text" aria-label={t('提示词库新保存位置', 'New prompt library location')} disabled={state.busy || choosing} value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder={t('填写完整文件夹路径', 'Enter a full folder path')} className="block w-full rounded-lg border border-gray-200 bg-transparent p-2.5 dark:border-white/10" /></label>
      <p className="text-gray-500 dark:text-gray-400">{t('将在所选位置下创建“提示词库”文件夹。先复制已有数据，校验成功后再切换；默认保留旧位置，非空目标不会覆盖。此项点击后立即生效，无需再点“保存配置”。', 'Creates a folder named 提示词库 in the selected location. Existing data is copied and verified before switching. The old location is kept by default; nonempty destinations are not overwritten. This action takes effect immediately without Save configuration.')}</p>
      {state.directory ? <label className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 dark:bg-white/5"><input type="checkbox" className="mt-0.5" checked={cleanPrevious} disabled={state.busy || choosing} onChange={(event) => setCleanPrevious(event.target.checked)} /><span>{t('迁移成功后清理原位置文件', 'Clean up the original location after migration')}<span className="mt-1 block text-gray-500">{t('只清理本软件登记的提示词与图片，优先移入回收站；其他文件保留。未勾选时保留完整副本。', 'Only prompts and images registered by this app are removed, using the Recycle Bin where possible. Other files are kept. Leave unchecked to keep a full copy.')}</span></span></label> : <p className="text-gray-500">{t('首次从应用内存储迁入文件夹时，保留应用内数据；之后更换文件夹可选择清理原位置。', 'The first migration from in-app storage keeps the in-app data. Later folder changes can optionally clean up the previous location.')}</p>}
      <div className="flex flex-wrap gap-2">
        {isDesktop() && <button type="button" disabled={state.busy || choosing} onClick={() => void choose()} className="rounded-lg border px-3 py-2 disabled:opacity-50">{t('选择文件夹', 'Choose folder')}</button>}
        <button type="button" disabled={state.busy || choosing || !directory.trim() || !state.ready || !!state.error} onClick={() => {
          if (!cleanPrevious || !state.directory) { void change(); return }
          useStore.getState().setConfirmDialog({ title: t('迁移并清理原位置', 'Migrate and clean up original location'), message: t(`原位置：${state.directory}\n新位置：${directory.trim()}（其下的“提示词库”文件夹）\n复制校验并切换成功后，清理原位置登记的文件。其他文件保留。`, `Original location: ${state.directory}\nNew location: ${directory.trim()} (the 提示词库 subfolder)\nAfter copying, verifying, and switching successfully, remove registered files from the original location. Other files are kept.`), confirmText: t('复制并清理', 'Copy and clean up'), action: change })
        }} className="rounded-lg bg-gray-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{state.busy ? t('正在复制…', 'Copying…') : t('复制并使用新位置', 'Copy and use new location')}</button>
      </div>
      {state.message && <p role="status">{state.message}</p>}
    </> : <p>{t('请从桌面或本机网页入口设置文件夹保存位置。', 'Use the desktop app or local web page to choose a storage folder.')}</p>}
    {(error || state.error) && <p role="alert" className="break-all text-red-600 dark:text-red-400">{error || state.error}{state.error && t(' 请恢复目录访问后重新打开工具。', ' Restore access to the folder, then reopen the app.')}</p>}
  </section>
}
