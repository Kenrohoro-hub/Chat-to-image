"""验证网页配置同步、DPAPI 隔离和 CLI 自动发现；仅使用模拟服务。"""

import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

from playground_config import config_path, local_data_dir, read_snapshot, snapshot_key
from desktop_config import read_desktop, desktop_path, save_desktop
from desktop_host import DesktopApi
from serve_app import make_server
from sync_app import stop_service
from test_playground_image import Handler as ImageHandler, IMAGE
from http.server import ThreadingHTTPServer


@unittest.skipUnless(os.name == 'nt', 'DPAPI is a Windows feature')
class SyncTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='playground-sync-test-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PLAYGROUND_')}
    env['LOCALAPPDATA'] = str(self.root)
    env['PLAYGROUND_CONFIG_DIR'] = str(self.root / 'user-config')
    self.environment = patch.dict(os.environ, env, clear=True)
    self.environment.start()
    self.addCleanup(self.environment.stop)
    self.server = make_server(0)
    self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    self.thread.start()
    self.addCleanup(self.stop, self.server, self.thread)
    self.image_server = ThreadingHTTPServer(('127.0.0.1', 0), ImageHandler)
    self.image_server.mode = 'normal'
    self.image_server.calls = []
    self.image_server.downloads = []
    self.image_thread = threading.Thread(target=self.image_server.serve_forever, daemon=True)
    self.image_thread.start()
    self.addCleanup(self.stop, self.image_server, self.image_thread)
    self.origin = f'http://127.0.0.1:{self.server.server_port}'
    self.profile = {
      'id': 'test', 'name': '测试配置', 'provider': 'openai', 'apiMode': 'images',
      'baseUrl': f'http://127.0.0.1:{self.image_server.server_port}',
      'model': 'mock-image', 'apiKey': 'sync-test-secret', 'imageProtocol': 'auto',
    }

  @staticmethod
  def stop(server, thread):
    server.shutdown()
    server.server_close()
    thread.join()

  def send(self, body=None, path='/__codex/config', headers=None):
    req_headers = {'Origin': self.origin, 'Content-Type': 'application/json', 'X-Codex-Sync': self.server.sync_token}
    req_headers.update(headers or {})
    req = urllib.request.Request(self.origin + path, data=json.dumps(body).encode() if body is not None else None, headers=req_headers)
    try:
      with urllib.request.urlopen(req, timeout=5) as response:
        return response.status, response.read(), response.headers
    except urllib.error.HTTPError as exc:
      return exc.code, exc.read(), exc.headers

  def test_ui_language_is_injected_only_for_desktop_pages(self):
    self.server.desktop = True
    with patch('serve_app.system_ui_language', return_value='en'):
      with urllib.request.urlopen(self.origin + '/?desktop=1', timeout=5) as response:
        page = response.read().decode('utf-8')
      self.assertIn('window.__PLAYGROUND_UI_LANGUAGE__="en"', page)
      self.assertIn('window.__PLAYGROUND_DESKTOP__=true', page)
      with urllib.request.urlopen(self.origin + '/', timeout=5) as response:
        page = response.read().decode('utf-8')
      self.assertNotIn('window.__PLAYGROUND_UI_LANGUAGE__=', page)

  def test_local_errors_follow_each_request_language(self):
    payload = {'method': 'read_youmind_prompts', 'args': [0]}
    for language, expected in [('en', 'Invalid YouMind catalog page.'), ('zh-CN', 'YouMind 目录页码无效。'), ('en', 'Invalid YouMind catalog page.')]:
      status, raw, _ = self.send(payload, path='/__local/api', headers={'X-Playground-Language': language})
      self.assertEqual(status, 400)
      self.assertEqual(json.loads(raw)['error'], expected)

  def cli(self, *args):
    result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('playground_image.py')), '--prompt', '测试纸飞机', *args], cwd=self.root, capture_output=True, encoding='utf-8', timeout=10)
    self.assertEqual(result.stderr, '')
    self.assertNotIn('sync-test-secret', result.stdout)
    value = json.loads(result.stdout)
    self.assertEqual(result.returncode, 0 if value['ok'] else 1)
    return value

  def rpc(self, method, *args, headers=None):
    return self.send({'method': method, 'args': list(args)}, '/__local/api', headers)

  def test_model_catalog_rpc_preserves_safe_errors_and_authentication(self):
    with patch.object(self.server.api, 'list_models', side_effect=ValueError('模型列表获取失败（HTTP 401），可继续手动添加。')) as read:
      status, raw, _ = self.rpc('list_models', {'baseUrl': 'https://example.test', 'apiKey': 'mock-key'})
      self.assertEqual(status, 400)
      self.assertIn('401', json.loads(raw)['error'])
      self.assertNotIn('mock-key', raw.decode())
      self.assertEqual(self.rpc('list_models', {}, headers={'Origin': 'https://example.com'})[0], 403)
      self.assertEqual(self.rpc('list_models', {}, headers={'X-Codex-Sync': 'wrong'})[0], 403)
      read.assert_called_once()

  def test_prompt_storage_rpc_validates_origin_token_and_method(self):
    self.assertEqual(self.rpc('prompt_storage', 'status', {})[0], 200)
    self.assertEqual(self.rpc('prompt_storage', 'status', {}, headers={'Origin': 'https://example.com'})[0], 403)
    self.assertEqual(self.rpc('prompt_storage', 'status', {}, headers={'X-Codex-Sync': 'wrong'})[0], 403)
    self.assertEqual(self.rpc('prompt_storage', 'status')[0], 400)
    self.assertEqual(self.rpc('choose_prompt_directory')[0], 400)
    status, raw, _ = self.rpc('prompt_storage', 'prepare', {'directory': 'relative'})
    self.assertEqual(status, 400)
    self.assertIn('绝对路径', json.loads(raw)['error'])

  def test_prompt_image_rpc_uses_existing_origin_and_token_checks(self):
    with patch.object(self.server.api, 'download_prompt_image', return_value={'dataUrl': 'data:image/png;base64,eA=='}) as download:
      url = 'https://r2.qqsrc.com/images/1.png'
      status, raw, _ = self.rpc('download_prompt_image', url)
      self.assertEqual(status, 200)
      self.assertIn('dataUrl', json.loads(raw))
      self.assertEqual(self.rpc('download_prompt_image', url, headers={'Origin': 'https://example.com'})[0], 403)
      self.assertEqual(self.rpc('download_prompt_image', url, headers={'X-Codex-Sync': 'wrong'})[0], 403)
      self.assertEqual(self.rpc('download_prompt_image')[0], 400)
      download.assert_called_once_with(url)
      download.side_effect = ValueError('预览图连接失败或超时，请稍后重试。')
      status, raw, _ = self.rpc('download_prompt_image', url)
      self.assertEqual(status, 400)
      self.assertIn('预览图连接失败', json.loads(raw)['error'])

  def test_youmind_catalog_rpc_preserves_authentication_and_errors(self):
    with patch.object(self.server.api, 'read_youmind_prompts', return_value={'prompts': [], 'totalPages': 1}) as read:
      self.assertEqual(json.loads(self.rpc('read_youmind_prompts', 1)[1])['totalPages'], 1)
      self.assertEqual(self.rpc('read_youmind_prompts', 1, headers={'Origin': 'https://example.com'})[0], 403)
      self.assertEqual(self.rpc('read_youmind_prompts', 1, headers={'X-Codex-Sync': 'wrong'})[0], 403)
      self.assertEqual(self.rpc('read_youmind_prompts')[0], 400)
      read.assert_called_once_with(1)
      read.side_effect = ValueError('YouMind 读取失败，原缓存已保留。')
      status, raw, _ = self.rpc('read_youmind_prompts', 1)
      self.assertEqual(status, 400)
      self.assertIn('原缓存已保留', json.loads(raw)['error'])

  def test_heroprompt_rpc_preserves_origin_token_and_arguments(self):
    with patch.object(self.server.api, 'read_heroprompt_posts', return_value={'prompts': [], 'totalPages': 1}) as read:
      self.assertEqual(self.rpc('read_heroprompt_posts', 1)[0], 200)
      self.assertEqual(self.rpc('read_heroprompt_posts', 1, headers={'Origin': 'https://example.com'})[0], 403)
      self.assertEqual(self.rpc('read_heroprompt_posts', 1, headers={'X-Codex-Sync': 'wrong'})[0], 403)
      self.assertEqual(self.rpc('read_heroprompt_posts')[0], 400)
      read.assert_called_once_with(1)
      read.side_effect = ValueError('HeroPrompt 读取失败，原缓存已保留。')
      status, raw, _ = self.rpc('read_heroprompt_posts', 1)
      self.assertEqual(status, 400)
      self.assertIn('原缓存已保留', json.loads(raw)['error'])

  def test_full_settings_shared_with_native_and_independent_cli(self):
    status, raw, _ = self.rpc('load_settings')
    self.assertEqual(status, 200)
    snapshot = json.loads(raw)
    self.assertIsNone(snapshot['settings'])
    settings = {'profiles': [self.profile, {**self.profile, 'id': 'agent', 'apiMode': 'responses'}],
      'activeProfileId': 'test', 'theme': 'dark',
      'failover': {'enabled': True, 'primaryId': 'test', 'slots': ['test'], 'disabledIds': []},
      'agentFailover': {'enabled': False, 'primaryId': 'agent', 'slots': ['agent'], 'disabledIds': ['agent']}}
    status, raw, _ = self.rpc('save_settings', settings, snapshot['revision'])
    self.assertEqual(status, 200)
    revision = json.loads(raw)['revision']
    self.assertNotIn(b'sync-test-secret', desktop_path().read_bytes())
    api = DesktopApi()
    with patch.object(api, '_check'):
      native = api.load_settings()
      self.assertEqual(native['settings'], settings)
      self.assertEqual(native['revision'], revision)
      native['settings']['theme'] = 'light'
      api.save_settings(native['settings'], revision)
    loaded = json.loads(self.rpc('load_settings')[1])
    self.assertEqual(loaded['settings']['theme'], 'light')
    self.assertEqual(loaded['settings']['agentFailover']['disabledIds'], ['agent'])
    result = self.cli()
    self.assertTrue(result['ok'])
    self.assertEqual(result['config_source'], 'desktop')
    self.assertTrue(Path(result['images'][0]['path']).is_relative_to(local_data_dir()))
    self.assertFalse((self.root / 'outputs').exists())

  def test_stale_save_cannot_overwrite_another_client(self):
    first = json.loads(self.rpc('load_settings')[1])
    settings = {'profiles': [self.profile], 'activeProfileId': 'test'}
    self.assertEqual(self.rpc('save_settings', settings, first['revision'])[0], 200)
    self.assertEqual(self.rpc('save_settings', {**settings, 'theme': 'dark'}, first['revision'])[0], 409)
    self.assertNotIn('theme', read_desktop(True))
    self.assertEqual(self.send({'profile': {**self.profile, 'model': 'old-client'}})[0], 409)
    self.assertEqual(read_desktop(True)['profiles'][0]['model'], 'mock-image')

  def test_shared_api_rejects_foreign_reads_and_unknown_methods(self):
    for headers in ({'Origin': 'https://untrusted.example'}, {'Host': 'evil.example'}, {'X-Codex-Sync': 'bad'}):
      self.assertEqual(self.rpc('load_settings', headers=headers)[0], 403)
    self.assertEqual(self.rpc('_stop')[0], 400)
    self.assertEqual(self.rpc('save_settings', {'profiles': [self.profile]})[0], 400)
    self.assertFalse(desktop_path().exists())
    for path in ('/__local/session', '/__codex/bridge.js'):
      self.assertEqual(self.send(path=path, headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)

  def test_unreadable_config_recovery_uses_protected_revision_contract(self):
    save_desktop({'profiles': [self.profile]})
    original = desktop_path().read_bytes()
    from playground_config import protect
    def decrypt_failure(data, decrypt=False):
      if decrypt:
        raise ValueError('decrypt failed')
      return protect(data)
    with patch('desktop_config.protect', side_effect=decrypt_failure):
      status, raw, _ = self.rpc('load_settings')
      self.assertEqual(status, 200)
      snapshot = json.loads(raw)
      self.assertIn('无法解密', snapshot['error'])
      self.assertNotIn('sync-test-secret', raw.decode())
      for headers in ({'Origin': 'https://untrusted.example'}, {'Host': 'evil.example'}, {'X-Codex-Sync': 'bad'}):
        self.assertEqual(self.rpc('recover_settings', snapshot['revision'], headers=headers)[0], 403)
      self.assertEqual(self.rpc('recover_settings', 'stale')[0], 409)
      self.assertEqual(desktop_path().read_bytes(), original)
      self.assertEqual(self.rpc('recover_settings', snapshot['revision'])[0], 200)
    self.assertNotIn('error', json.loads(self.rpc('load_settings')[1]))
    self.assertFalse(read_desktop(True)['profiles'][0].get('apiKey'))
    backups = list(desktop_path().parent.glob('desktop-settings.unreadable-*.json'))
    self.assertEqual(len(backups), 1)
    self.assertEqual(backups[0].read_bytes(), original)

  def test_concurrent_clients_cannot_both_save_the_same_revision(self):
    revision = json.loads(self.rpc('load_settings')[1])['revision']
    def save(theme):
      return theme, self.rpc('save_settings', {'profiles': [self.profile], 'theme': theme}, revision)[0]
    with ThreadPoolExecutor(max_workers=2) as executor:
      results = list(executor.map(save, ['light', 'dark']))
    self.assertEqual(sorted(status for _, status in results), [200, 409])
    winner = next(theme for theme, status in results if status == 200)
    self.assertEqual(read_desktop(True)['theme'], winner)

  def test_incomplete_primary_does_not_hide_a_usable_shared_backup(self):
    revision = json.loads(self.rpc('load_settings')[1])['revision']
    settings = {'profiles': [{**self.profile, 'apiKey': ''}, {**self.profile, 'id': 'backup'}],
      'failover': {'enabled': True, 'primaryId': 'test', 'slots': ['test', 'backup']}}
    self.assertEqual(self.rpc('save_settings', settings, revision)[0], 200)
    status = json.loads(self.send(path='/__codex/status')[1])
    self.assertTrue(status['synced'])
    self.assertNotIn('sync-test-secret', json.dumps(status))

  def test_browser_can_use_desktop_served_page_without_native_bridge(self):
    self.server.desktop = True
    index = self.send(path='/')[1]
    self.assertIn(b'__PLAYGROUND_LOCAL__', index)
    self.assertNotIn(b'__PLAYGROUND_DESKTOP__', index)
    self.assertEqual(self.rpc('load_settings')[0], 200)

  def test_web_generation_uses_saved_pool_and_returns_images(self):
    settings = {'profiles': [self.profile], 'activeProfileId': 'test'}
    revision = json.loads(self.rpc('load_settings')[1])['revision']
    self.assertEqual(self.rpc('save_settings', settings, revision)[0], 200)
    status, raw, _ = self.rpc('generate', {'requestId': 'web-test', 'profileId': 'test', 'prompt': 'test', 'params': {'n': 2}})
    self.assertEqual(status, 200)
    result = json.loads(raw)
    self.assertTrue(result['ok'])
    self.assertEqual(len(result['images']), 2)
    self.assertTrue(result['images'][0].startswith('data:image/png;base64,'))
    self.assertEqual(result['usedProfile']['id'], 'test')
    self.assertEqual(self.rpc('generate', {'profileId': 'test', 'prompt': 'test', 'params': []})[0], 400)
    self.assertEqual(len(self.image_server.calls), 2)

  def test_launcher_stop_cancels_web_batch_but_preserves_independent_cli(self):
    from test_desktop import Handler as DesktopHandler

    class WaitingHandler(DesktopHandler):
      def do_POST(self):
        if len(self.server.calls) >= 2:
          self.server.extra_call.set()
        super().do_POST()

    self.image_server.RequestHandlerClass = WaitingHandler
    self.image_server.modes = {'v1': 'wait'}
    self.image_server.release = threading.Event()
    self.image_server.extra_call = threading.Event()
    self.addCleanup(self.image_server.release.set)
    self.assertEqual(self.rpc('save_settings', {'profiles': [self.profile], 'activeProfileId': 'test'}, '0')[0], 200)
    service_temp = self.root / 'service-temp'
    service_temp.mkdir()
    service = subprocess.Popen([sys._base_executable, '-B', str(Path(__file__).with_name('serve_app.py')),
      '--port', '0', '--control-stdin'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
      env={**os.environ, 'TEMP': str(service_temp), 'TMP': str(service_temp)})
    self.addCleanup(service.stderr.close)
    self.addCleanup(service.stdout.close)
    self.addCleanup(stop_service, service)
    origin = re.search(r'http://127\.0\.0\.1:\d+', service.stdout.readline().decode()).group()
    with urllib.request.urlopen(origin + '/__local/session', timeout=5) as response:
      token = json.load(response)['token']
    request = urllib.request.Request(origin + '/__local/api',
      data=json.dumps({'method': 'generate', 'args': [{'profileId': 'test', 'prompt': 'test', 'params': {'n': 2}}]}).encode(),
      headers={'Origin': origin, 'Content-Type': 'application/json', 'X-Codex-Sync': token})

    web_results = []
    def web_request():
      try:
        with urllib.request.urlopen(request, timeout=15) as response:
          web_results.append(json.load(response))
      except (OSError, ValueError) as error:
        web_results.append(type(error).__name__)

    thread = threading.Thread(target=web_request)
    thread.start()
    self.addCleanup(thread.join, 16)
    independent = subprocess.Popen([sys._base_executable, '-B', str(Path(__file__).with_name('playground_image.py')),
      '--prompt', 'independent', '--output', str(self.root / 'independent')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def finish_independent():
      self.image_server.release.set()
      if independent.poll() is None:
        independent.terminate()
        independent.wait(timeout=5)
      independent.stdout.close()
      independent.stderr.close()

    self.addCleanup(finish_independent)
    deadline = time.monotonic() + 10
    while len(self.image_server.calls) < 2 and time.monotonic() < deadline:
      time.sleep(0.02)
    self.assertEqual(len(self.image_server.calls), 2, f'web={web_results}, independent_exit={independent.poll()}, prompts={[json.loads(body).get("prompt") for _, body in self.image_server.calls]}')
    stop_service(service)
    self.assertEqual(service.returncode, 0)
    self.assertEqual(list(service_temp.iterdir()), [])
    self.assertIsNone(independent.poll())
    self.image_server.release.set()
    output, error = independent.communicate(timeout=15)
    self.assertEqual(error, b'')
    self.assertTrue(json.loads(output)['ok'])
    self.assertFalse(self.image_server.extra_call.wait(0.5))
    self.assertEqual(len(self.image_server.calls), 2)

  def test_launcher_eof_keeps_the_background_service_running(self):
    service = subprocess.Popen([sys._base_executable, '-B', str(Path(__file__).with_name('serve_app.py')),
      '--port', '0', '--control-stdin'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
      origin = re.search(r'http://127\.0\.0\.1:\d+', service.stdout.readline().decode()).group()
      service.stdin.close()
      with urllib.request.urlopen(origin + '/__codex/status', timeout=5) as response:
        self.assertEqual(json.load(response)['sync_version'], 4)
      self.assertIsNone(service.poll())
    finally:
      if service.poll() is None:
        service.terminate()
        service.wait(timeout=5)
      service.stdin.close()
      service.stdout.close()
      service.stderr.close()

  def test_broken_control_pipe_preserves_the_visible_stop_error(self):
    process = Mock()
    process.poll.return_value = None
    process.stdin.write.side_effect = OSError('pipe closed')
    process.stdin.close.side_effect = OSError('pipe closed')
    with self.assertRaisesRegex(RuntimeError, '服务停止尚未完成'):
      stop_service(process)
    process.terminate.assert_not_called()

  def test_browser_profile_to_cli_without_manual_parameters(self):
    self.assertFalse(self.cli('--dry-run')['ok'])
    status, raw, _ = self.send({'profile': self.profile})
    self.assertEqual(status, 200)
    self.assertTrue(json.loads(raw)['synced'])
    self.assertNotIn(b'sync-test-secret', config_path().read_bytes())
    self.assertEqual(snapshot_key(read_snapshot()), 'sync-test-secret')
    dry = self.cli('--dry-run')
    self.assertTrue(dry['ok'])
    self.assertEqual(dry['config_source'], 'browser_sync')
    self.assertEqual(self.image_server.calls, [])
    result = self.cli()
    self.assertTrue(result['ok'])
    self.assertEqual(Path(result['images'][0]['path']).read_bytes(), IMAGE)
    self.assertEqual(self.image_server.calls[0]['headers']['Authorization'], 'Bearer sync-test-secret')
    self.assertEqual(self.image_server.calls[0]['path'], '/v1/images/generations')

  def test_browser_sync_preserves_image_protocol(self):
    for protocol in ('seedream', 'qwen'):
      profile = {**self.profile, 'imageProtocol': protocol}
      status, raw, _ = self.send({'profile': profile})
      self.assertEqual(status, 200)
      self.assertEqual(read_snapshot()['profile']['imageProtocol'], protocol)

  def test_host_origin_token_and_media_type_guards(self):
    cases = [({'Origin': 'https://untrusted.example'}, 403), ({'Host': 'evil.example'}, 403), ({'X-Codex-Sync': 'bad'}, 403), ({'Content-Type': 'text/plain'}, 415)]
    for headers, expected in cases:
      with self.subTest(headers=headers):
        self.assertEqual(self.send({'profile': self.profile}, headers=headers)[0], expected)
    self.assertFalse(config_path().exists())

  def test_payload_limit_and_invalid_structure(self):
    self.assertEqual(self.send({'profile': {'apiKey': 'x' * 70000}})[0], 413)
    self.assertEqual(self.send({'unexpected': self.profile})[0], 400)
    self.assertEqual(self.send({'profile': []})[0], 400)
    self.assertFalse(config_path().exists())

  def test_missing_key_disables_previous_profile(self):
    self.send({'profile': self.profile})
    self.profile['apiKey'] = ''
    status, raw, _ = self.send({'profile': self.profile})
    self.assertEqual(status, 200)
    self.assertFalse(json.loads(raw)['synced'])
    self.assertNotIn('encryptedKey', read_snapshot())
    self.assertEqual(self.cli()['error']['code'], 'BROWSER_CONFIG_UNAVAILABLE')
    self.assertEqual(self.image_server.calls, [])

  def test_unsupported_provider_disables_previous_profile(self):
    self.send({'profile': self.profile})
    self.profile['provider'] = 'fal'
    self.assertFalse(json.loads(self.send({'profile': self.profile})[1])['synced'])
    self.assertEqual(self.cli()['error']['code'], 'BROWSER_CONFIG_UNAVAILABLE')
    self.assertEqual(self.image_server.calls, [])

  def test_changed_endpoint_does_not_reuse_synced_key(self):
    self.send({'profile': self.profile})
    result = self.cli('--base-url', self.profile['baseUrl'] + '/v1', '--model', 'override')
    self.assertEqual(result['error']['code'], 'MISSING_API_KEY')
    self.assertEqual(self.image_server.calls, [])
    record = read_snapshot()
    record['profile']['baseUrl'] = 'https://untrusted.example/v1'
    with self.assertRaises(ValueError):
      snapshot_key(record)

  def test_invalid_url_disables_old_config_without_exposing_url_credentials(self):
    self.send({'profile': self.profile})
    for url in ['https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'https://[broken']:
      self.profile['baseUrl'] = url
      status, raw, _ = self.send({'profile': self.profile})
      self.assertEqual(status, 200)
      self.assertFalse(json.loads(raw)['synced'])
      self.assertNotIn(b'secret', raw)
      self.assertNotIn('encryptedKey', read_snapshot())

  def test_refresh_selected_profile_replaces_saved_configuration(self):
    self.send({'profile': self.profile})
    self.profile.update({'id': 'second', 'model': 'second-model', 'apiKey': 'second-secret'})
    self.send({'profile': self.profile})
    self.assertEqual(read_snapshot()['profile']['model'], 'second-model')
    self.assertEqual(snapshot_key(read_snapshot()), 'second-secret')
    self.assertNotIn(b'second-secret', config_path().read_bytes())

  def test_status_and_static_files_never_return_credentials(self):
    self.send({'profile': self.profile})
    status, raw, headers = self.send(path='/__codex/status')
    self.assertEqual(status, 200)
    self.assertNotIn(b'sync-test-secret', raw)
    self.assertNotIn(b'encryptedKey', raw)
    self.assertEqual(headers['Cache-Control'], 'no-store')
    index = self.send(path='/')[1]
    self.assertIn(b'__PLAYGROUND_LOCAL__', index)
    self.assertNotIn(b'/__codex/bridge.js', index)
    script = self.send(path='/__codex/bridge.js')[1]
    self.assertIn(self.server.sync_token.encode(), script)
    self.assertEqual(self.send(path='/__codex/codex-profile.json')[0], 404)

  def test_url_normalization_matches_browser_rules(self):
    cases = {
      'https://example.com': 'https://example.com/v1',
      'https://example.com/custom': 'https://example.com/custom/v1',
      'https://example.com/custom/': 'https://example.com/custom',
      'https://example.com/v1/ignored': 'https://example.com/v1',
    }
    for given, expected in cases.items():
      self.profile['baseUrl'] = given
      self.send({'profile': self.profile})
      self.assertEqual(read_snapshot()['profile']['baseUrl'], expected)


if __name__ == '__main__':
  unittest.main(verbosity=2)
