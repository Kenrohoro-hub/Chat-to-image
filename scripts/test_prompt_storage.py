"""只在隔离目录验证提示词文件、迁移与边界。"""
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prompt_storage as storage


class PromptStorageTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='prompt-storage-test-')
    self.addCleanup(self.temp.cleanup)
    self.home = Path(self.temp.name)
    self.env = patch.dict(os.environ, {'LOCALAPPDATA': str(self.home), 'PLAYGROUND_CONFIG_DIR': str(self.home / 'config')})
    self.env.start()
    self.addCleanup(self.env.stop)
    storage.MIGRATIONS.clear()
    def remove(paths):
      for path in paths:
        self.assertTrue(path.is_relative_to(self.home))
        path.unlink(missing_ok=True)
    self.recycle = patch.object(storage, 'recycle', side_effect=remove)
    self.recycle.start()
    self.addCleanup(self.recycle.stop)
    self.item = {'id': 'garden-1', 'title': '产品摄影', 'content': '柔和光线', 'category': '摄影/产品', 'categories': ['摄影/产品', '人像'], 'previewUrl': 'https://r2.qqsrc.com/images/1.png', 'createdAt': 0, 'updatedAt': 0}
    self.data = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()

  def call(self, action, **payload):
    return storage.dispatch(action, {'directory': storage.setting(), **payload})

  def enable(self, name='保存目录'):
    pending = self.call('prepare', directory=str(self.home / name))
    self.call('catalog_write', migration=pending['migration'], source='personal', items=[], updatedAt=0)
    return self.call('commit', migration=pending['migration'], preferences={'removed': [], 'examplesAdded': True})

  def test_example_version_survives_save_delete_and_directory_copy(self):
    self.enable()
    revision = self.call('catalog_read', source='personal')['catalog']['revision']
    saved = self.call('catalog_write', source='personal', items=[self.item], revision=revision, examplesVersion=2)['catalog']
    self.assertEqual(saved['examplesVersion'], 2)
    self.call('catalog_write', source='personal', items=[], revision=saved['revision'], examplesVersion=2)
    pending = self.call('prepare', directory=str(self.home / 'Copied'))
    copied = self.call('catalog_read', source='personal', migration=pending['migration'])['catalog']
    self.assertEqual(copied['items'], [])
    self.assertEqual(copied['examplesVersion'], 2)
    self.call('abort', migration=pending['migration'])

  def test_failed_personal_catalog_write_keeps_saved_images(self):
    root = Path(self.enable()['directory'])
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    previous = self.call('catalog_read', source='personal')['catalog']
    saved = self.call('catalog_write', source='personal', items=[self.item], revision=previous['revision'])['catalog']
    original = storage.write_json
    def fail(path, value):
      if path == root / '个人提示词' / '目录.json':
        raise OSError('disk full')
      return original(path, value)
    with patch.object(storage, 'write_json', side_effect=fail):
      with self.assertRaises(OSError):
        self.call('catalog_write', source='personal', items=[], revision=saved['revision'])
    self.assertEqual(self.call('catalog_read', source='personal')['catalog'], saved)
    self.assertEqual(self.call('catalog_read', source='personal')['images'], [self.item['previewUrl']])
    self.call('catalog_write', source='personal', items=[], revision=saved['revision'])
    self.assertEqual(self.call('catalog_read', source='personal')['images'], [])

  def test_catalog_images_and_personal_are_read_from_named_directories(self):
    self.assertEqual(self.call('status')['directory'], '')
    root = Path(self.enable()['directory'])
    self.call('catalog_write', source='garden', items=[self.item], updatedAt=3)
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    self.assertEqual(self.call('image_read', url=self.item['previewUrl'])['dataUrl'], self.data)
    result = self.call('catalog_read', source='garden')
    self.assertEqual(result['catalog']['items'], [self.item])
    self.assertEqual(result['images'], [self.item['previewUrl']])
    category = root / '水仙' / storage.category_name(self.item['category'])
    self.assertEqual(json.loads((category / '提示词.json').read_text(encoding='utf-8'))['category'], self.item['category'])
    self.assertEqual(len(list((category / '图片').glob('*.png'))), 1)
    revision = self.call('catalog_read', source='personal')['catalog']['revision']
    self.call('catalog_write', source='personal', items=[self.item], updatedAt=4, revision=revision)
    self.assertEqual(len(list((root / '个人提示词').rglob('*.png'))), 1)
    with self.assertRaisesRegex(ValueError, '其他窗口'):
      self.call('catalog_write', source='personal', items=[], updatedAt=5, revision=revision)
    self.assertEqual(self.call('catalog_read', source='personal')['catalog']['items'], [self.item])

  def test_copy_commit_and_abort_keep_old_data_and_never_overwrite_nonempty_target(self):
    old = Path(self.enable()['directory'])
    self.call('catalog_write', source='garden', items=[self.item], updatedAt=3)
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    self.call('preferences', preferences={'removed': ['hero'], 'examplesAdded': True})
    pending = self.call('prepare', directory=str(self.home / '第二位置'))
    self.assertEqual(storage.setting(), str(old))
    self.assertEqual(self.call('image_read', migration=pending['migration'], url=self.item['previewUrl'])['dataUrl'], self.data)
    new = self.call('commit', migration=pending['migration'], preferences={'removed': ['hero'], 'examplesAdded': True})
    self.assertTrue((old / '水仙' / '目录.json').exists())
    self.assertEqual(self.call('status')['preferences']['removed'], ['hero'])
    with self.assertRaisesRegex(ValueError, '非空'):
      self.call('prepare', directory=str(self.home / '保存目录'))
    another = self.call('prepare', directory=str(self.home / '第三位置'))
    self.call('abort', migration=another['migration'])
    self.assertFalse(Path(another['directory']).exists())
    self.assertEqual(storage.setting(), new['directory'])
    with self.assertRaisesRegex(ValueError, '已变化'):
      self.call('catalog_read', directory=str(old), source='garden')

  def test_source_update_during_copy_prevents_switch(self):
    old = self.enable()['directory']
    pending = self.call('prepare', directory=str(self.home / '新目录'))
    previous = self.call('catalog_read', source='personal')['catalog']
    self.call('catalog_write', source='personal', items=[self.item], revision=previous['revision'])
    with self.assertRaisesRegex(ValueError, '更新'):
      self.call('commit', migration=pending['migration'], cleanPrevious=True, preferences={'removed': [], 'examplesAdded': True})
    self.assertEqual(storage.setting(), old)
    self.assertTrue((Path(old) / '个人提示词' / '目录.json').exists())
    self.assertEqual(self.call('catalog_read', source='personal')['catalog']['items'], [self.item])
    self.call('abort', migration=pending['migration'])

  def test_failed_commit_does_not_change_active_directory(self):
    old = self.enable()['directory']
    pending = self.call('prepare', directory=str(self.home / '新目录'))
    original = storage.write_json
    def fail(path, value):
      if path.name == 'prompt-storage.json':
        raise OSError('disk full')
      original(path, value)
    with patch.object(storage, 'write_json', side_effect=fail):
      with self.assertRaises(OSError):
        self.call('commit', migration=pending['migration'], cleanPrevious=True, preferences={'removed': [], 'examplesAdded': True})
    self.assertEqual(storage.setting(), old)
    self.assertTrue((Path(old) / '个人提示词' / '目录.json').exists())
    self.assertFalse(Path(pending['directory']).exists())
    self.call('abort', migration=pending['migration'])

  def test_clear_preserves_personal_images_and_unknown_files(self):
    root = Path(self.enable()['directory'])
    self.call('catalog_write', source='garden', items=[self.item], updatedAt=3)
    personal = self.call('catalog_read', source='personal')['catalog']
    self.call('catalog_write', source='personal', items=[self.item], revision=personal['revision'])
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    extra = root / '水仙' / '自己的说明.txt'
    extra.write_text('保留', encoding='utf-8')
    self.call('clear', source='garden')
    self.assertTrue(self.call('catalog_read', source='garden')['catalog']['cleared'])
    self.assertEqual(self.call('catalog_read', source='garden')['images'], [])
    self.assertEqual(self.call('image_read', url=self.item['previewUrl'])['dataUrl'], self.data)
    self.assertEqual(extra.read_text(encoding='utf-8'), '保留')

  def test_cleanup_only_registered_files_after_commit(self):
    old = Path(self.enable()['directory'])
    self.call('catalog_write', source='garden', items=[self.item], updatedAt=3)
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    extra = old / '水仙' / '自己的说明.txt'
    extra.write_text('保留', encoding='utf-8')
    pending = self.call('prepare', directory=str(self.home / '新目录'))
    result = self.call('commit', migration=pending['migration'], cleanPrevious=True)
    self.assertIn('其他文件仍保留', result['message'])
    self.assertEqual(extra.read_text(encoding='utf-8'), '保留')
    self.assertFalse((old / '水仙' / '目录.json').exists())
    self.assertEqual(self.call('image_read', url=self.item['previewUrl'])['dataUrl'], self.data)
    self.assertEqual(storage.setting(), pending['directory'])

  def test_cleanup_failure_keeps_new_location_active(self):
    old = Path(self.enable()['directory'])
    pending = self.call('prepare', directory=str(self.home / '新目录'))
    with patch.object(storage, 'recycle', side_effect=ValueError('recycle failed')):
      result = self.call('commit', migration=pending['migration'], cleanPrevious=True)
    self.assertIn('清理未完成', result['message'])
    self.assertEqual(storage.setting(), pending['directory'])
    self.assertTrue((old / '个人提示词' / '目录.json').exists())
    self.assertIsNotNone(self.call('catalog_read', source='personal')['catalog'])

  def test_changed_source_image_prevents_switch_and_cleanup(self):
    old = Path(self.enable()['directory'])
    self.call('image_write', source='garden', category=self.item['category'], url=self.item['previewUrl'], dataUrl=self.data)
    pending = self.call('prepare', directory=str(self.home / '新目录'))
    image = storage.find_image(old, self.item['previewUrl'])[0]
    image.write_bytes(b'changed externally')
    with self.assertRaisesRegex(ValueError, '原文件在复制后有变化'):
      self.call('commit', migration=pending['migration'], cleanPrevious=True)
    self.assertEqual(storage.setting(), str(old))
    self.assertEqual(image.read_bytes(), b'changed externally')
    self.call('abort', migration=pending['migration'])
    self.assertTrue((old / '个人提示词' / '目录.json').exists())

  def test_rejects_traversal_invalid_sources_and_unsupported_images(self):
    root = Path(self.enable()['directory'])
    with self.assertRaisesRegex(ValueError, '绝对路径'):
      self.call('prepare', directory='../relative')
    with self.assertRaisesRegex(ValueError, '里面'):
      self.call('prepare', directory=str(root / 'child'))
    with self.assertRaisesRegex(ValueError, '未知'):
      self.call('catalog_write', source='../foreign', items=[])
    with self.assertRaisesRegex(ValueError, '格式不支持'):
      self.call('image_write', source='garden', url=self.item['previewUrl'], dataUrl='data:text/html;base64,aGVsbG8=')
    storage.write_json(root / '水仙' / '图片索引.json', {self.item['previewUrl']: {'path': '../../../outside.png', 'mime': 'image/png'}})
    with self.assertRaisesRegex(ValueError, '非法路径'):
      self.call('image_read', url=self.item['previewUrl'])


if __name__ == '__main__':
  unittest.main()
