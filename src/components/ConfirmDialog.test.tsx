// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

const state = vi.hoisted(() => ({ confirmDialog: null as { title: string; message: string } | null, setConfirmDialog: vi.fn() }))
vi.mock('../store', () => ({ useStore: (select: (value: typeof state) => unknown) => select(state) }))
let root: Root

afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('keeps keyboard focus in confirmation and returns to the list after its row is deleted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML = '<section aria-label="对话列表"><input id="search"><button id="trigger">删除</button></section><div id="root"></div>'
  const trigger = document.getElementById('trigger')!
  trigger.focus()
  root = createRoot(document.getElementById('root')!)
  state.confirmDialog = { title: '删除对话', message: '删除测试对话？' }
  await act(() => root.render(<ConfirmDialog />))
  const dialog = document.querySelector('[role="dialog"]')!
  const [cancel, confirm] = dialog.querySelectorAll('button')
  expect(document.activeElement).toBe(cancel)
  confirm.focus()
  confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(cancel)
  cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(confirm)
  state.confirmDialog = null
  await act(() => root.render(<ConfirmDialog />))
  expect(document.activeElement).toBe(trigger)

  state.confirmDialog = { title: '删除对话', message: '删除测试对话？' }
  await act(() => root.render(<ConfirmDialog />))
  trigger.remove()
  state.confirmDialog = null
  await act(() => root.render(<ConfirmDialog />))
  expect(document.activeElement).toBe(document.getElementById('search'))
})
