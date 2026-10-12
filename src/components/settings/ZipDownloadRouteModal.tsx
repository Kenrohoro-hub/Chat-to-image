import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ZipDownloadRoute } from '../../types'
import { Checkbox } from '../Checkbox'
import { CloseIcon } from '../icons'
import { t } from '../../lib/i18n'

export const ZIP_DOWNLOAD_ROUTE_OPTIONS: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
  { route: 'task-selection', label: t('任务列表 > 多选', 'Task list > Multi-select'), description: t('主页或收藏夹详情中框选、Ctrl/⌘ 点选或移动端滑动选中任务后的“下载选中”。', 'Download selected after selecting tasks with a drag box, Ctrl/⌘ click, or a mobile swipe in the main list or a favorite collection.') },
  { route: 'favorite-collection-selection', label: t('收藏夹列表 > 多选', 'Favorite collections > Multi-select'), description: t('收藏夹概览页选中一个或多个收藏夹后的“下载选中”。', 'Download selected after selecting one or more collections in the favorites overview.') },
  { route: 'image-context-menu-all', label: t('图片右键菜单 > 下载全部', 'Image context menu > Download all'), description: t('右键图片时下载同一组输出图片。', 'Download the same group of output images from an image\'s context menu.') },
  { route: 'task-detail-all', label: t('任务详情 > 下载全部', 'Task details > Download all'), description: t('任务详情弹窗中下载当前任务的所有输出图。', 'Download all output images for the current task from its details dialog.') },
  { route: 'task-detail-partial', label: t('任务详情 > 下载中间步骤图', 'Task details > Download intermediate images'), description: t('任务详情弹窗中下载流式生成保留的中间步骤图。', 'Download intermediate images retained during streaming from the task details dialog.') },
  { route: 'agent-round-all', label: t('Agent 对话轮次 > 下载所有图片', 'Agent reply > Download all images'), description: t('Agent 对话中下载某轮回复关联的全部图片。', 'Download every image associated with one agent reply.') },
]

interface ZipDownloadRouteModalProps {
  routes: ZipDownloadRoute[]
  scrollBoundaryRef: RefObject<HTMLDivElement | null>
  onSetEnabled: (route: ZipDownloadRoute, enabled: boolean) => void
  onClose: () => void
}

export default function ZipDownloadRouteModal({
  routes,
  scrollBoundaryRef,
  onSetEnabled,
  onClose,
}: ZipDownloadRouteModalProps) {
  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        className="relative z-10 w-full max-w-md rounded-3xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in flex flex-col max-h-[85vh] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-6 pb-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">{t('使用压缩包进行批量下载', 'Download batches as ZIP')}</h3>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label={t('关闭', 'Close')}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div data-selectable-text className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {t('开启后，在对应途径进行批量下载时会将结果下载为一个 ZIP，而不是多个图片文件。', 'When enabled, the selected batch download actions save one ZIP instead of separate image files.')}
          </div>
        </div>

        <div ref={scrollBoundaryRef} className="flex-1 overflow-y-auto px-6 space-y-3 custom-scrollbar min-h-0 py-2">
          {ZIP_DOWNLOAD_ROUTE_OPTIONS.map((option) => {
            const isChecked = routes.includes(option.route)
            return (
              <div
                key={option.route}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={() => onSetEnabled(option.route, !isChecked)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSetEnabled(option.route, !isChecked)
                }}
                className={`cursor-pointer rounded-2xl border p-3.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${isChecked ? 'border-blue-500/30 bg-blue-50/50 dark:border-blue-400/30 dark:bg-blue-500/[0.05]' : 'border-gray-100 bg-gray-50/70 hover:bg-gray-100/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'}`}
              >
                <div onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={isChecked}
                    onChange={(checked) => onSetEnabled(option.route, checked)}
                    label={<span className="text-sm font-medium text-gray-700 dark:text-gray-200">{option.label}</span>}
                  />
                </div>
                <div data-selectable-text className="mt-1.5 pl-6 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {option.description}
                </div>
              </div>
            )
          })}
        </div>

        <div className="shrink-0 p-6 pt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-blue-500 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
          >
            {t('完成', 'Done')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
