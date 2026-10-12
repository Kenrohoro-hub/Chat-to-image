"""网页与命令行共享的本机配置；密钥使用当前 Windows 用户的 DPAPI 加密。"""

import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit, urlunsplit

from ui_language import t


def project_id():
  root = str(Path(__file__).resolve().parent.parent).casefold()
  return hashlib.sha256(root.encode('utf-8')).hexdigest()[:16]


def local_data_dir():
  local = os.environ.get('LOCALAPPDATA')
  if not local:
    raise ValueError(t('缺少 Windows 本机用户目录，无法读取同步配置。', 'The local Windows user directory is unavailable, so synced settings cannot be read.'))
  return Path(local) / 'GPTImagePlayground' / project_id()


def config_path():
  directory = os.environ.get('PLAYGROUND_CONFIG_DIR')
  root = Path(directory).expanduser().resolve() if directory else Path(__file__).resolve().parent.parent / 'user-config'
  return root / 'codex-profile.json'


def protect(data, decrypt=False):
  if os.name != 'nt':
    raise ValueError(t('网页密钥同步目前需要 Windows DPAPI。', 'Syncing web API keys currently requires Windows DPAPI.'))

  class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

  buffer = ctypes.create_string_buffer(data)
  source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
  target = Blob()
  crypt = ctypes.WinDLL('crypt32', use_last_error=True)
  kernel = ctypes.WinDLL('kernel32', use_last_error=True)
  fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
  fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
  fn.restype = wintypes.BOOL
  kernel.LocalFree.argtypes = [ctypes.c_void_p]
  kernel.LocalFree.restype = ctypes.c_void_p
  if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
    raise ValueError(t('无法加密或解密同步密钥，请在当前 Windows 账户中重新同步网页配置。', 'Could not encrypt or decrypt the synced key. Sync the web settings again in the current Windows account.'))
  try:
    return ctypes.string_at(target.data, target.size)
  finally:
    kernel.LocalFree(target.data)


def read_snapshot():
  path = config_path()
  if not path.exists():
    return None
  record = json.loads(path.read_text(encoding='utf-8'))
  if not isinstance(record, dict) or record.get('version') != 1 or not isinstance(record.get('profile'), dict):
    raise ValueError(t('同步配置损坏，请刷新已配置 API 的网页重新同步。', 'Synced settings are damaged. Refresh the web app with the configured API to sync again.'))
  return record


def snapshot_status(record):
  if not record:
    return {'synced': False, 'message': t('请在原来配置过 API 的浏览器中刷新 Chat to image 网页。', 'Refresh Chat to image in the browser where the API was configured.')}
  profile = record['profile']
  return {
    'synced': not bool(record.get('error')) and bool(record.get('encryptedKey')),
    'name': profile.get('name', ''), 'baseUrl': profile.get('baseUrl', ''),
    'model': profile.get('model', ''), 'provider': profile.get('provider', ''),
    'message': record.get('error') or t('网页配置已同步到 Codex。', 'Web settings are synced with Codex.'),
  }


def save_profile(value):
  if not isinstance(value, dict):
    raise ValueError(t('profile 必须是对象。', 'profile must be an object.'))
  fields = ('id', 'name', 'provider', 'baseUrl', 'model', 'apiMode')
  if any(not isinstance(value.get(field, ''), str) for field in fields):
    raise ValueError(t('配置字段类型错误。', 'Invalid configuration field type.'))
  profile = {field: value.get(field, '').strip() for field in fields}
  profile['provider'] = profile['provider'] or 'openai'
  profile['apiMode'] = profile['apiMode'] or 'images'
  profile['responseFormatB64Json'] = value.get('responseFormatB64Json') is True
  profile['streamImages'] = value.get('streamImages') is True
  key = value.get('apiKey', '')
  if not isinstance(key, str) or len(key) > 16384:
    raise ValueError(t('密钥字段格式错误。', 'Invalid API key format.'))
  key = key.strip()
  error = ''
  if profile['provider'] != 'openai' or profile['apiMode'] != 'images' or value.get('codexCli') or value.get('apiProxy'):
    error = t('当前网页配置使用特殊供应商、Responses、Codex CLI 或代理模式，命令行入口尚不支持；未沿用之前的配置。', 'This web profile uses a custom provider, Responses, Codex CLI, or proxy mode, which the CLI does not support. The previous settings were not reused.')
  elif not profile['baseUrl'] or not profile['model'] or not key:
    error = t('当前网页配置缺少服务地址、模型或 Key；请在网页设置中补齐。', 'The web profile is missing a service URL, model, or API key. Complete it in web settings.')
  elif '\n' in key or '\r' in key:
    error = t('当前网页 Key 含有换行，请在网页设置中修正。', 'The web API key contains a line break. Correct it in web settings.')
  else:
    # 与 src/lib/devProxy.ts 的浏览器路径补齐规则一致。
    raw = profile['baseUrl']
    try:
      url = urlsplit(raw if '://' in raw else 'https://' + raw)
    except ValueError:
      url = urlsplit('')
    if not url.hostname or url.username or url.password or url.query or url.fragment:
      error = t('服务地址应不含用户名、密码、查询参数或片段。', 'The service URL must not contain a username, password, query, or fragment.')
    else:
      segments = [part for part in url.path.split('/') if part]
      if not raw.endswith('/'):
        segments = segments[:segments.index('v1') + 1] if 'v1' in segments else segments + ['v1']
      profile['baseUrl'] = urlunsplit((url.scheme, url.netloc, '/' + '/'.join(segments), '', '')).rstrip('/')
      # 延迟导入，避免命令行入口与共享配置模块循环初始化。
      from playground_image import checked_url, CallError
      try:
        checked_url(profile['baseUrl'])
      except CallError:
        error = t('服务地址格式错误；远程接口要求 HTTPS。', 'Invalid service URL. Remote APIs require HTTPS.')
  if error:
    # 不把有问题的 URL（可能含用户误填的凭据）写进状态响应或配置文件。
    profile['baseUrl'] = ''
  record = {'version': 1, 'profile': profile, 'error': error}
  if not error:
    # 将地址与密钥一起加密，阻止明文元数据被误改后把密钥发到另一个地址。
    secret = json.dumps({'baseUrl': profile['baseUrl'], 'model': profile['model'], 'apiKey': key}).encode('utf-8')
    record['encryptedKey'] = base64.b64encode(protect(secret)).decode('ascii')
  path = config_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  temp = None
  try:
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, suffix='.tmp', delete=False) as file:
      temp = Path(file.name)
      json.dump(record, file, ensure_ascii=False)
      file.flush()
      os.fsync(file.fileno())
    os.replace(temp, path)
  finally:
    if temp and temp.exists():
      temp.unlink()
  return snapshot_status(record)


def snapshot_key(record):
  if record.get('error'):
    raise ValueError(record['error'])
  if not isinstance(record.get('encryptedKey'), str):
    raise ValueError(t('同步密钥缺失，请刷新网页重新同步。', 'The synced key is missing. Refresh the web app to sync again.'))
  secret = json.loads(protect(base64.b64decode(record['encryptedKey'], validate=True), decrypt=True))
  if not isinstance(secret, dict) or not isinstance(secret.get('apiKey'), str):
    raise ValueError(t('同步密钥格式错误，请刷新网页重新同步。', 'The synced key has an invalid format. Refresh the web app to sync again.'))
  if any(secret.get(field) != record['profile'].get(field) for field in ('baseUrl', 'model')):
    raise ValueError(t('同步配置地址或模型已改变，请从网页重新同步。', 'The API URL or model in synced settings changed. Sync again from the web app.'))
  return secret['apiKey']


if __name__ == '__main__':
  import sys
  sys.stdout.reconfigure(encoding='utf-8')
  try:
    from desktop_config import read_desktop, candidates
    desktop = read_desktop()
    if desktop:
      profiles = candidates()
      status = {'synced': bool(profiles), 'source': 'desktop',
        'message': t('桌面共享配置已保存，无需网页刷新。', 'Shared desktop settings are saved. No web refresh is needed.') if profiles else t('请在桌面设置中启用同步 Images API 主备方案。', 'Enable an Images API failover profile in desktop settings.'),
        'profiles': [{'id': p['id'], 'name': p['name']} for p in profiles]}
    else:
      status = snapshot_status(read_snapshot())
    print(json.dumps(status, ensure_ascii=False))
  except (OSError, ValueError):
    print(json.dumps({'synced': False, 'message': t('同步配置无法读取，请刷新网页重新同步。', 'Could not read synced settings. Refresh the web app to sync again.')}, ensure_ascii=False))
    sys.exit(1)
