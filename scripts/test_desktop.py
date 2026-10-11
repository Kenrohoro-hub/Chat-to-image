"""隔离配置目录及模拟图片服务，验证桌面与独立调用的边界。"""
import base64
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from desktop_config import candidates, read_desktop, save_desktop, report_route, desktop_path, profile_key, settings_snapshot, recover_settings, settings_revision, SettingsConflict
from desktop_host import DesktopApi
from test_playground_image import IMAGE


class Handler(BaseHTTPRequestHandler):
  def log_message(self, *args):
    pass

  def do_GET(self):
    self.server.calls.append((self.path, b''))
    mode = self.server.modes.get('models', 200)
    if self.server.modes.get('block_urllib') and self.headers.get('User-Agent', '').startswith('Python-urllib/'):
      mode = 403
    self.send_response(mode)
    self.end_headers()
    self.wfile.write(json.dumps({'data': [{'id': 'image-a'}, {'id': 'chat-b'}, {'id': 'image-a'}, {}]}).encode())

  def do_POST(self):
    body = self.rfile.read(int(self.headers['Content-Length']))
    profile = self.path.split('/')[1]
    self.server.calls.append((profile, body))
    mode = self.server.modes.get(profile, 200)
    if mode == 'partial':
      mode = 503 if sum(p == profile for p, _ in self.server.calls) > 1 else 200
    if mode == 'first_then_wait':
      mode = 'wait' if sum(p == profile for p, _ in self.server.calls) > 1 else 200
    if mode == 'wait':
      self.server.release.wait(10)
      mode = 200
    if mode == 'disconnect':
      self.close_connection = True
      return
    try:
      self.send_response(mode if isinstance(mode, int) else 200)
      self.end_headers()
      self.wfile.write(json.dumps({'data': [{'b64_json': 'invalid!' if mode == 'bad' else base64.b64encode(IMAGE).decode()}]}).encode())
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
      pass


class DesktopTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='playground-desktop-test-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PLAYGROUND_')}
    env['LOCALAPPDATA'] = str(self.root)
    env['PLAYGROUND_CONFIG_DIR'] = str(self.root / 'user-config')
    environment = patch.dict(os.environ, env, clear=True)
    environment.start()
    self.addCleanup(environment.stop)
    self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    self.server.calls, self.server.modes, self.server.release = [], {}, threading.Event()
    self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
    self.thread.start()
    self.addCleanup(self.server.server_close)
    self.addCleanup(self.server.shutdown)
    self.settings = {'profiles': [self.profile('primary'), self.profile('backup')], 'activeProfileId': 'primary',
      'failover': {'enabled': True, 'primaryId': 'primary', 'slots': ['primary', 'backup'], 'disabledIds': []}}
    save_desktop(self.settings)

  def profile(self, name):
    return {'id': name, 'name': name, 'baseUrl': f'http://127.0.0.1:{self.server.server_port}/{name}/',
      'provider': 'openai', 'apiMode': 'images', 'apiKey': 'mock-desktop-key', 'model': 'test-model', 'timeout': 3}

  def command(self, *extra):
    return [sys.executable, '-B', str(Path(__file__).with_name('playground_image.py')), '--prompt', 'test',
      '--output', str(self.root / 'outputs'), *extra]

  def run_cli(self, *extra):
    proc = subprocess.run(self.command(*extra), capture_output=True, timeout=15)
    self.assertNotIn(b'mock-desktop-key', proc.stdout + proc.stderr)
    return json.loads(proc.stdout)

  def test_model_limits_are_shared_and_skip_incompatible_backup(self):
    self.settings['profiles'][0]['imageCapabilities'] = {'test-model': {'qualities': ['high']}}
    self.settings['profiles'][1]['imageCapabilities'] = {'test-model': {'qualities': ['low']}}
    save_desktop(self.settings)
    self.assertEqual(read_desktop(False)['profiles'][0]['imageCapabilities'], self.settings['profiles'][0]['imageCapabilities'])
    self.server.modes['primary'] = 401
    result = self.run_cli('--saved-profile', 'primary', '--quality', 'high')
    self.assertFalse(result['ok'])
    self.assertEqual(result['error']['code'], 'MODEL_CAPABILITY')
    self.assertEqual([p for p, _ in self.server.calls], ['primary'])

  def test_backup_size_rule_does_not_relax_primary_validation(self):
    self.settings['profiles'][1]['imageCapabilities'] = {'test-model': {'sizes': ['512x512']}}
    save_desktop(self.settings)
    result = self.run_cli('--saved-profile', 'primary', '--size', '512x512')
    self.assertTrue(result['ok'], result)
    self.assertEqual([p for p, _ in self.server.calls], ['backup'])

  def test_model_limits_use_each_candidates_actual_model(self):
    self.settings['profiles'][0].update(model='image-a', models=['image-a'], imageCapabilities={'image-a': {'qualities': ['high']}})
    self.settings['profiles'][1].update(model='image-b', models=['image-b'], imageCapabilities={'image-b': {'qualities': ['high']}})
    save_desktop(self.settings)
    self.server.modes['primary'] = 401
    result = self.run_cli('--saved-profile', 'primary', '--quality', 'high')
    self.assertTrue(result['ok'], result)
    self.assertEqual(result['used_profile']['model'], 'image-b')
    self.assertEqual([json.loads(raw)['model'] for _, raw in self.server.calls], ['image-a', 'image-b'])

  def test_prompt_image_download_validates_source_type_and_page(self):
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:12345'
    api._window = type('Window', (), {'get_current_url': lambda _: api._origin})()
    response = MagicMock()
    response.__enter__.return_value = response
    response.headers.get_content_type.return_value = 'image/png'
    response.read.return_value = IMAGE
    with patch('desktop_host.urllib.request.build_opener') as opener:
      opener.return_value.open.return_value = response
      url = 'https://r2.qqsrc.com/images/originals/1.png'
      result = api.download_prompt_image(url)
      self.assertEqual(base64.b64decode(result['dataUrl'].split(',')[1]), IMAGE)
      request = opener.return_value.open.call_args.args[0]
      self.assertEqual(request.full_url, url)
      self.assertFalse(request.has_header('Authorization'))
      response.read.assert_called_with(32 * 1024 * 1024 + 1)
      from playground_image import NoRedirect
      opener.assert_called_with(NoRedirect)
      for invalid in ['http://r2.qqsrc.com/images/1.png', 'https://evil.example/images/1.png', 'https://r2.qqsrc.com/images/../x', 'https://r2.qqsrc.com/images/1.png?x=1', 1]:
        with self.assertRaises(ValueError): api.download_prompt_image(invalid)
      self.assertEqual(opener.return_value.open.call_count, 1)
      response.headers.get_content_type.return_value = 'text/html'
      with self.assertRaisesRegex(ValueError, '图片格式'): api.download_prompt_image(url)
      response.headers.get_content_type.return_value = 'image/png'
      response.read.return_value = b''
      with self.assertRaisesRegex(ValueError, '为空'): api.download_prompt_image(url)
      response.read.return_value = b'x' * (32 * 1024 * 1024 + 1)
      with self.assertRaisesRegex(ValueError, '32 MB'): api.download_prompt_image(url)
      api._window = type('Window', (), {'get_current_url': lambda _: 'https://example.com'})()
      with self.assertRaisesRegex(ValueError, '当前页面'): api.download_prompt_image(url)

  def test_added_prompt_sources_and_public_youmind_catalog(self):
    api = DesktopApi()
    response = MagicMock()
    response.__enter__.return_value = response
    response.headers.get_content_type.return_value = 'image/png'
    response.read.return_value = IMAGE
    with patch.object(api, '_check'), patch('desktop_host.urllib.request.build_opener') as opener:
      opener.return_value.open.return_value = response
      for url in ['https://s3.bmp.ovh/imgs/a.png', 'https://cms-assets.youmind.com/media/a.png', 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/a.jpg']:
        self.assertIn('dataUrl', api.download_prompt_image(url))
      response.read.return_value = json.dumps({'page': 2, 'totalPages': 4, 'prompts': [{'id': 2}]}).encode()
      self.assertEqual(api.read_youmind_prompts(2), {'prompts': [{'id': 2}], 'totalPages': 4})
      request = opener.return_value.open.call_args.args[0]
      self.assertEqual(request.full_url, 'https://youmind.com/youmarketing-api/prompts')
      self.assertEqual(json.loads(request.data)['page'], 2)
      self.assertEqual(json.loads(request.data)['limit'], 100)
      self.assertEqual(request.get_header('Referer'), 'https://youmind.com/zh-CN/nano-banana-pro-prompts/explore')
      self.assertFalse(request.has_header('Authorization'))
      for page in [True, 0, 1001, '1']:
        with self.assertRaisesRegex(ValueError, '页码'): api.read_youmind_prompts(page)
      for result in [{'page': 1, 'totalPages': 4, 'prompts': []}, {'page': 2, 'totalPages': True, 'prompts': []}]:
        response.read.return_value = json.dumps(result).encode()
        with self.assertRaisesRegex(ValueError, '格式'): api.read_youmind_prompts(2)
      response.read.return_value = b'x' * (8 * 1024 * 1024 + 1)
      with self.assertRaisesRegex(ValueError, '大小限制'): api.read_youmind_prompts(2)
    with patch.object(api, '_check', side_effect=ValueError('当前页面')):
      with self.assertRaisesRegex(ValueError, '当前页面'): api.read_youmind_prompts(1)

  def test_heroprompt_reader_and_new_image_hosts_are_bounded(self):
    api = DesktopApi()
    response = MagicMock()
    response.__enter__.return_value = response
    response.headers.get_content_type.return_value = 'image/png'
    response.read.return_value = IMAGE
    with patch.object(api, '_check'), patch('desktop_host.urllib.request.build_opener') as opener:
      opener.return_value.open.return_value = response
      for url in ['https://turing-img.animelook.top/pic/a.jpg', 'https://banana-prompt.nanoprompts.org/handbook/a.webp', 'https://pbs.twimg.com/media/test?format=jpg&name=orig']:
        self.assertIn('dataUrl', api.download_prompt_image(url))
      for url in ['https://pbs.twimg.com/media/test?format=html&name=orig', 'https://pbs.twimg.com/media/test?format=jpg&name=orig&url=http://localhost', 'https://pbs.twimg.com/profile_images/a.jpg', 'https://banana-prompt.nanoprompts.org/../a.webp']:
        with self.assertRaises(ValueError): api.download_prompt_image(url)
      response.read.return_value = json.dumps({'posts': [{'id': 'a'}], 'total': 101}).encode()
      self.assertEqual(api.read_heroprompt_posts(2), {'prompts': [{'id': 'a'}], 'totalPages': 3})
      request = opener.return_value.open.call_args.args[0]
      self.assertEqual(request.full_url, 'https://heroprompt.sortes.ai/api/posts?offset=50&limit=50&q=&tags=&sort=new')
      self.assertFalse(request.has_header('Authorization'))
      for page in [True, 0, 1001, '1']:
        with self.assertRaisesRegex(ValueError, '页码'): api.read_heroprompt_posts(page)
      response.read.return_value = json.dumps({'posts': [], 'total': -1}).encode()
      with self.assertRaisesRegex(ValueError, '格式'): api.read_heroprompt_posts(1)
    with patch.object(api, '_check', side_effect=ValueError('当前页面')):
      with self.assertRaisesRegex(ValueError, '当前页面'): api.read_heroprompt_posts(1)

  def test_model_directory_errors_are_safe_and_specific(self):
    api = DesktopApi()
    profile = {'baseUrl': 'https://example.test/v1', 'apiKey': 'mock-key'}
    with patch.object(api, '_check'), patch('desktop_host.urllib.request.build_opener') as opener:
      for error, expected in [(TimeoutError('private timeout'), '超时'), (urllib.error.URLError('private network'), '连接失败')]:
        opener.return_value.open.side_effect = error
        with self.assertRaisesRegex(ValueError, expected) as caught:
          api.list_models(profile)
        self.assertNotIn('private', str(caught.exception))
      opener.return_value.open.side_effect = None
      opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'<html>private response</html>'
      with self.assertRaisesRegex(ValueError, '兼容的模型目录'):
        api.list_models(profile)

  def test_dynamic_group_limits_and_draft_directory(self):
    settings = dict(self.settings)
    settings['profiles'] = [self.profile(f'g{i}') for i in range(10)] + [{**self.profile(f'a{i}'), 'apiMode': 'responses'} for i in range(10)]
    settings['activeProfileId'] = 'g0'
    settings['failover'] = {'enabled': True, 'primaryId': 'g0', 'slots': [f'g{i}' for i in range(10)], 'disabledIds': ['g1']}
    settings['agentFailover'] = {'enabled': True, 'primaryId': 'a0', 'slots': [f'a{i}' for i in range(10)], 'disabledIds': ['a1']}
    save_desktop(settings)
    before = desktop_path().read_bytes()
    api = DesktopApi()
    with patch.object(api, '_check'):
      self.assertEqual(api.list_models({'baseUrl': settings['profiles'][0]['baseUrl'], 'apiKey': 'mock-draft-key'})['ids'], ['image-a', 'chat-b'])
      with self.assertRaises(ValueError):
        api.list_models({'baseUrl': 'https://user:secret@example.test', 'apiKey': 'mock-key'})
    self.assertEqual(desktop_path().read_bytes(), before)
    for mode in ('images', 'responses'):
      with self.assertRaisesRegex(ValueError, '10'):
        save_desktop({**settings, 'profiles': settings['profiles'] + [{**self.profile('extra'), 'apiMode': mode}]})
    self.assertEqual(desktop_path().read_bytes(), before)

  def test_primary_and_encryption(self):
    self.assertNotIn('mock-desktop-key', desktop_path().read_text())
    self.assertEqual(read_desktop(True)['profiles'][0]['apiKey'], 'mock-desktop-key')
    result = self.run_cli()
    self.assertTrue(result['ok'])
    self.assertEqual(result['used_profile']['id'], 'primary')

  def test_unreadable_settings_require_explicit_recovery_and_preserve_original(self):
    original = desktop_path().read_bytes()
    revision = settings_revision()
    with patch('desktop_config.protect', side_effect=ValueError('decrypt failed')):
      snapshot = settings_snapshot()
      self.assertIsNone(snapshot['settings'])
      self.assertIn('无法解密', snapshot['error'])
      self.assertEqual(snapshot['revision'], revision)
      self.assertEqual(desktop_path().read_bytes(), original)
      with self.assertRaises(SettingsConflict):
        recover_settings('stale')
      self.assertEqual(desktop_path().read_bytes(), original)
      with self.assertRaises(ValueError):
        recover_settings(revision)
      self.assertEqual(desktop_path().read_bytes(), original)
    from playground_config import protect
    def decrypt_failure(data, decrypt=False):
      if decrypt:
        raise ValueError('decrypt failed')
      return protect(data)
    with patch('desktop_config.protect', side_effect=decrypt_failure):
      result = recover_settings(revision)
    self.assertTrue(result['ok'])
    backups = list(desktop_path().parent.glob('desktop-settings.unreadable-*.json'))
    self.assertEqual(len(backups), 1)
    self.assertEqual(backups[0].read_bytes(), original)
    self.assertFalse(read_desktop(True)['profiles'][0].get('apiKey'))
    fresh = desktop_path().read_bytes()
    with self.assertRaises(ValueError):
      recover_settings(settings_revision())
    self.assertEqual(desktop_path().read_bytes(), fresh)

  def test_model_directory_saved_config_and_failure(self):
    api = DesktopApi()
    with patch.object(api, '_check'):
      self.assertEqual(api.list_models('primary')['ids'], ['image-a', 'chat-b'])
      self.assertEqual(self.server.calls[0][0], '/primary/models')
      self.server.modes['models'] = 401
      with self.assertRaisesRegex(ValueError, '401'):
        api.list_models('primary')
      self.assertEqual(read_desktop(True)['profiles'][0]['model'], 'test-model')

  def test_model_directory_uses_app_client_when_default_urllib_is_blocked(self):
    self.server.modes['block_urllib'] = True
    api = DesktopApi()
    with patch.object(api, '_check'):
      self.assertEqual(api.list_models('primary')['ids'], ['image-a', 'chat-b'])

  def test_selected_image_model_routes_only_to_enabled_matches(self):
    self.settings['profiles'][0]['models'] = ['test-model', 'chosen-model']
    self.settings['profiles'][1]['models'] = ['test-model']
    save_desktop(self.settings)
    result = self.run_cli('--saved-profile', 'primary', '--saved-model', 'chosen-model')
    self.assertTrue(result['ok'])
    self.assertEqual(result['used_profile']['model'], 'chosen-model')
    self.assertEqual(json.loads(self.server.calls[0][1])['model'], 'chosen-model')
    self.server.calls.clear()
    self.server.modes['primary'] = 401
    result = self.run_cli('--saved-profile', 'primary', '--saved-model', 'chosen-model')
    self.assertFalse(result['ok'])
    self.assertEqual([p for p, _ in self.server.calls], ['primary'])

  def test_refusal_and_batch_cooldown(self):
    self.server.modes['primary'] = 401
    result = self.run_cli('--count', '2', '--concurrency', '1')
    self.assertTrue(result['ok'])
    self.assertEqual([p for p, _ in self.server.calls], ['primary', 'backup', 'backup'])
    self.assertEqual(len(result['images']), 2)

  def test_automatic_generation_keeps_different_backup_default_model(self):
    self.settings['profiles'][0].update(model='image-a', models=['image-a'])
    self.settings['profiles'][1].update(model='image-b', models=['image-b'])
    save_desktop(self.settings)
    self.server.modes['primary'] = 401
    api = DesktopApi()
    with patch.object(api, '_check'):
      result = api.generate({'profileId': 'primary', 'prompt': 'test', 'params': {'n': 1}, 'inputImageDataUrls': []})
    self.assertTrue(result['ok'])
    self.assertEqual(result['usedProfile']['model'], 'image-b')
    self.assertEqual([(profile, json.loads(body)['model']) for profile, body in self.server.calls], [('primary', 'image-a'), ('backup', 'image-b')])

  def test_missing_primary_key_and_invalid_address(self):
    self.settings['profiles'][0]['apiKey'] = ''
    save_desktop(self.settings)
    self.assertEqual(self.run_cli()['used_profile']['id'], 'backup')
    self.settings['profiles'][0]['baseUrl'] = ''
    save_desktop(self.settings)
    self.assertEqual(self.run_cli()['used_profile']['id'], 'backup')

  def test_uncertain_or_decoding_failure_never_resubmits(self):
    for mode in ('disconnect', 503, 'bad'):
      with self.subTest(mode=mode):
        report_route('primary', True)
        self.server.calls.clear()
        self.server.modes['primary'] = mode
        result = self.run_cli()
        self.assertFalse(result['ok'])
        self.assertEqual([p for p, _ in self.server.calls], ['primary'])

  def test_all_refused_and_disabled_backup(self):
    self.server.modes.update(primary=429, backup=403)
    self.assertEqual(self.run_cli()['attempted_requests'], 2)
    self.settings['failover']['disabledIds'] = ['backup']
    save_desktop(self.settings)
    self.assertEqual(self.run_cli()['attempted_requests'], 1)

  def test_switch_off_uses_primary_even_when_backup_selected(self):
    self.settings['failover']['enabled'] = False
    save_desktop(self.settings)
    self.assertEqual(self.run_cli('--saved-profile', 'backup')['used_profile']['id'], 'primary')

  def test_separate_agent_pool_is_encrypted_and_validated(self):
    agent = {**self.profile('agent'), 'apiMode': 'responses', 'streamImages': True, 'models': ['chat-a', 'chat-b']}
    self.settings['agentModel'] = 'chat-b'
    self.settings['agentImageTools'] = False
    self.settings['profiles'].append(agent)
    pool = {'enabled': True, 'primaryId': 'agent', 'slots': ['agent'], 'disabledIds': ['agent']}
    self.settings['agentFailover'] = pool
    save_desktop(self.settings)
    self.assertEqual(read_desktop(True)['agentFailover'], pool)
    self.assertEqual(read_desktop(True)['profiles'][-1]['models'], ['chat-a', 'chat-b'])
    self.assertEqual(read_desktop(True)['agentModel'], 'chat-b')
    self.assertFalse(read_desktop(True)['agentImageTools'])
    self.assertEqual([p['id'] for p in candidates()], ['primary', 'backup'])
    self.assertNotIn('mock-desktop-key', desktop_path().read_text())
    self.settings['agentFailover'] = {**pool, 'primaryId': 'primary', 'slots': ['primary'], 'disabledIds': []}
    with self.assertRaises(ValueError): save_desktop(self.settings)
    self.settings['agentFailover'] = {**pool, 'slots': ['agent'] * 6}
    with self.assertRaises(ValueError): save_desktop(self.settings)

  def test_single_profile_can_be_disabled_saved_and_enabled(self):
    self.settings['profiles'] = self.settings['profiles'][:1]
    self.settings['failover'].update(slots=['primary'], disabledIds=['primary'])
    save_desktop(self.settings)
    self.assertEqual(read_desktop(True)['failover']['disabledIds'], ['primary'])
    self.assertEqual(candidates(), [])
    self.assertEqual(self.run_cli()['error']['code'], 'NO_AVAILABLE_PROFILE')
    self.assertEqual(self.server.calls, [])
    self.settings['failover']['disabledIds'] = []
    save_desktop(self.settings)
    self.assertTrue(self.run_cli()['ok'])
    self.assertEqual([p for p, _ in self.server.calls], ['primary'])

  def test_disabled_primary_only_uses_backup_when_switch_enabled(self):
    self.settings['failover']['disabledIds'] = ['primary']
    save_desktop(self.settings)
    self.assertEqual(self.run_cli()['used_profile']['id'], 'backup')
    self.settings['failover']['enabled'] = False
    save_desktop(self.settings)
    self.server.calls.clear()
    self.assertEqual(self.run_cli()['error']['code'], 'NO_AVAILABLE_PROFILE')
    self.assertEqual(self.server.calls, [])

  def test_partial_results_and_edit_payload(self):
    self.server.modes['primary'] = 'partial'
    result = self.run_cli('--count', '2')
    self.assertFalse(result['ok'])
    self.assertEqual(len(result['images']), 1)
    self.assertTrue(Path(result['images'][0]['path']).exists())
    reference = self.root / 'reference.png'
    reference.write_bytes(IMAGE)
    self.server.modes.clear()
    result = self.run_cli('--image', str(reference), '--mask', str(reference), '--quality', 'high', '--moderation', 'low')
    self.assertTrue(result['ok'])
    self.assertIn(b'name="mask"', self.server.calls[-1][1])

  def test_pool_limit_and_sensitive_url_rejected(self):
    self.settings['profiles'][0]['baseUrl'] = 'https://example.com/?key=secret'
    with self.assertRaises(ValueError): save_desktop(self.settings)
    self.settings['profiles'] = [self.profile(str(i)) for i in range(11)]
    self.settings['failover'].update(slots=[str(i) for i in range(11)], primaryId='0')
    with self.assertRaises(ValueError): save_desktop(self.settings)

  def test_host_shutdown_does_not_kill_independent_cli(self):
    self.server.modes['primary'] = 'wait'
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:12345'
    api._window = type('Window', (), {'get_current_url': lambda _: api._origin})()
    independent = subprocess.Popen(self.command(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
      with ThreadPoolExecutor(max_workers=1) as executor:
        ui = executor.submit(api.generate, {'prompt': 'test', 'profileId': 'primary', 'params': {}})
        deadline = time.monotonic() + 8
        while len(self.server.calls) < 2 and time.monotonic() < deadline:
          time.sleep(.05)
        self.assertEqual(len(self.server.calls), 2)
        api._stop()
        self.assertIsNone(independent.poll())
        self.server.release.set()
        self.assertFalse(ui.result(timeout=5)['ok'])
      output, _ = independent.communicate(timeout=5)
      self.assertTrue(json.loads(output)['ok'])
      self.assertTrue(self.run_cli()['ok'])
    finally:
      self.server.release.set()
      if independent.poll() is None: independent.terminate()
      independent.wait()
      api._stop()

  def test_model_removed_before_submission_is_not_sent(self):
    from argparse import Namespace
    from playground_image import submit_image, CallError
    profile = read_desktop()['profiles'][0]
    self.settings['profiles'][0]['models'] = ['other-model']
    save_desktop(self.settings)
    with self.assertRaises(ValueError):
      profile_key(profile, 'test-model')
    profile['_desktop_candidates'] = [profile.copy()]
    profile['_desktop_selected'] = 'primary'
    with self.assertRaises(CallError):
      submit_image(Namespace(saved_model='test-model'), profile, {}, [], None, '', '', {})
    self.assertEqual(self.server.calls, [])

  def test_cancel_request_keeps_other_ui_and_independent_processes(self):
    self.server.modes['primary'] = 'wait'
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:12345'
    api._window = type('Window', (), {'get_current_url': lambda _: api._origin})()
    independent = subprocess.Popen(self.command(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
      with ThreadPoolExecutor(max_workers=2) as executor:
        cancelled = executor.submit(api.generate, {'requestId': 'cancel-me', 'prompt': 'test', 'profileId': 'primary', 'params': {}})
        other = executor.submit(api.generate, {'requestId': 'keep-me', 'prompt': 'test', 'profileId': 'primary', 'params': {}})
        deadline = time.monotonic() + 8
        while len(self.server.calls) < 3 and time.monotonic() < deadline:
          time.sleep(.05)
        self.assertEqual(len(self.server.calls), 3)
        api.cancel_generation('cancel-me')
        self.assertFalse(cancelled.result(timeout=5)['ok'])
        self.assertIsNone(independent.poll())
        self.assertIsNone(api._requests['keep-me'].poll())
        self.server.release.set()
        self.assertTrue(other.result(timeout=5)['ok'])
      output, _ = independent.communicate(timeout=5)
      self.assertTrue(json.loads(output)['ok'])
      api.cancel_generation('before-submit')
      with self.assertRaisesRegex(ValueError, '未提交'):
        api.generate({'requestId': 'before-submit', 'prompt': 'test', 'profileId': 'primary', 'params': {}})
      self.assertEqual(len(self.server.calls), 3)
    finally:
      self.server.release.set()
      if independent.poll() is None: independent.terminate()
      independent.wait()
      api._stop()

  def test_cancel_batch_returns_already_completed_images(self):
    self.server.modes['primary'] = 'first_then_wait'
    api = DesktopApi()
    with patch.object(api, '_check'), ThreadPoolExecutor(max_workers=1) as executor:
      job = executor.submit(api.generate, {'requestId': 'partial-cancel', 'prompt': 'test', 'profileId': 'primary', 'params': {'n': 3}})
      try:
        deadline = time.monotonic() + 8
        while len(self.server.calls) < 2 and time.monotonic() < deadline: time.sleep(.02)
        self.assertEqual(len(self.server.calls), 2)
        api.cancel_generation('partial-cancel')
        result = job.result(timeout=5)
        self.assertFalse(result['ok'])
        self.assertEqual(len(result['images']), 1)
        self.assertEqual(result['actualParamsList'], [{'size': '1024x1024'}])
      finally:
        self.server.release.set()
        api._stop()

  def test_limits_desktop_requests_and_cancels_waiting_request(self):
    self.server.modes['primary'] = 'wait'
    api = DesktopApi()
    with patch.object(api, '_check'), ThreadPoolExecutor(max_workers=3) as executor:
      jobs = [executor.submit(api.generate, {'requestId': f'limit-{i}', 'prompt': 'test', 'profileId': 'primary', 'params': {}}) for i in range(3)]
      try:
        deadline = time.monotonic() + 8
        while len(self.server.calls) < 2 and time.monotonic() < deadline: time.sleep(.02)
        time.sleep(.15)
        self.assertEqual(len(self.server.calls), 2)
        waiting = next(f'limit-{i}' for i in range(3) if f'limit-{i}' not in api._requests)
        api.cancel_generation(waiting)
        self.server.release.set()
        for job in jobs:
          try: job.result(timeout=5)
          except ValueError as error: self.assertIn('未提交', str(error))
        self.assertEqual(len(self.server.calls), 2)
      finally:
        self.server.release.set()
        api._stop()

  def test_foreign_page_cannot_read_settings(self):
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:12345'
    api._window = type('Window', (), {'get_current_url': lambda _: 'https://example.com'})()
    with self.assertRaises(ValueError): api.load_settings()

  def test_host_returns_images_and_actual_profile(self):
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:12345'
    api._window = type('Window', (), {'get_current_url': lambda _: api._origin})()
    self.server.modes['primary'] = 401
    result = api.generate({'prompt': 'test', 'profileId': 'primary', 'params': {'n': 2}})
    self.assertTrue(result['ok'])
    self.assertEqual(len(result['images']), 2)
    self.assertTrue(result['images'][0].startswith('data:image/png;base64,'))
    self.assertEqual(result['usedProfiles'][0]['id'], 'backup')
    self.assertEqual(result['actualParamsList'][0]['size'], '1024x1024')
    self.assertFalse(api._processes)

  def test_streaming_stays_outside_pool(self):
    self.settings['profiles'][0]['streamImages'] = True
    with self.assertRaises(ValueError): save_desktop(self.settings)

  def test_stop_continues_after_one_process_wait_fails(self):
    from unittest.mock import Mock
    stuck = Mock()
    stuck.poll.return_value = None
    stuck.wait.side_effect = subprocess.TimeoutExpired('mock', 5)
    other = Mock()
    other.poll.return_value = None
    api = DesktopApi()
    api._processes = {stuck, other}
    api._stop()
    stuck.kill.assert_called_once()
    other.terminate.assert_called_once()


if __name__ == '__main__':
  unittest.main()
