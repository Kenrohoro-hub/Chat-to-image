from qt_test_support import app as QT_APP
import json
from pathlib import Path
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from native_responses import call_responses, parse_sse, route_profiles
from PySide6.QtCore import QEventLoop, QThread, QTimer
from PySide6.QtWidgets import QApplication


class FakeHandler(BaseHTTPRequestHandler):
  responses = []
  authorizations = []
  bodies = []
  paths = []

  def do_POST(self):
    type(self).authorizations.append(self.headers.get('Authorization'))
    type(self).paths.append(self.path)
    type(self).bodies.append(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)))))
    response = type(self).responses.pop(0)
    status, content_type, body = response[:3]
    self.send_response(status)
    self.send_header('Content-Type', content_type)
    self.end_headers()
    try:
      self.wfile.write(body)
      self.wfile.flush()
      if len(response) > 3:
        time.sleep(response[3])
    except OSError:
      pass

  def log_message(self, *_args):
    pass


class NativeResponsesTests(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    cls.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeHandler)
    cls.server.daemon_threads = True
    cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
    cls.thread.start()
    cls.base_url = 'http://127.0.0.1:%s/v1' % cls.server.server_port

  @classmethod
  def tearDownClass(cls):
    cls.server.shutdown()
    cls.server.server_close()
    cls.thread.join(timeout=2)

  def setUp(self):
    FakeHandler.responses = []
    FakeHandler.authorizations = []
    FakeHandler.bodies = []
    FakeHandler.paths = []

  def settings(self):
    return {
      'profiles': [
        {'id': 'image', 'apiMode': 'images', 'provider': 'openai'},
        {'id': 'primary', 'apiMode': 'responses', 'provider': 'openai', 'baseUrl': self.base_url, 'apiKey': 'first', 'model': 'chat-a', 'streamImages': True, 'models': ['chat-a', 'chat-b']},
        {'id': 'backup', 'apiMode': 'responses', 'provider': 'openai', 'baseUrl': self.base_url, 'apiKey': 'second', 'model': 'chat-b', 'streamImages': True, 'models': ['chat-a', 'chat-b']},
      ],
      'agentFailover': {'enabled': True, 'primaryId': 'primary', 'slots': ['primary', 'backup'], 'disabledIds': []},
    }

  def test_routes_only_enabled_responses_profiles_in_primary_order(self):
    self.assertEqual([p['id'] for p in route_profiles(self.settings())], ['primary', 'backup'])

  def test_images_failover_does_not_replace_agent_failover(self):
    settings = self.settings()
    settings['failover'] = {'enabled': True, 'primaryId': 'image', 'slots': ['image']}
    self.assertEqual([p['id'] for p in route_profiles(settings)], ['primary', 'backup'])

  def test_explicit_profile_disables_fallback(self):
    self.assertEqual([p['id'] for p in route_profiles(self.settings(), 'backup')], ['backup'])

  def test_disabled_primary_is_skipped(self):
    settings = self.settings()
    settings['agentFailover']['disabledIds'] = ['primary']
    self.assertEqual([p['id'] for p in route_profiles(settings)], ['backup'])

  def test_sse_keeps_multiline_data_and_skips_comments(self):
    events = list(parse_sse([
      b': keepalive\n', b'event: response.output_text.delta\n', b'data: {"delta":"hello"}\n', b'\n',
      b'event: response.completed\n', b'data: {\n', b'data: "response": {"id":"r1"}}\n', b'\n',
    ]))
    self.assertEqual(events, [('response.output_text.delta', {'delta': 'hello'}), ('response.completed', {'response': {'id': 'r1'}})])

  def test_sse_decodes_utf8_split_between_chunks_and_flushes_final_data(self):
    import codecs
    from native_responses import _sse_feed
    text = 'event: response.output_text.delta\ndata: {"delta":"中文图像"}'
    raw = text.encode('utf-8')
    parser = {'buffer': '', 'event': 'message', 'data': [], 'decoder': codecs.getincrementaldecoder('utf-8')()}
    events = []
    for byte in raw:
      _sse_feed(parser, bytes([byte]), lambda event, payload: events.append((event, payload)))
    _sse_feed(parser, b'', lambda event, payload: events.append((event, payload)), final=True)
    self.assertEqual(events, [('response.output_text.delta', {'delta': '中文图像'})])

  def test_completed_payload_supplies_text_without_deltas(self):
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r6","output":[{"type":"message","content":[{"type":"output_text","text":"final text"}]}]}}\n\n')]
    result, _ = call_responses(self.settings(), [], threading.Event())
    self.assertEqual(result['text'], 'final text')

  def test_streams_text_and_returns_completed_payload(self):
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.output_text.delta\ndata: {"delta":"hello"}\n\nevent: response.completed\ndata: {"response":{"id":"r1","output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}]}}\n\n')]
    deltas = []
    result, profile = call_responses(self.settings(), [], threading.Event(), deltas.append)
    self.assertEqual(profile['id'], 'primary')
    self.assertEqual(result['id'], 'r1')
    self.assertEqual(deltas, ['hello'])

  def test_falls_back_only_after_explicit_rejection(self):
    FakeHandler.responses = [(401, 'application/json', b'{}'), (200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r2","output":[]}}\n\n')]
    result, profile = call_responses(self.settings(), [], threading.Event())
    self.assertEqual(profile['id'], 'backup')
    self.assertEqual(FakeHandler.authorizations, ['Bearer first', 'Bearer second'])

  def test_streamed_server_error_does_not_persist_remote_message(self):
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.failed\ndata: {"error":{"message":"Bearer sk-fake-secret"}}\n\n'), (200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r7","output":[]}}\n\n')]
    with self.assertRaisesRegex(RuntimeError, '服务端返回错误') as caught:
      call_responses(self.settings(), [], threading.Event())
    self.assertNotIn('sk-fake-secret', str(caught.exception))
    self.assertEqual(FakeHandler.authorizations, ['Bearer first'])

  def test_server_error_is_not_retried(self):
    FakeHandler.responses = [(500, 'application/json', b'{}'), (200, 'text/event-stream', b'')]
    with self.assertRaisesRegex(RuntimeError, '未自动重试'):
      call_responses(self.settings(), [], threading.Event())
    self.assertEqual(FakeHandler.authorizations, ['Bearer first'])

  def test_redirect_is_not_followed(self):
    FakeHandler.responses = [(302, 'text/plain', b'')]
    with self.assertRaises(RuntimeError):
      call_responses(self.settings(), [], threading.Event())
    self.assertEqual(FakeHandler.authorizations, ['Bearer first'])
    self.assertEqual(FakeHandler.paths, ['/v1/responses'])

  def test_base_url_without_version_prefix_uses_v1(self):
    settings = self.settings()
    settings['profiles'][1]['baseUrl'] = 'http://127.0.0.1:%s' % self.server.server_port
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r4","output":[]}}\n\n')]
    call_responses(settings, [], threading.Event())
    self.assertEqual(FakeHandler.paths, ['/v1/responses'])

  def test_cancel_interrupts_a_stalled_sse_read(self):
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.output_text.delta\ndata: {"delta":"partial"}\n', 2)]
    cancel = threading.Event()
    done = QEventLoop()
    errors = []

    class RequestThread(QThread):
      def run(self):
        try:
          call_responses(self_outer.settings(), [], cancel)
        except Exception as error:
          errors.append(error)

    self_outer = self
    worker = RequestThread()
    worker.finished.connect(done.quit)
    worker.start()
    QTimer.singleShot(150, cancel.set)
    started = time.monotonic()
    QTimer.singleShot(1000, done.quit)
    done.exec()
    self.assertFalse(worker.isRunning())
    self.assertLess(time.monotonic() - started, 1.0)
    self.assertIsInstance(errors[0], InterruptedError)

  def test_input_preserves_reasoning_output_items_for_tool_follow_up(self):
    from native_responses import _input_messages
    messages = [{'type': 'reasoning', 'id': 'rs1', 'summary': []}, {'type': 'function_call', 'call_id': 'fc1'}, {'type': 'function_call_output', 'call_id': 'fc1'}]
    self.assertEqual(_input_messages(messages), messages)

  def test_request_uses_selected_model_reasoning_and_tools_without_persisting_keys(self):
    settings = self.settings()
    settings.update({'agentModel': 'chat-a', 'agentReasoningEffort': 'high', 'agentImageTools': True, 'agentWebSearch': True})
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r3","output":[]}}\n\n')]
    call_responses(settings, [{'role': 'user', 'content': 'generate'}], threading.Event())
    body = FakeHandler.bodies[0]
    self.assertEqual(body['model'], 'chat-a')
    self.assertEqual(body['reasoning'], {'effort': 'high'})
    self.assertIn('generate_image', [tool.get('name') for tool in body['tools']])
    self.assertIn('web_search', [tool.get('type') for tool in body['tools']])
    self.assertNotIn('apiKey', json.dumps(body))

  def test_vision_images_are_included_by_default_and_downgraded_only_when_false(self):
    settings = self.settings()
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.completed\ndata: {\"response\":{\"id\":\"vision1\",\"output\":[]}}\n\n')]
    call_responses(settings, [{'role': 'user', 'content': 'look', 'imageDataUrls': ['data:image/png;base64,AA==']}], threading.Event())
    self.assertIn('input_image', json.dumps(FakeHandler.bodies[0]['input']))
    settings['profiles'][1]['modelCapabilities'] = {'chat-a': {'vision': False}}
    FakeHandler.responses = [(200, 'text/event-stream', b'event: response.completed\ndata: {"response":{"id":"r5","output":[]}}\n\n')]
    call_responses(settings, [{'role': 'user', 'content': 'look', 'imageDataUrls': ['data:image/png;base64,AA==']}], threading.Event())
    self.assertNotIn('input_image', json.dumps(FakeHandler.bodies[1]['input']))


class ToolRoundTests(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    NativeResponsesTests.setUpClass()

  @classmethod
  def tearDownClass(cls):
    NativeResponsesTests.tearDownClass()

  def setUp(self):
    self.app = QApplication.instance() or QApplication([])
    FakeHandler.responses = []
    FakeHandler.authorizations = []
    FakeHandler.bodies = []
    FakeHandler.paths = []

  def settings(self):
    return {
      'profiles': [{'id': 'primary', 'apiMode': 'responses', 'provider': 'openai', 'baseUrl': NativeResponsesTests.base_url, 'apiKey': 'first', 'model': 'chat-a', 'streamImages': True}],
      'agentFailover': {'enabled': True, 'primaryId': 'primary', 'slots': ['primary'], 'disabledIds': []},
    }

  def run_worker(self, settings, responses):
    from PySide6.QtCore import QEventLoop, QTimer
    from native_conversation import _ConversationWorker

    class Store:
      def image_path(self, _image_id):
        return None

    FakeHandler.responses = responses
    event_loop = QEventLoop()
    requests = []
    results = []

    def generate(request, cancel, on_image=None):
      requests.append(request)
      return {'ok': True, 'taskId': 'task1', 'images': [{'id': 'img1', 'path': 'image.png'}], 'warnings': []}

    worker = _ConversationWorker(settings, [{'role': 'user', 'content': 'make image', 'roundId': 'round1', 'conversationId': 'conv1'}], {'size': '2k', 'n': 2}, Store(), generate, threading.Event())
    worker.completed.connect(lambda *values: (results.append(values), event_loop.quit()))
    QTimer.singleShot(3000, event_loop.quit)
    worker.start()
    event_loop.exec()
    worker.wait(1000)
    self.assertFalse(worker.isRunning())
    return requests, results

  def test_default_tool_round_keeps_images_without_follow_up_request(self):
    tool_call = {'type': 'function_call', 'id': 'fc1', 'call_id': 'call1', 'name': 'generate_image', 'arguments': '{"id":"cover","prompt":"paper plane"}'}
    responses = [(200, 'text/event-stream', ('event: response.completed\ndata: ' + json.dumps({'response': {'id': 'r1', 'output': [tool_call]}}) + '\n\n').encode())]
    requests, results = self.run_worker(self.settings(), responses)
    self.assertEqual(len(FakeHandler.bodies), 1)
    self.assertEqual(requests[0]['prompt'], 'paper plane')
    self.assertEqual(requests[0]['size'], '2k')
    self.assertEqual(requests[0]['count'], 2)
    self.assertEqual(requests[0]['sourceMode'], 'agent')
    self.assertEqual(requests[0]['agentConversationId'], 'conv1')
    self.assertEqual(requests[0]['agentRoundId'], 'round1')
    self.assertEqual([item['id'] for item in results[0][1]], ['img1'])
    self.assertIn({'type': 'image_task', 'taskId': 'task1'}, results[0][3])

  def test_configured_extra_tool_round_sends_function_items_back(self):
    tool_call = {'type': 'function_call', 'id': 'fc1', 'call_id': 'call1', 'name': 'generate_image', 'arguments': '{"id":"cover","prompt":"paper plane"}'}
    responses = [
      (200, 'text/event-stream', ('event: response.completed\ndata: ' + json.dumps({'response': {'id': 'r1', 'output': [tool_call]}}) + '\n\n').encode()),
      (200, 'text/event-stream', b'event: response.output_text.delta\ndata: {"delta":"done"}\n\nevent: response.completed\ndata: {"response":{"id":"r2","output":[]}}\n\n'),
    ]
    settings = self.settings()
    settings['agentMaxToolRounds'] = 2
    requests, results = self.run_worker(settings, responses)
    self.assertEqual(requests[0]['prompt'], 'paper plane')
    self.assertEqual(results[0][0], 'done')
    self.assertIn('function_call', [item.get('type') for item in FakeHandler.bodies[1]['input']])
    self.assertIn('function_call_output', [item.get('type') for item in FakeHandler.bodies[1]['input']])


class ConversationDataTests(unittest.TestCase):
  def test_conversation_persistence_excludes_credentials_and_keeps_legacy_fields(self):
    from native_conversation import _record_for_save
    saved = _record_for_save({'id': 'c1', 'title': '旧会话', 'messages': [], 'createdAt': 1, 'updatedAt': 2, 'apiKey': 'secret', 'profiles': [], 'preferences': {'apiKey': 'nested-secret'}})
    self.assertEqual(saved, {'id': 'c1', 'title': '旧会话', 'messages': [], 'createdAt': 1, 'updatedAt': 2, 'preferences': {}})
    self.assertNotIn('secret', json.dumps(saved))
    self.assertNotIn('nested-secret', json.dumps(saved))

  def test_legacy_output_task_ids_expand_to_saved_image_ids(self):
    from native_conversation import _image_ids

    class Store:
      def list_records(self, kind):
        return [{'id': 'task-old', 'outputImages': ['image-old', 'image-new']}] if kind == 'tasks' else []

    legacy_record = {'id': 'conv-old', 'title': '旧会话', 'createdAt': 1, 'updatedAt': 2, 'messages': [{'role': 'assistant', 'content': '完成', 'outputTaskIds': ['task-old']}]}
    self.assertEqual(_image_ids(legacy_record['messages'][0], Store()), ['image-old', 'image-new'])

  def test_active_branch_path_follows_parent_rounds(self):
    from native_conversation import _round_path
    record = {'activeRoundId': 'c', 'rounds': [{'id': 'a', 'parentRoundId': None}, {'id': 'b', 'parentRoundId': 'a'}, {'id': 'c', 'parentRoundId': 'b'}, {'id': 'other', 'parentRoundId': 'a'}]}
    self.assertEqual(_round_path(record), {'a', 'b', 'c'})

  def test_new_page_loads_profiles_without_creating_history(self):
    import tempfile
    from unittest.mock import patch
    from native_conversation import ConversationPage
    from native_store import Store

    settings = {'profiles': [
      {'id': 'image', 'name': '图片', 'provider': 'openai', 'apiMode': 'images'},
      {'id': 'chat', 'name': '对话', 'provider': 'openai', 'apiMode': 'responses', 'models': ['chat-a', 'chat-b']},
    ], 'agentFailover': {'primaryId': 'chat'}}
    with tempfile.TemporaryDirectory() as folder, patch('native_conversation.settings_snapshot', return_value={'settings': settings}):
      store = Store(folder)
      page = ConversationPage(store, lambda *_: None)
      self.addCleanup(page.close)
      self.assertEqual(page.profile_combo.currentText(), '自动（主备）')
      self.assertEqual(page.profile_combo.count(), 2)
      self.assertEqual(page.profile_combo.itemData(1), 'chat')
      self.assertEqual(page.model_combo.currentData(), 'chat-a')
      self.assertEqual(page.model_combo.count(), 2)
      self.assertIsNone(page.current_id)
      self.assertEqual(store.list_records('conversations'), [])

  def test_invalid_attachment_warns_and_next_image_is_added(self):
    import tempfile
    from unittest.mock import patch
    from PySide6.QtGui import QImage
    from native_conversation import ConversationPage
    from native_store import Store

    with tempfile.TemporaryDirectory() as folder, patch('native_conversation.settings_snapshot', return_value={'settings': {}}):
      root = Path(folder)
      broken = root / '损坏.png'
      broken.write_bytes(b'not an image')
      good = root / '正常.png'
      picture = QImage(2, 2, QImage.Format.Format_RGB32)
      picture.fill(0xff336699)
      self.assertTrue(picture.save(str(good)))
      store = Store(root / 'store')
      page = ConversationPage(store, lambda *_: None)
      self.addCleanup(page.close)
      with patch('native_conversation.QFileDialog.getOpenFileNames', return_value=([str(broken), str(good)], '')), patch('native_conversation.QMessageBox.warning') as warning:
        page.add_attachments()
      warning.assert_called_once()
      self.assertEqual(warning.call_args.args[1], '添加失败')
      self.assertEqual(page.attachment_list.count(), 1)
      self.assertEqual(store.image_path(page.attachments[0]).read_bytes(), good.read_bytes())

  def test_native_page_loads_legacy_agent_preferences(self):
    import tempfile
    import native_conversation

    class Store:
      def __init__(self, root):
        self.root = Path(root)
        self.records = {'c1': {'id': 'c1', 'title': '旧对话', 'messages': [], 'rounds': [], 'activeRoundId': None, 'createdAt': 1, 'updatedAt': 2, 'preferences': {'agentModel': 'chat-a', 'agentReasoningEffort': 'high', 'agentWebSearch': True, 'agentImageTools': False}}}
      def list_records(self, kind):
        return list(self.records.values()) if kind == 'conversations' else []
      def put_record(self, kind, record):
        self.records[record['id']] = record
      def delete_record(self, kind, record_id):
        self.records.pop(record_id, None)
      def image_path(self, image_id):
        return None

    app = QApplication.instance() or QApplication([])
    previous = native_conversation.settings_snapshot
    native_conversation.settings_snapshot = lambda: {'settings': {'profiles': [{'id': 'p1', 'name': 'API', 'provider': 'openai', 'apiMode': 'responses', 'model': 'chat-a', 'models': ['chat-a']}], 'agentFailover': {'primaryId': 'p1'}}}
    try:
      with tempfile.TemporaryDirectory() as folder:
        page = native_conversation.ConversationPage(Store(folder), lambda *_: {'ok': True, 'images': []})
        page.current_id = 'c1'
        page._load_current()
        self.assertEqual(page.model_combo.currentData(), 'chat-a')
        self.assertEqual(page.reasoning_combo.currentData(), 'high')
        self.assertTrue(page.web_search.isChecked())
        self.assertFalse(page.image_tools.isChecked())
        page.close()
    finally:
      native_conversation.settings_snapshot = previous
      app.processEvents()

  def test_native_page_creates_legacy_compatible_conversation(self):
    import tempfile
    import native_conversation

    class Store:
      def __init__(self, root):
        self.root = Path(root)
        self.records = {}
      def list_records(self, kind):
        return list(self.records.values()) if kind == 'conversations' else []
      def put_record(self, kind, record):
        self.records[record['id']] = record
      def delete_record(self, kind, record_id):
        self.records.pop(record_id, None)
      def image_path(self, image_id):
        return None

    app = QApplication.instance() or QApplication([])
    previous = native_conversation.settings_snapshot
    native_conversation.settings_snapshot = lambda: {'settings': {'profiles': []}}
    try:
      with tempfile.TemporaryDirectory() as folder:
        store = Store(folder)
        page = native_conversation.ConversationPage(store, lambda *_: {'ok': True, 'images': []})
        page.new_conversation()
        record = next(iter(store.records.values()))
        self.assertEqual(set(('id', 'title', 'messages', 'createdAt', 'updatedAt')) - set(record), set())
        self.assertEqual(record['title'], '新对话')
        self.assertEqual(record['messages'], [])
        page.close()
    finally:
      native_conversation.settings_snapshot = previous
      app.processEvents()


if __name__ == '__main__':
  from pathlib import Path
  from PySide6.QtCore import QEventLoop, QThread, QTimer
  unittest.main()
