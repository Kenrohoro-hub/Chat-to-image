// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import HelpModal from './HelpModal'

vi.mock('../hooks/usePreventBackgroundScroll', () => ({ usePreventBackgroundScroll: () => undefined }))

let root: Root

afterEach(async () => {
  await act(() => root.unmount())
  document.body.innerHTML = ''
})

it('navigates the user guide and restores focus after Escape closes it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML = '<button id="trigger">帮助</button><div id="root"></div>'
  const trigger = document.getElementById('trigger')!
  trigger.focus()
  root = createRoot(document.getElementById('root')!)

  await act(() => root.render(<HelpModal appMode="agent" onClose={() => root.render(null)} />))
  const dialog = document.querySelector('[role="dialog"]')!
  const close = dialog.querySelector('button[aria-label="关闭操作指南"]')!
  const lastTopic = dialog.querySelector<HTMLButtonElement>('nav button:last-child')!
  expect(document.activeElement).toBe(close)
  lastTopic.focus()
  lastTopic.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(close)
  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(lastTopic)

  await act(() => Array.from(dialog.querySelectorAll<HTMLButtonElement>('nav button')).find((button) => button.textContent?.includes('对话管理'))?.click())
  expect(dialog.textContent).toContain('只选择当前搜索结果')
  expect(dialog.textContent).toContain('生图中”或“回复中')

  await act(() => Array.from(dialog.querySelectorAll<HTMLButtonElement>('nav button')).find((button) => button.textContent?.includes('直接生成与对话'))?.click())
  expect(dialog.textContent).toContain('绘图提示词优化')
  expect(dialog.textContent).toContain('关闭只移除增强规则')
  expect(dialog.textContent).toContain('直接生成不经过此优化')
  await act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
