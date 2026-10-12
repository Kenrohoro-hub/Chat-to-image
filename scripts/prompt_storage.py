"""提示词库的本机目录、受管文件与先复制后切换。"""
import base64
from contextlib import contextmanager
import ctypes
import hashlib
import json
import logging
import msvcrt
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import threading
import uuid

from desktop_config import write_json
from playground_config import local_data_dir
from ui_language import t

SOURCES = {'personal': '个人提示词', 'garden': '水仙', 'promptfill': 'PromptFill', 'youmind': 'YouMind', 'pixto': 'PixtoAI', 'nanoimage': 'NanoPrompts GPT-2', 'nano': 'NanoPrompts', 'hero': 'HeroPrompt'}
MIMES = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif'}
MIGRATIONS = {}
LOCK = threading.RLock()


def checked(path):
  for part in (path, *path.parents):
    if part.is_symlink() or (part.exists() and getattr(part.lstat(), 'st_file_attributes', 0) & 0x400):
      raise ValueError(t('提示词目录不能包含符号链接或重解析点。', 'The prompt folder cannot contain symbolic links or reparse points.'))
  return path


@contextmanager
def locked():
  with LOCK:
    path = checked(local_data_dir() / 'prompt-storage.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
      if not handle.tell():
        handle.write(b'0')
        handle.flush()
      handle.seek(0)
      try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
      except OSError:
        raise ValueError(t('提示词文件操作正忙，请稍后重试。', 'Prompt files are busy. Try again shortly.')) from None
      try:
        yield
      finally:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def read_json(path, fallback=None):
  checked(path)
  if not path.exists():
    return fallback
  if path.stat().st_size > 128 * 1024 * 1024:
    raise ValueError(t('提示词文件过大，无法读取。', 'The prompt file is too large to read.'))
  try:
    return json.loads(path.read_text(encoding='utf-8'))
  except (UnicodeError, json.JSONDecodeError):
    raise ValueError(t('提示词文件格式损坏，原文件已保留。', 'The prompt file is damaged. The original file was kept.')) from None


def setting():
  value = read_json(local_data_dir() / 'prompt-storage.json', {})
  if not isinstance(value, dict) or not isinstance(value.get('directory', ''), str):
    raise ValueError(t('提示词保存位置配置损坏。', 'The prompt storage location settings are damaged.'))
  return value.get('directory', '')


def root_path(directory):
  path = Path(directory)
  if not path.is_absolute():
    raise ValueError(t('请选择绝对路径。', 'Choose an absolute path.'))
  checked(path)
  if read_json(path / '.prompt-library.json') != {'format': 1}:
    raise ValueError(t('提示词目录不可用或归属标记缺失，请检查保存位置。', 'The prompt folder is unavailable or its ownership marker is missing. Check the storage location.'))
  return path


def fingerprint(root):
  paths = [root / '偏好.json'] + [folder(root, source) / name for source in SOURCES for name in ('目录.json', '图片索引.json')]
  return [hashlib.sha256(checked(path).read_bytes()).hexdigest() if path.exists() else None for path in paths]


def category_name(name):
  clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:72]
  if not clean or clean.split('.')[0].upper() in ('CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))):
    clean = '分类'
  return clean + '--' + hashlib.sha256(name.encode()).hexdigest()[:8]


def folder(root, source):
  if source not in SOURCES:
    raise ValueError(t('未知提示词库。', 'Unknown prompt library.'))
  return checked(root / SOURCES[source])


def catalog(root, source):
  value = read_json(folder(root, source) / '目录.json')
  if value is not None and (not isinstance(value, dict) or not isinstance(value.get('items'), list) or not isinstance(value.get('revision'), str)):
    raise ValueError(t('提示词目录文件格式错误。', 'Invalid prompt catalog file format.'))
  return value


def image_index(root, source):
  value = read_json(folder(root, source) / '图片索引.json', {})
  if not isinstance(value, dict):
    raise ValueError(t('图片索引格式错误。', 'Invalid image index format.'))
  return value


def image_path(root, source, url, entry):
  if not isinstance(entry, dict) or entry.get('mime') not in MIMES or not isinstance(entry.get('path'), str):
    raise ValueError(t('图片索引格式错误。', 'Invalid image index format.'))
  parts = PurePosixPath(entry['path']).parts
  expected = hashlib.sha256(url.encode()).hexdigest() + MIMES[entry['mime']]
  if len(parts) != 3 or not re.fullmatch(r'[^<>:"/\\|?*\x00-\x1f]+--[a-f0-9]{8}', parts[0]) or parts[1] != '图片' or parts[2] != expected or parts[0] in ('.', '..'):
    raise ValueError(t('图片索引包含非法路径。', 'The image index contains an invalid path.'))
  return checked(folder(root, source).joinpath(*parts))


def image_urls(root, source):
  return [url for url, entry in image_index(root, source).items() if image_path(root, source, url, entry).is_file()]


def find_image(root, url):
  if not isinstance(url, str) or len(url) > 8192:
    raise ValueError(t('图片地址格式错误。', 'Invalid image URL.'))
  for source in SOURCES:
    entry = image_index(root, source).get(url)
    if entry:
      path = image_path(root, source, url, entry)
      if path.is_file():
        return path, entry['mime']
  return None


def put_image(root, source, payload):
  url, data = payload.get('url'), payload.get('dataUrl')
  category = payload.get('category') or '未分类'
  if not isinstance(url, str) or not url.startswith('https://') or len(url) > 8192 or not isinstance(category, str) or len(category) > 200 or not isinstance(data, str):
    raise ValueError(t('图片数据格式错误。', 'Invalid image data format.'))
  match = re.fullmatch(r'data:(image/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=]+)', data)
  if not match or len(data) > 45 * 1024 * 1024:
    raise ValueError(t('图片格式不支持或超过 32 MB。', 'Unsupported image format or image exceeds 32 MB.'))
  try:
    raw = base64.b64decode(match[2], validate=True)
  except ValueError:
    raise ValueError(t('图片编码错误。', 'Invalid image encoding.')) from None
  if not raw or len(raw) > 32 * 1024 * 1024:
    raise ValueError(t('图片为空或超过 32 MB。', 'The image is empty or exceeds 32 MB.'))
  entry = {'path': f'{category_name(category)}/图片/{hashlib.sha256(url.encode()).hexdigest()}{MIMES[match[1]]}', 'mime': match[1]}
  path = image_path(root, source, url, entry)
  path.parent.mkdir(parents=True, exist_ok=True)
  temporary = checked(path.with_suffix('.' + uuid.uuid4().hex + '.tmp'))
  try:
    temporary.write_bytes(raw)
    os.replace(temporary, path)
  finally:
    temporary.unlink(missing_ok=True)
  index = image_index(root, source)
  index[url] = entry
  write_json(checked(folder(root, source) / '图片索引.json'), index)


def preserve_personal_images(root, items):
  existing = set(image_urls(root, 'personal'))
  for item in items:
    url = item.get('previewUrl')
    if not isinstance(url, str) or url in existing:
      continue
    found = find_image(root, url)
    if not found:
      continue
    path, mime = found
    if path.stat().st_size > 32 * 1024 * 1024:
      raise ValueError(t('收藏图片超过 32 MB。', 'The favorited image exceeds 32 MB.'))
    put_image(root, 'personal', {'url': url, 'category': item.get('category'), 'dataUrl': f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')})
    existing.add(url)


def write_catalog(root, source, payload, migrating=False):
  items = payload.get('items')
  if not isinstance(items, list) or len(items) > 200000:
    raise ValueError(t('提示词目录格式错误或条目过多。', 'Invalid prompt catalog format or too many entries.'))
  previous = catalog(root, source)
  if source == 'personal' and not migrating and payload.get('revision') != (previous or {}).get('revision', ''):
    raise ValueError(t('个人提示词已在其他窗口变化，请重新打开工具后再修改。', 'Personal prompts changed in another window. Reopen the app before editing.'))
  prompt_categories = payload.get('promptCategories')
  if source == 'personal' and 'promptCategories' in payload and (
    not isinstance(prompt_categories, list)
    or not prompt_categories
    or any(not isinstance(name, str) or not name or name != name.strip() or len(name) > 200 for name in prompt_categories)
    or len(prompt_categories) != len(set(prompt_categories))
  ):
    raise ValueError(t('个人提示词主题分类格式错误。', 'Invalid personal prompt category format.'))
  groups, ids = {}, set()
  for item in items:
    if not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key].strip() for key in ('id', 'title', 'content')) or item['id'] in ids:
      raise ValueError(t('提示词条目格式错误或标识重复。', 'Invalid prompt entry or duplicate ID.'))
    ids.add(item['id'])
    category = item.get('category') or '未分类'
    if not isinstance(category, str) or len(category) > 200:
      raise ValueError(t('提示词分类格式错误。', 'Invalid prompt category format.'))
    groups.setdefault(category, []).append(item)
  updated = payload.get('updatedAt', 0)
  if type(updated) not in (int, float) or not 0 <= updated < 1e16:
    raise ValueError(t('提示词更新时间错误。', 'Invalid prompt update time.'))
  version = payload.get('examplesVersion', 0)
  if type(version) is not int or not 0 <= version <= 1000000:
    raise ValueError(t('示例版本格式错误。', 'Invalid example version.'))
  if source == 'personal':
    preserve_personal_images(root, items)
  for name, rows in groups.items():
    write_json(checked(folder(root, source) / category_name(name) / '提示词.json'), {'category': name, 'items': rows})
  obsolete = {item.get('category') or '未分类' for item in (previous or {}).get('items', [])} - set(groups)
  paths = [checked(folder(root, source) / category_name(name) / '提示词.json') for name in obsolete]
  if source == 'personal':
    index = image_index(root, source)
    keep = {item.get('previewUrl') for item in items}
    paths += [image_path(root, source, url, entry) for url, entry in index.items() if url not in keep]
  value = {'examplesVersion': version, 'examplesAdded': payload.get('examplesAdded') is True, 'items': items, 'updatedAt': updated, 'cleared': payload.get('cleared') is True, 'revision': uuid.uuid4().hex}
  if source == 'personal':
    if 'promptCategories' in payload:
      value['promptCategories'] = prompt_categories
    elif 'promptCategories' in (previous or {}):
      value['promptCategories'] = previous['promptCategories']
  write_json(checked(folder(root, source) / '目录.json'), value)
  # 主数据成功保存后才清理旧文件；清理失败不把已完成的保存误报为失败。
  try:
    recycle(paths)
    if source == 'personal':
      write_json(checked(folder(root, source) / '图片索引.json'), {url: entry for url, entry in index.items() if url in keep})
  except (OSError, ValueError):
    logging.warning('Prompt catalog saved; obsolete files could not be cleaned up')
  return value


def preferences(root, payload=None):
  if payload is not None:
    if not isinstance(payload, dict) or not isinstance(payload.get('removed'), list) or any(source not in SOURCES or source == 'personal' for source in payload['removed']) or type(payload.get('examplesAdded')) is not bool:
      raise ValueError(t('提示词库偏好格式错误。', 'Invalid prompt library preferences format.'))
    write_json(checked(root / '偏好.json'), payload)
  value = read_json(root / '偏好.json', {'removed': [], 'examplesAdded': False})
  if not isinstance(value, dict) or not isinstance(value.get('removed'), list) or type(value.get('examplesAdded')) is not bool:
    raise ValueError(t('提示词库偏好文件损坏。', 'The prompt library preferences file is damaged.'))
  return value


def recycle(paths):
  paths = [path for path in paths if path.exists()]
  if not paths:
    return
  class FileOperation(ctypes.Structure):
    _fields_ = [('hwnd', ctypes.c_void_p), ('wFunc', ctypes.c_uint), ('pFrom', ctypes.c_wchar_p), ('pTo', ctypes.c_wchar_p), ('fFlags', ctypes.c_ushort), ('fAnyOperationsAborted', ctypes.c_int), ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', ctypes.c_wchar_p)]
  names = '\0'.join(str(checked(path)) for path in paths if path.exists()) + '\0\0'
  operation = FileOperation(None, 3, names, None, 0x40 | 0x10 | 0x4 | 0x400, 0, None, None)
  result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
  if result or operation.fAnyOperationsAborted:
    raise ValueError(t('部分提示词文件未能移入回收站，原目录保留，请重试。', 'Some prompt files could not be moved to the Recycle Bin. The original folder was kept; try again.'))


def verified_previous_files(directory, target):
  root = root_path(directory)
  paths = [root / '偏好.json']
  for source in SOURCES:
    base = folder(root, source)
    saved = catalog(root, source)
    paths.extend([base / '目录.json', base / '图片索引.json'])
    for item in (saved or {}).get('items', []):
      if not isinstance(item, dict) or not isinstance(item.get('category') or '未分类', str):
        raise ValueError(t('原目录中的分类属性无效。', 'Invalid category metadata in the original folder.'))
      paths.append(base / category_name(item.get('category') or '未分类') / '提示词.json')
    paths.extend(image_path(root, source, url, entry) for url, entry in image_index(root, source).items())
  paths = list(dict.fromkeys(checked(path) for path in paths if path.exists()))
  # 清理前逐个核对副本，避免复制期间外部修改的图片或分类文件丢失。
  for path in paths:
    copied = checked(target / path.relative_to(root))
    if not path.is_file() or not copied.is_file():
      raise ValueError(t('原文件与新位置副本不一致。', 'The copy at the new location does not match the original.'))
    with path.open('rb') as original, copied.open('rb') as saved:
      hashes = []
      for handle in (original, saved):
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(1024 * 1024), b''):
          digest.update(block)
        hashes.append(digest.digest())
      if hashes[0] != hashes[1]:
        raise ValueError(t('原文件在复制后有变化。', 'The original file changed during copying.'))
  return paths


def clean_previous_directory(directory, paths):
  root = root_path(directory)
  recycle(paths)
  recycle([checked(root / '.prompt-library.json')])
  directories = {root, *(parent for path in paths for parent in path.parents if parent == root or root in parent.parents)}
  for path in sorted(directories, key=lambda item: len(item.parts), reverse=True):
    checked(path)
    if path.is_dir() and not any(path.iterdir()):
      path.rmdir()
  return t('新位置已启用，原位置的登记文件已清理；其他文件仍保留在原目录。', 'The new location is active and registered files were cleaned up; other files remain in the original folder.') if root.exists() else t('新位置已启用，原位置的登记文件已清理。', 'The new location is active and registered files were cleaned up.')


def dispatch(action, payload):
  if not isinstance(payload, dict):
    raise ValueError(t('提示词存储参数错误。', 'Invalid prompt storage options.'))
  with locked():
    directory = setting()
    if action == 'status':
      root = root_path(directory) if directory else None
      return {'directory': directory, 'preferences': preferences(root) if root else None}
    if action == 'prepare':
      parent = payload.get('directory')
      if not isinstance(parent, str) or not Path(parent).is_absolute():
        raise ValueError(t('请选择保存位置的绝对路径。', 'Choose an absolute path for the storage location.'))
      parent = checked(Path(parent))
      target = checked(parent / '提示词库')
      if directory and target == Path(directory):
        raise ValueError(t('已经在使用这个目录。', 'This folder is already in use.'))
      if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError(t('目标位置的“提示词库”文件夹非空，请选择其他位置，已有文件不会覆盖。', 'The target Prompt Library folder is not empty. Choose another location; existing files will not be overwritten.'))
      current = root_path(directory) if directory else None
      if current and (parent == current or current in parent.parents):
        raise ValueError(t('新位置不能放在当前提示词库里面。', 'The new location cannot be inside the current prompt library.'))
      parent.mkdir(parents=True, exist_ok=True)
      token = uuid.uuid4().hex
      stage = checked(parent / ('.prompt-library-' + token))
      stage.mkdir()
      try:
        if current:
          for path in current.rglob('*'):
            checked(path)
          def copy(source, destination):
            return shutil.copy2(checked(Path(source)), checked(Path(destination)))
          shutil.copytree(current, stage, dirs_exist_ok=True, copy_function=copy)
        write_json(stage / '.prompt-library.json', {'format': 1})
      except Exception:
        shutil.rmtree(stage)
        raise
      MIGRATIONS[token] = {'stage': stage, 'target': target, 'previous': directory, 'fingerprint': fingerprint(current) if current else None}
      return {'migration': token, 'directory': str(target), 'temporaryDirectory': str(stage)}
    migration = payload.get('migration')
    session = MIGRATIONS.get(migration) if isinstance(migration, str) else None
    if migration and not session:
      raise ValueError(t('目录迁移会话已失效，请重试。', 'The folder migration session expired. Try again.'))
    if action in ('commit', 'abort'):
      if not session:
        raise ValueError(t('没有可用的目录迁移。', 'No folder migration is available.'))
      stage, target = checked(session['stage']), checked(session['target'])
      if action == 'abort':
        for path in stage.rglob('*'):
          checked(path)
        shutil.rmtree(stage)
        del MIGRATIONS[migration]
        return {'ok': True}
      if directory != session['previous'] or (target.exists() and any(target.iterdir())):
        raise ValueError(t('保存位置已变化或目标目录被占用，未切换。', 'The storage location changed or the target folder is in use. The location was not changed.'))
      if directory and fingerprint(root_path(directory)) != session['fingerprint']:
        raise ValueError(t('原提示词库在复制期间有更新，请重试；保存位置未切换。', 'The original prompt library changed during copying. Try again; the storage location was not changed.'))
      if catalog(stage, 'personal') is None:
        raise ValueError(t('个人提示词尚未复制，未切换保存位置。', 'Personal prompts were not copied. The storage location was not changed.'))
      if not directory:
        preferences(stage, payload.get('preferences'))
      for source in SOURCES:
        catalog(stage, source)
        for url, entry in image_index(stage, source).items():
          if not image_path(stage, source, url, entry).is_file():
            raise ValueError(t('复制后的图片缺失，未切换保存位置。', 'An image is missing from the copy. The storage location was not changed.'))
      cleanup_paths = verified_previous_files(directory, stage) if payload.get('cleanPrevious') is True and directory else None
      saved_preferences = preferences(stage)
      if target.exists():
        target.rmdir()
      os.replace(stage, target)
      try:
        write_json(checked(local_data_dir() / 'prompt-storage.json'), {'directory': str(target)})
      except OSError:
        os.replace(target, stage)
        raise
      del MIGRATIONS[migration]
      message = t('保存位置已切换，旧位置的数据保留。', 'The storage location was changed. Data at the old location was kept.')
      if payload.get('cleanPrevious') is True and session['previous']:
        try:
          message = clean_previous_directory(session['previous'], cleanup_paths)
        except Exception:
          logging.warning('Prompt directory switched; previous files could not be fully cleaned up')
          message = t('新位置已启用，但原位置清理未完成，可能有部分文件已移入回收站；请检查原目录：', 'The new location is active, but cleanup of the old location did not finish. Some files may have been moved to the Recycle Bin. Check the original folder: ') + session['previous']
      return {'directory': str(target), 'preferences': saved_preferences, 'message': message}
    if not session and (not directory or payload.get('directory') != directory):
      raise ValueError(t('提示词保存位置已变化，请重新打开工具。', 'The prompt storage location changed. Reopen the app.'))
    root = root_path(str(session['stage']) if session else directory)
    source = payload.get('source')
    if action == 'catalog_read':
      return {'catalog': catalog(root, source), 'images': image_urls(root, source)}
    if action == 'catalog_write':
      return {'catalog': write_catalog(root, source, payload, bool(session)), 'images': image_urls(root, source)}
    if action == 'image_write':
      put_image(root, source, payload)
      return {'ok': True}
    if action == 'image_read':
      found = find_image(root, payload.get('url'))
      if not found:
        return {'dataUrl': None}
      path, mime = found
      if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError(t('图片超过 32 MB。', 'The image exceeds 32 MB.'))
      return {'dataUrl': f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')}
    if action == 'preferences':
      return preferences(root, payload.get('preferences'))
    if action == 'clear':
      if source == 'personal':
        raise ValueError(t('请通过个人提示词操作删除个人内容。', 'Delete personal content through Personal prompts.'))
      saved = catalog(root, 'personal')
      if saved:
        preserve_personal_images(root, saved['items'])
      previous = catalog(root, source)
      paths = [image_path(root, source, url, entry) for url, entry in image_index(root, source).items()]
      if previous:
        paths += [checked(folder(root, source) / category_name(item.get('category') or '未分类') / '提示词.json') for item in previous['items']]
      recycle(list(dict.fromkeys(paths)))
      write_json(checked(folder(root, source) / '图片索引.json'), {})
      write_catalog(root, source, {'items': [], 'updatedAt': 0, 'cleared': True})
      return {'ok': True}
    raise ValueError(t('未知提示词存储操作。', 'Unknown prompt storage operation.'))
