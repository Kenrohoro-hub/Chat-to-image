"""旧版创作交互在原生窗口中的会话、分支和草稿验收。"""
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from qt_test_support import app, dispose
from PySide6.QtGui import QImage
from PySide6.QtCore import Qt
from native_store import Store
from desktop_config import save_desktop
from native_creation import CreationPage


class CreationTests(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.root = Path(self.tmp.name)
    self.env = patch.dict(os.environ, {'LOCALAPPDATA': str(self.root), 'PLAYGROUND_CONFIG_DIR': str(self.root / 'config')})
    self.env.start()
    self.addCleanup(self.env.stop)
    save_desktop({'profiles': [{'id': 'images', 'name': 'Images', 'provider': 'openai', 'apiMode': 'images', 'baseUrl': 'https://example.invalid/v1', 'apiKey': 'test-only', 'model': 'test-image'}], 'activeProfileId': 'images', 'persistInputOnRestart': True, 'clearInputAfterSubmit': True})
    self.store = Store(self.root / 'library')
    picture = QImage(80, 60, QImage.Format.Format_RGB32)
    picture.fill(0xff889977)
    file = self.root / 'test.png'
    picture.save(str(file))
    for image_id in ('one', 'two', 'other', 'mask'):
      self.store.add_image(file, image_id=image_id)
    self.store.put_record('conversations', {'id': 'c1', 'title': '多轮创作', 'messages': [
      {'id': 'u1', 'role': 'user', 'content': '纸船', 'roundId': 'r1'},
      {'id': 'a1', 'role': 'assistant', 'content': '完成', 'roundId': 'r1', 'imageIds': ['one']},
      {'id': 'u2', 'role': 'user', 'content': '换成落日', 'roundId': 'r2'},
      {'id': 'a2', 'role': 'assistant', 'content': '完成', 'roundId': 'r2', 'imageIds': ['two']},
      {'id': 'u3', 'role': 'user', 'content': '另一分支', 'roundId': 'r3'},
      {'id': 'a3', 'role': 'assistant', 'content': '完成', 'roundId': 'r3', 'imageIds': ['other']},
    ], 'rounds': [{'id': 'r1', 'parentRoundId': None}, {'id': 'r2', 'parentRoundId': 'r1'}, {'id': 'r3', 'parentRoundId': 'r1'}], 'activeRoundId': 'r2'})
    for index, (round_id, image_id) in enumerate([('r1', 'one'), ('r2', 'two'), ('r3', 'other')]):
      self.store.put_record('tasks', {'id': 'task-' + round_id, 'prompt': image_id, 'status': 'success', 'createdAt': index, 'outputImages': [image_id], 'params': {'size': 'auto', 'n': 1}, 'agentConversationId': 'c1', 'agentRoundId': round_id})
    self.requests = []
    def generate(request, cancel, callback):
      self.requests.append(request)
      return {'ok': True, 'images': [], 'taskId': 'direct-task'}
    self.page = CreationPage(self.store, generate)
    self.addCleanup(dispose, self.page)

  def wait(self):
    deadline = time.monotonic() + 5
    while self.page.worker and time.monotonic() < deadline:
      app.processEvents()
      time.sleep(.01)
    self.assertIsNone(self.page.worker)

  def test_compare_branch_switch_and_new_conversation_isolation(self):
    self.assertEqual([image_id for _, image_id in self.page.result_images], ['one', 'two'])
    self.page.switch_branch('r3')
    self.assertEqual([image_id for _, image_id in self.page.result_images], ['one', 'other'])
    self.page.new_conversation()
    self.assertEqual(self.page.result_images, [])

  def test_edit_image_draft_undo_and_branch_draft_restore(self):
    self.page.prompt.setPlainText('原草稿')
    self.page.select_image('one')
    self.page.edit_selected()
    self.assertEqual(self.page.attachments, ['one'])
    self.page.undo_draft()
    self.assertEqual(self.page.attachments, [])
    self.assertEqual(self.page.prompt.toPlainText(), '原草稿')
    message = next(m for m in self.page._record()['messages'] if m['id'] == 'u2')
    self.page._edit_message(message)
    self.page.new_conversation()
    self.page.current_id = 'c1'
    self.page._load_current()
    self.assertTrue(self.page.branch_mode)
    self.assertEqual(self.page.branch_parent_id, 'r1')
    self.assertEqual(self.page.prompt.toPlainText(), '换成落日')

  def test_direct_generation_keeps_mask_and_params_in_request_then_clears_draft(self):
    self.page.prompt.setPlainText('编辑纸船')
    self.page.attachments = ['one']
    self.page.draft_mask_id = 'mask'
    self.page.image_params = {'size': '1536x1024', 'n': 1, 'model': 'test-image', 'profileId': 'images'}
    self.page.submit_mode(direct=True)
    self.wait()
    self.assertEqual(len(self.requests), 1)
    request = self.requests[0]
    self.assertEqual(request['agentConversationId'], 'c1')
    self.assertEqual(request['size'], '1536x1024')
    self.assertEqual(request['mask'], str(self.store.image_path('mask')))
    self.assertEqual(request['images'], [str(self.store.image_path('one'))])
    record = self.page._record()
    self.assertIn('direct-task', record['rounds'][-1]['outputTaskIds'])
    self.assertEqual(record['draftImageIds'], [])
    self.assertIsNone(record.get('draftMaskImageId'))

  def test_retry_direct_generation_restores_original_image_options(self):
    self.page.prompt.setPlainText('编辑纸船')
    self.page.attachments = ['one']
    self.page.draft_mask_id = 'mask'
    self.page.image_params = {'size': '1536x1024', 'n': 1, 'model': 'test-image', 'profileId': 'images'}
    self.page.submit_mode(direct=True)
    self.wait()
    message = next(m for m in reversed(self.page._record()['messages']) if m['role'] == 'user')
    self.page.image_params = {'size': '1024x1024'}
    with patch('native_conversation.call_responses', side_effect=AssertionError('Retry must use Images')):
      self.page._retry_message(message)
      self.wait()
    self.assertEqual(len(self.requests), 2)
    self.assertEqual(self.requests[1]['mask'], str(self.store.image_path('mask')))
    self.assertEqual(self.requests[1]['size'], '1536x1024')
    self.assertEqual(self.requests[1]['images'], [str(self.store.image_path('one'))])

  def test_reused_parameters_survive_conversation_switch(self):
    self.page.use_prompt({'prompt': '复用', 'params': {'size': '1536x1024', 'n': 2}, 'inputImageIds': ['one'], 'maskImageId': 'mask'})
    self.page.new_conversation()
    self.page.current_id = 'c1'
    self.page._load_current()
    self.assertEqual(self.page.image_params['size'], '1536x1024')
    self.assertEqual(self.page.image_params['n'], 2)
    self.assertEqual(self.page.attachments, ['one'])
    self.assertEqual(self.page.draft_mask_id, 'mask')


if __name__ == '__main__': unittest.main()
