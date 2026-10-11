"""Qt 测试共用应用对象，并在 Python 清理模块前释放原生对象。"""
import atexit
from PySide6.QtCore import QCoreApplication, QEvent
from PySide6.QtWidgets import QApplication

app = QApplication.instance() or QApplication([])

def dispose(widget):
  widget.close()
  widget.deleteLater()
  QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)

def _shutdown():
  for widget in app.topLevelWidgets(): widget.deleteLater()
  QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
  app.shutdown()

atexit.register(_shutdown)
