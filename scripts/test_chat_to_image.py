"""从不同工作目录调用统一 CLI；供应商及用户配置均隔离。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

from test_playground_image import Handler, IMAGE


CLI = Path(__file__).with_name('chat_to_image.py')


class CliTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='chat-image-cli-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name) / '中文 work'
    self.root.mkdir()
    self.env = {k: v for k, v in os.environ.items() if not k.startswith('PLAYGROUND_')}
    self.env.update(LOCALAPPDATA=str(self.root), PLAYGROUND_API_KEY='mock-secret')

  def run_cli(self, *args):
    result = subprocess.run([sys.executable, '-B', str(CLI), '--config-dir', str(self.root / '配置'), *args],
      cwd=self.root, env=self.env, capture_output=True, encoding='utf-8', timeout=15)
    self.assertNotIn('mock-secret', result.stdout + result.stderr)
    return result

  def test_help_guide_and_doctor_do_not_write(self):
    self.assertEqual(self.run_cli('--version').returncode, 0)
    self.assertIn('generate', self.run_cli('--help').stdout)
    self.assertIn('generate', self.run_cli('agent-guide').stdout)
    doctor = self.run_cli('doctor')
    self.assertEqual(doctor.returncode, 1)
    self.assertEqual(json.loads(doctor.stdout)['config']['source'], 'missing')
    self.assertFalse((self.root / '配置').exists())
    bad = self.run_cli('agent-guide', '../package.json')
    self.assertNotEqual(bad.returncode, 0)
    self.assertEqual(json.loads(bad.stdout)['error']['code'], 'INVALID_ARGUMENT')

  def test_generate_edit_and_upstream_failure(self):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.calls, server.downloads, server.mode = [], [], 'normal'
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    self.addCleanup(server.server_close)
    self.addCleanup(server.shutdown)
    prompt = self.root / '提示词.txt'
    prompt.write_text('中文海报\n包含 "引号" 和 $符号', encoding='utf-8')
    common = ['generate', '--base-url', f'http://127.0.0.1:{server.server_port}/v1',
      '--model', 'mock', '--prompt-file', str(prompt), '--output', '结果']
    generated = self.run_cli(*common)
    self.assertEqual(generated.returncode, 0)
    result = json.loads(generated.stdout)
    path = Path(result['images'][0]['path'])
    self.assertTrue(path.is_absolute())
    self.assertEqual(path.read_bytes(), IMAGE)
    self.assertEqual(len(server.calls), 1)
    self.assertEqual(json.loads(server.calls[0]['body'])['prompt'], prompt.read_text(encoding='utf-8'))
    edited = self.run_cli(*common, '--image', str(path), '--mask', str(path))
    self.assertEqual(edited.returncode, 0)
    self.assertEqual(server.calls[-1]['path'], '/v1/images/edits')
    server.mode = 'error'
    failed = self.run_cli(*common)
    self.assertNotEqual(failed.returncode, 0)
    self.assertFalse(json.loads(failed.stdout)['ok'])
    self.assertEqual(len(server.calls), 3)


if __name__ == '__main__':
  unittest.main()
