"""原生图库参数复用、草稿恢复与历史详情检查。"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage
from PySide6.QtWidgets import QApplication, QPushButton

from qt_test_support import app


def png_bytes(color=Qt.GlobalColor.white):
  image = QImage(8, 8, QImage.Format.Format_ARGB32)
  image.fill(color)
  from PySide6.QtCore import QBuffer, QByteArray, QIODevice
  data = QByteArray()
  buffer = QBuffer(data)
  buffer.open(QIODevice.OpenModeFlag.WriteOnly)
  image.save(buffer, 'PNG')
  buffer.close()
  return bytes(data)


class NativeGalleryTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    from native_store import Store
    self.store = Store(Path(self.tmp.name) / 'store')
    profile = {'id': 'profile-1', 'name': '临时配置', 'provider': 'openai', 'apiMode': 'images', 'model': 'model-1', 'models': ['model-1', 'model-2']}
    self.settings = {'profiles': [profile], 'activeProfileId': profile['id'], 'persistInputOnRestart': True}
    self.settings_patch = patch('native_gallery.settings_snapshot', return_value={'settings': self.settings})
    self.settings_patch.start()
    self.addCleanup(self.settings_patch.stop)

  def page(self):
    from native_gallery import GalleryPage
    return GalleryPage(self.store, object())

  def test_reuse_restores_all_controls_and_mask_from_store(self):
    from native_gallery import HistoryPage
    ref = self.store.add_image(png_bytes(), source='upload')
    mask = self.store.add_image(png_bytes(Qt.GlobalColor.black), source='mask')
    task = {
      'id': 'task-1', 'prompt': '复用描述', 'apiProfileId': 'profile-1', 'apiModel': 'model-2',
      'maskImageId': mask['id'], 'inputImageIds': [ref['id']], 'outputImages': [],
      'params': {'size': '1536x1024', 'quality': 'high', 'output_format': 'webp', 'n': 4,
                 'background': 'transparent', 'moderation': 'low', 'output_compression': 77},
    }
    self.store.put_record('tasks', task)
    history = HistoryPage(self.store)
    page = self.page()
    self.addCleanup(page.shutdown)
    received = []
    history.reuse.connect(received.append)
    history.list.setCurrentRow(0)
    history.reuse_task()
    page.use_prompt(received[0])
    self.assertEqual(page.profile.currentData(), 'profile-1')
    self.assertEqual(page.model.currentText(), 'model-2')
    self.assertEqual(page.size.currentText(), '1536x1024')
    self.assertEqual(page.quality.currentText(), 'high')
    self.assertEqual(page.format.currentText(), 'webp')
    self.assertEqual(page.count.value(), 4)
    self.assertEqual(page.background.currentData(), 'transparent')
    self.assertEqual(page.moderation.currentData(), 'low')
    self.assertEqual(page.compression.value(), 77)
    self.assertEqual(page.attachments, [ref['path']])
    self.assertEqual(page.mask_image_id, mask['id'])
    self.assertEqual(Path(page.mask_file).read_bytes(), png_bytes(Qt.GlobalColor.black))
    self.assertEqual(received[0]['maskImageId'], mask['id'])
    self.assertEqual(received[0]['count'], 4)
    self.assertEqual(received[0]['background'], 'transparent')
    self.assertEqual(received[0]['moderation'], 'low')
    self.assertEqual(received[0]['output_compression'], 77)
    self.assertTrue(page.shutdown())
    history.close()

  def test_draft_persists_mask_parameters_and_respects_restart_setting(self):
    page = self.page()
    self.addCleanup(page.shutdown)
    ref = self.store.add_image(png_bytes(), source='upload')
    page.mask = QImage(8, 8, QImage.Format.Format_ARGB32)
    page.mask.fill(Qt.GlobalColor.black)
    page._persist_mask()
    mask = {'id': page.mask_image_id, 'path': page.mask_file}
    page.prompt.setPlainText('可恢复草稿')
    page.attachments = [ref['path']]
    page.mask_image_id = mask['id']
    page.mask_file = mask['path']
    page.profile.setCurrentIndex(page.profile.findData('profile-1'))
    page.model.setCurrentText('model-2')
    page.count.setValue(3)
    page.background.setCurrentIndex(page.background.findData('opaque'))
    page.moderation.setCurrentIndex(page.moderation.findData('auto'))
    page.compression.setValue(65)
    from native_gallery import WorkThread
    with patch.object(WorkThread, 'start', return_value=None):
      page.generate()
    self.assertEqual(self.store.get_meta('creationDraft')['maskImageId'], mask['id'])
    self.assertTrue(page.shutdown())

    self.store.set_meta('creationDraft', page.request())
    self.settings['persistInputOnRestart'] = True
    restored = self.page()
    self.addCleanup(restored.shutdown)
    self.assertEqual(restored.prompt.toPlainText(), '可恢复草稿')
    self.assertEqual(restored.model.currentText(), 'model-2')
    self.assertEqual(restored.count.value(), 3)
    self.assertEqual(restored.background.currentData(), 'opaque')
    self.assertEqual(restored.moderation.currentData(), 'auto')
    self.assertEqual(restored.compression.value(), 65)
    self.assertEqual(restored.mask_image_id, mask['id'])
    self.assertTrue(Path(restored.mask_file).is_file())

    self.settings['persistInputOnRestart'] = False
    restored.prompt.setPlainText('不应保存')
    from native_gallery import WorkThread
    with patch.object(WorkThread, 'start', return_value=None):
      restored.generate()
    self.assertEqual(self.store.get_meta('creationDraft'), {})
    self.assertTrue(restored.shutdown())

  def test_history_details_are_localized_and_save_all_uses_setting_route(self):
    from native_gallery import HistoryPage
    output = self.store.add_image(png_bytes(), source='generated')
    self.store.put_record('tasks', {'id': 'task-2', 'prompt': '细节', 'status': 'done',
      'apiProfileName': '临时配置', 'apiModel': 'model-1', 'params': {
        'size': '1024x1024', 'quality': 'high', 'output_format': 'png', 'n': 2,
        'background': 'auto', 'moderation': 'low', 'output_compression': 55},
      'inputImageIds': [], 'outputImages': [output['id']]})
    page = HistoryPage(self.store)
    page.list.setCurrentRow(0)
    self.assertIn('完成', page.list.item(0).text())
    self.assertIn('尺寸', page.details.text())
    self.assertIn('压缩质量', page.details.text())
    self.assertNotIn('"size"', page.details.text())
    all_button = next(button for button in page.findChildren(QPushButton) if button.text() == '保存本作品全部图片')
    captured = []
    with patch('native_gallery.save_images', side_effect=lambda *args: captured.append(args)):
      all_button.click()
    self.assertEqual(captured[0][2], [output['id']])
    self.assertEqual(captured[0][3], 'task-detail-all')
    page.close()


if __name__ == '__main__': unittest.main()
