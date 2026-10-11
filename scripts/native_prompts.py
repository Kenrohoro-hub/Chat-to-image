"""PySide6 原生提示词库页面。"""
import json
import os
import hashlib
import time
import base64
from pathlib import Path
import shutil
import tempfile
import uuid

from PySide6.QtCore import QEvent, QObject, QRunnable, QThreadPool, QTimer, Signal, Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (QButtonGroup, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout,
  QGridLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget, QMessageBox, QPlainTextEdit, QProgressBar,
  QPushButton, QScrollArea, QSplitter, QVBoxLayout, QWidget)

import native_prompt_sources as sources
from native_prompt_sources import SOURCES, fetch_source, normalize_source
from native_widgets import ImageCard


def catalog_path(root, source):
  return Path(root) / 'prompt-cache' / f'{source}.json'


def _dispatch(action, payload=None):
  from prompt_storage import dispatch
  return dispatch(action, payload or {})


def _storage_directory():
  return _dispatch('status').get('directory', '')


def _native_items(items):
  result = []
  for item in items:
    value = dict(item)
    value['prompt'] = value.get('prompt') or value.get('content') or value.get('text', '')
    if value.get('previewUrl') and not value.get('images'): value['images'] = [value['previewUrl']]
    result.append(value)
  return result


def _stored_items(items):
  result = []
  for item in items:
    value = dict(item)
    value['content'] = value.get('prompt', value.get('content', ''))
    if value.get('images') and not value.get('previewUrl'): value['previewUrl'] = value['images'][0]
    result.append(value)
  return result


def read_catalog(root, source, directory=None):
  directory = _storage_directory() if directory is None else directory
  if directory:
    result = _dispatch('catalog_read', {'source': source, 'directory': directory})
    catalog = result.get('catalog')
    return {'items': _native_items(catalog.get('items', [])), 'updatedAt': catalog.get('updatedAt', 0), 'revision': catalog.get('revision', ''), 'cleared': catalog.get('cleared', False), 'images': result.get('images', [])} if catalog else None
  path = catalog_path(root, source)
  if not path.is_file():
    return None
  value = json.loads(path.read_text(encoding='utf-8'))
  if not isinstance(value, dict) or not isinstance(value.get('items'), list) or not isinstance(value.get('updatedAt'), (int, float)):
    raise ValueError(f'{source} 本地目录格式错误，原文件已保留。')
  return value


def write_catalog(root, source, items, updated_at=None, directory=None, revision=''):
  directory = _storage_directory() if directory is None else directory
  updated_at = updated_at or time.time_ns() // 1_000_000
  if directory:
    payload = {'source': source, 'items': _stored_items(items), 'updatedAt': updated_at, 'directory': directory}
    if source == 'personal': payload['revision'] = revision
    result = _dispatch('catalog_write', payload)
    catalog = result['catalog']
    return {'items': _native_items(catalog['items']), 'updatedAt': catalog['updatedAt'], 'revision': catalog.get('revision', ''), 'cleared': catalog.get('cleared', False), 'images': result.get('images', [])}
  path = catalog_path(root, source)
  path.parent.mkdir(parents=True, exist_ok=True)
  value = {'items': items, 'updatedAt': updated_at}
  fd, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
  try:
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
      json.dump(value, handle, ensure_ascii=False, separators=(',', ':'))
      handle.flush()
      os.fsync(handle.fileno())
    os.replace(temporary, path)
  finally:
    Path(temporary).unlink(missing_ok=True)
  return value


def refresh_catalog(root, source, progress=lambda _message: None, fetch=None, directory=None):
  raw = (fetch or fetch_source)(source, progress)
  progress('正在整理目录…')
  items = list({item['id']: item for item in normalize_source(source, raw)}.values())
  if not items:
    raise ValueError('未读取到提示词，原缓存已保留。')
  return write_catalog(root, source, items, directory=directory)


class _Signals(QObject):
  done = Signal(object, object)


class _Task(QRunnable):
  def __init__(self, work):
    super().__init__()
    self.work = work
    self.signals = _Signals()

  def run(self):
    try:
      self.signals.done.emit(self.work(), None)
    except Exception as error:
      self.signals.done.emit(None, error)


class _PromptEditor(QDialog):
  def __init__(self, record=None, parent=None):
    super().__init__(parent)
    self.setWindowTitle('编辑个人提示词' if record else '新增个人提示词')
    self.resize(560, 460)
    self.title = QLineEdit(record.get('title', '') if record else '')
    self.category = QLineEdit(record.get('category', '未分类') if record else '未分类')
    self.prompt = QPlainTextEdit(record.get('prompt', '') if record else '')
    form = QFormLayout()
    form.addRow('标题', self.title)
    form.addRow('分类', self.category)
    form.addRow('提示词', self.prompt)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
    buttons.accepted.connect(self.accept)
    buttons.rejected.connect(self.reject)
    layout = QVBoxLayout(self)
    layout.addLayout(form)
    layout.addWidget(buttons)

  def value(self, record=None):
    title, prompt = self.title.text().strip(), self.prompt.toPlainText().strip()
    if not title or not prompt:
      QMessageBox.warning(self, '内容不完整', '标题和提示词都不能为空。')
      return None
    value = dict(record or {})
    value.update({'id': value.get('id') or uuid.uuid4().hex, 'title': title, 'prompt': prompt,
      'category': self.category.text().strip() or '未分类', 'source': 'personal', 'updatedAt': time.time_ns() // 1_000_000})
    return value


class _ImageZoom(QDialog):
  def __init__(self, pixmap, parent=None):
    super().__init__(parent)
    self.setWindowTitle('提示词预览图')
    self.resize(900, 700)
    label = QLabel()
    label.setAlignment(Qt.AlignmentFlag.AlignCenter)
    label.setPixmap(pixmap.scaled(self.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
    QVBoxLayout(self).addWidget(label)


class _PromptDetail(QDialog):
  def __init__(self, item, parent=None):
    super().__init__(parent)
    self.item = item
    self.setWindowTitle(item.get('title', '提示词详情'))
    self.resize(680, 560)
    layout = QVBoxLayout(self)
    title = QLabel(item.get('title', '无标题'))
    title.setObjectName('pageTitle')
    layout.addWidget(title)
    layout.addWidget(QLabel('分类：' + (item.get('category') or '未分类')))
    self.preview = QLabel('暂无预览图')
    self.preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
    self.preview.setMinimumHeight(180)
    layout.addWidget(self.preview)
    self.prompt = QPlainTextEdit(item.get('prompt', item.get('content', '')))
    self.prompt.setReadOnly(True)
    layout.addWidget(self.prompt, 1)
    buttons = QHBoxLayout()
    self.use_button = QPushButton('使用此提示词')
    self.use_button.setObjectName('primary')
    self.favorite_button = QPushButton('取消收藏' if item.get('favorite') else '收藏')
    self.edit_button = QPushButton('编辑')
    self.delete_button = QPushButton('删除')
    for button in (self.use_button, self.favorite_button, self.edit_button, self.delete_button): buttons.addWidget(button)
    layout.addLayout(buttons)


class PromptPage(QWidget):
  usePrompt = Signal(dict)

  def __init__(self, store, parent=None):
    super().__init__(parent)
    self.store = store
    self.pool = QThreadPool.globalInstance()
    self._active_tasks = set()
    self._closing_event = __import__('threading').Event()
    self._preload_event = None
    self._refresh_event = None
    self.pool.setMaxThreadCount(max(2, min(4, self.pool.maxThreadCount())))
    self.items = []
    self.current = None
    self._columns = 0
    self._source_columns = 0
    self.removed = set()
    self.favorites = {}
    self.undo_record = None
    self.undo_images = {}
    self._build_ui()
    self._load_personal()
    def load_preferences():
      directory = _storage_directory()
      removed = _dispatch('preferences', {'directory': directory}).get('removed', []) if directory else self._meta('removed_sources', [])
      return {'removed': removed, 'favorites': self._meta('prompt_favorites', {})}
    self._run(load_preferences, self._preferences_loaded)

  def _root(self):
    return Path(self.store.root)

  def _data_root(self):
    return self._root()

  def _meta(self, key, default=None):
    return self.store.get_meta(key, default)

  def _set_meta(self, key, value):
    self.store.set_meta(key, value)

  def _preferences_loaded(self, value, error):
    if error: self.status.setText(str(error)); return
    self.removed = set(value.get('removed') or [])
    self.favorites = value.get('favorites') or {}
    selected = self.source.currentData()
    self._rebuild_sources(selected)
    if self.source.currentData() == 'personal' and hasattr(self, '_personal_records'): self._set_items(self._personal_records)

  def _rebuild_sources(self, selected=None):
    self.source.blockSignals(True); self.source.clear(); self.source.addItem('个人提示词', 'personal')
    for row in SOURCES:
      if row['id'] not in self.removed: self.source.addItem(row['name'], row['id'])
    index = self.source.findData(selected or 'personal')
    self.source.setCurrentIndex(max(0, index)); self.source.blockSignals(False)
    while self.source_layout.count():
      item = self.source_layout.takeAt(0)
      if item.widget(): item.widget().hide(); item.widget().deleteLater()
    self.source_buttons = {}
    self._source_buttons = QButtonGroup(self)
    self._source_buttons.setExclusive(True)
    for idx in range(self.source.count()):
      button = QPushButton(self.source.itemText(idx))
      button.setCheckable(True)
      self._source_buttons.addButton(button, idx)
      source_id = self.source.itemData(idx)
      self.source_buttons[source_id] = button
      button.clicked.connect(lambda _checked=False, source_index=idx: self.source.setCurrentIndex(source_index))
      button.setChecked(idx == self.source.currentIndex())
    self._layout_source_buttons()

  def _build_ui(self):
    self.source = QComboBox()
    self.source.addItem('个人提示词', 'personal')
    for row in SOURCES:
      if row['id'] not in self.removed: self.source.addItem(row['name'], row['id'])
    self.category = QComboBox()
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索标题、提示词或分类')
    self.refresh_button = QPushButton('刷新目录')
    self.preload = QPushButton('预载当前分类')
    self.cancel = QPushButton('取消')
    self.cancel.setEnabled(False)
    self.clear = QPushButton('清理本地缓存')
    self.manage_source = QPushButton('移除/恢复来源')
    self.undo = QPushButton('撤销删除')
    self.undo.setEnabled(False)
    self.add = QPushButton('新增')
    self.edit = QPushButton('编辑')
    self.delete = QPushButton('删除')
    self.favorite = QPushButton('收藏')
    self.use = QPushButton('使用此提示词')
    self.choose_dir = QPushButton('选择保存目录')
    self.save_draft_button = QPushButton('保存当前草稿')
    self.source.setVisible(False)
    self.category.setVisible(False)
    self._source_buttons = QButtonGroup(self)
    self._source_buttons.setExclusive(True)
    self.source_bar = QWidget()
    source_layout = QGridLayout(self.source_bar)
    self.source_layout = source_layout
    source_layout.setContentsMargins(0, 0, 0, 0)
    source_layout.setSpacing(6)
    self.source_buttons = {}
    for index in range(self.source.count()):
      button = QPushButton(self.source.itemText(index))
      button.setCheckable(True)
      self._source_buttons.addButton(button, index)
      self.source_buttons[self.source.itemData(index)] = button
      button.clicked.connect(lambda _checked=False, idx=index: self.source.setCurrentIndex(idx))
    self.source_buttons['personal'].setChecked(True)
    self._layout_source_buttons()
    search_row = QHBoxLayout()
    search_row.addWidget(self.search, 1)
    tools = QHBoxLayout()
    for widget in (self.refresh_button, self.preload, self.cancel, self.clear, self.manage_source, self.choose_dir): tools.addWidget(widget)
    tools.addStretch(1)
    personal_tools = QHBoxLayout()
    for widget in (self.add, self.undo, self.save_draft_button): personal_tools.addWidget(widget)
    personal_tools.addStretch(1)
    self.rows = QListWidget()
    self.rows.setVisible(False)
    self.detail = QPlainTextEdit()
    self.detail.setReadOnly(True)
    self.preview = QLabel('选择一条提示词查看详情')
    self.preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
    self.preview.setMinimumHeight(160)
    self.preview.setStyleSheet('background:#f3f4f6; color:#6b7280')
    buttons = QHBoxLayout()
    for widget in (self.add, self.edit, self.delete, self.undo, self.favorite, self.use): buttons.addWidget(widget)
    self.progress = QProgressBar()
    self.progress.setVisible(False)
    self.status = QLabel('')
    self.category_panel = QWidget()
    self.category_layout = QVBoxLayout(self.category_panel)
    self.category_layout.setContentsMargins(0, 0, 0, 0)
    self.category_layout.setSpacing(5)
    self.category_buttons = {}
    self._category_group = QButtonGroup(self)
    self._category_group.setExclusive(True)
    self.grid_host = QWidget()
    self.card_grid = QGridLayout(self.grid_host)
    self.card_grid.setContentsMargins(0, 0, 0, 0)
    self.card_grid.setHorizontalSpacing(12)
    self.card_grid.setVerticalSpacing(12)
    self.card_scroll = QScrollArea()
    self.card_scroll.setWidgetResizable(True)
    self.card_scroll.setWidget(self.grid_host)
    self.card_scroll.viewport().installEventFilter(self)
    self.source_bar.installEventFilter(self)
    self.card_widgets = []
    self.card_open_buttons = []
    self._card_by_id = {}
    self._preview_loading = set()
    self.page = 0
    self.page_size = 24
    self.prev_page = QPushButton('上一页')
    self.next_page = QPushButton('下一页')
    self.page_label = QLabel('第 1 / 1 页')
    self.pagination = QHBoxLayout()
    self.pagination.addStretch(1)
    self.pagination.addWidget(self.prev_page)
    self.pagination.addWidget(self.page_label)
    self.pagination.addWidget(self.next_page)
    self.pagination.addStretch(1)
    left = QWidget(); left_layout = QVBoxLayout(left); left_layout.addWidget(self.category_panel); left_layout.addStretch(1)
    right = QWidget(); right_layout = QVBoxLayout(right); right_layout.addWidget(self.card_scroll, 1); right_layout.addLayout(self.pagination)
    split = QSplitter(); split.addWidget(left); split.addWidget(right); split.setStretchFactor(0, 1); split.setStretchFactor(1, 4); split.setSizes([190, 790])
    layout = QVBoxLayout(self); layout.addWidget(self.source_bar); layout.addLayout(search_row); layout.addLayout(tools); layout.addLayout(personal_tools); layout.addWidget(self.progress); layout.addWidget(split, 1); layout.addWidget(self.status)
    self.source.currentIndexChanged.connect(self._source_changed)
    self.category.currentTextChanged.connect(self._filter_changed)
    self.search.textChanged.connect(self._filter_changed)
    self.rows.currentRowChanged.connect(self._show_detail)
    self.refresh_button.clicked.connect(self._refresh)
    self.preload.clicked.connect(self._preload)
    self.cancel.clicked.connect(self._cancel)
    self.clear.clicked.connect(self._clear_cache)
    self.add.clicked.connect(self._add)
    self.edit.clicked.connect(self._edit)
    self.delete.clicked.connect(self._delete)
    self.undo.clicked.connect(self._undo)
    self.favorite.clicked.connect(self._favorite)
    self.use.clicked.connect(self._use)
    self.choose_dir.clicked.connect(self._choose_directory)
    self.manage_source.clicked.connect(self._manage_source)
    self.prev_page.clicked.connect(lambda: self._change_page(-1))
    self.next_page.clicked.connect(lambda: self._change_page(1))
    self.save_draft_button.clicked.connect(self._save_draft)
    self.preview.mouseDoubleClickEvent = lambda _event: self._zoom()

  def _run(self, work, callback):
    task = _Task(work)
    self._active_tasks.add(task)
    def finish(value, error):
      self._active_tasks.discard(task)
      if not self._closing_event.is_set(): callback(value, error)
    task.signals.done.connect(finish)
    self.pool.start(task)

  def shutdown(self):
    self._closing_event.set()
    if self._preload_event: self._preload_event.set()
    if self._refresh_event: self._refresh_event.set()
    return not self._active_tasks

  def refresh(self):
    if self.source.currentData() == 'personal': self._load_personal()
    else: self._load_cached(self.source.currentData())

  def _load_personal(self):
    def work():
      directory = _storage_directory()
      if directory:
        value = read_catalog(self._root(), 'personal', directory)
        return {'items': value['items'] if value else [], 'revision': value.get('revision', '') if value else '', 'directory': directory}
      return {'items': list(self.store.list_records('prompts')), 'revision': '', 'directory': ''}
    self._run(work, self._personal_loaded)
  def export_personal(self):
    directory = _storage_directory()
    if directory:
      value = read_catalog(self._root(), 'personal', directory)
      return _stored_items(value['items']) if value else []
    return _stored_items(_native_items(self.store.list_records('prompts')))

  def import_personal(self, records):
    directory = _storage_directory()
    if not directory:
      self.refresh()
      return
    imported = _native_items(records if isinstance(records, list) else [])
    def merge():
      value = read_catalog(self._root(), 'personal', directory)
      items = list(value['items']) if value else []
      known = {item.get('id') for item in items}
      additions = []
      conflicts = 0
      skipped = 0
      for item in imported:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id']:
          skipped += 1
        elif item['id'] in known:
          conflicts += 1
        else:
          known.add(item['id'])
          additions.append(dict(item, source='personal'))
      if additions:
        write_catalog(self._root(), 'personal', items + additions, directory=directory,
          revision=value.get('revision', '') if value else '')
      return {'added': len(additions), 'conflicts': conflicts, 'skipped': skipped}
    self._run(merge, self._personal_imported)

  def _personal_imported(self, result, error):
    if error:
      QMessageBox.warning(self, '导入提示词失败', str(error))
      return
    self.status.setText(f'已导入 {result["added"]} 条个人提示词；因同 ID 冲突保留现有内容并跳过 {result["conflicts"]} 条。')
    if result['skipped']:
      self.status.setText(self.status.text() + f'另有 {result["skipped"]} 条格式无效。')
    self._load_personal()
  def _personal_loaded(self, items, error):
    if error:
      self.status.setText(str(error)); return
    self._personal_records = [dict(item, source='personal') for item in _native_items(items['items'] or [])]
    self._personal_revision = items['revision']
    self._personal_directory = items['directory']
    if self.source.currentData() == 'personal' and hasattr(self, '_personal_records'): self._set_items(self._personal_records)

  def _source_changed(self):
    source = self.source.currentData()
    for index in range(self.source.count()):
      button = self.source_buttons.get(self.source.itemData(index))
      if button: button.setChecked(index == self.source.currentIndex())
    self.page = 0
    personal = source == 'personal'
    self.add.setVisible(personal); self.edit.setVisible(personal); self.delete.setVisible(personal); self.undo.setVisible(personal)
    self.favorite.setVisible(True); self.refresh_button.setEnabled(not personal); self.clear.setEnabled(not personal)
    self.preload.setEnabled(not personal)
    if personal:
      self._load_personal()
      return
    self._load_cached(source)

  def _load_cached(self, source):
    def work():
      value = read_catalog(self._root(), source)
      return value['items'] if value else []
    self.status.setText('正在读取本地目录…')
    self._run(work, lambda items, error: self._cached_loaded(source, items, error))

  def _cached_loaded(self, source, items, error):
    if source != self.source.currentData(): return
    if error:
      self.status.setText(str(error)); return
    self._set_items(items or [])
    self.status.setText(f'已载入 {len(self.items)} 条缓存提示词' if self.items else '本地没有目录缓存，请刷新。')

  def _set_items(self, items):
    self.items = [dict(item, favorite=self.favorites.get(item.get('id'), item.get('favorite', False))) for item in (items or [])]
    categories = ['全部分类'] + sorted({cat for item in self.items for cat in (item.get('categories') or ([item.get('category')] if item.get('category') else [])) if cat})
    self.category.blockSignals(True); self.category.clear(); self.category.addItems(categories); self.category.blockSignals(False)
    self.page = 0
    self._render()

  def _render(self):
    selected = self.current.get('id') if self.current else None
    cat, query = self.category.currentText(), self.search.text().strip().casefold()
    rows = self._filtered_items(cat, query)
    self._render_categories()
    total_pages = max(1, (len(rows) + self.page_size - 1) // self.page_size)
    self.page = min(self.page, total_pages - 1)
    self.page_label.setText(f'第 {self.page + 1} / {total_pages} 页')
    self.prev_page.setEnabled(self.page > 0)
    self.next_page.setEnabled(self.page + 1 < total_pages)
    self.rows.clear()
    self.current = next((item for item in rows if item.get('id') == selected), rows[self.page * self.page_size] if rows else None)
    visible = rows[self.page * self.page_size:(self.page + 1) * self.page_size]
    old_rows, old_columns = set(), set()
    while self.card_grid.count():
      index = self.card_grid.count() - 1
      row, column, _row_span, _column_span = self.card_grid.getItemPosition(index)
      old_rows.add(row)
      old_columns.add(column)
      item = self.card_grid.takeAt(index)
      if item.widget(): item.widget().hide(); item.widget().deleteLater()
    for row in old_rows:
      self.card_grid.setRowStretch(row, 0)
      self.card_grid.setRowMinimumHeight(row, 0)
    for column in old_columns:
      self.card_grid.setColumnStretch(column, 0)
      self.card_grid.setColumnMinimumWidth(column, 0)
    self.card_widgets = []
    self.card_open_buttons = []
    self._card_by_id = {}
    columns = max(1, min(4, self.card_scroll.viewport().width() // 270))
    self._columns = columns
    for index, record in enumerate(visible):
      card_box = QWidget()
      card_box.setObjectName('card')
      card_layout = QVBoxLayout(card_box)
      card_layout.setContentsMargins(8, 8, 8, 8)
      image_path = self._preview_path(record)
      card = ImageCard(image_path, record.get('title', '无标题'), record.get('category', '未分类'))
      card._image_url = (record.get('images') or ([record.get('previewUrl')] if record.get('previewUrl') else ['']))[0]
      card.clicked.connect(lambda _checked=False, value=record: self._open_detail(value))
      card_layout.addWidget(card, 1)
      actions = QHBoxLayout()
      use_button = QPushButton('使用')
      favorite_button = QPushButton('★' if record.get('favorite') else '☆')
      actions.addWidget(use_button)
      actions.addWidget(favorite_button)
      if self.source.currentData() == 'personal':
        edit_button = QPushButton('编辑')
        actions.addWidget(edit_button)
        edit_button.clicked.connect(lambda _checked=False, value=record: self._run_record_action(value, lambda: self._edit_record(value)))
      card_layout.addLayout(actions)
      self.card_open_buttons.append(card)
      use_button.clicked.connect(lambda _checked=False, value=record: self.usePrompt.emit(dict(value)))
      favorite_button.clicked.connect(lambda _checked=False, value=record: self._run_record_action(value, self._favorite))
      self.card_grid.addWidget(card_box, index // columns, index % columns)
      self.card_widgets.append(card)
      self._card_by_id[record.get('id')] = card
    self._load_card_previews(visible)
    self.category_panel.setVisible(bool(self.category_buttons) and len(self.category_buttons) > 1)
    self.save_draft_button.setVisible(self.source.currentData() == 'personal')
    if not rows: self.current = None

  def _filtered_items(self, category=None, query=None):
    cat = self.category.currentText() if category is None else category
    query = self.search.text().strip().casefold() if query is None else query
    return [item for item in self.items if (cat in ('', '全部分类') or cat in (item.get('categories') or ([item.get('category')] if item.get('category') else []))) and
      (not query or query in (item.get('title', '') + ' ' + item.get('prompt', item.get('content', '')) + ' ' + item.get('category', '')).casefold())]

  def _render_categories(self):
    while self.category_layout.count():
      item = self.category_layout.takeAt(0)
      if item.widget(): item.widget().hide(); item.widget().deleteLater()
    self.category_buttons = {}
    self._category_group = QButtonGroup(self)
    self._category_group.setExclusive(True)
    filtered = self._filtered_items(category='全部分类')
    counts = {}
    for item in filtered:
      for category in item.get('categories') or ([item.get('category')] if item.get('category') else []):
        if category: counts[category] = counts.get(category, 0) + 1
    categories = [('全部分类', len(filtered))] + sorted(counts.items())
    selected = self.category.currentText() or '全部分类'
    for index, (name, count) in enumerate(categories):
      button = QPushButton(f'{name}  ·  {count}')
      button.setCheckable(True)
      button.setChecked(name == selected)
      self._category_group.addButton(button, index)
      self.category_buttons[name] = button
      self.category_layout.addWidget(button)
      button.clicked.connect(lambda _checked=False, value=name: self._select_category(value))
    self.category_layout.addStretch(1)

  def _select_category(self, name):
    index = self.category.findText(name)
    if index >= 0:
      self.page = 0
      self.category.setCurrentIndex(index)

  def _change_page(self, delta):
    self.page += delta
    self._render()

  def _filter_changed(self, *_):
    self.page = 0
    self._render()

  def _preview_path(self, item):
    images = item.get('images') or ([item.get('previewUrl')] if item.get('previewUrl') else [])
    if not images: return ''
    image = images[0]
    if image.startswith(('http://', 'https://')):
      path = self._data_root() / 'prompt-cache' / 'images' / item.get('source', self.source.currentData()) / (hashlib.sha256(image.encode()).hexdigest() + '.img')
      return str(path) if path.is_file() else ''
    return image if Path(image).is_file() else ''

  def _open_detail(self, item):
    self.current = item
    dialog = _PromptDetail(item, self)
    path = self._preview_path(item)
    if path:
      pixmap = QPixmap(path)
      if not pixmap.isNull(): dialog.preview.setPixmap(pixmap.scaled(600, 220, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
    else:
      images = item.get('images') or ([item.get('previewUrl')] if item.get('previewUrl') else [])
      image = images[0] if images else ''
      if image.startswith(('http://', 'https://')):
        dialog.preview.setText('正在读取预览图…')
        def load_image():
          directory = _storage_directory()
          if directory:
            saved = _dispatch('image_read', {'directory': directory, 'url': image}).get('dataUrl')
            if saved: return base64.b64decode(saved.split(',', 1)[1])
          return sources.download_bytes(image)
        self._run(load_image, lambda data, error: self._dialog_image_loaded(dialog, data, error))
    dialog.use_button.clicked.connect(lambda: self.usePrompt.emit(dict(item)))
    dialog.favorite_button.clicked.connect(lambda: self._run_record_action(item, self._favorite))
    if item.get('source') == 'personal':
      dialog.edit_button.clicked.connect(lambda: self._run_record_action(item, lambda: self._edit_record(item)))
      dialog.delete_button.clicked.connect(lambda: self._run_record_action(item, lambda _record: self._delete()))
    else:
      dialog.edit_button.setVisible(False)
      dialog.delete_button.setVisible(False)
    _PromptDetail.exec(dialog)

  def _dialog_image_loaded(self, dialog, raw, error):
    pixmap = QPixmap()
    if raw and not error: pixmap.loadFromData(raw)
    if pixmap.isNull():
      dialog.preview.setText('预览图读取失败')
      return
    dialog.preview.setPixmap(pixmap.scaled(600, 220, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))

  def _run_record_action(self, item, action):
    self.current = item
    action()

  def _save_draft(self):
    draft = self._meta('creationDraft', {}) or {}
    self.save_draft(draft)

  def save_draft(self, value):
    if not isinstance(value, dict):
      self.status.setText('草稿格式无效。')
      return
    prompt = value.get('prompt') or value.get('content') or ''
    if not prompt.strip():
      self.status.setText('当前没有可保存的草稿。')
      return
    record = dict(value)
    record.update({'title': record.get('title') or '当前草稿', 'category': record.get('category') or '未分类',
      'prompt': prompt, 'source': 'personal'})
    self._edit_record(record)

  def _load_card_previews(self, records):
    pending = []
    source = self.source.currentData()
    for item in records:
      images = item.get('images') or ([item.get('previewUrl')] if item.get('previewUrl') else [])
      url = images[0] if images else ''
      if url.startswith(('http://', 'https://')) and url not in self._preview_loading and not self._preview_path(item):
        self._preview_loading.add(url)
        pending.append((item, url))
    if not pending:
      return
    pending_urls = {url for _item, url in pending}

    def load():
      directory = _storage_directory()
      root = self._data_root() / 'prompt-cache' / 'images' / source
      result = []
      for item, url in pending:
        try:
          raw = None
          if directory:
            saved = _dispatch('image_read', {'directory': directory, 'url': url}).get('dataUrl')
            if saved: raw = base64.b64decode(saved.split(',', 1)[1])
          path = root / (hashlib.sha256(url.encode()).hexdigest() + '.img')
          if raw is None and path.is_file(): raw = path.read_bytes()
          if raw is None:
            raw = sources.download_bytes(url)
            mime = 'image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg' if raw.startswith(b'\xff\xd8') else 'image/gif' if raw.startswith((b'GIF87a', b'GIF89a')) else 'image/webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else 'image/avif' if b'avif' in raw[4:16] else ''
            if not mime: continue
            if directory:
              _dispatch('image_write', {'source': item.get('source', source), 'directory': directory, 'url': url,
                'category': item.get('category', '未分类'), 'dataUrl': f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')})
            else:
              root.mkdir(parents=True, exist_ok=True)
              path.write_bytes(raw)
          result.append((item.get('id'), url, raw))
        except (OSError, ValueError):
          continue
      return result

    self._run(load, lambda results, error: self._card_previews_loaded(pending_urls, results, error))

  def _card_previews_loaded(self, urls, results, error):
    self._preview_loading.difference_update(urls)
    if error:
      return
    for record_id, url, raw in results or []:
      card = self._card_by_id.get(record_id)
      if not card or card._image_url != url:
        continue
      pixmap = QPixmap()
      pixmap.loadFromData(raw)
      if not pixmap.isNull():
        card.pixmap = pixmap
        card.update()

  def resizeEvent(self, event):
    super().resizeEvent(event)
    source_columns = self._source_column_count()
    if source_columns != self._source_columns:
      self._layout_source_buttons(source_columns)
    columns = max(1, min(4, self.card_scroll.viewport().width() // 270))
    if columns != self._columns:
      self._render()

  def eventFilter(self, watched, event):
    if event.type() == QEvent.Type.Resize:
      if watched is self.card_scroll.viewport():
        QTimer.singleShot(0, self._reflow_card_grid)
      elif watched is self.source_bar:
        QTimer.singleShot(0, self._reflow_source_buttons)
    return super().eventFilter(watched, event)

  def _reflow_card_grid(self):
    columns = max(1, min(4, self.card_scroll.viewport().width() // 270))
    if columns != self._columns:
      self._render()

  def _reflow_source_buttons(self):
    columns = self._source_column_count()
    if columns != self._source_columns:
      self._layout_source_buttons(columns)

  def _source_column_count(self):
    margins = self.source_layout.contentsMargins()
    width = max(1, self.source_bar.width() - margins.left() - margins.right())
    count = max(1, self.source.count())
    spacing = self.source_layout.horizontalSpacing()
    for columns in range(count, 0, -1):
      widths = [0] * columns
      for index in range(count):
        button = self.source_buttons.get(self.source.itemData(index))
        if button:
          widths[index % columns] = max(widths[index % columns], button.sizeHint().width())
      if sum(widths) + spacing * (columns - 1) <= width:
        return columns
    return 1

  def _layout_source_buttons(self, columns=None):
    columns = self._source_column_count() if columns is None else columns
    while self.source_layout.count():
      self.source_layout.takeAt(0)
    for index in range(self.source.count()):
      button = self.source_buttons.get(self.source.itemData(index))
      if button:
        self.source_layout.addWidget(button, index // columns, index % columns)
    self._source_columns = columns

  def _show_detail(self, index):
    if index < 0 or index >= self.rows.count():
      self.current = None; self.detail.clear(); self.preview.setText('没有匹配的提示词'); self.favorite.setText('收藏'); return
    cat, query = self.category.currentText(), self.search.text().strip().casefold()
    rows = [item for item in self.items if (cat in ('', '全部分类') or cat in item.get('categories', [item.get('category', '未分类')])) and (not query or query in (item.get('title', '') + ' ' + item.get('prompt', item.get('content', '')) + ' ' + item.get('category', '')).casefold())]
    self.current = rows[index] if index < len(rows) else None
    if not self.current: return
    self.detail.setPlainText(self.current.get('prompt', self.current.get('content', '')))
    self.favorite.setText('取消收藏' if self.current.get('favorite') else '收藏')
    images = self.current.get('images') or ([self.current.get('previewUrl')] if self.current.get('previewUrl') else [])
    image = images[0] if images else ''
    if image.startswith(('http://', 'https://')):
      source = self.current.get('source', self.source.currentData())
      local = self._data_root() / 'prompt-cache' / 'images' / source / (hashlib.sha256(image.encode()).hexdigest() + '.img')
      if local.is_file():
        self.preview.setPixmap(QPixmap(str(local)).scaled(480, 240, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
      else:
        self.preview.setText('正在读取预览图…')
        def load_image():
          directory = _storage_directory()
          if directory:
            saved = _dispatch('image_read', {'directory': directory, 'url': image}).get('dataUrl')
            if saved: return base64.b64decode(saved.split(',', 1)[1])
          return sources.download_bytes(image)
        self._run(load_image, lambda data, error: self._image_loaded(image, data, error))
    elif image and Path(image).is_file(): self.preview.setPixmap(QPixmap(image).scaled(480, 240, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
    else: self.preview.setText('无预览图')

  def _image_loaded(self, url, raw, error):
    if not self.current: return
    images = self.current.get('images') or ([self.current.get('previewUrl')] if self.current.get('previewUrl') else [])
    if images and images[0] == url:
      pixmap = QPixmap()
      if raw and not error: pixmap.loadFromData(raw)
      self.preview.setPixmap(pixmap.scaled(480, 240, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation) if not pixmap.isNull() else QPixmap())
      if error or pixmap.isNull(): self.preview.setText('预览图读取失败')

  def _add(self): self._edit_record(None)

  def _edit(self):
    if self.current: self._edit_record(self.current)

  def _edit_record(self, record):
    dialog = _PromptEditor(record, self)
    if dialog.exec() != QDialog.DialogCode.Accepted: return
    value = dialog.value(record)
    if not value: return
    def save():
      directory = _storage_directory()
      if directory:
        return write_catalog(self._root(), 'personal', [item for item in self._personal_records if item.get('id') != value['id']] + [value], directory=directory, revision=getattr(self, '_personal_revision', ''))
      return self.store.put_record('prompts', value)
    self._run(save, lambda result, error: self._saved(value, error, result))

  def _saved(self, value, error, result=None):
    if error: QMessageBox.warning(self, '保存失败', str(error)); return
    if isinstance(result, dict) and result.get('revision'): self._personal_revision = result['revision']
    self._load_personal(); self.status.setText('个人提示词已保存。')

  def _capture_undo_images(self, record, directory):
    if not directory:
      return {}
    urls = record.get('images') or ([record.get('previewUrl')] if record.get('previewUrl') else [])
    saved = {}
    total = 0
    limit = 32 * 1024 * 1024
    for url in dict.fromkeys(value for value in urls if isinstance(value, str) and value.startswith('https://')):
      try:
        data_url = _dispatch('image_read', {'directory': directory, 'url': url}).get('dataUrl')
        if not data_url:
          continue
        header, separator, encoded = data_url.partition(',')
        mime = header[5:].split(';', 1)[0] if separator and header.startswith('data:') else ''
        if mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'):
          continue
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > limit or total + len(raw) > limit:
          continue
        saved[url] = (mime, raw)
        total += len(raw)
      except (OSError, ValueError):
        continue
    return saved

  def _delete(self):
    if not self.current: return
    if QMessageBox.question(self, '删除提示词', f'删除“{self.current.get("title", "无标题")}”？') != QMessageBox.StandardButton.Yes: return
    value = dict(self.current)
    def delete():
      directory = _storage_directory()
      images = self._capture_undo_images(value, directory)
      if directory:
        remaining = [item for item in self._personal_records if item.get('id') != value['id']]
        result = write_catalog(self._root(), 'personal', remaining, directory=directory, revision=getattr(self, '_personal_revision', ''))
      else:
        result = self.store.delete_record('prompts', value['id'])
      return {'result': result, 'images': images}
    self._run(delete, lambda result, error: self._deleted(value, error, result))

  def _deleted(self, value, error, result=None):
    if error: QMessageBox.warning(self, '删除失败', str(error)); return
    catalog = result.get('result') if isinstance(result, dict) else result
    if isinstance(catalog, dict) and catalog.get('revision'): self._personal_revision = catalog['revision']
    self.undo_record = value
    self.undo_images = result.get('images', {}) if isinstance(result, dict) else {}
    self.undo.setEnabled(True)
    self._personal_records = [item for item in getattr(self, '_personal_records', []) if item.get('id') != value['id']]
    if self.source.currentData() == 'personal': self._set_items(self._personal_records)
    self.status.setText('已删除，可撤销。')

  def _undo(self):
    if not self.undo_record: return
    value = self.undo_record
    images = dict(self.undo_images)
    def restore():
      directory = _storage_directory()
      if directory:
        for url, (mime, raw) in images.items():
          data_url = f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')
          _dispatch('image_write', {'source': 'personal', 'directory': directory, 'url': url, 'category': value.get('category', '未分类'), 'dataUrl': data_url})
        result = write_catalog(self._root(), 'personal', [item for item in self._personal_records if item.get('id') != value['id']] + [value], directory=directory, revision=getattr(self, '_personal_revision', ''))
      else:
        result = self.store.put_record('prompts', value)
      return result
    self._run(restore, lambda result, error: self._undo_done(error, result))

  def _undo_done(self, error, result=None):
    if error: QMessageBox.warning(self, '恢复失败', str(error)); return
    if isinstance(result, dict) and result.get('revision'): self._personal_revision = result['revision']
    self.undo_record = None; self.undo_images = {}; self.undo.setEnabled(False); self._load_personal()
  def _favorite(self):
    if not self.current: return
    value = dict(self.current); value['favorite'] = not value.get('favorite', False)
    if value.get('source') == 'personal':
      def save():
        directory = _storage_directory()
        if directory:
          return write_catalog(self._root(), 'personal', [value if item.get('id') == value['id'] else item for item in self._personal_records], directory=directory, revision=getattr(self, '_personal_revision', ''))
        return self.store.put_record('prompts', value)
      self._run(save, lambda result, error: self._saved(value, error, result))
    else:
      self.favorites[value['id']] = value['favorite']
      self._run(lambda: self._set_meta('prompt_favorites', self.favorites), lambda _result, error: self.status.setText(str(error) if error else '收藏已更新。'))
      self.items = [value if item.get('id') == value['id'] else item for item in self.items]
      self._render()

  def _use(self):
    if self.current: self.usePrompt.emit(dict(self.current))

  def _refresh(self):
    source = self.source.currentData()
    if source == 'personal': return
    import threading
    self._refresh_event = threading.Event(); cancel_event = self._refresh_event
    self.refresh_button.setEnabled(False); self.cancel.setEnabled(True); self.status.setText('正在读取并更新目录…')
    def progress(message):
      if self._closing_event.is_set() or cancel_event.is_set(): raise InterruptedError('目录刷新已取消，原缓存已保留。')
      self.statusUpdate.emit(message)
    self.statusUpdate.connect(self.status.setText)
    self._run(lambda: refresh_catalog(self._root(), source, progress), lambda value, error: self._refresh_done(source, value, error))

  statusUpdate = Signal(str)

  def _refresh_done(self, source, value, error):
    try: self.statusUpdate.disconnect()
    except RuntimeError: pass
    self.refresh_button.setEnabled(True); self.cancel.setEnabled(False)
    if error:
      self.status.setText(str(error)); return
    if source == self.source.currentData():
      self._set_items(value['items']); self.status.setText(f'已刷新 {len(self.items)} 条，缓存时间 {value["updatedAt"]}。')

  def _preload(self):
    source = self.source.currentData()
    if not self.items:
      self.status.setText('请先载入提示词目录。'); return
    category = self.category.currentText()
    records = [item for item in self.items if category in ('', '全部分类') or category in item.get('categories', [item.get('category', '未分类')])]
    images = sorted({url for item in records for url in (item.get('images') or ([item.get('previewUrl')] if item.get('previewUrl') else [])) if isinstance(url, str) and url.startswith('https://')})
    import threading
    self._preload_event = threading.Event(); cancel_event = self._preload_event
    self.preload.setEnabled(False); self.cancel.setEnabled(True); self.progress.setMaximum(max(1, len(images))); self.progress.setValue(0); self.progress.setVisible(True); self.cancel.setEnabled(True)
    self.status.setText('正在预载预览图…')
    def work():
      directory = _storage_directory()
      saved = set(_dispatch('catalog_read', {'source': source, 'directory': directory}).get('images', [])) if directory else set()
      root = self._data_root() / 'prompt-cache' / 'images' / source; root.mkdir(parents=True, exist_ok=True)
      done = 0
      for url in images:
        if cancel_event.is_set() or self._closing_event.is_set(): break
        target = root / (hashlib.sha256(url.encode()).hexdigest() + '.img')
        if url not in saved and not target.exists():
          raw = sources.download_bytes(url)
          if directory:
            mime = 'image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg' if raw.startswith(b'\xff\xd8') else 'image/gif' if raw.startswith((b'GIF87a', b'GIF89a')) else 'image/webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else 'image/avif' if b'avif' in raw[4:16] else ''
            if not mime: raise ValueError('预览图格式不受支持。')
            _dispatch('image_write', {'source': source, 'directory': directory, 'url': url, 'category': next((item.get('category', '未分类') for item in records if url in (item.get('images') or [])), '未分类'), 'dataUrl': f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')})
          else: target.write_bytes(raw)
        done += 1
        self.progressUpdate.emit(done)
      return done
    self.progressUpdate.connect(self.progress.setValue)
    self._run(work, self._preloaded)

  progressUpdate = Signal(int)

  def _preloaded(self, done, error):
    self.progressUpdate.disconnect()
    self.cancel.setEnabled(False); self.preload.setEnabled(True); self.progress.setVisible(False)
    self.status.setText(str(error) if error else f'预载完成，已处理 {done} 张；已保存文件会保留。')

  def _cancel(self):
    if self._preload_event: self._preload_event.set()
    if self._refresh_event: self._refresh_event.set()
    self.status.setText('正在停止，已保存的数据会保留。')

  def _clear_cache(self):
    source = self.source.currentData()
    if source == 'personal': return
    if QMessageBox.question(self, '清理本地缓存', f'清理 {self.source.currentText()} 的目录与预览图缓存？') != QMessageBox.StandardButton.Yes: return
    directory = _storage_directory()
    path = catalog_path(self._data_root(), source)
    images = self._data_root() / 'prompt-cache' / 'images' / source
    def work():
      if directory: return _dispatch('clear', {'source': source, 'directory': directory})
      path.unlink(missing_ok=True)
      if images.exists(): shutil.rmtree(images)
      return True
    self._run(work, lambda _value, error: self._cache_cleared(error))

  def _cache_cleared(self, error):
    if error: QMessageBox.warning(self, '清理失败', str(error)); return
    self._set_items([]); self.status.setText('本地缓存已清理。刷新可重新载入。')

  def _manage_source(self):
    source = self.source.currentData()
    if source == 'personal':
      if not self.removed: return
      names = [row['name'] for row in SOURCES if row['id'] in self.removed]
      if QMessageBox.question(self, '恢复提示词来源', '恢复已移除的来源：' + '、'.join(names) + '？') != QMessageBox.StandardButton.Yes: return
      removed = set()
    else:
      name = self.source.currentText()
      if QMessageBox.question(self, '移除提示词来源', f'从列表移除“{name}”？本地缓存保留，可随时恢复。') != QMessageBox.StandardButton.Yes: return
      removed = self.removed | {source}
    def save():
      directory = _storage_directory()
      if directory:
        prefs = _dispatch('preferences', {'directory': directory})
        prefs['removed'] = sorted(removed)
        return _dispatch('preferences', {'directory': directory, 'preferences': prefs})
      return self._set_meta('removed_sources', sorted(removed))
    self._run(save, lambda _value, error: self._source_preference_saved(source, removed, error))

  def _source_preference_saved(self, source, removed, error):
    if error: QMessageBox.warning(self, '保存失败', str(error)); return
    selected = 'personal' if source == 'personal' else None
    self.removed = removed
    self._rebuild_sources(selected)

  def _choose_directory(self):
    parent = QFileDialog.getExistingDirectory(self, '选择提示词保存目录', str(self._root().parent))
    if not parent: return
    if QMessageBox.question(self, '复制提示词数据', f'复制个人提示词与七个网站的目录/图片缓存到：\n{parent}\n\n完成后切换到新位置，原位置保留。') != QMessageBox.StandardButton.Yes: return
    self.choose_dir.setEnabled(False)
    def work():
      _dispatch('status')
      pending = _dispatch('prepare', {'directory': parent})
      migration = pending['migration']
      try:
        personal_on_disk = _dispatch('catalog_read', {'migration': migration, 'source': 'personal'}).get('catalog')
        personal = list(self.store.list_records('prompts'))
        if not personal_on_disk and personal:
          _dispatch('catalog_write', {'migration': migration, 'source': 'personal', 'items': _stored_items(personal), 'updatedAt': time.time_ns() // 1_000_000})
        for source in SOURCES:
          current = _dispatch('catalog_read', {'migration': migration, 'source': source['id']}).get('catalog')
          value = read_catalog(self._root(), source['id'], '') if not current else None
          if value:
            _dispatch('catalog_write', {'migration': migration, 'source': source['id'], 'items': _stored_items(value['items']), 'updatedAt': value['updatedAt']})
            image_dir = self._root() / 'prompt-cache' / 'images' / source['id']
            if image_dir.is_dir():
              for item in value['items']:
                for url in item.get('images', []):
                  image = image_dir / (hashlib.sha256(url.encode()).hexdigest() + '.img')
                  if image.is_file():
                    raw = image.read_bytes()
                    mime = 'image/png' if raw.startswith(b'\x89PNG') else 'image/jpeg' if raw.startswith(b'\xff\xd8') else 'image/gif' if raw.startswith((b'GIF87a', b'GIF89a')) else 'image/webp' if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP' else 'image/avif' if b'avif' in raw[4:16] else ''
                    if mime:
                      _dispatch('image_write', {'migration': migration, 'source': source['id'], 'url': url, 'category': item.get('category', '未分类'), 'dataUrl': f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')})
        existing = _dispatch('catalog_read', {'migration': migration, 'source': 'personal'})
        if not existing.get('catalog'):
          _dispatch('catalog_write', {'migration': migration, 'source': 'personal', 'items': [], 'updatedAt': time.time_ns() // 1_000_000})
        return _dispatch('commit', {'migration': migration, 'cleanPrevious': False,
          'preferences': {'removed': sorted(self.removed), 'examplesAdded': False}})
      except Exception:
        try: _dispatch('abort', {'migration': migration})
        except Exception: pass
        raise
    self._run(work, lambda value, error: self._directory_changed(value, error))

  def _directory_changed(self, value, error):
    self.choose_dir.setEnabled(True)
    if error: QMessageBox.warning(self, '迁移失败', str(error)); return
    self.status.setText(value.get('message', '提示词保存位置已切换，原目录保留。'))
    self._load_personal()

  def _zoom(self):
    pixmap = self.preview.pixmap()
    if pixmap and not pixmap.isNull(): _ImageZoom(pixmap, self).exec()
