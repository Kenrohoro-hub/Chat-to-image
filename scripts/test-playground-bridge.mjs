import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('./playground_bridge.js', import.meta.url), 'utf8')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function setup(settings) {
  const calls = []
  const actions = {}
  const badge = { style: {}, addEventListener: (event, action) => { actions[event] = action } }
  const state = { settings, calls, actions, badge }
  const context = vm.createContext({
    AbortSignal,
    document: { createElement: () => badge, body: { append: () => {} } },
    localStorage: { getItem: () => state.settings ? JSON.stringify({ state: { settings: state.settings } }) : null },
    window: { addEventListener: (event, action) => { actions[event] = action } },
    setInterval: (action) => { actions.tick = action },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => ({ synced: true, message: '已同步' }) }
    },
  })
  vm.runInContext(source, context)
  return state
}

test('只同步当前配置的允许字段，不发送其他配置或历史', async () => {
  const state = setup({ activeProfileId: 'selected', profiles: [
    { id: 'selected', apiKey: 'test-key', model: 'test-model', imageProtocol: 'qwen', providerDrafts: { unused: 'not-sent' } },
    { id: 'other', apiKey: 'other-key' },
  ] })
  await settle()
  assert.deepEqual(JSON.parse(state.calls[0].options.body), { profile: { id: 'selected', apiKey: 'test-key', model: 'test-model', imageProtocol: 'qwen' } })
  assert.equal(state.badge.textContent, 'Codex：已同步')
  assert.equal(state.calls[0].url, '/__codex/config')
  assert.ok(state.calls[0].options.headers['X-Codex-Sync'])
})

test('配置未改变时不重复提交，改变后自动同步', async () => {
  const state = setup({ activeProfileId: 'one', profiles: [{ id: 'one', model: 'first' }] })
  await settle()
  state.actions.tick()
  await settle()
  assert.equal(state.calls.length, 1)
  state.settings.profiles[0].model = 'second'
  state.actions.tick()
  await settle()
  assert.equal(state.calls.length, 2)
  assert.equal(JSON.parse(state.calls[1].options.body).profile.model, 'second')
})

test('没有浏览器设置时不覆盖已有同步记录', async () => {
  const state = setup(null)
  await settle()
  assert.equal(state.calls.length, 0)
  assert.equal(state.badge.textContent, 'Codex：此浏览器未配置')
})

test('当前配置被删除后发送空配置以停用旧凭据', async () => {
  const state = setup({ activeProfileId: 'missing', profiles: [] })
  await settle()
  assert.deepEqual(JSON.parse(state.calls[0].options.body), { profile: {} })
})
