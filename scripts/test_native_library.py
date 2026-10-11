import time
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PySide6.QtCore import QCoreApplication, QEvent, Qt, QTimer
from PySide6.QtWidgets import QMessageBox, QListWidget, QWidget, QHBoxLayout
from PySide6.QtTest import QTest

from qt_test_support import app as QT_APP
from native_library import LibraryPage
from native_store import Store


class LibraryPageTests(unittest.TestCase):
  def test_responsive_grid_tracks_parent_width_and_mode_title(self):
    with tempfile.TemporaryDirectory() as directory:
      store = Store(Path(directory) / 'native')
      for index in range(8):
        store.put_record('tasks', {'id': f'task-{index}', 'prompt': f'作品 {index}', 'status': 'success', 'createdAt': index, 'outputImages': []})
      page = LibraryPage(store)
      container = QWidget()
      layout = QHBoxLayout(container)
      sidebar = QWidget()
      sidebar.setFixedWidth(190)
      layout.addWidget(sidebar)
      layout.addWidget(page, 1)
      container.resize(1440, 900)
      self.addCleanup(lambda: (container.close(), container.deleteLater(), QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)))
      container.show()
      deadline = time.monotonic() + 2
      while time.monotonic() < deadline:
        QT_APP.processEvents()
        if page.grid.count() >= 4:
          cards = [page.grid.itemAt(index).widget() for index in range(4)]
          geometries = [card.geometry() for card in cards]
          if all(card.isVisible() for card in cards) and all(geometry.width() > 0 for geometry in geometries) and all(geometry.y() == geometries[0].y() for geometry in geometries) and geometries[-1].right() <= page.scroll.viewport().width():
            break
        QTest.qWait(10)
      self.assertEqual(page._columns(), 4)
      self.assertEqual(page.title.text(), '生成历史')
      cards = [page.grid.itemAt(index).widget() for index in range(4)]
      geometries = [card.geometry() for card in cards]
      self.assertTrue(all(geometry.y() == geometries[0].y() for geometry in geometries))
      self.assertTrue(all(left.right() <= right.left() for left, right in zip(geometries, geometries[1:])))
      self.assertLessEqual(geometries[-1].right(), page.scroll.viewport().width())
      container.resize(980, 680)
      deadline = time.monotonic() + 2
      while time.monotonic() < deadline:
        QT_APP.processEvents()
        if page.grid.count() >= 3 and page.grid.itemAt(2).geometry().y() > page.grid.itemAt(0).geometry().y():
          break
        QTest.qWait(10)
      self.assertEqual(page._columns(), 2)
      self.assertEqual(page.grid.itemAt(0).geometry().y(), page.grid.itemAt(1).geometry().y())
      self.assertGreater(page.grid.itemAt(2).geometry().y(), page.grid.itemAt(0).geometry().y())
      self.assertEqual(page.scroll.horizontalScrollBar().maximum(), 0)
      page.set_mode('favorites')
      self.assertEqual(page.title.text(), '我的收藏')

  def test_store_records_render_and_delete_keeps_image(self):
    with tempfile.TemporaryDirectory() as directory:
      store = Store(Path(directory) / 'native')
      from PySide6.QtCore import QByteArray, QBuffer, QIODevice
      from PySide6.QtGui import QImage
      pixels = QImage(4, 4, QImage.Format.Format_ARGB32)
      pixels.fill(0xff336699)
      data = QByteArray()
      buffer = QBuffer(data)
      self.assertTrue(buffer.open(QIODevice.OpenModeFlag.WriteOnly))
      self.assertTrue(pixels.save(buffer, 'PNG'))
      buffer.close()
      saved = store.add_image(bytes(data), image_id='cover')
      task = {'id': 'task-1', 'prompt': '海边灯塔', 'status': 'done', 'outputImages': ['cover'], 'isFavorite': True, 'favoriteCollectionIds': ['set-1']}
      store.put_record('tasks', task)
      store.put_record('collections', {'id': 'set-1', 'name': '风景'})
      page = LibraryPage(store)
      page.set_mode('favorites')
      self.assertEqual(page.records[0]['id'], 'task-1')
      self.assertEqual(page.grid.count(), 2)
      page._open_collection('set-1')
      self.assertEqual(page.grid.count(), 1)
      page._select_task(task)
      emitted = []
      page.reuse.connect(emitted.append)
      page.reuse_task()
      self.assertEqual(emitted[0]['prompt'], '海边灯塔')
      with patch('native_library.QMessageBox.question', return_value=QMessageBox.StandardButton.Yes):
        page.delete_task()
      page.refresh()
      self.assertFalse(store.list_records('tasks'))
      self.assertTrue(Path(saved['path']).is_file())
      page.deleteLater()
      QT_APP.processEvents()

  def test_collection_cover_and_navigation(self):
    with tempfile.TemporaryDirectory() as directory:
      store = Store(Path(directory) / 'native')
      store.put_record('collections', {'id': 'set-1', 'name': '风景'})
      store.put_record('collections', {'id': 'set-2', 'name': '人物'})
      store.put_record('tasks', {'id': 'task-1', 'prompt': '山', 'status': 'done', 'createdAt': 3, 'outputImages': ['a', 'b'], 'isFavorite': True, 'favoriteCollectionIds': ['set-1']})
      store.put_record('tasks', {'id': 'task-2', 'prompt': '山', 'status': 'done', 'createdAt': 2, 'outputImages': ['b', 'c', 'd'], 'isFavorite': True, 'favoriteCollectionIds': ['set-1']})
      store.put_record('tasks', {'id': 'task-3', 'prompt': '海', 'status': 'done', 'createdAt': 1, 'outputImages': ['e'], 'isFavorite': True, 'favoriteCollectionIds': ['set-2']})
      page = LibraryPage(store)
      page.set_mode('favorites')
      self.assertEqual(page.grid.count(), 3)
      self.assertEqual(page._cover_images({'id': '*', 'tasks': page.records}), ['a', 'b', 'c', 'd'])
      set_tasks = [task for task in page.records if 'set-1' in task['favoriteCollectionIds']]
      self.assertEqual(page._cover_images({'id': 'set-1', 'tasks': set_tasks}), ['a', 'b', 'c', 'd'])
      page._open_collection('set-1')
      self.assertEqual(page.collection_id, 'set-1')
      self.assertEqual(page.grid.count(), 2)
      page.show_collections()
      self.assertIsNone(page.collection_id)
      def choose():
        dialog = QT_APP.activeModalWidget()
        options = dialog.findChild(QListWidget)
        for index in range(options.count()):
          item = options.item(index)
          item.setCheckState(Qt.CheckState.Checked if item.data(Qt.ItemDataRole.UserRole) in ('set-1', 'set-2') else Qt.CheckState.Unchecked)
        dialog.accept()
      QTimer.singleShot(0, choose)
      page.choose_collections(['task-1', 'task-3'])
      updated = {task['id']: task for task in store.list_records('tasks')}
      self.assertEqual(set(updated['task-1']['favoriteCollectionIds']), {'set-1', 'set-2'})
      self.assertTrue(updated['task-1']['isFavorite'])
      self.assertEqual(set(updated['task-3']['favoriteCollectionIds']), {'set-1', 'set-2'})
      page.deleteLater()
      QT_APP.processEvents()

  def test_bulk_delete_keeps_images_and_running_tasks(self):
    with tempfile.TemporaryDirectory() as directory:
      store = Store(Path(directory) / 'native')
      from PySide6.QtCore import QByteArray, QBuffer, QIODevice
      from PySide6.QtGui import QImage
      pixels = QImage(2, 2, QImage.Format.Format_ARGB32)
      pixels.fill(0xff112233)
      data = QByteArray()
      buffer = QBuffer(data)
      buffer.open(QIODevice.OpenModeFlag.WriteOnly)
      pixels.save(buffer, 'PNG')
      buffer.close()
      saved = store.add_image(bytes(data), image_id='bulk-image')
      store.put_record('tasks', {'id': 'done', 'status': 'success', 'outputImages': ['bulk-image']})
      store.put_record('tasks', {'id': 'running', 'status': 'running', 'outputImages': []})
      page = LibraryPage(store)
      page.selected_ids = {'done', 'running'}
      with patch('native_library.QMessageBox.question', return_value=QMessageBox.StandardButton.Yes):
        page.delete_selected_tasks()
      self.assertEqual([task['id'] for task in store.list_records('tasks')], ['running'])
      self.assertEqual(page.selected_ids, {'running'})
      self.assertTrue(Path(saved['path']).is_file())
      page.deleteLater()
      QT_APP.processEvents()


if __name__ == '__main__':
  unittest.main()
