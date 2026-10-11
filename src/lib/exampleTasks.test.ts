import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { putTask, storeImage } from './db'
import { seedExampleTasks } from './exampleTasks'

vi.mock('./db', () => ({ putTask: vi.fn(), storeImage: vi.fn() }))

describe('starter examples', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['offline image'], { type: 'image/png' }))))
    vi.mocked(storeImage).mockImplementation(async () => `example-image-${vi.mocked(storeImage).mock.calls.length}`)
    vi.mocked(putTask).mockResolvedValue('example-task')
  })

  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

  it('adds three different local examples to history and the selected collection without altering personal tasks', async () => {
    const personal: TaskRecord = { id: 'personal', prompt: '用户作品', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: ['personal-image'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 }
    const snapshot = structuredClone(personal)
    const tasks = await seedExampleTasks([personal], 'my-default')

    expect(tasks).toHaveLength(3)
    expect(new Set(tasks.map((task) => task.prompt)).size).toBe(3)
    expect(tasks.map((task) => task.outputImages.length)).toEqual([1, 2, 1])
    expect(tasks.every((task) => task.isExample && task.isFavorite && task.favoriteCollectionIds?.[0] === 'my-default')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(putTask).toHaveBeenCalledTimes(3)
    expect(personal).toEqual(snapshot)
    expect(vi.mocked(putTask).mock.calls.some(([task]) => task.id === personal.id)).toBe(false)
  })

  it('keeps deleted examples deleted after subsequent startup', async () => {
    await seedExampleTasks([], 'default')
    vi.mocked(fetch).mockClear()
    vi.mocked(putTask).mockClear()
    expect(await seedExampleTasks([], 'default')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    expect(putTask).not.toHaveBeenCalled()
  })

  it('does not duplicate examples already restored from a backup', async () => {
    const tasks = await seedExampleTasks([], 'default')
    localStorage.setItem('chat-to-image-examples-v1', '')
    vi.mocked(putTask).mockClear()
    expect(await seedExampleTasks(tasks.slice(0, 1), 'default')).toEqual([])
    expect(putTask).not.toHaveBeenCalled()
  })

  it('does not write tasks when bundled images cannot be loaded, and retries on next startup', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(seedExampleTasks([], 'default')).rejects.toThrow('内置示例图片读取失败')
    expect(putTask).not.toHaveBeenCalled()
    expect(await seedExampleTasks([], 'default')).toHaveLength(3)
  })
})
