import tempfile
from pathlib import Path
import unittest

from build_installer import APP_FILES, stage_app


class InstallerTests(unittest.TestCase):
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
