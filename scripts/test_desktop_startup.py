"""验证没有 tkinter 的 Python 能加载桌面启动器，不启动真实界面。"""
import subprocess
import sys
import os
import tempfile
import runpy
from pathlib import Path
import unittest
from unittest.mock import patch

from playground_config import config_path, local_data_dir


class StartupTests(unittest.TestCase):
  def test_bundled_runtime_starts_without_installing_dependencies(self):
    launcher = runpy.run_path(str(Path(__file__).with_name('desktop_app.pyw')), run_name='startup-test')
    runtime = Path(__file__).resolve().parent.parent / 'runtime'
    with patch.object(Path, 'is_file', return_value=True), patch.object(sys, 'prefix', str(runtime)), patch('importlib.util.find_spec', return_value=object()), patch('desktop_host.main') as main, patch('subprocess.run') as run:
      launcher['launch']()
      main.assert_called_once_with()
      run.assert_not_called()

  def test_launcher_uses_web_desktop_in_its_runtime(self):
    launcher = runpy.run_path(str(Path(__file__).with_name('desktop_app.pyw')), run_name='startup-test')
    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'LOCALAPPDATA': directory}):
      runtime = local_data_dir() / 'desktop-runtime'
      with patch.object(sys, 'prefix', str(runtime)), patch('importlib.util.find_spec', return_value=object()), patch('desktop_host.main') as main:
        launcher['launch']()
        main.assert_called_once_with()

  def test_launcher_failure_has_nonzero_exit_after_visible_error(self):
    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'LOCALAPPDATA': directory}):
      runtime = local_data_dir() / 'desktop-runtime'
      with patch.object(sys, 'prefix', str(runtime)), patch('importlib.util.find_spec', return_value=object()), patch('desktop_host.main', side_effect=RuntimeError('启动失败测试')), patch('ctypes.windll.user32.MessageBoxW') as message:
        with self.assertRaises(SystemExit) as stopped:
          runpy.run_path(str(Path(__file__).with_name('desktop_app.pyw')), run_name='__main__')
        self.assertEqual(stopped.exception.code, 1)
        self.assertIn('启动失败测试', message.call_args.args)

  def test_launcher_import_does_not_require_tkinter_or_start_installation(self):
    script = Path(__file__).with_name('desktop_app.pyw')
    code = 'import runpy, sys; runpy.run_path(sys.argv[1], run_name="startup-test"); print("import passed")'
    result = subprocess.run([sys._base_executable, '-B', '-c', code, str(script)],
      capture_output=True, encoding='utf-8', timeout=10)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(result.stdout.strip(), 'import passed')

  def test_configuration_is_project_local_but_runtime_data_remains_in_user_directory(self):
    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'LOCALAPPDATA': directory}):
      os.environ.pop('PLAYGROUND_CONFIG_DIR', None)
      self.assertEqual(config_path(), Path(__file__).resolve().parent.parent / 'user-config' / 'codex-profile.json')
      self.assertTrue(local_data_dir().is_relative_to(Path(directory)))


if __name__ == '__main__':
  unittest.main(verbosity=2)
