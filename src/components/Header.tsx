import { getConversationLabel, t } from '../lib/i18n'
import { isLocalService } from '../lib/desktop'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import HistoryModal from './HistoryModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { HelpCircleIcon, HistoryIcon, InstallIcon, PlusIcon } from './icons'
import './header.css'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const agentConversations = useStore((s) => s.agentConversations)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const activeConversation = agentConversations.find((item) => item.id === activeAgentConversationId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const createConversation = useStore((s) => s.createAgentConversation)

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: t('安装为应用', 'Install app'),
          message: t('在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。', 'In Safari, tap Share at the bottom, then Add to Home Screen to install this app.'),
          showCancel: false,
          confirmText: t('我知道了', 'Got it'),
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: t('安装为应用', 'Install app'),
          message: t('请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）', 'Choose Add to Home Screen or Install App in your browser menu.\n\nIf using an in-app browser such as WeChat, open this page in an external browser first.'),
          showCancel: false,
          confirmText: t('我知道了', 'Got it'),
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  return (
    <>
      <header data-no-drag-select className={`safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out translate-y-0`}>
        <div className="safe-area-x safe-header-inner header-layout max-w-7xl mx-auto">
          <div className="header-leading">
            <h1 className="header-brand inline-flex min-w-0 items-start relative">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <span
                    className="hidden text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:inline"
                  >
                    Chat to image
                  </span>
                </>
              ) : (
                <span
                  className="text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100"
                >
                  Chat to image
                </span>
              )}
            </h1>
            {appMode === 'agent' && <div className="header-agent-actions flex items-center gap-2">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setShowHistoryModal((visible) => !visible)}
                className="header-history-button inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#708b81] dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/[0.08]"
                aria-label={t('对话历史', 'Chat history')}
                aria-haspopup="dialog"
                aria-expanded={showHistoryModal}
                aria-controls="conversation-history"
              >
                <HistoryIcon className="h-4 w-4 shrink-0" />
                <span>{t('对话历史', 'Chat history')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppMode('agent')
                  createConversation()
                }}
                className="header-new-conversation inline-flex items-center justify-center gap-2 rounded-lg bg-[#587267] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#4b6258] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#708b81]"
                aria-label={t('新建对话', 'New chat')}
              >
                <PlusIcon className="h-4 w-4 shrink-0" />
                <span>{t('新建对话', 'New chat')}</span>
              </button>
              {showHistoryModal && (
                <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />
              )}
            </div>}
          </div>
          {appMode === 'agent' && activeConversation && (
            <div className="header-current-title hidden md:flex">
              <button
                type="button"
                onClick={() => {
                  setShowHistoryModal(true)
                  // Use setTimeout to ensure HistoryModal is mounted before setting editing id
                  setTimeout(() => {
                    useStore.getState().setAgentEditingConversationId(activeConversation.id)
                  }, 0)
                }}
                className="max-w-full truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#708b81] dark:text-gray-300 dark:hover:bg-white/[0.04]"
                aria-label={t('重命名当前对话', 'Rename current chat')}
              >
                {getConversationLabel(activeConversation) || 'Agent'}
              </button>
            </div>
          )}
          {showFavoriteCollectionTitle && (
            <div className="header-current-title hidden md:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <div className="header-utilities flex shrink-0 items-center gap-1">
            {!isLocalService() && !isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                  aria-label={t('安装为应用', 'Install app')}
                >
                  <InstallIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  {t('安装为应用', 'Install app')}
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label={t('操作指南', 'User guide')}
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                {t('操作指南', 'User guide')}
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div data-header-spacer className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
