// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ModelCatalogDialog from './ModelCatalogDialog'

let root: Root
afterEach(async () => { await act(() => root?.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

it('keeps existing models and hidden selections, and only applies on confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root')!)
  const onAdd = vi.fn()
  const onClose = vi.fn()
  await act(() => root.render(<ModelCatalogDialog ids={['existing', 'image-new', 'chat-new']} selected={['existing']} profileName="Test" onAdd={onAdd} onClose={onClose} />))
  const checkbox = (id: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${id}"]`)!
  const button = (text: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
  expect(checkbox('existing').disabled).toBe(true)
  expect(checkbox('existing').checked).toBe(true)
  expect(checkbox('image-new').checked).toBe(true)
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(() => { setValue.call(search, 'CHAT'); search.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(() => button('取消全选当前结果').click())
  await act(() => { setValue.call(search, ''); search.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(checkbox('chat-new').checked).toBe(false)
  expect(checkbox('image-new').checked).toBe(true)
  await act(() => button('取消').click())
  expect(onClose).toHaveBeenCalledOnce()
  expect(onAdd).not.toHaveBeenCalled()
  await act(() => button('添加所选（1）').click())
  expect(onAdd).toHaveBeenCalledWith(['image-new'])
})
