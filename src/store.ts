import { t } from './lib/i18n'
import { savePersonalPromptChange } from './lib/promptStorage'
import { recordBackupReceipt } from './lib/backupStatus'
import { getApiProfileLimitError } from './lib/apiProfiles'
import { parseImageToolArguments } from './lib/agentImageTools'
import { getAgentImageParams, getAgentPreferences, withConversationPreferences } from './lib/agentPreferences'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentConversation,
  AgentInputDraft,
  CreationDraftSnapshot,
  PromptTemplate,
  AgentMessage,
  AgentRound,
  ApiMode,
  ApiProfile,
  AppSettings,
  PresetConfig,
  AppMode,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  FavoriteCollection,
  ResponsesOutputItem,
  StoredImage,
  StoredImageThumbnail,
} from './types'
import { API_MAX_IMAGES, DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_PARAMS } from './types'
import { isLocalService, usesDesktopPool } from './lib/desktop'
import { normalizeWorkspaceSettings } from './lib/workspaceSettings'
import { DEFAULT_SETTINGS, getActiveApiProfile, getAgentImageApiProfile, getAgentTextApiProfile, getCustomProviderDefinition, mergeImportedSettings, mergePresetImportedSettings, normalizeSettings, validateApiProfile } from './lib/apiProfiles'
import { enforcePresetConfigPolicy, getPresetConfig, getPresetProfileIds, getPresetProviderIds, isPresetConfigDeletionPrevented, isPresetConfigParamsLocked, isPresetProviderDeletionPrevented } from './lib/presetConfig'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { remapImageMentionsForOrder, replaceImageMentionsForApi } from './lib/promptImageMentions'
import {
  getAllTasks,
  putTask as dbPutTask,
  deleteTask as dbDeleteTask,
  commitTaskDeletion,
  clearTasks as dbClearTasks,
  getAllAgentConversations,
  replaceAgentConversations,
  commitAgentConversationChanges,
  getImage,
  getStoredImageThumbnail,
  getImageThumbnail,
  getAllImageIds,
  putImage,
  putImageThumbnail,
  deleteImage,
  clearImages,
  storeImage,
  storeImageWithSize,
} from './lib/db'
import { callImageApi } from './lib/api'
import { callAgentConversationTitleApi, callAgentResponsesApi, parseBatchImageCallArguments, type AgentApiResultImage } from './lib/agentApi'
import { buildAgentApiInput, buildAgentContinuationInput } from './lib/agentInputBuilder'
import { collectAgentRoundOutputImageSlots, extractAgentReferenceIds, getAgentCurrentReferenceId, getAgentGeneratedImageReferenceId } from './lib/agentImageReferences'
import { showBrowserNotification } from './lib/browserNotification'
import { IMAGE_FETCH_CORS_HINT } from './lib/imageApiShared'
import { getFalErrorMessage, getFalQueuedImageResult } from './lib/falAiImageApi'
import { getCustomQueuedImageResult } from './lib/openaiCompatibleImageApi'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { createTransparentOutputMeta, getTransparentRequestParams, removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { blobToDataUrl, fileToDataUrl } from './lib/dataUrl'
import { cacheImage, cacheThumbnail, clearImageCaches, deleteCachedImage, deleteImageCacheEntry, ensureImageCached, scheduleThumbnailBackfill } from './lib/imageCache'
import { hasActiveDataOperations } from './lib/dataOperations'
import { formatExportFileTime } from './lib/exportFileName'
import { buildExportZip, createExportBlob, getExportImageEstimatedBytes, getExportZipPlan, MAX_EXPORT_ZIP_BYTES, readExportZip, readExportZipFileAsDataUrl, readExportZipManifest } from './lib/exportZip'
import { appendDirectImageRound, deleteAgentRoundFromConversation, getActiveAgentRounds, getAgentConversationTaskIds, getAgentRoundPath, normalizeAgentConversations, remapAgentRoundMentionsForPathChange, uniqueIds } from './lib/agentConversationState'
import { isAgentStoppedMessage, canonicalizeBatchFunctionCallArguments, countResponseToolCalls, createReadyAgentRecoveredToolState, getAgentFunctionOutputCallIds, getAgentRecoveredFailureError, getAgentRecoveredToolCallCount, getPersistableAgentConversations, getPersistableRawResponsePayload, mergeResponseOutputItems, scrubResponseOutputForDeletedAgentTasks, scrubTaskRawResponsePayloadForDeletedTasks } from './lib/agentResponseState'
import { cleanStaleAgentInputDrafts, isEmptyAgentInputDraft, normalizeAgentInputDrafts, remapAgentInputDraftMentionsForPathChange, restoreAgentInputDraftState, restoreGalleryInputDraftState, saveActiveAgentInputDrafts, saveGalleryInputDraft, syncActiveInputDraft, updateInputDraftImages } from './lib/inputDraftState'
import { ALL_FAVORITES_COLLECTION_ID, DEFAULT_FAVORITE_COLLECTION_ID, createDefaultFavoriteCollection, deleteFavoriteCollectionState, ensureDefaultFavoriteCollection, getTaskFavoriteCollectionIds, mergeFavoriteCollections, normalizeFavoriteCollectionIds, normalizeFavoriteCollectionName, normalizeFavoriteCollections, normalizeFavoritePatch, normalizeLoadedFavoriteState, resolveDefaultFavoriteCollectionId, sameFavoriteCollectionIds } from './lib/favoriteState'
import { createPersistedState, mergePersistedAgentConversations, migratePersistedState, normalizePersistedState } from './lib/persistedState'
import { addImageSizeParam, createTaskDonePatch, createTaskErrorPatch, deriveAgentImageActualParams, deriveGalleryActualParams, firstActualParams, hasActualParams, hasActualSizeParam, mapActualParamsByImage, mapRevisedPromptsByImage, markInterruptedOpenAIRunningTasks } from './lib/taskState'
import { stripInjectedCodexCliSizePrompt } from './lib/size'
import { applyCreationDraft, captureCreationDraft } from './lib/creationDraft'
import { flushAgentConversationsToIndexedDB, initializeAgentConversationPersistence, persistAgentConversationChanges, scheduleAgentConversationSave } from './lib/agentConversationPersistence'
import { DEFAULT_PROMPT_CATEGORIES, mergePromptTemplates } from './lib/promptTemplates'

const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentRoundControllers = new Map<string, AbortController>()
const agentRecoveryContinuations = new Set<string>()
const deletedActiveAgentTasks = new Map<string, { task: TaskRecord; controller: AbortController }>()
let agentConversationPersistenceReady = false
let agentConversationMigrationPending = false
const AGENT_STOPPED_MESSAGE = t('已停止生成。', 'Generation stopped.')
const AGENT_RECOVERY_PAUSE_ERROR = 'AgentRecoveryPauseError'
const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 28
const ERROR_TOAST_MAX_LENGTH = 80
type ToastType = 'info' | 'success' | 'error'
type AgentDeletionResult = 'deleted' | 'deleted-with-warning' | 'running' | 'not-found'

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return t('操作失败', 'Operation failed')

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return t('操作失败，请查看详情', 'Operation failed. See details.')
  return firstLine || t('操作失败', 'Operation failed')
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$|failed|error|cannot|unable|timed out|interrupted|missing|not found/i.test(title)
}

export type SettingsTab = 'general' | 'agent-api' | 'api' | 'data' | 'connections' | 'features' | 'language'

const TIMEOUT_STREAMING_HINT = t('也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。', 'Try enabling streaming and increasing the number of intermediate images to keep the connection active.')
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT = t('官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。', 'The official streaming API does not send heartbeats. With intermediate images set to 0, inactivity may disconnect the request. Try 2 or 3.')
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = t('也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。', 'Try increasing the number of intermediate images to prevent disconnection during long periods of inactivity.')

type TimeoutStreamingHintProfile = Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'> & { apiMode?: string }

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.apiMode === 'responses') return profile.streamImages ? '' : t('可尝试开启 Agent 流式传输。', 'Try enabling Agent streaming.')
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function createOpenAITimeoutError(timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  return t(`请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`, `Request timed out after ${timeoutSeconds} seconds. Try again later or increase the timeout. ${getTimeoutStreamingHint(profile)}`)
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function isAgentTask(task: TaskRecord) {
  return task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
}

function showTaskCompletionNotification(title: string, body: string) {
  const settings = normalizeSettings(useStore.getState().settings)
  if (!settings.taskCompletionNotification) return
  showBrowserNotification(title, { body })
}

function mergeImportedAgentConversations(current: AgentConversation[], imported: AgentConversation[]) {
  const merged = [...current]
  const indexes = new Map(merged.map((conversation, index) => [conversation.id, index]))

  for (const conversation of imported) {
    const index = indexes.get(conversation.id)
    if (index == null) {
      indexes.set(conversation.id, merged.length)
      merged.push(conversation)
    } else {
      merged[index] = conversation
    }
  }

  return merged
}

function createAgentConversation(now = Date.now()): AgentConversation {
  return {
    imageParams: { ...useStore.getState().params },
    preferences: getAgentPreferences(useStore.getState().settings),
    id: genId(),
    title: t('新对话', 'New conversation'),
    activeRoundId: null,
    createdAt: now,
    updatedAt: now,
    rounds: [],
    messages: [],
  }
}

function createAgentConversationTitle(prompt: string, fallbackTitle: string) {
  const title = prompt.replace(/\s+/g, ' ').trim()
  if (!title) return fallbackTitle
  const chars = Array.from(title)
  if (chars.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return title
  return `${chars.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 3).join('')}...`
}

function isEmptyAgentConversation(conversation: AgentConversation) {
  return conversation.rounds.length === 0 && conversation.messages.length === 0 && !conversation.activeRoundId
}

function getLatestAgentConversation(conversations: AgentConversation[]) {
  return conversations.reduce<AgentConversation | null>((latest, conversation) => {
    if (!latest) return conversation
    if (conversation.updatedAt !== latest.updatedAt) return conversation.updatedAt > latest.updatedAt ? conversation : latest
    return conversation.createdAt > latest.createdAt ? conversation : latest
  }, null)
}

export function getPersistedState(state: AppState) {
  const persisted = createPersistedState(state, agentConversationMigrationPending && !agentConversationPersistenceReady)
  return isLocalService() ? { ...persisted, settings: DEFAULT_SETTINGS, previousPresetConfig: null } : persisted
}

async function replaceStoredAgentConversations(conversations: AgentConversation[]) {
  await replaceAgentConversations(conversations.map(getPersistableAgentConversation))
}

function getPersistableAgentConversation(conversation: AgentConversation): AgentConversation {
  return getPersistableAgentConversations([conversation])[0]!
}

function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  const plan = normalizePersistedState(persistedState, currentState)
  if (!plan) return currentState
  if (plan.shouldMigrateAgentConversations) agentConversationMigrationPending = true
  return {
    ...currentState,
    ...plan.state,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
  }
}

// ===== Store 类型 =====

interface AppState {
  // 模式
  appMode: AppMode
  setAppMode: (mode: AppMode) => void

  // 设置
  settings: AppSettings
  previousPresetConfig: PresetConfig | null
  setSettings: (s: Partial<AppSettings>) => void
  setPresetImportedSettings: (
    importedSettings: Partial<AppSettings> | unknown,
    transform?: (settings: AppSettings) => Partial<AppSettings>,
  ) => Promise<void>
  dismissedPresetProfileIds: string[]
  dismissPresetProfile: (id: string) => void
  restorePresetProfile: (id: string) => void
  dismissedPresetProviderIds: string[]
  dismissPresetProvider: (id: string) => void
  restorePresetProvider: (id: string) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  creationDraftUndo: { before: CreationDraftSnapshot; after: CreationDraftSnapshot } | null
  promptTemplates: PromptTemplate[]
  promptCategories: string[]
  setPromptTemplates: (templates: PromptTemplate[] | ((current: PromptTemplate[]) => PromptTemplate[]), categories?: string[] | ((current: string[]) => string[])) => Promise<boolean>
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: AgentInputDraft | null

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  reusedTaskApiProfileId: string | null
  reusedTaskApiProfileName: string | null
  reusedTaskApiProfileMissing: boolean
  setReusedTaskApiProfile: (profileId: string | null, missing?: boolean, profileName?: string | null) => void

  // Agent
  agentConversations: AgentConversation[]
  agentConversationSaveError: string | null
  agentConversationsLoaded: boolean
  activeAgentConversationId: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
  agentSidebarCollapsed: boolean
  agentMobileHeaderVisible: boolean
  agentEditingRoundId: string | null
  agentEditingConversationId: string | null
  agentGeneratingTitleIds: Record<string, true>
  createAgentConversation: () => string
  setActiveAgentConversationId: (id: string | null) => void
  setActiveAgentRoundId: (conversationId: string, roundId: string | null) => void
  renameAgentConversation: (id: string, title: string) => void
  deleteAgentConversation: (id: string) => void
  deleteAgentRound: (conversationId: string, roundId: string) => Promise<AgentDeletionResult>
  deleteAgentAssistantMessage: (conversationId: string, messageId: string) => Promise<AgentDeletionResult>
  setAgentSidebarCollapsed: (collapsed: boolean) => void
  setAgentMobileHeaderVisible: (visible: boolean) => void
  setAgentEditingRoundId: (id: string | null) => void
  setAgentEditingConversationId: (id: string | null) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  favoriteCollections: FavoriteCollection[]
  setFavoriteCollections: (collections: FavoriteCollection[]) => void
  defaultFavoriteCollectionId: string | null
  setDefaultFavoriteCollectionId: (id: string | null) => void
  activeFavoriteCollectionId: string | null
  isManageCollectionsModalOpen: boolean
  setActiveFavoriteCollectionId: (id: string | null) => void
  openManageCollectionsModal: () => void
  closeManageCollectionsModal: () => void
  favoritePickerTaskIds: string[] | null
  openFavoritePicker: (taskIds: string[]) => void
  closeFavoritePicker: () => void
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview: (taskId: string, image?: string, requestIndex?: number) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
  selectedFavoriteCollectionIds: string[]
  setSelectedFavoriteCollectionIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleFavoriteCollectionSelection: (id: string, force?: boolean) => void
  clearFavoriteCollectionSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | null
  setShowSettings: (v: boolean, tab?: SettingsTab) => void

  // Toast
  toast: { message: string; type: ToastType } | null
  showToast: (message: string, type?: ToastType) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    awaitAction?: boolean
    action?: (checkboxChecked?: boolean) => void | boolean | Promise<void | boolean>
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

function isImageReferencedByState(state: AppState, imageId: string) {
  if (state.inputImages.some((img) => img.id === imageId)) return true
  if (state.galleryInputDraft?.inputImages.some((img) => img.id === imageId)) return true
  if (Object.values(state.agentInputDrafts).some((draft) => draft.inputImages.some((img) => img.id === imageId))) return true
  if (state.tasks.some((task) =>
    task.inputImageIds.includes(imageId) ||
    task.outputImages.includes(imageId) ||
    task.transparentOriginalImages?.includes(imageId) ||
    task.streamPartialImageIds?.includes(imageId) ||
    task.maskTargetImageId === imageId ||
    task.maskImageId === imageId
  )) return true
  return state.agentConversations.some((conversation) =>
    conversation.rounds.some((round) =>
      round.inputImageIds.includes(imageId) ||
      round.maskTargetImageId === imageId ||
      round.maskImageId === imageId
    ) ||
    conversation.messages.some((message) =>
      message.inputImageIds?.includes(imageId) ||
      message.maskTargetImageId === imageId ||
      message.maskImageId === imageId
    ),
  )
}

export async function deleteImageIfUnreferenced(imageId: string) {
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  try {
    await deleteStoredImageIfUnreferenced(imageId)
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

async function deleteStoredImageIfUnreferenced(imageId: string) {
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  const [image, thumbnail] = await Promise.all([getImage(imageId), getStoredImageThumbnail(imageId)])
  if (isImageReferencedByState(useStore.getState(), imageId)) return

  await deleteImage(imageId)
  if (!isImageReferencedByState(useStore.getState(), imageId)) {
    deleteImageCacheEntry(imageId)
    return
  }

  if (image) {
    await putImage(image)
    cacheImage(image.id, image.dataUrl)
  }
  if (thumbnail) {
    await putImageThumbnail(thumbnail)
    cacheThumbnail(thumbnail.id, {
      dataUrl: thumbnail.thumbnailDataUrl,
      width: thumbnail.width,
      height: thumbnail.height,
      thumbnailVersion: thumbnail.thumbnailVersion,
    })
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Mode
      appMode: 'gallery',
      setAppMode: (appMode) => {
        if (get().appMode === appMode) return
        if (appMode === 'gallery') {
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          set((state) => ({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
            ...(state.appMode === 'agent' ? restoreGalleryInputDraftState(galleryInputDraft) : {}),
          }))
          return
        }

        const state = get()
        const galleryInputDraft = saveGalleryInputDraft(state)
        set((state) => ({
          appMode: 'agent',
          galleryInputDraft,
          agentMobileHeaderVisible: false,
          agentSidebarCollapsed: true,
          selectedTaskIds: [],
          selectedFavoriteCollectionIds: [],
          ...restoreAgentInputDraftState(state.agentInputDrafts, state.activeAgentConversationId),
        }))
      },

      // Settings
      settings: { ...DEFAULT_SETTINGS },
      previousPresetConfig: null,
      dismissedPresetProfileIds: [],
      dismissPresetProfile: (id) => set((state) => ({
        dismissedPresetProfileIds: state.dismissedPresetProfileIds.includes(id)
          ? state.dismissedPresetProfileIds
          : [...state.dismissedPresetProfileIds, id],
      })),
      restorePresetProfile: (id) => set((state) => ({
        dismissedPresetProfileIds: state.dismissedPresetProfileIds.filter((item) => item !== id),
      })),
      dismissedPresetProviderIds: [],
      dismissPresetProvider: (id) => set((state) => ({
        dismissedPresetProviderIds: state.dismissedPresetProviderIds.includes(id)
          ? state.dismissedPresetProviderIds
          : [...state.dismissedPresetProviderIds, id],
      })),
      restorePresetProvider: (id) => set((state) => ({
        dismissedPresetProviderIds: state.dismissedPresetProviderIds.filter((item) => item !== id),
      })),
      setSettings: (s) => set((st) => {
        const previous = normalizeSettings(st.settings)
        const incoming = s as Partial<AppSettings>
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.apiKey !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.codexCli !== undefined ||
          incoming.apiProxy !== undefined ||
          incoming.streamImages !== undefined ||
          incoming.streamPartialImages !== undefined
        const merged = normalizeSettings({ ...previous, ...incoming })
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) =>
            profile.id === merged.activeProfileId
              ? {
                  ...profile,
                  baseUrl: incoming.baseUrl ?? profile.baseUrl,
                  apiKey: incoming.apiKey ?? profile.apiKey,
                  model: incoming.model ?? profile.model,
                  timeout: incoming.timeout ?? profile.timeout,
                  apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
                  codexCli: incoming.codexCli ?? profile.codexCli,
                  apiProxy: incoming.apiProxy ?? profile.apiProxy,
                  streamImages: incoming.streamImages ?? profile.streamImages,
                  streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
                }
              : profile,
          )
        }
        const effectiveDismissedPresetProviderIds = st.dismissedPresetProviderIds.filter((id) =>
          !isPresetProviderDeletionPrevented(id, previous.profiles),
        )
        const settings = normalizeWorkspaceSettings(enforcePresetConfigPolicy(merged, {
          dismissedPresetProviderIds: effectiveDismissedPresetProviderIds,
        }))
        const shouldClearReusedProfile = st.reusedTaskApiProfileId && (settings.activeProfileId === st.reusedTaskApiProfileId || (incoming.activeProfileId !== undefined && incoming.activeProfileId !== previous.activeProfileId))
        return {
          settings,
          ...(shouldClearReusedProfile
            ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
            : {}),
        }
      }),
      setPresetImportedSettings: async (importedSettings, transform) => {
        set((state) => {
          const presetIds = getPresetProfileIds()
          const presetProviderIds = getPresetProviderIds()
          const dismissedPresetProfileIds = state.dismissedPresetProfileIds.filter((id) => presetIds.has(id))
          const deletionPrevented = isPresetConfigDeletionPrevented()
          const remainingPresetProfiles = (getPresetConfig()?.profiles ?? state.settings.profiles)
            .filter((profile) => !dismissedPresetProfileIds.includes(profile.id))
          const dismissedPresetProviderIds = state.dismissedPresetProviderIds
            .filter((id) => presetProviderIds.has(id))
          const effectiveDismissedPresetProviderIds = dismissedPresetProviderIds
            .filter((id) => !isPresetProviderDeletionPrevented(id, remainingPresetProfiles))
          const merged = mergePresetImportedSettings(state.settings, importedSettings, {
            lockPresetParams: isPresetConfigParamsLocked(),
            dismissedPresetProfileIds: deletionPrevented ? [] : dismissedPresetProfileIds,
            dismissedPresetProviderIds: effectiveDismissedPresetProviderIds,
            previousPresetConfig: state.previousPresetConfig,
            usedPresetProfileIds: state.tasks.flatMap((task) => task.apiProfileId ? [task.apiProfileId] : []),
          })
          const settings = normalizeWorkspaceSettings(enforcePresetConfigPolicy(
            normalizeSettings(transform?.(merged.settings) ?? merged.settings),
            { dismissedPresetProviderIds: effectiveDismissedPresetProviderIds },
          ))
          const shouldClearReusedProfile = state.reusedTaskApiProfileId && settings.activeProfileId === state.reusedTaskApiProfileId
          return {
            settings,
            previousPresetConfig: getPresetConfig() ? merged.presetConfig : null,
            dismissedPresetProfileIds,
            dismissedPresetProviderIds,
            reusedTaskApiProfileId: shouldClearReusedProfile ? null : state.reusedTaskApiProfileId,
            ...(shouldClearReusedProfile
              ? { reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
              : {}),
          }
        })
      },
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      creationDraftUndo: null,
      promptTemplates: [],
      promptCategories: DEFAULT_PROMPT_CATEGORIES,
      setPromptTemplates: (templates, categories) => savePersonalPromptChange(() => typeof templates === 'function' ? templates(get().promptTemplates) : templates, (promptTemplates, promptCategories) => set({ promptTemplates, promptCategories }), () => typeof categories === 'function' ? categories(get().promptCategories) : categories ?? get().promptCategories).catch((err) => { console.warn('Personal prompt save failed', err); get().showToast(err instanceof Error ? err.message : t('个人提示词保存失败，原数据保留。', 'Could not save personal prompts. The original data is preserved.'), 'error'); return false }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => itemIdx === idx ? img : item)
          return syncActiveInputDraft(s, updateInputDraftImages(s, inputImages, {
            equivalentImageIds: { [previous.id]: img.id },
            clearMissingMask: previous.id === s.maskDraft?.targetImageId,
          }))
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          return syncActiveInputDraft(s, updateInputDraftImages(s, inputImages, {
            clearMissingMask: removed?.id === s.maskDraft?.targetImageId,
          }))
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) deleteCachedImage(img.id)
          return syncActiveInputDraft(s, {
            ...updateInputDraftImages(s, []),
            maskDraft: null,
            maskEditorImageId: null,
          })
        }),
      setInputImages: (imgs, options) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          return syncActiveInputDraft(s, updateInputDraftImages(s, inputImages, {
            equivalentImageIds: options?.equivalentImageIds,
          }))
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, updateInputDraftImages(s, images, { clearMissingMask: false }))
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            maskDraft,
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        }),
      clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      setReusedTaskApiProfile: (profileId, missing = false, profileName = null) => set({
        reusedTaskApiProfileId: profileId,
        reusedTaskApiProfileName: profileName,
        reusedTaskApiProfileMissing: missing,
      }),

      // Agent
      agentConversations: [],
      agentConversationSaveError: null,
      agentConversationsLoaded: false,
      activeAgentConversationId: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: true,
      agentMobileHeaderVisible: false,
      agentEditingRoundId: null,
      agentEditingConversationId: null,
      agentGeneratingTitleIds: {},
      createAgentConversation: () => {
        const now = Date.now()
        const latestConversation = getLatestAgentConversation(get().agentConversations)
        if (latestConversation && isEmptyAgentConversation(latestConversation)) {
          set((state) => {
            const agentInputDrafts = saveActiveAgentInputDrafts(state)
            return {
              agentConversations: state.agentConversations.map((conversation) =>
                conversation.id === latestConversation.id
                  ? { ...conversation, createdAt: now, updatedAt: now }
                  : conversation,
              ),
              activeAgentConversationId: latestConversation.id,
              agentInputDrafts,
              agentSidebarCollapsed: true,
              agentEditingRoundId: null,
              ...restoreAgentInputDraftState(agentInputDrafts, latestConversation.id),
            }
          })
          return latestConversation.id
        }

        const conversation = createAgentConversation(now)
        set((state) => {
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            agentConversations: [
              ...state.agentConversations,
              conversation,
            ],
            activeAgentConversationId: conversation.id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, conversation.id),
          }
        })
        return conversation.id
      },
      setActiveAgentConversationId: (id) => set((state) => {
        if (state.activeAgentConversationId === id) {
          return {
            activeAgentConversationId: id,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
          }
        }
        const agentInputDrafts = saveActiveAgentInputDrafts(state)
        return {
          activeAgentConversationId: id,
          agentInputDrafts,
          agentSidebarCollapsed: true,
          agentEditingRoundId: null,
          ...restoreAgentInputDraftState(agentInputDrafts, id),
        }
      }),
      setActiveAgentRoundId: (conversationId, roundId) => set((state) => ({
        agentConversations: state.agentConversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, activeRoundId: roundId, updatedAt: Date.now() } : conversation,
        ),
      })),
      renameAgentConversation: (id, title) => set((state) => ({ agentConversations: state.agentConversations.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)) })),
      deleteAgentConversation: (id) => set((state) => {
        const conversation = state.agentConversations.find((item) => item.id === id)
        const relatedIds = getAgentConversationTaskIds(conversation, state.tasks)
        if (conversation?.rounds.some((round) => round.status === 'running') || state.tasks.some((task) => relatedIds.includes(task.id) && task.status === 'running')) return state
        const agentInputDrafts = { ...state.agentInputDrafts }
        delete agentInputDrafts[id]
        const activeDeleted = state.activeAgentConversationId === id
        const agentConversations = state.agentConversations.filter((item) => item.id !== id)
        const nextId = activeDeleted ? getLatestAgentConversation(agentConversations)?.id ?? null : state.activeAgentConversationId
        return {
          agentConversations,
          activeAgentConversationId: nextId,
          agentInputDrafts,
          ...(activeDeleted ? { ...restoreAgentInputDraftState(agentInputDrafts, nextId), agentEditingRoundId: null, creationDraftUndo: null } : {}),
        }
      }),
      deleteAgentRound: (conversationId, roundId) => deleteAgentRoundAndTasks(conversationId, roundId),
      deleteAgentAssistantMessage: (conversationId, messageId) => deleteAgentAssistantMessageAndTasks(conversationId, messageId),
      setAgentSidebarCollapsed: (agentSidebarCollapsed) => set({ agentSidebarCollapsed }),
      setAgentMobileHeaderVisible: (agentMobileHeaderVisible) => set({ agentMobileHeaderVisible }),
      setAgentEditingRoundId: (agentEditingRoundId) => set({ agentEditingRoundId }),
      setAgentEditingConversationId: (agentEditingConversationId) => set({ agentEditingConversationId }),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      favoriteCollections: [createDefaultFavoriteCollection()],
      setFavoriteCollections: (favoriteCollections) => set((state) => {
        const nextCollections = ensureDefaultFavoriteCollection(normalizeFavoriteCollections(favoriteCollections))
        return {
          favoriteCollections: nextCollections,
          defaultFavoriteCollectionId: resolveDefaultFavoriteCollectionId(nextCollections, state.defaultFavoriteCollectionId),
        }
      }),
      defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      setDefaultFavoriteCollectionId: (defaultFavoriteCollectionId) => set((state) => (
        defaultFavoriteCollectionId === null || state.favoriteCollections.some((collection) => collection.id === defaultFavoriteCollectionId)
          ? { defaultFavoriteCollectionId }
          : state
      )),
      activeFavoriteCollectionId: null,
      isManageCollectionsModalOpen: false,
      setActiveFavoriteCollectionId: (activeFavoriteCollectionId) => set({ activeFavoriteCollectionId, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),
      openManageCollectionsModal: () => set({ isManageCollectionsModalOpen: true }),
      closeManageCollectionsModal: () => set({ isManageCollectionsModalOpen: false }),
      favoritePickerTaskIds: null,
      openFavoritePicker: (taskIds) => {
        if (!taskIds.length) return
        dismissAllTooltips()
        set({ favoritePickerTaskIds: Array.from(new Set(taskIds)).filter(Boolean) })
      },
      closeFavoritePicker: () => set({ favoritePickerTaskIds: null }),
      streamPreviews: {},
      streamPreviewSlots: {},
      setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((s) => {
        if (image) {
          if (!s.tasks.some((task) => task.id === taskId)) return s
          const slotKey = String(requestIndex)
          const currentSlots = s.streamPreviewSlots[taskId] ?? {}
          if (s.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return s
          return {
            streamPreviews: { ...s.streamPreviews, [taskId]: image },
            streamPreviewSlots: {
              ...s.streamPreviewSlots,
              [taskId]: { ...currentSlots, [slotKey]: image },
            },
          }
        }

        if (!(taskId in s.streamPreviews) && !(taskId in s.streamPreviewSlots)) return s
        const next = { ...s.streamPreviews }
        const nextSlots = { ...s.streamPreviewSlots }
        delete next[taskId]
        delete nextSlots[taskId]
        return { streamPreviews: next, streamPreviewSlots: nextSlots }
      }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set(filterFavorite ? { filterFavorite, selectedTaskIds: [], selectedFavoriteCollectionIds: [] } : { filterFavorite, activeFavoriteCollectionId: null, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),
      selectedFavoriteCollectionIds: [],
      setSelectedFavoriteCollectionIds: (updater) => set((s) => ({
        selectedFavoriteCollectionIds: typeof updater === 'function' ? updater(s.selectedFavoriteCollectionIds) : updater
      })),
      toggleFavoriteCollectionSelection: (id, force) => set((s) => {
        const isSelected = s.selectedFavoriteCollectionIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedFavoriteCollectionIds: shouldSelect
            ? [...s.selectedFavoriteCollectionIds, id]
            : s.selectedFavoriteCollectionIds.filter((x) => x !== id)
        }
      }),
      clearFavoriteCollectionSelection: () => set({ selectedFavoriteCollectionIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => {
        if (detailTaskId) dismissAllTooltips()
        set({ detailTaskId })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        const toastMessage = getToastMessage(message, type)
        const toast = { message: toastMessage, type }
        set({ toast })
        setTimeout(() => {
          set((s) => (s.toast === toast ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },
    }),
    {
      name: 'gpt-image-playground',
      version: 2,
      migrate: migratePersistedState,
      partialize: getPersistedState,
      merge: mergePersistedState,
    },
  ),
)

let agentConversationPersistQueued = false

useStore.subscribe((state, previous) => {
  if (state.agentConversations === previous.agentConversations) return
  if (!agentConversationPersistenceReady) {
    agentConversationPersistQueued = true
    return
  }
  const previousById = new Map(previous.agentConversations.map((item) => [item.id, item]))
  const changed = state.agentConversations.filter((item) => previousById.get(item.id) !== item)
  const streaming = state.agentConversations.length === previous.agentConversations.length && changed.length > 0 && changed.every((item) => {
    const running = item.rounds.filter((round) => round.status === 'running').map((round) => round.id).join(',')
    const previousRunning = previousById.get(item.id)?.rounds.filter((round) => round.status === 'running').map((round) => round.id).join(',')
    return running.length > 0 && running === previousRunning
  })
  scheduleAgentConversationSave(streaming)
})

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function getPersistableTask(task: TaskRecord): TaskRecord {
  const rawResponsePayload = getPersistableRawResponsePayload(task.rawResponsePayload)
  return rawResponsePayload === task.rawResponsePayload ? task : { ...task, rawResponsePayload }
}

function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbPutTask(getPersistableTask(task))
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.baseUrl}\n${profile.apiKey}`
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && (task.apiProvider ?? 'openai') !== 'fal'
}

function isAsyncCustomProviderTask(settings: AppSettings, provider: string, hasInputImages: boolean) {
  const customProvider = getCustomProviderDefinition(settings, provider)
  if (!customProvider?.poll) return false
  const submitMapping = hasInputImages && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
  return Boolean(submitMapping.taskIdPath)
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  updateTaskInStore(taskId, {
    ...createTaskErrorPatch(task, error, now),
    falRecoverable: false,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const remainingMs = Math.max(0, timeoutMs - (Date.now() - task.createdAt))
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds, profile))
    if (failed) useStore.getState().showToast(t('OpenAI 任务请求超时', 'OpenAI request timed out'), 'error')
  }, remainingMs)
  openAIWatchdogTimers.set(taskId, timer)
}

function usesConcurrentImageRequests(settings: AppSettings, profile: ApiProfile, params: TaskParams, hasInputImages: boolean) {
  const n = params.n > 0 ? params.n : 1
  if (n <= 1) return false
  if (profile.provider === 'openai') {
    if (profile.apiMode === 'responses') return true
    return profile.apiMode === 'images'
  }
  return profile.provider !== 'fal' && profile.codexCli && !isAsyncCustomProviderTask(settings, profile.provider, hasInputImages)
}

export function taskHasOutputErrors(task: Pick<TaskRecord, 'outputErrors'>) {
  return Boolean(task.outputErrors?.length)
}

export function taskMatchesFilterStatus(task: TaskRecord, filterStatus: AppState['filterStatus']) {
  if (filterStatus === 'all') return true
  if (filterStatus === 'error') return task.status === 'error' || taskHasOutputErrors(task)
  return task.status === filterStatus
}

export function taskMatchesSearchQuery(task: TaskRecord, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const prompt = (task.prompt || '').toLowerCase()
  const paramStr = JSON.stringify(task.params).toLowerCase()
  const errorStr = [task.error, ...(task.outputErrors ?? []).map((item) => item.error)].filter(Boolean).join('\n').toLowerCase()
  return prompt.includes(q) || paramStr.includes(q) || errorStr.includes(q)
}

export function showCodexCliPrompt(force = false, reason = t('接口返回的提示词已被改写', 'The API rewrote the prompt')) {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return
  const promptRewriteGuardMessage = settings.allowPromptRewrite
    ? t('当前已允许模型改写优化提示词，因此不会额外加入不改写要求。', 'Prompt rewriting is enabled, so no additional instruction to preserve the wording will be added.')
    : t('同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。', 'A short instruction to preserve the wording will also be added at the start of the prompt to avoid changing its meaning.')

  state.setConfirmDialog({
    title: t('检测到 Codex CLI API', 'Codex CLI API detected'),
    message: t(`${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。${promptRewriteGuardMessage}`, `${reason}. This API appears to come from Codex CLI.\n\nEnable Codex CLI compatibility mode? This disables unsupported quality settings and uses concurrent requests for multiple images through the Images API. ${promptRewriteGuardMessage}`),
    confirmText: t('开启', 'Enable'),
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === 'fal' && task.apiProvider === 'fal') return taskProfile
  return null
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile && taskProfile.provider === task.apiProvider && taskProfile.provider !== 'openai' && taskProfile.provider !== 'fal') return taskProfile
  return null
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  if (!task.apiProfileId) return null
  const profile = normalized.profiles.find((profile) => profile.id === task.apiProfileId)
  return profile ? { ...profile, model: task.apiModelSelected ? task.apiModel?.trim() || profile.model : profile.model } : null
}

function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    galleryModel: '',
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) => item.id === profile.id ? profile : item),
    activeProfileId: profile.id,
  })
}

function getAgentProfileValidationError(settings: AppSettings): { profile: ApiProfile | null; message: string } | null {
  const normalized = normalizeSettings(settings)
  const textProfile = getAgentTextApiProfile(normalized)
  if (!textProfile || textProfile.provider !== 'openai' || textProfile.apiMode !== 'responses') {
    return { profile: textProfile, message: t('Agent 模式需要使用支持 Responses API 的 OpenAI 兼容文本模型配置。', 'Agent mode requires an OpenAI-compatible text model profile that supports the Responses API.') }
  }
  const textProfileError = validateApiProfile(textProfile)
  if (textProfileError) return { profile: textProfile, message: t(`文本模型 API 配置不完整：${textProfileError}`, `The chat model API profile is incomplete: ${textProfileError}`) }


  return null
}

function getReusedTaskApiProfile(settings: AppSettings, profileId: string | null): ApiProfile | null {
  if (!profileId) return null
  return normalizeSettings(settings).profiles.find((profile) => profile.id === profileId) ?? null
}

function isNetworkRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function getApiModeApiName(apiMode: ApiMode) {
  return apiMode === 'responses' ? 'Responses API' : 'Image API'
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return t('提示：请求立即失败，请检查 API 代理服务是否正常运行。', 'The request failed immediately. Check that the API proxy is running.')
    }
    const unsupportedApiHint = profile?.provider === 'openai'
      ? t(`\n· API 不支持 ${getApiModeApiName(profile.apiMode)}`, `\n· The API does not support ${getApiModeApiName(profile.apiMode)}`)
      : ''
    return t(`提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求；可改用桌面版，或为本地开发服务配置 API 代理。`, `The request failed immediately. Possible causes:\n· The API server is unreachable or the URL is incorrect. Check the URL and service status.${unsupportedApiHint}\n· The API does not allow browser cross-origin requests. Use the desktop app, or configure an API proxy for the local development server.`)
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return t(`提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`, `The connection closed after about 60 seconds. This is often the default timeout of a reverse proxy such as Nginx. Increase its timeout (for example, proxy_read_timeout), or reduce image size or quality. ${getTimeoutStreamingHint(profile)}`)
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return t(`提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`, `The connection closed after about 120 seconds. This is often a CDN or gateway timeout, such as Cloudflare. Check the plan limits or use a direct URL that bypasses the CDN. ${getTimeoutStreamingHint(profile)}`)
  }

  return t(`提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`, `The connection closed after a long wait. Check the reverse proxy or gateway timeout, or reduce image size or quality. ${getTimeoutStreamingHint(profile)}`)
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload = 'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls: Array.isArray(rawImageUrls) && rawImageUrls.length ? rawImageUrls.filter((url): url is string => typeof url === 'string') : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  if (!useStore.getState().tasks.some((task) => task.id === taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId)) return
  if (!useStore.getState().tasks.some((task) => task.id === taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
  sizes?: Array<{ width?: number; height?: number } | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  const withStoredSizes = images.map((_, index) => addImageSizeParam(preferred?.[index], sizes?.[index]))
  if (withStoredSizes.every(hasActualSizeParam)) {
    return withStoredSizes
  }
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => {
    const params = withStoredSizes[index]
    const fallbackParams = fallback[index]
    if (hasActualSizeParam(params)) return params
    if (fallbackParams?.size) return { ...(params ?? {}), size: fallbackParams.size }
    return hasActualParams(params) ? params : fallbackParams
  })
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done' || isAgentStoppedMessage(latest.error)) return
  if (latest.status !== 'running' && !latest.falRecoverable) return

  const { outputIds, outputDataUrls, outputImageSizes, transparentOriginalImageIds } = await storeTaskOutputImages(task, result.images)
  const actualParamsList = await resolveImageSizeParamsList(outputDataUrls, result.actualParamsList, outputImageSizes)
  const latestBeforeUpdate = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latestBeforeUpdate || latestBeforeUpdate.status === 'done' || isAgentStoppedMessage(latestBeforeUpdate.error) || (latestBeforeUpdate.status !== 'running' && !latestBeforeUpdate.falRecoverable)) {
    await deleteUnreferencedImageIds([...outputIds, ...(transparentOriginalImageIds ?? [])])
    return
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    transparentOriginalImages: transparentOriginalImageIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    ...createTaskDonePatch(task, Date.now()),
    falRecoverable: false,
  })
  useStore.getState().showToast(t(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, `fal.ai task recovered: ${outputIds.length} images`), 'success')
  if (!isAgentTask(task)) showTaskCompletionNotification(t('图像生成完成', 'Image generation complete'), t(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片。`, `fal.ai task recovered: ${outputIds.length} images.`))
  else void continueRecoveredAgentRound(task.id)
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
    clearFalRecoveryTimer(taskId)
    await completeRecoveredFalTask(task, result)
    return
  } catch (err) {
    if (!useStore.getState().tasks.some((item) => item.id === taskId)) return
    if (isNetworkRecoverableError(err)) {
      scheduleFalRecovery(taskId)
      return
    }

    clearFalRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      ...createTaskErrorPatch(task, getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)), Date.now()),
      ...getRawErrorPayload(err),
      falRecoverable: false,
    })
    if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
  }
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并清理孤立图片 */
export async function initStore() {
  const legacyAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  const storedTasks = await getAllTasks()
  const storedAgentConversations = normalizeAgentConversations(await getAllAgentConversations())
  let loadedAgentConversations = mergePersistedAgentConversations(storedAgentConversations, legacyAgentConversations)
  const currentAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  loadedAgentConversations = mergePersistedAgentConversations(loadedAgentConversations, currentAgentConversations)
  const activeAgentConversationId = useStore.getState().activeAgentConversationId && loadedAgentConversations.some((conversation) => conversation.id === useStore.getState().activeAgentConversationId)
    ? useStore.getState().activeAgentConversationId
    : loadedAgentConversations[0]?.id ?? null
  if (loadedAgentConversations.length > 0 || legacyAgentConversations.length > 0) {
    useStore.setState((state) => {
      const agentInputDrafts = cleanStaleAgentInputDrafts(
        normalizeAgentInputDrafts(state.agentInputDrafts, loadedAgentConversations),
        activeAgentConversationId,
      )
      return {
        agentConversations: loadedAgentConversations,
        agentConversationsLoaded: true,
        activeAgentConversationId,
        agentInputDrafts,
        ...(state.appMode === 'agent' ? restoreAgentInputDraftState(agentInputDrafts, activeAgentConversationId) : {}),
      }
    })
    await replaceStoredAgentConversations(loadedAgentConversations)
  } else {
    useStore.setState({ agentConversationsLoaded: true })
  }
  initializeAgentConversationPersistence(loadedAgentConversations)
  const shouldRewritePersistedLocalState = agentConversationMigrationPending
  agentConversationPersistenceReady = true
  agentConversationMigrationPending = false
  if (agentConversationPersistQueued) {
    agentConversationPersistQueued = false
    await flushAgentConversationsToIndexedDB()
  }
  if (shouldRewritePersistedLocalState) {
    useStore.setState({})
  }
  const { tasks: markedTasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks, Date.now())
  const interruptedTaskIds = new Set(interruptedTasks.map((task) => task.id))
  const favoriteState = useStore.getState()
  const normalizedFavorites = normalizeLoadedFavoriteState(markedTasks.map(getPersistableTask), favoriteState.favoriteCollections, favoriteState.defaultFavoriteCollectionId)
  const tasks = normalizedFavorites.tasks
  if (normalizedFavorites.collections !== favoriteState.favoriteCollections) {
    favoriteState.setFavoriteCollections(normalizedFavorites.collections)
  }
  if (normalizedFavorites.defaultFavoriteCollectionId !== favoriteState.defaultFavoriteCollectionId) {
    useStore.getState().setDefaultFavoriteCollectionId(normalizedFavorites.defaultFavoriteCollectionId)
  }
  await Promise.all(tasks
    .filter((task, index) => normalizedFavorites.changed || interruptedTaskIds.has(task.id) || task.rawResponsePayload !== markedTasks[index]?.rawResponsePayload)
    .map((task) => putTask(task)))
  useStore.getState().setTasks(tasks)
  for (const task of tasks) {
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    }
    if (
      task.customTaskId &&
      (task.status === 'running' || task.customRecoverable)
    ) {
      scheduleCustomRecovery(task.id, 0)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const state = useStore.getState()
  const persistedInputImages = state.inputImages
  const galleryInputDraft = state.galleryInputDraft
  const agentConversations = state.agentConversations
  const agentInputDrafts = state.agentInputDrafts
  for (const img of persistedInputImages) referencedIds.add(img.id)
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) referencedIds.add(img.id)
  }
  for (const draft of Object.values(agentInputDrafts)) {
    for (const img of draft.inputImages) referencedIds.add(img.id)
  }
  for (const conversation of agentConversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) referencedIds.add(id)
    }
  }
  for (const t of tasks) {
    addTaskReferencedImageIds(referencedIds, t)
  }

  // 只枚举 key 清理孤立图片，避免启动时把所有 4K 原图读进内存。
  const imageIds = await getAllImageIds()
  const referencedImageIds: string[] = []
  for (const imgId of imageIds) {
    if (referencedIds.has(imgId)) {
      referencedImageIds.push(imgId)
    } else {
      await deleteImage(imgId)
    }
  }
  scheduleThumbnailBackfill(referencedImageIds)

  const restoredInputImages: InputImage[] = []
  for (const img of persistedInputImages) {
    if (img.dataUrl) {
      restoredInputImages.push(img)
      cacheImage(img.id, img.dataUrl)
      continue
    }
    const storedImage = await getImage(img.id)
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
      cacheImage(img.id, storedImage.dataUrl)
    }
  }
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  if (galleryInputDraft) {
    const restoredGalleryImages: InputImage[] = []
    for (const img of galleryInputDraft.inputImages) {
      if (img.dataUrl) {
        restoredGalleryImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = await getImage(img.id)
      if (storedImage?.dataUrl) {
        restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }
    const restoredGalleryDraft: AgentInputDraft = {
      ...galleryInputDraft,
      ...updateInputDraftImages(galleryInputDraft, restoredGalleryImages),
    }
    const shouldClearMask = galleryInputDraft.maskDraft !== restoredGalleryDraft.maskDraft
    const galleryDraftsChanged =
      restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
      restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    if (galleryDraftsChanged) {
      const latestState = useStore.getState()
      const nextGalleryInputDraft = isEmptyAgentInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
      useStore.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === 'gallery'
          ? restoreGalleryInputDraftState(nextGalleryInputDraft)
          : {}),
      })
    }
  }

  const restoredAgentInputDrafts: Record<string, AgentInputDraft> = {}
  let agentDraftsChanged = false
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    const restoredDraftImages: InputImage[] = []
    for (const img of draft.inputImages) {
      if (img.dataUrl) {
        restoredDraftImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = await getImage(img.id)
      if (storedImage?.dataUrl) {
        restoredDraftImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }

    const restoredDraft: AgentInputDraft = {
      ...draft,
      ...updateInputDraftImages(draft, restoredDraftImages),
    }
    const shouldClearMask = draft.maskDraft !== restoredDraft.maskDraft
    if (!isEmptyAgentInputDraft(restoredDraft)) restoredAgentInputDrafts[conversationId] = restoredDraft
    if (
      restoredDraftImages.length !== draft.inputImages.length ||
      restoredDraftImages.some((img, index) => img.dataUrl !== draft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    ) {
      agentDraftsChanged = true
    }
  }
  if (agentDraftsChanged) {
    const latestState = useStore.getState()
    useStore.setState({
      agentInputDrafts: restoredAgentInputDrafts,
      ...(latestState.appMode === 'agent'
        ? restoreAgentInputDraftState(restoredAgentInputDrafts, latestState.activeAgentConversationId)
        : {}),
    })
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean } = {}) {
  const { settings, prompt, inputImages, maskDraft, reusedTaskApiProfileId, reusedTaskApiProfileName, reusedTaskApiProfileMissing, showToast, setConfirmDialog } =
    useStore.getState()
  const conversation = useStore.getState().appMode === 'agent' ? getActiveAgentConversation() : null
  if (conversation?.rounds.some((round) => round.status === 'running')) { showToast(t('请等待当前任务完成，或先停止。', 'Wait for the current task to finish, or stop it first.'), 'info'); return }
  const params = getAgentImageParams(conversation ?? undefined, useStore.getState().params)

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = getActiveApiProfile(settings)
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (normalizedSettings.reuseTaskApiProfileTemporarily && (reusedTaskApiProfileId || reusedTaskApiProfileMissing)) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        setConfirmDialog({
          title: t('找不到 API 配置', 'API profile not found'),
      message: t(`找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`, `The original API profile “${reusedTaskApiProfileName || t('未知配置', 'Unknown profile')}” was not found. Submit using the current profile “${activeProfile.name}”?`),
      confirmText: t('使用当前配置提交', 'Submit with current profile'),
      cancelText: t('放弃提交', 'Cancel submission'),
      action: () => {
        void submitTask({ ...options, useCurrentApiProfileWhenReusedMissing: true })
      },
        })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (!usesDesktopPool(normalizedSettings, activeProfile.id) && validateApiProfile(activeProfile)) {
    showToast(t(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, `Complete the API profile first: ${validateApiProfile(activeProfile)}`), 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast(t('请输入提示词', 'Enter a prompt'), 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: t('确认编辑整张图片？', 'Edit the entire image?'),
          message: t('当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？', 'The mask covers the entire image. Submitting may redraw everything. Continue?'),
          confirmText: t('继续提交', 'Continue'),
          tone: 'warning',
          action: () => {
            void submitTask({ ...options, allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  if (conversation) {
    const current = useStore.getState()
    if (current.activeAgentConversationId !== conversation.id || current.agentConversations.find((item) => item.id === conversation.id)?.rounds.some((round) => round.status === 'running')) return
  }

  const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages: orderedInputImages.length > 0 })
  const shouldUseTransparentOutput = (normalizedParams.output_format === 'png' || normalizedParams.output_format === 'webp') && normalizedParams.transparent_output
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false }
  const transparentMeta = taskParams.transparent_output && activeProfile.transparentBackgroundMethod === 'local'
    ? createTransparentOutputMeta(prompt.trim())
    : null
  const normalizedParamPatch = getChangedParams(params, taskParams)
  if (Object.keys(normalizedParamPatch).length) {
    if (conversation) setCurrentAgentImageParams(normalizedParamPatch)
    else useStore.getState().setParams(normalizedParamPatch)
  }

  const taskId = genId()
  const roundId = conversation ? genId() : null
  const userMessageId = conversation ? genId() : null
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: taskParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: orderedInputImages.map((i) => i.id),
    apiModelSelected: Boolean(normalizedSettings.galleryModel && activeProfile.id === normalizedSettings.activeProfileId && !reusedTaskApiProfileId),
    maskTargetImageId,
    maskImageId,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    ...(conversation && roundId && userMessageId ? { sourceMode: 'agent', agentConversationId: conversation.id, agentRoundId: roundId, agentMessageId: userMessageId } : {}),
  }

  if (conversation && roundId && userMessageId) {
    const editingRound = conversation.rounds.find((round) => round.id === useStore.getState().agentEditingRoundId)
    updateAgentConversation(conversation.id, (current) => appendDirectImageRound({ ...current, title: current.rounds.length ? current.title : createAgentConversationTitle(task.prompt, current.title) }, task, roundId, userMessageId, editingRound ? editingRound.parentRoundId ?? null : undefined))
    useStore.getState().setAgentEditingRoundId(null)
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await startDirectImageTask(task, normalizedSettings, false, () => {
    useStore.getState().showToast(t('任务已提交', 'Task submitted'), 'success')
    if ((!conversation || useStore.getState().activeAgentConversationId === conversation.id) && useStore.getState().prompt === prompt && useStore.getState().inputImages === inputImages && (conversation || settings.clearInputAfterSubmit)) {
      useStore.getState().setPrompt('')
      useStore.getState().clearInputImages()
    }
    useStore.getState().setReusedTaskApiProfile(null)
  })
}

async function startDirectImageTask(task: TaskRecord, settings: AppSettings, wait = false, onSaved?: () => void) {
  const controller = new AbortController()
  const key = task.agentConversationId && task.agentRoundId ? getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId) : null
  if (key) agentRoundControllers.set(key, controller)
  const finish = () => {
    if (key && agentRoundControllers.get(key) !== controller) return
    if (key) agentRoundControllers.delete(key)
    if (!task.agentConversationId || !task.agentRoundId) return
    const result = useStore.getState().tasks.find((item) => item.id === task.id)
    updateAgentConversation(task.agentConversationId, (current) => ({ ...current, updatedAt: Date.now(), rounds: current.rounds.map((round) => round.id === task.agentRoundId ? { ...round, status: result?.status === 'done' ? 'done' : 'error', error: result?.status === 'done' ? null : result?.error || t('本地图片任务已停止', 'Local image task stopped'), finishedAt: Date.now() } : round) }))
  }
  try {
    await putTask(task)
  } catch (err) {
    console.warn('Failed to save image task', err)
    const message = t('任务保存失败，未发送图片请求；请重试。', 'Could not save the task. No image request was sent. Try again.')
    useStore.getState().setTasks(useStore.getState().tasks.map((item) => item.id === task.id ? { ...item, ...createTaskErrorPatch(item, message, Date.now()) } : item))
    useStore.getState().showToast(message, 'error')
    finish()
    return
  }
  if (controller.signal.aborted || useStore.getState().tasks.find((item) => item.id === task.id)?.status !== 'running') { finish(); return }
  onSaved?.()
  const execution = executeTask(task.id, { settings, signal: controller.signal }).catch((err) => {
    console.warn('Image task stopped after receiving output', err)
    useStore.getState().showToast(err instanceof Error ? err.message : String(err), 'error')
  }).finally(finish)
  if (wait) await execution
}

function getActiveAgentConversation(): AgentConversation {
  const state = useStore.getState()
  const existing = state.agentConversations.find((conversation) => conversation.id === state.activeAgentConversationId)
  if (existing) return existing

  const id = state.createAgentConversation()
  if (state.appMode === 'agent') useStore.setState((current) => syncActiveInputDraft(current, { prompt: state.prompt, inputImages: state.inputImages, maskDraft: state.maskDraft, maskEditorImageId: state.maskEditorImageId }))
  return useStore.getState().agentConversations.find((conversation) => conversation.id === id)!
}

function updateAgentConversation(conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) {
  useStore.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }))
}

export function setCurrentAgentPreferences(patch: Partial<NonNullable<AgentConversation['preferences']>>) {
  const state = useStore.getState()
  const prompt = state.prompt
  const inputImages = state.inputImages
  const maskDraft = state.maskDraft
  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) return
  updateAgentConversation(conversation.id, (current) => ({ ...current, updatedAt: Date.now(), preferences: { ...getAgentPreferences(state.settings), ...current.preferences, ...patch } }))
  if (!state.activeAgentConversationId) useStore.setState({ prompt, inputImages, maskDraft })
}

export function setCurrentAgentImageParams(patch: Partial<TaskParams>) {
  const state = useStore.getState()
  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) return
  updateAgentConversation(conversation.id, (current) => ({ ...current, updatedAt: Date.now(), imageParams: { ...getAgentImageParams(current, state.params), ...patch } }))
  if (!state.activeAgentConversationId) useStore.setState({ prompt: state.prompt, inputImages: state.inputImages, maskDraft: state.maskDraft })
}

function getAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`
}

function getDeletedActiveAgentTasks(conversationId: string, roundId: string, controller: AbortController) {
  return Array.from(deletedActiveAgentTasks.values())
    .filter((entry) => entry.controller === controller && entry.task.agentConversationId === conversationId && entry.task.agentRoundId === roundId)
    .map((entry) => entry.task)
}

function createAgentAbortError() {
  return new DOMException(t('Agent 请求已停止', 'Agent request stopped'), 'AbortError')
}

function createAgentRecoveryPauseError() {
  const err = new Error('Agent recovery paused')
  err.name = AGENT_RECOVERY_PAUSE_ERROR
  return err
}

function isAgentRecoveryPauseError(err: unknown) {
  return err instanceof Error && err.name === AGENT_RECOVERY_PAUSE_ERROR
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd()
  if (!trimmed) return AGENT_STOPPED_MESSAGE
  if (/(?:已停止生成。|Generation stopped\.)$/.test(trimmed)) return trimmed
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`
}

function markAgentRoundTasksStopped(conversationId: string, roundId: string, now = Date.now()) {
  const runningTasks = useStore.getState().tasks.filter((task) =>
    (task.status === 'running' || task.falRecoverable || task.customRecoverable) &&
    task.agentConversationId === conversationId &&
    task.agentRoundId === roundId,
  )

  for (const task of runningTasks) {
    clearFalRecoveryTimer(task.id)
    clearCustomRecoveryTimer(task.id)
    updateTaskInStore(task.id, {
      ...createTaskErrorPatch(task, AGENT_STOPPED_MESSAGE, now),
      falRecoverable: false,
      customRecoverable: false,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundTasksFailed(
  conversationId: string,
  roundId: string,
  error: string,
  rawResponsePayload?: string,
  shouldFailTask: (task: TaskRecord) => boolean = () => true,
  now = Date.now(),
) {
  const runningTasks = useStore.getState().tasks.filter((task) =>
    task.status === 'running' &&
    task.agentConversationId === conversationId &&
    task.agentRoundId === roundId &&
    shouldFailTask(task),
  )

  for (const task of runningTasks) {
    useStore.getState().setTaskStreamPreview(task.id)
    updateTaskInStore(task.id, {
      ...createTaskErrorPatch(task, error, now),
      ...(rawResponsePayload ? { rawResponsePayload } : {}),
      falRecoverable: false,
      customRecoverable: false,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now()
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now)
  let stoppedRound = false
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId)
    if (!round || round.status !== 'running') return current

    stoppedRound = true
    const existingAssistantMessage = current.messages.find((message) => message.roundId === roundId && message.role === 'assistant')
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: 'error',
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? { ...message, content: appendAgentStoppedMessage(message.content) }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    }
  })
  return stoppedRound || stoppedTasks
}

function appendAgentAssistantMessageContent(conversationId: string, messageId: string, delta: string) {
  if (!delta) return
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId
        ? { ...message, content: `${message.content}${delta}` }
        : message,
    ),
  }))
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  fallbackTitle: string,
) {
  useStore.setState((state) => {
    const next = { ...state.agentGeneratingTitleIds, [conversationId]: true as const }
    return { agentGeneratingTitleIds: next }
  })
  try {
    const imageDataUrls = await readAgentImageDataUrls(inputImageIds)
    const title = await callAgentConversationTitleApi({
      settings: requestSettings,
      profile: activeProfile,
      prompt,
      imageDataUrls,
    })
    if (!title || title === fallbackTitle) return

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0]
      if (!firstRound || firstRound.prompt !== prompt || current.title !== fallbackTitle) return current
      return { ...current, title, updatedAt: Date.now() }
    })
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    useStore.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds }
      delete next[conversationId]
      return { agentGeneratingTitleIds: next }
    })
  }
}

export function stopAgentResponse(conversationId = useStore.getState().activeAgentConversationId) {
  if (!conversationId) return
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const activeRunningRound = [...getActiveAgentRounds(conversation)].reverse().find((round) => round.status === 'running')
  const runningRound = activeRunningRound ?? conversation.rounds.find((round) => round.status === 'running')
  if (!runningRound) return

  const controller = agentRoundControllers.get(getAgentRoundControllerKey(conversationId, runningRound.id))
  if (controller) {
    controller.abort()
    if (markAgentRoundStopped(conversationId, runningRound.id)) {
      useStore.getState().showToast(t('已停止生成', 'Generation stopped'), 'info')
    }
    return
  }

  markAgentRoundStopped(conversationId, runningRound.id)
  useStore.getState().showToast(t('已停止生成', 'Generation stopped'), 'info')
}

function addAgentReferencedImageIds(target: Set<string>, conversations = useStore.getState().agentConversations, inputDrafts = useStore.getState().agentInputDrafts) {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) target.add(id)
      if (round.maskImageId) target.add(round.maskImageId)
    }
    for (const message of conversation.messages) {
      if (message.maskImageId) target.add(message.maskImageId)
    }
  }
  for (const draft of Object.values(inputDrafts)) {
    for (const img of draft.inputImages) target.add(img.id)
  }
  const undo = useStore.getState().creationDraftUndo
  if (undo) for (const draft of [undo.before, undo.after]) for (const img of draft.inputImages) target.add(img.id)
}

function addInputDraftReferencedImageIds(target: Set<string>, draft: AgentInputDraft | null) {
  if (!draft) return
  for (const img of draft.inputImages) target.add(img.id)
}

function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.transparentOriginalImages || []) {
    if (id) target.add(id)
  }
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

async function storeTaskOutputImages(task: TaskRecord, images: string[]) {
  const outputIds: string[] = []
  const outputDataUrls: string[] = []
  const outputImageSizes: Array<{ width?: number; height?: number }> = []
  const transparentOriginalImageIds: string[] = []
  const storedImageIds: string[] = []

  try {
    for (const dataUrl of images) {
      let outputDataUrl = dataUrl
      if (task.transparentOutput) {
        const original = await storeImageWithSize(dataUrl, 'generated')
        storedImageIds.push(original.id)
        cacheImage(original.id, dataUrl)

        try {
          outputDataUrl = task.params.output_format === 'webp'
            ? await removeKeyedBackgroundFromDataUrl(dataUrl, undefined, 'webp', task.params.output_compression)
            : await removeKeyedBackgroundFromDataUrl(dataUrl)
          transparentOriginalImageIds.push(original.id)
        } catch (err) {
          console.warn(t('透明背景后处理失败，已回退为原始输出', 'Transparent background processing failed. Using the original output.'), err)
          outputIds.push(original.id)
          outputDataUrls.push(dataUrl)
          outputImageSizes.push(original)
          transparentOriginalImageIds.push('')
          continue
        }
      }

      const stored = await storeImageWithSize(outputDataUrl, 'generated')
      storedImageIds.push(stored.id)
      cacheImage(stored.id, outputDataUrl)
      outputIds.push(stored.id)
      outputDataUrls.push(outputDataUrl)
      outputImageSizes.push(stored)
    }

    return {
      outputIds,
      outputDataUrls,
      outputImageSizes,
      transparentOriginalImageIds: transparentOriginalImageIds.length ? transparentOriginalImageIds : undefined,
    }
  } catch (err) {
    await deleteUnreferencedImageIds(storedImageIds)
    throw err
  }
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const { tasks, inputImages, galleryInputDraft } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue
    await deleteStoredImageIfUnreferenced(imgId)
  }
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    updateTaskInStore(taskId, { streamPartialImageIds: [...currentIds, imgId] })
  } catch (err) {
    console.error(err)
  }
}

async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) dataUrls.push(dataUrl)
  }
  return dataUrls
}

function scrubAgentOutputPayloadsForDeletedTasks(deletedTasks: TaskRecord[]) {
  const deletedByRound = new Map<string, TaskRecord[]>()
  const affectedConversationIds = new Set<string>()
  for (const task of deletedTasks) {
    if (task.sourceMode !== 'agent' || !task.agentConversationId || !task.agentRoundId) continue
    const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
    deletedByRound.set(key, [...(deletedByRound.get(key) ?? []), task])
    affectedConversationIds.add(task.agentConversationId)
  }
  if (deletedByRound.size === 0) return { updatedTasks: [], updatedConversations: [] }

  const updatedTasks: TaskRecord[] = []
  const updatedConversations: AgentConversation[] = []
  useStore.setState((state) => {
    const tasksByRound = new Map<string, TaskRecord[]>()
    for (const task of [...state.tasks, ...deletedTasks]) {
      if (!task.agentConversationId || !task.agentRoundId) continue
      const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
      if (!deletedByRound.has(key)) continue
      tasksByRound.set(key, [...(tasksByRound.get(key) ?? []), task])
    }
    const roundsByKey = new Map<string, AgentRound>()
    let conversationsChanged = false
    const agentConversations = state.agentConversations.map((conversation) => {
      if (!affectedConversationIds.has(conversation.id)) return conversation
      let changed = false
      const rounds = conversation.rounds.map((round) => {
        const key = getAgentRoundControllerKey(conversation.id, round.id)
        const roundDeletedTasks = deletedByRound.get(key)
        if (!roundDeletedTasks) return round
        roundsByKey.set(key, round)
        if (!round.responseOutput?.length) return round
        const responseOutput = scrubResponseOutputForDeletedAgentTasks(round, round.responseOutput, roundDeletedTasks, tasksByRound.get(key) ?? roundDeletedTasks)
        if (responseOutput === round.responseOutput) return round
        changed = true
        return { ...round, responseOutput }
      })
      if (!changed) return conversation
      conversationsChanged = true
      const updated = { ...conversation, rounds }
      updatedConversations.push(updated)
      return updated
    })
    const tasks = state.tasks.map((task) => {
      if (!task.agentConversationId || !task.agentRoundId) return task
      const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
      const roundDeletedTasks = deletedByRound.get(key)
      if (!roundDeletedTasks) return task
      const round = roundsByKey.get(key)
      if (!round) return task
      const scrubbed = scrubTaskRawResponsePayloadForDeletedTasks(task, round, roundDeletedTasks, tasksByRound.get(key) ?? roundDeletedTasks)
      if (scrubbed.rawResponsePayload === task.rawResponsePayload) return task
      updatedTasks.push(scrubbed)
      return scrubbed
    })
    if (!conversationsChanged && updatedTasks.length === 0) return state
    return {
      ...(conversationsChanged ? { agentConversations } : {}),
      ...(updatedTasks.length > 0 ? { tasks } : {}),
    }
  })
  return { updatedTasks, updatedConversations }
}

async function persistTaskDeletionCleanup(deletedTaskIds: string[], cleanup: ReturnType<typeof scrubAgentOutputPayloadsForDeletedTasks>) {
  const taskIds = new Set(cleanup.updatedTasks.map((item) => item.id))
  const conversationIds = new Set(cleanup.updatedConversations.map((item) => item.id))
  await persistAgentConversationChanges(async (changed, removedIds) => {
    const currentTasks = useStore.getState().tasks
    const tasks = currentTasks.filter((item) => taskIds.has(item.id)).map(getPersistableTask)
    const presentIds = new Set(currentTasks.map((item) => item.id))
    const removedTaskIds = deletedTaskIds.filter((id) => !presentIds.has(id))
    const conversationsById = new Map(changed.map((item) => [item.id, item]))
    for (const item of useStore.getState().agentConversations) {
      if (conversationIds.has(item.id)) conversationsById.set(item.id, getPersistableAgentConversation(item))
    }
    const conversations = [...conversationsById.values()]
    try {
      await commitTaskDeletion(removedTaskIds, tasks, conversations, removedIds)
    } catch (err) {
      console.warn('原子清理任务关联数据失败，改用逐项持久化', err)
      await Promise.all([
        ...removedTaskIds.map((taskId) => dbDeleteTask(taskId)),
        ...tasks.map((task) => dbPutTask(task)),
      ])
      await commitAgentConversationChanges(conversations, removedIds)
    }
  })
}

function appendAgentRecoveredToolOutputs(conversationId: string, roundId: string, additions: ResponsesOutputItem[]) {
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    rounds: current.rounds.map((round) => {
      if (round.id !== roundId) return round
      const output = round.responseOutput ?? []
      const existingOutputCallIds = getAgentFunctionOutputCallIds(output)
      const nextAdditions = additions.filter((item) => item.call_id && !existingOutputCallIds.has(item.call_id))
      return nextAdditions.length > 0
        ? { ...round, responseOutput: [...output, ...nextAdditions] }
        : round
    }),
  }))
}

async function continueRecoveredAgentRound(taskId: string) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task?.agentConversationId || !task.agentRoundId) return

  const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
  if (agentRoundControllers.has(key) || agentRecoveryContinuations.has(key)) return

  agentRecoveryContinuations.add(key)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === task.agentConversationId)
    const round = conversation?.rounds.find((item) => item.id === task.agentRoundId)
    if (!conversation || !round || round.status === 'done' || isAgentStoppedMessage(round.error)) return

    const failRound = (error: string) => {
      updateAgentConversation(conversation.id, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((currentRound) =>
          currentRound.id === round.id
            ? { ...currentRound, status: 'error', error, finishedAt: Date.now() }
            : currentRound,
        ),
      }))
    }

    const recovered = createReadyAgentRecoveredToolState(round, latestState.tasks)
    if (!recovered) return

    appendAgentRecoveredToolOutputs(conversation.id, round.id, recovered.additions)
    const updatedState = useStore.getState()
    const updatedConversation = updatedState.agentConversations.find((item) => item.id === conversation.id)
    const updatedRound = updatedConversation?.rounds.find((item) => item.id === round.id)
    if (!updatedConversation || !updatedRound) return

    if (!recovered.allSuccessful) {
      failRound(getAgentRecoveredFailureError(updatedRound, updatedState.tasks))
      return
    }

    const normalizedSettings = normalizeSettings(withConversationPreferences(updatedState.settings, updatedConversation))
    const agentValidationError = getAgentProfileValidationError(normalizedSettings)
    if (agentValidationError) {
      failRound(t(`无法继续恢复任务：${agentValidationError.message}`, `Cannot resume the task: ${agentValidationError.message}`))
      return
    }
    const activeProfile = getAgentTextApiProfile(normalizedSettings)
    const imageProfile = getAgentImageApiProfile(normalizedSettings)
    if (!activeProfile || !imageProfile) {
      failRound(t('Agent API 配置不存在，无法继续恢复任务。', 'The Agent API profile no longer exists. The task cannot resume.'))
      return
    }
    const roundTasks = updatedState.tasks.filter((item) => item.agentRoundId === round.id)
    const resumeParams = roundTasks.find((item) => item.params)?.params
      ?? normalizeParamsForSettings(getAgentImageParams(updatedConversation, updatedState.params), createSettingsForApiProfile(normalizedSettings, imageProfile), { hasInputImages: round.inputImageIds.length > 0 })
    const toolCallsUsed = getAgentRecoveredToolCallCount(updatedRound.responseOutput ?? [], roundTasks)

    updateAgentConversation(conversation.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((currentRound) =>
        currentRound.id === round.id
          ? { ...currentRound, status: 'running', error: null, finishedAt: null }
          : currentRound,
      ),
    }))

    void executeAgentRound(
      conversation.id,
      round.id,
      resumeParams,
      createSettingsForApiProfile(normalizedSettings, activeProfile),
      activeProfile,
      imageProfile,
      Boolean(normalizedSettings.galleryModel && imageProfile.id === normalizedSettings.activeProfileId),
      {
        responseOutput: updatedRound.responseOutput ?? [],
        recoveredTaskIds: recovered.recoveredTaskIds,
        toolCallsUsed,
      },
    )
  } finally {
    agentRecoveryContinuations.delete(key)
  }
}

export async function submitAgentMessage(options: { optimizePrompt?: boolean } = {}) {
  const state = useStore.getState()
  const { settings, prompt, inputImages, maskDraft, showToast } = state
  const conversation = getActiveAgentConversation()
  const params = getAgentImageParams(conversation, state.params)
  const normalizedSettings = normalizeSettings(withConversationPreferences(settings, conversation))

  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(t(`请先完善 Agent API 配置：${agentValidationError.message}`, `Complete the Agent API profile first: ${agentValidationError.message}`), 'error')
    state.setShowSettings(true, 'agent-api')
    return
  }

  const activeProfile = getAgentTextApiProfile(normalizedSettings)!
  const imageProfile = getAgentImageApiProfile(normalizedSettings) ?? activeProfile

  const trimmedPrompt = options.optimizePrompt ? `请只优化下面的图像提示词，保留原意，输出可直接使用的完整提示词。不要生成或修改图片。\n\n${prompt.trim()}` : prompt.trim()
  if (!prompt.trim()) {
    showToast(t('请输入消息', 'Enter a message'), 'error')
    return
  }

  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast(t('请等待生成完成，或先停止生成', 'Wait for generation to finish, or stop it first'), 'info')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        state.clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  const inputImageIds = uniqueIds(orderedInputImages.map((image) => image.id))

  for (const image of orderedInputImages) {
    await storeImage(image.dataUrl)
  }

  const currentConversation = useStore.getState().agentConversations.find((item) => item.id === conversation.id)
  if (useStore.getState().activeAgentConversationId !== conversation.id || currentConversation?.rounds.some((round) => round.status === 'running')) return

  const requestSettings = { ...createSettingsForApiProfile(normalizedSettings, activeProfile), ...(options.optimizePrompt ? { agentImageTools: false } : {}) }
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  const now = Date.now()
  const editingRound = state.agentEditingRoundId
    ? conversation.rounds.find((item) => item.id === state.agentEditingRoundId) ?? null
    : null
  const editingRoundAssistantMessage = editingRound?.assistantMessageId
    ? conversation.messages.find((message) => message.id === editingRound.assistantMessageId) ?? null
    : conversation.messages.find((message) => message.roundId === editingRound?.id && message.role === 'assistant') ?? null
  const editingRoundHasAssistantMessage = Boolean(editingRoundAssistantMessage)
  const editingRoundHasErrorAssistantMessage = Boolean(
    editingRound?.status === 'error' && Boolean(editingRoundAssistantMessage && /^(?:请求失败：|Request failed: )/.test(editingRoundAssistantMessage.content)),
  )
  const editingRoundHasChildren = editingRound
    ? conversation.rounds.some((round) => (round.parentRoundId ?? null) === editingRound.id)
    : false
  const shouldAppendToEditingRound = Boolean(
    editingRound && !editingRoundHasChildren && (!editingRoundHasAssistantMessage || editingRoundHasErrorAssistantMessage),
  )
  const roundId = shouldAppendToEditingRound && editingRound ? editingRound.id : genId()
  const userMessageId = shouldAppendToEditingRound && editingRound ? editingRound.userMessageId : genId()
  const activeRounds = getActiveAgentRounds(conversation)
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null
  const parentRoundId = editingRound ? editingRound.parentRoundId ?? null : activeLeafId
  const parentPath = parentRoundId ? getAgentRoundPath(conversation, parentRoundId) : []
  const normalizedParams = normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: inputImageIds.length > 0 })
  const round: AgentRound = {
    id: roundId,
    ...(options.optimizePrompt ? { requestMode: 'text' } : {}),
    index: shouldAppendToEditingRound && editingRound ? editingRound.index : parentPath.length + 1,
    parentRoundId,
    ...(editingRoundHasErrorAssistantMessage && editingRoundAssistantMessage ? { assistantMessageId: editingRoundAssistantMessage.id } : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: 'user',
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }

  let fallbackTitle: string | null = null
  updateAgentConversation(conversation.id, (current) => {
    const nextTitle = current.rounds.length === 0 ? createAgentConversationTitle(trimmedPrompt, current.title) : current.title
    if (current.rounds.length === 0) fallbackTitle = nextTitle
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage
            if (editingRoundHasErrorAssistantMessage && message.id === editingRoundAssistantMessage?.id) {
              return { ...message, content: '', outputTaskIds: [] }
            }
            return message
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage]

    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => item.id === roundId ? round : item)
        : [...current.rounds, round],
      messages,
    }
  })

  state.setPrompt('')
  state.clearInputImages()
  state.clearMaskDraft()
  state.setAgentEditingRoundId(null)

  if (fallbackTitle) {
    void generateAgentConversationTitle(conversation.id, trimmedPrompt, inputImageIds, requestSettings, activeProfile, fallbackTitle)
  }

  void executeAgentRound(conversation.id, roundId, normalizedParams, requestSettings, activeProfile, imageProfile, Boolean(normalizedSettings.galleryModel && imageProfile.id === normalizedSettings.activeProfileId))
}

export async function regenerateAgentAssistantMessage(conversationId: string, roundId: string) {
  const state = useStore.getState()
  const { settings, showToast } = state
  const normalizedSettings = normalizeSettings(withConversationPreferences(settings, state.agentConversations.find((item) => item.id === conversationId)))

  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(t(`请先完善 Agent API 配置：${agentValidationError.message}`, `Complete the Agent API profile first: ${agentValidationError.message}`), 'error')
    state.setShowSettings(true, 'agent-api')
    return
  }

  const activeProfile = getAgentTextApiProfile(normalizedSettings)!
  const imageProfile = getAgentImageApiProfile(normalizedSettings) ?? activeProfile

  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const sourceRound = conversation?.rounds.find((item) => item.id === roundId) ?? null
  const sourceUserMessage = sourceRound
    ? conversation?.messages.find((message) => message.id === sourceRound.userMessageId) ?? null
    : null
  if (!conversation || !sourceRound || !sourceUserMessage) {
    showToast(t('找不到要重新生成的 Agent 消息', 'The Agent message to regenerate was not found'), 'error')
    return
  }

  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast(t('请等待生成完成，或先停止生成', 'Wait for generation to finish, or stop it first'), 'info')
    return
  }

  const inputImageIds = uniqueIds(sourceRound.inputImageIds)
  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  if (sourceRound.requestMode === 'text') requestSettings.agentImageTools = false
  const normalizedParams = normalizeParamsForSettings(getAgentImageParams(conversation, state.params), imageRequestSettings, { hasInputImages: inputImageIds.length > 0 })
  const now = Date.now()
  if (sourceRound.status === 'error') {
    const preserveImages = sourceRound.outputTaskIds.length > 0
    const assistantMessageId = sourceRound.assistantMessageId
      ?? conversation.messages.find((message) => message.roundId === sourceRound.id && message.role === 'assistant')?.id
    updateAgentConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: preserveImages ? round.outputTaskIds : [],
              responseId: preserveImages ? round.responseId : undefined,
              responseOutput: preserveImages ? round.responseOutput : undefined,
              status: 'running',
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: preserveImages ? message.outputTaskIds : [] } : message,
          )
        : current.messages,
    }))
    state.setAgentEditingRoundId(null)
    void executeAgentRound(conversationId, sourceRound.id, normalizedParams, preserveImages ? { ...requestSettings, agentImageTools: false } : requestSettings, activeProfile, imageProfile, Boolean(normalizedSettings.galleryModel && imageProfile.id === normalizedSettings.activeProfileId), preserveImages ? { responseOutput: sourceRound.responseOutput ?? [], recoveredTaskIds: sourceRound.outputTaskIds, toolCallsUsed: 0 } : undefined)
    return
  }

  const newRoundId = genId()
  const newUserMessageId = genId()
  const newRound: AgentRound = {
    id: newRoundId,
    ...(sourceRound.requestMode ? { requestMode: sourceRound.requestMode } : {}),
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: 'user',
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    createdAt: now,
  }

  updateAgentConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }))
  state.setAgentEditingRoundId(null)
  void executeAgentRound(conversationId, newRoundId, normalizedParams, requestSettings, activeProfile, imageProfile, Boolean(normalizedSettings.galleryModel && imageProfile.id === normalizedSettings.activeProfileId))
}

async function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  imageProfile: ApiProfile,
  imageModelSelected: boolean,
  resume?: { responseOutput: ResponsesOutputItem[]; recoveredTaskIds: string[]; toolCallsUsed: number },
) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const controllerKey = getAgentRoundControllerKey(conversationId, roundId)
  agentRoundControllers.set(controllerKey, controller)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    const round = conversation.rounds.find((item) => item.id === roundId)
    const userMessage = round ? conversation.messages.find((message) => message.id === round.userMessageId) : null
    if (!round || !userMessage) return
    const maskDataUrl = round.maskImageId ? await ensureImageCached(round.maskImageId) : undefined
    if (round.maskImageId && !maskDataUrl) throw new Error(t('遮罩图片已不存在', 'The mask image no longer exists'))

    const apiInput = await buildAgentApiInput({
      conversation,
      currentRound: round,
      tasks: latestState.tasks,
      loadImage: ensureImageCached,
    })
    if (controller.signal.aborted) throw createAgentAbortError()
    const existingAssistantMessage = round.assistantMessageId
      ? conversation.messages.find((message) => message.id === round.assistantMessageId) ?? null
      : conversation.messages.find((message) => message.roundId === roundId && message.role === 'assistant') ?? null
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    const resumedAssistantContent = resume ? existingAssistantMessage?.content.trim() ?? '' : ''
    let shouldStreamAssistantMessage = activeProfile.streamImages === true
    const agentRouteWarnings: string[] = []
    const imageRequestSettings = createSettingsForApiProfile(requestSettings, imageProfile)
    const imageParams = normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: round.inputImageIds.length > 0 })
    const streamingTaskIds: string[] = resume ? [...round.outputTaskIds] : []
    const taskIdByToolCallId = new Map<string, string>()
    const taskByToolCallId = new Map<string, TaskRecord>()

    const getDeletedAgentTasks = () => {
      const deletedTasks = getDeletedActiveAgentTasks(conversationId, roundId, controller)
      const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
      const currentTaskIds = new Set(useStore.getState().tasks.map((task) => task.id))
      for (const [toolCallId, taskId] of taskIdByToolCallId) {
        const task = taskByToolCallId.get(toolCallId)
        if (task && !currentTaskIds.has(taskId) && !deletedTaskIds.has(taskId)) deletedTasks.push(task)
      }
      return deletedTasks
    }
    const getLatestRound = () => useStore.getState().agentConversations
      .find((item) => item.id === conversationId)
      ?.rounds.find((item) => item.id === roundId)

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return
      streamingTaskIds.push(taskId)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? { ...item, outputTaskIds: item.outputTaskIds.includes(taskId) ? item.outputTaskIds : [...item.outputTaskIds, taskId] }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), taskId])] }
            : message,
        ),
      }))
    }

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = '',
      inputImageIds = round.inputImageIds ?? [],
      options: { createdAt?: number; agentBatchCallId?: string; agentBatchItemId?: string; maskTargetImageId?: string | null; maskImageId?: string | null; taskParams?: TaskParams } = {},
    ) => {
      if (requestSettings.agentImageTools === false) throw new Error(t('本轮仅处理文字，未启用图片生成。', 'This round handles text only. Image generation is disabled.'))
      const existingTaskId = taskIdByToolCallId.get(toolCallId)
      if (existingTaskId) return existingTaskId

      const existingTask = useStore.getState().tasks.find((task) => task.agentToolCallId === toolCallId)
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id)
        taskByToolCallId.set(toolCallId, existingTask)
        attachTaskToAgentRound(existingTask.id)
        return existingTask.id
      }

      const requestedParams = options.taskParams ?? { ...imageParams, n: 1 }
      const taskParams = requestedParams.transparent_output ? getTransparentRequestParams(requestedParams) : requestedParams
      const transparentMeta = taskParams.transparent_output && imageProfile.transparentBackgroundMethod === 'local' ? createTransparentOutputMeta(taskPrompt) : null
      const task: TaskRecord = {
        id: genId(),
        prompt: taskPrompt,
        params: taskParams,
        transparentOutput: transparentMeta?.transparentOutput,
        transparentPrompt: transparentMeta?.effectivePrompt,
        apiProvider: imageProfile.provider,
        apiProfileId: imageProfile.id,
        apiProfileName: imageProfile.name,
        routeWarnings: [...agentRouteWarnings],
        apiMode: imageProfile.apiMode,
        apiModel: imageProfile.model,
        apiModelSelected: imageModelSelected,
        inputImageIds,
        maskTargetImageId: options.maskTargetImageId !== undefined ? options.maskTargetImageId : round.maskTargetImageId ?? null,
        maskImageId: options.maskImageId !== undefined ? options.maskImageId : round.maskImageId ?? null,
        outputImages: [],
        status: 'running',
        error: null,
        createdAt: options.createdAt ?? Date.now(),
        finishedAt: null,
        elapsed: null,
        sourceMode: 'agent',
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId ? { agentBatchCallId: options.agentBatchCallId } : {}),
        ...(options.agentBatchItemId ? { agentBatchItemId: options.agentBatchItemId } : {}),
      }

      taskIdByToolCallId.set(toolCallId, task.id)
      taskByToolCallId.set(toolCallId, task)
      useStore.getState().setTasks([task, ...useStore.getState().tasks])
      attachTaskToAgentRound(task.id)
      await putTask(task)
      return task.id
    }

    const completeAgentImageTask = async (image: AgentApiResultImage, rawResponsePayload?: string) => {
      const toolCallId = image.toolCallId ?? genId()
      const taskId = await ensureStreamingAgentTask(toolCallId)
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (latestTask?.status === 'done' && latestTask.outputImages.length > 0) return { taskId, committed: true }

      const stored = await storeImageWithSize(image.dataUrl, 'generated')
      cacheImage(stored.id, image.dataUrl)
      const latestBeforeUpdate = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestBeforeUpdate) {
        await deleteUnreferencedImageIds([stored.id])
        return { taskId, committed: false }
      }
      const actualParams = deriveAgentImageActualParams(image.actualParams, stored)
      updateTaskInStore(taskId, {
        prompt: image.revisedPrompt ?? latestBeforeUpdate.prompt,
        outputImages: [stored.id],
        actualParams,
        actualParamsByImage: { [stored.id]: actualParams },
        apiProfilesByImage: { [stored.id]: { id: latestBeforeUpdate.apiProfileId ?? imageProfile.id, name: latestBeforeUpdate.apiProfileName ?? imageProfile.name, model: latestBeforeUpdate.apiModel ?? imageProfile.model } },
        revisedPromptByImage: image.revisedPrompt ? { [stored.id]: image.revisedPrompt } : undefined,
        rawResponsePayload,
        ...createTaskDonePatch(latestBeforeUpdate, Date.now()),
        agentToolAction: image.action,
      })
      useStore.getState().setTaskStreamPreview(taskId)
      return { taskId, committed: true }
    }

    const failAgentImageTask = (toolCallId: string, error: string, rawResponsePayload?: string) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId) return
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return

      useStore.getState().setTaskStreamPreview(taskId)
      updateTaskInStore(taskId, {
        ...createTaskErrorPatch(latestTask, error, Date.now()),
        rawResponsePayload,
        falRecoverable: false,
        customRecoverable: false,
      })
    }

    const pauseAgentImageTaskForRecovery = (toolCallId: string, err: unknown) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId || !isNetworkRecoverableError(err)) return false
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return false

      if (latestTask.apiProvider === 'fal' && latestTask.falRequestId && latestTask.falEndpoint) {
        useStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          ...createTaskErrorPatch(latestTask, t('与 fal.ai 的连接已断开，之后会继续查询任务结果。', 'The fal.ai connection was lost. Task results will be checked again later.'), Date.now()),
          falRecoverable: true,
        })
        scheduleFalRecovery(taskId)
        return true
      }

      if (latestTask.customTaskId) {
        useStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          ...createTaskErrorPatch(latestTask, t('与自定义异步任务的连接已断开，之后会继续查询任务结果。', 'The custom asynchronous task connection was lost. Task results will be checked again later.'), Date.now()),
          customRecoverable: true,
        })
        scheduleCustomRecovery(taskId)
        return true
      }

      return false
    }

    if (shouldStreamAssistantMessage) {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId ? { ...item, assistantMessageId } : item,
        ),
        messages: current.messages.some((message) => message.id === assistantMessageId)
          ? current.messages.map((message) => message.id === assistantMessageId
            ? resume
              ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), ...round.outputTaskIds])] }
              : { ...message, content: '', outputTaskIds: [] }
            : message)
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                roundId,
                createdAt: Date.now(),
              },
            ],
      }))
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentToolCallLimit)
      ? Math.max(1, Math.trunc(requestSettings.agentToolCallLimit))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS
    let accumulatedOutputItems: ResponsesOutputItem[] = resume?.responseOutput ?? []
    let accumulatedText = resumedAssistantContent
    const textSegments: string[] = resumedAssistantContent ? [resumedAssistantContent] : []
    let lastResponseId: string | undefined = round.responseId
    let toolCallsUsed = resume?.toolCallsUsed ?? 0
    let apiInputForTurn = apiInput
    if (resume) {
      const resumeState = useStore.getState()
      apiInputForTurn = await buildAgentContinuationInput({
        baseInput: apiInput,
        currentRound: round,
        tasks: resumeState.tasks,
        currentRoundOutput: accumulatedOutputItems,
        batchTaskIds: resume.recoveredTaskIds,
        imageToolsEnabled: requestSettings.agentImageTools,
        toolCallsUsed,
        maxToolCalls,
        loadImage: ensureImageCached,
      })
    }
    let reachedToolLimit = resume ? toolCallsUsed >= maxToolCalls : false
    let pendingToolTextSeparator = false

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (referenceIds: string[]): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = []
      const imageIds: string[] = []
      for (const refId of referenceIds) {
        // Resolve both generated image refs and current/user input refs from XML tags.
        const latestConv = useStore.getState().agentConversations.find((item) => item.id === conversationId)
        if (!latestConv) continue
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          for (let imgIdx = 0; imgIdx < r.inputImageIds.length; imgIdx++) {
            const currentRefId = getAgentCurrentReferenceId(r, imgIdx)
            if (currentRefId === refId) {
              const imageId = r.inputImageIds[imgIdx]
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
          const outputImages = collectAgentRoundOutputImageSlots(r, useStore.getState().tasks)
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx)
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx]
              if (!imageId) continue
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
        }
      }
      return { dataUrls, imageIds }
    }

    const callGalleryImageApi = async (taskId: string) => {
      if (controller.signal.aborted) throw createAgentAbortError()
      if (imageProfile.apiMode !== 'images') throw new Error(t('请在 API 配置 → 画廊中设置 Images 服务。', 'Set up an Images service in Settings & API → API profiles → Image API profiles.'))
      await executeTask(taskId, { settings: imageRequestSettings, signal: controller.signal })
      if (controller.signal.aborted) throw createAgentAbortError()
      const task = useStore.getState().tasks.find((item) => item.id === taskId)
      if (task?.falRecoverable || task?.customRecoverable) throw createAgentRecoveryPauseError()
      return task
    }

    const resolveToolReferences = async (prompt: string) => {
      const ids = uniqueIds(extractAgentReferenceIds(prompt))
      const references = ids.length ? await resolveReferenceImages(ids) : {
        imageIds: [...round.inputImageIds],
        dataUrls: await Promise.all(round.inputImageIds.map(async (id) => await ensureImageCached(id) ?? '')),
      }
      if (ids.length && !references.imageIds.length) throw new Error(t('引用图片不存在，请重新附加图片。', 'The referenced image is missing. Attach it again.'))
      if (references.dataUrls.some((url) => !url) || references.dataUrls.length !== references.imageIds.length) throw new Error(t('引用图片已不存在。', 'The referenced image no longer exists.'))
      if (round.maskTargetImageId && !references.imageIds.includes(round.maskTargetImageId)) {
        const url = await ensureImageCached(round.maskTargetImageId)
        if (!url) throw new Error(t('蒙版对应的原图已不存在。', 'The original image for the mask no longer exists.'))
        references.imageIds.unshift(round.maskTargetImageId)
        references.dataUrls.unshift(url)
      }
      if (round.maskTargetImageId) {
        const index = references.imageIds.indexOf(round.maskTargetImageId)
        references.imageIds.unshift(...references.imageIds.splice(index, 1))
        references.dataUrls.unshift(...references.dataUrls.splice(index, 1))
      }
      return references
    }

    const executeSingleImageFunctionCall = async (functionCallItem: ResponsesOutputItem, batchCallId?: string): Promise<string | null> => {
      const callId = functionCallItem.call_id ?? ''
      let item: ReturnType<typeof parseImageToolArguments>
      try { item = parseImageToolArguments(JSON.parse(functionCallItem.arguments ?? '')) } catch { item = null }
      if (!item) return JSON.stringify({ error: 'Invalid or empty image arguments' })

      const references = await resolveToolReferences(item.prompt)
      const toolCallId = callId || genId()
      const existing = useStore.getState().tasks.find((task) => task.agentToolCallId === toolCallId && task.agentConversationId === conversationId)
      if (existing) return JSON.stringify({ id: item.id, status: existing.status, error: existing.error, note: 'Existing image task; do not resubmit.' })
      if (toolCallsUsed >= maxToolCalls) return JSON.stringify({ error: 'Image tool limit reached' })
      if (functionCallItem.name === 'edit_image' && !references.imageIds.length) return JSON.stringify({ error: 'Editing requires an existing reference image.' })
      toolCallsUsed += 1
      const taskParams = normalizeParamsForSettings(imageParams, imageRequestSettings, { hasInputImages: references.dataUrls.length > 0 })

      const taskId = await ensureStreamingAgentTask(toolCallId, item.prompt, references.imageIds, {
        createdAt: Date.now(),
        taskParams,
        maskTargetImageId: round.maskTargetImageId,
        maskImageId: round.maskImageId,
        agentBatchCallId: batchCallId,
        agentBatchItemId: batchCallId ? item.id : undefined,
      })

      try {
        const result = await callGalleryImageApi(taskId)

        if (controller.signal.aborted) throw createAgentAbortError()
        if (!result) return null
        if (result.status === 'done' && result.outputImages.length && !result.outputErrors?.length) return JSON.stringify({ id: item.id, status: 'done', count: result.outputImages.length })
        const error = result.error ?? result.outputErrors?.map((item) => item.error).join('\n') ?? t('接口未返回图片数据', 'The API returned no image data')
        failAgentImageTask(toolCallId, error, result.rawResponsePayload)
        return JSON.stringify({ id: item.id, status: result.outputImages.length ? 'partial' : 'error', count: result.outputImages.length, error })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        if (controller.signal.aborted) throw createAgentAbortError()
        if (err instanceof Error && err.name === 'ImageOutputStorageError') throw err
        if (isAgentRecoveryPauseError(err)) throw err
        if (pauseAgentImageTaskForRecovery(toolCallId, err)) throw createAgentRecoveryPauseError()
        failAgentImageTask(toolCallId, error)
        return JSON.stringify({ id: item.id, status: 'error', error })
      }
    }

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<string> => {
      const items = parseBatchImageCallArguments(functionCallItem.arguments ?? '')
      if (!items?.length) return JSON.stringify({ error: 'Invalid or empty batch arguments' })
      const callId = functionCallItem.call_id || genId()
      const results = await Promise.allSettled(items.map(async (item) => {
        if (controller.signal.aborted) throw createAgentAbortError()
        const output = await executeSingleImageFunctionCall({ type: 'function_call', name: 'generate_image', call_id: `${callId}:${item.id}`, arguments: JSON.stringify(item) }, callId)
        const task = useStore.getState().tasks.find((task) => task.agentToolCallId === `${callId}:${item.id}`)
        return task && output ? JSON.parse(output) : null
      }))
      if (controller.signal.aborted) throw createAgentAbortError()
      const storageFailure = results.find((result) => result.status === 'rejected' && result.reason instanceof Error && result.reason.name === 'ImageOutputStorageError')
      if (storageFailure?.status === 'rejected') throw storageFailure.reason
      if (results.some((result) => result.status === 'rejected' && isAgentRecoveryPauseError(result.reason))) throw createAgentRecoveryPauseError()
      const images = results.flatMap((result, index) => result.status === 'fulfilled' ? result.value ? [result.value] : [] : [{ id: items[index].id, status: 'error', error: result.reason instanceof Error ? result.reason.message : t('图像任务失败', 'Image task failed') }])
      return JSON.stringify({ images })
    }

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError()
      if (reachedToolLimit) break
      const textBeforeResponse = accumulatedText
      let currentResponseOutputItems: ResponsesOutputItem[] = []
      const result = await callAgentResponsesApi({
        settings: requestSettings,
        onProfileSelected: (profile, reason) => {
          activeProfile = profile
          shouldStreamAssistantMessage = profile.streamImages === true
          if (reason) {
            agentRouteWarnings.push(reason)
            useStore.getState().showToast(reason, 'info')
          }
        },
        profile: activeProfile,
        imageProfile,
        params: imageParams,
        input: apiInputForTurn,
        maskDataUrl,
        signal: controller.signal,
        onTextDelta: (delta) => {
              if (controller.signal.aborted) return
              if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                accumulatedText += '\n\n'
                appendAgentAssistantMessageContent(conversationId, assistantMessageId, '\n\n')
              }
              pendingToolTextSeparator = false
              accumulatedText += delta
              appendAgentAssistantMessageContent(conversationId, assistantMessageId, delta)
            },
        onOutputItems: (outputItems) => {
              if (controller.signal.aborted) return
              currentResponseOutputItems = canonicalizeBatchFunctionCallArguments(outputItems)
              updateAgentConversation(conversationId, (current) => ({
                ...current,
                rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseOutput: mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems) } : item),
              }))
            },
        onImageToolStarted: async ({ toolCallId }) => {
              if (controller.signal.aborted) return
              await ensureStreamingAgentTask(toolCallId)
            },
        onImagePartialImage: async ({ toolCallId, image, partialImageIndex }) => {
              if (controller.signal.aborted) return
              const taskId = await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
              if (partialImageIndex === 0 || partialImageIndex == null) {
                void persistTaskStreamPartialImage(taskId, image)
              }
            },
        onImageToolCompleted: async (image) => {
              if (controller.signal.aborted) return
              await completeAgentImageTask(image)
            },
        onImageToolFailed: async ({ toolCallId, error }) => {
              if (controller.signal.aborted) return
              await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              failAgentImageTask(toolCallId, error)
            },
      })
      if (controller.signal.aborted) throw createAgentAbortError()

      lastResponseId = result.responseId ?? lastResponseId
      currentResponseOutputItems = canonicalizeBatchFunctionCallArguments(
        currentResponseOutputItems.length ? currentResponseOutputItems : result.outputItems ?? [],
      )
      const deletedTasks = getDeletedAgentTasks()
      const currentRound = getLatestRound()
      if (currentRound) {
        currentResponseOutputItems = scrubResponseOutputForDeletedAgentTasks(
          currentRound,
          currentResponseOutputItems,
          deletedTasks,
          [...useStore.getState().tasks, ...deletedTasks],
        )
      }
      accumulatedOutputItems = mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems } : item),
      }))

      const responseText = result.text.trim()
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText ? `\n\n${responseText}` : responseText
        accumulatedText += textToAppend
        if (shouldStreamAssistantMessage) appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
      }
      const newTextInThisResponse = accumulatedText.slice(textBeforeResponse.length).trim()
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse)

      // Process built-in image_generation_call results (single images)
      if (requestSettings.agentImageTools === false && result.images.length) throw new Error(t('本轮仅处理文字，未接收接口返回的图片。', 'This round handles text only. Images returned by the API were not accepted.'))
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          const completed = await completeAgentImageTask(image, result.rawResponsePayload)
          if (!completed.committed) continue
          const completedTaskId = completed.taskId
          const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
          if (promptRefIds.length > 0) {
            const promptRefs = await resolveReferenceImages(promptRefIds)
            if (promptRefs.imageIds.length > 0) {
              const latestTask = useStore.getState().tasks.find((t) => t.id === completedTaskId)
              if (latestTask) {
                const mergedInputIds = uniqueIds([...latestTask.inputImageIds, ...promptRefs.imageIds])
                if (mergedInputIds.length !== latestTask.inputImageIds.length) {
                  updateTaskInStore(completedTaskId, { inputImageIds: mergedInputIds })
                }
              }
            }
          }
          continue
        }
        const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
        const promptRefs = await resolveReferenceImages(promptRefIds)
        const stored = await storeImageWithSize(image.dataUrl, 'generated')
        cacheImage(stored.id, image.dataUrl)
        const actualParams = deriveAgentImageActualParams(image.actualParams, stored)
        const task: TaskRecord = {
          id: genId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params: imageParams,
          apiProvider: imageProfile.provider,
          apiProfileId: imageProfile.id,
          apiProfileName: imageProfile.name,
          routeWarnings: [...agentRouteWarnings],
          apiMode: imageProfile.apiMode,
          apiModel: imageProfile.model,
          inputImageIds: uniqueIds([...(round?.inputImageIds ?? []), ...promptRefs.imageIds]),
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [stored.id],
          actualParams,
          actualParamsByImage: { [stored.id]: actualParams },
          apiProfilesByImage: { [stored.id]: { id: imageProfile.id, name: imageProfile.name, model: imageProfile.model } },
          revisedPromptByImage: image.revisedPrompt ? { [stored.id]: image.revisedPrompt } : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: 'done',
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: 'agent',
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        }
        useStore.getState().setTasks([task, ...useStore.getState().tasks])
        attachTaskToAgentRound(task.id)
        await putTask(task)
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
          if (latestTask && !latestTask.rawResponsePayload) updateTaskInStore(taskId, { rawResponsePayload: result.rawResponsePayload })
        }
      }

      // Check for function calls that require continuation
      const imageFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && (item.name === 'generate_image' || item.name === 'edit_image'),
      )
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image_batch',
      )
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'continue_generation',
      )

      if ((requestSettings.agentImageTools === false || activeProfile.modelCapabilities?.[activeProfile.model]?.tools === false) && (imageFunctionCalls.length || batchFunctionCalls.length || continueFunctionCalls.length)) {
        throw new Error(t('图像工具当前已关闭，未执行接口返回的图像调用。需要生图时请先开启图像工具。', 'Image tools are disabled. The image call returned by the API was not run. Enable image tools to generate images.'))
      }

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = countResponseToolCalls(currentResponseOutputItems)
      toolCallsUsed += responseToolCalls

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = []

      if (imageFunctionCalls.length > 0) {
        for (const fc of imageFunctionCalls) {
          const output = await executeSingleImageFunctionCall(fc)
          if (output == null) continue
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output,
          })
        }
      }

      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const output = await executeBatchFunctionCall(fc)
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output,
          })
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ status: 'continued' }),
        })
      }

      const latestDeletedTasks = getDeletedAgentTasks()
      const cleanedConversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
      const latestRoundForCleanup = cleanedConversation?.rounds.find((item) => item.id === roundId)
      const outputBeforeFunctionResults = latestRoundForCleanup?.responseOutput ?? accumulatedOutputItems
      const mergedOutputItems = mergeResponseOutputItems(outputBeforeFunctionResults, functionCallOutputs)
      const accumulatedOutputItemsWithFunctionOutputs = latestRoundForCleanup
        ? scrubResponseOutputForDeletedAgentTasks(
            latestRoundForCleanup,
            mergedOutputItems,
            latestDeletedTasks,
            [...useStore.getState().tasks, ...latestDeletedTasks],
          )
        : mergedOutputItems
      const generatedOutputCallIds = new Set(functionCallOutputs.map((item) => item.call_id).filter(Boolean))
      const effectiveFunctionCallOutputs = accumulatedOutputItemsWithFunctionOutputs.filter(
        (item) => item.type === 'function_call_output' && item.call_id && generatedOutputCallIds.has(item.call_id),
      )

      // If no function calls need output → model decided the task is done → break
      if (effectiveFunctionCallOutputs.length === 0) {
        accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
        updateAgentConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems } : item),
        }))
        break
      }

      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItemsWithFunctionOutputs } : item),
      }))

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true
        break
      }

      // Build continuation input with function call outputs and available refs
      const continuationState = useStore.getState()
      const latestConversation = continuationState.agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestRound) break

      apiInputForTurn = await buildAgentContinuationInput({
        baseInput: apiInput,
        currentRound: latestRound,
        tasks: continuationState.tasks,
        currentRoundOutput: accumulatedOutputItemsWithFunctionOutputs,
        functionCallOutputs: effectiveFunctionCallOutputs,
        batchTaskIds: streamingTaskIds,
        toolCallsUsed,
        maxToolCalls,
        loadImage: ensureImageCached,
      })
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
      pendingToolTextSeparator = true
    }

    markAgentRoundTasksFailed(
      conversationId,
      roundId,
      t('画廊图像工具未返回图片', 'The image tool returned no images'),
      undefined,
      (task) => Boolean(task.agentToolCallId && !task.agentBatchCallId),
    )

    const latestTasks = useStore.getState().tasks
    const existingTaskIds = new Set(latestTasks.map((task) => task.id))
    const taskIds = streamingTaskIds.filter((taskId) => existingTaskIds.has(taskId))
    const outputIds = taskIds.flatMap((taskId) => latestTasks.find((task) => task.id === taskId)?.outputImages ?? [])
    const latestConversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
    const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
    const deletedTasks = getDeletedAgentTasks()
    const responseOutput = latestRound
      ? scrubResponseOutputForDeletedAgentTasks(latestRound, accumulatedOutputItems, deletedTasks, [...latestTasks, ...deletedTasks])
      : accumulatedOutputItems
    const limitNotice = reachedToolLimit ? t(`已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。`, `The tool call limit (${maxToolCalls}) was reached. Automatic continuation stopped.`) : ''
    const joinedText = textSegments.join('\n\n').trim()
    const finalContent = [joinedText, limitNotice]
      .filter(Boolean)
      .join(joinedText ? '\n\n' : '')
      || (taskIds.length > 0 || outputIds.length > 0 ? t('图像已生成。', 'Image generated.') : '')

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      createdAt: Date.now(),
    }

    updateAgentConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              responseId: lastResponseId,
              responseOutput,
              status: 'done',
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some((message) => message.id === assistantMessageId)
        ? current.messages.map((message) => message.id === assistantMessageId ? assistantMessage : message)
        : [...current.messages, assistantMessage],
    }))

    useStore.getState().showToast(outputIds.length > 0 ? t('Agent 已生成图片', 'Agent generated images') : t('Agent 已回复', 'Agent replied'), 'success')
    showTaskCompletionNotification(
      outputIds.length > 0 ? t('Agent 已生成图片', 'Agent generated images') : t('Agent 已回复', 'Agent replied'),
      outputIds.length > 0 ? t(`Agent 回复已结束，共生成 ${outputIds.length} 张图片。`, `Agent response complete: ${outputIds.length} images generated.`) : t('Agent 回复已结束。', 'Agent response complete.'),
    )
  } catch (err) {
    if (agentRoundControllers.get(controllerKey) !== controller) return
    if (controller.signal.aborted) {
      if (markAgentRoundStopped(conversationId, roundId)) {
        useStore.getState().showToast(t('已停止生成', 'Generation stopped'), 'info')
      }
      return
    }

    if (isAgentRecoveryPauseError(err)) return

    let message = err instanceof Error ? err.message : String(err)
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy
    const networkErrorHint = getApiRequestNetworkErrorHint(err, startedAt, usesApiProxy, activeProfile)
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`
    }

    markAgentRoundTasksFailed(conversationId, roundId, message, getRawErrorPayload(err).rawResponsePayload)

    updateAgentConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId)
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find((item) => item.id === failedRound.assistantMessageId)
        : current.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
      const errorContent = t(`请求失败：${message}`, `Request failed: ${message}`)

      return {
        ...current,
        title: current.rounds.length === 1 && current.rounds[0].id === roundId ? t('新对话', 'New conversation') : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage ? { assistantMessageId: existingAssistantMessage.id } : {}),
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) => item.id === existingAssistantMessage.id ? { ...item, content: errorContent } : item)
          : [
              ...current.messages,
              {
                id: genId(),
                role: 'assistant',
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      }
    })
    useStore.getState().showToast(t(`Agent 请求失败：${message}`, `Agent request failed: ${message}`), 'error')
  } finally {
    if (agentRoundControllers.get(controllerKey) === controller) {
      agentRoundControllers.delete(controllerKey)
    }
    const deletedTasks = getDeletedActiveAgentTasks(conversationId, roundId, controller)
    try {
      const cleanup = scrubAgentOutputPayloadsForDeletedTasks(deletedTasks)
      if (cleanup.updatedTasks.length > 0 || cleanup.updatedConversations.length > 0) {
        await persistTaskDeletionCleanup([], cleanup)
      }
    } catch (err) {
      console.warn('清理已删除 Agent 任务的响应失败', err)
    } finally {
      for (const task of deletedTasks) {
        if (deletedActiveAgentTasks.get(task.id)?.controller === controller) deletedActiveAgentTasks.delete(task.id)
      }
    }
  }
}

export async function generateImageFromAgentMessage(conversationId: string, roundId: string, messageId: string, prompt: string) {
  const state = useStore.getState()
  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const round = conversation?.rounds.find((item) => item.id === roundId)
  if (!round || !conversation || !conversation.messages.some((message) => message.id === messageId) || !prompt.trim() || conversation.rounds.some((item) => item.status === 'running')) return
  const imageProfile = getAgentImageApiProfile(state.settings)
  if (!imageProfile) { state.showToast(t('请先配置画廊 Images API。', 'Configure an Images API profile first.'), 'error'); state.setShowSettings(true, 'api'); return }
  const settings = createSettingsForApiProfile(state.settings, imageProfile)
  const requestedParams = normalizeParamsForSettings(getAgentImageParams(conversation, state.params), settings, { hasInputImages: round.inputImageIds.length > 0 })
  const params = requestedParams.transparent_output ? getTransparentRequestParams(requestedParams) : requestedParams
  const transparentMeta = params.transparent_output && imageProfile.transparentBackgroundMethod === 'local' ? createTransparentOutputMeta(prompt) : null
  const newRoundId = genId()
  const userMessageId = genId()
  const task: TaskRecord = {
    id: genId(), prompt, params, inputImageIds: round.inputImageIds,
    maskTargetImageId: round.maskTargetImageId, maskImageId: round.maskImageId,
    outputImages: [], status: 'running', error: null, createdAt: Date.now(), finishedAt: null, elapsed: null,
    apiProvider: imageProfile.provider, apiProfileId: imageProfile.id, apiProfileName: imageProfile.name, apiMode: 'images', apiModel: imageProfile.model,
    apiModelSelected: Boolean(state.settings.galleryModel && imageProfile.id === state.settings.activeProfileId),
    sourceMode: 'agent', agentConversationId: conversationId, agentRoundId: newRoundId, agentMessageId: userMessageId,
    transparentOutput: transparentMeta?.transparentOutput, transparentPrompt: transparentMeta?.effectivePrompt,
  }
  state.setTasks([task, ...state.tasks])
  updateAgentConversation(conversationId, (current) => appendDirectImageRound(current, task, newRoundId, userMessageId))
  await startDirectImageTask(task, settings, true)
}

async function executeTask(taskId: string, options?: { settings: AppSettings; signal: AbortSignal }) {
  const settings = options?.settings ?? useStore.getState().settings
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'running' || options?.signal.aborted) return
  const taskProfile = getTaskApiProfile(settings, task)
  if (!taskProfile && task.apiProfileId) {
    updateTaskInStore(taskId, {
      ...createTaskErrorPatch(task, t('找不到此任务所使用的 API 配置。', 'The API profile used by this task was not found.'), Date.now()),
      falRecoverable: false,
      customRecoverable: false,
    })
    return
  }
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const requestSettings = createSettingsForApiProfile(settings, activeProfile)
  if (task.apiModelSelected) requestSettings.galleryModel = activeProfile.model
  const taskProvider = taskProfile?.provider ?? task.apiProvider ?? activeProfile.provider
  let falRequestInfo: { requestId: string; endpoint: string } | null = task.falRequestId && task.falEndpoint
        ? { requestId: task.falRequestId, endpoint: task.falEndpoint }
    : null
  let customTaskInfo: { taskId: string } | null = task.customTaskId
    ? { taskId: task.customTaskId }
    : null
  let receivedOutput = false
  const completed = new Map<number, Awaited<ReturnType<typeof storeTaskOutputImages>> & { result: import('./lib/imageApiShared').CallApiResult }>()


  try {
    // 获取输入图片 data URLs
    options?.signal.throwIfAborted()
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error(t('输入图片已不存在', 'The input image no longer exists'))
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error(t('遮罩图片已不存在', 'The mask image no longer exists'))
    }

    const requestPrompt = task.transparentOutput && task.transparentPrompt
      ? task.transparentPrompt
      : task.prompt

    options?.signal.throwIfAborted()
    if (useStore.getState().tasks.find((item) => item.id === taskId)?.status !== 'running') return
    const result = await callImageApi({
      settings: requestSettings,
      signal: options?.signal,
      prompt: replaceImageMentionsForApi(requestPrompt, inputDataUrls.length),
      params: task.params,
      nativeTransparentBackground: task.params.transparent_output && !task.transparentOutput,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      skipCodexCliSizePrompt: task.sourceMode === 'agent',
      onRequestStarted: () => {
        if (taskProvider !== 'fal' && !isAsyncCustomProviderTask(requestSettings, taskProvider, task.inputImageIds.length > 0) && !usesConcurrentImageRequests(requestSettings, activeProfile, task.params, task.inputImageIds.length > 0)) scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
      },
      onImageCompleted: async (result, requestIndex) => {
        if (!useStore.getState().tasks.some((item) => item.id === taskId)) return
        try {
          const stored = await storeTaskOutputImages(task, result.images)
          const current = useStore.getState().tasks.find((item) => item.id === taskId)
          if (!current) { await deleteUnreferencedImageIds([...stored.outputIds, ...(stored.transparentOriginalImageIds ?? [])]); return }
          completed.set(requestIndex, { ...stored, result })
          const parts = [...completed].sort(([a], [b]) => a - b).map(([, part]) => part)
          const ids = parts.flatMap((part) => part.outputIds)
          const sizes = parts.flatMap((part) => part.outputIds.map((_, index) => addImageSizeParam(part.result.actualParamsList?.[index] ?? part.result.actualParams, part.outputImageSizes[index])))
          const saved = await updateTaskInStore(taskId, {
            outputImages: ids,
            transparentOriginalImages: parts.flatMap((part) => part.transparentOriginalImageIds ?? []),
            actualParamsByImage: mapActualParamsByImage(ids, sizes),
            revisedPromptByImage: mapRevisedPromptsByImage(ids, parts.flatMap((part) => part.outputIds.map((_, index) => part.result.revisedPrompts?.[index]))),
            apiProfilesByImage: Object.fromEntries(parts.flatMap((part) => part.outputIds.flatMap((id, index) => {
              const profile = part.result.usedProfiles?.[index] ?? part.result.usedProfile
              return profile ? [[id, profile]] : []
            }))),
          })
          if (!saved) throw new Error(t('图片已生成，任务信息保存失败；已停止后续生成，请导出作品备份。', 'Images were generated, but task details could not be saved. Further generation stopped. Export a backup of your artwork.'))
        } catch (error) {
          const message = error instanceof Error ? error.message : t('图片保存失败，已停止后续生成。', 'Could not save the image. Further generation stopped.')
          await updateTaskInStore(taskId, createTaskErrorPatch(task, message, Date.now()))
          throw Object.assign(new Error(message), { name: 'ImageOutputStorageError' })
        }
      },
      onFalRequestEnqueued: (request) => {
        falRequestInfo = request
        updateTaskInStore(taskId, {
          falRequestId: request.requestId,
          falEndpoint: request.endpoint,
          falRecoverable: false,
        })
      },
      onCustomTaskEnqueued: (request) => {
        customTaskInfo = request
        updateTaskInStore(taskId, {
          customTaskId: request.taskId,
          customRecoverable: false,
        })
      },
      onPartialImage: (partial) => {
        useStore.getState().setTaskStreamPreview(taskId, partial.image, partial.requestIndex)
        void persistTaskStreamPartialImage(taskId, partial.image)
      },
    })

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    receivedOutput = true
    if (options?.signal.aborted) { useStore.getState().setTaskStreamPreview(taskId); return }
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }

    // 存储输出图片
    const parts = [...completed].sort(([a], [b]) => a - b).map(([, part]) => part)
    const { outputIds, outputDataUrls, outputImageSizes, transparentOriginalImageIds } = parts.length ? {
      outputIds: parts.flatMap((part) => part.outputIds),
      outputDataUrls: parts.flatMap((part) => part.outputDataUrls),
      outputImageSizes: parts.flatMap((part) => part.outputImageSizes),
      transparentOriginalImageIds: task.transparentOutput ? parts.flatMap((part) => part.transparentOriginalImageIds ?? []) : undefined,
    } : await storeTaskOutputImages(task, result.images)
    const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
    const actualParamsList = await resolveImageSizeParamsList(
      outputDataUrls,
      isAsyncCustomTask ? undefined : result.actualParamsList,
      outputImageSizes,
    )
    const actualParams = deriveGalleryActualParams(taskProvider, isAsyncCustomTask, result.actualParams, actualParamsList, outputIds.length)
    const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
    const actualParamsByImage = mapActualParamsByImage(outputIds, actualParamsList)
    const revisedPrompts = activeProfile.codexCli && task.sourceMode !== 'agent'
      ? result.revisedPrompts?.map((prompt) => prompt == null ? prompt : stripInjectedCodexCliSizePrompt(prompt, requestPrompt, task.params.size))
      : result.revisedPrompts
    const revisedPromptByImage = shouldStoreRevisedPrompts ? mapRevisedPromptsByImage(outputIds, revisedPrompts) : undefined
    const promptWasRevised = shouldStoreRevisedPrompts && revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== requestPrompt.trim(),
    )
    const hasRevisedPromptValue = shouldStoreRevisedPrompts && revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && activeProfile.apiMode === 'responses' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, t('接口没有返回官方 API 会返回的部分信息', 'The API omitted information normally returned by the official API'))
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      await deleteUnreferencedImageIds([...outputIds, ...(transparentOriginalImageIds ?? [])])
      return
    }
    const partialImageIdsToClean = latestBeforeUpdate.streamPartialImageIds || []
    clearOpenAIWatchdogTimer(taskId)
    useStore.getState().setTaskStreamPreview(taskId)
    const saved = await updateTaskInStore(taskId, {
      outputImages: outputIds,
      ...(result.usedProfile ? { apiProfileId: result.usedProfile.id, apiProfileName: result.usedProfile.name, apiModel: result.usedProfile.model } : {}),
      routeWarnings: result.warnings,
      apiProfilesByImage: result.usedProfiles ? Object.fromEntries(outputIds.flatMap((id, i) => result.usedProfiles?.[i] ? [[id, result.usedProfiles[i]]] : [])) : undefined,
      transparentOriginalImages: transparentOriginalImageIds,
      outputErrors: result.failedRequests?.length ? result.failedRequests : undefined,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
      actualParams,
      actualParamsByImage,
      revisedPromptByImage,
      ...createTaskDonePatch(task, Date.now()),
      falRecoverable: false,
      customRecoverable: false,
    })
    void deleteUnreferencedImageIds(partialImageIdsToClean)
    if (!saved) throw Object.assign(new Error(t('图片已生成，任务信息保存失败；已停止后续生成，请导出作品备份。', 'Images were generated, but task details could not be saved. Further generation stopped. Export a backup of your artwork.')), { name: 'ImageOutputStorageError' })

    const failedCount = result.failedRequests?.length ?? 0
    const completionMessage = failedCount > 0
      ? t(`生成完成：成功 ${outputIds.length} 张，失败 ${failedCount} 张`, `Generation complete: ${outputIds.length} succeeded, ${failedCount} failed`)
      : t(`生成完成，共 ${outputIds.length} 张图片`, `Generation complete: ${outputIds.length} images`)
    useStore.getState().showToast(completionMessage, failedCount > 0 ? 'error' : 'success')
    if (!isAgentTask(task)) showTaskCompletionNotification(t('图像生成完成', 'Image generation complete'), `${completionMessage}。`)
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    clearOpenAIWatchdogTimer(taskId)
    if (err instanceof Error && err.name === 'ImageOutputStorageError') throw err
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestTask || latestTask.status !== 'running') return
    useStore.getState().setTaskStreamPreview(taskId)
    if (receivedOutput) {
      const message = t('图片服务已返回结果，但本机处理或保存失败；已停止后续生成，请检查存储后手动处理。', 'The image service returned results, but local processing or saving failed. Further generation stopped. Check storage and handle the results manually.')
      await updateTaskInStore(taskId, { ...createTaskErrorPatch(task, message, Date.now()), falRecoverable: false, customRecoverable: false })
      console.warn('Failed to store generated image output', err)
      throw Object.assign(new Error(message), { name: 'ImageOutputStorageError' })
    }
    const latestFalRequestInfo = falRequestInfo ?? (latestTask.falRequestId && latestTask.falEndpoint
      ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
      : null)
    const latestCustomTaskInfo = customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isNetworkRecoverableError(err)) {
      updateTaskInStore(taskId, {
        ...createTaskErrorPatch(task, t('与 fal.ai 的连接已断开，之后会继续查询任务结果。', 'The fal.ai connection was lost. Task results will be checked again later.'), Date.now()),
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
      })
      scheduleFalRecovery(taskId)
    } else if (latestCustomTaskInfo && isNetworkRecoverableError(err)) {
      updateTaskInStore(taskId, {
        ...createTaskErrorPatch(task, t('与自定义异步任务的连接已断开，之后会继续查询任务结果。', 'The custom asynchronous task connection was lost. Task results will be checked again later.'), Date.now()),
        customTaskId: latestCustomTaskInfo.taskId,
        customRecoverable: true,
      })
      scheduleCustomRecovery(taskId)
    } else {
      let errorMessage = err instanceof Error ? err.message : String(err)
      const settings = useStore.getState().settings
      const profile = getTaskApiProfile(settings, latestTask)
      const usesApiProxy = profile?.apiProxy ?? settings.apiProxy
      const activeProfile = getActiveApiProfile(settings)
      const hintProfile = profile ?? {
        provider: latestTask.apiProvider ?? activeProfile.provider,
        apiMode: settings.apiMode,
        streamImages: activeProfile.streamImages,
        streamPartialImages: activeProfile.streamPartialImages,
      }
      const networkErrorHint = getApiRequestNetworkErrorHint(err, latestTask.createdAt, usesApiProxy, hintProfile)
      if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
        errorMessage += `\n${networkErrorHint}`
      }
      updateTaskInStore(taskId, {
        ...createTaskErrorPatch(task, errorMessage, Date.now()),
        ...getRawErrorPayload(err),
        falRecoverable: false,
        customRecoverable: false,
      })
      if (task.sourceMode !== 'agent') useStore.getState().setDetailTaskId(taskId)
    }
  } finally {
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      deleteCachedImage(imgId)
    }
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks, defaultFavoriteCollectionId } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId) } : t,
  )
  const task = updated.find((t) => t.id === taskId)
  setTasks(updated)
  if (!task) return Promise.resolve(false)
  return putTask(task).then(() => true).catch((err) => {
    console.warn('Failed to save task update', err)
    const message = task.outputImages.length ? t('图片已生成，任务信息保存失败；请导出作品备份。', 'Images were generated, but task details could not be saved. Export a backup of your artwork.') : t('任务信息保存失败，请重试保存。', 'Could not save task details. Try saving again.')
    if (task.status === 'done') useStore.getState().setTasks(useStore.getState().tasks.map((item) => item === task ? { ...item, error: message } : item))
    useStore.getState().showToast(message, 'error')
    return false
  })
}

export function createFavoriteCollection(name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName) return null
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast(t('收藏夹名称最多 60 个字符', 'Collection names can contain up to 60 characters'), 'error')
    return null
  }
  const state = useStore.getState()
  const existing = state.favoriteCollections.find((collection) => collection.name === normalizedName)
  if (existing) return existing
  const now = Date.now()
  const collection: FavoriteCollection = { id: genId(), name: normalizedName, createdAt: now, updatedAt: now }
  state.setFavoriteCollections([...state.favoriteCollections, collection])
  state.showToast(t(`已创建收藏夹「${normalizedName}」`, `Created collection “${normalizedName}”`), 'success')
  return collection
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast(t('收藏夹名称最多 60 个字符', 'Collection names can contain up to 60 characters'), 'error')
    return
  }
  const { favoriteCollections, setFavoriteCollections, showToast } = useStore.getState()
  setFavoriteCollections(favoriteCollections.map((collection) =>
    collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: Date.now() } : collection,
  ))
  showToast(t('收藏夹名称已更新', 'Collection name updated'), 'success')
}

export async function updateTasksFavoriteCollections(taskIds: string[], collectionIds: string[]) {
  const ids = normalizeFavoriteCollectionIds(collectionIds)
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean)
  if (!uniqueTaskIds.length) return
  const { tasks, setTasks, clearSelection, showToast, defaultFavoriteCollectionId } = useStore.getState()
  const idSet = new Set(uniqueTaskIds)
  const changedTaskIds = new Set<string>()
  const updated = tasks.map((task) => {
    if (!idSet.has(task.id)) return task
    if (sameFavoriteCollectionIds(getTaskFavoriteCollectionIds(task, defaultFavoriteCollectionId), ids)) return task
    changedTaskIds.add(task.id)
    return { ...task, ...normalizeFavoritePatch(task, { favoriteCollectionIds: ids }, defaultFavoriteCollectionId) }
  })
  if (!changedTaskIds.size) {
    clearSelection()
    return
  }
  setTasks(updated)
  await Promise.all(updated.filter((task) => changedTaskIds.has(task.id)).map((task) => putTask(task)))
  clearSelection()
  showToast(ids.length ? t('收藏夹已更新', 'Collections updated') : t('已取消收藏', 'Removed from favorites'), 'success')
}

export async function deleteFavoriteCollection(collectionId: string, deleteTasks = false) {
  const state = useStore.getState()
  const collection = state.favoriteCollections.find((item) => item.id === collectionId)
  const result = deleteFavoriteCollectionState({
    collections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
    activeFavoriteCollectionId: state.activeFavoriteCollectionId,
    selectedFavoriteCollectionIds: state.selectedFavoriteCollectionIds,
    selectedTaskIds: state.selectedTaskIds,
    tasks: state.tasks,
    collectionId,
    deleteTasks,
  })
  if (!collection || !result) return

  useStore.setState({
    favoriteCollections: result.collections,
    defaultFavoriteCollectionId: result.defaultFavoriteCollectionId,
    activeFavoriteCollectionId: result.activeFavoriteCollectionId,
    selectedFavoriteCollectionIds: result.selectedFavoriteCollectionIds,
    selectedTaskIds: result.selectedTaskIds,
  })
  if (result.updatedTasks.length) {
    const patches = new Map(result.updatedTasks.map((task) => [task.id, task]))
    const updated = useStore.getState().tasks.map((task) => {
      const patch = patches.get(task.id)
      return patch ? { ...task, favoriteCollectionIds: patch.favoriteCollectionIds, isFavorite: patch.isFavorite, favoriteAddedAt: patch.favoriteAddedAt } : task
    })
    useStore.getState().setTasks(updated)
    await Promise.all(updated.filter((task) => patches.has(task.id)).map((task) => putTask(task)))
  }
  if (result.taskIdsToDelete.length) await removeMultipleTasks(result.taskIdsToDelete)
  useStore.getState().showToast(t(`已删除收藏夹「${collection.name}」`, `Deleted collection “${collection.name}”`), 'success')
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  useStore.getState().setAppMode('agent')
  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) { useStore.getState().showToast(t('请等待当前任务完成，或先停止。', 'Wait for the current task to finish, or stop it first.'), 'info'); return }
  const { settings } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const normalizedParams = normalizeParamsForSettings(task.params, settings, { hasInputImages: task.inputImageIds.length > 0 })
  const shouldUseTransparentOutput = (normalizedParams.output_format === 'png' || normalizedParams.output_format === 'webp') && normalizedParams.transparent_output
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false }
  const transparentMeta = taskParams.transparent_output && activeProfile.transparentBackgroundMethod === 'local'
    ? createTransparentOutputMeta(task.prompt.trim())
    : null
  const taskId = genId()
  const roundId = genId()
  const userMessageId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: taskParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    apiModelSelected: Boolean(settings.galleryModel),
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    sourceMode: 'agent', agentConversationId: conversation.id, agentRoundId: roundId, agentMessageId: userMessageId,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  updateAgentConversation(conversation.id, (current) => appendDirectImageRound(current, newTask, roundId, userMessageId))
  await startDirectImageTask(newTask, settings)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  useStore.getState().setAppMode('agent')
  const { settings, showToast, setReusedTaskApiProfile } = useStore.getState()
  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) { showToast(t('请先完成或停止当前任务，再复用提示词。', 'Finish or stop the current task before reusing a prompt.'), 'info'); return }
  const before = captureCreationDraft()

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (!dataUrl) throw new Error(t('参考图片已不存在，原草稿已保留。', 'The reference image no longer exists. Your draft is preserved.'))
    imgs.push({ id: imgId, dataUrl })
  }
  let maskDraft: MaskDraft | null = null
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      maskDraft = {
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      }
    } else throw new Error(t('蒙版已不存在，原草稿已保留。', 'The mask no longer exists. Your draft is preserved.'))
  }
  if (!applyCreationDraft(before, { prompt: task.prompt, inputImages: imgs, maskDraft, maskEditorImageId: null, params: normalizeParamsForSettings(task.params, settings, { hasInputImages: imgs.length > 0 }) })) return
  setReusedTaskApiProfile(null)
  showToast(t('已复用提示词与参数到输入框', 'Prompt and parameters copied to the composer'), 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  useStore.getState().setAppMode('agent')
  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) { useStore.getState().showToast(t('请先完成或停止当前任务。', 'Finish or stop the current task first.'), 'info'); return }
  const before = captureCreationDraft()
  const images = [...before.inputImages]
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (images.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (!dataUrl) throw new Error(t('图片已不存在，原草稿已保留。', 'The image no longer exists. Your draft is preserved.'))
    images.push({ id: imgId, dataUrl })
    added++
  }
  if (images.length > API_MAX_IMAGES) { useStore.getState().showToast(t(`参考图最多 ${API_MAX_IMAGES} 张，请移除部分参考图后重试。`, `Up to ${API_MAX_IMAGES} reference images are allowed. Remove some and try again.`), 'info'); return }
  if (!applyCreationDraft(before, { inputImages: images }, false)) return
  useStore.getState().showToast(t(`已添加 ${added} 张输出图到输入`, `Added ${added} output images to the composer`), 'success')
}

function getAgentRoundDeletionTaskIds(conversation: AgentConversation, round: AgentRound, tasks: TaskRecord[]) {
  const messageIds = new Set(conversation.messages.filter((message) => message.roundId === round.id).map((message) => message.id))
  messageIds.add(round.userMessageId)
  if (round.assistantMessageId) messageIds.add(round.assistantMessageId)
  return uniqueIds([
    ...round.outputTaskIds,
    ...conversation.messages
      .filter((message) => messageIds.has(message.id))
      .flatMap((message) => message.outputTaskIds ?? []),
    ...tasks
      .filter((task) => task.agentRoundId === round.id || Boolean(task.agentMessageId && messageIds.has(task.agentMessageId)))
      .map((task) => task.id),
  ])
}

function hasRunningAgentDeletionWork(conversationId: string, roundIds: Set<string>, taskIds: Set<string>, state: AppState) {
  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  if (conversation?.rounds.some((round) => roundIds.has(round.id) && round.status === 'running')) return true
  if (state.tasks.some((task) => taskIds.has(task.id) && task.status === 'running')) return true
  for (const roundId of roundIds) {
    const key = getAgentRoundControllerKey(conversationId, roundId)
    const round = conversation?.rounds.find((item) => item.id === roundId)
    const controller = agentRoundControllers.get(key)
    if (controller && !controller.signal.aborted) return true
    if (agentRecoveryContinuations.has(key) && round?.status !== 'done' && !isAgentStoppedMessage(round?.error)) return true
  }
  return false
}

function cleanDeletedAgentReferences(conversation: AgentConversation, taskIds: Set<string>, assistantMessageIds: Set<string>, now: number) {
  let changed = false
  const rounds = conversation.rounds.map((round) => {
    const outputTaskIds = round.outputTaskIds.filter((taskId) => !taskIds.has(taskId))
    const clearAssistantMessage = Boolean(round.assistantMessageId && assistantMessageIds.has(round.assistantMessageId))
    if (outputTaskIds.length === round.outputTaskIds.length && !clearAssistantMessage) return round
    changed = true
    return {
      ...round,
      ...(clearAssistantMessage ? { assistantMessageId: undefined } : {}),
      outputTaskIds,
    }
  })
  const messages = conversation.messages.map((message) => {
    if (!message.outputTaskIds?.some((taskId) => taskIds.has(taskId))) return message
    changed = true
    return { ...message, outputTaskIds: message.outputTaskIds.filter((taskId) => !taskIds.has(taskId)) }
  })
  return changed ? { ...conversation, rounds, messages, updatedAt: now } : conversation
}

async function deleteAgentRoundAndTasks(conversationId: string, roundId: string): Promise<AgentDeletionResult> {
  const state = useStore.getState()
  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const round = conversation?.rounds.find((item) => item.id === roundId)
  if (!conversation || !round) return 'not-found'

  const taskIds = new Set(getAgentRoundDeletionTaskIds(conversation, round, state.tasks))
  if (hasRunningAgentDeletionWork(conversationId, new Set([roundId]), taskIds, state)) return 'running'

  let deleted = false
  try {
    await removeTasks([...taskIds], (latest, deletedTaskIds) => {
      const latestConversation = latest.agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestConversation || !latestRound) return null

      const oldActivePath = getActiveAgentRounds(latestConversation)
      const nextConversation = deleteAgentRoundFromConversation(latestConversation, roundId)
      const newActivePath = getActiveAgentRounds(nextConversation)
      const removedMessageIds = new Set([
        latestRound.userMessageId,
        ...(latestRound.assistantMessageId ? [latestRound.assistantMessageId] : []),
        ...latestConversation.messages.filter((message) => message.roundId === roundId).map((message) => message.id),
      ])
      const removedAssistantMessageIds = new Set(latestConversation.messages
        .filter((message) => message.role === 'assistant' && removedMessageIds.has(message.id))
        .map((message) => message.id))
      if (latestRound.assistantMessageId) removedAssistantMessageIds.add(latestRound.assistantMessageId)
      const now = Date.now()
      const agentConversations = latest.agentConversations.map((item) => {
        const candidate = item.id === conversationId
          ? { ...nextConversation, messages: nextConversation.messages.filter((message) => !removedMessageIds.has(message.id)) }
          : item
        return cleanDeletedAgentReferences(candidate, deletedTaskIds, removedAssistantMessageIds, now)
      })
      const agentInputDrafts = remapAgentInputDraftMentionsForPathChange(latest.agentInputDrafts, conversationId, oldActivePath, newActivePath)
      deleted = true
      return {
        agentConversations,
        agentInputDrafts,
        ...(latest.activeAgentConversationId === conversationId && latest.appMode === 'agent'
          ? { prompt: remapAgentRoundMentionsForPathChange(latest.prompt, oldActivePath, newActivePath) }
          : {}),
        agentEditingRoundId: latest.agentEditingRoundId === roundId ? null : latest.agentEditingRoundId,
      }
    })
  } catch (err) {
    if (!deleted) throw err
    console.warn('Agent 轮次已删除，但持久化或图片清理失败', err)
    return 'deleted-with-warning'
  }
  return deleted ? 'deleted' : 'not-found'
}

async function deleteAgentAssistantMessageAndTasks(conversationId: string, messageId: string): Promise<AgentDeletionResult> {
  const state = useStore.getState()
  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const message = conversation?.messages.find((item) => item.id === messageId && item.role === 'assistant')
  if (!conversation || !message) return 'not-found'

  const round = conversation.rounds.find((item) => item.id === message.roundId)
  const taskIds = new Set(uniqueIds([
    ...(message.outputTaskIds ?? []),
    ...(round ? getAgentRoundDeletionTaskIds(conversation, round, state.tasks) : []),
    ...state.tasks.filter((task) => task.agentMessageId === messageId).map((task) => task.id),
  ]))
  const referencedRoundIds = new Set([
    message.roundId,
    ...conversation.rounds.filter((item) => item.assistantMessageId === messageId).map((item) => item.id),
  ])
  if (hasRunningAgentDeletionWork(conversationId, referencedRoundIds, taskIds, state)) return 'running'

  let deleted = false
  try {
    await removeTasks([...taskIds], (latest, deletedTaskIds) => {
      const latestConversation = latest.agentConversations.find((item) => item.id === conversationId)
      const latestMessage = latestConversation?.messages.find((item) => item.id === messageId && item.role === 'assistant')
      if (!latestConversation || !latestMessage) return null

      const now = Date.now()
      const assistantMessageIds = new Set([messageId])
      const agentConversations = latest.agentConversations.map((item) => {
        const candidate = item.id === conversationId
          ? { ...item, messages: item.messages.filter((current) => current.id !== messageId), updatedAt: now }
          : item
        return cleanDeletedAgentReferences(candidate, deletedTaskIds, assistantMessageIds, now)
      })
      deleted = true
      return { agentConversations }
    })
  } catch (err) {
    if (!deleted) throw err
    console.warn('Agent 消息已删除，但持久化或图片清理失败', err)
    return 'deleted-with-warning'
  }
  return deleted ? 'deleted' : 'not-found'
}

type TaskDeletionStateUpdater = (state: AppState, taskIds: Set<string>) => Partial<AppState> | null

async function removeTasks(taskIds: string[], updateState?: TaskDeletionStateUpdater) {
  const toDelete = new Set(taskIds)
  let deletedTasks: TaskRecord[] = []
  useStore.setState((state) => {
    deletedTasks = state.tasks.filter((task) => toDelete.has(task.id))
    const streamPreviews = { ...state.streamPreviews }
    const streamPreviewSlots = { ...state.streamPreviewSlots }
    for (const taskId of toDelete) {
      delete streamPreviews[taskId]
      delete streamPreviewSlots[taskId]
    }
    return {
      tasks: state.tasks.filter((task) => !toDelete.has(task.id)),
      selectedTaskIds: state.selectedTaskIds.filter((id) => !toDelete.has(id)),
      streamPreviews,
      streamPreviewSlots,
    }
  })
  if (deletedTasks.length === 0 && !updateState) return 0

  const deletedImageIds = new Set<string>()
  for (const task of deletedTasks) {
    addTaskReferencedImageIds(deletedImageIds, task)
    const controller = task.agentConversationId && task.agentRoundId
      ? agentRoundControllers.get(getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId))
      : undefined
    if (controller) deletedActiveAgentTasks.set(task.id, { task, controller })
    clearFalRecoveryTimer(task.id)
    clearCustomRecoveryTimer(task.id)
    clearOpenAIWatchdogTimer(task.id)
  }

  const cleanup = scrubAgentOutputPayloadsForDeletedTasks(deletedTasks)
  const domainUpdatedConversations: AgentConversation[] = []
  if (updateState) {
    useStore.setState((state) => {
      const patch = updateState(state, toDelete)
      if (!patch) return state
      if (patch.agentConversations) {
        const previousById = new Map(state.agentConversations.map((conversation) => [conversation.id, conversation]))
        domainUpdatedConversations.push(...patch.agentConversations.filter((conversation) => previousById.get(conversation.id) !== conversation))
      }
      return patch
    })
  }
  const updatedConversations = new Map(cleanup.updatedConversations.map((conversation) => [conversation.id, conversation]))
  for (const conversation of domainUpdatedConversations) updatedConversations.set(conversation.id, conversation)
  await persistTaskDeletionCleanup(deletedTasks.map((task) => task.id), {
    ...cleanup,
    updatedConversations: [...updatedConversations.values()],
  })
  await deleteUnreferencedImageIds(deletedImageIds)
  return deletedTasks.length
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  if (!taskIds.length) return

  const deletedCount = await removeTasks(taskIds)
  if (deletedCount === 0) return
  useStore.getState().showToast(t(`已删除 ${deletedCount} 个任务`, `Deleted ${deletedCount} tasks`), 'success')
}

/** 删除所有失败任务 */
export async function clearFailedTasks(taskIds?: string[]) {
  const targetTaskIds = taskIds ? new Set(taskIds) : null
  const failedTasks = useStore.getState().tasks
    .filter((task) => taskMatchesFilterStatus(task, 'error') && (!targetTaskIds || targetTaskIds.has(task.id)))
  const failedTaskIds = failedTasks
    .filter((task) => task.status === 'error')
    .map((task) => task.id)
  const partialFailedTaskIds = new Set(
    failedTasks
      .filter((task) => task.status !== 'error' && taskHasOutputErrors(task))
      .map((task) => task.id),
  )

  if (failedTaskIds.length) await removeMultipleTasks(failedTaskIds)
  if (partialFailedTaskIds.size) {
    const { tasks, setTasks, selectedTaskIds, setSelectedTaskIds, showToast } = useStore.getState()
    const updated = tasks.map((task) => partialFailedTaskIds.has(task.id) ? { ...task, outputErrors: undefined } : task)
    setTasks(updated)
    const nextSelectedTaskIds = selectedTaskIds.filter((id) => !partialFailedTaskIds.has(id))
    if (nextSelectedTaskIds.length !== selectedTaskIds.length) setSelectedTaskIds(nextSelectedTaskIds)
    await Promise.all(updated.filter((task) => partialFailedTaskIds.has(task.id)).map((task) => putTask(task)))
    showToast(t(`已清除 ${partialFailedTaskIds.size} 条部分失败记录`, `Cleared ${partialFailedTaskIds.size} partial failure records`), 'success')
  }
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const deletedCount = await removeTasks([task.id])
  if (deletedCount === 0) return
  useStore.getState().showToast(t('任务已删除', 'Task deleted'), 'success')
}

/** 清空数据选项 */
export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
}

/** 清空数据 */
export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()

  if (options.clearTasks) {
    if (!await useStore.getState().setPromptTemplates([], DEFAULT_PROMPT_CATEGORIES)) return
    setTasks([])
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentInputDrafts: {},
      promptTemplates: [],
      creationDraftUndo: null,
    })
    clearInputImages()
    clearMaskDraft()
    await persistAgentConversationChanges(async (changed, removedIds) => {
      await dbClearTasks()
      await commitAgentConversationChanges(changed, removedIds)
    })
    await clearImages()
    clearImageCaches()
  }

  if (options.clearConfig) {
    const presetConfig = getPresetConfig()
    useStore.setState({
      dismissedPresetProfileIds: [],
      dismissedPresetProviderIds: [],
      dismissedCodexCliPrompts: [],
    })
    if (presetConfig) {
      useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
      await useStore.getState().setPresetImportedSettings(presetConfig)
    } else {
      setSettings({ ...DEFAULT_SETTINGS })
    }
    setParams({ ...DEFAULT_PARAMS })
  }

  showToast(t('所选数据已清空', 'Selected data cleared'), 'success')
}

async function completeRecoveredCustomTask(task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done' || isAgentStoppedMessage(latest.error)) return
  if (latest.status !== 'running' && !latest.customRecoverable) return

  const { outputIds, outputDataUrls, outputImageSizes, transparentOriginalImageIds } = await storeTaskOutputImages(task, result.images)
  const actualParamsList = await resolveImageSizeParamsList(outputDataUrls, undefined, outputImageSizes)
  const latestBeforeUpdate = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latestBeforeUpdate || latestBeforeUpdate.status === 'done' || isAgentStoppedMessage(latestBeforeUpdate.error) || (latestBeforeUpdate.status !== 'running' && !latestBeforeUpdate.customRecoverable)) {
    await deleteUnreferencedImageIds([...outputIds, ...(transparentOriginalImageIds ?? [])])
    return
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    transparentOriginalImages: transparentOriginalImageIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    ...createTaskDonePatch(task, Date.now()),
    customRecoverable: false,
  })
  useStore.getState().showToast(t(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, `Custom asynchronous task recovered: ${outputIds.length} images`), 'success')
  if (!isAgentTask(task)) showTaskCompletionNotification(t('图像生成完成', 'Image generation complete'), t(`自定义异步任务已恢复，共 ${outputIds.length} 张图片。`, `Custom asynchronous task recovered: ${outputIds.length} images.`))
  else void continueRecoveredAgentRound(task.id)
}

async function recoverCustomTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || !task.customTaskId || task.status === 'done') return

  const profile = getCustomRecoveryProfile(settings, task)
  const customProvider = profile ? getCustomProviderDefinition(settings, profile.provider) : null
  if (!profile || !customProvider?.poll) {
    scheduleCustomRecovery(taskId)
    return
  }

  try {
    const result = await getCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params)
    clearCustomRecoveryTimer(taskId)
    await completeRecoveredCustomTask(task, result)
  } catch (err) {
    clearCustomRecoveryTimer(taskId)
    if (!useStore.getState().tasks.some((item) => item.id === taskId)) return
    updateTaskInStore(taskId, {
      ...createTaskErrorPatch(task, err instanceof Error ? err.message : String(err), Date.now()),
      ...getRawErrorPayload(err),
      customRecoverable: false,
    })
    if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
  }
}

/** 导出选项 */
export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
}

/** 导出数据为 ZIP */
export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true }) {
  try {
    const state = useStore.getState()
    if (options.exportTasks && hasActiveDataOperations(state.tasks, state.agentConversations)) throw new Error(t('当前有任务正在进行，请完成或停止后再导出。', 'A task is running. Finish or stop it before exporting.'))
    const tasks = options.exportTasks ? await getAllTasks() : []
    const imageIds = options.exportTasks ? await getAllImageIds() : []
    const { settings, agentConversations, favoriteCollections, defaultFavoriteCollectionId, promptTemplates, promptCategories } = state
    const exportedAt = Date.now()
    const params = {
      options,
      exportedAt,
      settings,
      tasks,
      imageTasks: tasks,
      favoriteCollections,
      promptTemplates,
      promptCategories,
      defaultFavoriteCollectionId,
      agentConversations: options.exportTasks ? getPersistableAgentConversations(agentConversations) : [],
    }
    const imageSizes = []
    for (const id of imageIds) {
      const image = await getImage(id)
      if (!image) continue
      const thumbnail = await getImageThumbnail(id)
      imageSizes.push({ id, bytes: getExportImageEstimatedBytes(image, thumbnail) })
    }
    const plan = getExportZipPlan(params, imageSizes)
    const backupId = `${exportedAt}`

    for (let index = 0; index < plan.length; index++) {
      const images: StoredImage[] = []
      const thumbnailsByImageId = new Map<string, StoredImageThumbnail>()
      for (const id of plan[index].imageIds) {
        const image = await getImage(id)
        if (!image) continue
        images.push(image)
        const thumbnail = await getImageThumbnail(id)
        if (!thumbnail?.thumbnailDataUrl) continue
        thumbnailsByImageId.set(id, thumbnail)
        cacheThumbnail(id, {
          dataUrl: thumbnail.thumbnailDataUrl,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        })
      }

      const partNumber = index + 1
      const result = await buildExportZip({
        ...params,
        tasks: plan[index].tasks,
        agentConversations: plan[index].agentConversations,
        images,
        thumbnailsByImageId,
        includeManifestData: plan[index].includeBaseData,
        backupPart: plan.length > 1 ? { id: backupId, index: partNumber, total: plan.length } : undefined,
      })
      const blob = createExportBlob(result.bytes)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const suffix = plan.length > 1 ? `_${String(plan.length).padStart(2, '0')}parts_part${String(partNumber).padStart(2, '0')}` : ''
      a.href = url
      a.download = `chat-to-image-backup_${formatExportFileTime(new Date(exportedAt))}${suffix}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      if (partNumber < plan.length) await new Promise((resolve) => setTimeout(resolve, 150))
    }
    const recorded = recordBackupReceipt({ requestedAt: exportedAt, parts: plan.length, config: Boolean(options.exportConfig), works: Boolean(options.exportTasks) })
    useStore.getState().showToast(t(`已请求下载 ${plan.length} 个 ZIP，请在下载目录确认文件${recorded ? '' : '；导出时间记录未能保存'}`, `Requested ${plan.length} ZIP downloads. Check your downloads folder.${recorded ? '' : ' The export timestamp could not be saved.'}`), 'success')
  } catch (e) {
    console.error('exportData failed', e)
    const detail = e instanceof Error ? e.message.trim() : String(e).trim()
    useStore.getState().showToast(detail ? t(`导出失败，${detail}`, `Export failed: ${detail}`) : t('导出失败，未知错误', 'Export failed: unknown error'), 'error')
  }
}

/** 导入选项 */
export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
}

export async function restoreExplicitPresetConfig(ids: { providerIds: string[], profileIds: string[] }) {
  const presetProviderIds = getPresetProviderIds()
  const presetProfileIds = getPresetProfileIds()
  const providerIds = ids.providerIds.filter((id) => presetProviderIds.has(id))
  const profileIds = ids.profileIds.filter((id) => presetProfileIds.has(id))
  if (!providerIds.length && !profileIds.length) return false

  const state = useStore.getState()
  for (const id of providerIds) state.restorePresetProvider(id)
  for (const id of profileIds) state.restorePresetProfile(id)
  const presetConfig = getPresetConfig()
  if (presetConfig) await useStore.getState().setPresetImportedSettings(presetConfig)
  return true
}

/** 导入 ZIP 数据 */
export async function importData(input: File | File[], options: ImportOptions = { importConfig: true, importTasks: true }): Promise<boolean> {
  try {
    const state = useStore.getState()
    if (options.importTasks && hasActiveDataOperations(state.tasks, state.agentConversations)) throw new Error(t('当前有任务正在进行，请完成或停止后再导入。', 'A task is running. Finish or stop it before importing.'))
    const files = Array.isArray(input) ? input : [input]
    if (!files.length) throw new Error(t('没有选择备份文件。', 'No backup files selected.'))
    if (files.some((file) => file.size >= MAX_EXPORT_ZIP_BYTES)) {
      throw new Error(t('单个 ZIP 不能达到或超过 2 GB，请选择分片备份。', 'Each ZIP must be smaller than 2 GB. Select a split backup.'))
    }

    const selected = [] as Array<{ file: File; manifest: Awaited<ReturnType<typeof readExportZipManifest>> }>
    for (const file of files) {
      const manifest = await readExportZipManifest(new Uint8Array(await file.arrayBuffer()), options.importTasks)
      selected.push({ file, manifest })
    }
    const multipart = selected.some((part) => part.manifest.backupPart != null)
    if (multipart) {
      if (selected.some((part) => !part.manifest.backupPart)) throw new Error(t('不能混合选择分片备份和普通备份。', 'Split and regular backups cannot be selected together.'))
      const first = selected[0].manifest.backupPart!
      const indexes = new Set(selected.map((part) => part.manifest.backupPart!.index))
      const validSet = selected.every((part) => {
        const backupPart = part.manifest.backupPart!
        return backupPart.id === first.id && backupPart.total === first.total && backupPart.index >= 1 && backupPart.index <= first.total
      })
      if (!validSet || indexes.size !== selected.length) throw new Error(t('所选分片不属于同一批备份或包含重复分片。', 'The selected parts belong to different backups or contain duplicate parts.'))
      if (options.importTasks && (selected.length !== first.total || indexes.size !== first.total)) {
        throw new Error(t(`分片备份不完整，请一次选择同一备份的全部 ${first.total} 个 ZIP。`, `The split backup is incomplete. Select all ${first.total} ZIP parts of the same backup together.`))
      }
      selected.sort((a, b) => a.manifest.backupPart!.index - b.manifest.backupPart!.index)
    }

    const settingsManifests = selected.filter((part) => part.manifest.settings)
    if (options.importConfig && !options.importTasks && !settingsManifests.length) throw new Error(t('所选备份不包含配置数据。', 'The selected backup contains no settings.'))
    if (options.importConfig && settingsManifests.length) {
      const merged = settingsManifests.reduce((current, part) => mergeImportedSettings(current, part.manifest.settings, { preserveInternalIds: true }), useStore.getState().settings)
      const limitError = getApiProfileLimitError(merged.profiles)
      if (limitError) throw new Error(limitError)
    }
    const importedTasks = selected.flatMap((part) => part.manifest.tasks ?? [])
    const importedAgentConversations = selected.flatMap((part) => part.manifest.agentConversations ?? [])
    const hasTaskData = selected.some((part) => part.manifest.tasks != null || part.manifest.imageFiles != null)

    const importedImageIds: string[] = []
    if (options.importTasks && hasTaskData) {
      for (const part of selected) {
        const { manifest, files: zipFiles } = await readExportZip(new Uint8Array(await part.file.arrayBuffer()))
        for (const [id, info] of Object.entries(manifest.imageFiles ?? {})) {
          const dataUrl = readExportZipFileAsDataUrl(zipFiles, info.path)
          if (!dataUrl) continue
          await putImage({
            id,
            dataUrl,
            createdAt: info.createdAt,
            source: info.source,
            width: info.width,
            height: info.height,
          })
          cacheImage(id, dataUrl)
          importedImageIds.push(id)
        }

        for (const [id, info] of Object.entries(manifest.thumbnailFiles ?? {})) {
          const thumbnailDataUrl = readExportZipFileAsDataUrl(zipFiles, info.path)
          if (!thumbnailDataUrl) continue
          await putImageThumbnail({
            id,
            thumbnailDataUrl,
            width: info.width,
            height: info.height,
            thumbnailVersion: info.thumbnailVersion,
          })
          cacheThumbnail(id, {
            dataUrl: thumbnailDataUrl,
            width: info.width,
            height: info.height,
            thumbnailVersion: info.thumbnailVersion,
          })
        }
      }

      for (const task of importedTasks) {
        await putTask(task)
      }

      const tasks = await getAllTasks()
      const state = useStore.getState()
      const importedFavoriteCollections = selected.flatMap((part) => part.manifest.favoriteCollections ?? [])
      const mergedFavorites = mergeFavoriteCollections(state.favoriteCollections, importedFavoriteCollections)
      const favoriteCollections = mergedFavorites.collections
      const importedDefaultFavoriteCollectionId = selected
        .map((part) => part.manifest.defaultFavoriteCollectionId)
        .find((id) => id != null && favoriteCollections.some((collection) => collection.id === id))
      const defaultFavoriteCollectionId = mergedFavorites.importedCollections.length
        ? resolveDefaultFavoriteCollectionId(favoriteCollections, importedDefaultFavoriteCollectionId)
        : state.defaultFavoriteCollectionId
      const normalizedFavorites = normalizeLoadedFavoriteState(tasks, favoriteCollections, defaultFavoriteCollectionId)
      if (!await state.setPromptTemplates((current) => mergePromptTemplates(current, selected.flatMap((part) => part.manifest.promptTemplates ?? [])), (current) => [...current, ...selected.flatMap((part) => Array.isArray(part.manifest.promptCategories) ? part.manifest.promptCategories : [])])) throw new Error(t('个人提示词未能保存，原个人库保留。', 'Could not save personal prompts. The original library is preserved.'))
      useStore.setState({
        tasks: normalizedFavorites.tasks,
        favoriteCollections: normalizedFavorites.collections,
        defaultFavoriteCollectionId: normalizedFavorites.defaultFavoriteCollectionId,
      })
      if (normalizedFavorites.changed) await Promise.all(normalizedFavorites.tasks.map((task) => putTask(task)))
      const normalizedAgentConversations = normalizeAgentConversations(importedAgentConversations)
        .filter((conversation) => !isEmptyAgentConversation(conversation))
      useStore.setState((state) => {
        const agentConversations = mergeImportedAgentConversations(state.agentConversations, normalizedAgentConversations)
        const activeAgentConversationId = state.activeAgentConversationId && agentConversations.some((conversation) => conversation.id === state.activeAgentConversationId)
          ? state.activeAgentConversationId
          : normalizedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null
        return {
          agentConversations,
          activeAgentConversationId,
        }
      })
      if (!await flushAgentConversationsToIndexedDB()) throw new Error(t('导入的对话尚未保存，请重试保存。', 'Imported conversations have not been saved. Try saving again.'))
      scheduleThumbnailBackfill(importedImageIds)
    }

    if (options.importConfig && settingsManifests.length) {
      const state = useStore.getState()
      const providerIds = new Set(settingsManifests.flatMap((part) =>
        part.manifest.settings?.customProviders?.map((provider) => provider.id) ?? [],
      ))
      const profileIds = new Set(settingsManifests.flatMap((part) =>
        part.manifest.settings?.profiles.map((profile) => profile.id) ?? [],
      ))
      const presetProviderIds = getPresetProviderIds()
      const presetProfileIds = getPresetProfileIds()
      for (const id of providerIds) {
        if (presetProviderIds.has(id)) state.restorePresetProvider(id)
      }
      for (const id of profileIds) {
        if (presetProfileIds.has(id)) state.restorePresetProfile(id)
      }
      const current = useStore.getState()
      const settings = settingsManifests.reduce(
        (current, part) => mergeImportedSettings(current, part.manifest.settings, { preserveInternalIds: true }),
        current.settings,
      )
      current.setSettings(settings)
    }

    let msg = t('数据已成功导入', 'Data imported successfully')
    if (options.importTasks && hasTaskData) {
      msg = t(`已导入 ${importedTasks.length} 个任务`, `Imported ${importedTasks.length} tasks`)
    } else if (options.importConfig && settingsManifests.length) {
      msg = t('配置已成功导入', 'Settings imported successfully')
    }

    useStore.getState().showToast(msg, 'success')
    return true
  } catch (e) {
    console.error('importData failed', e)
    const detail = e instanceof Error ? e.message.trim() : String(e).trim()
    useStore.getState().showToast(detail ? t(`导入失败，${detail}`, `Import failed: ${detail}`) : t('导入失败，未知错误', 'Import failed: unknown error'), 'error')
    return false
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
}

export async function createInputImageFromFile(file: File): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(t('不是有效的图片', 'Not a valid image'))
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}
