import json
from argparse import Namespace
from pathlib import Path
import unittest
import tempfile
from test_playground_image import JPEG
from unittest.mock import MagicMock, patch
import image_batch


class ImageBatchTest(unittest.TestCase):
  def test_interrupt_between_successful_requests_has_an_error(self):
    process = MagicMock()
    process.communicate.return_value = (json.dumps({'ok': True, 'images': [{'path': 'saved.png'}]}).encode(), b'')
    process.poll.return_value = 0
    def interrupt(pending, **kwargs):
      for future in pending: future.result()
      raise KeyboardInterrupt()
    with patch.object(image_batch.subprocess, 'Popen', return_value=process), patch.object(image_batch, 'wait', side_effect=interrupt):
      result = image_batch.run_image_batch(Namespace(concurrency=2), [Path(f'image-{i}.png') for i in range(3)])
    self.assertFalse(result['ok'])
    self.assertEqual(result['error']['code'], 'INTERRUPTED')
    self.assertEqual(len(result['images']), 2)

  def test_interrupted_child_recovers_image_with_actual_extension(self):
    process = MagicMock()
    process.communicate.return_value = (b'', b'')
    with tempfile.TemporaryDirectory() as directory:
      requested = Path(directory) / 'image.png'
      saved = requested.with_suffix('.jpeg')
      saved.write_bytes(JPEG)
      with patch.object(image_batch.subprocess, 'Popen', return_value=process):
        result = image_batch.run_image_batch(Namespace(concurrency=1), [requested])
      self.assertFalse(result['ok'])
      self.assertEqual(len(result['images']), 1)
      self.assertEqual(result['images'][0]['path'], str(saved))
      self.assertEqual(result['images'][0]['format'], 'jpeg')

  def test_worker_launch_failure_keeps_successful_results(self):
    process = MagicMock()
    process.communicate.return_value = (json.dumps({'ok': True, 'images': [{'path': 'saved.png'}]}).encode(), b'')
    with patch.object(image_batch.subprocess, 'Popen', side_effect=[process, OSError('launch failed')]):
      result = image_batch.run_image_batch(Namespace(concurrency=2), [Path('one.png'), Path('two.png')])
    self.assertFalse(result['ok'])
    self.assertEqual(result['error']['code'], 'PROCESS_START_FAILED')
    self.assertEqual(result['images'], [{'path': 'saved.png'}])


if __name__ == '__main__': unittest.main()
