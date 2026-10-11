import json
import re
import threading
import uuid
from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
  QComboBox, QDialog, QFileDialog, QHBoxLayout, QLabel, QLineEdit, QListWidget,
  QListWidgetItem, QMessageBox, QPushButton, QScrollArea, QTextBrowser,
  QTextEdit, QVBoxLayout, QWidget,
)

from desktop_config import settings_snapshot
from native_responses import call_responses
from playground_image import CallError


_UNSET = object()

def _id():
  return uuid.uuid4().hex


def _record_for_save(record):
  # API credentials are read from encrypted desktop settings and never enter conversation history.
  def clean(value):
    if isinstance(value, dict):
      return {key: clean(item) for key, item in value.items() if key not in ('apiKey', 'profiles', 'settings')}
    if isinstance(value, list):
      return [clean(item) for item in value]
    return value
  return clean(record)


def _image_ids(message, store=None):
  result = []
  for key in ('imageIds', 'inputImageIds', 'outputImageIds'):
    values = message.get(key, [])
    if isinstance(values, list):
      result.extend(item for item in values if isinstance(item, str))
  task_ids = message.get('outputTaskIds', [])
  if store and isinstance(task_ids, list):
    task_map = {item.get('id'): item for item in store.list_records('tasks')}
    for task_id in task_ids:
      task = task_map.get(task_id)
      if task:
        result.extend(item for item in task.get('outputImages', []) if isinstance(item, str))
  return list(dict.fromkeys(result))


def _round_path(record):
  rounds = {item.get('id'): item for item in record.get('rounds', []) if isinstance(item, dict) and item.get('id')}
  active = record.get('activeRoundId')
  if not rounds or active not in rounds:
    return None
  path = []
  seen = set()
  while active and active in rounds and active not in seen:
    seen.add(active)
    path.append(active)
    active = rounds[active].get('parentRoundId')
  return set(path)


class _PromptEdit(QTextEdit):
  submitted = Signal()

  def __init__(self, page):
    super().__init__(page)
    self.page = page

  def keyPressEvent(self, event):
    if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and (self.page._settings_or_empty().get('enterSubmit') or event.modifiers() & Qt.KeyboardModifier.ControlModifier) and not event.modifiers() & Qt.KeyboardModifier.ShiftModifier:
      self.submitted.emit()
      event.accept()
      return
    super().keyPressEvent(event)


def _image_request(prompt, params, messages, store):
  latest = next((item for item in reversed(messages) if item.get('role') == 'user' and not item.get('syntheticImageContext')), {})
  ids = re.findall(r'<ref\s+id=["\']([^"\']+)["\']\s*/?>', prompt) + latest.get('imageIds', [])
  paths = [store.image_path(image_id) for image_id in dict.fromkeys(ids)]
  request = {
    'prompt': prompt, 'images': [str(path) for path in paths if path and path.exists()],
    'sourceMode': 'agent', 'agentConversationId': latest.get('conversationId'), 'agentRoundId': latest.get('roundId'),
    'size': params.get('size', 'auto'), 'quality': params.get('quality', 'auto'),
    'format': params.get('output_format', 'png'), 'count': params.get('n', 1),
    'background': params.get('background', 'transparent' if params.get('transparent_output') else 'auto'),
  }
  for key in ('profileId', 'model', 'moderation', 'output_compression'):
    if params.get(key) is not None: request[key] = params[key]
  if latest.get('maskImageId'):
    path = store.image_path(latest['maskImageId'])
    if path and path.exists(): request['mask'] = str(path)
  return request


class _ConversationWorker(QThread):
  delta = Signal(str)
  image_ready = Signal(dict)
  completed = Signal(str, list, str, list)

  def __init__(self, settings, messages, image_params, store, generate_image, cancel, profile_id=None, direct=False):
    super().__init__()
    self.settings = settings
    self.messages = messages
    self.image_params = image_params or {}
    self.store = store
    self.generate_image = generate_image
    self.cancel = cancel
    self.profile_id = profile_id
    self.direct = direct

  def run(self):
    images = []
    response_output = []
    try:
      if self.direct:
        user = next(item for item in reversed(self.messages) if item.get('role') == 'user')
        request = _image_request(user['content'], self.image_params, self.messages, self.store)
        result = self.generate_image(request, self.cancel, self.image_ready.emit)
        images = result.get('images', [])
        error = '' if result.get('ok') else (result.get('error') or {}).get('message', '图片生成失败。')
        output = [{'type': 'image_task', 'taskId': result['taskId']}] if result.get('taskId') else []
        self.completed.emit('图片已生成。' if not error else error, images, error, output)
        return
      request_messages = list(self.messages)
      profile_id = self.profile_id
      max_rounds = max(1, min(10, int(self.settings.get('agentMaxToolRounds', 1))))
      tool_error = ''
      for tool_round in range(max_rounds + 1):
        result, profile = call_responses(
          self.settings,
          request_messages,
          self.cancel,
          self.delta.emit,
          profile_id,
        )
        profile_id = profile.get('id')
        response_output.extend(result.get('output', []))
        calls = [item for item in result.get('output', []) if item.get('type') == 'function_call']
        if not calls:
          self.completed.emit(result.get('text', ''), images, '', response_output)
          return
        if tool_round >= max_rounds or self.settings.get('agentImageTools') is False:
          self.completed.emit(result.get('text', ''), images, '已达到图像工具调用上限。', response_output)
          return
        request_messages.extend(result.get('output', []))
        for call in calls:
          if self.cancel.is_set():
            raise InterruptedError('请求已取消。')
          name = call.get('name')
          try:
            args = json.loads(call.get('arguments') or '{}')
          except (TypeError, json.JSONDecodeError):
            args = {}
          prompt = args.get('prompt', '').strip() if isinstance(args.get('prompt'), str) else ''
          if name not in ('generate_image', 'edit_image') or not prompt:
            output = {'ok': False, 'error': '工具名称或提示词无效。'}
            tool_error = output['error']
          else:
            request = _image_request(prompt, self.image_params, self.messages, self.store)
            try:
              if self.messages:
                request['agentConversationId'] = self.messages[0].get('conversationId')
              output = self.generate_image(request, self.cancel, self.image_ready.emit)
            except Exception as error:
              output = {'ok': False, 'error': {'message': str(error)}}
            saved = [item for item in output.get('images', []) if item.get('id') and item.get('path')]
            images.extend(saved)
            task_id = output.get('taskId') or output.get('task_id')
            if not output.get('ok'):
              details = output.get('error') or {}
              tool_error = details.get('message', '图像工具执行失败。') if isinstance(details, dict) else str(details)
            output = {
              'ok': bool(output.get('ok')),
              'image_ids': [item['id'] for item in saved],
              'task_id': task_id,
              'error': (output.get('error') or {}).get('message') if isinstance(output.get('error'), dict) else output.get('error'),
              'warnings': output.get('warnings', []),
            }
          tool_output = {
            'type': 'function_call_output',
            'call_id': call.get('call_id') or call.get('id'),
            'output': json.dumps(output, ensure_ascii=False),
          }
          request_messages.append(tool_output)
          response_output.append(tool_output)
          if isinstance(output, dict) and output.get('task_id'):
            response_output.append({'type': 'image_task', 'taskId': output['task_id']})
        if tool_round + 1 >= max_rounds:
          summary = result.get('text', '') or ('图片已生成。' if not tool_error else tool_error)
          self.completed.emit(summary, images, tool_error, response_output)
          return
      self.completed.emit('', images, '', response_output)
    except InterruptedError as error:
      self.completed.emit('', images, str(error), response_output)
    except Exception as error:
      self.completed.emit('', images, str(error), response_output)


class ConversationPage(QWidget):
  taskFinished = Signal(bool, str)

  def __init__(self, store, generate_image, parent=None):
    super().__init__(parent)
    self.store = store
    self.generate_image = generate_image
    self.current_id = None
    self.cancel_event = None
    self.worker = None
    self.branch_parent_id = None
    self.branch_mode = False
    self.worker_conversation_id = None
    self.attachments = []
    self.streaming_text = ''
    self.streaming_browser = None
    self._build_ui()
    self._refresh_profiles()
    self.refresh_history()

  def _build_ui(self):
    root = QHBoxLayout(self)
    history = QVBoxLayout()
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索对话')
    self.search.textChanged.connect(self.refresh_history)
    history.addWidget(self.search)
    self.history_list = QListWidget()
    self.history_list.currentItemChanged.connect(self._select_history)
    history.addWidget(self.history_list, 1)
    history_buttons = QHBoxLayout()
    self.new_button = QPushButton('新建对话')
    self.new_button.clicked.connect(self.new_conversation)
    self.delete_button = QPushButton('删除')
    self.delete_button.clicked.connect(self.delete_conversation)
    history_buttons.addWidget(self.new_button)
    history_buttons.addWidget(self.delete_button)
    history.addLayout(history_buttons)
    left = QWidget()
    left.setLayout(history)
    left.setMinimumWidth(220)
    left.setMaximumWidth(320)
    root.addWidget(left)

    body = QVBoxLayout()
    settings_row = QHBoxLayout()
    self.profile_combo = QComboBox()
    self.profile_combo.currentIndexChanged.connect(self._refresh_models)
    self.model_combo = QComboBox()
    self.reasoning_combo = QComboBox()
    self.reasoning_combo.addItem('默认推理', '')
    for value in ('minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
      self.reasoning_combo.addItem(value, value)
    self.web_search = QPushButton('联网搜索：关')
    self.web_search.setCheckable(True)
    self.web_search.toggled.connect(lambda value: self.web_search.setText('联网搜索：开' if value else '联网搜索：关'))
    self.image_tools = QPushButton('图像工具：开')
    self.image_tools.setCheckable(True)
    self.image_tools.setChecked(True)
    self.image_tools.toggled.connect(lambda value: self.image_tools.setText('图像工具：开' if value else '图像工具：关'))
    settings_row.addWidget(QLabel('Responses'))
    settings_row.addWidget(self.profile_combo, 1)
    settings_row.addWidget(self.model_combo, 1)
    body.addLayout(settings_row)
    options_row = QHBoxLayout()
    options_row.addWidget(self.reasoning_combo)
    options_row.addWidget(self.web_search)
    options_row.addWidget(self.image_tools)
    options_row.addStretch(1)
    body.addLayout(options_row)

    self.messages_area = QScrollArea()
    self.messages_area.setWidgetResizable(True)
    self.messages_widget = QWidget()
    self.messages_layout = QVBoxLayout(self.messages_widget)
    self.messages_layout.addStretch(1)
    self.messages_area.setWidget(self.messages_widget)
    body.addWidget(self.messages_area, 1)
    self.attachment_list = QListWidget()
    self.attachment_list.setMaximumHeight(78)
    body.addWidget(self.attachment_list)
    self.prompt = _PromptEdit(self)
    self.prompt.setPlaceholderText('输入消息；明确要求时可生成或编辑图片')
    self.prompt.submitted.connect(self.send_message)
    self.prompt.textChanged.connect(self._save_draft)
    self.prompt.setMaximumHeight(130)
    body.addWidget(self.prompt)
    actions = QHBoxLayout()
    attach = QPushButton('添加图片')
    attach.clicked.connect(self.add_attachments)
    remove = QPushButton('移除选中附件')
    remove.clicked.connect(self.remove_attachment)
    self.send_button = QPushButton('发送')
    self.send_button.clicked.connect(self.send_message)
    self.stop_button = QPushButton('停止')
    self.stop_button.setEnabled(False)
    self.stop_button.clicked.connect(self.stop_request)
    actions.addWidget(attach)
    actions.addWidget(remove)
    actions.addStretch(1)
    actions.addWidget(self.stop_button)
    actions.addWidget(self.send_button)
    body.addLayout(actions)
    main = QWidget()
    main.setLayout(body)
    root.addWidget(main, 1)

  def _settings_or_empty(self):
    result = settings_snapshot()
    return result.get('settings') or {}

  def _settings(self):
    result = settings_snapshot()
    settings = result.get('settings')
    if not settings:
      raise RuntimeError(result.get('error') or '未找到可用的 API 配置。')
    return settings

  def _profiles(self):
    try:
      settings = self._settings()
    except Exception:
      settings = {}
    return [p for p in settings.get('profiles', []) if p.get('provider') == 'openai' and p.get('apiMode') == 'responses']

  def _refresh_profiles(self):
    selected = self.profile_combo.currentData()
    self.profile_combo.blockSignals(True)
    self.profile_combo.clear()
    self.profile_combo.addItem('自动（主备）', None)
    for profile in self._profiles():
      self.profile_combo.addItem(profile.get('name') or profile.get('id'), profile.get('id'))
    if selected:
      idx = self.profile_combo.findData(selected)
      if idx >= 0:
        self.profile_combo.setCurrentIndex(idx)
    self.profile_combo.blockSignals(False)
    self._refresh_models()

  def _refresh_models(self):
    profiles = self._profiles()
    selected_id = self.profile_combo.currentData()
    settings = {}
    try:
      settings = self._settings()
    except Exception:
      pass
    if selected_id is None:
      primary_id = (settings.get('agentFailover') or {}).get('primaryId')
      profile = next((p for p in profiles if p.get('id') == primary_id), None)
    else:
      profile = next((p for p in profiles if p.get('id') == selected_id), None)
    self.model_combo.clear()
    if profile:
      for model in profile.get('models') or [profile.get('model')]:
        if model:
          self.model_combo.addItem(model, model)
      index = self.model_combo.findData(settings.get('agentModel') or profile.get('model'))
      if index >= 0: self.model_combo.setCurrentIndex(index)

  def refresh_history(self, *_):
    current = self.current_id
    records = sorted(self.store.list_records('conversations'), key=lambda item: item.get('updatedAt', 0), reverse=True)
    query = self.search.text().strip().casefold()
    self.history_list.blockSignals(True)
    self.history_list.clear()
    for record in records:
      searchable = (record.get('title', '') + '\n' + '\n'.join(m.get('content', '') for m in record.get('messages', []))).casefold()
      if query and query not in searchable:
        continue
      item = QListWidgetItem(record.get('title') or '新对话')
      item.setData(Qt.ItemDataRole.UserRole, record.get('id'))
      self.history_list.addItem(item)
      if record.get('id') == current:
        self.history_list.setCurrentItem(item)
    self.history_list.blockSignals(False)
    if not current and self.history_list.count():
      self.history_list.setCurrentRow(0)
    elif current:
      self._load_current()

  def _select_history(self, current, _previous=None):
    if not current:
      return
    self.current_id = current.data(Qt.ItemDataRole.UserRole)
    self.branch_parent_id = None
    self.branch_mode = False
    self._load_current()

  def _record(self, conversation_id=None):
    target_id = conversation_id or self.current_id
    return next((item for item in self.store.list_records('conversations') if item.get('id') == target_id), None)

  def _load_current(self):
    record = self._record()
    self._refresh_profiles()
    prefs = (record or {}).get('preferences') or {}
    current_settings = self._settings_or_empty()
    profile_idx = self.profile_combo.findData(prefs.get('profileId'))
    if profile_idx >= 0:
      self.profile_combo.setCurrentIndex(profile_idx)
    model_idx = self.model_combo.findData(prefs.get('model', prefs.get('agentModel')))
    if model_idx >= 0:
      self.model_combo.setCurrentIndex(model_idx)
    reasoning_idx = self.reasoning_combo.findData(prefs.get('reasoning', prefs.get('agentReasoningEffort', current_settings.get('agentReasoningEffort', ''))))
    if reasoning_idx >= 0:
      self.reasoning_combo.setCurrentIndex(reasoning_idx)
    self.web_search.setChecked(bool(prefs.get('webSearch', prefs.get('agentWebSearch', current_settings.get('agentWebSearch', False)))))
    self.image_tools.setChecked(prefs.get('imageTools', prefs.get('agentImageTools', current_settings.get('agentImageTools', True))))
    self.prompt.blockSignals(True)
    if current_settings.get('persistInputOnRestart'):
      self.prompt.setPlainText((record or {}).get('draft', ''))
      self.attachments = list((record or {}).get('draftImageIds', []))
      self.attachment_list.clear()
      for image_id in self.attachments:
        self.attachment_list.addItem(image_id)
      self.branch_mode = bool((record or {}).get('draftBranchMode'))
      self.branch_parent_id = (record or {}).get('draftBranchParentId')
    else:
      self.prompt.clear()
      self.attachments = []
      self.attachment_list.clear()
      self.branch_mode = False
      self.branch_parent_id = None
    self.prompt.blockSignals(False)
    self._show_messages(record or {'messages': []})

  def _show_messages(self, record):
    if self.streaming_browser:
      self.messages_layout.removeWidget(self.streaming_browser)
      self.streaming_browser.deleteLater()
      self.streaming_browser = None
    while self.messages_layout.count() > 1:
      item = self.messages_layout.takeAt(0)
      widget = item.widget()
      if widget:
        widget.deleteLater()
    messages = record.get('messages', [])
    active_path = _round_path(record)
    visible = [message for message in messages if active_path is None or not message.get('roundId') or message.get('roundId') in active_path]
    for message in visible:
      card = QWidget()
      layout = QVBoxLayout(card)
      layout.setContentsMargins(8, 6, 8, 8)
      layout.addWidget(QLabel('你' if message.get('role') == 'user' else '助手'))
      text = QTextBrowser()
      text.setOpenExternalLinks(True)
      text.setMarkdown(message.get('content', ''))
      text.setMinimumHeight(50)
      text.setMaximumHeight(280)
      layout.addWidget(text)
      round_record = next((item for item in record.get('rounds', []) if item.get('id') == message.get('roundId')), {})
      task_ids = list(dict.fromkeys(message.get('outputTaskIds', []) + round_record.get('outputTaskIds', [])))
      message_image_ids = _image_ids({**message, 'outputTaskIds': task_ids}, self.store)
      for image_id in message_image_ids:
        path = self.store.image_path(image_id)
        if path and path.exists():
          preview = QLabel()
          preview.setPixmap(QPixmap(str(path)).scaled(180, 140, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
          layout.addWidget(preview)
          open_image = QPushButton('查看图片')
          open_image.clicked.connect(lambda _checked=False, file_path=path: self._open_image(file_path))
          save_image = QPushButton('另存图片')
          save_image.clicked.connect(lambda _checked=False, file_path=path: self._save_image(file_path))
          layout.addWidget(open_image)
          layout.addWidget(save_image)
      if message.get('role') == 'assistant' and message_image_ids:
        save_all = QPushButton('保存本轮全部图片')
        save_all.clicked.connect(lambda _checked=False, ids=message_image_ids: self._save_all_images(ids))
        layout.addWidget(save_all)
      actions = QHBoxLayout()
      if message.get('role') == 'user':
        edit = QPushButton('编辑并分支')
        edit.clicked.connect(lambda _checked=False, item=message: self._edit_message(item))
        retry = QPushButton('重试')
        retry.clicked.connect(lambda _checked=False, item=message: self._retry_message(item))
        actions.addWidget(edit)
        actions.addWidget(retry)
      else:
        copy = QPushButton('复制')
        copy.clicked.connect(lambda _checked=False, content=message.get('content', ''): self._copy(content))
        actions.addWidget(copy)
        round_record = next((item for item in record.get('rounds', []) if item.get('id') == message.get('roundId')), {})
        settings = self._settings_or_empty()
        if round_record.get('status') == 'error' or settings.get('alwaysShowRetryButton'):
          retry = QPushButton('重试上一条')
          retry.clicked.connect(lambda _checked=False, item=message: self._retry_assistant(item))
          actions.addWidget(retry)
      layout.addLayout(actions)
      card.setStyleSheet('QWidget { background: palette(alternate-base); border-radius: 6px; }')
      self.messages_layout.insertWidget(self.messages_layout.count() - 1, card)

  def _save_draft(self):
    if not self._settings_or_empty().get('persistInputOnRestart') or not self.current_id or self.is_busy():
      return
    record = self._record()
    if record:
      record['draft'] = self.prompt.toPlainText()
      record['draftImageIds'] = self.attachments[:]
      record['draftBranchMode'] = self.branch_mode
      record['draftBranchParentId'] = self.branch_parent_id
      self.store.put_record('conversations', _record_for_save(record))

  def _open_image(self, path):
    dialog = QDialog(self)
    dialog.setWindowTitle(path.name)
    layout = QVBoxLayout(dialog)
    preview = QLabel()
    preview.setPixmap(QPixmap(str(path)).scaled(960, 720, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
    layout.addWidget(preview)
    close = QPushButton('关闭')
    close.clicked.connect(dialog.accept)
    layout.addWidget(close)
    dialog.resize(980, 760)
    dialog.exec()

  def _save_image(self, path):
    target, _ = QFileDialog.getSaveFileName(self, '保存图片', path.name, '图片 (*.%s)' % path.suffix.lstrip('.'))
    if target:
      try:
        import shutil
        shutil.copy2(path, target)
      except OSError as error:
        QMessageBox.warning(self, '保存失败', str(error))

  def _save_all_images(self, image_ids):
    try:
      from native_gallery import save_images
      save_images(self, self.store, image_ids, 'agent-round-all')
    except (ImportError, OSError, RuntimeError) as error:
      QMessageBox.warning(self, '保存失败', str(error))

  def _save(self, record):
    draft = self.prompt.toPlainText()
    attachments = self.attachments[:]
    self.store.put_record('conversations', _record_for_save(record))
    self.refresh_history()
    if self.current_id == record.get('id'):
      self.prompt.blockSignals(True)
      self.prompt.setPlainText(draft)
      self.prompt.blockSignals(False)
      self.attachments = attachments
      self.attachment_list.clear()
      for image_id in attachments:
        path = self.store.image_path(image_id)
        self.attachment_list.addItem(path.name if path else image_id)

  def new_conversation(self):
    if self.is_busy():
      return
    now = int(__import__('time').time() * 1000)
    record = {'id': _id(), 'title': '新对话', 'messages': [], 'createdAt': now, 'updatedAt': now, 'rounds': [], 'activeRoundId': None}
    self.store.put_record('conversations', record)
    self.current_id = record['id']
    self.branch_parent_id = None
    self.branch_mode = False
    self.refresh_history()

  def delete_conversation(self):
    if self.is_busy() or not self.current_id:
      return
    if QMessageBox.question(self, '删除对话', '删除此对话记录？已保存图片会保留。') != QMessageBox.StandardButton.Yes:
      return
    self.store.delete_record('conversations', self.current_id)
    self.current_id = None
    self.branch_parent_id = None
    self.branch_mode = False
    self.refresh_history()
    if not self.current_id:
      self.new_conversation()

  def add_attachments(self):
    paths, _ = QFileDialog.getOpenFileNames(self, '选择参考图片', '', '图片 (*.png *.jpg *.jpeg *.webp)')
    for source in paths:
      try:
        source_path = Path(source)
        image_id = _id()
        image = self.store.add_image(source_path, image_id=image_id, source='upload')
        self.attachments.append(image['id'])
        self.attachment_list.addItem(source_path.name)
        self._save_draft()
      except (OSError, ValueError, CallError) as error:
        QMessageBox.warning(self, '添加失败', str(error))

  def remove_attachment(self):
    row = self.attachment_list.currentRow()
    if row >= 0:
      self.attachment_list.takeItem(row)
      self.attachments.pop(row)
      self._save_draft()

  def _edit_message(self, message):
    self.prompt.setPlainText(message.get('content', ''))
    self.attachments = list(message.get('inputImageIds', message.get('imageIds', [])))
    self.attachment_list.clear()
    for image_id in self.attachments:
      self.attachment_list.addItem(image_id)
    record = self._record() or {}
    round_record = next((r for r in record.get('rounds', []) if r.get('id') == message.get('roundId')), {})
    self.branch_parent_id = round_record.get('parentRoundId')
    self.branch_mode = True
    self.prompt.setFocus()
    self._save_draft()

  def _retry_message(self, message):
    if self.is_busy(): return
    self.attachments = list(message.get('inputImageIds', message.get('imageIds', [])))
    if hasattr(self, 'draft_mask_id'): self.draft_mask_id = message.get('maskImageId')
    if hasattr(self, 'image_params') and 'imageParams' in message: self.image_params = dict(message['imageParams'])
    record = self._record() or {}
    round_record = next((r for r in record.get('rounds', []) if r.get('id') == message.get('roundId')), {})
    self._start_turn(message.get('content', ''), self.attachments, round_record.get('parentRoundId'), direct=message.get('directGeneration', False))

  def _retry_assistant(self, message):
    record = self._record() or {}
    user = next((item for item in reversed(record.get('messages', [])) if item.get('role') == 'user' and item.get('roundId') == message.get('roundId')), None)
    if user:
      self._retry_message(user)

  def _copy(self, content):
    from PySide6.QtGui import QGuiApplication
    QGuiApplication.clipboard().setText(content)

  def send_message(self):
    prompt = self.prompt.toPlainText().strip()
    if prompt:
      self._start_turn(prompt, list(self.attachments), self.branch_parent_id if self.branch_mode else _UNSET)

  def _start_turn(self, prompt, image_ids, parent_round_id=_UNSET, *, direct=False, optimize=False):
    try:
      settings = self._settings()
    except Exception as error:
      QMessageBox.warning(self, '无法发送', str(error))
      return
    model = self.model_combo.currentData()
    if model:
      settings['agentModel'] = model
    settings['agentReasoningEffort'] = self.reasoning_combo.currentData()
    settings['agentWebSearch'] = self.web_search.isChecked()
    settings['agentImageTools'] = self.image_tools.isChecked() and not optimize
    if optimize:
      prompt = '请只优化下面的图像提示词，保留原意，输出可直接使用的完整提示词。不要生成或修改图片。\n\n' + prompt
    if self.cancel_event:
      return
    record = self._record()
    if not record:
      self.new_conversation()
      record = self._record()
    now = int(__import__('time').time() * 1000)
    round_id = _id()
    messages = list(record.get('messages', []))
    rounds = list(record.get('rounds', []))
    user = {'id': _id(), 'role': 'user', 'content': prompt, 'roundId': round_id, 'createdAt': now, 'imageIds': image_ids[:], 'inputImageIds': image_ids[:]}
    user['directGeneration'] = direct
    user['imageParams'] = dict(record.get('imageParams') or {})
    if getattr(self, 'draft_mask_id', None): user['maskImageId'] = self.draft_mask_id
    if not record.get('messages'):
      record['title'] = ' '.join(prompt.split())[:32] or '新对话'
    messages.append(user)
    rounds.append({'id': round_id, 'parentRoundId': record.get('activeRoundId') if parent_round_id is _UNSET else parent_round_id, 'userMessageId': user['id'], 'status': 'running', 'createdAt': now})
    record.update({'messages': messages, 'rounds': rounds, 'activeRoundId': round_id, 'updatedAt': now, 'preferences': {'profileId': self.profile_combo.currentData(), 'model': self.model_combo.currentData(), 'reasoning': settings.get('agentReasoningEffort'), 'webSearch': settings['agentWebSearch'], 'imageTools': settings['agentImageTools'], 'agentModel': self.model_combo.currentData(), 'agentReasoningEffort': settings.get('agentReasoningEffort'), 'agentWebSearch': settings['agentWebSearch'], 'agentImageTools': settings['agentImageTools']}})
    current_settings = self._settings_or_empty()
    if current_settings.get('persistInputOnRestart'):
      if current_settings.get('clearInputAfterSubmit', True):
        record['draft'] = ''
        record['draftImageIds'] = []
        record['draftMaskImageId'] = None
        record['draftBranchMode'] = False
        record['draftBranchParentId'] = None
      else:
        record['draft'] = prompt
        record['draftImageIds'] = image_ids[:]
    self._save(record)
    if current_settings.get('clearInputAfterSubmit', True):
      self.attachments = []
      if hasattr(self, 'draft_mask_id'): self.draft_mask_id = None
      self.branch_mode = False
      self.branch_parent_id = None
      self.prompt.clear()
      self.attachment_list.clear()
    self.branch_parent_id = None
    self.branch_mode = False
    api_messages = []
    active_path = _round_path(record)
    for message in messages:
      if active_path is not None and message.get('roundId') and message.get('roundId') not in active_path:
        continue
      if message.get('roundId') == round_id and message.get('id') != user['id']:
        continue
      if message.get('role') not in ('user', 'assistant'):
        continue
      data_urls = []
      round_record = next((item for item in rounds if item.get('id') == message.get('roundId')), {})
      output_task_ids = list(dict.fromkeys(message.get('outputTaskIds', []) + round_record.get('outputTaskIds', [])))
      image_ids = _image_ids({**message, 'outputTaskIds': output_task_ids}, self.store)
      for image_id in image_ids:
        path = self.store.image_path(image_id)
        if path and path.exists():
          import base64
          import mimetypes
          mime = mimetypes.guess_type(str(path))[0] or 'image/png'
          data_urls.append('data:%s;base64,%s' % (mime, base64.b64encode(path.read_bytes()).decode('ascii')))
      context_message = {**message, 'conversationId': record['id'], 'imageDataUrls': data_urls}
      if data_urls and not direct:
        refs = ' '.join('<ref id="%s" />' % image_id for image_id in image_ids)
        context_message['content'] = (message.get('content', '') + '\n' + refs).strip()
      api_messages.append(context_message)
      if message.get('role') == 'assistant' and data_urls:
        refs = ' '.join('<ref id="%s" />' % image_id for image_id in image_ids)
        api_messages.append({'role': 'user', 'content': '已生成图片参考：' + refs, 'imageIds': image_ids[:], 'roundId': message.get('roundId'), 'conversationId': record['id'], 'imageDataUrls': data_urls, 'syntheticImageContext': True})
    self.streaming_text = ''
    self.cancel_event = threading.Event()
    self.worker_conversation_id = record['id']
    self.worker = _ConversationWorker(settings, api_messages, record.get('imageParams'), self.store, self.generate_image, self.cancel_event, self.profile_combo.currentData(), direct=direct)
    self.worker.delta.connect(self._on_delta)
    self.worker.image_ready.connect(self._on_image_ready)
    self.worker.completed.connect(lambda text, images, error, output, rid=round_id: self._on_completed(rid, text, images, error, output))
    self.worker.finished.connect(self._worker_finished)
    self.worker.finished.connect(self.worker.deleteLater)
    self.send_button.setEnabled(False)
    self.stop_button.setEnabled(True)
    self.history_list.setEnabled(False)
    self.new_button.setEnabled(False)
    self.delete_button.setEnabled(False)
    self.prompt.setEnabled(False)
    self.profile_combo.setEnabled(False)
    self.model_combo.setEnabled(False)
    self.reasoning_combo.setEnabled(False)
    self.web_search.setEnabled(False)
    self.image_tools.setEnabled(False)
    self.worker.start()
    if current_settings.get('agentScrollToBottomAfterSubmit'):
      self.messages_area.verticalScrollBar().setValue(self.messages_area.verticalScrollBar().maximum())

  def refresh(self):
    if self.is_busy():
      return
    draft = self.prompt.toPlainText()
    attachments = self.attachments[:]
    self._refresh_profiles()
    self.refresh_history()
    self.prompt.blockSignals(True)
    self.prompt.setPlainText(draft)
    self.prompt.blockSignals(False)
    self.attachments = attachments
    self.attachment_list.clear()
    for image_id in attachments:
      path = self.store.image_path(image_id)
      self.attachment_list.addItem(path.name if path else image_id)

  def is_busy(self):
    return bool(self.worker and self.worker.isRunning())

  def shutdown(self):
    if not self.worker or not self.worker.isRunning():
      return True
    if self.cancel_event:
      self.cancel_event.set()
    self.worker.wait(1500)
    return not self.worker.isRunning()

  def _on_delta(self, delta):
    self.streaming_text += delta
    self.send_button.setText('接收中…')
    if not self.streaming_browser:
      self.streaming_browser = QTextBrowser(self.messages_widget)
      self.streaming_browser.setMinimumHeight(50)
      self.streaming_browser.setMaximumHeight(280)
      self.messages_layout.insertWidget(self.messages_layout.count() - 1, self.streaming_browser)
    self.streaming_browser.setMarkdown(self.streaming_text)
    self.messages_area.verticalScrollBar().setValue(self.messages_area.verticalScrollBar().maximum())

  def _on_image_ready(self, image):
    record = self._record(self.worker_conversation_id)
    if not record:
      return
    message = next((item for item in reversed(record.get('messages', [])) if item.get('role') == 'assistant' and item.get('streaming') and item.get('roundId') == record.get('activeRoundId')), None)
    if not message:
      message = {'id': _id(), 'role': 'assistant', 'content': '', 'roundId': record.get('activeRoundId'), 'createdAt': int(__import__('time').time() * 1000), 'imageIds': [], 'streaming': True}
      record['messages'].append(message)
    message.setdefault('imageIds', []).append(image.get('id'))
    self._save(record)
    if self.streaming_text:
      self._on_delta('')

  def _on_completed(self, round_id, text, images, error, response_output):
    cancelled = bool(self.cancel_event and self.cancel_event.is_set()) or '取消' in error
    if self.streaming_browser:
      self.messages_layout.removeWidget(self.streaming_browser)
      self.streaming_browser.deleteLater()
      self.streaming_browser = None
    self.streaming_text = ''
    record = self._record(self.worker_conversation_id)
    if record:
      current = next((item for item in reversed(record.get('messages', [])) if item.get('role') == 'assistant' and item.get('roundId') == round_id), None)
      image_ids = [item['id'] for item in images if item.get('id')]
      if current:
        current['content'] = text or ('已停止。' if '取消' in error else error)
        current['imageIds'] = list(dict.fromkeys(current.get('imageIds', []) + image_ids))
        current.pop('streaming', None)
      elif text or image_ids or error:
        record.setdefault('messages', []).append({'id': _id(), 'role': 'assistant', 'content': text or ('已停止。' if '取消' in error else error), 'roundId': round_id, 'createdAt': int(__import__('time').time() * 1000), 'imageIds': image_ids})
      round_record = next((item for item in record.get('rounds', []) if item.get('id') == round_id), None)
      if round_record:
        round_record['responseOutput'] = response_output
        round_record['outputTaskIds'] = [item['taskId'] for item in response_output if item.get('type') == 'image_task' and item.get('taskId')]
        if current:
          current['outputTaskIds'] = round_record['outputTaskIds'][:]
        round_record['status'] = 'cancelled' if cancelled else 'error' if error else 'done'
        if error and not cancelled:
          round_record['error'] = error
      record['updatedAt'] = int(__import__('time').time() * 1000)
      self._save(record)
    self.cancel_event = None
    self.worker_conversation_id = None
    self.history_list.setEnabled(True)
    self.new_button.setEnabled(True)
    self.delete_button.setEnabled(True)
    self.prompt.setEnabled(True)
    self.profile_combo.setEnabled(True)
    self.model_combo.setEnabled(True)
    self.reasoning_combo.setEnabled(True)
    self.web_search.setEnabled(True)
    self.image_tools.setEnabled(True)
    self.send_button.setText('发送')
    self.send_button.setEnabled(True)
    self.stop_button.setEnabled(False)
    summary = text or ('已停止。' if '取消' in error else ('图片已生成。' if images else '对话已完成。'))
    self.taskFinished.emit(not error, summary if not error else error)

  def _worker_finished(self):
    self.worker = None

  def stop_request(self):
    if self.cancel_event:
      self.cancel_event.set()
      self.stop_button.setEnabled(False)
