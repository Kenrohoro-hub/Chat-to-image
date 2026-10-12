// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage, getCategoryLabel, getUiLanguage, getUiLanguagePreference, setUiLanguage, t } from './i18n'
import { getImageMentionLabel, getPromptMentionParts, getSelectedImageMentionLabel, remapImageMentionsForOrder, replaceImageMentionsForApi } from './promptImageMentions'
import { replaceAgentPromptImageReferencesForApi } from './agentImageReferences'
import type { AgentRound, InputImage } from '../types'

const languageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'language')!
const languagesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'languages')!

afterEach(() => {
  localStorage.removeItem('chat-to-image-ui-language')
  delete window.__PLAYGROUND_UI_LANGUAGE__
  Object.defineProperty(navigator, 'language', languageDescriptor)
  Object.defineProperty(navigator, 'languages', languagesDescriptor)
  vi.restoreAllMocks()
})

describe('interface language', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'ZH_hans'])('uses Chinese for %s', (language) => {
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => language })
    expect(getUiLanguage()).toBe('zh-CN')
    expect(t('创作', 'Create')).toBe('创作')
  })

  it.each(['en-US', 'ja-JP', 'fr', '', 'zho'])('uses English for %s', (language) => {
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => language })
    Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] })
    expect(getUiLanguage()).toBe('en')
    expect(t('创作', 'Create')).toBe('Create')
    applyUiLanguage()
    expect(document.documentElement.lang).toBe('en')
  })

  it('gives desktop system language priority over browser language', () => {
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'zh-CN' })
    window.__PLAYGROUND_UI_LANGUAGE__ = 'en'
    expect(getUiLanguage()).toBe('en')
    window.__PLAYGROUND_UI_LANGUAGE__ = 'zh-CN'
    expect(getUiLanguage()).toBe('zh-CN')
  })

  it('remembers an explicit language choice and ignores invalid stored values', () => {
    window.__PLAYGROUND_UI_LANGUAGE__ = 'zh-CN'
    setUiLanguage('en')
    expect(localStorage.getItem('chat-to-image-ui-language')).toBe('en')
    expect(getUiLanguage()).toBe('en')
    setUiLanguage('zh-CN')
    expect(getUiLanguage()).toBe('zh-CN')
    localStorage.setItem('chat-to-image-ui-language', 'fr')
    expect(getUiLanguage()).toBe('zh-CN')
  })

  it('defaults to the system preference when absent or invalid', () => {
    expect(getUiLanguagePreference()).toBe('system')
    localStorage.setItem('chat-to-image-ui-language', 'fr')
    expect(getUiLanguagePreference()).toBe('system')
    window.__PLAYGROUND_UI_LANGUAGE__ = 'en'
    expect(getUiLanguage()).toBe('en')
  })

  it.each(['zh-CN', 'en'] as const)('removes the saved %s override when following the system', (language) => {
    window.__PLAYGROUND_UI_LANGUAGE__ = language === 'en' ? 'zh-CN' : 'en'
    setUiLanguage(language)
    expect(getUiLanguagePreference()).toBe(language)
    setUiLanguage('system')
    expect(localStorage.getItem('chat-to-image-ui-language')).toBeNull()
    expect(getUiLanguagePreference()).toBe('system')
    expect(getUiLanguage()).toBe(window.__PLAYGROUND_UI_LANGUAGE__)
  })

  it('keeps both English and legacy Chinese image references usable', () => {
    window.__PLAYGROUND_UI_LANGUAGE__ = 'en'
    expect(getImageMentionLabel(0)).toBe('@image1')
    expect(getCategoryLabel('默认')).toBe('Default')
    expect(getCategoryLabel('我的风格')).toBe('我的风格')
    const images = [{ id: 'one' }, { id: 'two' }] as InputImage[]
    const mention = getSelectedImageMentionLabel(0)
    expect(getPromptMentionParts(mention, images)[0]).toMatchObject({ type: 'mention', imageIndex: 0 })
    expect(replaceImageMentionsForApi(mention, 2)).toBe('[image 1]')
    expect(replaceImageMentionsForApi('\u2063@图1\u2064', 2)).toBe('[image 1]')
    expect(remapImageMentionsForOrder(mention, images, [...images].reverse())).toBe('\u2063@image2\u2064')
    const round = { index: 1, inputImageIds: ['one'], outputTaskIds: [] } as unknown as AgentRound
    expect(replaceAgentPromptImageReferencesForApi('@turn1-image1', round, [{ ...round, outputTaskIds: ['task'] }], [{ id: 'task', outputImages: ['one'] }] as never)).toBe('<ref id="round-1-reference-1" />')
  })
})
