import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
test('更新应用时清理旧界面缓存，保留网络提示词库', async () => {
  let activate, completion
  const deleted = []
  vm.runInNewContext(source, { URL,
    self: { registration: { scope: 'http://localhost/' }, clients: { claim() {} },
      addEventListener(type, handler) { if (type === 'activate') activate = handler } },
    caches: { keys: async () => ['chat-to-image-v0.0.1', 'prompt-library-shuixian-v1'],
      delete: async (name) => { deleted.push(name) } },
  })
  activate({ waitUntil(promise) { completion = promise } })
  await completion
  assert.deepEqual(deleted, ['chat-to-image-v0.0.1'])
})
