import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { takePromptImageToGallery } from './workspaceTransfer'

const mock = vi.hoisted(() => ({
  state: { setAppMode: vi.fn(), showToast: vi.fn() },
  before: { prompt: '原草稿', inputImages: [] as { id: string; dataUrl: string }[] },
  cached: vi.fn(),
  download: vi.fn(),
  toDataUrl: vi.fn(),
  store: vi.fn(),
  cache: vi.fn(),
  apply: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('../store', () => ({ useStore: { getState: () => mock.state }, deleteImageIfUnreferenced: mock.remove }))
vi.mock('./creationDraft', () => ({ captureCreationDraft: () => mock.before, applyCreationDraft: mock.apply }))
vi.mock('./dataUrl', () => ({ blobToDataUrl: mock.toDataUrl }))
vi.mock('./db', () => ({ storeImage: mock.store }))
vi.mock('./desktop', () => ({ desktopApi: async () => ({ download_prompt_image: mock.download }) }))
vi.mock('./imageCache', () => ({ cacheImage: mock.cache }))
vi.mock('./promptLibrary', () => ({ getCachedPromptImage: mock.cached }))
vi.mock('./promptSources', () => ({ promptImageUrl: (url: string) => url.startsWith('https://r2.qqsrc.com/images/') ? url : undefined }))

beforeEach(() => {
  vi.clearAllMocks()
  mock.before = { prompt: '原草稿', inputImages: [{ id: 'old', dataUrl: 'data:image/png;base64,b2xk' }] }
  mock.cached.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
  mock.toDataUrl.mockResolvedValue('data:image/png;base64,eA==')
  mock.store.mockResolvedValue('new')
  mock.apply.mockReturnValue(true)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('adds a cached preview without changing the prompt, or adds prompt and image together', async () => {
  const item = { id: 'item', title: '示例', content: '新提示词', previewUrl: '/prompt-examples/example.jpg', createdAt: 0, updatedAt: 0 }
  expect(await takePromptImageToGallery(item)).toBe(true)
  expect(mock.apply).toHaveBeenLastCalledWith(mock.before, { inputImages: [...mock.before.inputImages, { id: 'new', dataUrl: 'data:image/png;base64,eA==' }] })
  expect(mock.download).not.toHaveBeenCalled()
  expect(await takePromptImageToGallery(item, true)).toBe(true)
  expect(mock.apply).toHaveBeenLastCalledWith(mock.before, { prompt: '新提示词', inputImages: [...mock.before.inputImages, { id: 'new', dataUrl: 'data:image/png;base64,eA==' }] })
})

it('downloads an uncached network preview through the local image API and loads built-in images directly', async () => {
  mock.cached.mockResolvedValue(null)
  mock.download.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,eA==' })
  const remote = { id: 'remote', title: '网站', content: '提示词', previewUrl: 'https://r2.qqsrc.com/images/1.jpg', createdAt: 0, updatedAt: 0 }
  expect(await takePromptImageToGallery(remote)).toBe(true)
  expect(mock.download).toHaveBeenCalledWith(remote.previewUrl)
  expect(mock.apply.mock.lastCall![1].inputImages[1].dataUrl).toBe('data:image/jpeg;base64,eA==')

  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) })
  vi.stubGlobal('fetch', fetcher)
  const builtIn = { ...remote, previewUrl: '/prompt-examples/example.jpg' }
  expect(await takePromptImageToGallery(builtIn)).toBe(true)
  expect(fetcher).toHaveBeenCalledWith(builtIn.previewUrl)
})

it('leaves the draft alone when the download fails or changes while loading', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mock.cached.mockResolvedValue(null)
  mock.download.mockRejectedValue(new Error('网络中断'))
  const item = { id: 'remote', title: '网站', content: '提示词', previewUrl: 'https://r2.qqsrc.com/images/1.jpg', createdAt: 0, updatedAt: 0 }
  expect(await takePromptImageToGallery(item, true)).toBe(false)
  expect(mock.apply).not.toHaveBeenCalled()
  expect(mock.state.showToast).toHaveBeenCalledWith('引用图片失败：网络中断', 'error')

  mock.cached.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
  mock.apply.mockReturnValue(false)
  expect(await takePromptImageToGallery(item)).toBe(false)
  expect(mock.remove).toHaveBeenCalledWith('new')
})
