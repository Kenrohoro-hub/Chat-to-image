import type { CallApiResult } from './imageApiShared'

let active = 0
const waiting: Array<() => void> = []

async function acquireImageSlot(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const start = () => { signal?.removeEventListener('abort', cancel); active++; resolve() }
    const cancel = () => {
      const index = waiting.indexOf(start)
      if (index >= 0) waiting.splice(index, 1)
      reject(signal?.reason ?? new DOMException('已停止生成', 'AbortError'))
    }
    if (active < 2) start()
    else { waiting.push(start); signal?.addEventListener('abort', cancel, { once: true }) }
  })
}

export async function runImageBatch(count: number, run: (index: number) => Promise<CallApiResult>, signal?: AbortSignal, onCompleted?: (result: CallApiResult, index: number) => Promise<void>, onStarted?: () => void): Promise<CallApiResult> {
  let save = Promise.resolve()
  let saveError: Error | undefined
  const results = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
    await acquireImageSlot(signal)
    try {
      signal?.throwIfAborted()
      if (saveError) throw saveError
      onStarted?.()
      const result = await run(index)
      // 已收到的完整图片即使恰好取消也要保存，预览帧仍走原来的流式回调。
      if (onCompleted && result.images.length) {
        save = save.catch(() => undefined).then(() => onCompleted(result, index)).catch((error) => {
          saveError = Object.assign(new Error(error instanceof Error ? error.message : '图片保存失败'), { name: 'ImageOutputStorageError' })
          throw saveError
        })
        await save
      }
      return result
    } finally {
      active--
      waiting.shift()?.()
    }
  }))
  if (saveError) throw saveError
  const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  if (!successful.length) throw (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason
  if (count === 1) return successful[0]
  const images = successful.flatMap((result) => result.images)
  return {
    images,
    actualParams: { ...successful[0].actualParams, n: images.length },
    actualParamsList: successful.flatMap((result) => result.actualParamsList ?? result.images.map(() => result.actualParams)),
    revisedPrompts: successful.flatMap((result) => result.revisedPrompts ?? result.images.map(() => undefined)),
    usedProfile: successful[0].usedProfile,
    usedProfiles: successful.flatMap((result) => result.usedProfiles ?? result.images.map(() => result.usedProfile ?? null)),
    warnings: successful.flatMap((result) => result.warnings ?? []),
    rawImageUrls: successful.flatMap((result) => result.rawImageUrls ?? []),
    failedRequests: results.flatMap((result, requestIndex) => result.status === 'rejected'
      ? [{ requestIndex, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
      : (result.value.failedRequests ?? []).map((failure) => ({ ...failure, requestIndex }))),
  }
}
