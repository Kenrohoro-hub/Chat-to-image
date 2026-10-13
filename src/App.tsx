import { t } from './lib/i18n'
import WelcomeModal from './components/WelcomeModal'
import { loadPersonalPromptStorage, updatePromptStorage } from './lib/promptStorage'
import { useEffect, useState } from 'react'
import WorkspaceSidebar from './components/WorkspaceSidebar'
import PromptWorkspace from './components/gallery/PromptWorkspace'
import { allowDesktopSave, desktopApi, isLocalService, saveDesktopSettings } from './lib/desktop'
import type { SettingsSnapshot } from './lib/desktop'
import { initStore, restoreExplicitPresetConfig, useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, getExplicitUrlSettingsIds, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, hasDefaultPresetConfig, isAgentTextApiProfile, normalizeSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, hasEmbeddedDefaultConfig, loadCustomProviderSettingsFromUrl, loadEmbeddedDefaultConfig } from './lib/customProviderConfigUrl'
import { getDefaultPresetProfileId, getPresetProfileIds, isPresetConfigOnlyEnabled, setPresetConfig } from './lib/presetConfig'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import CreationWorkspace from './components/CreationWorkspace'
import InputBar from './components/InputBar'
import { seedExampleTasks } from './lib/exampleTasks'
import { DEFAULT_FAVORITE_COLLECTION_ID } from './lib/favoriteState'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'

let defaultConfigImportStarted = false

export default function App() {
  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem('chat-to-image-hide-welcome') !== '1')
  const [view, setView] = useState<'new' | 'history' | 'prompts'>('new')
  const [savePromptDraft, setSavePromptDraft] = useState(false)
  const [desktopError, setDesktopError] = useState('')
  const [failedSnapshot, setFailedSnapshot] = useState<SettingsSnapshot>()
  const [recovering, setRecovering] = useState(false)
  const [desktopReady, setDesktopReady] = useState(!isLocalService())
  const settings = useStore((s) => s.settings)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme !== 'light' && media.matches))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const showComposer = view !== 'prompts' && (appMode === 'agent' || (view === 'new' && !filterFavorite))
  const creation = showComposer
  useEffect(() => {
    const compose = () => {
      const state = useStore.getState()
      if (state.appMode !== 'agent') {
        state.setAppMode('agent')
      }
      state.setFilterFavorite(false)
      setView('new')
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-input-bar] [contenteditable="true"]')?.focus())
    }
    window.addEventListener('playground-compose', compose)
    return () => window.removeEventListener('playground-compose', compose)
  }, [])
  useEffect(() => {
    const open = (event: Event) => { setSavePromptDraft((event as CustomEvent).detail?.saveCurrent === true); setView('prompts') }
    window.addEventListener('playground-prompts', open)
    return () => window.removeEventListener('playground-prompts', open)
  }, [])
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  useGlobalClickSuppression()

  useEffect(() => {
    if (defaultConfigImportStarted) return
    defaultConfigImportStarted = true

    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const embeddedDefaultConfig = hasEmbeddedDefaultConfig()
    const loadDefaultConfig = () => embeddedDefaultConfig
      ? Promise.resolve().then(() => loadEmbeddedDefaultConfig())
      : loadCustomProviderSettingsFromUrl(customProviderConfigUrl)

    const applyUrlSettings = async (baseSettings: Partial<AppSettings>) => {
      const ids = getExplicitUrlSettingsIds(searchParams)
      const restored = await restoreExplicitPresetConfig(ids)
      const restoredSettings = useStore.getState().settings
      const sourceSettings = restored
        ? { ...restoredSettings, ...baseSettings, customProviders: restoredSettings.customProviders, profiles: restoredSettings.profiles }
        : baseSettings
      const nextSettings = buildSettingsFromUrlParams(sourceSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : sourceSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    let snapshot: SettingsSnapshot | undefined
    let initialized = false
    let loadingHistory = false
    const initialize = async () => {
      if (isLocalService()) {
        snapshot = await (await desktopApi()).load_settings()
        if (snapshot.error) {
          setFailedSnapshot(snapshot)
          throw new Error(snapshot.error)
        }
        if (snapshot.settings) useStore.getState().setSettings(snapshot.settings)
      }
      loadingHistory = true
      await initStore()
      try {
        const personal = await loadPersonalPromptStorage()
        if (personal) useStore.setState(personal)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('提示词保存位置加载失败。', 'Could not load the prompt save location.')
        updatePromptStorage({ error: message })
        useStore.getState().showToast(message, 'error')
      }
      initialized = true
      const state = useStore.getState()
      state.setAppMode('agent')
      void seedExampleTasks(state.tasks, state.defaultFavoriteCollectionId ?? state.favoriteCollections[0]?.id ?? DEFAULT_FAVORITE_COLLECTION_ID).then((examples) => {
        if (examples.length) useStore.getState().setTasks([...useStore.getState().tasks, ...examples])
      }).catch((error) => {
        console.warn('Failed to load starter examples:', error)
        useStore.getState().showToast(t('内置示例加载失败，可重新打开工具重试。', 'Could not load the built-in examples. Reopen the app to try again.'), 'info')
      })
    }

    void initialize()
      .then(async () => {
        const importedSettings = embeddedDefaultConfig || customProviderConfigUrl
          ? await loadDefaultConfig()
          : hasDefaultPresetConfig()
            ? {
                customProviders: [],
                profiles: [{ ...createDefaultOpenAIProfile(), isDefault: true }],
              }
            : null
        setPresetConfig(importedSettings)

        const state = useStore.getState()
        if (importedSettings) {
          await state.setPresetImportedSettings(importedSettings)
        } else if (state.previousPresetConfig) {
          await state.setPresetImportedSettings({ customProviders: [], profiles: [] })
        }

        const syncedState = useStore.getState()
        if (!importedSettings) {
          useStore.setState({ dismissedPresetProfileIds: [], dismissedPresetProviderIds: [] })
          if (syncedState.settings.profiles.some((profile) => profile.isDefault)) {
            syncedState.setSettings({
              profiles: syncedState.settings.profiles.map((profile) => profile.isDefault ? { ...profile, isDefault: undefined } : profile),
            })
          }
        }

        const current = useStore.getState()
        const presetIds = getPresetProfileIds()
        const defaultPresetId = getDefaultPresetProfileId()
        const settings = isPresetConfigOnlyEnabled()
          ? normalizeSettings({
              ...current.settings,
              activeProfileId: presetIds.has(current.settings.activeProfileId)
                ? current.settings.activeProfileId
                : defaultPresetId ?? [...presetIds][0],
              agentTextProfileId: current.settings.agentTextProfileId && presetIds.has(current.settings.agentTextProfileId)
                ? current.settings.agentTextProfileId
                : current.settings.profiles.find((profile) => presetIds.has(profile.id) && isAgentTextApiProfile(profile))?.id ?? null,
              agentImageProfileId: current.settings.agentImageProfileId && presetIds.has(current.settings.agentImageProfileId)
                ? current.settings.agentImageProfileId
                : defaultPresetId ?? [...presetIds][0],
            })
          : current.settings
        current.setSettings(await applyUrlSettings(settings))
        clearAppliedUrlSettings()
      })
      .catch(async (error) => {
        if (!initialized) {
          setDesktopReady(false)
          setDesktopError(snapshot?.error || t(`${loadingHistory ? '本机历史' : '共享配置'}加载失败。已停止自动保存和生图，请关闭窗口后重开。`, `Could not load ${loadingHistory ? 'local history' : 'shared settings'}. Automatic saving and generation have stopped. Close and reopen the window.`))
          return
        }
        console.warn('Failed to import preset config:', error)
        setPresetConfig(null)
        const state = useStore.getState()
        await applyUrlSettings(state.settings).then((settings) => {
          useStore.getState().setSettings(settings)
          clearAppliedUrlSettings()
        })
      })
      .then(async () => {
        if (!initialized || !snapshot) return
        try {
          if (snapshot.settings) useStore.getState().setSettings(snapshot.settings)
          allowDesktopSave(snapshot, useStore.getState().settings)
          useStore.subscribe((state, previous) => {
            if (state.settings !== previous.settings) void saveDesktopSettings(state.settings).catch(() => undefined)
          })
          const firstSave = saveDesktopSettings(useStore.getState().settings)
          setDesktopReady(true)
          await firstSave.catch(() => undefined)
        } catch {
          setDesktopError(t('本机设置加载失败。已停止自动保存和生图，请关闭窗口后重开。', 'Could not load local settings. Automatic saving and generation have stopped. Close and reopen the window.'))
        }
      })
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <div className="playground-workspace">
      {!desktopReady && <div role="status" className="fixed inset-0 z-[120] flex items-center justify-center bg-background p-10"><div className="max-w-md text-center"><h2 className="mb-4 text-xl">{desktopError ? t('无法加载设置', 'Unable to load settings') : t('正在打开工作室…', 'Opening the studio…')}</h2><p className="text-sm leading-7 text-gray-500">{desktopError || t('正在读取本机加密设置，请稍候。', 'Reading encrypted local settings. Please wait.')}</p>{failedSnapshot && <><p className="mt-4 text-sm leading-7 text-gray-500">{t('重新配置会保留原加密文件，需要重新填写地址、Key 和模型。历史与作品保持不变。', 'Reconfiguring keeps the original encrypted file. Enter the URL, key and model again. History and artwork are preserved.')}</p><button type="button" disabled={recovering} className="mt-5 rounded-xl bg-primary px-5 py-3 text-white disabled:opacity-50" onClick={async () => {
        setRecovering(true)
        try {
          const result = await (await desktopApi()).recover_settings(failedSnapshot.revision)
          if (!result.ok) throw new Error('recovery failed')
          window.location.reload()
        } catch {
          setDesktopError(t('重新配置未完成，原配置已保留。请重新打开工具后再试。', 'Reconfiguration did not finish. Your original settings are preserved. Reopen the app and try again.'))
          setRecovering(false)
        }
      }}>{recovering ? t('正在保留旧配置…', 'Preserving old settings…') : t('保留旧配置并重新配置', 'Keep old settings and reconfigure')}</button></>}</div></div>}
      <WorkspaceSidebar view={view} onNavigate={(next) => { setSavePromptDraft(false); setView(next) }} />
      <div className="workspace-content" data-workspace-mode={appMode} data-creation-workspace={creation}>
      {view !== 'prompts' && <Header />}
      {desktopError && <div role="alert" className="mx-6 mt-4 rounded-xl border border-red-300 p-4 text-red-600">{desktopError}</div>}
      {view === 'prompts' ? <PromptWorkspace startWithDraft={savePromptDraft} /> : creation ? (
        <CreationWorkspace onAllHistory={() => { useStore.getState().setAppMode('gallery'); useStore.getState().setFilterFavorite(false); setView('history') }} />
      ) : (
        <main data-home-main data-composer-visible={showComposer} data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      {view !== 'prompts' && !creation && <InputBar showComposer={false} />}
      </div>
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      {desktopReady && !desktopError && showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      <ConfirmDialog />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </div>
  )
}
