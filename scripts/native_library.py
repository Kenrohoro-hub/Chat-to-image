"""原生桌面的历史作品与收藏夹。"""
import time
import uuid
from pathlib import Path

from PySide6.QtCore import Qt, QSize, Signal, QByteArray, QBuffer, QIODevice, QEvent, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
  QApplication, QComboBox, QDialog, QFileDialog, QGridLayout, QHBoxLayout,
  QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPushButton,
  QScrollArea, QVBoxLayout, QWidget, QFrame, QInputDialog,
  QDialogButtonBox, QSizePolicy,
)

from native_canvas import ImageView, MaskDialog
from native_gallery import save_images
from native_widgets import ImageCard, image_dialog


class LibraryPage(QWidget):
  reuse = Signal(dict)
  editRequested = Signal(dict)
  openConversation = Signal(str)

  def __init__(self, store, parent=None):
    super().__init__(parent)
    self.store = store
    self.records = []
    self.mode = 'history'
    self.collection_id = None
    self.selected_ids = set()
    self.active_id = None
    self._building = False
    self._render_pending = False
    self._layout_pending = False
    self.render_timer = QTimer(self)
    self.render_timer.setSingleShot(True)
    self.render_timer.timeout.connect(self._render_after_resize)
    self.layout_timer = QTimer(self)
    self.layout_timer.setSingleShot(True)
    self.layout_timer.timeout.connect(self._activate_grid_layout)
    root = QVBoxLayout(self)
    self.title = QLabel()
    self.title.setObjectName('pageTitle')
    root.addWidget(self.title)
    bar = QHBoxLayout()
    self.back = QPushButton('返回收藏夹')
    self.back.clicked.connect(self.show_collections)
    bar.addWidget(self.back)
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索描述或收藏夹')
    self.search.textChanged.connect(self.refresh)
    bar.addWidget(self.search, 1)
    self.status_filter = QComboBox()
    for label, value in [('全部状态', ''), ('已完成', 'success'), ('失败', 'error'), ('进行中', 'running'), ('已停止', 'cancelled')]:
      self.status_filter.addItem(label, value)
    self.status_filter.currentIndexChanged.connect(self.refresh)
    bar.addWidget(self.status_filter)
    for label, callback in [('新建收藏夹', self.new_collection), ('刷新', self.refresh)]:
      button = QPushButton(label)
      button.clicked.connect(callback)
      bar.addWidget(button)
    root.addLayout(bar)
    selection_bar = QHBoxLayout()
    self.selection_count = QLabel('未选择作品')
    self.selection_count.setObjectName('muted')
    selection_bar.addWidget(self.selection_count, 1)
    for label, callback in [('选择收藏夹', self.choose_selected_collections), ('下载选中', self.download_selected), ('删除选中', self.delete_selected_tasks)]:
      button = QPushButton(label)
      button.clicked.connect(callback)
      button.setEnabled(False)
      selection_bar.addWidget(button)
      if label == '选择收藏夹': self.choose_button = button
      elif label == '下载选中': self.download_button = button
      else: self.delete_button = button
    root.addLayout(selection_bar)
    self.scroll = QScrollArea()
    self.scroll.setWidgetResizable(True)
    self.scroll.setFrameShape(QFrame.Shape.NoFrame)
    self.scroll.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
    self.grid_host = QWidget()
    self.grid_host.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Maximum)
    self.grid = QGridLayout(self.grid_host)
    self.grid.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
    self.grid.setContentsMargins(4, 4, 8, 8)
    self.grid.setSpacing(12)
    self.grid_host.installEventFilter(self)
    self.scroll.setWidget(self.grid_host)
    self.scroll.viewport().installEventFilter(self)
    root.addWidget(self.scroll, 1)
    self.view = None
    self.outputs = None
    self.details = None
    self.detail_dialog = None
    self.reload_collections()
    self.set_mode('history')

  def set_mode(self, mode):
    self.mode = 'favorites' if mode == 'favorites' else 'history'
    self.collection_id = None
    self.title.setText('我的收藏' if self.mode == 'favorites' else '生成历史')
    self.back.setVisible(self.mode == 'favorites')
    self.status_filter.setVisible(self.mode == 'history')
    self.refresh()

  def reload_collections(self):
    self.collections = self.store.list_records('collections')
    self.refresh()

  def resizeEvent(self, event):
    super().resizeEvent(event)
    self._schedule_render()

  def eventFilter(self, watched, event):
    if watched is self.scroll.viewport() and event.type() == QEvent.Type.Resize:
      self._schedule_render()
    if watched is self.grid_host and event.type() == QEvent.Type.Resize:
      self._schedule_grid_layout()
    return super().eventFilter(watched, event)

  def _schedule_render(self):
    if self._building or self._render_pending: return
    self._render_pending = True
    self.render_timer.start(0)

  def _render_after_resize(self):
    self._render_pending = False
    self._render()

  def _schedule_grid_layout(self):
    if self._layout_pending: return
    self._layout_pending = True
    self.layout_timer.start(0)

  def _activate_grid_layout(self):
    self._layout_pending = False
    self.grid.invalidate()
    self.grid.activate()

  def current(self):
    return next((task for task in self.records if task.get('id') == self.active_id), None)

  def refresh(self, *args):
    selected = self.current()
    self.records = self.store.list_records('tasks')
    self.collections = self.store.list_records('collections')
    if selected:
      self.active_id = selected['id']
    else:
      self.active_id = None
    valid_ids = {task.get('id') for task in self.records}
    if self.active_id not in valid_ids: self.active_id = None
    self.selected_ids.intersection_update(valid_ids)
    self._render()

  def _clear_grid(self):
    rows, columns = self.grid.rowCount(), self.grid.columnCount()
    while self.grid.count():
      item = self.grid.takeAt(0)
      if item.widget():
        item.widget().hide()
        item.widget().deleteLater()
    for row in range(rows): self.grid.setRowStretch(row, 0)
    for column in range(columns): self.grid.setColumnStretch(column, 0)

  def _render(self):
    if not hasattr(self, 'grid'): return
    self._building = True
    self._clear_grid()
    if self.mode == 'favorites' and self.collection_id is None:
      self._render_collections()
    else:
      self._render_tasks()
    count = len(self.selected_ids)
    self.selection_count.setText(f'已选 {count} 条作品（Ctrl+点击可多选）' if count else '未选择作品')
    self.choose_button.setEnabled(bool(count))
    self.download_button.setEnabled(bool(count))
    self.delete_button.setEnabled(bool(count))
    self._building = False
    self.grid.activate()
    self._schedule_grid_layout()

  def _columns(self, card_width=280):
    return max(1, self.scroll.viewport().width() // card_width)

  def _render_tasks(self):
    term = self.search.text().strip().casefold()
    status = self.status_filter.currentData() if self.mode == 'history' else ''
    tasks = sorted(self.records, key=lambda task: task.get('createdAt', 0), reverse=True)
    tasks = [task for task in tasks if (not term or term in task.get('prompt', '').casefold())]
    tasks = [task for task in tasks if (not status or task.get('status') == status or status == 'success' and task.get('status') == 'done')]
    if self.mode == 'favorites':
      tasks = [task for task in tasks if task.get('isFavorite') and (not self.collection_id or self.collection_id == '*' or self.collection_id in task.get('favoriteCollectionIds', []))]
    for index, task in enumerate(tasks):
      card = self._task_card(task)
      self.grid.addWidget(card, index // self._columns(), index % self._columns(), Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
    if not tasks:
      message = '没有找到匹配的作品' if term or status else '还没有收藏的图片' if self.mode == 'favorites' else '还没有作品记录'
      label = QLabel(message)
      label.setObjectName('muted')
      label.setAlignment(Qt.AlignmentFlag.AlignCenter)
      self.grid.addWidget(label, 0, 0, Qt.AlignmentFlag.AlignTop)

  def _task_card(self, task):
    image_id = next(iter(task.get('outputImages', [])), None)
    path = self.store.image_path(image_id) if image_id else None
    state = {'success': '完成', 'done': '完成', 'error': '失败', 'running': '进行中', 'cancelled': '已停止'}.get(task.get('status'), task.get('status', ''))
    card = ImageCard(str(path) if path and path.is_file() else None, ('★ ' if task.get('isFavorite') else '') + (task.get('prompt') or '无描述'), f'{state} · {len(task.get("outputImages", []))} 张')
    card.setChecked(task.get('id') in self.selected_ids)
    card.setToolTip('点击查看详情；Ctrl+点击可多选')
    card.clicked.connect(lambda checked, row=task: self._card_clicked(row))
    return card

  def _card_clicked(self, task):
    if QApplication.keyboardModifiers() & Qt.KeyboardModifier.ControlModifier:
      self._toggle_task(task)
      return
    self.selected_ids = {task['id']}
    self.active_id = task['id']
    self._render()
    self.open_details(task)

  def _select_task(self, task):
    self.active_id = task['id']
    self.selected_ids.add(task['id'])
    if self.outputs: self._show_task(task)
    self._render()

  def _toggle_task(self, task):
    if task['id'] in self.selected_ids:
      self.selected_ids.remove(task['id'])
    else:
      self.selected_ids.add(task['id'])
    self.active_id = task['id']
    self._render()

  def open_details(self, task):
    dialog = QDialog(self)
    dialog.setWindowTitle('作品详情')
    dialog.resize(1000, 760)
    layout = QVBoxLayout(dialog)
    self.view = ImageView(dialog)
    layout.addWidget(self.view, 1)
    self.outputs = QComboBox(dialog)
    self.outputs.currentIndexChanged.connect(self.show_output)
    layout.addWidget(self.outputs)
    self.details = QLabel(dialog)
    self.details.setObjectName('muted')
    self.details.setWordWrap(True)
    self.details.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    layout.addWidget(self.details)
    actions = QGridLayout()
    buttons = [
      ('复用描述与参考', self.reuse_task), ('在当前对话修改', self.edit_in_conversation),
      ('局部蒙版修改', self.edit_with_mask), ('收藏 / 取消', self.favorite),
      ('编辑收藏夹', self.assign_collection), ('放大图片', self.zoom_image),
      ('保存当前图片', self.save_image), ('删除作品记录', self.delete_task),
      ('保存选中图片', self.download_selected), ('保存本作品全部图片', self.download_task_images),
    ]
    for index, (label, callback) in enumerate(buttons):
      button = QPushButton(label)
      button.clicked.connect(callback)
      actions.addWidget(button, index // 2, index % 2)
    layout.addLayout(actions)
    self.detail_dialog = dialog
    self._show_task(task)
    dialog.exec()
    self.detail_dialog = self.view = self.outputs = self.details = None

  def _show_task(self, task):
    if not self.outputs: return
    self.outputs.blockSignals(True)
    self.outputs.clear()
    for index, image_id in enumerate(task.get('outputImages', [])):
      self.outputs.addItem(f'图片 {index + 1}', image_id)
    self.outputs.blockSignals(False)
    params = task.get('params') or {}
    labels = [('apiProfileName', '配置'), ('apiModel', '模型')]
    lines = [f'{label}：{task[key]}' for key, label in labels if task.get(key)]
    for key, label in [('size', '尺寸'), ('quality', '质量'), ('output_format', '格式'), ('n', '张数'), ('background', '背景'), ('moderation', '内容审核'), ('output_compression', '压缩质量')]:
      if params.get(key) is not None: lines.append(f'{label}：{params[key]}')
    if task.get('error'): lines.append(f'错误：{task["error"]}')
    self.details.setText(task.get('prompt', '') + ('\n' + '\n'.join(lines) if lines else ''))
    self.show_output()

  def show_output(self, *args):
    if not self.outputs or not self.view: return
    image_id = self.outputs.currentData()
    path = self.store.image_path(image_id) if image_id else None
    if path and path.is_file():
      try: self.view.set_image(path)
      except ValueError as exc: self.details.setText(str(exc))

  def zoom_image(self):
    if not self.outputs: return
    image_id = self.outputs.currentData()
    path = self.store.image_path(image_id) if image_id else None
    if path and path.is_file(): image_dialog(self, path)

  def _render_collections(self):
    term = self.search.text().strip().casefold()
    tasks = [task for task in self.records if task.get('isFavorite')]
    cards = [{'id': '*', 'name': '全部收藏', 'tasks': tasks}]
    cards.extend({'id': row['id'], 'name': row.get('name', '收藏夹'), 'tasks': [task for task in tasks if row['id'] in task.get('favoriteCollectionIds', [])]} for row in self.collections)
    cards = [card for card in cards if not term or term in card['name'].casefold()]
    for index, collection in enumerate(cards):
      card = QFrame()
      card.setObjectName('card')
      layout = QVBoxLayout(card)
      cover = QGridLayout()
      cover_images = self._cover_images(collection)
      for offset in range(4):
        thumb = QLabel()
        thumb.setAlignment(Qt.AlignmentFlag.AlignCenter)
        thumb.setMinimumSize(72, 58)
        thumb.setObjectName('muted')
        if offset < len(cover_images):
          path = self.store.image_path(cover_images[offset])
          if path and path.is_file(): thumb.setPixmap(QPixmap(str(path)).scaled(QSize(110, 78), Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation))
        else: thumb.setText('☆')
        cover.addWidget(thumb, offset // 2, offset % 2)
      layout.addLayout(cover)
      layout.addWidget(QLabel(collection['name']))
      count = QLabel(f'{len(collection["tasks"])} 条作品')
      count.setObjectName('muted')
      layout.addWidget(count)
      actions = QHBoxLayout()
      open_button = QPushButton('进入')
      open_button.clicked.connect(lambda checked=False, row=collection: self._open_collection(row['id']))
      actions.addWidget(open_button)
      if collection['id'] != '*':
        rename = QPushButton('改名')
        rename.clicked.connect(lambda checked=False, row=collection: self.rename_collection(row['id']))
        actions.addWidget(rename)
        remove = QPushButton('删除')
        remove.clicked.connect(lambda checked=False, row=collection: self.delete_collection(row['id']))
        actions.addWidget(remove)
      layout.addLayout(actions)
      self.grid.addWidget(card, index // self._columns(250), index % self._columns(250), Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
    if not cards:
      label = QLabel('没有找到匹配的收藏夹')
      label.setObjectName('muted')
      self.grid.addWidget(label, 0, 0, Qt.AlignmentFlag.AlignTop)

  def _cover_images(self, collection):
    rows = collection['tasks']
    collection_id = collection['id']
    def added_at(task):
      times = task.get('favoriteAddedAt') or {}
      relevant = times.values() if collection_id == '*' else [times.get(collection_id, 0)]
      return max([task.get('createdAt', 0), *relevant])
    ordered = sorted(rows, key=added_at, reverse=True)
    return list(dict.fromkeys(image_id for task in ordered for image_id in task.get('outputImages', [])))[:4]

  def _open_collection(self, collection_id):
    self.collection_id = collection_id
    self.back.setVisible(True)
    self.refresh()

  def show_collections(self):
    self.collection_id = None
    self.refresh()

  def new_collection(self):
    name, ok = QInputDialog.getText(self, '新建收藏夹', '名称')
    if not ok or not name.strip(): return
    now = int(time.time() * 1000)
    self.store.put_record('collections', {'id': uuid.uuid4().hex, 'name': name.strip(), 'createdAt': now, 'updatedAt': now})
    self.reload_collections()

  def rename_collection(self, collection_id):
    collection = next((row for row in self.collections if row['id'] == collection_id), None)
    if not collection: return
    name, ok = QInputDialog.getText(self, '重命名收藏夹', '名称', text=collection.get('name', ''))
    if ok and name.strip():
      collection['name'] = name.strip()
      collection['updatedAt'] = int(time.time() * 1000)
      self.store.put_record('collections', collection)
      self.reload_collections()

  def delete_collection(self, collection_id):
    if QMessageBox.question(self, '删除收藏夹', '删除此收藏夹？作品及图片会保留。') != QMessageBox.StandardButton.Yes: return
    for task in self.records:
      if collection_id in task.get('favoriteCollectionIds', []):
        task['favoriteCollectionIds'] = [value for value in task['favoriteCollectionIds'] if value != collection_id]
        task['isFavorite'] = bool(task['favoriteCollectionIds'])
        self.store.put_record('tasks', task)
    self.store.delete_record('collections', collection_id)
    self.reload_collections()

  def reuse_task(self):
    task = self.current()
    if not task: return
    self.reuse.emit(task)

  def edit_in_conversation(self):
    task = self.current()
    if not task: return
    conversation_id = task.get('agentConversationId') or task.get('conversationId')
    if conversation_id: self.openConversation.emit(conversation_id)
    self.editRequested.emit({'task': task, 'imageIds': [self.outputs.currentData()] if self.outputs.currentData() else [], 'mask': False})

  def edit_with_mask(self):
    task = self.current()
    image_id = self.outputs.currentData()
    path = self.store.image_path(image_id) if image_id else None
    if not task or not path or not path.is_file(): return
    dialog = MaskDialog(str(path), self)
    if dialog.exec() != QDialog.DialogCode.Accepted: return
    data = QByteArray()
    buffer = QBuffer(data)
    if not buffer.open(QIODevice.OpenModeFlag.WriteOnly) or not dialog.view.mask.save(buffer, 'PNG'):
      buffer.close()
      QMessageBox.warning(self, '局部修改', '蒙版保存失败。')
      return
    buffer.close()
    mask = self.store.add_image(bytes(data), source='mask')
    self.editRequested.emit({'task': task, 'imageIds': [image_id], 'mask': True, 'maskImageId': mask['id']})

  def favorite(self):
    task = self.current()
    if not task: return
    task['isFavorite'] = not task.get('isFavorite')
    if not task['isFavorite']: task['favoriteCollectionIds'] = []
    self.store.put_record('tasks', task)
    self.refresh()

  def assign_collection(self):
    task = self.current()
    if task: self.choose_collections([task['id']])

  def choose_selected_collections(self):
    if self.selected_ids: self.choose_collections(list(self.selected_ids))

  def choose_collections(self, task_ids):
    ids = set(task_ids)
    tasks = [task for task in self.records if task.get('id') in ids]
    if not tasks: return
    if not self.collections:
      self.new_collection()
      self.reload_collections()
    if not self.collections: return
    dialog = QDialog(self)
    dialog.setWindowTitle('选择收藏夹')
    dialog.resize(380, 420)
    layout = QVBoxLayout(dialog)
    layout.addWidget(QLabel(f'为 {len(tasks)} 条作品选择收藏夹'))
    options = QListWidget()
    layout.addWidget(options, 1)
    existing = [set(task.get('favoriteCollectionIds', [])) for task in tasks]
    selected = existing[0] if all(ids == existing[0] for ids in existing) else set()
    for collection in self.collections:
      item = QListWidgetItem(collection.get('name', '收藏夹'), options)
      item.setData(Qt.ItemDataRole.UserRole, collection['id'])
      item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
      item.setCheckState(Qt.CheckState.Checked if collection['id'] in selected else Qt.CheckState.Unchecked)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
    buttons.button(QDialogButtonBox.StandardButton.Save).setText('保存')
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    layout.addWidget(buttons)
    if dialog.exec() != QDialog.DialogCode.Accepted: return
    collection_ids = [options.item(index).data(Qt.ItemDataRole.UserRole) for index in range(options.count()) if options.item(index).checkState() == Qt.CheckState.Checked]
    for task in tasks:
      task['favoriteCollectionIds'] = collection_ids[:]
      task['isFavorite'] = bool(collection_ids)
      self.store.put_record('tasks', task)
    self.refresh()

  def save_image(self):
    image_id = self.outputs.currentData()
    path = self.store.image_path(image_id) if image_id else None
    if not path or not path.is_file(): return
    target, _ = QFileDialog.getSaveFileName(self, '保存图片', path.name, f'图片 (*{path.suffix})')
    if target:
      try: Path(target).write_bytes(path.read_bytes())
      except OSError as exc: QMessageBox.warning(self, '保存失败', str(exc))

  def delete_task(self):
    task = self.current()
    if not task: return
    if task.get('status') == 'running':
      QMessageBox.information(self, '任务进行中', '请先停止任务，再删除作品。')
      return
    if QMessageBox.question(self, '删除作品', '删除这条作品记录？图片文件会保留。') != QMessageBox.StandardButton.Yes: return
    self.store.delete_record('tasks', task['id'])
    self.selected_ids.clear()
    self.refresh()
    if self.detail_dialog: self.detail_dialog.accept()

  def delete_selected_tasks(self):
    tasks = [task for task in self.records if task.get('id') in self.selected_ids]
    deletable = [task for task in tasks if task.get('status') != 'running']
    if not deletable:
      QMessageBox.information(self, '任务进行中', '选中的作品均在运行中，无法删除。')
      return
    running = len(tasks) - len(deletable)
    message = f'删除选中的 {len(deletable)} 条作品记录？图片文件会保留。'
    if running: message += f'\n另有 {running} 条运行中的作品会保留。'
    if QMessageBox.question(self, '批量删除', message) != QMessageBox.StandardButton.Yes: return
    for task in deletable: self.store.delete_record('tasks', task['id'])
    self.selected_ids.difference_update(task['id'] for task in deletable)
    if self.active_id in {task['id'] for task in deletable}: self.active_id = None
    self.refresh()

  def download_task_images(self):
    task = self.current()
    if task: save_images(self, self.store, task.get('outputImages', []), 'task-detail-all')

  def download_selected(self):
    ids = [image for task in self.records if task.get('id') in self.selected_ids for image in task.get('outputImages', [])]
    save_images(self, self.store, ids, 'favorite-collection-selection' if self.mode == 'favorites' else 'task-selection')
