// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import TaskGrid from './TaskGrid'

const state = vi.hoisted(() => ({ tasks: [] as TaskRecord[], searchQuery: '', filterStatus: 'all', filterFavorite: false, activeFavoriteCollectionId: null, defaultFavoriteCollectionId: '', selectedTaskIds: [], setDetailTaskId: vi.fn(), setConfirmDialog: vi.fn(), setSelectedTaskIds: vi.fn(), clearSelection: vi.fn() }))
vi.mock('../store', () => ({ useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }), reuseConfig: vi.fn(), editOutputs: vi.fn(), removeTask: vi.fn(), taskMatchesFilterStatus: () => true, taskMatchesSearchQuery: (task: TaskRecord, query: string) => task.prompt.includes(query) }))
vi.mock('./TaskCard', () => ({ default: ({ task }: { task: TaskRecord }) => <button>{task.prompt}</button> }))
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
it('measures large history rendering and searches the entire history', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.tasks = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), prompt: `item-${index}`, params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: index, finishedAt: index, elapsed: 0 }))
  state.searchQuery = ''
  const times: number[] = []
  for (let run = 0; run < 3; run++) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const start = performance.now()
    await act(() => root.render(<TaskGrid />))
    times.push(performance.now() - start)
    expect(container.querySelectorAll('.task-card-wrapper')).toHaveLength(60)
    HTMLElement.prototype.scrollIntoView = vi.fn()
    await act(() => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '下一页')!.click())
    expect(container.textContent).toContain('第 2 / 34 页')
    expect(container.querySelectorAll('.task-card-wrapper')).toHaveLength(60)
    state.searchQuery = 'item-1999'
    await act(() => root.render(<TaskGrid />))
    expect(container.querySelectorAll('.task-card-wrapper')).toHaveLength(1)
    expect(container.textContent).toContain('item-1999')
    await act(() => root.unmount())
    container.remove()
    state.searchQuery = ''
  }
  console.info('history-render-2000-ms', times.map((time) => Math.round(time)))
})
