// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { PromptTemplate } from '../../types'
import PromptWorkspace from './PromptWorkspace'
import { PROMPT_EXAMPLES_VERSION } from '../../lib/promptExamples'

const mock = vi.hoisted(() => ({ state: { prompt: '当前草稿', promptTemplates: [] as PromptTemplate[], promptCategories: ['默认', '漫画', 'agnet形象'], setPromptTemplates: vi.fn(), showToast: vi.fn(), setConfirmDialog: vi.fn() }, apply: vi.fn(), imageApply: vi.fn(), load: vi.fn(), preload: vi.fn(), clear: vi.fn(), status: { busy: '', updatedAt: 0, imageCount: 0, itemCount: 0, revision: 0 } }))
vi.mock('../../store', () => ({ useStore: Object.assign((select: (state: typeof mock.state) => unknown) => select(mock.state), { getState: () => mock.state }) }))
vi.mock('../../lib/workspaceTransfer', () => ({ takePromptToGallery: mock.apply, takePromptImageToGallery: mock.imageApply }))
vi.mock('../../lib/promptLibrary', () => ({ promptLibraries: Object.fromEntries(['garden', 'promptfill', 'youmind', 'pixto', 'nanoimage', 'nano', 'hero'].map((id) => [id, { load: mock.load, preload: mock.preload, clear: mock.clear, getStatus: () => mock.status, subscribe: () => () => {}, cancel: vi.fn() }])), getRemovedPromptSources: () => JSON.parse(localStorage.getItem('prompt-library-removed-v1') || '[]'), setRemovedPromptSources: (ids: string[]) => localStorage.setItem('prompt-library-removed-v1', JSON.stringify(ids)), getCachedPromptImage: async () => null, getPromptImageRevision: () => 0, subscribePromptImages: () => () => {} }))
beforeEach(() => { mock.state.promptCategories = ['默认', '漫画', 'agnet形象']; localStorage.removeItem('prompt-library-removed-v1'); localStorage.setItem('prompt-examples-added-v1', '1'); localStorage.setItem('prompt-examples-version', String(PROMPT_EXAMPLES_VERSION)); mock.preload.mockResolvedValue(undefined); mock.clear.mockResolvedValue(undefined) })
let root: ReturnType<typeof createRoot>
afterEach(async () => { if (root) await act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = ''; mock.state.promptTemplates = [] })

it('opens card details, saves metadata once and applies only the prompt', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const item = { id: 'garden-1', title: '摄影', content: '柔和侧光\n纯色背景', category: '产品', previewUrl: 'https://r2.qqsrc.com/images/1.jpg', sourceUrl: 'https://prompt.qqsrc.com/detail.html?id=1' }
  mock.load.mockResolvedValue([item])
  mock.apply.mockReturnValue(true)
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  expect([...document.querySelectorAll('.prompt-local-sources button, .prompt-site-button')].map((el) => el.getAttribute('aria-label'))).toEqual(['个人提示词', '水仙', 'PromptFill', 'YouMind', 'PixtoAI', 'NanoPrompts GPT-2', 'NanoPrompts', 'HeroPrompt'])
  expect(document.querySelector('[role="separator"]')?.textContent).toBe('网络提示词库')
  expect(document.querySelector('.prompt-site-home')?.getAttribute('href')).toBe('https://prompt.qqsrc.com/')
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看提示词：摄影"]')!.click())
  expect(document.querySelector('.prompt-detail-text')?.textContent).toBe(item.content)
  const save = document.querySelector<HTMLButtonElement>('[aria-label="收藏提示词"]')!
  await act(() => { save.click(); save.click() })
  expect(mock.state.setPromptTemplates).toHaveBeenCalledTimes(1)
  expect(mock.state.promptTemplates[0]).toMatchObject({ content: item.content, sourceUrl: item.sourceUrl, previewUrl: item.previewUrl })
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="引用当前提示词"]')!.click())
  expect(mock.apply).toHaveBeenCalledExactlyOnceWith(item.content)
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('references a preview image alone or with its prompt and keeps the dialog on failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const item = { id: 'garden-image', title: '配图提示词', content: '新提示词', previewUrl: 'https://r2.qqsrc.com/images/1.jpg' }
  mock.load.mockResolvedValue([item, { id: 'garden-text', title: '纯文字', content: '文字' }])
  mock.imageApply.mockResolvedValueOnce(false).mockResolvedValue(true)
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看提示词：配图提示词"]')!.click())
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.prompt-detail-actions button')].find((el) => el.textContent === label)!
  await act(async () => { button('引用图片').click() })
  expect(mock.imageApply).toHaveBeenLastCalledWith(item, false)
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
  await act(async () => { button('引用提示词和图片').click() })
  expect(mock.imageApply).toHaveBeenLastCalledWith(item, true)
  expect(document.querySelector('[role=dialog]')).toBeNull()
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看提示词：纯文字"]')!.click())
  expect(button('引用图片').disabled).toBe(true)
  expect(button('引用提示词和图片').disabled).toBe(true)
})

it('shows retry and allows personal prompts during a website failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.load.mockRejectedValueOnce(new Error('请检查网络')).mockResolvedValueOnce([])
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('检查网络')
  await act(() => document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
  expect(document.body.textContent).toContain('没有匹配的提示词')
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="个人提示词"]')!.click())
  expect(document.body.textContent).toContain('还没有个人提示词')
  warn.mockRestore()
})

it('opens the current draft for saving without loading the website', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="提示词内容"]')?.value).toBe('当前草稿')
  expect(mock.load).not.toHaveBeenCalled()
})


it('keeps details open when the current draft cannot be replaced', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.load.mockResolvedValue([{ id: 'garden-2', title: '保护检查', content: '新提示词' }])
  mock.apply.mockReturnValue(false)
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看提示词：保护检查"]')!.click())
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="引用当前提示词"]')!.click())
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
})

it('confirms all categories and clear, but preloads a selected category directly', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.load.mockResolvedValue([{ id: 'garden-1', title: '摄影', content: '光线', category: '产品' }])
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  const button = (label: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === label)!
  await act(() => button('预载全部').click())
  expect(mock.preload).not.toHaveBeenCalled()
  expect(mock.state.setConfirmDialog.mock.lastCall![0].message).toContain('全部 1 条')
  await act(() => mock.state.setConfirmDialog.mock.lastCall![0].action())
  expect(mock.preload).toHaveBeenCalledWith('')
  await act(() => document.querySelector<HTMLButtonElement>('.prompt-category-list button:nth-child(2)')!.click())
  await act(() => button('预载当前分类').click())
  expect(mock.preload).toHaveBeenLastCalledWith('产品')
  await act(() => button('清除预载数据').click())
  expect(mock.clear).not.toHaveBeenCalled()
  expect(mock.state.setConfirmDialog.mock.lastCall![0]).toMatchObject({ tone: 'danger', awaitAction: true })
  await act(() => mock.state.setConfirmDialog.mock.lastCall![0].action())
  expect(mock.clear).toHaveBeenCalledTimes(1)
  expect(mock.state.setPromptTemplates).not.toHaveBeenCalled()
})

it('adds illustrated examples once with local previews and does not restore a deleted example', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.removeItem('prompt-examples-added-v1')
  localStorage.removeItem('prompt-examples-version')
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(45)
  expect(mock.state.promptTemplates.every((item) => item.previewUrl?.startsWith('/prompt-examples/') && !item.sourceUrl && !item.sourcePromptId)).toBe(true)
  mock.state.promptTemplates = mock.state.promptTemplates.slice(1)
  await act(() => root.render(<PromptWorkspace key="reopen" startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(44)
  expect(mock.state.setPromptTemplates).toHaveBeenCalledTimes(1)
})

it('switches sites, keeps separate favorite identities on a shared homepage and allows reselecting a site', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.load.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'promptfill-a', sourcePromptId: 'promptfill-a', title: '模板A', content: '红色', category: '产品', categories: ['产品', '摄影'], sourceUrl: 'https://promptfill.tanshilong.com/explore' }, { id: 'promptfill-b', sourcePromptId: 'promptfill-b', title: '模板B', content: '蓝色', category: '摄影', sourceUrl: 'https://promptfill.tanshilong.com/explore' }])
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="PromptFill"]')!.click())
  expect(document.querySelector('.prompt-site-home')?.getAttribute('href')).toBe('https://promptfill.tanshilong.com/explore')
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="PromptFill"]')!.click())
  expect(document.querySelectorAll('.prompt-card')).toHaveLength(2)
  await act(() => document.querySelector<HTMLButtonElement>('.prompt-card-actions button:last-child')!.click())
  await act(() => document.querySelectorAll<HTMLButtonElement>('.prompt-card-actions button:last-child')[1].click())
  expect(mock.state.promptTemplates).toHaveLength(2)
  expect(new Set(mock.state.promptTemplates.map((item) => item.sourcePromptId)).size).toBe(2)
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="YouMind"]')!.click())
  expect(document.body.textContent).toContain('参考图需求')
})

it('confirms deleting a library, retains personal favorites and restores only its empty entry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.load.mockResolvedValue([{ id: 'garden-1', title: '摄影', content: '柔光', category: '产品' }])
  mock.state.promptTemplates = [{ id: 'saved', title: '收藏', content: '保留', createdAt: 0, updatedAt: 0 }]
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  const remove = [...document.querySelectorAll('button')].find((button) => button.textContent === '删除提示词库')!
  await act(() => remove.click())
  expect(mock.clear).not.toHaveBeenCalled()
  expect(mock.state.setConfirmDialog.mock.lastCall![0]).toMatchObject({ tone: 'danger', awaitAction: true })
  await act(() => mock.state.setConfirmDialog.mock.lastCall![0].action())
  expect(document.querySelector('.prompt-site-button[aria-label="水仙"]')).toBeNull()
  expect(document.querySelector('.prompt-catalog-title')?.textContent).toContain('个人提示词')
  expect(mock.state.promptTemplates[0].content).toBe('保留')
  expect(localStorage.getItem('prompt-library-removed-v1')).toBe('["garden"]')
  await act(() => root.render(<PromptWorkspace key="reopen" />))
  expect(document.querySelector('.prompt-site-button[aria-label="水仙"]')).toBeNull()
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="恢复 水仙 提示词库"]')!.click())
  expect(document.querySelector('.prompt-site-button[aria-label="水仙"]')).not.toBeNull()
})


it('retains the edited text when disk saving fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.state.setPromptTemplates.mockResolvedValue(false)
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  const input = document.querySelector<HTMLInputElement>('[aria-label="提示词名称"]')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '保存失败草稿')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="提示词内容"]')?.value).toBe('当前草稿')
})


it('adds the new pack to an existing library without replacing edited entries', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.removeItem('prompt-examples-version')
  const edited = { id: 'example-curated-01', title: '自己改过的海报', content: '保留修改', createdAt: 0, updatedAt: 1 }
  const personal = { ...edited, id: 'my-prompt', title: '个人内容' }
  mock.state.promptTemplates = [personal, edited]
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(46)
  expect(mock.state.promptTemplates.slice(0, 2)).toEqual([personal, edited])
  expect(localStorage.getItem('prompt-examples-version')).toBe('4')
})

it('adds later packs to version 2 without restoring deleted curated examples', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.setItem('prompt-examples-version', '2')
  const edited = { id: 'example-curated-01', title: '自己改过的海报', content: '保留修改', createdAt: 0, updatedAt: 1 }
  mock.state.promptTemplates = [edited]
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = items(mock.state.promptTemplates); return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(24)
  expect(mock.state.promptTemplates[0]).toEqual(edited)
  const names = ['蓝色大肥鱼', 'gpt', '豆包（seed）', 'grok', 'claude code', 'gemini', '千问', 'kimi', 'opencode', '智谱', 'RWKV', '文心一言', 'mistral', 'minimax', 'preplexity', 'image2', 'meta']
  expect(mock.state.promptTemplates.filter((item) => item.id.startsWith('example-zipzippipe-')).map((item) => item.title)).toEqual(names)
  for (const item of mock.state.promptTemplates.filter((item) => item.id.startsWith('example-zipzippipe-'))) {
    expect(item.content).toBe(`${item.title}\n\n图片来源：B站 ZipZipPipe\nhttps://space.bilibili.com/4168597`)
    expect(item.previewUrl).toMatch(/^\/prompt-examples\/example-zipzippipe-\d{2}\.jpg$/)
  }
  expect(localStorage.getItem('prompt-examples-version')).toBe('4')
  mock.state.promptTemplates = [edited]
  mock.state.setPromptTemplates.mockClear()
  await act(() => root.unmount())
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.setPromptTemplates).not.toHaveBeenCalled()
})

it('adds six comic prompts to version 3 without restoring deleted older packs or overwriting edits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.setItem('prompt-examples-version', '3')
  const personal = { id: 'my-comic', title: '自己的故事', content: '保留正文', createdAt: 1, updatedAt: 1 }
  const edited = { ...personal, id: 'example-ai-comic-01', title: '已修改的吃饭漫画' }
  mock.state.promptTemplates = [personal, edited]
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = items(mock.state.promptTemplates); return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(7)
  expect(mock.state.promptTemplates.slice(0, 2)).toEqual([personal, edited])
  expect(mock.state.promptTemplates.map((item) => item.id)).toEqual(expect.arrayContaining([
    'example-ai-comic-01', 'example-ai-comic-02', 'example-ai-comic-03', 'example-ai-comic-04',
    'example-token-rice-comic', 'example-warm-ai-comic',
  ]))
  expect(mock.state.promptTemplates.some((item) => item.id.startsWith('example-curated-') || item.id.startsWith('example-zipzippipe-'))).toBe(false)
  expect(localStorage.getItem('prompt-examples-version')).toBe('4')
  mock.state.promptTemplates = [personal]
  await act(() => root.render(<PromptWorkspace key="reopen-comics" startWithDraft />))
  expect(mock.state.promptTemplates).toEqual([personal])
  expect(mock.state.setPromptTemplates).toHaveBeenCalledTimes(1)
})


it('manages personal categories, keeps empty categories and moves prompts on deletion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.state.promptTemplates = [{ id: 'comic', title: '漫画正文', content: '四格故事', category: '漫画', createdAt: 0, updatedAt: 0 }]
  mock.state.setPromptTemplates.mockImplementation(async (items, categories) => {
    mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items
    if (categories) mock.state.promptCategories = typeof categories === 'function' ? categories(mock.state.promptCategories) : categories
    return true
  })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="个人提示词"]')!.click())
  const button = (label: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === label)!
  const fillName = async (value: string) => act(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="分类名称"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const submit = async () => act(() => document.querySelector('.prompt-category-manager form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect([...document.querySelectorAll('.prompt-category-list button span')].map((el) => el.textContent)).toEqual(['全部分类', '默认', '漫画', 'agnet形象'])
  await act(() => button('管理分类').click())
  await fillName(' 自定义 ')
  await submit()
  expect(mock.state.promptCategories).toContain('自定义')
  await act(() => root.render(<PromptWorkspace />))
  expect(document.querySelector('.prompt-category-list')?.textContent).toContain('自定义0')
  await fillName('自定义')
  await submit()
  expect(document.querySelector('.prompt-category-manager [role="alert"]')?.textContent).toContain('已存在')
  expect(mock.state.promptCategories.filter((name) => name === '自定义')).toHaveLength(1)
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="重命名分类：漫画"]')!.click())
  await fillName('四格漫画')
  await submit()
  expect(mock.state.promptTemplates[0]).toMatchObject({ category: '四格漫画', content: '四格故事' })
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="删除分类：四格漫画"]')!.click())
  const dialog = mock.state.setConfirmDialog.mock.lastCall![0]
  expect(dialog.message).toContain('正文和图片都会保留')
  await act(() => dialog.action())
  expect(mock.state.promptCategories).not.toContain('四格漫画')
  expect(mock.state.promptTemplates[0]).toMatchObject({ category: '默认', content: '四格故事' })
  mock.state.setPromptTemplates.mockResolvedValueOnce(false)
  await fillName('保存失败')
  await submit()
  expect(mock.state.promptCategories).not.toContain('保存失败')
  expect(document.querySelector<HTMLInputElement>('[aria-label="分类名称"]')?.value).toBe('保存失败')
  expect(document.querySelector('.prompt-category-manager [role="alert"]')?.textContent).toContain('未能保存')
})

it('filters personal prompts and saves new prompts into the selected category', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.state.promptTemplates = [{ id: 'one', title: '普通提示词', content: '摄影', category: '默认', createdAt: 0, updatedAt: 0 }]
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="个人提示词"]')!.click())
  await act(() => document.querySelectorAll<HTMLButtonElement>('.prompt-category-list button')[2].click())
  expect(document.body.textContent).toContain('这个分类还没有提示词')
  const create = [...document.querySelectorAll('button')].find((el) => el.textContent === '＋ 新建提示词')!
  await act(() => create.click())
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="提示词分类"]')?.value).toBe('漫画')
  await act(() => {
    const title = document.querySelector<HTMLInputElement>('[aria-label="提示词名称"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '新漫画')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    const content = document.querySelector<HTMLTextAreaElement>('[aria-label="提示词内容"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(content, '完整故事')
    content.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(() => document.querySelector('.prompt-detail form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(mock.state.promptTemplates[0]).toMatchObject({ title: '新漫画', content: '完整故事', category: '漫画' })
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="关闭提示词详情"]')!.click())
  expect(document.querySelectorAll('.prompt-card')).toHaveLength(1)
  expect(document.querySelector('.prompt-card')?.textContent).toContain('新漫画')
})


it('reorders personal categories in both directions without changing prompts or selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const prompt = { id: 'one', title: '故事', content: '完整正文', category: '漫画', createdAt: 0, updatedAt: 0 }
  mock.state.promptTemplates = [prompt]
  mock.state.setPromptTemplates.mockImplementation(async (items, categories) => {
    mock.state.promptTemplates = items(mock.state.promptTemplates)
    mock.state.promptCategories = categories(mock.state.promptCategories)
    return true
  })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace />))
  expect(document.querySelector('.prompt-category-list button[draggable="true"]')).toBeNull()
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="个人提示词"]')!.click())
  const row = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.prompt-category-list button')].find((el) => el.querySelector('span')?.textContent === name)!
  const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
  const drag = async (from: string, to: string, after: boolean) => {
    const source = row(from)
    const target = row(to)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40 } as DOMRect)
    await act(() => {
      const event = new MouseEvent('dragstart', { bubbles: true })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      source.dispatchEvent(event)
    })
    await act(() => {
      const event = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: after ? 130 : 110 })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      target.dispatchEvent(event)
    })
    expect(target.dataset.drop).toBe(after ? 'after' : 'before')
    await act(() => target.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: after ? 130 : 110 })))
  }
  await drag('默认', 'agnet形象', true)
  expect(mock.state.promptCategories).toEqual(['漫画', 'agnet形象', '默认'])
  await drag('默认', '漫画', false)
  expect(mock.state.promptCategories).toEqual(['默认', '漫画', 'agnet形象'])
  await act(() => row('漫画').click())
  await act(() => row('漫画').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })))
  expect(mock.state.promptCategories).toEqual(['默认', 'agnet形象', '漫画'])
  expect(row('漫画').getAttribute('aria-pressed')).toBe('true')
  mock.state.setPromptTemplates.mockResolvedValueOnce(false)
  await drag('漫画', '默认', false)
  expect(mock.state.promptCategories).toEqual(['默认', 'agnet形象', '漫画'])
  expect(mock.state.promptTemplates).toEqual([prompt])
  expect(document.querySelector('.prompt-category-list [data-dragging]')).toBeNull()
  expect(document.querySelector('.prompt-category-list [data-drop]')).toBeNull()
  mock.state.setPromptTemplates.mockClear()
  await act(() => row('默认').dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true })))
  expect(mock.state.setPromptTemplates).not.toHaveBeenCalled()
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="水仙"]')!.click())
  expect(document.querySelector('.prompt-category-list button[draggable="true"]')).toBeNull()
})
