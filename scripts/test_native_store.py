"""原生作品库的真实文件与备份边界。"""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import base64

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWNDwHwAFZAKAcWn0agAAAABJRU5ErkJggg==')

class StoreTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.root = Path(self.tmp.name)

  def store(self, name='data'):
    self.assertIsNotNone(importlib.util.find_spec('native_store'), 'native store is not implemented')
    from native_store import Store
    return Store(self.root / name)

  def test_saved_image_task_and_favorite_survive_reopen(self):
    store = self.store()
    image = store.add_image(PNG, image_id='picture', source='generated')
    store.put_record('tasks', {'id': 'task', 'prompt': '中文图片', 'outputImages': [image['id']], 'isFavorite': True})
    again = self.store()
    self.assertEqual(again.image_path('picture').read_bytes(), PNG)
    self.assertTrue(again.list_records('tasks')[0]['isFavorite'])

  def test_backup_round_trip_and_repeat_import(self):
    store = self.store()
    store.add_image(PNG, image_id='picture')
    store.put_record('tasks', {'id': 'task', 'prompt': 'cat', 'outputImages': ['picture']})
    store.put_record('conversations', {'id': 'chat', 'messages': [], 'rounds': []})
    target = self.root / 'backup.zip'
    store.export_zip(target)
    imported = self.store('imported')
    imported.import_zip(target)
    imported.import_zip(target)
    self.assertEqual(len(imported.list_records('tasks')), 1)
    self.assertEqual(imported.image_path('picture').read_bytes(), PNG)
    self.assertEqual(imported.list_records('conversations')[0]['id'], 'chat')

  def test_backup_uses_current_personal_directory_records(self):
    store = self.store()
    store.put_record('prompts', {'id': 'stale', 'prompt': 'old'})
    current = [{'id': 'current', 'prompt': 'current personal directory'}]
    target = self.root / 'personal.zip'
    store.export_zip(target, current)
    imported = self.store('imported')
    imported.import_zip(target)
    self.assertEqual(imported.list_records('prompts'), current)

  def test_malformed_backup_does_not_partially_import_or_escape(self):
    store = self.store()
    target = self.root / 'bad.zip'
    with zipfile.ZipFile(target, 'w') as archive:
      archive.writestr('manifest.json', json.dumps({'version': 3, 'tasks': [{'id': 'task'}], 'imageFiles': {'picture': {'path': '../outside.png'}}}))
      archive.writestr('../outside.png', PNG)
    with self.assertRaises(ValueError): store.import_zip(target)
    self.assertEqual(store.list_records('tasks'), [])
    self.assertFalse((self.root / 'outside.png').exists())

  def test_conflicting_import_preserves_existing_data(self):
    store = self.store()
    store.put_record('tasks', {'id': 'same', 'prompt': 'keep'})
    target = self.root / 'conflict.zip'
    with zipfile.ZipFile(target, 'w') as archive:
      archive.writestr('manifest.json', json.dumps({'version': 3, 'tasks': [{'id': 'new'}, {'id': 'same', 'prompt': 'replace'}]}))
    with self.assertRaises(ValueError): store.import_zip(target)
    self.assertEqual(store.list_records('tasks'), [{'id': 'same', 'prompt': 'keep'}])

if __name__ == '__main__': unittest.main()
