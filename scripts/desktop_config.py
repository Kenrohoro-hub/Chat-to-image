"""桌面设置与动态主备方案。配置整体由当前 Windows 用户加密。"""

import base64
import json
import os
from pathlib import Path
import tempfile
import time
import ctypes
import hashlib
import uuid
from contextlib import contextmanager
from urllib.parse import urlsplit

from playground_config import config_path, local_data_dir, protect, read_snapshot, snapshot_key


@contextmanager
def route_lock():
  kernel = ctypes.WinDLL('kernel32', use_last_error=True)
  kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
  kernel.CreateMutexW.restype = ctypes.c_void_p
  kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
  kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
  kernel.CloseHandle.argtypes = [ctypes.c_void_p]
  scope = hashlib.sha256(str(desktop_path().parent.resolve()).casefold().encode('utf-8')).hexdigest()[:16]
  handle = kernel.CreateMutexW(None, False, 'Local\\PlaygroundRoutes-' + scope)
  if not handle:
    raise OSError('无法创建配置锁。')
  acquired = False
  try:
    acquired = kernel.WaitForSingleObject(handle, 10000) in (0, 128)
    if not acquired:
      raise OSError('配置正忙，请重试。')
    yield
  finally:
    if acquired:
      kernel.ReleaseMutex(handle)
    kernel.CloseHandle(handle)


def desktop_path():
  return config_path().with_name('desktop-settings.json')


class SettingsConflict(ValueError):
  pass


class SettingsUnreadable(ValueError):
  pass


def settings_revision():
  path = desktop_path()
  return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else '0'


def settings_snapshot():
  with route_lock():
    try:
      return {'settings': initial_settings(), 'revision': settings_revision()}
    except SettingsUnreadable:
      return {'settings': None, 'revision': settings_revision(),
              'error': '当前 Windows 环境无法解密已有 API 配置。原文件已保留，自动保存和生图已暂停。可回到保存配置的电脑和账户使用，或保留旧配置后重新填写 API。'}


def recover_settings(expected_revision):
  if not isinstance(expected_revision, str):
    raise ValueError('缺少配置版本，请重新加载设置。')
  with route_lock():
    if expected_revision != settings_revision():
      raise SettingsConflict('配置已在另一窗口更新，请重新打开工具。')
    try:
      read_desktop(True)
    except SettingsUnreadable:
      pass
    else:
      raise ValueError('当前配置可以读取，无需重新配置。')
    path = desktop_path()
    backup = path.with_name('desktop-settings.unreadable-' + uuid.uuid4().hex + '.json')
    path.rename(backup)
    try:
      return save_desktop({'profiles': [{'id': 'local-reset', 'provider': 'openai', 'apiMode': 'images'}]}, '0')
    except BaseException:
      os.replace(backup, path)
      raise


def write_json(path, value):
  path.parent.mkdir(parents=True, exist_ok=True)
  with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as file:
    temporary = Path(file.name)
    json.dump(value, file, ensure_ascii=False)
    file.flush()
    os.fsync(file.fileno())
  try:
    os.replace(temporary, path)
  finally:
    temporary.unlink(missing_ok=True)


def read_desktop(decrypt=False):
  if not desktop_path().exists():
    return None
  record = json.loads(desktop_path().read_text(encoding='utf-8'))
  if record.get('version') != 1:
    raise ValueError('桌面配置版本不支持。')
  if decrypt:
    blob = base64.b64decode(record['encrypted'], validate=True)
    try:
      decrypted = protect(blob, decrypt=True)
    except ValueError:
      raise SettingsUnreadable('当前 Windows 环境无法解密已有 API 配置。') from None
    return json.loads(decrypted)
  return record


def initial_settings():
  settings = read_desktop(True)
  if settings is not None:
    return settings
  snapshot = read_snapshot()
  if not snapshot or snapshot.get('error'):
    return None
  profile = {**snapshot['profile'], 'apiKey': snapshot_key(snapshot)}
  profile['id'] = profile.get('id') or 'imported-browser'
  # 同步快照已规范化地址，尾斜杠防止网页再次追加版本前缀。
  profile['baseUrl'] = profile['baseUrl'].rstrip('/') + '/'
  return {'profiles': [profile], 'activeProfileId': profile['id'],
          'failover': {'enabled': True, 'primaryId': profile['id'], 'slots': [profile['id']], 'disabledIds': []}}


def save_desktop(settings, expected_revision=None):
  if not isinstance(settings, dict) or not isinstance(settings.get('profiles'), list):
    raise ValueError('设置格式错误。')
  profiles = settings['profiles']
  if not profiles or any(not isinstance(p, dict) or not isinstance(p.get('id'), str) for p in profiles):
    raise ValueError('API 配置格式错误。')
  if len({p['id'] for p in profiles}) != len(profiles):
    raise ValueError('API 配置 ID 不能重复。')
  for mode, label in [('images', '画廊'), ('responses', 'Agent')]:
    if sum(p.get('provider') == 'openai' and p.get('apiMode') == mode for p in profiles) > 10:
      raise ValueError(f'{label}最多添加 10 套 API 配置（含停用项）。')
  pool = settings.get('failover') or {}
  if not isinstance(pool, dict):
    raise ValueError('主备池格式错误。')
  slots = pool.get('slots', [])
  if not isinstance(slots, list) or any(not isinstance(s, str) for s in slots) or len(slots) > 10 or len(set(slots)) != len(slots):
    raise ValueError('主备池最多包含十套不同配置。')
  known = {p['id'] for p in profiles}
  if any(p not in known for p in slots) or (slots and pool.get('primaryId') not in slots):
    raise ValueError('主用和备用配置必须存在。')
  disabled = pool.get('disabledIds', [])
  if not isinstance(disabled, list) or any(p not in slots for p in disabled):
    raise ValueError('停用方案必须属于主备池。')
  agent_pool = settings.get('agentFailover') or {}
  if not isinstance(agent_pool, dict):
    raise ValueError('Agent 主备池格式错误。')
  agent_slots = agent_pool.get('slots', [])
  agent_disabled = agent_pool.get('disabledIds', [])
  if not isinstance(agent_slots, list) or any(not isinstance(p, str) or p not in known for p in agent_slots) or len(agent_slots) > 10 or len(set(agent_slots)) != len(agent_slots):
    raise ValueError('Agent 主备池最多包含十套不同的已有配置。')
  if agent_slots and agent_pool.get('primaryId') not in agent_slots:
    raise ValueError('Agent 主用配置必须属于 Agent 主备池。')
  if not isinstance(agent_disabled, list) or any(p not in agent_slots for p in agent_disabled):
    raise ValueError('Agent 停用方案必须属于 Agent 主备池。')
  if any(p['id'] in agent_slots and (p.get('provider') != 'openai' or p.get('apiMode') != 'responses') for p in profiles):
    raise ValueError('Agent 主备池只支持 OpenAI 兼容 Responses API。')
  metadata = []
  for profile in profiles:
    for field in ('id', 'name', 'provider', 'baseUrl', 'model', 'apiMode', 'apiKey'):
      if not isinstance(profile.get(field, ''), str):
        raise ValueError('配置字段类型错误。')
    if 'models' in profile and (not isinstance(profile['models'], list) or any(not isinstance(model, str) for model in profile['models'])):
      raise ValueError('模型列表格式错误。')
    raw = profile.get('baseUrl', '')
    url = urlsplit(raw if '://' in raw else 'https://' + raw)
    if url.username or url.password or url.query or url.fragment:
      raise ValueError('API 地址不能包含账号、密码、查询参数或片段，请将密钥填入 Key 字段。')
    if profile['id'] in slots and (profile.get('provider') != 'openai' or profile.get('apiMode') != 'images' or profile.get('codexCli') or profile.get('apiProxy') or profile.get('streamImages')):
      raise ValueError('主备池只支持标准 OpenAI 兼容 Images API。')
    # 非敏感路由信息用于 dry-run，不读取或解密 Key。
    metadata.append({**{field: profile.get(field) for field in (
      'id', 'name', 'provider', 'baseUrl', 'model', 'models', 'apiMode', 'codexCli', 'apiProxy',
      'timeout', 'responseFormatB64Json', 'streamImages', 'transparentBackgroundMethod', 'imageCapabilities',
    )}, 'hasKey': bool(profile.get('apiKey', '').strip())})
  blob = json.dumps(settings, ensure_ascii=False).encode('utf-8')
  if len(blob) > 2 * 1024 * 1024:
    raise ValueError('设置超过 2 MiB。')
  record = {'version': 1, 'profiles': metadata, 'activeProfileId': settings.get('activeProfileId'),
            'failover': pool, 'encrypted': base64.b64encode(protect(blob)).decode('ascii')}
  with route_lock():
    if expected_revision is not None and expected_revision != settings_revision():
      raise SettingsConflict('配置已在另一窗口更新。未覆盖新配置，当前草稿已保留；请关闭设置后重新打开，再应用修改。')
    previous = read_desktop(True)
    write_json(desktop_path(), record)
    if previous:
      old = {p['id']: p for p in previous['profiles']}
      changed = {p['id'] for p in profiles if p != old.get(p['id'])}
      state = route_state()
      state['failed'] = {k: v for k, v in state['failed'].items() if k in known and k not in changed}
      write_json(local_data_dir() / 'route-state.json', state)
    revision = settings_revision()
  return {'ok': True, 'revision': revision}


def route_state():
  path = local_data_dir() / 'route-state.json'
  try:
    return json.loads(path.read_text(encoding='utf-8'))
  except (OSError, ValueError):
    return {'failed': {}, 'events': []}


def report_route(profile_id, success, reason=''):
  with route_lock():
    state = route_state()
    if success:
      state['failed'].pop(profile_id, None)
      state['lastUsedId'] = profile_id
    else:
      state['failed'][profile_id] = time.time() + 300
    state['events'] = (state.get('events', []) + [{'time': time.time(), 'profileId': profile_id,
      'ok': success, 'reason': reason[:80]}])[-30:]
    write_json(local_data_dir() / 'route-state.json', state)


def candidates(selected_id=None, model=None):
  record = read_desktop()
  if not record:
    return []
  pool = record.get('failover') or {}
  slots = pool.get('slots', [])
  selected_id = selected_id or pool.get('primaryId') or record.get('activeProfileId')
  ids = [selected_id]
  if selected_id in slots:
    primary = pool.get('primaryId')
    ids = [primary] + ([item for item in slots if item != primary] if pool.get('enabled') else [])
    ids = [item for item in ids if item not in pool.get('disabledIds', [])]
  profiles = {p['id']: p for p in record['profiles']}
  eligible = [profiles[item] for item in ids if item in profiles and
    profiles[item].get('provider') == 'openai' and profiles[item].get('apiMode') == 'images' and
    not profiles[item].get('codexCli') and not profiles[item].get('apiProxy') and not profiles[item].get('streamImages')]
  if model:
    eligible = [p for p in eligible if model in (p.get('models') or [p.get('model')])]
  failed = route_state().get('failed', {})
  ready = [p for p in eligible if failed.get(p['id'], 0) <= time.time()]
  cooling = [p for p in eligible if p not in ready]
  return ready + cooling


def profile_key(profile, model=None):
  settings = read_desktop(True)
  current = next((p for p in settings['profiles'] if p['id'] == profile['id']), None)
  if not current or any(current.get(k) != profile.get(k) for k in ('baseUrl', 'model', 'provider', 'apiMode')):
    raise ValueError('配置在请求前发生变化，请重新提交。')
  if model and model not in (current.get('models') or [current.get('model')]):
    raise ValueError('所选模型已从此方案停用，请重新选择。')
  return current.get('apiKey', '').strip()


def normalize_url(raw):
  from urllib.parse import urlsplit, urlunsplit
  import ipaddress
  if not raw.strip():
    raise ValueError('API 地址为空。')
  url = urlsplit(raw if '://' in raw else 'https://' + raw)
  _ = url.port
  if not url.hostname or url.username or url.password or url.query or url.fragment:
    raise ValueError('API 地址格式错误。')
  try:
    local = ipaddress.ip_address(url.hostname).is_loopback
  except ValueError:
    local = url.hostname.lower() == 'localhost'
  if url.scheme != 'https' and not (url.scheme == 'http' and local):
    raise ValueError('远程 API 必须使用 HTTPS。')
  parts = [part for part in url.path.split('/') if part]
  if not raw.endswith('/'):
    parts = parts[:parts.index('v1') + 1] if 'v1' in parts else parts + ['v1']
  return urlunsplit(url._replace(path='/' + '/'.join(parts))).rstrip('/')
