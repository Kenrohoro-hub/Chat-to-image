import ast
import os
import shutil
import subprocess
import struct
import tempfile
from pathlib import Path
import unittest

from build_installer import APP_FILES, stage_app


class InstallerTests(unittest.TestCase):
  def test_release_contains_local_python_dependencies_and_english_guides(self):
    root = Path(__file__).resolve().parent.parent
    self.assertTrue({'README.en.md', 'README_User_Guide.en.md'}.issubset(APP_FILES))
    for name in APP_FILES:
      if not name.endswith(('.py', '.pyw')):
        continue
      for node in ast.walk(ast.parse((root / name).read_text(encoding='utf-8'))):
        modules = [node.module] if isinstance(node, ast.ImportFrom) else [item.name for item in node.names] if isinstance(node, ast.Import) else []
        for module in modules:
          if not module:
            continue
          local = 'scripts/' + module.split('.')[0] + '.py'
          if (root / local).is_file():
            self.assertIn(local, APP_FILES, f'{name} imports an unpackaged module')

  def test_windows_icon_uses_dib_frames_for_native_rendering(self):
    data = (Path(__file__).resolve().parent.parent / 'public/app.ico').read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    self.assertEqual((reserved, kind, count), (0, 1, 9))
    for idx in range(count):
      offset = struct.unpack_from('<I', data, 6 + idx * 16 + 12)[0]
      # PNG 压缩帧在当前 Windows 窗口运行库中会显示杂色。
      self.assertEqual(struct.unpack_from('<I', data, offset)[0], 40)

  @unittest.skipUnless(os.environ.get('CHAT_TO_IMAGE_SIGNING_THUMBPRINT'), '需要指定本机测试签名证书')
  def test_signed_file_passes_but_modified_code_fails(self):
    signer = Path(__file__).with_name('sign_installer.ps1')
    command = ['pwsh', '-NoProfile', '-File', str(signer),
      '-CertificateThumbprint', os.environ['CHAT_TO_IMAGE_SIGNING_THUMBPRINT']]
    with tempfile.TemporaryDirectory() as directory:
      path = Path(directory) / '签名检查.exe'
      shutil.copy2(shutil.which('pwsh'), path)
      signed = subprocess.run([*command, '-FilePath', str(path)], capture_output=True)
      self.assertEqual(signed.returncode, 0, signed.stderr)
      valid = subprocess.run([*command, '-FilePath', str(path), '-VerifyOnly'], capture_output=True)
      self.assertEqual(valid.returncode, 0, valid.stderr)
      with path.open('r+b') as file:
        file.seek(8192)
        original = file.read(1)
        file.seek(8192)
        file.write(bytes([original[0] ^ 1]))
      invalid = subprocess.run([*command, '-FilePath', str(path), '-VerifyOnly'], capture_output=True)
      self.assertNotEqual(invalid.returncode, 0)
      self.assertIn(b'80096010', invalid.stderr)

  def test_release_allowlist_keeps_resources_and_excludes_personal_data(self):
    with tempfile.TemporaryDirectory() as directory:
      root = Path(directory) / 'source'
      stage = Path(directory) / 'payload'
      for name in (*APP_FILES, 'dist/index.html', 'dist/app.ico', 'dist/prompt-examples/example.jpg',
                   'user-config/desktop-settings.json', 'outputs/private.png', 'personal-backup.zip', '.env.local'):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(name, encoding='utf-8')
      stage_app(root, stage)
      files = {p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file()}
      self.assertEqual(files, {*APP_FILES, 'dist/index.html', 'dist/app.ico', 'dist/prompt-examples/example.jpg'})
      self.assertTrue((root / 'user-config/desktop-settings.json').is_file())
      self.assertTrue((root / 'outputs/private.png').is_file())


if __name__ == '__main__':
  unittest.main(verbosity=2)
