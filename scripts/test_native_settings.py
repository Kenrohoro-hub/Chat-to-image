import os
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from desktop_config import desktop_path, read_desktop, save_desktop, settings_snapshot
from native_settings import ModelSelectionDialog, SettingsDialog
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QLabel, QMessageBox, QPushButton

from qt_test_support import app as APP


class NativeSettingsTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='native-settings-case-')
    self.addCleanup(self.temp.cleanup)
    self.env = patch.dict(os.environ, {'LOCALAPPDATA': self.temp.name,
      'PLAYGROUND_CONFIG_DIR': os.path.join(self.temp.name, 'user-config')}, clear=False)
    self.env.start()
    self.addCleanup(self.env.stop)
    self.settings = {
      'profiles': [
        {'id': 'img', 'name': '画廊', 'provider': 'openai', 'apiMode': 'images', 'baseUrl': 'https://images.example/v1', 'apiKey': 'hidden-key', 'model': 'image-a', 'models': ['image-a'], 'timeout': 30, 'legacyField': {'keep': True}},
        {'id': 'agent', 'name': '对话', 'provider': 'openai', 'apiMode': 'responses', 'baseUrl': 'https://agent.example/v1', 'apiKey': 'agent-key', 'model': 'chat-a', 'models': ['chat-a'], 'timeout': 30},
      ],
      'activeProfileId': 'img',
      'failover': {'enabled': True, 'primaryId': 'img', 'slots': ['img'], 'disabledIds': []},
      'agentFailover': {'enabled': False, 'primaryId': 'agent', 'slots': ['agent'], 'disabledIds': []},
      'agentModel': 'chat-a', 'agentWebSearch': True, 'unknownPreference': {'keep': 7},
      'zipDownloadRoutes': ['task-selection', 'task-detail-partial'],
    }
    save_desktop(self.settings)
    self.dialog = SettingsDialog()
    self.addCleanup(self.dialog.close)

  def test_cancel_keeps_encrypted_settings_unchanged(self):
    before = settings_snapshot()['revision']
    self.dialog.forms['images']['name'].setText('临时草稿')
    self.dialog.reject()
    self.assertEqual(settings_snapshot()['revision'], before)
    self.assertEqual(read_desktop(True)['profiles'][0]['name'], '画廊')

  def test_save_preserves_unknown_fields_and_emits_saved(self):
    received = []
    self.dialog.saved.connect(lambda: received.append(True))
    self.dialog.forms['images']['name'].setText('新名称')
    self.dialog.enter_submit.setCurrentIndex(1)
    self.dialog._save()
    saved = read_desktop(True)
    self.assertEqual(saved['profiles'][0]['name'], '新名称')
    self.assertEqual(saved['profiles'][0]['legacyField'], {'keep': True})
    self.assertEqual(saved['unknownPreference'], {'keep': 7})
    self.assertTrue(saved['enterSubmit'])
    self.assertEqual(saved['agentModel'], 'chat-a')
    self.assertTrue(saved['agentWebSearch'])
    self.assertIn('task-detail-partial', saved['zipDownloadRoutes'])
    self.assertEqual(received, [True])
    self.assertNotIn('hidden-key', __import__('pathlib').Path(os.environ['PLAYGROUND_CONFIG_DIR'], 'desktop-settings.json').read_text(encoding='utf-8'))

  def test_sidebar_pages_and_restored_preferences(self):
    self.assertEqual([self.dialog.navigation.item(i).text() for i in range(self.dialog.navigation.count())],
      ['API 配置', '使用习惯', '数据管理', 'Agent 连接', '功能介绍'])
    self.assertGreaterEqual(self.dialog.width(), 920)
    self.dialog.navigation.setCurrentRow(4)
    self.assertEqual(self.dialog.pages_stack.currentIndex(), 4)
    self.dialog.navigation.setCurrentRow(1)
    self.dialog.theme.setCurrentIndex(2)
    self.dialog.retry_button.setChecked(True)
    self.dialog.agent_model.setCurrentText('chat-b')
    self.dialog.agent_web_search.setChecked(False)
    self.dialog.agent_scroll.setChecked(False)
    self.dialog.agent_max_rounds.setValue(7)
    self.dialog.agent_math.setChecked(True)
    self.dialog._save()
    saved = read_desktop(True)
    self.assertEqual(saved['theme'], 'dark')
    self.assertTrue(saved['alwaysShowRetryButton'])
    self.assertEqual(saved['agentModel'], 'chat-b')
    self.assertFalse(saved['agentWebSearch'])
    self.assertFalse(saved['agentScrollToBottomAfterSubmit'])
    self.assertEqual(saved['agentMaxToolRounds'], 7)
    self.assertTrue(saved['agentMathFormattingPrompt'])

  def test_data_and_feature_actions_emit_named_signals(self):
    received = []
    self.dialog.importBackupRequested.connect(lambda: received.append('import'))
    self.dialog.exportBackupRequested.connect(lambda: received.append('export'))
    self.dialog.featureIntroRequested.connect(lambda: received.append('features'))
    buttons = {button.text(): button for button in self.dialog.findChildren(QPushButton)}
    buttons['导入备份'].click()
    buttons['导出作品备份'].click()
    buttons['打开功能介绍'].click()
    self.assertEqual(received, ['import', 'export', 'features'])

  def test_unreadable_config_cannot_be_overwritten(self):
    self.dialog.close()
    with patch('desktop_config.protect', side_effect=ValueError('decrypt failed')):
      locked = SettingsDialog()
      self.addCleanup(locked.close)
      self.assertFalse(locked.save_button.isEnabled())
      self.assertIn('无法解密', locked.error_label.text())


  def test_profile_switch_keeps_draft_and_manual_model_operations(self):
    self.dialog.forms['images']['name'].setText('草稿名称')
    self.dialog.forms['images']['manual'].setText('image-b')
    self.dialog._add_model('images')
    self.dialog.forms['images']['models'].item(1).setSelected(True)
    self.dialog._set_default_model('images')
    self.dialog.profile_lists['responses'].setCurrentRow(0)
    self.dialog.api_tabs.setCurrentIndex(1)
    self.dialog.api_tabs.setCurrentIndex(0)
    self.dialog._save()
    saved = read_desktop(True)
    image = next(profile for profile in saved['profiles'] if profile['id'] == 'img')
    self.assertEqual(image['name'], '草稿名称')
    self.assertEqual(image['models'], ['image-a', 'image-b'])
    self.assertEqual(image['model'], 'image-b')

  def test_first_run_can_add_first_profile(self):
    self.dialog.close()
    desktop_path().unlink()
    dialog = SettingsDialog()
    self.addCleanup(dialog.close)
    self.assertTrue(dialog.save_button.isEnabled())
    dialog._add_profile('images')
    fields = dialog.forms['images']
    fields['name'].setText('新 API')
    fields['baseUrl'].setText('https://images.example/v1')
    fields['apiKey'].setText('new-test-key')
    fields['model'].setCurrentText('image-new')
    fields['models'].addItem('image-new')
    dialog._save()
    saved = read_desktop(True)
    self.assertEqual(saved['profiles'][0]['model'], 'image-new')
    self.assertEqual(saved['failover']['primaryId'], saved['profiles'][0]['id'])

  def test_fetch_result_is_discarded_after_address_edit(self):
    fields = self.dialog.forms['images']
    fields['baseUrl'].setText('https://changed.example/v1')
    self.dialog.fetch_request = 'request-token'
    self.dialog.fetch_snapshot = ('images', 'img', 'https://images.example/v1', '', False, b'old-key')
    self.dialog.fetch_action = 'models'
    with patch.object(QMessageBox, 'information') as notice:
      self.dialog._models_ready('request-token', ['stale-model'], None)
    self.assertNotIn('stale-model', [fields['models'].item(i).text() for i in range(fields['models'].count())])
    notice.assert_called_once()

  def test_running_request_blocks_close_and_new_request(self):
    self.dialog.show()
    APP.processEvents()
    self.dialog.fetch_request = 'in-flight'
    self.dialog.fetch_thread = object()
    with patch.object(QMessageBox, 'information') as notice:
      self.dialog.close()
      self.dialog.reject()
      self.dialog._fetch_models('responses')
    self.assertTrue(self.dialog.isVisible())
    self.assertEqual(self.dialog.fetch_request, 'in-flight')
    self.assertEqual(notice.call_count, 3)
    self.dialog.fetch_request = None
    self.dialog.close()

  def test_model_dialog_selects_and_clears_visible_items(self):
    dialog = ModelSelectionDialog(['image-a', 'image-b'])
    self.addCleanup(dialog.close)
    dialog.search.setText('image-a')
    dialog._set_visible(False)
    self.assertEqual(dialog.selected_models(), ['image-b'])
    dialog._set_visible(True)
    self.assertEqual(dialog.selected_models(), ['image-a', 'image-b'])
    dialog.search.clear()
    dialog._set_visible(False)
    self.assertEqual(dialog.selected_models(), [])

  def test_unreadable_screen_does_not_show_encrypted_file_contents(self):
    self.dialog.close()
    with patch('desktop_config.protect', side_effect=ValueError('decrypt failed')):
      locked = SettingsDialog()
    self.addCleanup(locked.close)
    self.assertFalse(hasattr(locked, 'original'))
    self.assertEqual(len(locked.findChildren(QLabel)), 2)

  def test_fetch_result_is_discarded_after_key_change_while_hidden(self):
    fields = self.dialog.forms['images']
    self.dialog.fetch_request = 'request-token'
    self.dialog.fetch_snapshot = ('images', 'img', fields['baseUrl'].text(), '', False, b'old-key')
    self.dialog.fetch_action = 'models'
    self.dialog.settings['profiles'][0]['apiKey'] = 'new-key'
    with patch.object(QMessageBox, 'information') as notice:
      self.dialog._models_ready('request-token', ['stale-model'], None)
    self.assertNotIn('stale-model', [fields['models'].item(i).text() for i in range(fields['models'].count())])
    notice.assert_called_once()
if __name__ == '__main__':
  unittest.main()
