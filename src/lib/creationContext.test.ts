// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AgentConversation, type TaskRecord } from '../types'
import { getCreationContext, startConversationWithImages } from './creationContext'
import { useStore } from '../store'
import { ensureImageCached } from './imageCache'
vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn() }))
vi.mock('./agentConversationPersistence', () => ({ flushAgentConversationsToIndexedDB: vi.fn(), initializeAgentConversationPersistence: vi.fn(), persistAgentConversationChanges: vi.fn(), scheduleAgentConversationSave: vi.fn() }))
const original: AgentConversation = { id: 'original', title: 'original', createdAt: 1, updatedAt: 1, messages: [], rounds: [], imageParams: DEFAULT_PARAMS }
beforeEach(() => {
  useStore.setState({ appMode: 'agent', agentConversations: [original], activeAgentConversationId: 'original', agentInputDrafts: {}, inputImages: [], prompt: 'keep draft', maskDraft: null, maskEditorImageId: null, params: DEFAULT_PARAMS })
  vi.mocked(ensureImageCached).mockReset().mockResolvedValue('data:image/png;base64,a')
})
it('counts only the active branch and deduplicates image references', () => {
  const conversation = { ...original, activeRoundId: 'a', rounds: [{ id: 'a', parentRoundId: null, inputImageIds: ['shared'], outputTaskIds: ['t'] }, { id: 'b', parentRoundId: null, inputImageIds: ['other'], outputTaskIds: [] }] } as AgentConversation
  expect(getCreationContext(conversation, [{ id: 't', outputImages: ['shared', 'output'] }] as TaskRecord[], [])).toEqual({ rounds: 1, imageIds: ['shared', 'output'] })
})
it('opens an empty conversation and preserves the old draft without generating', async () => {
  await startConversationWithImages(['chosen', 'chosen'])
  const state = useStore.getState()
  expect(state.activeAgentConversationId).not.toBe('original')
  expect(state.agentConversations[1].rounds).toEqual([])
  expect(state.inputImages.map((image) => image.id)).toEqual(['chosen'])
  expect(state.agentInputDrafts.original.prompt).toBe('keep draft')
  expect(state.prompt).toBe('')
})
it('does not create or replace drafts when images disappear or the user switches during loading', async () => {
  vi.mocked(ensureImageCached).mockResolvedValueOnce(undefined)
  await expect(startConversationWithImages(['missing'])).rejects.toThrow('不存在')
  expect(useStore.getState().agentConversations).toHaveLength(1)
  vi.mocked(ensureImageCached).mockImplementationOnce(async () => { useStore.setState({ prompt: 'changed' }); return 'image' })
  await expect(startConversationWithImages(['chosen'])).rejects.toThrow('已改变')
  expect(useStore.getState().prompt).toBe('changed')
})
