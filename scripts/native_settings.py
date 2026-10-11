"""PySide6 原生 API 与应用偏好设置。"""

import hashlib
import json
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

from PySide6.QtCore import QThread, Signal, Qt
from PySide6.QtWidgets import (
  QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout, QGroupBox,
  QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox,
  QPushButton, QScrollArea, QSpinBox, QStackedWidget, QTabWidget, QVBoxLayout, QWidget,
)

from desktop_config import (
  recover_settings, save_desktop, settings_snapshot,
)


class ModelFetch(QThread):
  finished_models = Signal(object, object, object)

  def __init__(self, profile, token):
    super().__init__()
    self.profile = dict(profile)
    self.token = token

  def run(self):
    try:
      raw_url = self.profile.get('baseUrl', '')
      url = urlsplit(raw_url if '://' in raw_url else 'https://' + raw_url)
      key = self.profile.get('apiKey', '').strip()
      if not url.hostname or url.scheme not in ('http', 'https') or url.username or url.password or url.query or url.fragment or not key or '\r' in key or '\n' in key:
        raise ValueError('请填写有效的 API 地址与 Key。')
      from desktop_config import normalize_url
      from playground_image import NoRedirect
      request = urllib.request.Request(normalize_url(raw_url) + '/models', headers={
        'Authorization': 'Bearer ' + key, 'User-Agent': 'Chat-to-image-CLI/1'})
      with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        body = response.read(2 * 1024 * 1024 + 1)
      if len(body) > 2 * 1024 * 1024:
        raise ValueError('模型目录超过大小限制。')
      result = json.loads(body)
      if not isinstance(result, dict) or not isinstance(result.get('data'), list):
        raise ValueError('服务未返回兼容的模型列表，可手动添加。')
      ids = list(dict.fromkeys(item['id'].strip() for item in result['data']
        if isinstance(item, dict) and isinstance(item.get('id'), str) and item['id'].strip()))
      self.finished_models.emit(self.token, ids, None)
    except urllib.error.HTTPError as error:
      self.finished_models.emit(self.token, None, f'模型列表获取失败（HTTP {error.code}），可继续手动添加。')
    except (urllib.error.URLError, TimeoutError) as error:
      message = '模型目录请求超时，请检查网络后重试。' if isinstance(error, TimeoutError) or isinstance(getattr(error, 'reason', None), TimeoutError) else '模型目录连接失败，请检查地址与网络；原选择已保留。'
      self.finished_models.emit(self.token, None, message)
    except (OSError, ValueError, json.JSONDecodeError, UnicodeError):
      self.finished_models.emit(self.token, None, '模型目录获取失败，原选择已保留；请检查地址、Key 和网络。')


class ModelSelectionDialog(QDialog):
  def __init__(self, models, parent=None):
    super().__init__(parent)
    self.setWindowTitle('选择要追加的模型')
    self.resize(440, 520)
    layout = QVBoxLayout(self)
    self.search = QLineEdit()
    self.search.setPlaceholderText('搜索模型')
    layout.addWidget(self.search)
    self.list = QListWidget()
    self.list.setSelectionMode(QListWidget.SelectionMode.NoSelection)
    for model in models:
      item = QListWidgetItem(model)
      item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
      item.setCheckState(Qt.CheckState.Checked)
      self.list.addItem(item)
    layout.addWidget(self.list)
    self.search.textChanged.connect(self._filter)
    selection = QHBoxLayout()
    select_visible = QPushButton('全选可见项')
    clear_visible = QPushButton('清空可见项')
    select_visible.clicked.connect(lambda: self._set_visible(True))
    clear_visible.clicked.connect(lambda: self._set_visible(False))
    selection.addWidget(select_visible)
    selection.addWidget(clear_visible)
    selection.addStretch(1)
    layout.addLayout(selection)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    buttons.accepted.connect(self.accept)
    buttons.rejected.connect(self.reject)
    layout.addWidget(buttons)

  def _filter(self, value):
    query = value.casefold()
    for index in range(self.list.count()):
      item = self.list.item(index)
      item.setHidden(query not in item.text().casefold())

  def _set_visible(self, checked):
    for index in range(self.list.count()):
      item = self.list.item(index)
      if not item.isHidden():
        item.setCheckState(Qt.CheckState.Checked if checked else Qt.CheckState.Unchecked)

  def selected_models(self):
    return [self.list.item(index).text() for index in range(self.list.count())
      if self.list.item(index).checkState() == Qt.CheckState.Checked]


class SettingsDialog(QDialog):
  saved = Signal()
  importBackupRequested = Signal()
  exportBackupRequested = Signal()
  featureIntroRequested = Signal()

  def __init__(self, parent=None):
    super().__init__(parent)
    self.setWindowTitle('设置与 API')
    self.resize(1040, 820)
    self.setMinimumSize(920, 620)
    snapshot = settings_snapshot()
    self.revision = snapshot['revision']
    self.settings = snapshot.get('settings')
    self.fetch_thread = None
    self.fetch_request = None
    self.fetch_action = ''
    self.fetch_snapshot = None
    self._loading = False
    self._mode = 'images'
    self._profile_id = None
    self._editing_ids = {'images': None, 'responses': None}
    root = QVBoxLayout(self)
    if self.settings is None and snapshot.get('error'):
      self.error_label = QLabel(snapshot['error'])
      self.error_label.setWordWrap(True)
      root.addWidget(self.error_label)
      retained = QLabel('无法解密的旧配置仍保留在原位置。确认重新配置后，系统会先备份旧文件。')
      retained.setWordWrap(True)
      root.addWidget(retained)

      self.tabs = None
      self.save_button = QPushButton('保存配置')
      self.save_button.setEnabled(False)
      root.addWidget(self.save_button)
      self.recover_button = QPushButton('保留旧配置并重新配置')
      self.recover_button.clicked.connect(self._recover)
      root.addWidget(self.recover_button)
      return
    if self.settings is None:
      self.settings = {'profiles': [], 'activeProfileId': '',
        'failover': {'enabled': False, 'primaryId': '', 'slots': [], 'disabledIds': []},
        'agentFailover': {'enabled': False, 'primaryId': '', 'slots': [], 'disabledIds': []}}

    self.error_label = QLabel('')
    self.error_label.setWordWrap(True)
    root.addWidget(self.error_label)
    content = QHBoxLayout()
    self.navigation = QListWidget()
    self.navigation.setObjectName('navigation')
    self.navigation.setFixedWidth(150)
    self.navigation.addItems(['API 配置', '使用习惯', '数据管理', 'Agent 连接', '功能介绍'])
    content.addWidget(self.navigation)
    self.pages_stack = QStackedWidget()
    content.addWidget(self.pages_stack, 1)
    root.addLayout(content, 1)
    self.api_tabs = QTabWidget()
    self.tabs = self.api_tabs
    self.pages = {}
    for mode, title in (('images', '画廊 API'), ('responses', 'Responses API')):
      page = QWidget()
      self._build_profile_page(page, mode)
      self.pages[mode] = page
      scroll = QScrollArea()
      scroll.setWidgetResizable(True)
      scroll.setWidget(page)
      self.api_tabs.addTab(scroll, title)
    self.pages_stack.addWidget(self.api_tabs)
    self._build_preferences()
    self.pages_stack.addWidget(self._scroll_page(self.preference_page))
    self._build_connections()
    self.pages_stack.addWidget(self._scroll_page(self.connection_page))
    self._build_data_management()
    self.pages_stack.insertWidget(2, self._scroll_page(self.data_page))
    self._build_feature_intro()
    self.pages_stack.addWidget(self._scroll_page(self.feature_page))
    self.navigation.currentRowChanged.connect(self.pages_stack.setCurrentIndex)
    self.navigation.setCurrentRow(0)
    self.api_tabs.currentChanged.connect(self._tab_changed)
    foot = QHBoxLayout()
    self.save_button = QPushButton('保存配置')
    cancel = QPushButton('取消')
    self.save_button.clicked.connect(self._save)
    cancel.clicked.connect(self.reject)
    foot.addStretch(1)
    foot.addWidget(self.save_button)
    foot.addWidget(cancel)
    root.addLayout(foot)
    self._refresh_lists()
    self._load_selected('images')

  def _scroll_page(self, page):
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setWidget(page)
    return scroll

  def _build_data_management(self):
    self.data_page = QWidget()
    layout = QVBoxLayout(self.data_page)
    layout.addWidget(QLabel('导入或导出作品、对话、收藏与个人提示词备份。'))
    import_button = QPushButton('导入备份')
    import_button.clicked.connect(self.importBackupRequested.emit)
    export_button = QPushButton('导出作品备份')
    export_button.clicked.connect(self.exportBackupRequested.emit)
    layout.addWidget(import_button)
    layout.addWidget(export_button)
    layout.addStretch(1)

  def _build_feature_intro(self):
    self.feature_page = QWidget()
    layout = QVBoxLayout(self.feature_page)
    title = QLabel('Chat to image · 本地 AI 图像创作工作室')
    title.setObjectName('pageTitle')
    layout.addWidget(title)
    for text in (
      '从想法到画面：讨论创意、整理提示词、生成与修改图片，并保存满意的作品。',
      '对话创作可结合参考图连续生成或修改；创作画廊支持生图、参考图编辑和局部修改。',
      '作品与收藏可搜索历史、下载图片并复用参数；提示词库可收藏和管理个人提示词。',
      '图像与对话服务分开配置，可读取模型目录并设置主用和备用服务。',
      'Agent 连接支持 Codex、Claude Code、Cursor 与 DeepSeek Harness。',
      '直接生图需要图像服务，对话式创作还需对话服务。可用能力取决于已配置的服务商和模型。',
    ):
      label = QLabel(text)
      label.setWordWrap(True)
      layout.addWidget(label)
    project_button = QPushButton('打开功能介绍')
    project_button.clicked.connect(self.featureIntroRequested.emit)
    layout.addWidget(project_button)
    layout.addStretch(1)

  def _build_profile_page(self, page, mode):
    layout = QVBoxLayout(page)
    box = QGroupBox('API 配置')
    box_layout = QHBoxLayout(box)
    self.profile_lists = getattr(self, 'profile_lists', {})
    profile_list = QListWidget()
    self.profile_lists[mode] = profile_list
    box_layout.addWidget(profile_list, 1)
    form_widget = QWidget()
    form = QFormLayout(form_widget)
    self.forms = getattr(self, 'forms', {})
    fields = {
      'name': QLineEdit(), 'baseUrl': QLineEdit(), 'apiKey': QLineEdit(),
      'model': QComboBox(),
    }
    fields['apiKey'].setEchoMode(QLineEdit.EchoMode.Password)
    fields['apiKey'].setPlaceholderText('留空保留当前 Key')
    fields['model'].setEditable(True)
    self.forms[mode] = fields
    form.addRow('名称', fields['name'])
    form.addRow('API 地址', fields['baseUrl'])
    key_row = QWidget()
    key_layout = QHBoxLayout(key_row)
    key_layout.setContentsMargins(0, 0, 0, 0)
    key_layout.addWidget(fields['apiKey'], 1)
    clear_key = QCheckBox('清空现有 Key')
    fields['clearKey'] = clear_key
    key_layout.addWidget(clear_key)
    form.addRow('Key', key_row)
    form.addRow('默认模型', fields['model'])
    models = QListWidget()
    models.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
    fields['models'] = models
    form.addRow('模型列表（多选后可移除）', models)
    controls = QHBoxLayout()
    fields['search'] = QLineEdit()
    fields['search'].setPlaceholderText('筛选模型列表')
    controls.addWidget(fields['search'], 1)
    fields['fetch'] = QPushButton('获取模型')
    fields['testConnection'] = QPushButton('测试连通')
    controls.addWidget(fields['fetch'])
    controls.addWidget(fields['testConnection'])
    form.addRow('模型目录', controls)
    manual = QWidget()
    manual_layout = QHBoxLayout(manual)
    manual_layout.setContentsMargins(0, 0, 0, 0)
    fields['manual'] = QLineEdit()
    fields['manual'].setPlaceholderText('手动添加一个模型 ID')
    fields['addModel'] = QPushButton('添加')
    fields['removeModels'] = QPushButton('移除所选')
    fields['setDefault'] = QPushButton('设为默认')
    manual_layout.addWidget(fields['manual'], 1)
    manual_layout.addWidget(fields['addModel'])
    manual_layout.addWidget(fields['removeModels'])
    manual_layout.addWidget(fields['setDefault'])
    form.addRow('模型操作', manual)
    fields['enabled'] = QCheckBox('启用此配置')
    fields['primary'] = QCheckBox('设为主用配置')
    state_row = QWidget()
    state_layout = QHBoxLayout(state_row)
    state_layout.setContentsMargins(0, 0, 0, 0)
    state_layout.addWidget(fields['enabled'])
    state_layout.addWidget(fields['primary'])
    state_layout.addStretch(1)
    form.addRow('主备状态', state_row)
    fields['failover'] = QCheckBox('启用自动切换备用配置')
    form.addRow('主备策略', fields['failover'])
    order = QHBoxLayout()
    fields['up'] = QPushButton('上移')
    fields['down'] = QPushButton('下移')
    order.addWidget(fields['up'])
    order.addWidget(fields['down'])
    order.addStretch(1)
    form.addRow('备用顺序', order)
    capabilities = QGroupBox('图像模型参数限制')
    cap_form = QFormLayout(capabilities)
    fields['capModel'] = QComboBox()
    fields['sizes'] = QLineEdit()
    fields['sizes'].setPlaceholderText('auto, 1024x1024；留空不限')
    fields['qualities'] = QLineEdit()
    fields['qualities'].setPlaceholderText('auto, low, medium, high, xhigh, max')
    fields['formats'] = QLineEdit()
    fields['formats'].setPlaceholderText('png, jpeg, webp')
    fields['transparent'] = QComboBox()
    fields['transparent'].addItems(['未确认', '支持', '不支持'])
    fields['maxInputImages'] = QSpinBox()
    fields['maxInputImages'].setRange(-1, 16)
    fields['maxInputImages'].setSpecialValueText('不限')
    fields['maxInputImages'].setValue(-1)
    cap_form.addRow('模型', fields['capModel'])
    cap_form.addRow('允许尺寸', fields['sizes'])
    cap_form.addRow('允许质量', fields['qualities'])
    cap_form.addRow('允许格式', fields['formats'])
    cap_form.addRow('原生透明背景', fields['transparent'])
    cap_form.addRow('参考图上限', fields['maxInputImages'])
    form.addRow(capabilities)
    actions = QHBoxLayout()
    fields['addProfile'] = QPushButton('新增配置')
    fields['deleteProfile'] = QPushButton('删除配置')
    actions.addWidget(fields['addProfile'])
    actions.addWidget(fields['deleteProfile'])
    actions.addStretch(1)
    form.addRow(actions)
    box_layout.addWidget(form_widget, 3)
    layout.addWidget(box, 1)
    profile_list.currentRowChanged.connect(lambda _row, m=mode: self._select_profile(m))
    fields['model'].currentTextChanged.connect(lambda _value, m=mode: self._update_cap_models(m))
    fields['capModel'].currentTextChanged.connect(lambda _value, m=mode: self._load_capability(m))
    fields['addProfile'].clicked.connect(lambda _=False, m=mode: self._add_profile(m))
    fields['deleteProfile'].clicked.connect(lambda _=False, m=mode: self._delete_profile(m))
    fields['addModel'].clicked.connect(lambda _=False, m=mode: self._add_model(m))
    fields['removeModels'].clicked.connect(lambda _=False, m=mode: self._remove_models(m))
    fields['setDefault'].clicked.connect(lambda _=False, m=mode: self._set_default_model(m))
    fields['search'].textChanged.connect(lambda value, m=mode: self._filter_models(m, value))
    fields['fetch'].clicked.connect(lambda _=False, m=mode: self._fetch_models(m))
    fields['testConnection'].clicked.connect(lambda _=False, m=mode: self._fetch_models(m, True))
    fields['enabled'].toggled.connect(lambda _checked, m=mode: self._capture(m))
    fields['primary'].toggled.connect(lambda checked, m=mode: self._primary_changed(m, checked))
    fields['failover'].toggled.connect(lambda _checked, m=mode: self._capture(m))
    fields['up'].clicked.connect(lambda _=False, m=mode: self._move_profile(m, -1))
    fields['down'].clicked.connect(lambda _=False, m=mode: self._move_profile(m, 1))

  def _build_preferences(self):
    self.preference_page = QWidget()
    layout = QVBoxLayout(self.preference_page)
    form = QFormLayout()
    self.theme = QComboBox()
    self.theme.addItems(['跟随系统', '浅色', '深色'])
    self.theme.setCurrentIndex({'system': 0, 'light': 1, 'dark': 2}.get(self.settings.get('theme', 'system'), 0))
    self.enter_submit = QComboBox()
    self.enter_submit.addItems(['Ctrl + Enter 发送', 'Enter 发送'])
    self.enter_submit.setCurrentIndex(1 if self.settings.get('enterSubmit', False) else 0)
    self.persist_input = QCheckBox('重启后恢复输入框')
    self.persist_input.setChecked(bool(self.settings.get('persistInputOnRestart', True)))
    self.clear_input = QCheckBox('提交成功后清空输入框')
    self.clear_input.setChecked(bool(self.settings.get('clearInputAfterSubmit', False)))
    self.notifications = QCheckBox('任务完成后发送系统通知')
    self.notifications.setChecked(bool(self.settings.get('taskCompletionNotification', False)))
    self.rewrite_prompt = QCheckBox('允许模型优化提示词')
    self.rewrite_prompt.setChecked(bool(self.settings.get('allowPromptRewrite', False)))
    self.retry_button = QCheckBox('成功后保留重试按钮')
    self.retry_button.setChecked(bool(self.settings.get('alwaysShowRetryButton', False)))
    self.agent_model = QComboBox()
    self.agent_model.setEditable(True)
    self.agent_model.addItem('自动使用主备默认模型', '')
    agent_models = list(dict.fromkeys(model for profile in self._profiles('responses')
      for model in (profile.get('models') or [profile.get('model')]) if model))
    for model in agent_models:
      self.agent_model.addItem(model, model)
    if self.settings.get('agentModel'):
      self.agent_model.setCurrentText(self.settings['agentModel'])
    else:
      self.agent_model.setCurrentIndex(0)
    self.agent_web_search = QCheckBox('新对话默认开启网络搜索')
    self.agent_web_search.setChecked(bool(self.settings.get('agentWebSearch', False)))
    self.agent_scroll = QCheckBox('发送后滚动到最新消息')
    self.agent_scroll.setChecked(bool(self.settings.get('agentScrollToBottomAfterSubmit', True)))
    self.agent_math = QCheckBox('优化数学公式显示')
    self.agent_math.setChecked(bool(self.settings.get('agentMathFormattingPrompt', False)))
    self.agent_max_rounds = QSpinBox()
    self.agent_max_rounds.setRange(1, 10)
    self.agent_max_rounds.setValue(max(1, min(10, int(self.settings.get('agentMaxToolRounds', 1)))))
    form.addRow('界面外观', self.theme)
    form.addRow('任务提交方式', self.enter_submit)
    form.addRow(self.persist_input)
    form.addRow(self.clear_input)
    form.addRow(self.notifications)
    form.addRow(self.rewrite_prompt)
    form.addRow(self.retry_button)
    form.addRow('新对话默认模型', self.agent_model)
    form.addRow(self.agent_web_search)
    form.addRow(self.agent_scroll)
    form.addRow('连续工具调用上限（1–10）', self.agent_max_rounds)
    form.addRow(self.agent_math)
    layout.addLayout(form)
    zip_box = QGroupBox('使用压缩包下载的途径')
    zip_layout = QVBoxLayout(zip_box)
    zip_labels = {
      'task-selection': '任务列表多选下载',
      'favorite-collection-selection': '收藏夹列表多选下载',
      'image-context-menu-all': '图片菜单下载全部',
      'task-detail-all': '任务详情下载全部',
      'agent-round-all': 'Agent 对话轮次下载所有图片',
    }
    self.zip_routes = {}
    saved_routes = self.settings.get('zipDownloadRoutes', ['task-selection', 'favorite-collection-selection'])
    for route, label in zip_labels.items():
      checkbox = QCheckBox(label)
      checkbox.setChecked(route in saved_routes)
      self.zip_routes[route] = checkbox
      zip_layout.addWidget(checkbox)
    layout.addWidget(zip_box)
    layout.addStretch(1)
  def _build_connections(self):
    self.connection_page = QWidget()
    layout = QVBoxLayout(self.connection_page)
    layout.addWidget(QLabel('管理 Codex、Claude Code、Cursor 与 DeepSeek Harness 的本地接入。连接文件由现有连接管理器保护。'))
    self.connection_status = QLabel('')
    self.connection_status.setWordWrap(True)
    layout.addWidget(self.connection_status)
    self.connection_buttons = {}
    for target, title in (('codex', 'Codex'), ('claude', 'Claude Code'), ('cursor', 'Cursor'), ('deepseek-harness', 'DeepSeek Harness')):
      row = QHBoxLayout()
      row.addWidget(QLabel(title))
      status = QLabel('')
      self.connection_buttons[target] = status
      row.addWidget(status, 1)
      for action, label in (('connect', '连接'), ('update', '更新'), ('disconnect', '断开')):
        button = QPushButton(label)
        button.clicked.connect(lambda _=False, a=action, t=target: self._change_connection(a, t))
        row.addWidget(button)
      layout.addLayout(row)
    layout.addStretch(1)
    self._refresh_connections()

  def _pool(self, mode):
    key = 'failover' if mode == 'images' else 'agentFailover'
    ids = [profile['id'] for profile in self.settings.get('profiles', [])
      if profile.get('provider') == 'openai' and profile.get('apiMode') == mode]
    pool = self.settings.setdefault(key, {})
    pool.setdefault('enabled', False)
    pool.setdefault('slots', ids)
    pool.setdefault('disabledIds', [])
    pool.setdefault('primaryId', self.settings.get('activeProfileId') if mode == 'images' and self.settings.get('activeProfileId') in ids else (ids[0] if ids else ''))
    return pool

  def _profiles(self, mode):
    profiles = [profile for profile in self.settings['profiles'] if profile.get('provider') == 'openai' and profile.get('apiMode') == mode]
    slots = self._pool(mode).get('slots', [])
    return sorted(profiles, key=lambda profile: slots.index(profile['id']) if profile['id'] in slots else len(slots))

  def _refresh_lists(self):
    for mode, widget in self.profile_lists.items():
      current_id = self._profile_id if self._mode == mode else None
      widget.blockSignals(True)
      widget.clear()
      for profile in self._profiles(mode):
        item = QListWidgetItem(profile.get('name') or profile['id'])
        item.setData(Qt.ItemDataRole.UserRole, profile['id'])
        widget.addItem(item)
      match = next((i for i in range(widget.count()) if widget.item(i).data(Qt.ItemDataRole.UserRole) == current_id), 0)
      widget.setCurrentRow(match if widget.count() else -1)
      widget.blockSignals(False)

  def _tab_changed(self, index):
    if self._mode in self.profile_lists:
      self._capture(self._mode)
    if index < 2:
      self._mode = 'images' if index == 0 else 'responses'
      self._refresh_lists()
      self._load_selected(self._mode)
    else:
      self._capture('images')
      self._capture('responses')
      self._save_preferences()

  def _select_profile(self, mode):
    widget = self.profile_lists[mode]
    item = widget.currentItem()
    if item:
      self._capture(mode)
      self._profile_id = item.data(Qt.ItemDataRole.UserRole)
      self._mode = mode
      self._load_selected(mode)

  def _load_selected(self, mode):
    fields = self.forms[mode]
    widget = self.profile_lists[mode]
    item = widget.currentItem()
    profile = next((p for p in self._profiles(mode) if p['id'] == (item.data(Qt.ItemDataRole.UserRole) if item else None)), None)
    self._loading = True
    self._editing_ids[mode] = profile['id'] if profile else None
    self._profile_id = profile['id'] if profile else None
    for key in ('name', 'baseUrl'):
      fields[key].setText(profile.get(key, '') if profile else '')
    fields['apiKey'].clear()
    fields['clearKey'].setChecked(False)
    fields['enabled'].setChecked(bool(profile and profile['id'] not in self._pool(mode).get('disabledIds', [])))
    fields['primary'].setChecked(bool(profile and profile['id'] == self._pool(mode).get('primaryId')))
    fields['failover'].setChecked(bool(self._pool(mode).get('enabled', False)))
    models = list(profile.get('models') or ([profile.get('model')] if profile and profile.get('model') else [])) if profile else []
    fields['model'].clear()
    fields['model'].addItems(models)
    fields['model'].setCurrentText(profile.get('model', '') if profile else '')
    fields['models'].clear()
    fields['models'].addItems(models)
    fields['capModel'].clear()
    fields['capModel'].addItems(models)
    fields['capModel'].setCurrentText(profile.get('model', '') if profile else '')
    self._load_capability(mode)
    self._loading = False
    for key in ('name', 'baseUrl', 'model'):
      fields[key].setEnabled(bool(profile))
    for key in ('apiKey', 'clearKey', 'models', 'search', 'fetch', 'testConnection', 'manual', 'addModel', 'removeModels', 'setDefault', 'enabled', 'primary', 'failover', 'up', 'down', 'capModel', 'sizes', 'qualities', 'formats', 'transparent', 'maxInputImages', 'deleteProfile'):
      fields[key].setEnabled(bool(profile))
    fields['deleteProfile'].setEnabled(bool(profile))
    fields['primary'].setEnabled(bool(profile))
    fields['failover'].setEnabled(bool(self._pool(mode).get('slots')))

  def _capture(self, mode):
    if self._loading or not self.settings:
      return
    fields = self.forms[mode]
    profile_id = self._editing_ids.get(mode)
    if not profile_id:
      return
    profile = next((p for p in self._profiles(mode) if p['id'] == profile_id), None)
    if not profile:
      return
    profile['name'] = fields['name'].text().strip()
    profile['baseUrl'] = fields['baseUrl'].text().strip()
    if fields['clearKey'].isChecked():
      profile['apiKey'] = ''
    elif fields['apiKey'].text():
      profile['apiKey'] = fields['apiKey'].text()
    models = [fields['models'].item(i).text() for i in range(fields['models'].count())]
    profile['models'] = models
    profile['model'] = fields['model'].currentText().strip()
    cap_model = fields['capModel'].currentText().strip()
    if cap_model:
      current = dict(profile.get('imageCapabilities') or {})
      rule = dict(current.get(cap_model) or {})
      sizes = [x.strip().lower().replace('×', 'x') for x in fields['sizes'].text().replace('，', ',').split(',') if x.strip()]
      if sizes:
        rule['sizes'] = sizes
      else:
        rule.pop('sizes', None)
      qualities = [x.strip() for x in fields['qualities'].text().replace('，', ',').split(',') if x.strip()]
      if qualities:
        rule['qualities'] = qualities
      else:
        rule.pop('qualities', None)
      formats = [x.strip() for x in fields['formats'].text().replace('，', ',').split(',') if x.strip()]
      if formats:
        rule['formats'] = formats
      else:
        rule.pop('formats', None)
      transparent = fields['transparent'].currentIndex()
      if transparent == 0:
        rule.pop('transparent', None)
      else:
        rule['transparent'] = transparent == 1
      count = fields['maxInputImages'].value()
      if count < 0:
        rule.pop('maxInputImages', None)
      else:
        rule['maxInputImages'] = count
      if rule:
        current[cap_model] = rule
      else:
        current.pop(cap_model, None)
      profile['imageCapabilities'] = current
    pool = self._pool(mode)
    slots = pool.setdefault('slots', [])
    if fields['enabled'].isChecked() and profile['id'] not in slots:
      slots.append(profile['id'])
    if not fields['enabled'].isChecked():
      if profile['id'] in slots:
        pool['disabledIds'] = list(dict.fromkeys(pool.get('disabledIds', []) + [profile['id']]))
    else:
      pool['disabledIds'] = [value for value in pool.get('disabledIds', []) if value != profile['id']]
    pool['enabled'] = fields['failover'].isChecked()
    if fields['primary'].isChecked():
      pool['primaryId'] = profile['id']
    if mode == 'images' and pool.get('primaryId'):
      self.settings['activeProfileId'] = pool['primaryId']
    for index in range(self.profile_lists[mode].count()):
      list_item = self.profile_lists[mode].item(index)
      if list_item.data(Qt.ItemDataRole.UserRole) == profile['id']:
        list_item.setText(profile['name'] or profile['id'])
        break
    if mode == 'responses':
      self._save_preferences()

  def _update_cap_models(self, mode):
    if self._loading:
      return
    fields = self.forms[mode]
    current = fields['capModel'].currentText()
    models = [fields['models'].item(i).text() for i in range(fields['models'].count())]
    fields['capModel'].blockSignals(True)
    fields['capModel'].clear()
    fields['capModel'].addItems(models)
    fields['capModel'].setCurrentText(current if current in models else fields['model'].currentText())
    fields['capModel'].blockSignals(False)
    self._load_capability(mode)

  def _load_capability(self, mode):
    if self._loading:
      return
    fields = self.forms[mode]
    item = self.profile_lists[mode].currentItem()
    profile = next((p for p in self._profiles(mode) if item and p['id'] == item.data(Qt.ItemDataRole.UserRole)), None)
    rule = (profile or {}).get('imageCapabilities', {}).get(fields['capModel'].currentText(), {})
    fields['sizes'].setText(', '.join(rule.get('sizes', [])))
    fields['qualities'].setText(', '.join(rule.get('qualities', [])))
    fields['formats'].setText(', '.join(rule.get('formats', [])))
    fields['transparent'].setCurrentIndex(0 if 'transparent' not in rule else 1 if rule['transparent'] else 2)
    fields['maxInputImages'].setValue(rule.get('maxInputImages', -1))

  def _filter_models(self, mode, query):
    for index in range(self.forms[mode]['models'].count()):
      item = self.forms[mode]['models'].item(index)
      item.setHidden(query.casefold() not in item.text().casefold())

  def _add_model(self, mode):
    fields = self.forms[mode]
    model = fields['manual'].text().strip()
    if not model:
      return
    if not [fields['models'].item(i).text() for i in range(fields['models'].count())].count(model):
      fields['models'].addItem(model)
      fields['model'].addItem(model)
      fields['capModel'].addItem(model)
    fields['manual'].clear()
    self._capture(mode)

  def _remove_models(self, mode):
    fields = self.forms[mode]
    removed = {item.text() for item in fields['models'].selectedItems()}
    for item in fields['models'].selectedItems():
      fields['models'].takeItem(fields['models'].row(item))
    for model in removed:
      idx = fields['model'].findText(model)
      if idx >= 0:
        fields['model'].removeItem(idx)
      idx = fields['capModel'].findText(model)
      if idx >= 0:
        fields['capModel'].removeItem(idx)
    self._capture(mode)

  def _set_default_model(self, mode):
    fields = self.forms[mode]
    selected = fields['models'].selectedItems()
    if selected:
      fields['model'].setCurrentText(selected[0].text())
      self._capture(mode)

  def _fetch_models(self, mode, test_connection=False):
    if self.fetch_request is not None:
      QMessageBox.information(self, '请求进行中', '当前模型请求完成前，不能启动另一个请求。')
      return
    self._capture(mode)
    item = self.profile_lists[mode].currentItem()
    profile_id = item.data(Qt.ItemDataRole.UserRole) if item else None
    profile = next((p for p in self._profiles(mode) if p['id'] == profile_id), None)
    if not profile:
      return
    fields = self.forms[mode]
    token = uuid.uuid4().hex
    self.fetch_request = token
    self.fetch_action = 'test' if test_connection else 'models'
    self.fetch_snapshot = (mode, profile_id, fields['baseUrl'].text(), fields['apiKey'].text(), fields['clearKey'].isChecked(), hashlib.sha256(profile.get('apiKey', '').encode('utf-8')).digest())
    for group in self.forms.values():
      group['fetch'].setEnabled(False)
      group['testConnection'].setEnabled(False)
    self.save_button.setEnabled(False)
    self.fetch_thread = ModelFetch(profile, token)
    self.fetch_thread.finished_models.connect(self._models_ready)
    self.fetch_thread.start()

  def _models_ready(self, token, ids, error):
    if token != self.fetch_request:
      return
    if self.fetch_thread and self.fetch_thread.isRunning():
      self.fetch_thread.wait()
    mode, profile_id, base_url, key_input, clear_key, key_digest = self.fetch_snapshot
    fields = self.forms[mode]
    item = self.profile_lists[mode].currentItem()
    profile = next((p for p in self._profiles(mode) if p['id'] == profile_id), None)
    matches = (self._editing_ids.get(mode) == profile_id and item is not None and
      item.data(Qt.ItemDataRole.UserRole) == profile_id and fields['baseUrl'].text() == base_url and
      fields['apiKey'].text() == key_input and fields['clearKey'].isChecked() == clear_key and profile is not None and
      hashlib.sha256(profile.get('apiKey', '').encode('utf-8')).digest() == key_digest)
    action = self.fetch_action
    self.fetch_request = None
    self.fetch_snapshot = None
    self.fetch_action = ''
    for group_mode, group in self.forms.items():
      enabled = bool(self._editing_ids.get(group_mode))
      group['fetch'].setEnabled(enabled)
      group['testConnection'].setEnabled(enabled)
    self.save_button.setEnabled(True)
    if not matches:
      QMessageBox.information(self, '配置已更改', '请求期间配置已切换或修改，结果已丢弃。')
      return
    if error:
      QMessageBox.warning(self, '连接失败' if action == 'test' else '获取模型失败', error)
      return
    if action == 'test':
      QMessageBox.information(self, '连接成功', f'接口已连通，返回 {len(ids)} 个模型。')
      return
    dialog = ModelSelectionDialog(ids, self)
    if dialog.exec() != QDialog.DialogCode.Accepted:
      return
    existing = {fields['models'].item(i).text() for i in range(fields['models'].count())}
    for model in dialog.selected_models():
      if model not in existing:
        fields['models'].addItem(model)
        fields['model'].addItem(model)
        fields['capModel'].addItem(model)
    self._capture(mode)

  def _add_profile(self, mode):
    if len(self._profiles(mode)) >= 10:
      QMessageBox.warning(self, '配置数量已满', '每组最多添加 10 套 API 配置。')
      return
    self._capture(mode)
    profile = {'id': uuid.uuid4().hex, 'name': '', 'provider': 'openai', 'apiMode': mode,
      'baseUrl': '', 'apiKey': '', 'model': '', 'models': [], 'timeout': 30}
    self.settings['profiles'].append(profile)
    pool = self._pool(mode)
    pool.setdefault('slots', []).append(profile['id'])
    if not pool.get('primaryId'):
      pool['primaryId'] = profile['id']
      if mode == 'images':
        self.settings['activeProfileId'] = profile['id']
    self._refresh_lists()
    self.profile_lists[mode].setCurrentRow(self.profile_lists[mode].count() - 1)
    self._load_selected(mode)
    self.forms[mode]['name'].setFocus()

  def _delete_profile(self, mode):
    item = self.profile_lists[mode].currentItem()
    if not item:
      return
    profile_id = item.data(Qt.ItemDataRole.UserRole)
    self.settings['profiles'] = [p for p in self.settings['profiles'] if p['id'] != profile_id]
    pool = self._pool(mode)
    pool['slots'] = [value for value in pool.get('slots', []) if value != profile_id]
    pool['disabledIds'] = [value for value in pool.get('disabledIds', []) if value != profile_id]
    remaining = self._profiles(mode)
    if pool.get('primaryId') == profile_id:
      pool['primaryId'] = remaining[0]['id'] if remaining else ''
    if mode == 'images' and self.settings.get('activeProfileId') == profile_id:
      self.settings['activeProfileId'] = pool.get('primaryId', '')
    preference_key = 'agentTextProfileId' if mode == 'responses' else 'agentImageProfileId'
    if self.settings.get(preference_key) == profile_id:
      self.settings[preference_key] = remaining[0]['id'] if remaining else None
    self._refresh_lists()
    self._load_selected(mode)

  def _primary_changed(self, mode, checked):
    if self._loading:
      return
    if not checked and self._pool(mode).get('primaryId') == self._editing_ids.get(mode):
      self._loading = True
      self.forms[mode]['primary'].setChecked(True)
      self._loading = False
      return
    if checked:
      fields = self.forms[mode]
      self._loading = True
      fields['enabled'].setChecked(True)
      self._loading = False
      self._capture(mode)
      self._refresh_lists()

  def _move_profile(self, mode, delta):
    item = self.profile_lists[mode].currentItem()
    if not item:
      return
    profile_id = item.data(Qt.ItemDataRole.UserRole)
    pool = self._pool(mode)
    slots = pool.setdefault('slots', [])
    if profile_id not in slots:
      slots.append(profile_id)
    index = slots.index(profile_id)
    target = index + delta
    if 0 <= target < len(slots):
      slots[index], slots[target] = slots[target], slots[index]
      self._refresh_lists()

  def _save_preferences(self):
    if not hasattr(self, 'enter_submit'):
      return
    self.settings['enterSubmit'] = self.enter_submit.currentIndex() == 1
    self.settings['persistInputOnRestart'] = self.persist_input.isChecked()
    self.settings['clearInputAfterSubmit'] = self.clear_input.isChecked()
    self.settings['taskCompletionNotification'] = self.notifications.isChecked()
    self.settings['allowPromptRewrite'] = self.rewrite_prompt.isChecked()
    self.settings['alwaysShowRetryButton'] = self.retry_button.isChecked()
    self.settings['theme'] = ('system', 'light', 'dark')[self.theme.currentIndex()]
    model = self.agent_model.currentText().strip()
    self.settings['agentModel'] = '' if model == '自动使用主备默认模型' else model
    self.settings['agentWebSearch'] = self.agent_web_search.isChecked()
    self.settings['agentScrollToBottomAfterSubmit'] = self.agent_scroll.isChecked()
    self.settings['agentMaxToolRounds'] = self.agent_max_rounds.value()
    self.settings['agentMathFormattingPrompt'] = self.agent_math.isChecked()
    saved_routes = self.settings.get('zipDownloadRoutes', [])
    retained_routes = [route for route in saved_routes if route not in self.zip_routes] if isinstance(saved_routes, list) else []
    self.settings['zipDownloadRoutes'] = [route for route, checkbox in self.zip_routes.items() if checkbox.isChecked()] + retained_routes

  def _refresh_connections(self):
    try:
      from agent_connections import status
      value = status()
      self.connection_status.setText('CLI 运行环境：' + ('可用' if value['runtime_ready'] else '未通过检查'))
      for row in value['targets']:
        self.connection_buttons[row['id']].setText(row['message'])
    except (OSError, ValueError):
      self.connection_status.setText('连接状态无法读取。')

  def _change_connection(self, action, target):
    if action == 'disconnect' and QMessageBox.question(self, '确认断开', '断开后会删除本工具管理的接入文件，继续吗？') != QMessageBox.StandardButton.Yes:
      return
    try:
      from agent_connections import change
      change(action, target)
      self._refresh_connections()
    except (OSError, ValueError) as error:
      QMessageBox.warning(self, 'Agent 连接失败', str(error))

  def _save(self):
    if self.fetch_request is not None:
      QMessageBox.information(self, '请求进行中', '模型请求完成后再保存设置。')
      return
    if not self.settings:
      return
    self._capture('images')
    self._capture('responses')
    self._save_preferences()
    try:
      result = save_desktop(self.settings, self.revision)
      self.revision = result['revision']
      self.saved.emit()
      self.accept()
    except (OSError, ValueError) as error:
      self.error_label.setText(str(error))
      QMessageBox.warning(self, '保存失败', str(error))

  def reject(self):
    if self.fetch_request is not None:
      QMessageBox.information(self, '请求进行中', '模型请求完成后才能关闭设置窗口。')
      return
    super().reject()

  def closeEvent(self, event):
    if self.fetch_request is not None:
      QMessageBox.information(self, '请求进行中', '模型请求完成后才能关闭设置窗口。')
      event.ignore()
      return
    super().closeEvent(event)

  def _recover(self):
    if QMessageBox.question(self, '保留旧配置', '将原配置按原样备份，并建立空 Key 的新配置。继续吗？') != QMessageBox.StandardButton.Yes:
      return
    try:
      recover_settings(self.revision)
      self.saved.emit()
      self.accept()
    except (OSError, ValueError) as error:
      QMessageBox.warning(self, '恢复失败', str(error))
