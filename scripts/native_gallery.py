"""原生创作与作品页面。"""
import os
import zipfile
from pathlib import Path
import shutil
import tempfile
import threading
import time

from PySide6.QtCore import Qt, QSize, QThread, Signal, QEvent, QByteArray, QBuffer, QIODevice
from PySide6.QtGui import QIcon, QPixmap, QImage, QGuiApplication
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QSplitter, QLabel, QPushButton, QTextEdit, QLineEdit, QComboBox, QSpinBox, QListWidget, QListWidgetItem, QFileDialog, QMessageBox, QDialog, QAbstractItemView, QInputDialog, QScrollArea, QGridLayout

from desktop_config import settings_snapshot
from native_canvas import ImageView, MaskDialog


def save_images(parent, store, image_ids, route):
  paths = [store.image_path(image_id) for image_id in dict.fromkeys(image_ids)]
  paths = [path for path in paths if path and path.is_file()]
  if not paths:
    QMessageBox.information(parent, '下载图片', '没有可保存的图片。')
    return
  settings = settings_snapshot().get('settings') or {}
  compressed = route in settings.get('zipDownloadRoutes', ['task-selection', 'favorite-collection-selection'])
  try:
    if compressed:
      target, _ = QFileDialog.getSaveFileName(parent, '保存图片压缩包', 'Chat-to-image-pictures.zip', 'ZIP (*.zip)')
      if not target: return
      handle, temporary = tempfile.mkstemp(prefix='.images-', suffix='.zip', dir=Path(target).parent)
      os.close(handle)
      try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_STORED) as archive:
          for index, path in enumerate(paths): archive.write(path, f'image-{index + 1}{path.suffix}')
        os.replace(temporary, target)
      finally: Path(temporary).unlink(missing_ok=True)
    else:
      target = QFileDialog.getExistingDirectory(parent, '选择图片保存目录')
      if not target: return
      outputs = [Path(target) / f'image-{index + 1}{path.suffix}' for index, path in enumerate(paths)]
      if any(path.exists() for path in outputs):
        if QMessageBox.question(parent, '覆盖图片', '保存位置已有同名图片，是否覆盖这些同名文件？') != QMessageBox.StandardButton.Yes: return
      for source, destination in zip(paths, outputs):
        if source.resolve() != destination.resolve(): shutil.copy2(source, destination)
    QMessageBox.information(parent, '下载完成', f'已保存 {len(paths)} 张图片。')
  except (OSError, ValueError) as exc: QMessageBox.warning(parent, '下载失败', str(exc))


class WorkThread(QThread):
  completed = Signal(object)
  failed = Signal(str)
  image = Signal(object)

  def __init__(self, operation, parent=None):
    super().__init__(parent)
    self.operation = operation

  def run(self):
    try: self.completed.emit(self.operation(self))
    except Exception as exc: self.failed.emit(str(exc))


class GalleryPage(QWidget):
  changed = Signal()
  taskFinished = Signal(bool, str)

  def __init__(self, store, service, parent=None):
    super().__init__(parent)
    self.store, self.service = store, service
    self.attachments = []
    self.mask = None
    self.mask_file = None
    self.mask_image_id = None
    self.worker = None
    self.cancel = threading.Event()
    self.current_image = None
    self.settings = {}
    layout = QVBoxLayout(self)
    heading = QLabel('创作画廊')
    heading.setObjectName('pageTitle')
    layout.addWidget(heading)
    splitter = QSplitter()
    layout.addWidget(splitter, 1)
    form = QWidget()
    form_layout = QVBoxLayout(form)
    form_layout.setContentsMargins(0, 0, 14, 0)
    form_layout.addWidget(QLabel('描述你想创作的图片'))
    self.prompt = QTextEdit()
    self.prompt.installEventFilter(self)
    self.prompt.setPlaceholderText('画面、主体、风格、光线……\n可添加参考图，或涂抹蒙版进行局部修改。')
    self.prompt.setMinimumHeight(170)
    form_layout.addWidget(self.prompt, 1)
    attach_bar = QHBoxLayout()
    for title, callback in [('添加参考图', self.add_references), ('绘制蒙版', self.edit_mask), ('清空参考', self.clear_references)]:
      button = QPushButton(title)
      button.clicked.connect(callback)
      attach_bar.addWidget(button)
    form_layout.addLayout(attach_bar)
    self.references = QListWidget()
    self.references.setMaximumHeight(95)
    self.references.itemDoubleClicked.connect(self.remove_reference)
    self.references.setToolTip('双击移除参考图')
    form_layout.addWidget(self.references)
    fields = QFormLayout()
    self.profile = QComboBox()
    self.model = QComboBox()
    self.size = QComboBox()
    self.size.setEditable(True)
    self.size.addItems(['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2560x1440', '1440x2560', '3840x2160', '2160x3840'])
    self.quality = QComboBox()
    self.quality.addItems(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    self.format = QComboBox()
    self.format.addItems(['png', 'jpeg', 'webp'])
    self.background = QComboBox()
    self.background.addItem('自动', 'auto')
    self.background.addItem('透明', 'transparent')
    self.background.addItem('不透明', 'opaque')
    self.count = QSpinBox()
    self.count.setRange(1, 100)
    self.moderation = QComboBox()
    self.moderation.addItem('默认', '')
    self.moderation.addItem('自动', 'auto')
    self.moderation.addItem('宽松', 'low')
    self.compression = QSpinBox()
    self.compression.setRange(-1, 100)
    self.compression.setValue(-1)
    self.compression.setSpecialValueText('默认')
    for label, widget in [('API 配置', self.profile), ('图像模型', self.model), ('尺寸', self.size), ('质量', self.quality), ('格式', self.format), ('背景', self.background), ('张数', self.count), ('审核', self.moderation), ('压缩质量', self.compression)]: fields.addRow(label, widget)
    form_layout.addLayout(fields)
    actions = QHBoxLayout()
    self.generate_button = QPushButton('生成图片')
    self.generate_button.setObjectName('primary')
    self.generate_button.clicked.connect(self.generate)
    self.stop_button = QPushButton('停止')
    self.stop_button.setEnabled(False)
    self.stop_button.clicked.connect(lambda: self.cancel.set())
    actions.addWidget(self.generate_button, 1)
    actions.addWidget(self.stop_button)
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    scroll.setMinimumWidth(325)
    scroll.setWidget(form)
    left_panel = QWidget()
    left_layout = QVBoxLayout(left_panel)
    left_layout.setContentsMargins(0, 0, 14, 0)
    left_layout.addWidget(scroll, 1)
    left_layout.addLayout(actions)
    splitter.addWidget(left_panel)
    result_panel = QWidget()
    results_layout = QVBoxLayout(result_panel)
    results_layout.setContentsMargins(0, 0, 0, 0)
    self.view = ImageView()
    results_layout.addWidget(self.view, 1)
    self.results = QListWidget()
    self.results.setViewMode(QListWidget.ViewMode.IconMode)
    self.results.setFlow(QListWidget.Flow.LeftToRight)
    self.results.setWrapping(False)
    self.results.setIconSize(QSize(112, 88))
    self.results.setMaximumHeight(132)
    self.results.currentItemChanged.connect(self.select_result)
    results_layout.addWidget(self.results)
    actions = QHBoxLayout()
    for title, callback in [('适应窗口', self.view.fit_image), ('保存图片', self.save_image), ('复制图片', self.copy_image), ('用作参考', self.use_current), ('保存全部', lambda: save_images(self, self.store, [self.results.item(i).data(Qt.ItemDataRole.UserRole)['id'] for i in range(self.results.count())], 'image-context-menu-all'))]:
      button = QPushButton(title)
      button.clicked.connect(callback)
      actions.addWidget(button)
    results_layout.addLayout(actions)
    splitter.addWidget(result_panel)
    splitter.setSizes([380, 720])
    self.status = QLabel('添加描述开始创作。图片会逐张保存，滚轮可缩放预览。')
    self.status.setWordWrap(True)
    layout.addWidget(self.status)
    self.profile.currentIndexChanged.connect(self.load_models)
    self.reload_settings()
    self.restore_draft()

  def reload_settings(self):
    selected = self.profile.currentData()
    snapshot = settings_snapshot()
    self.settings = snapshot.get('settings') or {}
    self.profile.blockSignals(True)
    self.profile.clear()
    disabled = (self.settings.get('failover') or {}).get('disabledIds', [])
    for profile in self.settings.get('profiles', []):
      if profile.get('provider') == 'openai' and profile.get('apiMode') == 'images' and profile['id'] not in disabled:
        self.profile.addItem(profile.get('name') or '未命名 API', profile['id'])
    selected = selected or (self.settings.get('failover') or {}).get('primaryId') or self.settings.get('activeProfileId')
    index = self.profile.findData(selected)
    if index >= 0: self.profile.setCurrentIndex(index)
    self.profile.blockSignals(False)
    self.load_models()
    if snapshot.get('error'): self.status.setText(snapshot['error'])

  def load_models(self):
    selected = self.model.currentText()
    self.model.clear()
    profile = next((p for p in self.settings.get('profiles', []) if p['id'] == self.profile.currentData()), {})
    self.model.addItems(profile.get('models') or [profile.get('model', '')])
    self.model.setCurrentText(selected if selected in (profile.get('models') or []) else profile.get('model', ''))

  def request(self):
    return {'prompt': self.prompt.toPlainText(), 'profileId': self.profile.currentData(), 'model': self.model.currentText(), 'size': self.size.currentText(), 'quality': self.quality.currentText(), 'format': self.format.currentText(), 'background': self.background.currentData(), 'count': self.count.value(), 'images': list(self.attachments), 'moderation': self.moderation.currentData() or None, 'output_compression': None if self.compression.value() < 0 else self.compression.value(), 'maskImageId': self.mask_image_id}

  def _persist_mask(self):
    if self.mask is None: return
    data = QByteArray()
    buffer = QBuffer(data)
    if not buffer.open(QIODevice.OpenModeFlag.WriteOnly) or not self.mask.save(buffer, 'PNG'):
      buffer.close()
      raise ValueError('无法保存蒙版。')
    buffer.close()
    record = self.store.add_image(bytes(data), source='mask')
    self.mask_image_id = record['id']
    self.mask_file = record['path']
    self.mask = None

  def _restore_mask(self, image_id, legacy_path=None):
    self.mask_image_id = image_id if isinstance(image_id, str) else None
    path = self.store.image_path(self.mask_image_id) if self.mask_image_id else None
    if path and path.is_file():
      self.mask_file = str(path)
      self.mask = None
      return
    self.mask_image_id = None
    self.mask_file = legacy_path if isinstance(legacy_path, str) and Path(legacy_path).is_file() else None
    self.mask = None

  def restore_draft(self):
    draft = self.store.get_meta('creationDraft', {}) if self.settings.get('persistInputOnRestart', True) else {}
    if not isinstance(draft, dict): draft = {}
    self.prompt.setPlainText(draft.get('prompt', draft.get('text', '')))
    profile_id = draft.get('profileId')
    if profile_id:
      index = self.profile.findData(profile_id)
      if index >= 0: self.profile.setCurrentIndex(index)
    if draft.get('model'): self.model.setCurrentText(str(draft['model']))
    for field in ('size', 'quality', 'format'): getattr(self, field).setCurrentText(draft.get(field, 'auto' if field != 'format' else 'png'))
    background = self.background.findData(draft.get('background', 'auto'))
    if background >= 0: self.background.setCurrentIndex(background)
    moderation = self.moderation.findData(draft.get('moderation') or '')
    if moderation >= 0: self.moderation.setCurrentIndex(moderation)
    self.compression.setValue(-1 if draft.get('output_compression') is None else int(draft['output_compression']))
    self.count.setValue(draft.get('count', 1))
    self.attachments = [path for path in draft.get('images', []) if isinstance(path, str) and Path(path).is_file()]
    self._restore_mask(draft.get('maskImageId'), draft.get('mask'))
    self.refresh_references()

  def add_references(self):
    paths, _ = QFileDialog.getOpenFileNames(self, '选择参考图', '', '图片 (*.png *.jpg *.jpeg *.webp)')
    if len(self.attachments) + len(paths) > 16:
      QMessageBox.warning(self, '参考图', '最多支持 16 张参考图。')
      return
    self.attachments.extend(path for path in paths if path not in self.attachments)
    self.refresh_references()

  def refresh_references(self):
    self.references.clear()
    for index, path in enumerate(self.attachments):
      item = QListWidgetItem(QIcon(QPixmap(path).scaled(80, 60, Qt.AspectRatioMode.KeepAspectRatio)), f'参考图 {index + 1} · {Path(path).suffix.lstrip(chr(46)).upper()}')
      item.setToolTip(path)
      self.references.addItem(item)
    if self.mask is not None or self.mask_file: self.status.setText('已设置局部修改蒙版，作用于第一张参考图。')

  def remove_reference(self, item):
    index = self.references.row(item)
    self.attachments.pop(index)
    if index == 0: self.mask = self.mask_file = self.mask_image_id = None
    self.refresh_references()

  def clear_references(self):
    self.attachments.clear()
    self.mask = self.mask_file = None
    self.mask_image_id = None
    self.refresh_references()

  def edit_mask(self):
    if not self.attachments:
      QMessageBox.information(self, '局部修改', '请先添加一张参考图。')
      return
    try: dialog = MaskDialog(self.attachments[0], self)
    except ValueError as exc:
      QMessageBox.warning(self, '图片错误', str(exc))
      return
    if dialog.exec() == QDialog.DialogCode.Accepted:
      self.mask = dialog.view.mask.copy()
      self.mask_file = None
      self.mask_image_id = None
      try: self._persist_mask()
      except (OSError, ValueError) as exc:
        self.status.setText(f'蒙版未保存：{exc}')
        return
      self.refresh_references()

  def use_prompt(self, value):
    if self.prompt.toPlainText().strip() and self.prompt.toPlainText() != value.get('prompt', ''):
      if QMessageBox.question(self, '替换草稿', '使用此提示词替换当前描述？') != QMessageBox.StandardButton.Yes: return
    self.prompt.setPlainText(value.get('prompt') or value.get('text', ''))
    params = value.get('params') or {}
    profile_id = value.get('profileId') or value.get('apiProfileId')
    if profile_id:
      index = self.profile.findData(profile_id)
      if index >= 0: self.profile.setCurrentIndex(index)
    model = value.get('model') or value.get('apiModel')
    if model: self.model.setCurrentText(str(model))
    for field, key in [('size', 'size'), ('quality', 'quality'), ('format', 'output_format')]:
      if params.get(key): getattr(self, field).setCurrentText(str(params[key]))
    count = params.get('n', value.get('count'))
    if count is not None: self.count.setValue(int(count))
    background = self.background.findData(params.get('background', value.get('background', 'auto')))
    if background >= 0: self.background.setCurrentIndex(background)
    moderation = self.moderation.findData(params.get('moderation', value.get('moderation')) or '')
    if moderation >= 0: self.moderation.setCurrentIndex(moderation)
    compression = params.get('output_compression', value.get('output_compression'))
    self.compression.setValue(-1 if compression is None else int(compression))
    paths = value.get('images') or []
    self.attachments = [str(path) for path in paths if isinstance(path, str) and Path(path).is_file()][:16]
    self._restore_mask(value.get('maskImageId'), value.get('mask'))
    self.refresh_references()

  def generate(self):
    if self.worker and self.worker.isRunning(): return
    if self.mask is not None:
      try: self._persist_mask()
      except (OSError, ValueError) as exc:
        self.status.setText(f'蒙版未保存：{exc}')
        return
    request = self.request()
    if not request['prompt'].strip():
      self.status.setText('请输入图片描述。')
      self.prompt.setFocus()
      return
    if not request['profileId']:
      self.status.setText('请先在设置中保存 Images API 配置。')
      return
    if self.settings.get('persistInputOnRestart', True): self.store.set_meta('creationDraft', request)
    else: self.store.set_meta('creationDraft', {})
    self.temporary = tempfile.TemporaryDirectory(prefix='native-mask-')
    if self.mask_file: request['mask'] = self.mask_file
    self.cancel = threading.Event()
    self.results.clear()
    self.current_image = None
    self.generate_button.setEnabled(False)
    self.stop_button.setEnabled(True)
    self.status.setText('正在生成，图片完成后会立即保存……')
    self.worker = WorkThread(lambda worker: self.service.generate(request, self.cancel, worker.image.emit), self)
    self.worker.image.connect(self.add_result)
    self.worker.completed.connect(self.finished)
    self.worker.failed.connect(self.failed)
    self.worker.start()

  def add_result(self, image):
    path = image['path']
    item = QListWidgetItem(QIcon(QPixmap(path).scaled(140, 110, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)), f'图片 {self.results.count() + 1}')
    item.setData(Qt.ItemDataRole.UserRole, image)
    self.results.addItem(item)
    self.results.setCurrentItem(item)
    self.status.setText(f'已保存 {self.results.count()} 张图片……')
    self.changed.emit()

  def select_result(self, item, previous=None):
    if not item: return
    self.current_image = item.data(Qt.ItemDataRole.UserRole)
    try: self.view.set_image(self.current_image['path'])
    except ValueError as exc: self.status.setText(str(exc))

  def finished(self, result):
    self.generate_button.setEnabled(True)
    self.stop_button.setEnabled(False)
    messages = [f'完成，已保存 {len(result.get("images", []))} 张图片。' if result.get('ok') else result.get('error', {}).get('message', '生成失败。')]
    messages.extend(result.get('warnings', []))
    self.status.setText('\n'.join(messages))
    self.temporary.cleanup()
    if result.get('ok') and self.settings.get('clearInputAfterSubmit'):
      self.prompt.clear()
    self.taskFinished.emit(bool(result.get('ok')), messages[0])
    self.changed.emit()

  def failed(self, error):
    self.finished({'ok': False, 'error': {'message': error}})

  def save_image(self):
    if not self.current_image: return
    source = Path(self.current_image['path'])
    path, _ = QFileDialog.getSaveFileName(self, '保存图片', source.name, f'图片 (*{source.suffix})')
    if path:
      try:
        if Path(path).resolve() != source.resolve(): shutil.copy2(source, path)
        self.status.setText('图片已保存。')
      except OSError as exc: QMessageBox.warning(self, '保存失败', str(exc))

  def copy_image(self):
    if self.current_image: QGuiApplication.clipboard().setImage(QImage(self.current_image['path']))

  def use_current(self):
    if self.current_image:
      self.attachments = [self.current_image['path']]
      self.mask = self.mask_file = None
      self.mask_image_id = None
      self.refresh_references()

  def eventFilter(self, watched, event):
    if watched is self.prompt and event.type() == QEvent.Type.KeyPress and event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
      modifiers = event.modifiers()
      send = modifiers == Qt.KeyboardModifier.NoModifier if self.settings.get('enterSubmit') else bool(modifiers & Qt.KeyboardModifier.ControlModifier)
      if send:
        self.generate()
        return True
    return super().eventFilter(watched, event)

  def shutdown(self):
    self.cancel.set()
    return not self.worker or not self.worker.isRunning()


class HistoryPage(QWidget):
  reuse = Signal(dict)

  def __init__(self, store, parent=None):
    super().__init__(parent)
    self.store = store
    self.records = []
    layout = QVBoxLayout(self)
    title = QLabel('作品与收藏')
    title.setObjectName('pageTitle')
    layout.addWidget(title)
    bar = QHBoxLayout()
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索图片描述')
    self.search.textChanged.connect(self.refresh)
    bar.addWidget(self.search, 1)
    self.filter = QComboBox()
    self.filter.currentIndexChanged.connect(self.refresh)
    bar.addWidget(self.filter)
    for text, callback in [('新建收藏夹', self.new_collection), ('删除收藏夹', self.delete_collection), ('刷新', self.refresh)]:
      button = QPushButton(text)
      button.clicked.connect(callback)
      bar.addWidget(button)
    layout.addLayout(bar)
    splitter = QSplitter()
    self.list = QListWidget()
    self.list.setIconSize(QSize(140, 100))
    self.list.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
    self.list.currentItemChanged.connect(self.select)
    splitter.addWidget(self.list)
    panel = QWidget()
    content = QVBoxLayout(panel)
    self.view = ImageView()
    content.addWidget(self.view, 1)
    self.outputs = QComboBox()
    self.outputs.currentIndexChanged.connect(self.show_output)
    content.addWidget(self.outputs)
    self.details = QLabel('选择作品查看图片与参数。')
    self.details.setWordWrap(True)
    self.details.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
    content.addWidget(self.details)
    bar = QGridLayout()
    for index, (text, callback) in enumerate([('复用描述与参考', self.reuse_task), ('收藏 / 取消', self.favorite), ('加入收藏夹', self.assign_collection), ('保存图片', self.save_image), ('删除作品', self.delete_task), ('保存选中作品', self.download_selected), ('保存本作品全部图片', self.download_task_images)]):
      button = QPushButton(text)
      button.clicked.connect(callback)
      bar.addWidget(button, index // 3, index % 3)
    content.addLayout(bar)
    splitter.addWidget(panel)
    splitter.setSizes([360, 760])
    layout.addWidget(splitter, 1)
    self.reload_collections()
    self.refresh()

  def reload_collections(self):
    selected = self.filter.currentData()
    self.filter.blockSignals(True)
    self.filter.clear()
    self.filter.addItem('全部作品', '')
    self.filter.addItem('全部收藏', '*')
    for collection in self.store.list_records('collections'): self.filter.addItem(collection.get('name', '收藏夹'), collection['id'])
    index = self.filter.findData(selected)
    self.filter.setCurrentIndex(max(0, index))
    self.filter.blockSignals(False)

  def refresh(self, *args):
    selected = self.current()
    selected_id = selected.get('id') if selected else None
    self.records = self.store.list_records('tasks')
    self.list.clear()
    term = self.search.text().strip().casefold()
    category = self.filter.currentData()
    for task in self.records:
      if term and term not in task.get('prompt', '').casefold(): continue
      if category == '*' and not task.get('isFavorite'): continue
      if category and category != '*' and category not in task.get('favoriteCollectionIds', []): continue
      output = task.get('outputImages', [])
      path = self.store.image_path(output[0]) if output else None
      icon = QIcon(QPixmap(str(path)).scaled(160, 100, Qt.AspectRatioMode.KeepAspectRatio)) if path and path.exists() else QIcon()
      state = {'success': '完成', 'done': '完成', 'error': '失败', 'running': '进行中', 'cancelled': '已停止'}.get(task.get('status'), task.get('status', ''))
      item = QListWidgetItem(icon, ('★ ' if task.get('isFavorite') else '') + task.get('prompt', '无描述')[:75] + '\n' + state + f' · {len(output)} 张')
      item.setData(Qt.ItemDataRole.UserRole, task)
      self.list.addItem(item)
      if task['id'] == selected_id: self.list.setCurrentItem(item)

  def current(self):
    item = self.list.currentItem()
    return item.data(Qt.ItemDataRole.UserRole) if item else None

  def select(self, item, previous=None):
    task = self.current()
    self.outputs.clear()
    if not task: return
    for index, image_id in enumerate(task.get('outputImages', [])): self.outputs.addItem(f'图片 {index + 1}', image_id)
    params = task.get('params') or {}
    labels = [('apiProfileName', '配置', task.get('apiProfileName')), ('apiModel', '模型', task.get('apiModel'))]
    values = [('size', '尺寸'), ('quality', '质量'), ('output_format', '格式'), ('n', '张数'), ('background', '背景'), ('moderation', '内容审核'), ('output_compression', '压缩质量')]
    lines = [f'{label}：{value}' for key, label, value in labels if value]
    for key, label in values:
      value = params.get(key)
      if value is None: continue
      if key == 'background': value = {'auto': '自动', 'transparent': '透明', 'opaque': '不透明'}.get(value, value)
      if key == 'moderation': value = {'auto': '自动', 'low': '宽松'}.get(value, value or '默认')
      lines.append(f'{label}：{value}')
    if task.get('error'): lines.append(f'错误：{task["error"]}')
    self.details.setText(task.get('prompt', '') + ('\n' + '\n'.join(lines) if lines else ''))

  def show_output(self):
    image_id = self.outputs.currentData()
    if image_id:
      path = self.store.image_path(image_id)
      if path and path.exists():
        try: self.view.set_image(path)
        except ValueError as exc: self.details.setText(str(exc))

  def reuse_task(self):
    task = self.current()
    if task:
      paths = [self.store.image_path(image_id) for image_id in task.get('inputImageIds', [])]
      params = task.get('params') or {}
      self.reuse.emit({'prompt': task.get('prompt', ''), 'profileId': task.get('apiProfileId'), 'model': task.get('apiModel'), 'count': params.get('n', 1), 'background': params.get('background'), 'moderation': params.get('moderation'), 'output_compression': params.get('output_compression'), 'params': params, 'maskImageId': task.get('maskImageId'), 'images': [str(path) for path in paths if path and path.exists()]})

  def download_task_images(self):
    task = self.current()
    if task: save_images(self, self.store, task.get('outputImages', []), 'task-detail-all')

  def favorite(self):
    task = self.current()
    if task:
      task['isFavorite'] = not task.get('isFavorite')
      self.store.put_record('tasks', task)
      self.refresh()

  def assign_collection(self):
    task = self.current()
    if not task: return
    collections = self.store.list_records('collections')
    if not collections:
      self.new_collection()
      collections = self.store.list_records('collections')
    if not collections: return
    names = [row.get('name', '') for row in collections]
    name, ok = QInputDialog.getItem(self, '加入收藏夹', '选择收藏夹', names, editable=False)
    if ok:
      collection_id = collections[names.index(name)]['id']
      ids = task.get('favoriteCollectionIds', [])
      task['favoriteCollectionIds'] = [value for value in ids if value != collection_id] if collection_id in ids else ids + [collection_id]
      task['isFavorite'] = bool(task['favoriteCollectionIds'])
      self.store.put_record('tasks', task)
      self.refresh()

  def new_collection(self):
    import uuid
    name, ok = QInputDialog.getText(self, '新建收藏夹', '名称')
    if ok and name.strip():
      now = int(time.time() * 1000)
      self.store.put_record('collections', {'id': uuid.uuid4().hex, 'name': name.strip(), 'createdAt': now, 'updatedAt': now})
      self.reload_collections()

  def delete_collection(self):
    key = self.filter.currentData()
    if key in (None, '', '*'): return
    if QMessageBox.question(self, '删除收藏夹', '删除此收藏夹？作品会保留。') != QMessageBox.StandardButton.Yes: return
    for task in self.store.list_records('tasks'):
      if key in task.get('favoriteCollectionIds', []):
        task['favoriteCollectionIds'].remove(key)
        self.store.put_record('tasks', task)
    self.store.delete_record('collections', key)
    self.reload_collections()
    self.refresh()

  def save_image(self):
    image_id = self.outputs.currentData()
    source = self.store.image_path(image_id) if image_id else None
    if not source: return
    path, _ = QFileDialog.getSaveFileName(self, '保存图片', source.name, '图片 (*.png *.jpeg *.webp)')
    if path:
      try:
        if Path(path).resolve() != source.resolve(): shutil.copy2(source, path)
      except OSError as exc: QMessageBox.warning(self, '保存失败', str(exc))

  def delete_task(self):
    task = self.current()
    if not task: return
    if task.get('status') == 'running':
      QMessageBox.information(self, '任务进行中', '请先停止任务，再删除作品。')
      return
    if QMessageBox.question(self, '删除作品', '删除这条作品记录？对话引用的图片文件会保留。') != QMessageBox.StandardButton.Yes: return
    self.store.delete_record('tasks', task['id'])
    self.refresh()


  def download_selected(self):
    ids = [image_id for item in self.list.selectedItems() for image_id in item.data(Qt.ItemDataRole.UserRole).get('outputImages', [])]
    save_images(self, self.store, ids, 'favorite-collection-selection' if self.filter.currentData() else 'task-selection')
