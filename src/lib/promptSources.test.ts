import { expect, it, vi } from 'vitest'
import { normalizePromptFill, normalizeYouMind, promptImageUrl } from './promptSources'

it('resolves localized and repeated PromptFill variables and excludes video templates', () => {
  const result = normalizePromptFill({ templates: { config: [{ id: 'a', name: { cn: '填空', en: 'Fill' }, content: { cn: '{{pose}} / {{pose}} / {{color:蓝色}} / {{light}} / {{missing}}' }, selections: { 'pose-0': { cn: '站立' }, 'pose-1': '坐下' }, tags: ['产品', '摄影', '产品'] }, { id: 'v', type: 'video', name: '视频', content: '视频' }] }, banks: { defaults: { light: { cn: '柔光' } } } })
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ sourcePromptId: 'promptfill-a', content: '站立 / 坐下 / 蓝色 / 柔光 / {{missing}}', categories: ['产品', '摄影'] })
  expect(() => normalizePromptFill({})).toThrow('格式')
})

it('uses YouMind translation and defaults, groups reference needs and validates images', () => {
  const result = normalizeYouMind([{ id: 2, title: '肖像', content: 'English', translatedContent: '穿着{argument name="服装" default="白衬衫"}', needReferenceImages: true, media: ['https://cms-assets.youmind.com/media/a.jpg'] }, { id: 3, title: '山水', content: 'Landscape', translatedContent: ' ', media: ['https://evil.example/a.jpg'] }, { id: 4, title: '空白', content: '' }])
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ content: '穿着白衬衫', category: '需要参考图', sourceUrl: 'https://youmind.com/zh-CN/nano-banana-pro-prompts/explore?id=2' })
  expect(result[1]).toMatchObject({ content: 'Landscape', category: '无需参考图', previewUrl: undefined })
  for (const url of ['https://s3.bmp.ovh/imgs/../a.jpg', 'https://s3.bmp.ovh/imgs/a.jpg?x=1', 'https://evil.example/a.jpg']) expect(promptImageUrl(url)).toBeUndefined()
})

it('stops assigning new YouMind pages after a failure', async () => {
  vi.resetModules()
  const read = vi.fn(async (page: number) => {
    if (page === 2) throw new Error('offline')
    return { prompts: [], totalPages: 20 }
  })
  vi.doMock('./desktop', () => ({ desktopApi: async () => ({ read_youmind_prompts: read }), isLocalService: () => true }))
  try {
    const { fetchPromptSource } = await import('./promptSources')
    await expect(fetchPromptSource('youmind', vi.fn())).rejects.toThrow('offline')
    expect(read.mock.calls.length).toBeLessThanOrEqual(4)
  } finally { vi.doUnmock('./desktop'); vi.resetModules() }
})

it('imports complete Pixto styles, distinct Nano models and localized Hero defaults', async () => {
  const { normalizePromptSource, promptSourceName } = await import('./promptSources')
  expect(normalizePromptSource('pixto', [{ id: 4, name: '水墨', pre_prompt: '转为水墨画。', fe_prompt: '盖红印章。', category: { name: '艺术风格' }, logo: 'https://turing-img.animelook.top/pic/a.jpg' }, { id: 5, name: '空白' }, { id: 6, name: '视频', category_id: 48, pre_prompt: '视频' }])).toEqual([expect.objectContaining({ id: 'pixto-4', content: '转为水墨画。\n\n盖红印章。', category: '艺术风格' })])
  const record = [{ id: 'a', title: '海报', prompt: '中文海报', category: 'Marketing', image_url: 'https://banana-prompt.nanoprompts.org/handbook/a.webp', link: '/zh/prompt-handbook/marketing/#a' }]
  const nano = normalizePromptSource('nano', record)[0]
  const image = normalizePromptSource('nanoimage', record)[0]
  expect(nano.id).not.toBe(image.id)
  expect(promptSourceName(nano)).toBe('NanoPrompts')
  expect(promptSourceName(image)).toBe('NanoPrompts GPT-2')
  expect(normalizePromptSource('hero', [{ id: 'a-b', i18nContent: { 'zh-CN': { title: '电影人像', prompt: '{{ 1|lighting|柔光 }}背景' } }, tagsArray: { 'zh-CN': ['摄影', '人像'] }, imageUrl: 'https://pbs.twimg.com/media/test?format=jpg&name=orig' }])[0]).toMatchObject({ content: '柔光背景', categories: ['摄影', '人像'], previewUrl: 'https://pbs.twimg.com/media/test?format=jpg&name=orig', sourceUrl: 'https://heroprompt.sortes.ai/zh/posts/a-b' })
  expect(promptImageUrl('https://pbs.twimg.com/media/test?format=html&name=orig')).toBeUndefined()
  expect(promptImageUrl('https://pbs.twimg.com/media/test?format=jpg&name=orig&url=http://localhost')).toBeUndefined()
})
