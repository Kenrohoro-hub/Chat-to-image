import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

interface HelpModalProps {
  appMode: AppMode
  isFavoriteCollectionOverview?: boolean
  onClose: () => void
}

const guide = [
  {
    title: '开始与配置',
    intro: '先准备图像服务；需要对话创作时，再配置对话服务。',
    cards: [
      { title: '首次使用', steps: ['打开“设置与 API → API 配置”，分别填写画廊 Images 或 Agent Responses 服务的地址、Key 和模型。', '点击“保存配置”后返回创作。只想直接生成图片时，配置画廊即可；对话创作还需要 Agent 配置。'] },
      { title: '选择模型与参数', steps: ['在创作区打开“生图参数”，选择图像模型、尺寸、比例、质量和张数。参数会按对话分别保存。', '对话模型、推理强度和联网选项位于输入区工具栏；不同服务可以使用不同供应商。'] },
    ],
  },
  {
    title: '直接生成与对话',
    intro: '按你要完成的事情选择入口：写好提示词立即出图，或先用对话逐步讨论。',
    cards: [
      { title: '直接生成图片', steps: ['输入画面描述并添加可选参考图，点击“直接生成”。提示词和附件会交给图像服务，不经过对话模型。', '生成期间可以停止；完成后在右侧比较结果，也可在下方最近生成中查看其他作品。'] },
      { title: '边聊边创作', steps: ['在对话框描述想法并发送。普通讨论会先得到文字回复；明确要求“生成”或“修改”时才会生成图片。', '回复后可以把提示词填回输入框再改，或选择“按此提示词生图”直接提交。只想改写描述时使用“只优化提示词”。'] },
      { title: '绘图提示词优化', steps: ['在“设置与 API → 习惯配置 → 对话习惯”开启或关闭“绘图提示词优化”。默认开启，保存后对所有对话的下一次请求生效；直接生成不经过此优化。', '开启后，AI 会整理画面要求、区分参考图用途，并在多轮改图时延续当前分支已确认的要求。例如“只把外套改红，脸、姿势和背景不变”；有多张参考图时说明各自用途。', '关闭只移除增强规则，仍可点击“只优化提示词”进行普通改写。看图与纠偏需要对话模型支持图片理解；精确局部修改建议配合蒙版。'] },
    ],
  },
  {
    title: '图片、蒙版与分支',
    intro: '参考图和编辑目标会跟随当前草稿；改写旧轮次可以保留不同版本。',
    cards: [
      { title: '添加图片参考', steps: ['上传、拖入或粘贴图片，也可以从生成结果和历史任务添加。点击附件上的移除按钮可从本次输入中删除。', '输入“@”可指定一张参考图；图片理解效果取决于当前对话模型是否支持看图。'] },
      { title: '继续修改或蒙版编辑', steps: ['先选中一张结果，再点击“继续修改”把图片带回输入框；需要局部调整时点击“蒙版编辑”。', '在蒙版编辑器里涂出要修改的区域，提交前可检查蒙版和提示词。生成期间需先停止，才能修改草稿。'] },
      { title: '切换对话分支', steps: ['编辑旧消息后重新发送，或重新生成某轮回复，会产生另一条分支。使用轮次旁的分支切换操作查看版本。', '右侧比较区只显示当前对话、当前分支的图片；其他分支和对话不会混入。'] },
    ],
  },
  {
    title: '对话管理',
    intro: '在“对话历史”中查找、整理或批量删除对话。',
    cards: [
      { title: '查找与新建', steps: ['搜索框可按标题或对话正文查找。单条对话可通过旁边的更多操作改名或删除。', '点击“新建对话”开始空白创作；切换回已有对话时，会恢复它自己的草稿和参数。'] },
      { title: '批量删除', steps: ['在左侧对话列表或“对话历史”点击“多选”，再勾选需要整理的对话；“全选”只选择当前搜索结果。点击“删除所选”，检查数量后确认。', '正在运行的对话会标为“生图中”或“回复中”，不会被删除；请先停止或等它完成，再重新选择。', '默认只删除对话并保留作品。确认时可选择同时删除这些对话关联的作品和生成记录。'] },
    ],
  },
  {
    title: '历史与收藏',
    intro: '生成历史用于找回作品；收藏夹用于长期整理喜欢的图片。',
    cards: [
      { title: '查找和复用历史作品', steps: ['打开“最近生成”或“生成历史”，搜索并按状态、收藏筛选。点开作品可查看完整提示词、模型和参数。', '“加入当前参考”只添加图片；“继续修改”设置编辑目标；“复用提示词与参数”会填入草稿，可撤销。查看历史不会切换当前对话。'] },
      { title: '管理收藏', steps: ['在作品卡片或详情中点击收藏，可选择一个或多个收藏夹。收藏夹可重命名、整理和查看作品。', '从收藏夹移除图片不会删除作品；删除收藏夹时可按确认弹窗选择是否同时删除其中的图片。'] },
      { title: '批量整理作品与收藏夹', steps: ['在空白处拖拽框选，或按住 Ctrl（Mac 为 ⌘）点击卡片进行多选；触屏可左右滑动卡片选择。', '选中后使用底部操作栏全选、反选、下载或删除；作品还可批量调整收藏夹。点击空白处可取消选择，删除前会再次确认。'] },
    ],
  },
  {
    title: '提示词',
    intro: '把常用描述保存下来，之后搜索并填入当前草稿。',
    cards: [
      { title: '个人提示词', steps: ['打开“提示词库 → 个人提示词”，可以新增、编辑、搜索和删除自己的提示词。', '点击“一键使用”只会填入当前输入框；图片附件和参数会保留，也不会自动开始生成。'] },
      { title: '网络提示词库', steps: ['切换到网络提示词库，按分类浏览或搜索；载入后的目录可在当前入口复用。', '收藏网络提示词会把正文和来源保存到个人提示词。网页预览图不会自动加入作品库。'] },
    ],
  },
  {
    title: '保存、备份与常见问题',
    intro: '作品和对话保存在当前桌面或浏览器入口；需要迁移时请使用数据导出。',
    cards: [
      { title: '备份与迁移', steps: ['在“设置与 API → 数据管理”导出 ZIP 备份。按提示保存全部分片，并在下载目录确认文件已完整落盘。', '桌面、不同浏览器各自保存作品和对话；要换入口或设备，请先从原入口导出，再在目标入口导入。'] },
      { title: '常见问题', steps: ['没有可选模型：检查对应分组的地址、Key 和模型是否填写并保存；也可尝试“测试连通”或手动填写模型 ID。', '生成失败：查看任务卡的错误说明和“提示词与详情”，核对图像服务及所选模型。对话失败时，图像服务和对话服务需分别检查。', '停止后远端服务可能仍在处理已受理的请求；本地停止会结束当前界面的后续处理。'] },
    ],
  },
]

export default function HelpModal({ appMode, isFavoriteCollectionOverview = false, onClose }: HelpModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [activeTopic, setActiveTopic] = useState(isFavoriteCollectionOverview ? 4 : 0)
  const isAgentMode = appMode === 'agent'
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, dialogRef)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')
    if (!controls?.length) { event.preventDefault(); return }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus() }
  }
  const topic = guide[activeTopic]

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-2 backdrop-blur-sm sm:p-5" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} onKeyDown={trapFocus} onClick={(event) => event.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-800 shadow-2xl dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 sm:max-h-[88vh]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 dark:border-white/10 sm:px-6">
          <div><h2 id="help-title" className="text-base font-semibold">操作指南</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">按主题查看创作、管理和备份方法</p></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭操作指南" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-gray-300 dark:hover:bg-white/10">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label="指南主题" className="hide-scrollbar flex shrink-0 gap-2 overflow-x-auto border-b border-gray-100 p-3 dark:border-white/10 sm:w-56 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4">
            {guide.map((item, index) => <button key={item.title} type="button" aria-current={activeTopic === index ? 'page' : undefined} onClick={() => setActiveTopic(index)} className={`min-h-10 shrink-0 rounded-xl px-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 sm:w-full ${activeTopic === index ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}><span className="mr-2 text-xs opacity-60">{String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}
          </nav>
          <main key={topic.title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <div className="mb-5"><h3 className="text-xl font-semibold">{topic.title}</h3><p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{topic.intro}</p></div>
            <div className="grid gap-3 lg:grid-cols-2">
              {topic.cards.map((card, index) => <section key={card.title} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-xs text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{index + 1}</span>{card.title}</h4>
                <ol className="space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{card.steps.map((step, stepIndex) => <li key={step} className="flex gap-2"><span className="mt-0.5 shrink-0 text-xs text-gray-400">{stepIndex + 1}.</span><span>{step}</span></li>)}</ol>
              </section>)}
            </div>
            {activeTopic === 1 && isAgentMode && <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">当前为对话创作模式：发送普通问题会先讨论；明确提出生成或修改图片时才会调用图像服务。</p>}
          </main>
        </div>
      </div>
    </div>,
    document.body
  )
}
