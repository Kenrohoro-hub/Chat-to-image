"""从项目正式发布页检查并下载 Windows 更新，安装仍交给现有安装器。"""
import hashlib
import http.client
import json
import re
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from playground_config import local_data_dir
from ui_language import current_ui_language, set_request_ui_language, t


REPOSITORY = 'https://github.com/Kenrohoro-hub/Chat-to-image'
RELEASE_API = 'https://api.github.com/repos/Kenrohoro-hub/Chat-to-image/releases/latest'


def version_tuple(value):
  if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
    raise ValueError(t('发布版本号无效，请打开发布页核实。', 'Invalid release version. Check the release page.'))
  return tuple(int(part) for part in value.split('.'))


def validate_url(url):
  parsed = urlsplit(url)
  if parsed.scheme != 'https' or parsed.hostname not in (
    'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
  ) or parsed.username or parsed.password or parsed.port not in (None, 443):
    raise ValueError(t('更新地址不属于项目发布服务。', 'The update URL is outside the project release service.'))


class GitHubRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self, request, fp, code, msg, headers, newurl):
    validate_url(newurl)
    return super().redirect_request(request, fp, code, msg, headers, newurl)


def open_release(url):
  validate_url(url)
  request = urllib.request.Request(url, headers={'User-Agent': 'Chat-to-image-Updater', 'Accept': 'application/octet-stream' if '/download/' in url else 'application/vnd.github+json'})
  return urllib.request.build_opener(GitHubRedirect).open(request, timeout=30)


class AppUpdater:
  def __init__(self, root):
    self.root = root
    self.lock = threading.Lock()
    self.release = None
    self.checksum = ''
    self.installer = local_data_dir() / 'updates' / 'setup.exe'
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    version_tuple(version)
    self.state = {
      'status': 'idle', 'currentVersion': version, 'latestVersion': None,
      'releaseUrl': REPOSITORY + '/releases/latest', 'notes': '', 'available': False,
      'canInstall': (root / 'unins000.exe').is_file() and (root / 'runtime/pythonw.exe').is_file(),
      'downloaded': 0, 'total': 0, 'error': '',
    }

  def snapshot(self):
    with self.lock:
      return dict(self.state)

  def check(self):
    with self.lock:
      if self.state['status'] in ('checking', 'downloading', 'installing'):
        return dict(self.state)
      self.state.update(status='checking', error='', available=False, latestVersion=None, notes='', downloaded=0, total=0)
      self.release = None
      self.checksum = ''
    try:
      with open_release(RELEASE_API) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
      if len(raw) > 2 * 1024 * 1024:
        raise ValueError(t('发布信息超过大小限制。', 'The release information exceeds the size limit.'))
      release = json.loads(raw)
      if not isinstance(release, dict) or release.get('draft') or release.get('prerelease'):
        raise ValueError(t('未取得正式发布信息，请打开发布页核实。', 'No stable release information was returned. Check the release page.'))
      tag = release.get('tag_name', '')
      version = tag[1:] if isinstance(tag, str) and tag.startswith('v') else ''
      available = version_tuple(version) > version_tuple(self.state['currentVersion'])
      name = f'Chat-to-image-{version}-windows-x64-setup.exe'
      assets = release.get('assets')
      if not isinstance(assets, list) or not isinstance(release.get('body') or '', str):
        raise ValueError(t('发布信息格式无效。', 'Invalid release information.'))
      files = {item.get('name'): item for item in assets if isinstance(item, dict) and isinstance(item.get('name'), str)}
      installer, checksum = files.get(name, {}), files.get(name + '.sha256', {})
      prefix = f'{REPOSITORY}/releases/download/{tag}/'
      complete = (installer.get('browser_download_url') == prefix + name
        and checksum.get('browser_download_url') == prefix + name + '.sha256'
        and type(installer.get('size')) is int and 0 < installer['size'] <= 1024 * 1024 * 1024)
      with self.lock:
        if available and complete:
          self.release = {'name': name, 'url': prefix + name, 'checksumUrl': prefix + name + '.sha256', 'size': installer['size']}
        self.state.update(status='available' if available else 'current', latestVersion=version,
          available=available, releaseUrl=f'{REPOSITORY}/releases/tag/{tag}', notes=release.get('body') or '',
          total=installer['size'] if complete else 0,
          error=t('新版尚未提供完整的 Windows 安装器和校验文件，请打开发布页。', 'The new release does not include a complete Windows installer and checksum. Open the release page.') if available and not complete else '')
    except urllib.error.HTTPError as error:
      message = t('GitHub 请求受限，请稍后重试或打开发布页。', 'GitHub limited this request. Try later or open the release page.') if error.code in (403, 429) else t(f'检查更新失败（HTTP {error.code}），请稍后重试。', f'Update check failed (HTTP {error.code}). Try again later.')
      with self.lock:
        self.state.update(status='error', error=message)
    except (OSError, ValueError, TypeError, http.client.HTTPException) as error:
      message = str(error) if isinstance(error, ValueError) and not isinstance(error, (json.JSONDecodeError, UnicodeError)) else t('无法读取更新信息，请检查网络后重试，或打开发布页。', 'Could not read update information. Check your network and retry, or open the release page.')
      with self.lock:
        self.state.update(status='error', error=message)
    return self.snapshot()

  def download(self):
    with self.lock:
      if self.state['status'] in ('downloading', 'ready', 'installing'):
        return dict(self.state)
      if not self.state['canInstall'] or not self.release:
        raise ValueError(t('请在安装版桌面中检查更新，或从发布页手动下载。', 'Check for updates in the installed desktop app, or download from the release page.'))
      self.state.update(status='downloading', downloaded=0, error='')
      worker = threading.Thread(target=self._download, args=(dict(self.release), current_ui_language()), daemon=True)
      worker.start()
      return dict(self.state)

  def _download(self, release, language):
    set_request_ui_language(language)
    temporary = self.installer.with_suffix('.download')
    message = ''
    checksum = ''
    try:
      with open_release(release['checksumUrl']) as response:
        raw = response.read(4097)
      match = re.fullmatch(r'([a-fA-F0-9]{64})  ' + re.escape(release['name']) + r'\s*', raw.decode('ascii')) if len(raw) <= 4096 else None
      if not match:
        raise ValueError(t('更新校验文件无效，未运行安装器。', 'Invalid update checksum file. The installer was not started.'))
      checksum = match[1].lower()
      self.installer.parent.mkdir(parents=True, exist_ok=True)
      digest, downloaded = hashlib.sha256(), 0
      with open_release(release['url']) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
          downloaded += len(chunk)
          if downloaded > release['size']:
            raise ValueError(t('安装器大小与发布信息不符，请重新检查更新。', 'The installer size does not match the release. Check for updates again.'))
          output.write(chunk)
          digest.update(chunk)
          with self.lock:
            self.state['downloaded'] = downloaded
      if downloaded != release['size'] or digest.hexdigest() != checksum:
        raise ValueError(t('安装器下载不完整或校验失败，请重试下载。', 'The installer download is incomplete or failed verification. Retry the download.'))
      temporary.replace(self.installer)
    except (OSError, ValueError, http.client.HTTPException) as error:
      message = str(error) if isinstance(error, ValueError) and not isinstance(error, UnicodeError) else t('更新下载失败，请检查网络、磁盘空间和写入权限后重试。', 'The update download failed. Check your network, disk space, and write permissions, then retry.')
    finally:
      try:
        temporary.unlink(missing_ok=True)
      except OSError:
        pass
    with self.lock:
      self.checksum = '' if message else checksum
      self.state.update(status='error' if message else 'ready', error=message)

  def prepare_install(self):
    with self.lock:
      if self.state['status'] != 'ready' or not self.checksum or not self.state['canInstall']:
        raise ValueError(t('请先完成更新下载和校验。', 'Download and verify the update first.'))
      try:
        digest = hashlib.sha256()
        with self.installer.open('rb') as file:
          while chunk := file.read(1024 * 1024):
            digest.update(chunk)
        if digest.hexdigest() != self.checksum:
          raise ValueError('checksum')
      except (OSError, ValueError):
        self.state.update(status='error', error=t('下载的安装器已变化或无法读取，请重新下载。', 'The downloaded installer changed or could not be read. Download it again.'))
        raise ValueError(self.state['error']) from None
      self.state['status'] = 'installing'
      return self.installer
