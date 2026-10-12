import DataManagementTab from './settings/DataManagementTab'
import FeatureIntroTab from './settings/FeatureIntroTab'
import { normalizeWorkspaceSettings } from '../lib/workspaceSettings'
import ApiProfileList from './ApiProfileList'
import ModelSettings from './settings/ModelSettings'
import ApiDiagnostics from './settings/ApiDiagnostics'
import { fetchModelCatalog } from '../lib/modelCatalog'
import { getSettingsRevision, isLocalService, saveDesktopSettings } from '../lib/desktop'
import { useEffect, useRef, useState, useCallback } from 'react'
import { normalizeBaseUrl } from '../lib/api'
import { customProviderSupportsNativeTransparentBackground } from '../lib/customProviderCapabilities'
import { isApiProxyAvailable, isApiProxyLocked, readClientDevProxyConfig } from '../lib/devProxy'
import { useStore, type SettingsTab } from '../store'
import {
  getApiProfileLimitError,
  MAX_API_PROFILES,
  createDefaultOpenAIProfile,
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  getActiveApiProfile,
  getCustomProviderDefinition,
  getDefaultApiProfileId,
  isOpenAICompatibleProvider,
  normalizeAgentMaxToolRounds,
  normalizeSettings,
  normalizeStreamPartialImages,
} from '../lib/apiProfiles'
import {
  getDefaultPresetBaseUrl,
  getDefaultPresetProfileId,
  getPresetProfileDescription,
  getPresetProfileIds,
  isPresetConfigDeletionPrevented,
  isPresetConfigOnlyEnabled,
  isPresetProfileLocked,
} from '../lib/presetConfig'
import { requestBrowserNotificationPermission, type BrowserNotificationPermissionResult } from '../lib/browserNotification'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_STREAM_PARTIAL_IMAGES, type ApiProfile, type AppSettings, type CustomProviderDefinition, type ZipDownloadRoute } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import Select from './Select'
import ViewportTooltip from './ViewportTooltip'
import { CloseIcon } from './icons'
import { TooltipButton } from './TooltipButton'
import GeneralSettingsTab from './settings/GeneralSettingsTab'
import AgentConnectionsTab from './settings/AgentConnectionsTab'
import AgentPreferences from './settings/AgentPreferences'
import ZipDownloadRouteModal, { ZIP_DOWNLOAD_ROUTE_OPTIONS } from './settings/ZipDownloadRouteModal'
import MarkdownRenderer from './MarkdownRenderer'
import { getUiLanguagePreference, setUiLanguage, t, type UiLanguagePreference } from '../lib/i18n'
import { hasActiveDataOperations } from '../lib/dataOperations'
import { isEmptyAgentInputDraft } from '../lib/inputDraftState'
import { flushAgentConversationsToIndexedDB } from '../lib/agentConversationPersistence'
import LanguageSettingsTab from './settings/LanguageSettingsTab'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function isAsyncCustomProvider(provider: CustomProviderDefinition | null | undefined) {
  return Boolean(provider?.poll || provider?.submit.taskIdPath || provider?.editSubmit?.taskIdPath)
}

function isProfileApiProxyEligible(settings: AppSettings, profile: ApiProfile) {
  if (!isOpenAICompatibleProvider(settings, profile.provider)) return false
  const customProvider = getCustomProviderDefinition(settings, profile.provider)
  return !isAsyncCustomProvider(customProvider)
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const dismissPresetProfile = useStore((s) => s.dismissPresetProfile)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setReusedTaskApiProfile = useStore((s) => s.setReusedTaskApiProfile)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const dataTransferToastAtRef = useRef(0)

  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const zipDownloadRouteScrollBoundaryRef = useRef<HTMLDivElement>(null)
  
  const [languageDraft, setLanguageDraft] = useState<UiLanguagePreference>(getUiLanguagePreference)
  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [timeoutInput, setTimeoutInput] = useState(String(getActiveApiProfile(settings).timeout))
  const [agentMaxToolRoundsInput, setAgentMaxToolRoundsInput] = useState(String(settings.agentToolCallLimit))
  const [showApiKey, setShowApiKey] = useState(false)
  const [showZipDownloadRouteManager, setShowZipDownloadRouteManager] = useState(false)
  const [activeTab, setActiveTab] = useState<Exclude<SettingsTab, 'agent-api'>>('api')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [apiGroup, setApiGroup] = useState<'gallery' | 'agent'>('gallery')
  const [isExportingData, setIsExportingData] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)

  const apiProxyConfig = readClientDevProxyConfig()
  const apiProxyAvailable = isApiProxyAvailable(apiProxyConfig)
  const apiProxyLocked = isApiProxyLocked(apiProxyConfig)
  const presetConfigOnly = isPresetConfigOnlyEnabled()
  const presetDeletionPrevented = isPresetConfigDeletionPrevented()
  const presetProfileIds = getPresetProfileIds()
  const visibleProfiles = draft.profiles.filter((profile) => profile.provider === 'openai' && profile.apiMode === (apiGroup === 'agent' ? 'responses' : 'images') && (!presetConfigOnly || presetProfileIds.has(profile.id)))
  const selectionField = apiGroup === 'agent' ? 'agentTextProfileId' : 'activeProfileId'
  const defaultProfileId = getDefaultPresetProfileId() ?? getDefaultApiProfileId(draft)
  const activeProfile = visibleProfiles.find((profile) => profile.id === editingProfileId) ?? visibleProfiles[0] ?? createDefaultOpenAIProfile({ id: 'empty-agent', apiMode: 'responses', model: DEFAULT_RESPONSES_MODEL })
  const activePresetDescription = getPresetProfileDescription(activeProfile.id)
  const activeProfileLocked = isPresetProfileLocked(activeProfile.id)
  const activeProviderIsOpenAICompatible = isOpenAICompatibleProvider(draft, activeProfile.provider)
  const activeProviderUsesApiUrl = activeProviderIsOpenAICompatible || activeProfile.provider === 'fal'
  const activeCustomProvider = getCustomProviderDefinition(draft, activeProfile.provider)
  const activeCustomProviderSupportsNativeTransparentBackground = !activeCustomProvider || customProviderSupportsNativeTransparentBackground(activeCustomProvider)
  const activeProfileApiProxyEligible = isProfileApiProxyEligible(draft, activeProfile)
  const activeCustomProviderAsync = isAsyncCustomProvider(activeCustomProvider)
  const apiProxyChecked = activeProfileApiProxyEligible && (apiProxyLocked || activeProfile.apiProxy)
  const apiProxyEnabled = apiProxyAvailable && activeProfileApiProxyEligible && apiProxyChecked
  const getDefaultModelForMode = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL

  const enabledZipDownloadRouteCount = ZIP_DOWNLOAD_ROUTE_OPTIONS
    .filter((option) => draft.zipDownloadRoutes.includes(option.route))
    .length

  const zipDownloadRouteSummary = enabledZipDownloadRouteCount
    ? t(`已开启 ${enabledZipDownloadRouteCount} 项使用压缩包进行批量下载的途径`, `ZIP enabled for ${enabledZipDownloadRouteCount} batch download actions`)
    : t('未开启任何使用压缩包进行批量下载的途径', 'No batch download actions use ZIP')

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const wasSettingsOpenRef = useRef(false)
  const draftRevisionRef = useRef('')

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return

    wasSettingsOpenRef.current = true
    draftRevisionRef.current = getSettingsRevision()
    setLanguageDraft(getUiLanguagePreference())
    setSaveMessage('')
    const normalizedSettings = normalizeSettings(settings)
    const displaySettings = normalizedSettings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId && normalizedSettings.profiles.some((profile) => profile.id === reusedTaskApiProfileId)
      ? normalizeSettings({ ...normalizedSettings, activeProfileId: reusedTaskApiProfileId })
      : normalizedSettings
    const nextDraft = normalizeSettings({
      ...displaySettings,
      profiles: displaySettings.profiles.map((profile) => ({
        ...profile,
        apiProxy: isProfileApiProxyEligible(displaySettings, profile) && apiProxyAvailable
          ? (apiProxyLocked || profile.apiProxy)
          : false,
      })),
    })
    setDraft(nextDraft)
    setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
    setAgentMaxToolRoundsInput(String(nextDraft.agentToolCallLimit))
  }, [apiProxyAvailable, apiProxyLocked, showSettings, settings, reusedTaskApiProfileId])

  useEffect(() => {
    setTimeoutInput(String(activeProfile.timeout))
  }, [activeProfile.id, activeProfile.timeout])

  useEffect(() => {
    if (showSettings && settingsTabRequest) {
      setActiveTab(settingsTabRequest === 'agent-api' ? 'api' : settingsTabRequest)
      if (settingsTabRequest === 'agent-api') setApiGroup('agent')
    }
  }, [settingsTabRequest, showSettings])

  const commitSettings = (nextDraft: AppSettings) => {
    setSaveMessage('')
    const normalizedProfiles = nextDraft.profiles.map((profile) => {
      const nextApiProxy = isProfileApiProxyEligible(nextDraft, profile) && apiProxyAvailable ? (apiProxyLocked || profile.apiProxy) : false
      const shouldKeepEmptyBaseUrl = profile.provider !== 'fal' && nextApiProxy && !profile.baseUrl.trim()
      const emptyBaseUrlFallback = profile.id === defaultProfileId
        ? getDefaultPresetBaseUrl()
        : DEFAULT_SETTINGS.baseUrl
      const normalizedBaseUrl = profile.provider === 'fal'
        ? profile.baseUrl.trim().replace(/\/+$/, '') || (profile.id === defaultProfileId ? '' : DEFAULT_FAL_BASE_URL)
        : shouldKeepEmptyBaseUrl ? '' : normalizeBaseUrl(profile.baseUrl.trim() || emptyBaseUrlFallback)
      const models = profile.models ? [...new Set(profile.models.flatMap((value) => value.split(/[,，]/)).map((value) => value.trim()).filter(Boolean))] : undefined
      const defaultModel = profile.provider === 'fal' ? DEFAULT_FAL_MODEL : getDefaultModelForMode(profile.apiMode)
      return {
        ...profile,
        name: profile.name.trim() || (profile.id === defaultProfileId ? '默认' : '新配置'),
        baseUrl: normalizedBaseUrl,
        models,
        model: models?.length ? (models.includes(profile.model.trim()) ? profile.model.trim() : models[0]) : (profile.model.trim() || defaultModel),
        timeout: Number(profile.timeout) || DEFAULT_SETTINGS.timeout,
        apiProxy: nextApiProxy,
        codexCli: isOpenAICompatibleProvider(nextDraft, profile.provider) ? profile.codexCli : false,
        streamImages: profile.provider === 'openai' ? profile.streamImages : false,
        streamPartialImages: profile.provider === 'openai' ? normalizeStreamPartialImages(profile.streamPartialImages) : DEFAULT_STREAM_PARTIAL_IMAGES,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalizedDraft = normalizeWorkspaceSettings({
      ...nextDraft,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextDraft.activeProfileId)
        ? nextDraft.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
    })
    setDraft(normalizedDraft)
    return normalizedDraft
  }

  const setZipDownloadRouteEnabled = (route: ZipDownloadRoute, enabled: boolean) => {
    const nextRoutes = enabled
      ? Array.from(new Set([...draft.zipDownloadRoutes, route]))
      : draft.zipDownloadRoutes.filter((item) => item !== route)
    commitSettings({ ...draft, zipDownloadRoutes: nextRoutes })
  }

  const getDraftWithActiveProfilePatch = (patch: Partial<ApiProfile>) => ({
      ...draft,
      profiles: draft.profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, ...patch } : profile),
    })

  const updateActiveProfile = (patch: Partial<ApiProfile>, commit = false) => {
    if (activeProfileLocked && (Object.keys(patch).length !== 1 || patch.apiKey === undefined)) return
    const connectionChanged = (patch.baseUrl !== undefined && patch.baseUrl !== activeProfile.baseUrl) || (patch.apiKey !== undefined && patch.apiKey !== activeProfile.apiKey) || (patch.apiProxy !== undefined && patch.apiProxy !== activeProfile.apiProxy)
    const nextDraft = getDraftWithActiveProfilePatch({ ...patch, ...(connectionChanged && activeProfile.modelCatalog ? { modelCatalog: { ...activeProfile.modelCatalog, stale: true } } : {}) })
    setDraft(nextDraft)
    if (commit) commitSettings(nextDraft)
  }

  const commitCurrentDraft = () => {
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' || Number.isNaN(nextTimeout)
        ? DEFAULT_SETTINGS.timeout
        : nextTimeout
    const normalizedAgentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
      ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
      : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentToolCallLimit)
    const nextDraft = {
      ...draft,
      agentToolCallLimit: normalizedAgentMaxToolRounds,
      profiles: activeProviderIsOpenAICompatible && !activeProfileLocked
        ? draft.profiles.map((profile) =>
            profile.id === activeProfile.id ? { ...profile, timeout: normalizedTimeout } : profile,
          )
        : draft.profiles,
    }
    setAgentMaxToolRoundsInput(String(normalizedAgentMaxToolRounds))
    return commitSettings(nextDraft)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveMessage('')
    try {
      const next = commitCurrentDraft()
      const languageChanged = languageDraft !== getUiLanguagePreference()
      if (languageChanged) {
        const state = useStore.getState()
        if (hasActiveDataOperations(state.tasks, state.agentConversations)) throw new Error(t('请先完成或停止任务，再切换语言，以免刷新中断生成或对话。', 'Finish or stop running tasks before changing language so reloading does not interrupt generation or chat.'))
        if (!next.persistInputOnRestart && (state.prompt || state.inputImages.length || state.maskDraft || state.maskEditorImageId || (state.galleryInputDraft && !isEmptyAgentInputDraft(state.galleryInputDraft)) || Object.values(state.agentInputDrafts).some((item) => !isEmptyAgentInputDraft(item)))) throw new Error(t('当前已关闭输入恢复，请先保存或清空草稿，或在“习惯配置”开启“重启后恢复输入框”，再切换语言。', 'Input restoration is off. Save or clear your drafts, or enable Restore input after restarting in Preferences before changing language.'))
        if (!await flushAgentConversationsToIndexedDB()) throw new Error(useStore.getState().agentConversationSaveError || t('对话尚未保存，请重试后再切换语言。', 'Conversations have not been saved. Try again before changing language.'))
      }
      const limitError = getApiProfileLimitError(next.profiles)
      if (limitError) throw new Error(limitError)
      if (isLocalService()) await saveDesktopSettings(next, draftRevisionRef.current)
      draftRevisionRef.current = getSettingsRevision()
      setSettings(next)
      setDraft(useStore.getState().settings)
      setSaveMessage(isLocalService() ? t('已保存到本机，桌面、网页和 Codex 共用。', 'Saved locally and shared by the desktop app, local web page, and Codex.') : t('已保存到当前浏览器。', 'Saved in this browser.'))
      showToast(t('配置已保存', 'Configuration saved'), 'success')
      if (languageChanged) {
        try { setUiLanguage(languageDraft) }
        catch { throw new Error(t('其他配置已保存，但无法保存语言选择，请允许本地存储后重试。', 'Other settings were saved, but the language choice could not be saved. Allow local storage and try again.')) }
        window.location.reload()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('保存失败，请重试。', 'Save failed. Please try again.')
      setSaveMessage(message)
      showToast(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (saving) return
    setDraft(normalizeSettings(settings))
    setLanguageDraft(getUiLanguagePreference())
    setEditingProfileId(null)
    setSaveMessage(t('已取消全部未保存更改。', 'All unsaved changes discarded.'))
  }

  const handleClose = () => {
    if (saving) { showToast(t('正在保存，请稍候。', 'Saving. Please wait.'), 'info'); return }
    if (isExportingData || isImportingData) {
      showDataTransferBusyToast()
      return
    }
    if (showZipDownloadRouteManager) {
      setShowZipDownloadRouteManager(false)
      return
    }
    if (languageDraft !== getUiLanguagePreference() || JSON.stringify(normalizeWorkspaceSettings(draft)) !== JSON.stringify(normalizeWorkspaceSettings(settings))) {
      setConfirmDialog({ title: t('有未保存的更改', 'Unsaved changes'), message: t('关闭将放弃本次未保存的配置。可返回后点击保存。', 'Closing will discard unsaved configuration changes. Go back and save to keep them.'), action: () => setShowSettings(false) })
      return
    }
    setShowSettings(false)
  }

  const commitTimeout = useCallback(() => {
    if (activeProfileLocked || !isOpenAICompatibleProvider(draft, activeProfile.provider)) return
    const nextTimeout = Number(timeoutInput)
    const normalizedTimeout =
      timeoutInput.trim() === '' ? DEFAULT_SETTINGS.timeout : Number.isNaN(nextTimeout) ? activeProfile.timeout : nextTimeout
    setTimeoutInput(String(normalizedTimeout))
    updateActiveProfile({ timeout: normalizedTimeout }, true)
  }, [draft, activeProfile.id, activeProfile.provider, activeProfile.timeout, activeProfileLocked, timeoutInput])

  const commitAgentMaxToolRounds = useCallback(() => {
    const value = agentMaxToolRoundsInput.trim() === ''
      ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
      : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentToolCallLimit)
    setAgentMaxToolRoundsInput(String(value))
    if (value !== draft.agentToolCallLimit) commitSettings({ ...draft, agentToolCallLimit: value })
  }, [agentMaxToolRoundsInput, draft])

  const showNotificationPermissionMessage = (result: Exclude<BrowserNotificationPermissionResult, { ok: true }>) => {
    if (result.reason === 'unsupported') {
      showToast(t('当前浏览器不支持系统通知', 'This browser does not support system notifications'), 'error')
    } else if (result.reason === 'insecure') {
      showToast(t('系统通知需要 HTTPS 或 localhost 安全上下文', 'System notifications require HTTPS or localhost'), 'error')
    } else if (result.reason === 'denied') {
      showToast(t('通知权限已被浏览器拒绝，请在地址栏左侧的网站设置中手动开启', 'Notifications are blocked. Enable them in the site settings beside the address bar.'), 'error')
    } else {
      showToast(t('没有开启系统通知', 'System notifications were not enabled'), 'info')
    }
  }

  const toggleTaskCompletionNotification = async () => {
    if (draft.taskCompletionNotification) {
      commitSettings({ ...draft, taskCompletionNotification: false })
      return
    }

    const result = await requestBrowserNotificationPermission()
    if (result.ok) {
      commitSettings({ ...draft, taskCompletionNotification: true })
      showToast(t('任务完成通知已开启', 'Task completion notifications enabled'), 'success')
    } else {
      showNotificationPermissionMessage(result)
    }
  }

  const dataTransferMode = isExportingData ? 'export' : isImportingData ? 'import' : null
  const showDataTransferBusyToast = () => {
    const now = Date.now()
    if (now - dataTransferToastAtRef.current < 1000) return
    dataTransferToastAtRef.current = now
    showToast(dataTransferMode === 'export' ? t('正在导出中，请稍候', 'Exporting. Please wait.') : t('正在导入中，请稍候', 'Importing. Please wait.'), 'info')
  }

  useEffect(() => {
    dataTransferToastAtRef.current = 0
    if (!dataTransferMode) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const preventKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      showDataTransferBusyToast()
    }
    window.addEventListener('keydown', preventKeyDown, true)
    return () => window.removeEventListener('keydown', preventKeyDown, true)
  }, [dataTransferMode, showToast])

  const blockDataTransferInteraction = (e: React.SyntheticEvent) => {
    if (!dataTransferMode) return
    e.preventDefault()
    e.stopPropagation()
    showDataTransferBusyToast()
  }

  const blockDataTransferClick = (e: React.SyntheticEvent) => {
    if (!dataTransferMode) return
    e.preventDefault()
    e.stopPropagation()
  }

  useCloseOnEscape(showSettings && !dataTransferMode, handleClose)
  usePreventBackgroundScroll(showSettings, showZipDownloadRouteManager ? zipDownloadRouteScrollBoundaryRef : settingsScrollBoundaryRef)

  if (!showSettings) return null

  const addProfileToGroup = (profile: ApiProfile) => {
    if (presetConfigOnly) return
    const field = apiGroup === 'agent' ? 'agentFailover' : 'failover'
    const pool = draft[field] ?? { enabled: true, primaryId: '', slots: [], disabledIds: [] }
    if (visibleProfiles.length >= MAX_API_PROFILES) { showToast(t('本组已达 10 套上限，请先删除不需要的配置。', 'This group has reached its 10-profile limit. Delete an unused profile first.'), 'info'); return }
    setReusedTaskApiProfile(null)
    setEditingProfileId(profile.id)
    commitSettings({ ...draft, profiles: [...draft.profiles, profile], [selectionField]: draft[selectionField] || profile.id,
      [field]: { ...pool, slots: [...pool.slots, profile.id], primaryId: pool.primaryId || profile.id } })
  }

  const duplicateActiveProfile = () => {
    addProfileToGroup({ ...activeProfile, id: newId('openai'), isDefault: undefined, name: t(`${activeProfile.name}（复制）`, `${activeProfile.name} (copy)`) })
  }

  const deleteProfile = (id: string) => {
    const preset = presetProfileIds.has(id)
    if (presetConfigOnly || draft.profiles.length <= 1 || (preset && presetDeletionPrevented)) return
    if (id === reusedTaskApiProfileId) setReusedTaskApiProfile(null)
    if (preset) dismissPresetProfile(id)
    const nextProfiles = draft.profiles.filter((item) => item.id !== id)
    const nextDraft = normalizeSettings({
      ...draft,
      profiles: nextProfiles,
      activeProfileId: draft.activeProfileId === id ? nextProfiles[0].id : draft.activeProfileId,
    })
    commitSettings(nextDraft)
  }


  return (
        <div
          data-no-drag-select
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onPointerDownCapture={blockDataTransferInteraction}
          onClickCapture={blockDataTransferClick}
          onContextMenuCapture={blockDataTransferInteraction}
        >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        ref={settingsScrollBoundaryRef}
        onChangeCapture={() => setSaveMessage('')}
        className="relative z-10 w-full max-w-5xl rounded-2xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex h-[85vh] sm:h-[min(850px,88vh)] flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 p-4 sm:p-5 border-b border-gray-100 dark:border-white/[0.08]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 whitespace-nowrap">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {t('设置', 'Settings & API')}
          </h3>
          <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
            <button type="button" onClick={handleCancel} disabled={saving} className="rounded-lg border px-3 py-2 text-xs whitespace-nowrap disabled:opacity-50">{t('取消未保存更改', 'Discard unsaved changes')}</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || isExportingData || isImportingData} className="rounded-lg bg-gray-900 px-4 py-2 text-sm whitespace-nowrap text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{saving ? t('保存中…', 'Saving…') : t('保存配置', 'Save configuration')}</button>
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label={t('关闭', 'Close')}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div role="status" className="border-b border-gray-100 px-5 py-2 text-xs text-gray-500 dark:border-white/[0.08]">{activeTab === 'features' ? t('了解功能与使用方式，访问项目主页查看源码和说明。', 'Explore features and usage. Visit the project page for source code and documentation.') : activeTab === 'connections' ? t('连接操作点击后立即生效，与 API 草稿保存独立。', 'Connection actions take effect immediately, independently of API draft changes.') : saveMessage || t('修改仅保留在草稿，点击“保存配置”后生效；切换页面或配置可继续编辑。', 'Changes remain in the draft until you click Save configuration. You can keep editing while switching pages or profiles.')}</div>
        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="w-full sm:w-48 shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.02]">
            <nav className="flex-1 overflow-x-auto sm:overflow-y-auto custom-scrollbar p-3 space-x-1 sm:space-x-0 sm:space-y-1 flex sm:flex-col">
              <button
                onClick={() => setActiveTab('api')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'api' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {t('API 配置', 'API profiles')}
              </button>
              <button
                onClick={() => setActiveTab('general')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'general' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                </svg>
                {t('习惯配置', 'Preferences')}
              </button>
              <button
                onClick={() => setActiveTab('language')}
                aria-current={activeTab === 'language' ? 'page' : undefined}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'language' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" strokeWidth={2} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M12 3c3 3 3 15 0 18-3-3-3-15 0-18" /></svg>
                {t('语言', 'Language')}
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'data' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                {t('数据管理', 'Data management')}
              </button>
              <button
                onClick={() => setActiveTab('connections')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'connections' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-2 2M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l2-2" /></svg>
                {t('Agent 连接', 'Agent connections')}
              </button>
              <button
                onClick={() => setActiveTab('features')}
                aria-current={activeTab === 'features' ? 'page' : undefined}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'features' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M12 11v6m0-10v.01" /></svg>
                {t('功能介绍', 'Features')}
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent relative overflow-hidden">
            <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-5 sm:p-6">
            <fieldset inert={saving} disabled={saving} className="min-w-0 border-0 p-0">
            {activeTab === 'language' && <LanguageSettingsTab value={languageDraft} onChange={setLanguageDraft} />}
            {activeTab === 'connections' && <AgentConnectionsTab />}
            {activeTab === 'features' && <FeatureIntroTab />}
            {activeTab === 'general' && (
              <>
              <GeneralSettingsTab
                draft={draft}
                zipDownloadRouteSummary={zipDownloadRouteSummary}
                commitSettings={commitSettings}
                onOpenZipDownloadRouteManager={() => setShowZipDownloadRouteManager(true)}
                toggleTaskCompletionNotification={toggleTaskCompletionNotification}
              />
              <AgentPreferences draft={draft} agentMaxToolRoundsInput={agentMaxToolRoundsInput} setAgentMaxToolRoundsInput={setAgentMaxToolRoundsInput} commitSettings={commitSettings} commitAgentMaxToolRounds={commitAgentMaxToolRounds} />
              </>
            )}

            {activeTab === 'api' && (
              <div className="space-y-4">
                <div role="tablist" aria-label={t('API 用途', 'API purpose')} className="flex gap-2 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
                  {(['gallery', 'agent'] as const).map((group) => <button key={group} role="tab" aria-selected={apiGroup === group} onClick={() => { setShowApiKey(false); setEditingProfileId(null); setApiGroup(group) }} className={`flex-1 rounded-lg px-4 py-2 text-sm ${apiGroup === group ? 'bg-white shadow-sm dark:bg-white/10' : 'text-gray-500'}`}>{group === 'gallery' ? t('生图API配置卡', 'Image API profiles') : t('对话API配置卡', 'Chat API profiles')}</button>)}
                </div>
                <ApiProfileList draft={draft} onChange={(next) => setDraft(normalizeSettings(next))} group={apiGroup} editingId={editingProfileId}
                  onEdit={(id) => { setEditingProfileId(editingProfileId === id ? null : id); setShowApiKey(false) }}
                  onAdd={() => addProfileToGroup(createDefaultOpenAIProfile({ id: newId('openai'), name: t(`${apiGroup === 'agent' ? 'Agent' : '画廊'}方案 ${visibleProfiles.length + 1}`, `${apiGroup === 'agent' ? 'Chat' : 'Image'} profile ${visibleProfiles.length + 1}`), apiProxy: false, ...(apiGroup === 'agent' ? { apiMode: 'responses', model: DEFAULT_RESPONSES_MODEL, streamImages: true } : {}) }))}>
                <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-sm"><strong>{t('编辑：', 'Editing: ')}{activeProfile.name}</strong>
                  {!presetConfigOnly && <button type="button" disabled={visibleProfiles.length >= MAX_API_PROFILES} onClick={duplicateActiveProfile}>{t('复制配置', 'Duplicate profile')}</button>}
                  {!presetConfigOnly && draft.profiles.length > 1 && !(presetProfileIds.has(activeProfile.id) && presetDeletionPrevented) && <button type="button" onClick={() => deleteProfile(activeProfile.id)}>{t('删除配置', 'Delete profile')}</button>}
                </div>
                {activePresetDescription && <MarkdownRenderer content={activePresetDescription} />}

              {/* 1. 配置名称 */}
              <label className="block">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">{t('配置名称', 'Profile name')}</span>
                <input
                  value={activeProfile.name}
                  onChange={(e) => updateActiveProfile({ name: e.target.value })}
                  type="text"
                  disabled={activeProfileLocked}
                  className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                />
              </label>

              {/* 3. API URL */}
              {activeProviderUsesApiUrl && (
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">API URL</span>
                  </div>
                  <input
                    value={activeProfile.baseUrl}
                    onChange={(e) => updateActiveProfile({ baseUrl: e.target.value })}
                    type="text"
                    disabled={apiProxyEnabled || activeProfileLocked}
                    placeholder={activeProfile.provider === 'fal' ? DEFAULT_FAL_BASE_URL : DEFAULT_SETTINGS.baseUrl}
                    className={`w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 ${apiProxyEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <div data-selectable-text className="mt-1.5 min-h-[22px] flex items-center text-xs text-gray-500 dark:text-gray-500">
                    {apiProxyEnabled ? (
                      <span className="text-yellow-600 dark:text-yellow-500">{t('已开启代理，实际请求目标由部署端决定，此处设置被忽略。', 'The proxy is enabled. The deployment controls the request destination; this URL is ignored.')}</span>
                    ) : activeProfile.provider === 'fal' ? (
                      <span>{t('默认使用', 'Defaults to')} <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">{DEFAULT_FAL_BASE_URL}</code>{t('；填写自定义地址时将作为 fal.ai 代理 URL。', '; a custom address is used as a fal.ai proxy URL.')}</span>
                    ) : (
                      <span>{t('末尾带', 'An address ending in')} <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">/</code> {t('时直接使用该地址拼接接口，不补', 'is used directly to append endpoints, without adding')} <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">/v1</code> {t('前缀；支持通过查询参数覆盖：', '. Override with this query parameter:')}<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>{t('。', '.')}</span>
                    )}
                  </div>
                </label>
              )}

              {/* 4. API 代理（紧跟 URL） */}
              {apiProxyAvailable && activeProviderIsOpenAICompatible && !activeCustomProviderAsync && (
                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">{t('API 代理', 'API proxy')}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!apiProxyLocked && !activeProfileLocked) updateActiveProfile({ apiProxy: !activeProfile.apiProxy }, true)
                      }}
                      disabled={apiProxyLocked || activeProfileLocked}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${apiProxyChecked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${apiProxyLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                      role="switch"
                      aria-checked={apiProxyChecked}
                      aria-label={t('API 代理', 'API proxy')}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${apiProxyChecked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    {apiProxyLocked ? t('部署端已锁定代理开启，请求经服务器转发到上游 API，上方 URL 设置将失效。', 'The deployment requires the proxy. Requests are forwarded through the server to the upstream API; the URL above is ignored.') : t('开启后请求经服务器转发到上游 API，可绕过浏览器跨域限制，上方 URL 设置将失效。', 'Forwards requests through the server to the upstream API to bypass browser cross-origin restrictions. The URL above is ignored.')}
                  </div>
                </div>
              )}

              {/* 5. API Key */}
              <div className="block">
                <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API Key</span>
                <div className="relative">
                  <input
                    value={activeProfile.apiKey}
                    onChange={(e) => updateActiveProfile({ apiKey: e.target.value })}
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={activeProfile.provider === 'fal' ? 'FAL_KEY' : 'sk-...'}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400">{apiGroup === 'agent' ? t('通过 Responses 接口进行对话，地址下自动使用 /responses。', 'Chat uses the Responses API, with /responses appended to the URL.') : t('通过 Images 接口生成和编辑图片。', 'Generates and edits images through the Images API.')}</p>

              <ModelSettings key={activeProfile.id} profile={activeProfile} agent={apiGroup === 'agent'} locked={activeProfileLocked}
                onChange={(patch) => updateActiveProfile(patch, true)}
                onFetch={async () => {
                  const requested = { ...activeProfile }
                  const modelCatalog = await fetchModelCatalog(requested)
                  const latest = draftRef.current
                  const current = latest.profiles.find((profile) => profile.id === requested.id)
                  if (!current || normalizeBaseUrl(current.baseUrl) !== normalizeBaseUrl(requested.baseUrl) || current.apiKey !== requested.apiKey || current.apiProxy !== requested.apiProxy) throw new Error(t('配置已改变，请用新配置重新获取模型。', 'Configuration changed. Fetch models again with the new configuration.'))
                  setDraft({ ...latest, profiles: latest.profiles.map((profile) => profile.id === requested.id ? { ...profile, modelCatalog } : profile) })
                  return modelCatalog
                }} />
              <details className="rounded-xl border border-gray-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-xs font-medium">{t('状态与排错', 'Status and troubleshooting')}</summary><div className="mt-3"><ApiDiagnostics profile={activeProfile} /></div></details>
              <details className="space-y-4"><summary className="cursor-pointer text-sm font-medium">{t('高级设置', 'Advanced settings')}</summary>
              {/* 8. 流式传输 + 中间步骤图像数 */}
              {activeProfile.provider === 'openai' && (
                <div className="block space-y-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">{t('流式传输', 'Streaming')}</span>
                      <button
                        type="button"
                        onClick={() => updateActiveProfile({ streamImages: !activeProfile.streamImages }, true)}
                        disabled={activeProfileLocked}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.streamImages ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        role="switch"
                        aria-checked={!!activeProfile.streamImages}
                        aria-label={t('流式传输', 'Streaming')}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.streamImages ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </div>
                    <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                      {apiGroup === 'agent' ? t('逐步显示回复文字，接口需支持 Responses 流式返回。', 'Display reply text as it arrives. Requires Responses streaming support.') : t('逐步显示图片生成进度；接口需支持 Images 流式返回。开启后此方案使用原流式通道，不参与桌面画廊主备。', 'Display image generation progress as it arrives. Requires Images streaming support. This profile then uses the streaming channel separately from desktop image failover.')}
                    </div>
                  </div>
                  <div className={apiGroup === 'gallery' && activeProfile.streamImages ? 'block' : 'hidden'}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">{t('请求中间步骤图像数', 'Intermediate images to request')}</span>
                      <div className="w-28 shrink-0">
                        <Select
                          value={normalizeStreamPartialImages(activeProfile.streamPartialImages)}
                          onChange={(value) => updateActiveProfile({ streamPartialImages: normalizeStreamPartialImages(value) }, true)}
                          disabled={!activeProfile.streamImages || activeProfileLocked}
                          options={[
                            { label: t('0，不请求', '0, none'), value: 0 },
                            { label: t('1 张', '1 image'), value: 1 },
                            { label: t('2 张', '2 images'), value: 2 },
                            { label: t('3 张', '3 images'), value: 3 },
                          ]}
                          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                        />
                      </div>
                    </div>
                    <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                      {t('对应', 'Uses the')} <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">partial_images</code> {t('参数（0-3）。建议设为 2 或 3 以避免长时间生成时连接超时断开。实际返回的每张中间图像会产生少量额外计费。设为 0 时不请求中间步骤图像，连接可能因无数据传输而被断开。', 'parameter (0–3). Set 2 or 3 to help avoid connection timeouts during long generations. Each returned intermediate image incurs a small additional charge. With 0, no intermediate images are requested, and the connection may close due to inactivity.')}
                    </div>
                  </div>
                </div>
              )}

              {/* 9. 透明背景实现方式 */}
              <div className={apiGroup === 'gallery' ? 'block' : 'hidden'}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="block text-sm text-gray-600 dark:text-gray-300">{t('透明背景实现方式', 'Transparent background method')}</span>
                  <div className="w-28 shrink-0">
                    <Select
                      value={activeProfile.transparentBackgroundMethod}
                      onChange={(value) => updateActiveProfile({ transparentBackgroundMethod: value as ApiProfile['transparentBackgroundMethod'] }, true)}
                      options={[
                        { label: t('API 原生', 'Native API'), value: 'api' },
                        { label: t('本地后处理', 'Local post-processing'), value: 'local' },
                      ]}
                      disabled={activeProfileLocked || !activeCustomProviderSupportsNativeTransparentBackground}
                      className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                    />
                  </div>
                </div>
                <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                  {activeCustomProviderSupportsNativeTransparentBackground
                    ? t('API 原生会请求接口直接生成透明背景，需当前接口支持；本地后处理会生成纯色背景并在浏览器中去除。', 'Native API requests transparency directly and requires API support. Local post-processing generates a solid background and removes it in the browser.')
                    : <>{t('当前自定义服务商 Manifest 未映射', 'This custom provider manifest does not map')} <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">$params.background</code>{t('，无法使用 API 原生透明背景。', ', so native API transparency is unavailable.')}</>}
                </div>
              </div>

              {/* 10. 返回 Base64 图片数据 */}
              {apiGroup === 'gallery' && activeProviderIsOpenAICompatible && (
                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">{t('返回 Base64 图片数据', 'Return Base64 image data')}</span>
                    <button
                      type="button"
                      onClick={() => updateActiveProfile({ responseFormatB64Json: !activeProfile.responseFormatB64Json }, true)}
                      disabled={activeProfileLocked}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.responseFormatB64Json ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={!!activeProfile.responseFormatB64Json}
                      aria-label={t('返回 Base64 图片数据', 'Return Base64 image data')}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.responseFormatB64Json ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    {t('开启后在请求体中追加', 'Adds')} <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">response_format: b64_json</code>{t('，使接口直接返回 Base64 编码的图片数据而非 URL。并非所有服务商和网关都支持此功能。', 'to the request body to return Base64 image data instead of a URL. Some providers and gateways do not support this.')}
                  </div>
                </div>
              )}

              {/* 11. Codex CLI 兼容模式 */}
              {apiGroup === 'gallery' && activeProviderIsOpenAICompatible && (
                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="block text-sm text-gray-600 dark:text-gray-300">{t('Codex CLI 兼容模式', 'Codex CLI compatibility')}</span>
                    <button
                      type="button"
                      onClick={() => updateActiveProfile({ codexCli: !activeProfile.codexCli }, true)}
                      disabled={activeProfileLocked}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      role="switch"
                      aria-checked={activeProfile.codexCli}
                      aria-label={t('Codex CLI 兼容模式', 'Codex CLI compatibility')}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.codexCli ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </div>
                  <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                    {t('开启后应用 Codex CLI 实际支持的参数。支持查询参数覆盖：', 'Uses the parameters supported by Codex CLI. Override with this query parameter:')}<code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code>。
                  </div>
                </div>
              )}

              {/* 12. 请求超时 */}
              {activeProviderIsOpenAICompatible && (
                <label className="block">
                  <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">{t('请求超时 (秒)', 'Request timeout (seconds)')}</span>
                  <input
                    value={timeoutInput}
                    onChange={(e) => { setTimeoutInput(e.target.value); updateActiveProfile({ timeout: Number(e.target.value) || DEFAULT_SETTINGS.timeout }) }}
                    onBlur={commitTimeout}
                    type="number"
                    disabled={activeProfileLocked}
                    min={10}
                    max={600}
                    className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
                  />
                </label>
              )}
              </details>
              <div className="api-editor-footer"><button type="button" onClick={() => void handleSave()} disabled={saving}>{saving ? t('保存中…', 'Saving…') : t('保存配置', 'Save configuration')}</button><button type="button" onClick={handleCancel}>{t('取消未保存更改', 'Discard unsaved changes')}</button></div>
              {saveMessage && <p role="status" className="text-sm">{saveMessage}</p>}
                </div></ApiProfileList>
            </div>
            )}
            
            {activeTab === 'data' && <DataManagementTab isExportingData={isExportingData} isImportingData={isImportingData} setIsExportingData={setIsExportingData} setIsImportingData={setIsImportingData} onSettingsChanged={() => {
              const nextDraft = normalizeSettings(useStore.getState().settings)
              setDraft(nextDraft)
              setTimeoutInput(String(getActiveApiProfile(nextDraft).timeout))
            }} />}

            </fieldset>
          </div>
        </div>
      </div>
      </div>

        {showZipDownloadRouteManager && (
          <ZipDownloadRouteModal
            routes={draft.zipDownloadRoutes}
            scrollBoundaryRef={zipDownloadRouteScrollBoundaryRef}
            onSetEnabled={setZipDownloadRouteEnabled}
            onClose={() => setShowZipDownloadRouteManager(false)}
          />
        )}



    </div>
  )
}
