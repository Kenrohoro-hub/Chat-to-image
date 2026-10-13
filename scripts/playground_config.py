"""网页与命令行共享的本机配置；密钥使用当前 Windows 用户的 DPAPI 加密。"""

import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path

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
    raise ValueError(t('无法加密或解密配置，请在桌面或本机网页设置中重新填写并保存。', 'Could not encrypt or decrypt settings. Re-enter and save them in the desktop app or local web app.'))
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
    raise ValueError(t('同步配置损坏，请在桌面或本机网页设置中重新填写并保存。', 'Synced settings are damaged. Re-enter and save them in the desktop app or local web app.'))
  return record


def snapshot_status(record):
  if not record:
    return {'synced': False, 'message': t('请在桌面或本机网页设置中填写并保存 API 配置。', 'Enter and save API settings in the desktop app or local web app.')}
  profile = record['profile']
  return {
    'synced': not bool(record.get('error')) and bool(record.get('encryptedKey')),
    'name': profile.get('name', ''), 'baseUrl': profile.get('baseUrl', ''),
    'model': profile.get('model', ''), 'provider': profile.get('provider', ''),
    'message': record.get('error') or t('网页配置已同步到 Codex。', 'Web settings are synced with Codex.'),
  }


def snapshot_key(record):
  if record.get('error'):
    raise ValueError(record['error'])
  if not isinstance(record.get('encryptedKey'), str):
    raise ValueError(t('同步密钥缺失，请在桌面或本机网页设置中重新填写并保存。', 'The synced key is missing. Re-enter and save settings in the desktop app or local web app.'))
  secret = json.loads(protect(base64.b64decode(record['encryptedKey'], validate=True), decrypt=True))
  if not isinstance(secret, dict) or not isinstance(secret.get('apiKey'), str):
    raise ValueError(t('同步密钥格式错误，请在桌面或本机网页设置中重新填写并保存。', 'The synced key is invalid. Re-enter and save settings in the desktop app or local web app.'))
  if any(secret.get(field) != record['profile'].get(field) for field in ('baseUrl', 'model')):
    raise ValueError(t('同步配置地址或模型已改变，请在桌面或本机网页设置中重新填写并保存。', 'The API URL or model in synced settings changed. Re-enter and save settings in the desktop app or local web app.'))
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
    print(json.dumps({'synced': False, 'message': t('同步配置无法读取，请在桌面或本机网页设置中重新填写并保存。', 'Could not read synced settings. Re-enter and save settings in the desktop app or local web app.')}, ensure_ascii=False))
    sys.exit(1)
