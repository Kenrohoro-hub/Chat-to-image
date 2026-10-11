"""调用真实 CLI 及本机 HTTP 服务，验证边界行为；不使用真实图片服务。"""

import base64
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib


SCRIPT = Path(__file__).with_name('playground_image.py')


def png(width=1024, height=1024, alpha=True):
  def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
  pixels = (b'\x00' + (b'\x14\x78\xd0\x00' if alpha else b'\x14\x78\xd0') * width) * height
  return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6 if alpha else 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


IMAGE = png()


class Handler(BaseHTTPRequestHandler):
  def log_message(self, *args):
    pass

  def do_POST(self):
    raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
    self.server.calls.append({'path': self.path, 'body': raw, 'headers': dict(self.headers)})
    mode = self.server.mode
    if mode == 'concurrent':
      with self.server.counter_lock:
        self.server.active += 1
        self.server.peak = max(self.server.peak, self.server.active)
      time.sleep(.15)
      with self.server.counter_lock: self.server.active -= 1
    if (mode == 'partial' and len(self.server.calls) == 2) or mode == 'error':
      self.send_response(503)
      self.end_headers()
      self.wfile.write(b'{"error":{"message":"mock-secret-must-not-leak"}}')
      return
    if mode == 'disconnect':
      self.close_connection = True
      return
    if mode == 'redirect':
      self.send_response(307)
      self.send_header('Location', '/redirected')
      self.end_headers()
      return
    if mode == 'async':
      self.send_response(202)
      self.end_headers()
      self.wfile.write(b'{"task_id":"pending"}')
      return
    self.send_response(200)
    self.send_header('Content-Type', 'application/json')
    self.send_header('x-request-id', 'request-local-test')
    self.end_headers()
    item = {'b64_json': base64.b64encode(IMAGE).decode()}
    if mode == 'url':
      item = {'url': f'http://127.0.0.1:{self.server.server_port}/result.png?signature=local'}
    if mode == 'bad_base64':
      item = {'b64_json': 'not-an-image!'}
    if mode == 'html_image':
      item = {'b64_json': base64.b64encode(b'<html>error</html>').decode()}
    self.wfile.write(json.dumps({'data': [item]}).encode())

  def do_GET(self):
    self.server.downloads.append(dict(self.headers))
    self.send_response(200)
    self.send_header('Content-Type', 'image/png')
    self.end_headers()
    self.wfile.write(IMAGE)


class InterfaceTests(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
    cls.thread.start()

  @classmethod
  def tearDownClass(cls):
    cls.server.shutdown()
    cls.server.server_close()
    cls.thread.join()

  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='playground-cli-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    self.server.mode = 'normal'
    self.server.calls = []
    self.server.downloads = []
    self.env = {k: v for k, v in os.environ.items() if not k.startswith('PLAYGROUND_')}
    self.env['PLAYGROUND_CONFIG_DIR'] = str(self.root / 'user-config')
    self.env['LOCALAPPDATA'] = str(self.root)
    self.env['PLAYGROUND_API_KEY'] = 'mock-secret-must-not-leak'
    self.base = f'http://127.0.0.1:{self.server.server_port}/v1'

  def run_cli(self, *args, configured=True):
    command = [sys.executable, '-B', str(SCRIPT)]
    if configured:
      command += ['--base-url', self.base, '--model', 'mock-image']
    output = subprocess.run(command + ['--output', str(self.root / 'outputs')] + list(args), cwd=self.root, env=self.env, capture_output=True, encoding='utf-8', timeout=15)
    self.assertEqual(output.stderr, '')
    self.assertNotIn('mock-secret-must-not-leak', output.stdout)
    result = json.loads(output.stdout)
    self.assertEqual(output.returncode, 0 if result['ok'] else 1)
    return result

  def test_model_capabilities_allow_declared_small_size_and_block_unsupported_request(self):
    config = self.root / 'model.json'
    config.write_text(json.dumps({'baseUrl': self.base, 'model': 'mock-image', 'imageCapabilities': {'mock-image': {'sizes': ['512x512'], 'qualities': ['high'], 'transparent': False, 'maxInputImages': 0}}}), encoding='utf-8')
    result = self.run_cli('--config', str(config), '--prompt', 'test', '--size', '512x512', '--quality', 'high', configured=False)
    self.assertTrue(result['ok'], result)
    self.assertEqual(json.loads(self.server.calls[0]['body'])['size'], '512x512')
    result = self.run_cli('--config', str(config), '--prompt', 'test', '--size', '512x512', '--quality', 'low', configured=False)
    self.assertFalse(result['ok'])
    self.assertEqual(result['error']['code'], 'MODEL_CAPABILITY')
    self.assertEqual(len(self.server.calls), 1)

  def test_invalid_declared_size_cannot_bypass_validation(self):
    config = self.root / 'model.json'
    config.write_text(json.dumps({'baseUrl': self.base, 'model': 'mock-image', 'imageCapabilities': {'mock-image': {'sizes': ['bogus']}}}), encoding='utf-8')
    result = self.run_cli('--config', str(config), '--prompt', 'test', '--size', 'bogus', configured=False)
    self.assertFalse(result['ok'])
    self.assertEqual(len(self.server.calls), 0)

  def test_generate_and_prompt_file_unicode(self):
    prompt = '中文海报\n包含 "引号" 和 $符号'
    (self.root / '提示词.txt').write_text(prompt, encoding='utf-8-sig')
    result = self.run_cli('--prompt-file', '提示词.txt', '--output', '中文结果/图.png')
    self.assertTrue(result['ok'])
    self.assertEqual((self.root / '中文结果/图.png').read_bytes(), IMAGE)
    self.assertEqual(result['images'][0]['width'], 1024)
    self.assertEqual(result['request_ids'], ['request-local-test'])
    self.assertEqual(len(self.server.calls), 1)
    call = self.server.calls[0]
    self.assertEqual(call['path'], '/v1/images/generations')
    self.assertEqual(call['headers']['Authorization'], 'Bearer mock-secret-must-not-leak')
    body = json.loads(call['body'])
    self.assertEqual(body['prompt'], prompt)
    self.assertEqual(body['n'], 1)
    self.assertNotIn('response_format', body)
    self.assertNotIn('stream', body)

  def test_edit_multiple_images_and_mask(self):
    for name in ['reference.png', 'style.png', 'mask.png']:
      (self.root / name).write_bytes(IMAGE)
    result = self.run_cli('--prompt', '蓝色背景', '--image', 'reference.png', '--image', 'style.png', '--mask', 'mask.png')
    self.assertTrue(result['ok'])
    call = self.server.calls[0]
    self.assertEqual(call['path'], '/v1/images/edits')
    message = BytesParser(policy=policy.default).parsebytes(b'Content-Type: ' + call['headers']['Content-Type'].encode() + b'\r\n\r\n' + call['body'])
    images = [part for part in message.iter_parts() if part.get_param('name', header='content-disposition') == 'image[]']
    masks = [part for part in message.iter_parts() if part.get_param('name', header='content-disposition') == 'mask']
    self.assertEqual(len(images), 2)
    self.assertEqual(len(masks), 1)
    self.assertTrue(all(part.get_payload(decode=True) == IMAGE for part in images + masks))

  def test_dry_run_no_key_no_network_no_output(self):
    del self.env['PLAYGROUND_API_KEY']
    result = self.run_cli('--prompt', 'preview', '--size', '4k-portrait', '--dry-run')
    self.assertTrue(result['ok'])
    self.assertEqual(result['size'], '2160x3840')
    self.assertEqual(result['images'], [])
    self.assertEqual(list(self.root.iterdir()), [])
    self.assertEqual(self.server.calls, [])

  def test_config_selection_and_response_format(self):
    profiles = [
      {'id': 'other', 'baseUrl': 'https://example.invalid/v1', 'model': 'other'},
      {'id': 'mine', 'baseUrl': self.base, 'model': 'from-profile', 'responseFormatB64Json': True},
    ]
    (self.root / 'config.json').write_text(json.dumps({'profiles': profiles}), encoding='utf-8')
    ambiguous = self.run_cli('--config', 'config.json', '--prompt', 'x', configured=False)
    self.assertEqual(ambiguous['error']['code'], 'INVALID_CONFIG')
    result = self.run_cli('--config', 'config.json', '--profile', 'mine', '--prompt', 'x', configured=False)
    self.assertTrue(result['ok'])
    self.assertEqual(json.loads(self.server.calls[0]['body'])['response_format'], 'b64_json')
    self.assertEqual(result['model'], 'from-profile')

  def test_batch_uses_two_requests_at_most(self):
    self.server.mode = 'concurrent'
    self.server.counter_lock = threading.Lock()
    self.server.active = self.server.peak = 0
    result = self.run_cli('--prompt', 'test', '--count', '4')
    self.assertTrue(result['ok'])
    self.assertEqual(len(result['images']), 4)
    self.assertEqual(len(self.server.calls), 4)
    self.assertEqual(self.server.peak, 2)

  def test_batch_partial_failure_keeps_saved_files_and_does_not_retry(self):
    self.server.mode = 'partial'
    result = self.run_cli('--prompt', 'x', '--count', '3', '--concurrency', '1')
    self.assertFalse(result['ok'])
    self.assertEqual(len(self.server.calls), 2)
    self.assertEqual(result['attempted_requests'], 2)
    self.assertEqual(result['completed_requests'], 1)
    self.assertEqual(len(result['images']), 1)
    self.assertEqual(len(list((self.root / 'outputs').iterdir())), 1)
    self.assertEqual(Path(result['images'][0]['path']).read_bytes(), IMAGE)

  def test_url_download_has_no_bearer_key(self):
    self.server.mode = 'url'
    result = self.run_cli('--prompt', 'x')
    self.assertTrue(result['ok'])
    self.assertEqual(len(self.server.downloads), 1)
    self.assertNotIn('Authorization', self.server.downloads[0])

  def test_existing_output_prevents_request(self):
    (self.root / 'existing.png').write_bytes(b'keep-me')
    result = self.run_cli('--prompt', 'x', '--output', 'existing.png')
    self.assertEqual(result['error']['code'], 'OUTPUT_EXISTS')
    self.assertEqual((self.root / 'existing.png').read_bytes(), b'keep-me')
    self.assertEqual(self.server.calls, [])

  def test_output_parent_error_prevents_request(self):
    (self.root / 'blocked').write_text('file', encoding='utf-8')
    result = self.run_cli('--prompt', 'x', '--output', 'blocked/image.png')
    self.assertFalse(result['ok'])
    self.assertEqual(result['attempted_requests'], 0)
    self.assertEqual(self.server.calls, [])

  def test_missing_key_prevents_request(self):
    del self.env['PLAYGROUND_API_KEY']
    result = self.run_cli('--prompt', 'x')
    self.assertEqual(result['error']['code'], 'MISSING_API_KEY')
    self.assertEqual(list(self.root.iterdir()), [])
    self.assertEqual(self.server.calls, [])

  def test_invalid_arguments_prevent_request(self):
    for args in [('--mask', 'mask.png'), ('--count', '0'), ('--size', '0x1024'), ('--size', '9999x9999'), ('--size', '1025x1024'), ('--format', 'jpeg', '--background', 'transparent'), ('--count', '2', '--output', 'single.png'), ('--format', 'webp', '--output', 'wrong.png')]:
      with self.subTest(args=args):
        result = self.run_cli('--prompt', 'x', *args)
        self.assertFalse(result['ok'])
    self.assertEqual(self.server.calls, [])

  def test_mask_must_have_alpha_and_match_reference(self):
    (self.root / 'reference.png').write_bytes(IMAGE)
    for data in [png(512, 512), png(alpha=False)]:
      (self.root / 'mask.png').write_bytes(data)
      result = self.run_cli('--prompt', 'x', '--image', 'reference.png', '--mask', 'mask.png')
      self.assertEqual(result['error']['code'], 'INVALID_MASK')
    self.assertEqual(self.server.calls, [])

  def test_redirect_and_async_are_not_followed_or_retried(self):
    for mode in ['redirect', 'async']:
      self.server.mode = mode
      before = len(self.server.calls)
      result = self.run_cli('--prompt', 'x')
      self.assertFalse(result['ok'])
      self.assertEqual(len(self.server.calls), before + 1)
      self.assertEqual(result['images'], [])
      self.assertEqual(list((self.root / 'outputs').iterdir()), [])

  def test_bad_response_does_not_leave_fake_image_or_retry(self):
    for mode in ['bad_base64', 'html_image']:
      self.server.mode = mode
      before = len(self.server.calls)
      result = self.run_cli('--prompt', 'x')
      self.assertFalse(result['ok'])
      self.assertEqual(result['completed_requests'], 1)
      self.assertEqual(len(self.server.calls), before + 1)
      self.assertEqual(list((self.root / 'outputs').iterdir()), [])

  def test_disconnect_returns_json_and_does_not_retry(self):
    self.server.mode = 'disconnect'
    result = self.run_cli('--prompt', 'x')
    self.assertEqual(result['error']['code'], 'NETWORK_ERROR')
    self.assertEqual(result['attempted_requests'], 1)
    self.assertEqual(result['completed_requests'], 0)
    self.assertEqual(len(self.server.calls), 1)
    self.assertEqual(list((self.root / 'outputs').iterdir()), [])

  def test_remote_http_and_embedded_credentials_rejected(self):
    for url in ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=bad']:
      result = self.run_cli('--base-url', url, '--model', 'm', '--prompt', 'x', '--dry-run', configured=False)
      self.assertEqual(result['error']['code'], 'INVALID_URL')

  def test_provider_rejected_without_network(self):
    for provider in ['fal', 'sb2api-async', 'custom-provider']:
      (self.root / 'config.json').write_text(json.dumps({'provider': provider, 'baseUrl': self.base, 'model': 'm'}), encoding='utf-8')
      result = self.run_cli('--config', 'config.json', '--prompt', 'x')
      self.assertEqual(result['error']['code'], 'UNSUPPORTED_PROVIDER')
    self.assertEqual(self.server.calls, [])


if __name__ == '__main__':
  unittest.main(verbosity=2)
