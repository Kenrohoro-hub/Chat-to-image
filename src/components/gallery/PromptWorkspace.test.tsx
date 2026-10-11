// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { PromptTemplate } from '../../types'
import PromptWorkspace from './PromptWorkspace'

const mock = vi.hoisted(() => ({ state: { prompt: '当前草稿', promptTemplates: [] as PromptTemplate[], setPromptTemplates: vi.fn(), showToast: vi.fn(), setConfirmDialog: vi.fn() }, apply: vi.fn(), load: vi.fn(), preload: vi.fn(), clear: vi.fn(), status: { busy: '', updatedAt: 0, imageCount: 0, itemCount: 0, revision: 0 } }))
vi.mock('../../store', () => ({ useStore: Object.assign((select: (state: typeof mock.state) => unknown) => select(mock.state), { getState: () => mock.state }) }))
vi.mock('../../lib/workspaceTransfer', () => ({ takePromptToGallery: mock.apply }))
vi.mock('../../lib/promptLibrary', () => ({ promptLibraries: Object.fromEntries(['garden', 'promptfill', 'youmind', 'pixto', 'nanoimage', 'nano', 'hero'].map((id) => [id, { load: mock.load, preload: mock.preload, clear: mock.clear, getStatus: () => mock.status, subscribe: () => () => {}, cancel: vi.fn() }])), getRemovedPromptSources: () => JSON.parse(localStorage.getItem('prompt-library-removed-v1') || '[]'), setRemovedPromptSources: (ids: string[]) => localStorage.setItem('prompt-library-removed-v1', JSON.stringify(ids)), getCachedPromptImage: async () => null, getPromptImageRevision: () => 0, subscribePromptImages: () => () => {} }))
beforeEach(() => { localStorage.removeItem('prompt-library-removed-v1'); localStorage.setItem('prompt-examples-added-v1', '1'); localStorage.setItem('prompt-examples-version', '2'); mock.preload.mockResolvedValue(undefined); mock.clear.mockResolvedValue(undefined) })
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
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="使用当前提示词"]')!.click())
  expect(mock.apply).toHaveBeenCalledExactlyOnceWith(item.content)
  expect(document.querySelector('[role=dialog]')).toBeNull()
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
  await act(() => document.querySelector<HTMLButtonElement>('[aria-label="使用当前提示词"]')!.click())
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

it('adds illustrated examples once without sources and does not restore a deleted example', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.removeItem('prompt-examples-added-v1')
  localStorage.removeItem('prompt-examples-version')
  mock.state.setPromptTemplates.mockImplementation(async (items) => { mock.state.promptTemplates = typeof items === 'function' ? items(mock.state.promptTemplates) : items; return true })
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  await act(() => root.render(<PromptWorkspace startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(22)
  expect(mock.state.promptTemplates.every((item) => item.previewUrl?.startsWith('/prompt-examples/') && !item.sourceUrl && !item.sourcePromptId)).toBe(true)
  mock.state.promptTemplates = mock.state.promptTemplates.slice(1)
  await act(() => root.render(<PromptWorkspace key="reopen" startWithDraft />))
  expect(mock.state.promptTemplates).toHaveLength(21)
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
  expect(mock.state.promptTemplates).toHaveLength(23)
  expect(mock.state.promptTemplates.slice(0, 2)).toEqual([personal, edited])
  expect(localStorage.getItem('prompt-examples-version')).toBe('2')
})
