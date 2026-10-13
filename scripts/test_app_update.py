"""更新检查、下载、校验及桌面退出边界；网络和安装进程均隔离模拟。"""
import hashlib
import io
import json
import os
import sys
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from app_update import AppUpdater, GitHubRedirect, REPOSITORY, version_tuple
from desktop_host import DesktopApi
from serve_app import LocalApi


class UpdateTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='chat-to-image-update-test-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    self.env = patch.dict(os.environ, {'LOCALAPPDATA': str(self.root), 'PLAYGROUND_UI_LANGUAGE': 'zh-CN'})
    self.env.start()
    self.addCleanup(self.env.stop)
    (self.root / 'package.json').write_text('{"version":"0.3.0"}', encoding='utf-8')
    (self.root / 'runtime').mkdir()
    (self.root / 'runtime/pythonw.exe').touch()
    (self.root / 'unins000.exe').touch()
    self.updater = AppUpdater(self.root)
    self.image = b'MZ-isolated-installer-fixture'
    self.name = 'Chat-to-image-0.4.0-windows-x64-setup.exe'
    self.prefix = REPOSITORY + '/releases/download/v0.4.0/'
    self.release = {
      'tag_name': 'v0.4.0', 'draft': False, 'prerelease': False, 'body': '测试更新说明',
      'assets': [
        {'name': self.name, 'size': len(self.image), 'browser_download_url': self.prefix + self.name},
        {'name': self.name + '.sha256', 'browser_download_url': self.prefix + self.name + '.sha256'},
      ],
    }

  def check(self, value=None):
    with patch('app_update.open_release', return_value=io.BytesIO(json.dumps(value or self.release).encode())):
      return self.updater.check()

  def download(self, body=None, checksum=None):
    digest = checksum or hashlib.sha256(self.image).hexdigest()
    responses = [io.BytesIO(f'{digest}  {self.name}\n'.encode()), io.BytesIO(self.image if body is None else body)]
    self.check()
    with patch('app_update.open_release', side_effect=responses), patch('app_update.threading.Thread') as thread:
      self.assertEqual(self.updater.download()['status'], 'downloading')
      thread.assert_called_once()
      target = thread.call_args.kwargs
      target['target'](*target['args'])
    return self.updater.snapshot()

  def test_numeric_versions_and_release_notes(self):
    self.assertGreater(version_tuple('0.10.0'), version_tuple('0.9.9'))
    state = self.check()
    self.assertEqual((state['status'], state['latestVersion'], state['notes']), ('available', '0.4.0', '测试更新说明'))
    self.assertEqual(state['releaseUrl'], REPOSITORY + '/releases/tag/v0.4.0')
    for tag in ('v0.3.0', 'v0.2.0'):
      self.release['tag_name'] = tag
      state = self.check()
      self.assertEqual(state['status'], 'current')
      self.assertFalse(state['available'])

  def test_invalid_or_preview_releases_are_not_current(self):
    for value in ({**self.release, 'tag_name': 'v0.4.0-beta.1'}, {**self.release, 'prerelease': True},
                  {**self.release, 'assets': None}, {**self.release, 'body': 123}, []):
      with self.subTest(value=value):
        with patch('app_update.open_release', return_value=io.BytesIO(json.dumps(value).encode())):
          self.assertEqual(self.updater.check()['status'], 'error')
          self.assertFalse(self.updater.snapshot()['available'])

  def test_network_rate_limit_and_bad_json_allow_retry(self):
    for error in (urllib.error.HTTPError('', 403, 'limit', {}, None), urllib.error.HTTPError('', 404, 'missing', {}, None),
                  urllib.error.URLError('offline')):
      with patch('app_update.open_release', side_effect=error):
        state = self.updater.check()
        self.assertEqual(state['status'], 'error')
        self.assertTrue(state['error'])
    with patch('app_update.open_release', return_value=io.BytesIO(b'not json')):
      self.assertEqual(self.updater.check()['status'], 'error')
    self.assertEqual(self.check()['status'], 'available')

  def test_untrusted_or_missing_installer_cannot_download(self):
    for assets in ([], [{**self.release['assets'][0], 'browser_download_url': 'https://evil.example/setup.exe'}, self.release['assets'][1]]):
      state = self.check({**self.release, 'assets': assets})
      self.assertTrue(state['available'])
      self.assertEqual(state['total'], 0)
      self.assertTrue(state['error'])
      with self.assertRaises(ValueError):
        self.updater.download()

  def test_redirects_reject_non_github_or_insecure_hosts(self):
    import urllib.request
    request = urllib.request.Request(REPOSITORY)
    for url in ('http://github.com/x', 'https://github.com.evil.example/x', 'https://user@github.com/x', 'https://127.0.0.1/x'):
      with self.subTest(url=url), self.assertRaises(ValueError):
        GitHubRedirect().redirect_request(request, None, 302, '', {}, url)
    redirected = GitHubRedirect().redirect_request(request, None, 302, '', {}, 'https://release-assets.githubusercontent.com/asset')
    self.assertEqual(redirected.host, 'release-assets.githubusercontent.com')

  def test_source_checkout_and_local_browser_cannot_install(self):
    (self.root / 'unins000.exe').unlink()
    source = AppUpdater(self.root)
    self.assertFalse(source.snapshot()['canInstall'])
    with self.assertRaises(ValueError):
      source.download()
    api = LocalApi()
    api._updater = self.updater
    self.assertFalse(api.app_update('status')['canInstall'])
    for action in ('download', 'install', 'unknown'):
      with self.assertRaises(ValueError):
        api.app_update(action)

  def test_download_verifies_and_rechecks_before_install(self):
    state = self.download()
    self.assertEqual((state['status'], state['downloaded']), ('ready', len(self.image)))
    self.assertFalse(self.updater.installer.with_suffix('.download').exists())
    self.assertEqual(self.updater.installer.read_bytes(), self.image)
    self.updater.installer.write_bytes(b'changed')
    with self.assertRaises(ValueError):
      self.updater.prepare_install()
    self.assertEqual(self.updater.snapshot()['status'], 'error')
    self.assertEqual(self.download()['status'], 'ready')
    self.assertEqual(self.updater.prepare_install(), self.updater.installer)

  def test_truncated_oversized_and_wrong_checksum_downloads_fail(self):
    for body, checksum in ((b'short', None), (self.image + b'too long', None), (self.image, '0' * 64)):
      with self.subTest(body=body, checksum=checksum):
        self.assertEqual(self.download(body, checksum)['status'], 'error')
        self.assertFalse(self.updater.installer.with_suffix('.download').exists())
        with self.assertRaises(ValueError):
          self.updater.prepare_install()

  def test_download_failure_can_retry_without_duplicate_workers(self):
    self.check()
    with patch('app_update.threading.Thread') as thread:
      first = self.updater.download()
      self.updater.download()
      self.updater.check()
      thread.assert_called_once()
      self.assertEqual(first['status'], 'downloading')
      with patch('app_update.open_release', side_effect=urllib.error.URLError('offline')):
        target = thread.call_args.kwargs
        target['target'](*target['args'])
    self.assertEqual(self.updater.snapshot()['status'], 'error')
    self.assertEqual(self.download()['status'], 'ready')

  def test_desktop_requires_idle_and_owned_page_before_exit(self):
    self.download()
    api = DesktopApi()
    api._updater = self.updater
    api._window = MagicMock()
    api._origin = 'http://127.0.0.1:1234'
    api._window.get_current_url.return_value = api._origin
    for field in ('_processes', '_queued', '_requests'):
      original = getattr(api, field)
      setattr(api, field, {'running'})
      with self.assertRaises(ValueError):
        api.app_update('install')
      setattr(api, field, original)
      api._window.destroy.assert_not_called()
    api._window.get_current_url.return_value = 'https://evil.example/'
    with self.assertRaises(ValueError):
      api.app_update('install')
    api._window.get_current_url.return_value = api._origin
    self.assertEqual(api.app_update('install')['status'], 'installing')
    self.assertTrue(api._closing)
    self.assertEqual(api._pending_installer, self.updater.installer)
    api._window.destroy.assert_called_once_with()

  def test_window_close_failure_restores_ready_state(self):
    self.download()
    api = DesktopApi()
    api._updater = self.updater
    api._window = MagicMock()
    api._origin = 'http://127.0.0.1:1234'
    api._window.get_current_url.return_value = api._origin
    api._window.destroy.side_effect = RuntimeError('close failed')
    with self.assertRaises(RuntimeError):
      api.app_update('install')
    self.assertFalse(api._closing)
    self.assertIsNone(api._pending_installer)
    self.assertEqual(self.updater.snapshot()['status'], 'ready')


  def test_local_http_entry_checks_versions_but_cannot_launch_installer(self):
    import urllib.request
    from serve_app import make_server
    with patch.dict(os.environ, {'PLAYGROUND_CONFIG_DIR': str(self.root / 'config')}):
      server = make_server(0)
      server.api._updater = self.updater
      worker = threading.Thread(target=server.serve_forever, daemon=True)
      worker.start()
      base = f'http://127.0.0.1:{server.server_port}'
      try:
        with urllib.request.urlopen(base + '/__local/session') as response:
          token = json.load(response)['token']
        headers = {'Origin': base, 'X-Codex-Sync': token, 'Content-Type': 'application/json'}
        payload = json.dumps({'method': 'app_update', 'args': ['check']}).encode()
        with patch('app_update.open_release', return_value=io.BytesIO(json.dumps(self.release).encode())):
          with urllib.request.urlopen(urllib.request.Request(base + '/__local/api', data=payload, headers=headers)) as response:
            state = json.load(response)
        self.assertEqual(state['latestVersion'], '0.4.0')
        self.assertFalse(state['canInstall'])
        for args, changed, code in ((['install'], {}, 400), (['check'], {'Origin': 'https://evil.example'}, 403),
                                    (['check'], {'X-Codex-Sync': 'wrong'}, 403)):
          request = urllib.request.Request(base + '/__local/api',
            data=json.dumps({'method': 'app_update', 'args': args}).encode(), headers={**headers, **changed})
          with self.assertRaises(urllib.error.HTTPError) as rejected:
            urllib.request.urlopen(request)
          self.assertEqual(rejected.exception.code, code)
          rejected.exception.close()
      finally:
        server.shutdown()
        worker.join(timeout=5)
        server.server_close()

  def test_main_launches_installer_only_after_server_and_mutex_close(self):
    import desktop_host
    events = []
    webview, server, kernel, thread = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    server.server_port = 1234
    server.shutdown.side_effect = lambda: events.append('shutdown')
    server.server_close.side_effect = lambda: events.append('server-close')
    kernel.CloseHandle.side_effect = lambda handle: events.append('mutex-close')
    installer = self.root / 'updates/setup.exe'
    def closed_window(**kwargs):
      webview.create_window.call_args.kwargs['js_api']._pending_installer = installer
    webview.start.side_effect = closed_window
    with patch.dict(sys.modules, {'webview': webview}), patch('ctypes.WinDLL', return_value=kernel), patch('ctypes.get_last_error', return_value=0), \
         patch('desktop_host.local_data_dir', return_value=self.root / 'local'), patch('serve_app.make_server', return_value=server), \
         patch('desktop_host.threading.Thread', return_value=thread), patch('winreg.CreateKeyEx'), patch('winreg.SetValueEx'), \
         patch('desktop_host.subprocess.Popen', side_effect=lambda *args, **kwargs: events.append('install')) as launch:
      desktop_host.main()
    self.assertEqual(events, ['shutdown', 'server-close', 'mutex-close', 'install'])
    self.assertEqual(launch.call_args.args[0], [str(installer), '/NORESTART', f'/DIR={Path(desktop_host.__file__).resolve().parent.parent}'])


if __name__ == '__main__':
  unittest.main(verbosity=2)
