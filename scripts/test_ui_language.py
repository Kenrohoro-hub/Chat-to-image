import unittest
from types import SimpleNamespace
from unittest.mock import patch

import ui_language


class UiLanguageTest(unittest.TestCase):
  def setUp(self):
    token = ui_language._LANGUAGE.set(None)
    self.addCleanup(lambda: ui_language._LANGUAGE.reset(token))

  def language_for_lcid(self, lcid):
    kernel32 = SimpleNamespace(GetUserDefaultUILanguage=lambda: lcid)
    with patch.object(ui_language.os, 'name', 'nt'), patch.object(ui_language.ctypes, 'windll', SimpleNamespace(kernel32=kernel32), create=True):
      return ui_language.system_ui_language()

  def test_native_selection_keeps_page_access_checks(self):
    from desktop_host import DesktopApi
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:4000'
    api._window = SimpleNamespace(get_current_url=lambda: api._origin)
    api.set_ui_language('en')
    api._check()
    self.assertEqual(ui_language.t('中文', 'English'), 'English')
    with self.assertRaises(ValueError):
      api.set_ui_language('fr')
    api._window = SimpleNamespace(get_current_url=lambda: 'https://example.com')
    with self.assertRaises(ValueError):
      api.set_ui_language('zh-CN')
    self.assertEqual(api._ui_language, 'en')

  def test_chinese_simplified_and_traditional_lcids(self):
    for lcid in (0x0804, 0x0404, 0x0c04, 0x1004):
      with self.subTest(lcid=hex(lcid)):
        self.assertEqual(self.language_for_lcid(lcid), 'zh-CN')

  def test_english_and_other_languages_use_english(self):
    for lcid in (0x0409, 0x0809, 0x0407, 0x0411):
      with self.subTest(lcid=hex(lcid)):
        self.assertEqual(self.language_for_lcid(lcid), 'en')

  def test_translation_uses_selected_language(self):
    with patch.object(ui_language, 'system_ui_language', return_value='zh-CN'):
      self.assertEqual(ui_language.t('中文', 'English'), '中文')
    with patch.object(ui_language, 'system_ui_language', return_value='en'):
      self.assertEqual(ui_language.t('中文', 'English'), 'English')

  def test_request_selection_precedes_environment_and_system(self):
    with patch.dict(ui_language.os.environ, {'PLAYGROUND_UI_LANGUAGE': 'zh-CN'}), patch.object(ui_language, 'system_ui_language', return_value='zh-CN'):
      ui_language.set_request_ui_language('en')
      self.assertEqual(ui_language.current_ui_language(), 'en')
      self.assertEqual(ui_language.t('中文', 'English'), 'English')

  def test_environment_selection_precedes_system(self):
    with patch.dict(ui_language.os.environ, {'PLAYGROUND_UI_LANGUAGE': 'en'}), patch.object(ui_language, 'system_ui_language', return_value='zh-CN'):
      self.assertEqual(ui_language.current_ui_language(), 'en')

  def test_invalid_request_selection_is_rejected(self):
    with self.assertRaises(ValueError):
      ui_language.set_request_ui_language('fr')
    self.assertIsNone(ui_language._LANGUAGE.get())


if __name__ == '__main__':
  unittest.main()
