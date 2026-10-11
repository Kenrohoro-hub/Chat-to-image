import { expect, it } from 'vitest'
import { DEFAULT_PARAMS, type AgentConversation, type AgentRound, type TaskRecord } from '../types'
import { getCurrentCreationTasks } from './creationResults'

const round = (id: string, parentRoundId: string | null, outputTaskIds: string[]): AgentRound => ({ id, parentRoundId, index: 1, userMessageId: id, prompt: '', inputImageIds: [], outputTaskIds, status: 'done', error: null, createdAt: 1, finishedAt: 1 })
const task = (id: string, agentRoundId?: string): TaskRecord => ({ id, agentRoundId, agentConversationId: 'chat', prompt: '', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: 1, finishedAt: 1, elapsed: 0 })
const conversation: AgentConversation = { id: 'chat', title: '', activeRoundId: 'talk', createdAt: 1, updatedAt: 1, messages: [], rounds: [round('first', null, ['old']), round('images', 'first', ['a']), round('talk', 'images', []), round('branch', 'first', ['other'])] }
const tasks = [task('old', 'first'), task('a', 'images'), task('b', 'images'), task('other', 'branch'), task('global')]

it('keeps results from every round of the active branch through text discussion', () => {
  expect(getCurrentCreationTasks(conversation, tasks).map((item) => item.id)).toEqual(['old', 'a', 'b'])
})
it('isolates branches and new conversations, including failed or deleted latest results', () => {
  expect(getCurrentCreationTasks({ ...conversation, activeRoundId: 'branch' }, tasks).map((item) => item.id)).toEqual(['old', 'other'])
  expect(getCurrentCreationTasks(undefined, tasks)).toEqual([])
  expect(getCurrentCreationTasks({ ...conversation, rounds: [] }, tasks)).toEqual([])
  expect(getCurrentCreationTasks(conversation, tasks.map((item) => item.id === 'a' || item.id === 'b' ? { ...item, status: 'error', error: 'failed' } : item)).map((item) => item.id)).toEqual(['old', 'a', 'b'])
  expect(getCurrentCreationTasks(conversation, tasks.filter((item) => item.agentRoundId !== 'images')).map((item) => item.id)).toEqual(['old'])
})
