"""旧版 D 创作工作区：对话、分支图片比较与同一份输入草稿。"""
import time
from PySide6.QtCore import Qt, Signal, QSize, QByteArray, QBuffer, QIODevice, QEvent, QTimer
from PySide6.QtGui import QIcon, QPixmap
from PySide6.QtWidgets import (QWidget, QFrame, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel,
  QPushButton, QComboBox, QLineEdit, QListWidget, QListWidgetItem, QScrollArea, QSplitter,
  QDialog, QFormLayout, QSpinBox, QDialogButtonBox, QMessageBox, QMenu, QInputDialog, QSizePolicy)
from native_conversation import ConversationPage, _PromptEdit, _round_path, _image_ids, _UNSET
from native_canvas import MaskDialog
from native_gallery import save_images
from native_widgets import ImageCard, MarkdownView, image_dialog


class CreationPage(ConversationPage):
  changed = Signal()
  promptsRequested = Signal()
  savePromptRequested = Signal(dict)
  historyRequested = Signal()

  def __init__(self, store, generate_image, parent=None):
    self.selected_image = None
    self.result_images = []
    self.draft_mask_id = None
    self.draft_undo = None
    self.image_params = {}
    self._columns = 0
    super().__init__(store, generate_image, parent)
    if not self.current_id: self._load_current()
    if not self.current_id and self._settings_or_empty().get('persistInputOnRestart', True):
      draft = self.store.get_meta('creationDraft', {})
      self.prompt.setPlainText(draft.get('prompt', ''))
      self.image_params = dict(draft.get('params') or {})
      self.attachments = list(draft.get('imageIds') or [])
      self.draft_mask_id = draft.get('maskImageId')
      for image_id in self.attachments: self.attachment_list.addItem('参考图片 · ' + image_id[:8])
    self.attachment_list.setVisible(bool(self.attachments))
    self.refresh_results()

  def _build_ui(self):
    self.sessions = QWidget()
    session_layout = QVBoxLayout(self.sessions)
    session_layout.setContentsMargins(0, 0, 0, 0)
    self.new_button = QPushButton('＋  新建对话')
    self.new_button.clicked.connect(self.new_conversation)
    session_layout.addWidget(self.new_button)
    heading = QLabel('对话')
    heading.setObjectName('muted')
    session_layout.addWidget(heading)
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索对话')
    self.search.textChanged.connect(self.refresh_history)
    session_layout.addWidget(self.search)
    self.history_list = QListWidget()
    self.history_list.setObjectName('sessions')
    self.history_list.currentItemChanged.connect(self._select_history)
    self.history_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
    self.history_list.customContextMenuRequested.connect(self.session_menu)
    session_layout.addWidget(self.history_list, 1)
    self.delete_button = QPushButton('删除当前对话')
    self.delete_button.clicked.connect(self.delete_conversation)
    session_layout.addWidget(self.delete_button)
    root = QVBoxLayout(self)
    root.setContentsMargins(12, 12, 12, 12)
    toolbar = QHBoxLayout()
    self.title = QLabel('新建创作')
    self.title.setObjectName('sectionTitle')
    toolbar.addWidget(self.title, 1)
    self.focus_buttons = {}
    for key, label in [('auto', '左右分栏'), ('conversation', '展开对话'), ('result', '聚焦图片')]:
      button = QPushButton(label)
      button.setCheckable(True)
      button.clicked.connect(lambda _, value=key: self.set_focus(value))
      self.focus_buttons[key] = button
      toolbar.addWidget(button)
    self.focus_buttons['auto'].setChecked(True)
    self.params_button = QPushButton('生图参数')
    self.params_button.clicked.connect(self.edit_parameters)
    toolbar.addWidget(self.params_button)
    recent_button = QPushButton('最近生成')
    recent_button.clicked.connect(self.show_recent)
    toolbar.addWidget(recent_button)
    root.addLayout(toolbar)
    self.splitter = QSplitter()
    self.splitter.setChildrenCollapsible(False)
    self.splitter.setHandleWidth(12)
    root.addWidget(self.splitter, 1)
    self.conversation_panel = QFrame()
    self.conversation_panel.setObjectName('panel')
    self.conversation_panel.setMinimumWidth(310)
    body = QVBoxLayout(self.conversation_panel)
    heading = QHBoxLayout()
    heading.addWidget(QLabel('创作对话'))
    self.conversation_status = QLabel('可讨论，也可附图修改')
    self.conversation_status.setObjectName('muted')
    heading.addWidget(self.conversation_status, 1, Qt.AlignmentFlag.AlignRight)
    body.addLayout(heading)
    self.messages_area = QScrollArea()
    self.messages_area.setWidgetResizable(True)
    self.messages_area.setFrameShape(QFrame.Shape.NoFrame)
    self.messages_area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    self.messages_widget = QWidget()
    self.messages_layout = QVBoxLayout(self.messages_widget)
    self.messages_layout.setContentsMargins(12, 8, 12, 8)
    self.messages_layout.setSpacing(18)
    self.messages_layout.addStretch(1)
    self.messages_area.setWidget(self.messages_widget)
    body.addWidget(self.messages_area, 1)
    self.context_button = QPushButton('▸ 当前上下文 · 0 轮 · 0 张图片')
    self.context_button.setObjectName('textButton')
    self.context_button.clicked.connect(self.show_context)
    body.addWidget(self.context_button)
    composer = QFrame()
    composer.setObjectName('composer')
    input_layout = QVBoxLayout(composer)
    input_layout.setSpacing(6)
    self.attachment_list = QListWidget()
    self.attachment_list.setMaximumHeight(55)
    self.attachment_list.setFlow(QListWidget.Flow.LeftToRight)
    self.attachment_list.setToolTip('双击移除参考图片')
    self.attachment_list.itemDoubleClicked.connect(lambda _: self.remove_attachment())
    input_layout.addWidget(self.attachment_list)
    self.prompt = _PromptEdit(self)
    self.prompt.setPlaceholderText('描述你的想法，也可以附图继续修改…')
    self.prompt.setMinimumHeight(62)
    self.prompt.setMaximumHeight(105)
    self.prompt.setObjectName('composerInput')
    self.prompt.submitted.connect(self.send_message)
    self.prompt.textChanged.connect(self._save_draft)
    input_layout.addWidget(self.prompt)
    tools = QHBoxLayout()
    tools.setSpacing(4)
    self.optimize = QPushButton('只优化提示词')
    self.optimize.clicked.connect(lambda: self.submit_mode(optimize=True))
    tools.addWidget(self.optimize)
    prompts = QPushButton('提示词库')
    prompts.clicked.connect(self.promptsRequested)
    tools.addWidget(prompts)
    save = QPushButton('保存提示词')
    save.clicked.connect(lambda: self.savePromptRequested.emit({'prompt': self.prompt.toPlainText(), 'title': self.prompt.toPlainText()[:24]}))
    tools.addWidget(save)
    self.direct_button = QPushButton('直接生成')
    self.direct_button.clicked.connect(lambda: self.submit_mode(direct=True))
    tools.addWidget(self.direct_button)
    for button in (self.optimize, prompts, save, self.direct_button):
      button.setStyleSheet('QPushButton { font-size: 11px; padding: 6px 4px; }')
    input_layout.addLayout(tools)
    model_row = QHBoxLayout()
    attach = QPushButton('＋ 图片')
    attach.clicked.connect(self.add_attachments)
    model_row.addWidget(attach)
    self.profile_combo = QComboBox()
    self.profile_combo.setToolTip('对话 API 配置')
    self.profile_combo.currentIndexChanged.connect(self._refresh_models)
    self.model_combo = QComboBox()
    self.model_combo.setPlaceholderText('请配置对话模型')
    for combo in (self.profile_combo, self.model_combo):
      combo.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToMinimumContentsLengthWithIcon)
      combo.setMinimumContentsLength(4)
      model_row.addWidget(combo, 1)
    input_layout.addLayout(model_row)
    actions = QHBoxLayout()
    self.reasoning_combo = QComboBox()
    self.reasoning_combo.addItem('默认', '')
    self.reasoning_combo.setToolTip('推理强度')
    for value in ('minimal', 'low', 'medium', 'high', 'xhigh', 'max'):
      self.reasoning_combo.addItem(value, value)
    actions.addWidget(self.reasoning_combo)
    self.web_search = QPushButton('联网')
    self.web_search.setToolTip('联网搜索')
    self.web_search.setCheckable(True)
    actions.addWidget(self.web_search)
    self.image_tools = QPushButton('生图')
    self.image_tools.setToolTip('允许对话调用图像工具')
    self.image_tools.setCheckable(True)
    self.image_tools.setChecked(True)
    actions.addWidget(self.image_tools)
    actions.addStretch()
    self.stop_button = QPushButton('停止')
    self.stop_button.setEnabled(False)
    self.stop_button.clicked.connect(self.stop_request)
    actions.addWidget(self.stop_button)
    self.send_button = QPushButton('↑ 发送')
    self.send_button.setObjectName('primary')
    self.send_button.clicked.connect(self.send_message)
    actions.addWidget(self.send_button)
    input_layout.addLayout(actions)
    self.undo_button = QPushButton('撤销草稿替换')
    self.undo_button.clicked.connect(self.undo_draft)
    self.undo_button.hide()
    input_layout.addWidget(self.undo_button)
    body.addWidget(composer)
    self.splitter.addWidget(self.conversation_panel)
    self.results_panel = QWidget()
    self.results_panel.installEventFilter(self)
    results_layout = QVBoxLayout(self.results_panel)
    results_layout.setContentsMargins(0, 0, 0, 0)
    result = QFrame()
    result.setObjectName('resultsPanel')
    result_layout = QVBoxLayout(result)
    heading = QHBoxLayout()
    label = QLabel('结果比较')
    label.setObjectName('sectionTitle')
    heading.addWidget(label)
    self.result_status = QLabel()
    self.result_status.setObjectName('muted')
    heading.addWidget(self.result_status, 1, Qt.AlignmentFlag.AlignRight)
    result_layout.addLayout(heading)
    self.result_scroll = QScrollArea()
    self.result_scroll.setWidgetResizable(True)
    self.result_scroll.setFrameShape(QFrame.Shape.NoFrame)
    self.result_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    self.cards_host = QWidget()
    self.cards_layout = QGridLayout(self.cards_host)
    self.cards_layout.setContentsMargins(0, 4, 0, 8)
    self.cards_layout.setSpacing(12)
    self.result_scroll.setWidget(self.cards_host)
    result_layout.addWidget(self.result_scroll, 1)
    self.image_actions = QWidget()
    actions = QVBoxLayout(self.image_actions)
    actions.setContentsMargins(0, 6, 0, 0)
    actions.setSpacing(4)
    rows = [QHBoxLayout(), QHBoxLayout()]
    for row in rows: actions.addLayout(row)
    for index, (text, callback) in enumerate([
      ('继续修改', lambda: self.edit_selected()), ('蒙版编辑', lambda: self.edit_selected(mask=True)),
      ('下载', self.download_selected), ('放大图片', self.zoom_selected),
      ('复用提示词与参数', self.reuse_selected), ('收藏作品', self.favorite_selected), ('提示词与详情', self.detail_selected)]):
      button = QPushButton(text)
      if index == 0: button.setObjectName('primary')
      elif index >= 4: button.setObjectName('textButton')
      button.clicked.connect(callback)
      rows[index // 4].addWidget(button)
    for row in rows: row.addStretch()
    result_layout.addWidget(self.image_actions)
    results_layout.addWidget(result, 1)
    recent_panel = QFrame()
    recent_panel.setObjectName('panel')
    recent_layout = QVBoxLayout(recent_panel)
    heading = QHBoxLayout()
    heading.addWidget(QLabel('最近生成'))
    heading.addStretch()
    all_history = QPushButton('全部历史 ↗')
    all_history.setObjectName('textButton')
    all_history.clicked.connect(self.historyRequested)
    heading.addWidget(all_history)
    recent_layout.addLayout(heading)
    self.recent = QListWidget()
    self.recent.setViewMode(QListWidget.ViewMode.IconMode)
    self.recent.setFlow(QListWidget.Flow.LeftToRight)
    self.recent.setWrapping(False)
    self.recent.setIconSize(QSize(80, 60))
    self.recent.setFixedHeight(82)
    self.recent.itemClicked.connect(lambda item: self.show_task(item.data(Qt.ItemDataRole.UserRole)))
    recent_layout.addWidget(self.recent)
    results_layout.addWidget(recent_panel)
    self.splitter.addWidget(self.results_panel)
    self.splitter.setSizes([390, 780])

  def set_focus(self, value):
    for key, button in self.focus_buttons.items(): button.setChecked(key == value)
    self.conversation_panel.setVisible(value != 'result')
    self.results_panel.setVisible(value != 'conversation')

  def eventFilter(self, watched, event):
    if watched is getattr(self, 'results_panel', None) and event.type() == QEvent.Type.Resize:
      columns = 2 if self.results_panel.width() >= 570 else 1
      if columns != self._columns:
        self._columns = columns
        QTimer.singleShot(0, self.refresh_results)
    return super().eventFilter(watched, event)

  def _load_current(self):
    super()._load_current()
    record = self._record() or {}
    self.image_params = dict(record.get('imageParams') or {})
    self.draft_mask_id = record.get('draftMaskImageId') if self.attachments and self._settings_or_empty().get('persistInputOnRestart') else None
    self.draft_undo = None
    self.undo_button.hide()
    self.refresh_results()

  def _save(self, record):
    state = self.draft_mask_id, dict(self.image_params), self.draft_undo
    super()._save(record)
    self.draft_mask_id, self.image_params, self.draft_undo = state
    self.undo_button.setVisible(self.draft_undo is not None)

  def _save_draft(self):
    super()._save_draft()
    if hasattr(self, 'attachment_list'): self.attachment_list.setVisible(bool(self.attachments))
    if self.current_id and not self.is_busy() and self._settings_or_empty().get('persistInputOnRestart'):
      record = self._record()
      if record:
        record['draftMaskImageId'] = self.draft_mask_id
        record['imageParams'] = dict(self.image_params)
        self.store.put_record('conversations', record)

  def _show_messages(self, record):
    self.streaming_browser = None
    while self.messages_layout.count() > 1:
      item = self.messages_layout.takeAt(0)
      if item.widget():
        item.widget().hide()
        item.widget().deleteLater()
    path = _round_path(record)
    messages = [m for m in record.get('messages', []) if path is None or not m.get('roundId') or m['roundId'] in path]
    if not messages:
      welcome = QLabel('聊聊你的创作想法\n\n描述画面，或添加图片一起修改。\n只有图像 API，也可以点击“直接生成”。')
      welcome.setWordWrap(True)
      welcome.setAlignment(Qt.AlignmentFlag.AlignCenter)
      welcome.setObjectName('muted')
      self.messages_layout.insertWidget(0, welcome)
    for message in messages:
      card = QFrame()
      card.setObjectName('assistantMessage')
      card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
      layout = QVBoxLayout(card)
      layout.setContentsMargins(12, 8, 12, 8)
      content = MarkdownView(message.get('content', ''), card)
      if message.get('role') == 'user':
        content.setObjectName('userBubble')
        content.setStyleSheet('QTextBrowser { background: palette(alternate-base); border: none; border-radius: 14px; padding: 10px; }')
        content.setMaximumWidth(260)
        bubble = QHBoxLayout()
        bubble.addStretch()
        bubble.addWidget(content, 1)
        layout.addLayout(bubble)
      else: layout.addWidget(content)
      ids = _image_ids(message, self.store)
      if ids:
        images = QPushButton(f'{"参考" if message.get("role") == "user" else "已生成"} {len(ids)} 张图片 · 查看')
        images.setObjectName('textButton')
        images.clicked.connect(lambda _, values=ids: self.show_message_images(values))
        layout.addWidget(images)
      actions = QHBoxLayout()
      round_record = next((r for r in record.get('rounds', []) if r.get('id') == message.get('roundId')), {})
      siblings = [r for r in record.get('rounds', []) if r.get('parentRoundId') == round_record.get('parentRoundId')]
      if round_record and len(siblings) > 1 and message.get('role') == 'user':
        index = next(i for i, r in enumerate(siblings) if r['id'] == round_record['id'])
        for delta, text in [(-1, '‹'), (1, '›')]:
          button = QPushButton(text)
          button.setEnabled(not self.is_busy() and 0 <= index + delta < len(siblings))
          button.clicked.connect(lambda _, rs=siblings, pos=index + delta: self.switch_branch(rs[pos]['id']))
          actions.addWidget(button)
          if delta == -1: actions.addWidget(QLabel(f'{index + 1} / {len(siblings)}'))
      actions.addStretch()
      copy = QPushButton('⧉')
      copy.setToolTip('复制')
      copy.setAccessibleName('复制')
      copy.setObjectName('messageAction')
      copy.clicked.connect(lambda _, text=message.get('content', ''): self._copy(text))
      actions.addWidget(copy)
      if message.get('role') == 'user':
        for text, callback in [('编辑', self._edit_message), ('重试', self._retry_message), ('删除', self.delete_round)]:
          if text == '重试' and round_record.get('status') not in ('error', 'cancelled') and not self._settings_or_empty().get('alwaysShowRetryButton'): continue
          button = QPushButton({'编辑': '✎', '重试': '↻', '删除': '⌫'}[text])
          button.setToolTip(text)
          button.setAccessibleName(text)
          button.setObjectName('messageAction')
          button.setEnabled(not self.is_busy())
          button.clicked.connect(lambda _, item=message, action=callback: action(item))
          actions.addWidget(button)
      elif round_record.get('status') in ('error', 'cancelled') or self._settings_or_empty().get('alwaysShowRetryButton'):
        retry = QPushButton('↻')
        retry.setToolTip('重试')
        retry.setAccessibleName('重试')
        retry.setObjectName('messageAction')
        retry.setEnabled(not self.is_busy())
        retry.clicked.connect(lambda _, item=message: self._retry_assistant(item))
        actions.addWidget(retry)
      layout.addLayout(actions)
      self.messages_layout.insertWidget(self.messages_layout.count() - 1, card)
    self.title.setText(record.get('title') or '新建创作')
    self.refresh_results()

  def current_tasks(self):
    record = self._record() or {}
    path = _round_path(record)
    rounds = [r for r in record.get('rounds', []) if path is None or r.get('id') in path]
    task_ids = {task_id for r in rounds for task_id in r.get('outputTaskIds', [])}
    task_ids.update(task_id for m in record.get('messages', []) if path is None or m.get('roundId') in path for task_id in m.get('outputTaskIds', []))
    round_ids = {r.get('id') for r in rounds}
    return sorted([task for task in self.store.list_records('tasks') if task.get('id') in task_ids or (task.get('agentConversationId') == self.current_id and self.current_id and task.get('agentRoundId') in round_ids)], key=lambda task: task.get('createdAt', 0))

  def refresh_results(self):
    if not hasattr(self, 'cards_layout'): return
    while self.cards_layout.count():
      item = self.cards_layout.takeAt(0)
      if item.widget():
        item.widget().hide()
        item.widget().deleteLater()
    for row in range(self.cards_layout.rowCount()): self.cards_layout.setRowStretch(row, 0)
    record = self._record() or {}
    tasks = self.current_tasks()
    self.result_images = [(task, image_id) for task in tasks for image_id in task.get('outputImages', [])]
    known = {image_id for _, image_id in self.result_images}
    path = _round_path(record)
    for message in record.get('messages', []):
      if message.get('role') != 'assistant' or (path is not None and message.get('roundId') not in path): continue
      for image_id in _image_ids(message, self.store):
        if image_id not in known:
          self.result_images.append(({'id': '', 'prompt': '', 'params': {}, 'agentRoundId': message.get('roundId')}, image_id))
          known.add(image_id)
    if self.selected_image not in known:
      self.selected_image = self.result_images[-1][1] if self.result_images else None
    columns = 2 if self.results_panel.width() >= 570 else 1
    self._columns = columns
    self.cards = []
    row = 0
    for task in tasks:
      if task.get('error') or task.get('status') == 'running':
        status = QLabel(task.get('error') or f'正在生成 · {len(task.get("outputImages", []))} / {task.get("params", {}).get("n", 1)} 张')
        status.setWordWrap(True)
        self.cards_layout.addWidget(status, row, 0, 1, columns)
        row += 1
    for index, (task, image_id) in enumerate(self.result_images):
      round_index = next((i + 1 for i, r in enumerate(record.get('rounds', [])) if r.get('id') == task.get('agentRoundId')), 1)
      card = ImageCard(self.store.image_path(image_id), f'第 {round_index} 轮 · 第 {task.get("outputImages", [image_id]).index(image_id) + 1} 张', f'{task.get("apiModel") or "图像"}  ·  {task.get("params", {}).get("size", "")}')
      card.setChecked(image_id == self.selected_image)
      card.setFixedHeight(330 if columns == 2 else 300)
      card.clicked.connect(lambda _, value=image_id: self.select_image(value))
      self.cards_layout.addWidget(card, row + index // columns, index % columns)
      self.cards.append((image_id, card))
    if not self.result_images and not tasks:
      empty = QLabel('✧\n\n你的下一张作品，从这里开始\n\n在对话中讨论构图，或明确说“生成一张…”\n只有图像 API 也可以使用“直接生成”')
      empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
      empty.setWordWrap(True)
      empty.setObjectName('muted')
      self.cards_layout.addWidget(empty, 0, 0, 1, columns)
    self.cards_layout.setRowStretch(row + (len(self.result_images) + columns - 1) // columns + 1, 1)
    for column in range(2): self.cards_layout.setColumnStretch(column, 1 if column < columns else 0)
    self.result_status.setText(f'当前分支 · {len(self.result_images)} 张' if self.result_images else '讨论想法，或直接开始生成')
    self.image_actions.setVisible(bool(self.result_images))
    self.context_button.setText(f'▸ 当前上下文 · {len(path or record.get("rounds", []))} 轮 · {len(known | set(self.attachments))} 张图片')
    self.recent.clear()
    for task in sorted(self.store.list_records('tasks'), key=lambda t: t.get('createdAt', 0), reverse=True)[:12]:
      images = task.get('outputImages') or []
      if not images: continue
      path = self.store.image_path(images[0])
      item = QListWidgetItem(QIcon(QPixmap(str(path))) if path else QIcon(), '')
      item.setToolTip(task.get('prompt', ''))
      item.setData(Qt.ItemDataRole.UserRole, task)
      self.recent.addItem(item)
    self.changed.emit()

  def select_image(self, image_id):
    self.selected_image = image_id
    for value, card in self.cards: card.setChecked(value == image_id)

  def selected(self):
    return next(((task, image_id) for task, image_id in self.result_images if image_id == self.selected_image), (None, None))

  def switch_branch(self, round_id):
    if self.is_busy(): return
    record = self._record()
    if not record: return
    active = round_id
    seen = set()
    while active not in seen:
      seen.add(active)
      child = next((r for r in reversed(record.get('rounds', [])) if r.get('parentRoundId') == active), None)
      if not child: break
      active = child['id']
    record['activeRoundId'] = active
    self._save(record)

  def delete_round(self, message):
    if self.is_busy(): return
    if QMessageBox.question(self, '删除对话轮次', '删除此轮及其后续分支？生成的作品会保留在历史中。') != QMessageBox.StandardButton.Yes: return
    record = self._record()
    rounds = record.get('rounds', [])
    target = next((r for r in rounds if r.get('id') == message.get('roundId')), None)
    if not target: return
    removed = {target['id']}
    for _ in rounds:
      removed.update(r['id'] for r in rounds if r.get('parentRoundId') in removed)
    record['rounds'] = [r for r in rounds if r['id'] not in removed]
    record['messages'] = [m for m in record.get('messages', []) if m.get('roundId') not in removed]
    if record.get('activeRoundId') in removed: record['activeRoundId'] = target.get('parentRoundId')
    self._save(record)

  def session_menu(self, position):
    item = self.history_list.itemAt(position)
    if not item or self.is_busy(): return
    self.history_list.setCurrentItem(item)
    menu = QMenu(self)
    rename = menu.addAction('重命名')
    delete = menu.addAction('删除对话')
    selected = menu.exec(self.history_list.mapToGlobal(position))
    if selected == rename:
      record = self._record()
      title, ok = QInputDialog.getText(self, '重命名对话', '名称', text=record.get('title', ''))
      if ok and title.strip():
        record['title'] = title.strip()
        self._save(record)
    elif selected == delete: self.delete_conversation()

  def _start_turn(self, *args, **kwargs):
    if self.is_busy(): return
    if not self.current_id:
      draft, ids, mask, params = self.prompt.toPlainText(), self.attachments[:], self.draft_mask_id, dict(self.image_params)
      self.new_conversation()
      self.prompt.setPlainText(draft)
      self.attachments, self.draft_mask_id, self.image_params = ids, mask, params
    record = self._record()
    record['imageParams'] = dict(self.image_params)
    self.store.put_record('conversations', record)
    super()._start_turn(*args, **kwargs)
    busy = self.is_busy()
    self.direct_button.setEnabled(not busy)
    self.optimize.setEnabled(not busy)
    self.params_button.setEnabled(not busy)
    self.conversation_status.setText('正在处理…' if busy else '可讨论，也可附图修改')
    self.refresh_results()

  def submit_mode(self, direct=False, optimize=False):
    prompt = self.prompt.toPlainText().strip()
    if prompt: self._start_turn(prompt, self.attachments[:], self.branch_parent_id if self.branch_mode else _UNSET, direct=direct, optimize=optimize)

  def _on_completed(self, *args):
    super()._on_completed(*args)
    self.draft_mask_id = None if not self.attachments else self.draft_mask_id
    self.direct_button.setEnabled(True)
    self.optimize.setEnabled(True)
    self.params_button.setEnabled(True)
    self.conversation_status.setText('可讨论，也可附图修改')
    self.send_button.setText('↑ 发送')
    self._save_draft()
    self.refresh_results()

  def _edit_message(self, message):
    super()._edit_message(message)
    self.draft_mask_id = message.get('maskImageId')
    self._save_draft()
    self.set_focus('auto')
    self.attachment_list.setVisible(bool(self.attachments))

  def add_attachments(self):
    if self.is_busy(): return
    super().add_attachments()
    self.attachment_list.setVisible(bool(self.attachments))
    self.refresh_results()

  def remove_attachment(self):
    super().remove_attachment()
    if not self.attachments: self.draft_mask_id = None
    self.attachment_list.setVisible(bool(self.attachments))

  def edit_selected(self, mask=False):
    task, image_id = self.selected()
    if image_id: self.edit_image({'task': task, 'imageIds': [image_id], 'mask': mask})

  def edit_image(self, value):
    if self.is_busy(): return
    ids = [image_id for image_id in value.get('imageIds', []) if self.store.image_path(image_id)]
    if not ids: return
    mask_id = value.get('maskImageId')
    if value.get('mask') and not mask_id:
      dialog = MaskDialog(str(self.store.image_path(ids[0])), self)
      if dialog.exec() != QDialog.DialogCode.Accepted: return
      data = QByteArray()
      buffer = QBuffer(data)
      buffer.open(QIODevice.OpenModeFlag.WriteOnly)
      dialog.view.mask.save(buffer, 'PNG')
      buffer.close()
      mask_id = self.store.add_image(bytes(data), source='mask')['id']
    self.remember_draft()
    self.attachments, self.draft_mask_id = ids, mask_id
    self.attachment_list.clear()
    for image_id in ids: self.attachment_list.addItem('参考图片 · ' + image_id[:8])
    self.attachment_list.show()
    self.set_focus('auto')
    self.prompt.setFocus()
    self._save_draft()

  def remember_draft(self):
    self.draft_undo = (self.current_id, self.prompt.toPlainText(), self.attachments[:], self.draft_mask_id, dict(self.image_params))
    self.undo_button.show()

  def undo_draft(self):
    if not self.draft_undo or self.is_busy() or self.draft_undo[0] != self.current_id: return
    _, text, ids, mask, params = self.draft_undo
    self.prompt.setPlainText(text)
    self.attachments, self.draft_mask_id, self.image_params = ids, mask, params
    self.attachment_list.clear()
    for image_id in ids: self.attachment_list.addItem(image_id)
    self.attachment_list.setVisible(bool(ids))
    self.draft_undo = None
    self.undo_button.hide()
    self._save_draft()

  def use_prompt(self, value):
    if self.is_busy():
      QMessageBox.information(self, '正在生成', '请先停止当前任务，再替换草稿。')
      return
    self.remember_draft()
    self.prompt.setPlainText(value.get('prompt') or value.get('content') or value.get('text', ''))
    if value.get('params'):
      self.image_params = {**value['params'], 'profileId': value.get('apiProfileId'), 'model': value.get('apiModel')}
      self.attachments = list(value.get('inputImageIds') or [])
      self.draft_mask_id = value.get('maskImageId')
      self.attachment_list.clear()
      for image_id in self.attachments: self.attachment_list.addItem(image_id)
      self.attachment_list.setVisible(bool(self.attachments))
    self._save_draft()
    self.set_focus('auto')
    self.prompt.setFocus()

  def reuse_selected(self):
    task, _ = self.selected()
    if task: self.use_prompt(task)

  def download_selected(self):
    _, image_id = self.selected()
    if image_id: save_images(self, self.store, [image_id], 'image-context-menu-single')

  def zoom_selected(self):
    _, image_id = self.selected()
    if image_id: image_dialog(self, self.store.image_path(image_id))

  def favorite_selected(self):
    task, _ = self.selected()
    if not task or not task.get('id'): return
    from native_library import LibraryPage
    page = LibraryPage(self.store)
    page.choose_collections([task['id']])
    page.deleteLater()
    self.refresh_results()

  def detail_selected(self):
    task, _ = self.selected()
    if task: self.show_task(task)

  def show_task(self, task):
    dialog = QDialog(self)
    dialog.setWindowTitle('提示词与详情')
    dialog.resize(680, 620)
    layout = QVBoxLayout(dialog)
    text = MarkdownView(task.get('prompt', ''), dialog)
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setWidget(text)
    layout.addWidget(scroll, 1)
    params = task.get('params') or {}
    label = QLabel('模型：' + str(task.get('apiModel') or '未记录') + '\n' + ' · '.join(f'{key}: {value}' for key, value in params.items()) + ('\n' + task['error'] if task.get('error') else ''))
    label.setWordWrap(True)
    layout.addWidget(label)
    buttons = QHBoxLayout()
    for title, action in [('复用提示词与参数', lambda: self.use_prompt(task)), ('继续修改', lambda: self.edit_image({'task': task, 'imageIds': task.get('outputImages', [])[:1]})), ('下载全部图片', lambda: save_images(self, self.store, task.get('outputImages', []), 'task-all'))]:
      button = QPushButton(title)
      button.clicked.connect(lambda _, callback=action: (dialog.accept(), callback()))
      buttons.addWidget(button)
    layout.addLayout(buttons)
    dialog.exec()

  def show_recent(self):
    dialog = QDialog(self)
    dialog.setWindowTitle('最近生成')
    dialog.resize(580, 650)
    layout = QVBoxLayout(dialog)
    listing = QListWidget()
    listing.setIconSize(QSize(100, 80))
    for task in sorted(self.store.list_records('tasks'), key=lambda t: t.get('createdAt', 0), reverse=True)[:50]:
      ids = task.get('outputImages') or []
      path = self.store.image_path(ids[0]) if ids else None
      item = QListWidgetItem(QIcon(QPixmap(str(path))) if path else QIcon(), task.get('prompt', '')[:100])
      item.setData(Qt.ItemDataRole.UserRole, task)
      listing.addItem(item)
    listing.itemClicked.connect(lambda item: self.show_task(item.data(Qt.ItemDataRole.UserRole)))
    layout.addWidget(listing)
    dialog.exec()

  def show_message_images(self, ids):
    if len(ids) == 1:
      path = self.store.image_path(ids[0])
      if path: image_dialog(self, path)
      return
    self.show_context(ids)

  def show_context(self, ids=None):
    record = self._record() or {}
    path = _round_path(record)
    if not isinstance(ids, list):
      ids = list(dict.fromkeys(self.attachments + [image_id for m in record.get('messages', []) if path is None or m.get('roundId') in path for image_id in _image_ids(m, self.store)]))
    dialog = QDialog(self)
    dialog.setWindowTitle('当前上下文')
    dialog.resize(540, 480)
    layout = QVBoxLayout(dialog)
    listing = QListWidget()
    listing.setIconSize(QSize(96, 72))
    for image_id in ids:
      path = self.store.image_path(image_id)
      item = QListWidgetItem(QIcon(QPixmap(str(path))) if path else QIcon(), '图片 ' + image_id[:8])
      item.setData(Qt.ItemDataRole.UserRole, image_id)
      item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
      item.setCheckState(Qt.CheckState.Unchecked)
      listing.addItem(item)
    layout.addWidget(listing)
    carry = QPushButton('携带所选图片新开对话')
    carry.setEnabled(not self.is_busy())
    def create():
      selected = [listing.item(i).data(Qt.ItemDataRole.UserRole) for i in range(listing.count()) if listing.item(i).checkState() == Qt.CheckState.Checked]
      if not selected: return
      params = dict(self.image_params)
      self.new_conversation()
      self.image_params = params
      self.attachments = selected
      self.attachment_list.clear()
      for image_id in selected: self.attachment_list.addItem(image_id)
      self._save_draft()
      dialog.accept()
    carry.clicked.connect(create)
    layout.addWidget(carry)
    dialog.exec()

  def edit_parameters(self):
    if self.is_busy(): return
    dialog = QDialog(self)
    dialog.setWindowTitle('生图参数')
    dialog.resize(450, 600)
    layout = QVBoxLayout(dialog)
    form = QFormLayout()
    profiles = [p for p in self._settings_or_empty().get('profiles', []) if p.get('apiMode') == 'images']
    profile = QComboBox()
    for p in profiles: profile.addItem(p.get('name') or p['id'], p['id'])
    settings = self._settings_or_empty()
    selected = self.image_params.get('profileId') or (settings.get('failover') or {}).get('primaryId') or settings.get('activeProfileId')
    profile.setCurrentIndex(max(0, profile.findData(selected)))
    model = QComboBox()
    def models():
      p = next((p for p in profiles if p['id'] == profile.currentData()), {})
      model.clear()
      model.addItems(p.get('models') or [p.get('model', '')])
      model.setCurrentText(self.image_params.get('model') or p.get('model', ''))
    profile.currentIndexChanged.connect(models)
    models()
    form.addRow('Images API', profile)
    form.addRow('图像模型', model)
    fields = {}
    for key, title, options in [('size', '尺寸', ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2560x1440', '3840x2160']), ('quality', '质量', ['auto', 'low', 'medium', 'high', 'xhigh', 'max']), ('output_format', '格式', ['png', 'jpeg', 'webp']), ('background', '背景', ['auto', 'opaque', 'transparent']), ('moderation', '审核', ['', 'auto', 'low'])]:
      combo = QComboBox()
      combo.addItems(options)
      combo.setEditable(key == 'size')
      combo.setCurrentText(str(self.image_params.get(key, options[0])))
      fields[key] = combo
      form.addRow(title, combo)
    count = QSpinBox()
    count.setRange(1, 100)
    count.setValue(int(self.image_params.get('n', 1)))
    form.addRow('张数', count)
    compression = QSpinBox()
    compression.setRange(-1, 100)
    compression.setSpecialValueText('默认')
    compression.setValue(self.image_params.get('output_compression') if self.image_params.get('output_compression') is not None else -1)
    form.addRow('压缩质量', compression)
    layout.addLayout(form)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    layout.addWidget(buttons)
    if dialog.exec() == QDialog.DialogCode.Accepted:
      self.image_params = {key: widget.currentText() for key, widget in fields.items()}
      self.image_params.update({'profileId': profile.currentData(), 'model': model.currentText(), 'n': count.value(), 'output_compression': None if compression.value() < 0 else compression.value()})
      record = self._record()
      if record:
        record['imageParams'] = dict(self.image_params)
        self.store.put_record('conversations', record)
