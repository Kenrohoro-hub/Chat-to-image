from qt_test_support import app as QT_APP
import unittest
from pathlib import Path
from unittest.mock import patch

from native_prompt_sources import normalize_source, SOURCES
import struct
import zlib

def png_fixture():
  def chunk(name, data):
    payload = name + data
    return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xffffffff)
  return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\xff')) + chunk(b'IEND', b'')

class PromptSourceTests(unittest.TestCase):
  def test_each_site_fixture_matches_its_live_shape(self):
    fixtures = {
      'garden': [{'id': 11, 'title': 'Garden title', 'prompt': 'Garden prompt', 'category': 'Poster', 'image': 'images/a.png'}],
      'promptfill': {'templates': {'config': [{'id': 'pf', 'name': {'en': 'Fill'}, 'content': {'en': 'Draw {{subject:cat}}'}, 'tags': ['Art']}]}, 'banks': {'defaults': {}}},
      'youmind': [{'id': 12, 'title': 'Mind', 'translatedContent': {'en': 'Make {argument name=x default="blue"}'}, 'media': ['https://cms-assets.youmind.com/media/a.png']}],
      'pixto': [{'id': 13, 'name': {'en': 'Style'}, 'pre_prompt': 'Keep', 'fe_prompt': 'texture', 'category': {'name': 'Artistic'}, 'logo': 'https://s3.bmp.ovh/imgs/a.png'}],
      'nanoimage': [{'id': 'gpt2', 'title': {'en': 'Poster'}, 'prompt': {'en': 'Make a poster'}, 'category': 'Text & Poster', 'image_url': 'https://banana-prompt.nanoprompts.org/a.png'}],
      'nano': [{'id': 'nano', 'title': {'en': 'Photo'}, 'prompt': {'en': 'Soft light'}, 'category': 'Portrait'}],
      'hero': [{'id': 'hero', 'i18nContent': {'zh-CN': {'title': '海报', 'prompt': '标题 {{文字|选项|默认}}'}}, 'tagsArray': {'zh-CN': ['海报']}, 'imageUrl': 'https://img.wjwj.top/a.png'}],
    }
    expected = {'garden': 'Garden prompt', 'promptfill': 'Draw cat', 'youmind': 'Make blue', 'pixto': 'Keep\n\ntexture',
      'nanoimage': 'Make a poster', 'nano': 'Soft light', 'hero': '标题 默认'}
    for source, fixture in fixtures.items():
      with self.subTest(source=source):
        rows = normalize_source(source, fixture)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['prompt'], expected[source])
        self.assertEqual(rows[0]['source'], source)
        self.assertTrue(rows[0]['title'])
    self.assertEqual(len(SOURCES), 7)


  def test_promptfill_live_banks_options_provide_first_default(self):
    value = {
      'templates': {'config': [{'id': 'live', 'name': {'cn': '在线模板'}, 'content': {'cn': '画一个{{subject}}'}, 'tags': ['测试']}]},
      'banks': {'banks': {'subject': {'options': [{'cn': '海边灯塔', 'en': 'Lighthouse'}]}}},
    }
    rows = normalize_source('promptfill', value)
    self.assertEqual(rows[0]['prompt'], '画一个海边灯塔')

  def test_page_emits_required_prompt_shape(self):
    import os, sys
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    sys.path.insert(0, str(Path(__file__).parent))
    from PySide6.QtCore import QEventLoop, QTimer
    from PySide6.QtWidgets import QApplication
    from native_prompts import PromptPage
    from unittest.mock import patch
    class Store:
      root = Path('.')
      def list_records(self, kind): return [{'id': 'p1', 'title': 'Test', 'content': 'prompt text'}]
      def put_record(self, kind, record): return record
      def delete_record(self, kind, record_id): return None
      def get_meta(self, key, default=None): return default
      def set_meta(self, key, value): return None
    app = QApplication.instance() or QApplication([])
    with patch('native_prompts._storage_directory', return_value=''):
      page = PromptPage(Store())
      loop = QEventLoop()
      timeout = QTimer()
      timeout.setSingleShot(True)
      timeout.timeout.connect(loop.quit)
      checker = QTimer()
      checker.setInterval(10)
      checker.timeout.connect(lambda: loop.quit() if not page._active_tasks else None)
      checker.start()
      timeout.start(5000)
      if page._active_tasks:
        loop.exec()
      checker.stop()
      self.assertFalse(page._active_tasks, 'prompt page initialization worker did not finish')
      page.current = page.items[0]
      used = []
      page.usePrompt.connect(used.append)
      page._use()
      self.assertEqual(used[0]['prompt'], 'prompt text')
      self.assertTrue(page.shutdown())
      page.deleteLater(); app.processEvents()

  def test_prompt_workspace_restores_cards_categories_pagination_and_detail(self):
    import os, sys
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    sys.path.insert(0, str(Path(__file__).parent))
    from PySide6.QtCore import QEventLoop, QTimer
    from PySide6.QtWidgets import QDialog
    from native_prompts import PromptPage, _PromptDetail
    class Store:
      root = Path('.')
      def list_records(self, kind): return [{'id': f'p{i}', 'title': f'提示词 {i}', 'content': f'正文 {i}', 'category': 'A' if i < 15 else 'B'} for i in range(30)]
      def put_record(self, kind, record): return record
      def delete_record(self, kind, record_id): return None
      def get_meta(self, key, default=None): return {'prompt': '当前草稿'} if key == 'creationDraft' else default
      def set_meta(self, key, value): return None
    with patch('native_prompts._storage_directory', return_value=''):
      page = PromptPage(Store())
      page.resize(1200, 760)
      page.show()
      def wait_for_tasks():
        loop = QEventLoop(); timeout = QTimer(); timeout.setSingleShot(True); timeout.timeout.connect(loop.quit)
        checker = QTimer(); checker.setInterval(10); checker.timeout.connect(lambda: loop.quit() if not page._active_tasks else None)
        checker.start(); timeout.start(5000)
        if page._active_tasks: loop.exec()
        checker.stop(); self.assertFalse(page._active_tasks)
      wait_for_tasks()
      self.assertEqual(len(page.card_widgets), 24)
      page.next_page.click()
      self.assertEqual(len(page.card_widgets), 6)
      self.assertEqual(page.page_label.text(), '第 2 / 2 页')
      page.source.setCurrentIndex(page.source.findData('garden'))
      wait_for_tasks()
      page._set_items([{'id': f'g{i}', 'source': 'garden', 'title': f'在线 {i}', 'prompt': f'正文 {i}', 'category': '风景' if i < 10 else '人物'} for i in range(30)])
      self.assertTrue(page.category_panel.isVisible())
      self.assertEqual(page.category_buttons['风景'].text(), '风景  ·  10')
      page.category_buttons['风景'].click()
      self.assertEqual(len(page.card_widgets), 10)
      captured = []
      with patch.object(_PromptDetail, 'exec', side_effect=lambda dialog: (captured.append(dialog), QDialog.DialogCode.Rejected)[1]):
        page.card_open_buttons[0].click()
      self.assertEqual(captured[0].item['id'], 'g0')
      used = []
      page.usePrompt.connect(used.append)
      captured[0].use_button.click()
      self.assertEqual(used[0]['prompt'], '正文 0')
      with patch.object(page, '_edit_record') as edit:
        page.save_draft_button.click()
        edit.assert_called_once()
        self.assertEqual(edit.call_args.args[0]['prompt'], '当前草稿')
      self.assertTrue(page.shutdown())
      page.close(); page.deleteLater(); QT_APP.processEvents()

  def test_refresh_failure_preserves_existing_cache(self):
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from native_prompts import write_catalog, refresh_catalog
    with TemporaryDirectory() as temp:
      root = Path(temp)
      write_catalog(root, 'garden', [{'id': 'a', 'title': 'A', 'prompt': 'P', 'category': 'C'}], directory='')
      path = root / 'prompt-cache' / 'garden.json'
      before = path.read_bytes()
      with self.assertRaises(RuntimeError):
        refresh_catalog(root, 'garden', fetch=lambda *_: (_ for _ in ()).throw(RuntimeError('offline')), directory='')
      self.assertEqual(path.read_bytes(), before)

  def test_catalog_refresh_writes_complete_normalized_snapshot(self):
    from pathlib import Path
    from tempfile import TemporaryDirectory
    from native_prompts import refresh_catalog, read_catalog
    with TemporaryDirectory() as temp:
      root = Path(temp)
      result = refresh_catalog(root, 'garden', fetch=lambda *_: [{'id': 2, 'title': 'B', 'prompt': 'new'}], directory='')
      self.assertEqual(read_catalog(root, 'garden', directory='')['items'][0]['prompt'], 'new')
      self.assertEqual(result['items'][0]['id'], 'garden-2')

class PromptDirectoryIntegrationTests(unittest.TestCase):
  def setUp(self):
    import tempfile
    import prompt_storage
    self.temp = tempfile.TemporaryDirectory()
    self.root = Path(self.temp.name)
    self.lock_root = self.root / 'private-state'
    self.lock_root.mkdir()
    self.directory = self.root / 'library'
    self.directory.mkdir()
    (self.directory / '.prompt-library.json').write_text('{"format":1}', encoding='utf-8')
    self.configured = [str(self.directory)]
    self.local_patch = patch.object(prompt_storage, 'local_data_dir', return_value=self.lock_root)
    self.setting_patch = patch.object(prompt_storage, 'setting', side_effect=lambda: self.configured[0])
    self.local_patch.start(); self.setting_patch.start()
    self.addCleanup(self.setting_patch.stop); self.addCleanup(self.local_patch.stop)
    self.addCleanup(self.temp.cleanup)

  def test_personal_catalog_crud_favorites_revision_and_migration_use_dispatch(self):
    import base64
    import prompt_storage
    from native_prompts import read_catalog, write_catalog
    preview_url = 'https://r2.qqsrc.com/images/personal.png'
    png = png_fixture()
    prompt_storage.dispatch('image_write', {'directory': str(self.directory), 'source': 'personal', 'url': preview_url, 'category': 'Test', 'dataUrl': 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')})
    record = {'id': 'personal-1', 'title': 'Original', 'content': 'prompt one', 'category': 'Test', 'favorite': False, 'previewUrl': preview_url}
    first = write_catalog(self.root, 'personal', [record], directory=str(self.directory))
    self.assertTrue(first.get('revision'))
    loaded = read_catalog(self.root, 'personal', str(self.directory))
    self.assertEqual(loaded['revision'], first['revision'])
    edited = {**loaded['items'][0], 'title': 'Edited', 'prompt': 'prompt two', 'content': 'prompt two', 'favorite': True}
    second = write_catalog(self.root, 'personal', [edited], directory=str(self.directory), revision=loaded['revision'])
    self.assertEqual(second['items'][0]['title'], 'Edited')
    restored = write_catalog(self.root, 'personal', [], directory=str(self.directory), revision=second['revision'])
    self.assertEqual(restored['items'], [])
    prompt_storage.dispatch('image_write', {'directory': str(self.directory), 'source': 'personal', 'url': preview_url, 'category': 'Test', 'dataUrl': 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')})
    write_catalog(self.root, 'personal', [edited], directory=str(self.directory), revision=restored['revision'])
    pending = prompt_storage.dispatch('prepare', {'directory': str(self.root / 'moved-parent')})
    migrated = prompt_storage.dispatch('catalog_read', {'migration': pending['migration'], 'source': 'personal'})['catalog']
    self.assertEqual(migrated['items'][0]['content'], 'prompt two')
    result = prompt_storage.dispatch('commit', {'migration': pending['migration'], 'cleanPrevious': False})
    self.configured[0] = result['directory']
    after = prompt_storage.dispatch('catalog_read', {'directory': self.configured[0], 'source': 'personal'})['catalog']
    self.assertEqual(after['items'][0]['favorite'], True)
    self.assertEqual(after['items'][0]['previewUrl'], preview_url)
    self.assertTrue(prompt_storage.dispatch('image_read', {'directory': self.configured[0], 'url': preview_url})['dataUrl'].startswith('data:image/png;base64,'))

  def test_import_personal_merges_without_overwriting_and_export_reads_dispatch(self):
    import os, sys
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    sys.path.insert(0, str(Path(__file__).parent))
    import prompt_storage
    from PySide6.QtCore import QEventLoop, QTimer
    from PySide6.QtWidgets import QApplication
    from native_prompts import PromptPage, write_catalog
    existing = {'id': 'same', 'title': 'Keep local', 'content': 'local text', 'category': 'Local', 'previewUrl': 'https://r2.qqsrc.com/images/existing.png'}
    write_catalog(self.root, 'personal', [existing], directory=str(self.directory))
    class Store:
      root = self.root
      def get_meta(self, key, default=None): return default
      def set_meta(self, key, value): return None
    app = QApplication.instance() or QApplication([])
    with patch('native_prompts._storage_directory', return_value=str(self.directory)), patch('native_prompts.sources.download_bytes', return_value=png_fixture()):
      page = PromptPage(Store())
      def wait_for_tasks():
        loop = QEventLoop(); timer = QTimer(); timer.setSingleShot(True); timer.timeout.connect(loop.quit)
        checker = QTimer(); checker.setInterval(10); checker.timeout.connect(lambda: loop.quit() if not page._active_tasks else None)
        checker.start(); timer.start(5000)
        if page._active_tasks: loop.exec()
        checker.stop(); self.assertFalse(page._active_tasks)
      wait_for_tasks()
      imported = [{'id': 'same', 'title': 'Backup version', 'content': 'backup text'},
        {'id': 'new', 'title': 'Imported', 'content': 'new text'}]
      page.import_personal(imported)
      wait_for_tasks()
      catalog = prompt_storage.dispatch('catalog_read', {'directory': str(self.directory), 'source': 'personal'})['catalog']
      self.assertEqual([(row['id'], row['title']) for row in catalog['items']], [('same', 'Keep local'), ('new', 'Imported')])
      self.assertEqual([row['id'] for row in page.export_personal()], ['same', 'new'])
      self.assertEqual(page.export_personal()[0]['previewUrl'], 'https://r2.qqsrc.com/images/existing.png')
      self.assertIn('跳过 1 条', page.status.text())
      self.assertTrue(page.shutdown())
      page.deleteLater(); app.processEvents()

  def test_prompt_delete_undo_restores_cached_preview(self):
    import base64
    import os, sys
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    sys.path.insert(0, str(Path(__file__).parent))
    import prompt_storage
    from PySide6.QtCore import QEventLoop, QTimer
    from PySide6.QtWidgets import QApplication, QMessageBox
    from native_prompts import PromptPage, write_catalog
    url = 'https://r2.qqsrc.com/images/undo.png'
    png = png_fixture()
    prompt_storage.dispatch('image_write', {'directory': str(self.directory), 'source': 'personal', 'url': url, 'category': 'Test', 'dataUrl': 'data:image/png;base64,' + base64.b64encode(png).decode('ascii')})
    write_catalog(self.root, 'personal', [{'id': 'undo', 'title': 'Undo', 'content': 'prompt', 'previewUrl': url}], directory=str(self.directory))
    class Store:
      root = self.root
      def get_meta(self, key, default=None): return default
      def set_meta(self, key, value): return None
    app = QApplication.instance() or QApplication([])
    with patch('native_prompts._storage_directory', return_value=str(self.directory)), patch('native_prompts.QMessageBox.question', return_value=QMessageBox.StandardButton.Yes):
      page = PromptPage(Store())
      def wait_for_tasks():
        loop = QEventLoop(); timer = QTimer(); timer.setSingleShot(True); timer.timeout.connect(loop.quit)
        checker = QTimer(); checker.setInterval(10); checker.timeout.connect(lambda: loop.quit() if not page._active_tasks else None)
        checker.start(); timer.start(5000)
        if page._active_tasks: loop.exec()
        checker.stop(); self.assertFalse(page._active_tasks)
      wait_for_tasks()
      page._delete(); wait_for_tasks()
      undo_record, undo_images = page.undo_record, dict(page.undo_images)
      with patch('native_prompts.QMessageBox.warning'):
        page._undo_done(ValueError('disk unavailable'))
      self.assertEqual(page.undo_record, undo_record)
      self.assertEqual(page.undo_images, undo_images)
      page._undo(); wait_for_tasks()
      saved = prompt_storage.dispatch('image_read', {'directory': str(self.directory), 'url': url})['dataUrl']
      self.assertEqual(saved, 'data:image/png;base64,' + base64.b64encode(png).decode('ascii'))
      self.assertEqual(page.undo_record, None)
      self.assertTrue(page.shutdown())
      page.deleteLater(); app.processEvents()
  def test_download_bytes_validates_image_and_rejects_non_image(self):
    import base64
    import native_prompt_sources as sources
    png = png_fixture()
    class Response:
      def __enter__(self): return self
      def __exit__(self, *_): return None
      def read(self, size=-1): return png
    class Opener:
      def open(self, request, timeout):
        self.request, self.timeout = request, timeout
        return Response()
    opener = Opener()
    handlers = []
    with patch('native_prompt_sources.urllib.request.build_opener', side_effect=lambda *args: (handlers.extend(args), opener)[1]):
      self.assertEqual(sources.download_bytes('https://r2.qqsrc.com/images/a.png'), png)
    self.assertIn(sources.NoRedirect, handlers)
    self.assertIsNone(opener.request.get_header('Authorization'))
    self.assertEqual(opener.timeout, 15)
    with patch('native_prompt_sources.urllib.request.build_opener', return_value=type('Opener', (), {'open': lambda self, *_args, **_kwargs: type('Response', (), {'__enter__': lambda self: self, '__exit__': lambda self, *_: None, 'read': lambda self, size=-1: b'<html>not image</html>'})()})()):
      with self.assertRaises(ValueError): sources.download_bytes('https://r2.qqsrc.com/images/a.png')
    with self.assertRaises(ValueError): sources.download_bytes('http://127.0.0.1/internal')
    with self.assertRaises(ValueError): sources.download_bytes('https://r2.qqsrc.com.evil.test/images/a.png')
    with self.assertRaises(ValueError): sources.download_bytes('https://r2.qqsrc.com/images/../private.png')
    with patch('native_prompt_sources.MAX_PROMPT_IMAGE_BYTES', 1), patch('native_prompt_sources.urllib.request.build_opener', return_value=type('Opener', (), {'open': lambda self, *_args, **_kwargs: type('Response', (), {'__enter__': lambda self: self, '__exit__': lambda self, *_: None, 'read': lambda self, size=-1: b'xx'})()})()):
      with self.assertRaises(ValueError): sources.download_bytes('https://r2.qqsrc.com/images/a.png')


if __name__ == '__main__':
  unittest.main()
