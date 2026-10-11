"""经真实 CLI 子进程与隔离 HTTP 服务验证生图及取消。"""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWNDwHwAFZAKAcWn0agAAAABJRU5ErkJggg==')

class ImageTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.root = Path(self.tmp.name)
    self.patch = patch.dict(os.environ, {'LOCALAPPDATA': str(self.root / 'local'), 'PLAYGROUND_CONFIG_DIR': str(self.root / 'config')})
    self.patch.start()
    self.addCleanup(self.patch.stop)
    self.calls = []
    test = self
    class Handler(BaseHTTPRequestHandler):
      def log_message(self, *args): pass
      def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        test.calls.append(body)
        if getattr(test, 'delay_after_first', False) and len(test.calls) > 1: time.sleep(1)
        result = json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode()
        try:
          self.send_response(200)
          self.send_header('Content-Length', str(len(result)))
          self.end_headers()
          self.wfile.write(result)
        except (ConnectionError, OSError): pass
    self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=self.server.serve_forever, daemon=True).start()
    self.addCleanup(self.server.server_close)
    self.addCleanup(self.server.shutdown)
    from desktop_config import save_desktop
    save_desktop({'profiles': [{'id': 'test', 'name': 'Test', 'provider': 'openai', 'apiMode': 'images', 'baseUrl': f'http://127.0.0.1:{self.server.server_port}/v1/', 'apiKey': 'test-not-secret', 'model': 'image', 'models': ['image']}], 'activeProfileId': 'test'}, '0')

  def service(self):
    self.assertIsNotNone(importlib.util.find_spec('native_images'), 'native image service is not implemented')
    from native_images import ImageService
    from native_store import Store
    return ImageService(Store(self.root / 'data'))

  def test_generate_saves_each_image_and_task_without_web_host(self):
    service = self.service()
    seen = []
    result = service.generate({'prompt': 'test', 'count': 3, 'size': 'auto'}, threading.Event(), seen.append)
    self.assertTrue(result['ok'], result)
    self.assertEqual(len(result['images']), 3)
    self.assertEqual(len(seen), 3)
    self.assertEqual(len(self.calls), 3)
    self.assertTrue(all(item['n'] == 1 for item in self.calls))
    self.assertEqual(service.store.list_records('tasks')[0]['status'], 'success')
    self.assertTrue(all(Path(item['path']).read_bytes() == PNG for item in seen))

  def test_cancel_before_start_does_not_submit(self):
    service = self.service()
    cancel = threading.Event()
    cancel.set()
    result = service.generate({'prompt': 'test', 'count': 3}, cancel)
    self.assertFalse(result['ok'])
    self.assertEqual(self.calls, [])

  def test_invalid_reference_fails_before_request(self):
    service = self.service()
    result = service.generate({'prompt': 'test', 'images': [str(self.root / 'missing.png')]}, threading.Event())
    self.assertFalse(result['ok'])
    self.assertEqual(self.calls, [])

  def test_cancel_after_first_image_keeps_completed_result(self):
    service = self.service()
    self.delay_after_first = True
    cancel = threading.Event()
    result = service.generate({'prompt': 'test', 'count': 6, 'size': 'auto'}, cancel, lambda image: cancel.set())
    self.assertFalse(result['ok'])
    self.assertGreaterEqual(len(result['images']), 1)
    self.assertLessEqual(len(self.calls), 2)
    task = service.store.list_records('tasks')[0]
    self.assertGreaterEqual(len(task['outputImages']), 1)
    self.assertEqual(service.store.image_path(task['outputImages'][0]).read_bytes(), PNG)

  def test_library_save_failure_retains_paid_result_file(self):
    service = self.service()
    with patch.object(service.store, 'add_image', side_effect=OSError('disk full')):
      result = service.generate({'prompt': 'test', 'count': 1, 'size': 'auto'}, threading.Event())
    self.assertFalse(result['ok'])
    files = list((service.store.root / 'work').rglob('*.png'))
    self.assertEqual(len(files), 1, 'completed API result must survive a library write failure')
    self.assertEqual(files[0].read_bytes(), PNG)
    self.assertIn(str(files[0].parent), result['error']['message'])

if __name__ == '__main__': unittest.main()
