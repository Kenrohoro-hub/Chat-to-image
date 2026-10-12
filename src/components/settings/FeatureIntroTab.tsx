import { CodeIcon, CollectionManageIcon, EditIcon, GithubIcon, HistoryIcon, SettingsIcon } from '../icons'
import { t } from '../../lib/i18n'

export default function FeatureIntroTab() {
  return <section aria-label={t('功能介绍', 'Features')} className="space-y-5 text-sm">
    <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 sm:p-6 dark:border-blue-400/15 dark:from-blue-950/40 dark:via-gray-900 dark:to-indigo-950/30">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-900 text-xl font-semibold text-white dark:bg-white dark:text-gray-900" aria-hidden="true">C</span>
        <div><h4 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Chat to image</h4><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('本地 AI 图像创作工作室', 'Your local AI image studio')}</p></div>
        <span className="rounded-full border border-blue-200/70 bg-white/70 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300">v{__APP_VERSION__}</span>
      </div>
      <p className="mt-5 text-lg font-medium text-gray-900 dark:text-gray-100">{t('从想法，到画面。', 'Bring your ideas to life.')}</p>
      <p className="mt-2 max-w-2xl leading-6 text-gray-600 dark:text-gray-400">{t('讨论创意、整理提示词、生成与修改图片，再把满意的作品保存下来。在同一个工作区完成你的创作流程。', 'Discuss ideas, refine prompts, generate and edit images, and save your favorites, all in one workspace.')}</p>
      <a href="https://github.com/Kenrohoro-hub/Chat-to-image" target="_blank" rel="noopener noreferrer" className="mt-5 flex w-fit max-w-full items-start gap-2 rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:text-blue-300">
        <GithubIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0"><span className="block font-medium">{t('项目地址 ↗', 'Project page ↗')}</span><span className="mt-0.5 block break-all text-xs">https://github.com/Kenrohoro-hub/Chat-to-image</span></span>
      </a>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { title: t('对话式创作', 'Create through chat'), icon: EditIcon, text: t('讨论构图、优化提示词，结合参考图连续生成或修改。支持对话分支、停止回复和上下文选择。', 'Discuss composition, refine prompts, and generate or edit with reference images. Branch conversations, stop replies, and choose the context to include.') },
        { title: t('图片生成与编辑', 'Image generation and editing'), icon: SettingsIcon, text: t('直接生图、参考图编辑与蒙版局部修改。按模型能力选择尺寸、比例、质量、格式和透明背景。', 'Generate directly, edit from references, and mask specific areas. Choose size, aspect ratio, quality, format, and transparency supported by your model.') },
        { title: t('提示词库', 'Prompt library'), icon: CollectionManageIcon, text: t('浏览网络库、分类搜索、大图预览，一键收藏或填入草稿。可预载图片，并自定义全部提示词的保存位置。', 'Browse online libraries, search categories, preview large images, and save or use prompts. Preload images and choose where to store your prompt libraries.') },
        { title: t('作品与对话管理', 'Image and conversation management'), icon: HistoryIcon, text: t('搜索生成历史、收藏作品、下载图片和复用参数；导入导出作品、对话及个人提示词。', 'Search history, organize favorites, download images, and reuse settings. Import and export images, conversations, and personal prompts.') },
        { title: t('API 与模型管理', 'API and model management'), icon: SettingsIcon, text: t('图像与对话服务分开配置。读取模型目录、选择默认模型，并分别设置主用和备用服务。', 'Configure image and chat services separately. Fetch model catalogs, choose default models, and set primary and backup services for each group.') },
        { title: t('外部 Agent 连接', 'External agent connections'), icon: CodeIcon, text: t('连接 Codex、Claude Code、Cursor 与 DeepSeek Harness，通过本机命令生成或编辑图片，返回本地文件。', 'Connect Codex, Claude Code, Cursor, and DeepSeek Harness to generate or edit images with local commands and receive local files.') },
      ].map((feature) => <article key={feature.title} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
        <h5 className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100"><feature.icon className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" aria-hidden="true" />{feature.title}</h5>
        <p className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">{feature.text}</p>
      </article>)}
    </div>
    <div className="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.03]">
      <h5 className="font-medium text-gray-800 dark:text-gray-200">{t('开始使用', 'Get started')}</h5>
      <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs leading-6 text-gray-600 dark:text-gray-400">
        <li>{t('在“API 配置”填写可用的服务、密钥与模型，保存配置。', 'Enter your service, API key, and model in API profiles, then save.')}</li>
        <li>{t('进入“创作”，输入想法或从提示词库选择灵感；需要时添加参考图。', 'Open Create and enter an idea or choose a prompt from the library. Add reference images when needed.')}</li>
        <li>{t('查看生成结果，继续修改，或下载、收藏到作品库。', 'Review results, continue editing, download them, or save them to favorites.')}</li>
      </ol>
      <p className="mt-3 border-t border-gray-200 pt-3 text-xs leading-5 text-gray-500 dark:border-white/10 dark:text-gray-400">{t('直接生图需要图像服务，对话式创作还需对话服务。可用能力与调用费用取决于你配置的模型和服务商。', 'Direct generation requires an image service. Creating through chat also requires a chat service. Features and charges depend on your models and providers.')}</p>
    </div>
  </section>
}
