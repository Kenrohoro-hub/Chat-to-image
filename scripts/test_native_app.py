"""真实 Qt 控件与隔离 API 的入口检查。"""
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from PySide6.QtCore import Qt, QPointF
from PySide6.QtGui import QImage
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QPushButton

from qt_test_support import app, dispose


def wait_for(condition, timeout=15):
  deadline = time.monotonic() + timeout
  while not condition() and time.monotonic() < deadline:
    app.processEvents()
    QTest.qWait(10)
  app.processEvents()
  return condition()


class NativeAppTests(unittest.TestCase):
  def test_real_entry_event_loop_closes_cleanly(self):
    import subprocess
    import sys
    code = """
import sys
sys.path.insert(0, sys.argv[1])
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication
from native_app import main
from native_store import Store
app = QApplication([])
Store(sys.argv[2]).set_meta('welcomeHidden', True)
QTimer.singleShot(1200, app.closeAllWindows)
result = main(['--data-dir', sys.argv[2]])
assert not any(name in sys.modules for name in ('webview', 'serve_app', 'PySide6.QtWebEngineWidgets'))
print('native entry completed', result)
raise SystemExit(result)
"""
    with tempfile.TemporaryDirectory() as folder:
      environment = {**os.environ, 'LOCALAPPDATA': folder, 'PLAYGROUND_CONFIG_DIR': str(Path(folder) / 'config')}
      result = subprocess.run([sys.executable, '-B', '-X', 'faulthandler', '-c', code, str(Path(__file__).parent), str(Path(folder) / 'library')], capture_output=True, text=True, env=environment, timeout=30)
      self.assertEqual(result.returncode, 0, result.stderr)
      self.assertIn('native entry completed 0', result.stdout)

  def test_native_window_opens_without_web_host_and_preserves_draft(self):
    from native_app import MainWindow
    from native_store import Store
    with tempfile.TemporaryDirectory() as folder:
      with patch.dict(os.environ, {'LOCALAPPDATA': folder, 'PLAYGROUND_CONFIG_DIR': str(Path(folder) / 'config')}):
        window = MainWindow(Store(Path(folder) / 'library'))
        window.show()
        app.processEvents()
        window.creation.prompt.setPlainText('中文草稿')
        picture = QImage(24, 24, QImage.Format.Format_RGB32)
        picture.fill(Qt.GlobalColor.white)
        reference = Path(folder) / 'reference.png'
        picture.save(str(reference))
        image_id = window.store.add_image(reference)['id']
        window.creation.attachments = [image_id]
        window.creation.draft_mask_id = image_id
        window.creation.image_params = {'size': '1536x1024'}
        window.save_draft()
        self.assertEqual(window.store.get_meta('creationDraft')['prompt'], '中文草稿')
        self.assertEqual(window.pages.count(), 3)
        self.assertEqual(window.navigation.count(), 4)
        self.assertIs(window.conversation, window.creation)
        window.close()
        self.assertTrue(wait_for(lambda: not window.isVisible()))
        reopened = MainWindow(window.store)
        self.assertEqual(reopened.creation.prompt.toPlainText(), '中文草稿')
        self.assertEqual(reopened.creation.attachments, [image_id])
        self.assertEqual(reopened.creation.draft_mask_id, image_id)
        self.assertEqual(reopened.creation.image_params['size'], '1536x1024')
        reopened.close()
        self.assertTrue(wait_for(lambda: reopened.prompts.shutdown()))
        dispose(reopened)
        dispose(window)
        import sys
        self.assertNotIn('webview', sys.modules)
        self.assertNotIn('serve_app', sys.modules)
        self.assertNotIn('PySide6.QtWebEngineWidgets', sys.modules)

  def test_mask_transparency_tracks_painted_area_and_undo(self):
    from native_canvas import MaskView
    with tempfile.TemporaryDirectory() as folder:
      path = Path(folder) / 'input.png'
      image = QImage(200, 200, QImage.Format.Format_ARGB32)
      image.fill(Qt.GlobalColor.white)
      image.save(str(path))
      view = MaskView(path)
      view.history.append((view.mask.copy(), view.overlay.copy()))
      view.previous = QPointF(100, 100)
      view.paint_to(QPointF(101, 100))
      self.assertEqual(view.mask.pixelColor(100, 100).alpha(), 0)
      self.assertEqual(view.mask.pixelColor(0, 0).alpha(), 255)
      view.undo()
      self.assertEqual(view.mask.pixelColor(100, 100).alpha(), 255)
      dispose(view)

  def test_stop_button_cancels_current_generation_and_keeps_completed_image(self):
    from test_native_images import ImageTests
    fixture = ImageTests()
    fixture.setUp()
    self.addCleanup(fixture.doCleanups)
    fixture.delay_after_first = True
    from native_app import MainWindow
    from native_store import Store
    window = MainWindow(Store(fixture.root / 'stop-ui'))
    self.addCleanup(dispose, window)
    window.show()
    page = window.creation
    page.prompt.setPlainText('test cancel')
    page.image_params = {'n': 6, 'size': 'auto'}
    QTest.mouseClick(page.direct_button, Qt.MouseButton.LeftButton)
    self.assertTrue(wait_for(lambda: any(task.get('outputImages') for task in window.store.list_records('tasks')) and page.is_busy()),
      f'no cancellable partial result; calls={fixture.calls}, tasks={window.store.list_records("tasks")}, status={page.conversation_status.text()}')
    cancel = page.cancel_event
    QTest.mouseClick(page.stop_button, Qt.MouseButton.LeftButton)
    self.assertTrue(cancel.is_set(), 'stop must cancel the event for the active generation')
    self.assertTrue(wait_for(lambda: not page.is_busy()))
    self.assertGreaterEqual(len(page.result_images), 1)
    task = page.result_images[0][0]
    self.assertEqual(task['status'], 'cancelled')
    self.assertEqual(task['sourceMode'], 'agent')
    self.assertEqual(task['agentConversationId'], page.current_id)
    self.assertTrue(task['agentRoundId'])
    self.assertTrue(all(window.store.image_path(image_id).is_file() for _, image_id in page.result_images))
    window.close()
    self.assertTrue(wait_for(lambda: not window.isVisible()))

  def test_generate_through_qt_controls_save_reuse_and_history(self):
    from test_native_images import ImageTests
    fixture = ImageTests()
    fixture.setUp()
    self.addCleanup(fixture.doCleanups)
    from native_app import MainWindow
    from native_store import Store
    window = MainWindow(Store(fixture.root / 'ui-data'))
    self.addCleanup(dispose, window)
    window.show()
    page = window.creation
    page.prompt.setPlainText('隔离验证：林间小屋，暖色灯光')
    page.image_params = {'n': 2, 'size': 'auto', 'profileId': 'test', 'model': 'image'}
    QTest.mouseClick(page.direct_button, Qt.MouseButton.LeftButton)
    self.assertTrue(wait_for(lambda: not page.is_busy()),
      f'generation did not finish; calls={fixture.calls}, tasks={window.store.list_records("tasks")}, status={page.conversation_status.text()}')
    app.processEvents()
    self.assertEqual(len(page.result_images), 2,
      f'{page.conversation_status.text()}; tasks={window.store.list_records("tasks")}; current={page._record()}')
    self.assertEqual(len(fixture.calls), 2)
    task = page.result_images[0][0]
    conversation = next(item for item in window.store.list_records('conversations') if item['id'] == page.current_id)
    self.assertEqual(task['agentConversationId'], conversation['id'])
    self.assertEqual(task['agentRoundId'], conversation['activeRoundId'])
    self.assertEqual(task['status'], 'success')
    self.assertTrue(all(window.store.image_path(image_id).read_bytes() for _, image_id in page.result_images))

    page.select_image(page.result_images[0][1])
    with patch('native_gallery.QFileDialog.getExistingDirectory', return_value=str(fixture.root / 'saved')), \
         patch('native_gallery.QMessageBox.information'):
      (fixture.root / 'saved').mkdir()
      next(button for button in page.findChildren(QPushButton)
        if button.text() == '下载').click()
    self.assertTrue((fixture.root / 'saved' / 'image-1.png').is_file())

    window.navigation.setCurrentRow(1)
    app.processEvents()
    self.assertEqual(len(window.history.records), 1)
    window.history.active_id = task['id']
    self.assertEqual(window.history.current()['id'], task['id'])
    window.history.favorite()
    self.assertTrue(next(row for row in window.store.list_records('tasks') if row['id'] == task['id'])['isFavorite'])
    window.navigation.setCurrentRow(3)
    self.assertEqual(window.history.mode, 'favorites')
    window.history.reuse_task()
    app.processEvents()
    self.assertEqual(page.prompt.toPlainText(), task['prompt'])
    self.assertEqual(page.image_params['n'], 2)
    self.assertEqual(window.navigation.currentRow(), 0)
    self.assertEqual(window.store.list_records('tasks')[0]['status'], 'success')
    window.close()
    self.assertTrue(wait_for(lambda: not window.isVisible()))

if __name__ == '__main__': unittest.main()
