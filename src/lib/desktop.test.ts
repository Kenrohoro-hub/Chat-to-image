import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { DEFAULT_PARAMS } from '../types'

describe('local shared settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('window', { __PLAYGROUND_LOCAL__: true, dispatchEvent: vi.fn() })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

  it('permits Agent connection management only through the native desktop bridge', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const shared = await import('./desktop')
    await expect((await shared.desktopApi()).agent_connections('connect', 'codex')).rejects.toThrow('桌面窗口')
    expect(fetch).not.toHaveBeenCalled()
    const connect = vi.fn().mockResolvedValue({ ok: true, targets: [] })
    const setLanguage = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { __PLAYGROUND_DESKTOP__: true, pywebview: { api: { set_ui_language: setLanguage, load_settings: vi.fn(), agent_connections: connect } } })
    expect((await (await shared.desktopApi()).agent_connections('connect', 'codex')).ok).toBe(true)
    expect(connect).toHaveBeenCalledWith('connect', 'codex')
    expect(setLanguage).toHaveBeenCalledWith('zh-CN')
  })

  it('blocks automatic saves and remote application when shared settings cannot be decrypted', async () => {
    const snapshot = { settings: null, revision: 'locked', error: '无法解密已有配置' }
    const load = vi.fn().mockResolvedValue(snapshot)
    const save = vi.fn()
    vi.stubGlobal('window', { __PLAYGROUND_DESKTOP__: true, pywebview: { api: { set_ui_language: vi.fn().mockResolvedValue(undefined), load_settings: load, save_settings: save } }, dispatchEvent: vi.fn() })
    const shared = await import('./desktop')
    expect(() => shared.allowDesktopSave(snapshot, DEFAULT_SETTINGS)).toThrow('无法解密')
    await expect(shared.saveDesktopSettings(DEFAULT_SETTINGS)).rejects.toThrow('尚未加载')
    expect(save).not.toHaveBeenCalled()
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'previous' }, DEFAULT_SETTINGS)
    const apply = vi.fn()
    await expect(shared.syncDesktopSettings('locked', apply)).rejects.toThrow('无法解密')
    expect(apply).not.toHaveBeenCalled()
    expect(shared.getSettingsRevision()).toBe('previous')
  })

  it('sends explicit recovery through the same-origin API with the failed snapshot revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'session-token' }))
      .mockResolvedValueOnce(response({ ok: true, revision: 'new' }))
    const shared = await import('./desktop')
    expect(await (await shared.desktopApi()).recover_settings('locked')).toEqual({ ok: true, revision: 'new' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ method: 'recover_settings', args: ['locked'] })
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'X-Codex-Sync': 'session-token', 'X-Playground-Language': 'zh-CN' })
  })

  it('uses protected same-origin calls and serializes saves with the latest revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'session-token' }))
      .mockResolvedValueOnce(response({ ok: true, revision: 'one' }))
      .mockResolvedValueOnce(response({ ok: true, revision: 'two' }))
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    const first = shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    const second = shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
    await Promise.all([first, second])
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'X-Codex-Sync': 'session-token', 'X-Playground-Language': 'zh-CN' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).args[1]).toBe('start')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).args[1]).toBe('one')
    expect(shared.getSettingsRevision()).toBe('two')
    await shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('applies another client’s settings without writing them back or accepting a stale draft', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'session-token' }))
      .mockResolvedValueOnce(response({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' }, revision: 'remote' }))
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    let settings = DEFAULT_SETTINGS
    await shared.syncDesktopSettings('remote', (next) => {
      settings = { ...settings, ...next }
      void shared.saveDesktopSettings(settings)
      return settings
    })
    expect(settings.theme).toBe('dark')
    expect(shared.getSettingsRevision()).toBe('remote')
    await expect(shared.saveDesktopSettings({ ...settings, theme: 'light' }, 'start')).rejects.toThrow('草稿已保留')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps failed saves visible and blocks generation until settings are saved', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'session-token' }))
      .mockResolvedValueOnce(response({ error: '配置已在另一窗口更新' }, 409))
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    await expect(shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })).rejects.toThrow('另一窗口')
    await expect(shared.flushDesktopSettings()).rejects.toThrow('另一窗口')
    expect(shared.getSettingsRevision()).toBe('start')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not apply a delayed snapshot after a local save has completed', async () => {
    const snapshot = { settings: { ...DEFAULT_SETTINGS, theme: 'light' as const }, revision: 'remote' }
    let release!: (value: typeof snapshot) => void
    const load = vi.fn(() => new Promise<typeof snapshot>((resolve) => { release = resolve }))
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 'local' })
    vi.stubGlobal('window', { __PLAYGROUND_DESKTOP__: true, pywebview: { api: { set_ui_language: vi.fn().mockResolvedValue(undefined), load_settings: load, save_settings: save } }, dispatchEvent: vi.fn() })
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    const apply = vi.fn((settings: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...settings }))
    const sync = shared.syncDesktopSettings('remote', apply)
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    await shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    release(snapshot)
    await sync
    expect(apply).not.toHaveBeenCalled()
    expect(shared.getSettingsRevision()).toBe('local')
    await shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(save).toHaveBeenCalledOnce()
  })

  it('refreshes an explicitly rejected session after a service restart', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'old' }))
      .mockResolvedValueOnce(response({ error: 'Sync token rejected' }, 403))
      .mockResolvedValueOnce(response({ token: 'new' }))
      .mockResolvedValueOnce(response({ settings: DEFAULT_SETTINGS, revision: 'saved' }))
    const shared = await import('./desktop')
    expect((await (await shared.desktopApi()).load_settings()).revision).toBe('saved')
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ 'X-Codex-Sync': 'new' })
  })

  it('does not repeat an uncertain generation request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ token: 'session-token' }))
      .mockRejectedValueOnce(new TypeError('connection lost'))
    const shared = await import('./desktop')
    await expect((await shared.desktopApi()).generate({ profileId: 'test', prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('connection lost')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the native bridge in a desktop window with the same revision contract', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 'native' })
    vi.stubGlobal('window', { __PLAYGROUND_DESKTOP__: true, pywebview: { api: { set_ui_language: vi.fn().mockResolvedValue(undefined), load_settings: vi.fn(), save_settings: save } }, dispatchEvent: vi.fn() })
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    await shared.saveDesktopSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }), 'start')
    expect(shared.getSettingsRevision()).toBe('native')
  })

  it.each(['chosen', ''])('passes explicit model %s while keeping automatic generation unlocked', async (galleryModel) => {
    const generate = vi.fn().mockResolvedValue({ ok: true, images: [], warnings: [] })
    vi.stubGlobal('window', { __PLAYGROUND_DESKTOP__: true, pywebview: { api: { set_ui_language: vi.fn().mockResolvedValue(undefined), generate, load_settings: vi.fn() } }, dispatchEvent: vi.fn() })
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const profile = createDefaultOpenAIProfile({ id: 'selected', apiKey: 'fake', apiProxy: false, model: 'default', models: ['default', 'chosen'] })
    const shared = await import('./desktop')
    shared.allowDesktopSave({ settings: DEFAULT_SETTINGS, revision: 'start' }, DEFAULT_SETTINGS)
    const { callImageApi } = await import('./api')
    await callImageApi({ settings: normalizeSettings({ profiles: [profile], galleryModel }), prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'selected', model: galleryModel || undefined }))
  })

  it('waits for native methods when the bridge object exists before it is ready', async () => {
    let signal!: () => void
    const nativeWindow = {
      __PLAYGROUND_DESKTOP__: true,
      pywebview: { api: {} },
      setTimeout: globalThis.setTimeout,
      addEventListener: vi.fn((_event: string, callback: () => void) => { signal = callback }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('window', nativeWindow)
    const shared = await import('./desktop')
    const pending = shared.desktopApi()
    expect(nativeWindow.addEventListener).toHaveBeenCalledWith('pywebviewready', expect.any(Function), { once: true })
    const api = { set_ui_language: vi.fn().mockResolvedValue(undefined), load_settings: vi.fn() }
    nativeWindow.pywebview.api = api
    signal()
    expect(await pending).toBe(api)
  })
})
