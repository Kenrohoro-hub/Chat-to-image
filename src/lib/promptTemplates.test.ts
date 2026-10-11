import { expect, it } from 'vitest'
import { mergePromptTemplates, normalizePromptTemplates } from './promptTemplates'

it('validates external template data and preserves both versions of an ID conflict', () => {
  const item = { id: 'one', title: '摄影', content: '暖色侧光', createdAt: 1, updatedAt: 2 }
  expect(normalizePromptTemplates([item, null, { ...item, id: 'invalid', content: ' ' }, item])).toEqual([item])
  expect(normalizePromptTemplates(undefined)).toEqual([])
  expect(mergePromptTemplates([item], undefined)).toEqual([item])
  expect(mergePromptTemplates([item], [item])).toEqual([item])
  const merged = mergePromptTemplates([item], [{ ...item, content: '冷色侧光' }])
  expect(merged[0]).toEqual(item)
  expect(merged[1].content).toBe('冷色侧光')
  expect(merged[1].id).not.toBe(item.id)
})


it('preserves source and preview through normalization and backup merging', () => {
  const item = { id: 'garden-1', sourcePromptId: 'garden-1', title: '摄影', content: '暖色侧光', createdAt: 1, updatedAt: 2, sourceUrl: 'https://prompt.qqsrc.com/detail.html?id=1', previewUrl: 'https://r2.qqsrc.com/images/originals/1.jpg' }
  expect(normalizePromptTemplates([item])).toEqual([item])
  expect(mergePromptTemplates([], [item])).toEqual([item])
  expect(normalizePromptTemplates([{ ...item, sourceUrl: 'javascript:alert(1)', previewUrl: 'file:///secret' }])[0]).toEqual({ ...item, sourceUrl: undefined, previewUrl: undefined })
})


it('keeps bundled preview images through restore and rejects other local paths', () => {
  const item = { id: 'example-curated-01', title: '海报', content: '纸张质感', createdAt: 0, updatedAt: 0, previewUrl: '/prompt-examples/example-curated-01.png' }
  expect(normalizePromptTemplates([item])[0].previewUrl).toBe(item.previewUrl)
  expect(mergePromptTemplates([], [item])[0].previewUrl).toBe(item.previewUrl)
  for (const previewUrl of ['/prompt-examples/../secret.png', '//example.com/image.png', '/user-config/image.png', '/prompt-examples/test.svg']) {
    expect(normalizePromptTemplates([{ ...item, previewUrl }])[0].previewUrl).toBeUndefined()
  }
})
