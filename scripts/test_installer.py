import os
import shutil
import subprocess
import tempfile
from pathlib import Path
import unittest

from build_installer import APP_FILES, stage_app


class InstallerTests(unittest.TestCase):
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
      for name in (*APP_FILES, 'dist/index.html', 'dist/prompt-examples/example.jpg',
                   'user-config/desktop-settings.json', 'outputs/private.png', 'personal-backup.zip', '.env.local'):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(name, encoding='utf-8')
      stage_app(root, stage)
      files = {p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file()}
      self.assertEqual(files, {*APP_FILES, 'dist/index.html', 'dist/prompt-examples/example.jpg'})
      self.assertTrue((root / 'user-config/desktop-settings.json').is_file())
      self.assertTrue((root / 'outputs/private.png').is_file())


if __name__ == '__main__':
  unittest.main(verbosity=2)
