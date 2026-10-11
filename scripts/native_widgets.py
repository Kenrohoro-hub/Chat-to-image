"""原生界面共享的图片卡片和放大预览。"""
from pathlib import Path
from PySide6.QtCore import Qt, QSize, QRectF
from PySide6.QtGui import QColor, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QAbstractButton, QDialog, QVBoxLayout, QPushButton, QTextBrowser
from native_canvas import ImageView


class ImageCard(QAbstractButton):
  def __init__(self, path, title='', subtitle='', parent=None):
    super().__init__(parent)
    self.pixmap = QPixmap(str(path)) if path else QPixmap()
    self.title, self.subtitle = title, subtitle
    self.setCheckable(True)
    self.setMinimumSize(160, 180)
    self.setAccessibleName(title)
    self.setToolTip(title)
    self.setCursor(Qt.CursorShape.PointingHandCursor)

  def sizeHint(self):
    return QSize(280, 250)

  def paintEvent(self, event):
    painter = QPainter(self)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    palette = self.palette()
    border = palette.color(palette.ColorRole.Text) if self.isChecked() else palette.color(palette.ColorRole.Mid)
    painter.setPen(QPen(border, 2 if self.isChecked() else 1))
    painter.setBrush(palette.base())
    painter.drawRoundedRect(QRectF(self.rect()).adjusted(1, 1, -1, -1), 10, 10)
    painter.setPen(palette.color(palette.ColorRole.Text))
    title = self.fontMetrics().elidedText(self.title, Qt.TextElideMode.ElideRight, self.width() - 40)
    painter.drawText(self.rect().adjusted(12, 8, -12, -self.height() + 34), Qt.AlignmentFlag.AlignVCenter, title)
    area = QRectF(10, 39, self.width() - 20, self.height() - 76)
    painter.fillRect(area, palette.alternateBase())
    if not self.pixmap.isNull():
      size = self.pixmap.size().scaled(area.size().toSize(), Qt.AspectRatioMode.KeepAspectRatio)
      dest = QRectF(area.center().x() - size.width() / 2, area.center().y() - size.height() / 2, size.width(), size.height())
      painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
      painter.drawPixmap(dest, self.pixmap, QRectF(self.pixmap.rect()))
    else:
      painter.setPen(palette.color(palette.ColorRole.PlaceholderText))
      painter.drawText(area, Qt.AlignmentFlag.AlignCenter, '暂无预览')
    painter.setPen(palette.color(palette.ColorRole.PlaceholderText))
    subtitle = self.fontMetrics().elidedText(self.subtitle, Qt.TextElideMode.ElideRight, self.width() - 24)
    painter.drawText(self.rect().adjusted(12, self.height() - 31, -12, -7), Qt.AlignmentFlag.AlignVCenter, subtitle)


class MarkdownView(QTextBrowser):
  def __init__(self, text, parent=None):
    super().__init__(parent)
    self.setOpenExternalLinks(True)
    self.setFrameShape(self.Shape.NoFrame)
    self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    self.setStyleSheet('QTextBrowser { background: transparent; border: none; padding: 0; }')
    self.setMarkdown(text)
    self.document().documentLayout().documentSizeChanged.connect(self._fit)

  def _fit(self, *_):
    self.setFixedHeight(max(32, int(self.document().size().height()) + 12))

  def resizeEvent(self, event):
    super().resizeEvent(event)
    self.document().setTextWidth(max(80, self.viewport().width()))
    self._fit()


def image_dialog(parent, path):
  dialog = QDialog(parent)
  dialog.setWindowTitle('放大图片 · ' + Path(path).name)
  dialog.resize(960, 740)
  layout = QVBoxLayout(dialog)
  view = ImageView()
  view.set_image(str(path))
  layout.addWidget(view, 1)
  fit = QPushButton('适应窗口')
  fit.clicked.connect(view.fit_image)
  layout.addWidget(fit)
  dialog.exec()
