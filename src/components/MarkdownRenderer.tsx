import { t } from '../lib/i18n'
import { memo, useEffect, useState } from 'react'
import type { Components, MathPlugin, StreamdownTranslations } from 'streamdown'
import type { Components as ReactMarkdownComponents } from 'react-markdown'

type MarkdownRendererProps = {
  content: string
  streaming?: boolean
  className?: string
}

type StreamdownComponent = typeof import('streamdown')['Streamdown']
type ReactMarkdownComponent = typeof import('react-markdown')['default']
type RemarkGfmPlugin = typeof import('remark-gfm')['default']
type LegacyMarkdownModule = {
  ReactMarkdown: ReactMarkdownComponent
  remarkGfm: RemarkGfmPlugin
}
type MathMarkdownModule = {
  math: MathPlugin
}
type MarkdownRendererState =
  | { type: 'loading' }
  | { type: 'modern'; Component: StreamdownComponent; math: MathMarkdownModule }
  | { type: 'legacy'; module: LegacyMarkdownModule }
  | { type: 'plain' }

const allowedUrlProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function safeUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    return allowedUrlProtocols.has(parsed.protocol) ? url : '#blocked'
  } catch {
    return '#blocked'
  }
}

const markdownComponents: Components = {
  a({ children, href, node: _node, ...props }) {
    const shouldOpenBlank = Boolean(href && href !== '#blocked')
    return (
      <a
        {...props}
        href={href}
        rel={shouldOpenBlank ? 'noreferrer' : undefined}
        target={shouldOpenBlank ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  },
}

const legacyMarkdownComponents: ReactMarkdownComponents = {
  a({ children, href, ...props }) {
    const safeHref = safeUrl(href ?? '')
    const shouldOpenBlank = safeHref !== '#blocked'
    return (
      <a
        {...props}
        href={safeHref}
        rel={shouldOpenBlank ? 'noreferrer' : undefined}
        target={shouldOpenBlank ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  },
}

const translations: Partial<StreamdownTranslations> = {
  copied: t('已复制', 'Copied'),
  copyCode: t('复制代码', 'Copy code'),
  copyLink: t('复制链接', 'Copy link'),
  copyTable: t('复制表格', 'Copy table'),
  copyTableAsCsv: t('复制为 CSV', 'Copy as CSV'),
  copyTableAsMarkdown: t('复制为 Markdown', 'Copy as Markdown'),
  copyTableAsTsv: t('复制为 TSV', 'Copy as TSV'),
  downloadFile: t('下载文件', 'Download file'),
  downloadImage: t('下载图片', 'Download image'),
  downloadTable: t('下载表格', 'Download table'),
  downloadTableAsCsv: t('下载为 CSV', 'Download as CSV'),
  downloadTableAsMarkdown: t('下载为 Markdown', 'Download as Markdown'),
  externalLinkWarning: t('即将打开外部链接', 'You are about to open an external link'),
  imageNotAvailable: t('图片不可用', 'Image unavailable'),
  openExternalLink: t('打开外部链接', 'Open external link'),
  openLink: t('打开链接', 'Open link'),
  tableFormatCsv: 'CSV',
  tableFormatMarkdown: 'Markdown',
  tableFormatTsv: 'TSV',
  viewFullscreen: t('全屏查看', 'View fullscreen'),
}

const canLoadStreamdown = (() => {
  try {
    new RegExp('(?<=a)b')
    return typeof (Array.prototype as { at?: unknown }).at === 'function'
  } catch {
    return false
  }
})()

let streamdownPromise: Promise<MarkdownRendererState> | null = null
let legacyMarkdownPromise: Promise<MarkdownRendererState> | null = null

function loadLegacyMarkdown() {
  legacyMarkdownPromise ??= Promise.all([import('react-markdown'), import('remark-gfm')])
    .then(([reactMarkdown, remarkGfm]) => ({
      type: 'legacy' as const,
      module: {
        ReactMarkdown: reactMarkdown.default,
        remarkGfm: remarkGfm.default,
      },
    }))
    .catch((error) => {
      console.error('Legacy markdown renderer failed to load:', error)
      return { type: 'plain' as const }
    })

  return legacyMarkdownPromise
}

function loadMarkdownRenderer() {
  if (!canLoadStreamdown) return loadLegacyMarkdown()

  streamdownPromise ??= Promise.all([
    import('streamdown'),
    import('@streamdown/math'),
  ])
    .then(([streamdown, math]) => ({
      type: 'modern' as const,
      Component: streamdown.Streamdown,
      math: {
        math: math.createMathPlugin({
          errorColor: 'var(--muted-foreground)',
          singleDollarTextMath: true,
        }),
      },
    }))
    .catch((error) => {
      console.error('Streamdown failed to load:', error)
      return loadLegacyMarkdown()
    })

  return streamdownPromise!
}

function PlainTextMarkdown({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div
      className={`markdown-renderer ${className}`.trim()}
      dir="auto"
      style={{ whiteSpace: 'pre-wrap' }}
    >
      {content}
    </div>
  )
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false,
  className = '',
}: MarkdownRendererProps) {
  const [renderer, setRenderer] = useState<MarkdownRendererState>({ type: 'loading' })

  useEffect(() => {
    let disposed = false

    loadMarkdownRenderer().then((nextRenderer) => {
      if (!disposed) setRenderer(nextRenderer)
    })

    return () => {
      disposed = true
    }
  }, [])

  if (renderer.type === 'legacy') {
    const { ReactMarkdown, remarkGfm } = renderer.module
    return (
      <div className={`markdown-renderer ${className}`.trim()} dir="auto">
        <ReactMarkdown
          components={legacyMarkdownComponents}
          remarkPlugins={[remarkGfm]}
          urlTransform={safeUrl}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  if (renderer.type !== 'modern') {
    return <PlainTextMarkdown content={content} className={className} />
  }

  const StreamdownComponent = renderer.Component

  return (
    <StreamdownComponent
      className={`markdown-renderer ${className}`.trim()}
      components={markdownComponents}
      controls={{
        code: { copy: true, download: false },
        mermaid: false,
        table: { copy: true, download: false, fullscreen: true },
      }}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={false}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      plugins={{ math: renderer.math.math }}
      skipHtml
      translations={translations}
      urlTransform={safeUrl}
    >
      {content}
    </StreamdownComponent>
  )
})

export default MarkdownRenderer
