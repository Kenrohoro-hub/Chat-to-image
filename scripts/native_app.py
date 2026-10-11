"""Chat to image 原生 Windows 桌面入口；不启动网页服务。"""
import argparse
from pathlib import Path
import sys

from PySide6.QtCore import Qt, QTimer, QLockFile
from PySide6.QtGui import QColor, QFont, QPalette, QPixmap, QIcon, QPainter
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, QListWidget, QPushButton, QLabel, QStackedWidget, QFileDialog, QMessageBox, QDialog, QCheckBox, QDialogButtonBox, QSystemTrayIcon

from desktop_config import settings_snapshot
from native_store import Store
from native_images import ImageService
from native_gallery import WorkThread
from native_creation import CreationPage
from native_library import LibraryPage
from native_settings import SettingsDialog
from native_prompts import PromptPage


class MainWindow(QMainWindow):
  def __init__(self, store=None):
    super().__init__()
    self.store = store or Store()
    self.service = ImageService(self.store)
    self.jobs = []
    self.closing = False
    self.setWindowTitle('Chat to image')
    self.resize(1380, 920)
    self.setMinimumSize(980, 680)
    for task in self.store.list_records('tasks'):
      if task.get('status') == 'running':
        task.update({'status': 'error', 'error': '上次运行中断。已保存图片保留，请核对服务商记录后再决定是否重试。'})
        self.store.put_record('tasks', task)
    root = QWidget()
    layout = QHBoxLayout(root)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(0)
    sidebar = QWidget()
    sidebar.setObjectName('sidebar')
    sidebar.setFixedWidth(224)
    side = QVBoxLayout(sidebar)
    side.setContentsMargins(14, 24, 14, 16)
    brand = QLabel('Ⓒ  Chat to image')
    brand.setObjectName('brand')
    side.addWidget(brand)
    subtitle = QLabel('       你的图像工作室')
    subtitle.setObjectName('muted')
    side.addWidget(subtitle)
    side.addSpacing(26)
    self.navigation = QListWidget()
    self.navigation.setObjectName('navigation')
    self.navigation.addItems(['＋   创作', '◷   生成历史', '▤   提示词库', '☆   我的收藏'])
    self.navigation.setFixedHeight(196)
    side.addWidget(self.navigation)
    self.creation = CreationPage(self.store, self.service.generate)
    self.conversation = self.creation
    self.history = LibraryPage(self.store)
    self.prompts = PromptPage(self.store)
    side.addWidget(self.creation.sessions, 1)
    self.sidebar_note = QLabel('从想法，到画面。\n\n先讨论，再生成。\n选择一张作品，继续修改。')
    self.sidebar_note.setObjectName('muted')
    self.sidebar_note.setAlignment(Qt.AlignmentFlag.AlignTop)
    side.addWidget(self.sidebar_note, 1)
    settings = QPushButton('☼  设置与 API')
    settings.setObjectName('textButton')
    settings.clicked.connect(self.open_settings)
    side.addWidget(settings)
    layout.addWidget(sidebar)
    main = QWidget()
    content = QVBoxLayout(main)
    content.setContentsMargins(0, 0, 0, 0)
    header = QWidget()
    header.setObjectName('header')
    header_layout = QHBoxLayout(header)
    header_layout.setContentsMargins(18, 12, 18, 12)
    header_title = QLabel('Chat to image')
    header_title.setObjectName('sectionTitle')
    header_layout.addWidget(header_title)
    history_button = QPushButton('◷')
    history_button.setToolTip('全部对话')
    history_button.clicked.connect(lambda: self.navigation.setCurrentRow(0))
    header_layout.addWidget(history_button)
    new_button = QPushButton('✎')
    new_button.setToolTip('新建对话')
    new_button.clicked.connect(self.new_conversation)
    header_layout.addWidget(new_button)
    header_layout.addStretch()
    export = QPushButton('↓')
    export.setToolTip('导出作品备份')
    export.clicked.connect(self.export_backup)
    header_layout.addWidget(export)
    help_button = QPushButton('？')
    help_button.setToolTip('功能介绍')
    help_button.clicked.connect(self.show_welcome)
    header_layout.addWidget(help_button)
    content.addWidget(header)
    self.pages = QStackedWidget()
    for page in (self.creation, self.history, self.prompts): self.pages.addWidget(page)
    content.addWidget(self.pages, 1)
    layout.addWidget(main, 1)
    self.setCentralWidget(root)
    self.navigation.currentRowChanged.connect(self.switch_page)
    self.navigation.setCurrentRow(0)
    self.history.reuse.connect(self.use_prompt)
    self.history.editRequested.connect(self.edit_image)
    self.history.openConversation.connect(self.open_conversation)
    self.prompts.usePrompt.connect(self.use_prompt)
    self.creation.promptsRequested.connect(lambda: self.navigation.setCurrentRow(2))
    self.creation.savePromptRequested.connect(self.save_prompt)
    self.creation.historyRequested.connect(lambda: self.navigation.setCurrentRow(1))
    self.tray = QSystemTrayIcon(self)
    icon = QPixmap(32, 32)
    icon.fill(QColor('#356c58'))
    painter = QPainter(icon)
    painter.setPen(Qt.GlobalColor.white)
    painter.drawText(icon.rect(), Qt.AlignmentFlag.AlignCenter, '画')
    painter.end()
    self.tray.setIcon(QIcon(icon))
    if hasattr(self.conversation, 'taskFinished'): self.conversation.taskFinished.connect(self.notify_task)
    self.statusBar().showMessage('就绪')
    self.draft_timer = QTimer(self)
    self.draft_timer.setInterval(3000)
    self.draft_timer.timeout.connect(self.save_draft)
    self.draft_timer.start()
    self.close_timer = QTimer(self)
    self.close_timer.setInterval(150)
    self.close_timer.timeout.connect(self.close)
    self.apply_theme()

  def switch_page(self, index):
    self.creation.sessions.setVisible(index == 0)
    self.sidebar_note.setVisible(index != 0)
    if index in (1, 3):
      self.history.set_mode('favorites' if index == 3 else 'history')
      self.pages.setCurrentWidget(self.history)
    else:
      self.pages.setCurrentWidget(self.creation if index == 0 else self.prompts)
    if index == 2: self.save_draft()
    if index == 0: self.creation.refresh_results()

  def new_conversation(self):
    self.navigation.setCurrentRow(0)
    self.creation.new_conversation()

  def open_conversation(self, conversation_id):
    if self.creation.is_busy(): return
    self.navigation.setCurrentRow(0)
    self.creation.current_id = conversation_id
    self.creation.refresh_history()

  def edit_image(self, value):
    self.navigation.setCurrentRow(0)
    self.creation.edit_image(value)

  def save_prompt(self, value):
    self.navigation.setCurrentRow(2)
    self.prompts.save_draft(value)

  def apply_theme(self):
    settings = settings_snapshot().get('settings') or {}
    theme = settings.get('theme', 'system')
    dark = theme == 'dark' or (theme == 'system' and QApplication.styleHints().colorScheme() == Qt.ColorScheme.Dark)
    palette = QPalette()
    background, panel, foreground, border, selection = ('#202020', '#292929', '#e8e8e6', '#414141', '#444442') if dark else ('#faf9f6', '#f0efeb', '#222320', '#deddd8', '#d3d2cd')
    palette.setColor(QPalette.ColorRole.Window, QColor(background))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(foreground))
    palette.setColor(QPalette.ColorRole.Base, QColor(background))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(panel))
    palette.setColor(QPalette.ColorRole.Text, QColor(foreground))
    palette.setColor(QPalette.ColorRole.Mid, QColor(border))
    palette.setColor(QPalette.ColorRole.PlaceholderText, QColor('#969696' if dark else '#858783'))
    palette.setColor(QPalette.ColorRole.Button, QColor(panel))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(foreground))
    palette.setColor(QPalette.ColorRole.Highlight, QColor(selection))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor(foreground))
    QApplication.instance().setPalette(palette)
    self.setStyleSheet(f'''
      QWidget {{ font-family: "Microsoft YaHei UI"; font-size: 12px; }}
      QWidget#sidebar {{ background: {panel}; border-right: 1px solid {border}; }}
      QWidget#header {{ border-bottom: 1px solid {border}; }}
      QLabel#brand {{ font-size: 16px; font-weight: 600; }}
      QLabel#pageTitle {{ font-size: 22px; font-weight: 600; padding: 8px 0; }}
      QLabel#sectionTitle {{ font-size: 15px; font-weight: 600; }}
      QLabel#muted {{ color: {'#aaaaa6' if dark else '#818580'}; }}
      QFrame#panel, QFrame#card, QFrame#composer {{ background: {background}; border: 1px solid {border}; border-radius: 12px; }}
      QFrame#resultsPanel, QFrame#userMessage {{ background: {panel}; border: 1px solid {border}; border-radius: 12px; }}
      QFrame#assistantMessage {{ background: transparent; border: none; }}
      QListWidget#navigation {{ background: transparent; border: none; outline: none; }}
      QListWidget#navigation::item {{ padding: 13px 10px; border-radius: 7px; margin-bottom: 4px; }}
      QListWidget#navigation::item:selected {{ background: {selection}; color: {foreground}; }}
      QListWidget#sessions {{ background: transparent; border: none; }}
      QListWidget#sessions::item {{ padding: 12px 8px; border: 1px solid {border}; border-radius: 7px; margin-bottom: 6px; }}
      QListWidget#sessions::item:selected {{ background: {background}; border-left: 3px solid #798d85; color: {foreground}; }}
      QPushButton {{ padding: 7px 8px; border: 1px solid {border}; border-radius: 6px; background: {background}; }}
      QPushButton:hover, QPushButton:checked {{ background: {selection}; }}
      QPushButton:disabled {{ color: #8c9290; }}
      QPushButton#primary {{ background: {'#e2e2df' if dark else '#292b28'}; color: {'#222320' if dark else '#ffffff'}; font-weight: 600; }}
      QPushButton#textButton {{ border: none; background: transparent; text-align: left; }}
      QPushButton#messageAction {{ border: none; background: transparent; padding: 3px 6px; color: {'#aaaaa6' if dark else '#818580'}; }}
      QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QSpinBox {{ padding: 6px; border: 1px solid {border}; border-radius: 6px; background: {background}; selection-background-color: {selection}; }}
      QTextEdit#composerInput {{ border: none; background: transparent; }}
      QListWidget {{ border: 1px solid {border}; border-radius: 6px; }}
      QScrollArea {{ border: none; background: transparent; }}
      QSplitter::handle {{ background: {background}; width: 12px; }}
      QScrollBar:vertical {{ width: 8px; background: transparent; }}
      QScrollBar::handle:vertical {{ background: {border}; border-radius: 4px; min-height: 30px; }}
      QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    ''')

  def notify_task(self, success, message):
    settings = settings_snapshot().get('settings') or {}
    if settings.get('taskCompletionNotification') and QSystemTrayIcon.isSystemTrayAvailable():
      self.tray.show()
      self.tray.showMessage('Chat to image · ' + ('完成' if success else '任务提醒'), message[:240], QSystemTrayIcon.MessageIcon.Information, 6000)

  def save_draft(self):
    try:
      self.creation._save_draft()
      self.store.set_meta('creationDraft', {'prompt': self.creation.prompt.toPlainText(), 'params': self.creation.image_params, 'imageIds': self.creation.attachments[:], 'maskImageId': self.creation.draft_mask_id} if self.creation._settings_or_empty().get('persistInputOnRestart', True) else {})
    except (OSError, ValueError) as exc: self.statusBar().showMessage('草稿保存失败：' + str(exc))

  def use_prompt(self, value):
    self.creation.use_prompt(value)
    self.navigation.setCurrentRow(0)

  def open_settings(self):
    dialog = SettingsDialog(self)
    dialog.saved.connect(self.apply_theme)
    dialog.saved.connect(self.conversation.refresh)
    dialog.importBackupRequested.connect(self.import_backup)
    dialog.exportBackupRequested.connect(self.export_backup)
    dialog.featureIntroRequested.connect(self.show_welcome)
    dialog.exec()

  def run_job(self, operation, completed):
    worker = WorkThread(lambda _: operation(), self)
    self.jobs.append(worker)
    worker.completed.connect(completed)
    worker.failed.connect(lambda error: QMessageBox.warning(self, '操作失败', error))
    worker.finished.connect(lambda: self.jobs.remove(worker))
    worker.start()

  def import_backup(self):
    if self.jobs:
      QMessageBox.information(self, '正在处理', '请等待当前备份操作完成。')
      return
    path, _ = QFileDialog.getOpenFileName(self, '导入备份', '', '作品备份 (*.zip)')
    if not path: return
    if QMessageBox.question(self, '导入备份', '导入作品、对话、收藏和个人提示词；不覆盖同标识冲突记录，不导入明文 API 密钥。原备份保留。继续？') != QMessageBox.StandardButton.Yes: return
    self.statusBar().showMessage('正在检查并导入备份……')
    self.run_job(lambda: self.store.import_zip(path), self.imported)

  def imported(self, result):
    self.history.reload_collections()
    self.history.refresh()
    self.prompts.import_personal(self.store.list_records('prompts'))
    if hasattr(self.conversation, 'refresh'): self.conversation.refresh()
    self.statusBar().showMessage(f'已导入 {result["records"]} 条记录与 {result["images"]} 张图片。配置继续使用本机加密设置。')

  def export_backup(self):
    if self.jobs:
      QMessageBox.information(self, '正在处理', '请等待当前备份操作完成。')
      return
    path, _ = QFileDialog.getSaveFileName(self, '导出作品备份', 'Chat-to-image-backup.zip', '作品备份 (*.zip)')
    if path:
      self.statusBar().showMessage('正在导出作品备份……')
      self.run_job(lambda: self.store.export_zip(path, self.prompts.export_personal()), lambda result: self.statusBar().showMessage(f'备份已保存：{result["tasks"]} 条作品、{result["images"]} 张图片。'))

  def show_welcome(self):
    dialog = QDialog(self)
    dialog.setWindowTitle('欢迎使用 Chat to image')
    dialog.resize(600, 420)
    layout = QVBoxLayout(dialog)
    title = QLabel('用描述和对话创作图片')
    title.setObjectName('pageTitle')
    layout.addWidget(title)
    body = QLabel('1. 在“设置与 API”填写 Images 图像服务；对话创作另需 Responses 服务。\n\n2. 在创作中讨论画面，点击直接生成或发送；选中右侧图片可以继续修改、编辑蒙版或比较多轮结果。\n\n3. 在生成历史与我的收藏中查找作品、保存图片或继续编辑。提示词库可浏览、收藏并填入草稿。\n\n已有旧版数据时，先在旧版导出作品 ZIP，再从设置的数据管理导入；旧数据不会自动删除。')
    body.setWordWrap(True)
    layout.addWidget(body, 1)
    hidden = QCheckBox('不再自动显示此介绍')
    hidden.setChecked(self.store.get_meta('welcomeHidden', False))
    layout.addWidget(hidden)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok)
    buttons.button(QDialogButtonBox.StandardButton.Ok).setText('开始创作')
    buttons.accepted.connect(dialog.accept)
    layout.addWidget(buttons)
    if dialog.exec() == QDialog.DialogCode.Accepted: self.store.set_meta('welcomeHidden', hidden.isChecked())

  def closeEvent(self, event):
    if not self.closing:
      self.save_draft()
      self.closing = True
      self.service.close()
      self.draft_timer.stop()
      self.setEnabled(False)
      self.statusBar().showMessage('正在停止当前任务并保存数据……')
    conversation_done = self.conversation.shutdown()
    prompts_done = self.prompts.shutdown()
    if self.jobs or not all((conversation_done, prompts_done)):
      event.ignore()
      self.close_timer.start()
      return
    self.close_timer.stop()
    event.accept()


def main(argv=None):
  parser = argparse.ArgumentParser(description='Chat to image 原生桌面')
  parser.add_argument('--data-dir', help='指定独立原生作品数据目录')
  args = parser.parse_args(argv)
  app = QApplication.instance() or QApplication(sys.argv[:1])
  app.setApplicationName('Chat to image')
  app.setStyle('Fusion')
  app.setFont(QFont('Microsoft YaHei UI', 10))
  store = Store(args.data_dir)
  lock = QLockFile(str(store.root / 'native-app.lock'))
  lock.setStaleLockTime(0)
  if not lock.tryLock(0):
    QMessageBox.information(None, 'Chat to image', '此数据目录的桌面窗口已打开，请从任务栏切换。')
    return 0
  window = MainWindow(store)
  window.show()
  if not store.get_meta('welcomeHidden', False): QTimer.singleShot(100, window.show_welcome)
  result = app.exec()
  lock.unlock()
  return result


if __name__ == '__main__': sys.exit(main())
