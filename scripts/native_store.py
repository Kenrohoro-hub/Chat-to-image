"""原生桌面的本机记录与图片；每次连接独立，后台工作可安全保存。"""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
import tempfile
import threading
import time
import uuid
import zipfile

from playground_config import local_data_dir
from playground_image import image_info, MAX_IMAGE_BYTES


class Store:
  def __init__(self, root=None):
    self.root = Path(root) if root is not None else local_data_dir() / 'native'
    self.root.mkdir(parents=True, exist_ok=True)
    (self.root / 'images').mkdir(exist_ok=True)
    self._lock = threading.RLock()
    with closing(self.connect()) as db:
      db.executescript('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, path TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL);')

  def connect(self):
    return sqlite3.connect(self.root / 'library.sqlite3', timeout=30)

  def list_records(self, kind):
    with self._lock, closing(self.connect()) as db:
      return [json.loads(row[0]) for row in db.execute('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC', (kind,))]

  def put_record(self, kind, record):
    if not isinstance(record, dict) or not isinstance(record.get('id'), str) or not record['id']:
      raise ValueError('记录缺少有效标识。')
    with self._lock, closing(self.connect()) as db, db:
      db.execute('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data', (kind, record['id'], json.dumps(record, ensure_ascii=False)))

  def delete_record(self, kind, record_id):
    # 图片可能被对话或其他作品引用；删除记录不级联删除原图。
    with self._lock, closing(self.connect()) as db, db:
      db.execute('DELETE FROM records WHERE kind=? AND id=?', (kind, record_id))

  def get_meta(self, key, default=None):
    with self._lock, closing(self.connect()) as db:
      row = db.execute('SELECT data FROM metadata WHERE key=?', (key,)).fetchone()
      return json.loads(row[0]) if row else default

  def set_meta(self, key, value):
    with self._lock, closing(self.connect()) as db, db:
      db.execute('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', (key, json.dumps(value, ensure_ascii=False)))

  def image_path(self, image_id):
    with self._lock, closing(self.connect()) as db:
      row = db.execute('SELECT path FROM images WHERE id=?', (image_id,)).fetchone()
    if not row:
      return None
    path = (self.root / row[0]).resolve()
    if not path.is_relative_to((self.root / 'images').resolve()):
      raise ValueError('图片路径超出作品目录。')
    return path

  def add_image(self, data, image_id=None, source='upload', metadata=None):
    if isinstance(data, (str, Path)):
      path = Path(data)
      if path.stat().st_size > MAX_IMAGE_BYTES: raise ValueError('图片超过 50 MiB。')
      data = path.read_bytes()
    if len(data) > MAX_IMAGE_BYTES: raise ValueError('图片超过 50 MiB。')
    fmt, width, height, _ = image_info(data)
    image_id = image_id or uuid.uuid4().hex
    name = 'images/' + hashlib.sha256(image_id.encode('utf-8')).hexdigest() + '.' + fmt
    target = self.root / name
    record = {**(metadata or {}), 'id': image_id, 'source': source, 'width': width, 'height': height, 'createdAt': (metadata or {}).get('createdAt', int(time.time() * 1000))}
    with self._lock, closing(self.connect()) as db, db:
      old = db.execute('SELECT path,data FROM images WHERE id=?', (image_id,)).fetchone()
      if old:
        if (self.root / old[0]).read_bytes() != data: raise ValueError('图片标识冲突，原图已保留。')
        return {**json.loads(old[1]), 'path': str(self.root / old[0])}
      with target.open('xb') as file:
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
      try:
        db.execute('INSERT INTO images VALUES (?,?,?)', (image_id, name, json.dumps(record, ensure_ascii=False)))
      except BaseException:
        target.unlink(missing_ok=True)
        raise
    return {**record, 'path': str(target)}

  def export_zip(self, target, personal_prompts=None):
    target = Path(target)
    mapping = {'tasks': 'tasks', 'conversations': 'agentConversations', 'collections': 'favoriteCollections', 'prompts': 'promptTemplates'}
    with self._lock, closing(self.connect()) as db:
      manifest = {'version': 3, 'exportedAt': datetime.now(timezone.utc).isoformat(), 'imageFiles': {}}
      for kind, key in mapping.items():
        manifest[key] = [json.loads(row[0]) for row in db.execute('SELECT data FROM records WHERE kind=?', (kind,))]
      if personal_prompts is not None: manifest['promptTemplates'] = personal_prompts
      images = list(db.execute('SELECT id,path,data FROM images'))
      handle, name = tempfile.mkstemp(prefix='.chat-to-image-', suffix='.zip', dir=target.parent)
      os.close(handle)
      try:
        with zipfile.ZipFile(name, 'w', zipfile.ZIP_DEFLATED) as archive:
          for image_id, path, record in images:
            data = json.loads(record)
            manifest['imageFiles'][image_id] = {**data, 'path': path}
            archive.write(self.root / path, path, compress_type=zipfile.ZIP_STORED)
          archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
        os.replace(name, target)
      finally:
        Path(name).unlink(missing_ok=True)
    return {'tasks': len(manifest['tasks']), 'images': len(images)}

  def import_zip(self, path):
    mapping = {'tasks': 'tasks', 'agentConversations': 'conversations', 'favoriteCollections': 'collections', 'promptTemplates': 'prompts'}
    added = {'records': 0, 'images': 0}
    created = []
    with self._lock, zipfile.ZipFile(path) as archive, closing(self.connect()) as db:
      infos = archive.infolist()
      if len(infos) > 100000 or sum(item.file_size for item in infos) > 2 * 1024 ** 3:
        raise ValueError('备份超过允许大小，请使用分卷备份。')
      names = set()
      for item in infos:
        posix = PurePosixPath(item.filename)
        if item.filename in names or posix.is_absolute() or '..' in posix.parts or '\\' in item.filename or ':' in item.filename or (item.external_attr >> 16) & 0o170000 == 0o120000:
          raise ValueError('备份包含重复或不安全的文件路径。')
        names.add(item.filename)
      if 'manifest.json' not in names or archive.getinfo('manifest.json').file_size > 32 * 1024 ** 2:
        raise ValueError('备份清单缺失或过大。')
      manifest = json.loads(archive.read('manifest.json'))
      if not isinstance(manifest, dict) or manifest.get('version') not in (1, 2, 3):
        raise ValueError('不支持的备份格式。')
      records = []
      for key, kind in mapping.items():
        rows = manifest.get(key, [])
        if not isinstance(rows, list): raise ValueError('备份记录格式错误。')
        seen = set()
        for row in rows:
          if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or row['id'] in seen:
            raise ValueError('备份记录标识无效或重复。')
          seen.add(row['id'])
          old = db.execute('SELECT data FROM records WHERE kind=? AND id=?', (kind, row['id'])).fetchone()
          if old and json.loads(old[0]) != row:
            raise ValueError('导入与已有记录冲突；未覆盖数据。请使用空的原生数据目录进行恢复。')
          if not old: records.append((kind, row['id'], json.dumps(row, ensure_ascii=False)))
      files = manifest.get('imageFiles', {})
      if not isinstance(files, dict): raise ValueError('图片清单格式错误。')
      with tempfile.TemporaryDirectory(prefix='import-', dir=self.root) as staging:
        images = []
        for image_id, entry in files.items():
          if not isinstance(entry, dict) or not isinstance(image_id, str) or not image_id or not isinstance(entry.get('path'), str):
            raise ValueError('图片清单格式错误。')
          name = entry['path']
          if name not in names or not name.startswith('images/') or archive.getinfo(name).file_size > MAX_IMAGE_BYTES:
            raise ValueError('图片路径缺失或大小超限。')
          data = archive.read(name)
          fmt, width, height, _ = image_info(data)
          old = db.execute('SELECT path FROM images WHERE id=?', (image_id,)).fetchone()
          if old:
            if (self.root / old[0]).read_bytes() != data: raise ValueError('图片标识冲突；未覆盖原图。')
            continue
          relative = 'images/' + hashlib.sha256(image_id.encode('utf-8')).hexdigest() + '.' + fmt
          staged = Path(staging) / Path(relative).name
          staged.write_bytes(data)
          metadata = {**entry, 'id': image_id, 'width': width, 'height': height}
          metadata.pop('path', None)
          images.append((image_id, relative, json.dumps(metadata, ensure_ascii=False), staged))
        try:
          with db:
            for image_id, relative, metadata, staged in images:
              target = self.root / relative
              # 仅创建属于本次导入的新文件，事务失败只清理这些文件。
              with target.open('xb') as output:
                created.append(target)
                with staged.open('rb') as source:
                  import shutil
                  shutil.copyfileobj(source, output)
              db.execute('INSERT INTO images VALUES (?,?,?)', (image_id, relative, metadata))
            db.executemany('INSERT INTO records VALUES (?,?,?)', records)
            added = {'records': len(records), 'images': len(images), 'settingsSkipped': bool(manifest.get('settings'))}
        except BaseException:
          for target in created: target.unlink(missing_ok=True)
          raise
    return added
