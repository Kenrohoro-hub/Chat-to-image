import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_app


class BuildOutputTest(unittest.TestCase):
  def test_replaces_old_assets_without_touching_user_config(self):
    with tempfile.TemporaryDirectory() as temporary:
      project = Path(temporary) / 'project'
      project.mkdir()
      (project / 'src').mkdir()
      (project / 'public').mkdir()
      (project / 'package-lock.json').write_text('{}')
      (project / 'dist').mkdir()
      (project / 'dist' / 'old-bundle.js').write_text('old')
      (project / 'user-config').mkdir()
      (project / 'user-config' / 'keep.txt').write_text('keep')
      stage = Path(temporary) / '.cache' / 'gpt-image-playground' / hashlib.sha256(str(project.resolve()).encode()).hexdigest()[:16]
      (stage / 'dist').mkdir(parents=True)
      (stage / 'dist' / 'index.html').write_text('new')
      with patch.object(build_app, '__file__', str(project / 'scripts' / 'build_app.py')), patch.object(build_app.Path, 'home', return_value=Path(temporary)), patch.object(build_app.shutil, 'which', return_value='npm'), patch.object(build_app.subprocess, 'run'), patch('sys.argv', ['build_app.py']):
        build_app.main()
      self.assertEqual([item.name for item in (project / 'dist').iterdir()], ['index.html'])
      self.assertEqual((project / 'dist' / 'index.html').read_text(), 'new')
      self.assertEqual((project / 'user-config' / 'keep.txt').read_text(), 'keep')


if __name__ == '__main__':
  unittest.main()
