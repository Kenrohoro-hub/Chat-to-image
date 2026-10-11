"""仅在临时用户目录验证 Agent 连接及文件保护。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import agent_connections as connections


class ConnectionTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory(prefix='chat-image-agents-')
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name) / '中文 home'
    self.root.mkdir()
    self.env = patch.dict(os.environ, {'CHAT_TO_IMAGE_AGENT_HOME': str(self.root), 'CLAUDE_CONFIG_DIR': '', 'DSH_HOME': '',
      'PLAYGROUND_CONFIG_DIR': str(self.root / 'config'), 'LOCALAPPDATA': str(self.root)})
    self.env.start()
    self.addCleanup(self.env.stop)

  def test_connect_update_disconnect_and_preserve_extra(self):
    initial = connections.status()
    self.assertTrue(all(row['status'] == 'missing' for row in initial['targets']))
    self.assertEqual(list(self.root.iterdir()), [])
    for target in ('codex', 'claude', 'cursor', 'deepseek-harness'):
      connections.change('connect', target)
      row = next(r for r in connections.status()['targets'] if r['id'] == target)
      self.assertEqual(row['status'], 'connected')
      folder = Path(row['path'])
      self.assertIn('agent-guide', (folder / 'SKILL.md').read_text(encoding='utf-8'))
      (folder / 'personal.txt').write_text('keep', encoding='utf-8')
      result = connections.change('update', target)
      self.assertTrue(result['ok'])
      removed = connections.change('disconnect', target)
      self.assertTrue(Path(removed['backup']).is_dir())
      self.assertEqual((folder / 'personal.txt').read_text(encoding='utf-8'), 'keep')
      self.assertFalse((folder / 'SKILL.md').exists())

  def test_deepseek_home_and_cli_target(self):
    default = self.root / '.dsh' / 'skills' / 'chat-to-image-cli'
    self.assertEqual(connections.target_path('deepseek-harness'), default)
    with patch.dict(os.environ, {'DSH_HOME': '   '}):
      self.assertEqual(connections.target_path('deepseek-harness'), default)
    custom = self.root / '自定义 Harness'
    with patch.dict(os.environ, {'DSH_HOME': str(custom)}):
      folder = custom / 'skills' / 'chat-to-image-cli'
      self.assertEqual(connections.target_path('deepseek-harness'), folder)
      for action in ('connect', 'status', 'update', 'disconnect'):
        result = subprocess.run(connections.invocation() + ['agents', action, '--target', 'deepseek-harness'],
          cwd=self.root, capture_output=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload['ok'])
        if action == 'status':
          self.assertEqual(payload['targets'][0]['id'], 'deepseek-harness')
          self.assertEqual(payload['targets'][0]['status'], 'connected')
          self.assertEqual(payload['targets'][0]['path'], str(folder))
      self.assertFalse((folder / 'SKILL.md').exists())
    self.assertFalse(default.exists())
    self.assertFalse((self.root / '.agents').exists())
    with patch.dict(os.environ, {'DSH_HOME': 'relative-directory'}):
      with self.assertRaisesRegex(ValueError, '绝对路径'):
        connections.target_path('deepseek-harness')

  def test_generated_command_can_read_guide_from_other_directory(self):
    connections.change('connect', 'codex')
    row = connections.status()['targets'][0]
    command = row['invocation'] + ['agent-guide']
    result = subprocess.run(command, cwd=self.root, capture_output=True, encoding='utf-8', timeout=10)
    self.assertEqual(result.returncode, 0)
    self.assertIn('generate', result.stdout)
    for args in (['agents', 'status', '--target', 'codex'], ['agents', 'update', '--target', 'codex']):
      result = subprocess.run(row['invocation'] + args, cwd=self.root, capture_output=True, encoding='utf-8', timeout=15)
      self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
      self.assertTrue(json.loads(result.stdout)['ok'])
    bad = subprocess.run(row['invocation'] + ['agents', 'disconnect'], cwd=self.root, capture_output=True, encoding='utf-8', timeout=10)
    self.assertNotEqual(bad.returncode, 0)
    self.assertEqual(json.loads(bad.stdout)['error']['code'], 'INVALID_ARGUMENT')

  def test_manual_command_follows_current_project_without_machine_config(self):
    for project in (self.root / '电脑一' / '项目', self.root / '电脑二' / '新位置'):
      with patch.object(connections, 'ROOT', project), patch.object(connections.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='chat-to-image test')):
        command = connections.status()['manual_command']
      self.assertEqual(command, [str(project / 'chat-to-image.cmd')])
      self.assertNotIn('--config-dir', command)
      self.assertNotIn(sys.executable, command)
    command = connections.status()['manual_command']
    result = subprocess.run(command + ['agent-guide'], cwd=self.root, capture_output=True, encoding='utf-8', timeout=10)
    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
    self.assertIn('generate', result.stdout)

  def test_refuses_personal_edits_unknown_owner_and_links(self):
    connections.change('connect', 'codex')
    folder = Path(connections.status()['targets'][0]['path'])
    skill = folder / 'SKILL.md'
    skill.write_text('personal edit', encoding='utf-8')
    for action in ('connect', 'update', 'disconnect'):
      with self.assertRaises(ValueError):
        connections.change(action, 'codex')
      self.assertEqual(skill.read_text(encoding='utf-8'), 'personal edit')
    cursor = Path(connections.status()['targets'][2]['path'])
    cursor.mkdir(parents=True)
    (cursor / 'SKILL.md').write_text('another project', encoding='utf-8')
    with self.assertRaises(ValueError):
      connections.change('connect', 'cursor')
    record = json.loads((folder / '.connection.json').read_text(encoding='utf-8'))
    record['project'] = str(self.root / 'foreign')
    (folder / '.connection.json').write_text(json.dumps(record), encoding='utf-8')
    self.assertEqual(connections.status()['targets'][0]['status'], 'conflict')
    with self.assertRaises(ValueError):
      connections.change('disconnect', 'codex')
    with patch.object(connections, 'check_path', side_effect=ValueError('链接路径')):
      with self.assertRaises(ValueError):
        connections.change('connect', 'claude')

  def test_failed_update_restores_both_files(self):
    connections.change('connect', 'codex')
    folder = Path(connections.status()['targets'][0]['path'])
    original = {name: (folder / name).read_bytes() for name in ('SKILL.md', '.connection.json')}
    real_write = connections.write_json
    def fail_record(path, value):
      if path == folder / '.connection.json':
        raise OSError('simulated write failure')
      return real_write(path, value)
    with patch.object(connections, 'skill_content', return_value=b'changed'), patch.object(connections, 'write_json', side_effect=fail_record):
      with self.assertRaises(ValueError):
        connections.change('update', 'codex')
    self.assertEqual({name: (folder / name).read_bytes() for name in original}, original)

  def test_network_project_agent_directory_and_native_boundary(self):
    from desktop_host import DesktopApi
    with tempfile.TemporaryDirectory(prefix='.agent-check-', dir=connections.ROOT) as directory:
      with patch.dict(os.environ, {'CHAT_TO_IMAGE_AGENT_HOME': directory}):
        connections.change('connect', 'codex')
        result = connections.change('disconnect', 'codex')
        self.assertTrue(Path(result['backup']).is_relative_to(self.root))
        self.assertEqual(connections.status()['targets'][0]['status'], 'missing')
    api = DesktopApi()
    api._origin = 'http://127.0.0.1:1'
    api._window = SimpleNamespace(get_current_url=lambda: 'https://foreign.example/')
    with self.assertRaises(ValueError):
      api.agent_connections('connect', 'codex')
    self.assertEqual(connections.status()['targets'][0]['status'], 'missing')
    api._window = SimpleNamespace(get_current_url=lambda: api._origin + '/')
    self.assertTrue(api.agent_connections('connect', 'codex')['result']['ok'])
    self.assertEqual(api.agent_connections('status')['targets'][0]['status'], 'connected')
    with self.assertRaises(ValueError):
      api.agent_connections('connect', '../foreign')
    self.assertTrue(api.agent_connections('disconnect', 'codex')['result']['ok'])


if __name__ == '__main__':
  unittest.main()
