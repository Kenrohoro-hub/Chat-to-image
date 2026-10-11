import { expect, it, vi } from 'vitest'
import { runImageBatch } from './imageBatch'

it('limits simultaneous image requests across batches and skips queued requests after cancellation', async () => {
  const controller = new AbortController()
  let active = 0
  let peak = 0
  const releases: Array<() => void> = []
  const run = vi.fn(async (index: number) => {
    active++
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active--
    return { images: [`image-${index}`] }
  })
  const completed = vi.fn()
  const first = runImageBatch(4, run, controller.signal, completed)
  const second = runImageBatch(1, run)
  await vi.waitFor(() => expect(releases).toHaveLength(2))
  releases.shift()!()
  await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1))
  controller.abort()
  while (releases.length) releases.shift()!()
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4))
  while (releases.length) releases.shift()!()
  const result = await first
  await second
  expect(peak).toBe(2)
  expect(result.images.length).toBeGreaterThan(0)
  expect(result.failedRequests).toHaveLength(1)
})

it('keeps completed images in request order and reports failures without repeating submissions', async () => {
  const run = vi.fn(async (index: number) => {
    if (index === 1) throw new Error('refused')
    return { images: [`image-${index}`], usedProfile: { id: `profile-${index}`, name: 'test', model: 'test' } }
  })
  const result = await runImageBatch(3, run)
  expect(run).toHaveBeenCalledTimes(3)
  expect(result.images).toEqual(['image-0', 'image-2'])
  expect(result.usedProfiles?.map((profile) => profile?.id)).toEqual(['profile-0', 'profile-2'])
  expect(result.failedRequests).toEqual([{ requestIndex: 1, error: 'refused' }])
})

it('stops waiting submissions if saving completed output fails', async () => {
  const run = vi.fn(async () => ({ images: ['image'] }))
  await expect(runImageBatch(5, run, undefined, async () => { throw new Error('disk full') })).rejects.toMatchObject({ name: 'ImageOutputStorageError' })
  expect(run.mock.calls.length).toBeLessThanOrEqual(2)
})

it('still saves in-flight results after another completed image failed to save', async () => {
  const save = vi.fn(async (_result, index) => { if (index === 0) throw new Error('first save failed') })
  await expect(runImageBatch(3, async (index) => ({ images: [`image-${index}`] }), undefined, save)).rejects.toThrow('first save failed')
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1][1]).toBe(1)
})
