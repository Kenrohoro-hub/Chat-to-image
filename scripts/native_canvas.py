"""原生图片查看与蒙版画布。"""
from PySide6.QtCore import Qt, QPointF
from PySide6.QtGui import QImage, QPainter, QPen, QPixmap, QColor
from PySide6.QtWidgets import QDialog, QVBoxLayout, QHBoxLayout, QPushButton, QGraphicsView, QGraphicsScene, QSpinBox, QLabel, QDialogButtonBox


class ImageView(QGraphicsView):
  def __init__(self, parent=None):
    super().__init__(parent)
    self.setScene(QGraphicsScene(self))
    self.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
    self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag)
    self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
    self.setMinimumSize(240, 200)
    self.item = None

  def set_image(self, path):
    pixmap = QPixmap(str(path))
    if pixmap.isNull(): raise ValueError('图片无法解码。')
    self.scene().clear()
    self.item = self.scene().addPixmap(pixmap)
    self.scene().setSceneRect(self.item.boundingRect())
    self.fit_image()

  def fit_image(self):
    if self.item: self.fitInView(self.item, Qt.AspectRatioMode.KeepAspectRatio)

  def wheelEvent(self, event):
    factor = 1.2 if event.angleDelta().y() > 0 else 1 / 1.2
    if .01 < self.transform().m11() * factor < 30: self.scale(factor, factor)
    event.accept()

  def showEvent(self, event):
    super().showEvent(event)
    self.fit_image()


class MaskView(ImageView):
  def __init__(self, path, parent=None):
    super().__init__(parent)
    self.set_image(path)
    self.mask = QImage(self.item.pixmap().size(), QImage.Format.Format_ARGB32)
    self.mask.fill(Qt.GlobalColor.white)
    self.overlay = QImage(self.mask.size(), QImage.Format.Format_ARGB32)
    self.overlay.fill(Qt.GlobalColor.transparent)
    self.overlay_item = self.scene().addPixmap(QPixmap.fromImage(self.overlay))
    self.brush = 60
    self.previous = None
    self.history = []
    self.setDragMode(QGraphicsView.DragMode.NoDrag)

  def mousePressEvent(self, event):
    if event.button() != Qt.MouseButton.LeftButton: return super().mousePressEvent(event)
    self.history.append((self.mask.copy(), self.overlay.copy()))
    self.history = self.history[-5:]
    self.previous = self.mapToScene(event.position().toPoint())
    self.paint_to(self.previous)

  def mouseMoveEvent(self, event):
    if self.previous is not None:
      self.paint_to(self.mapToScene(event.position().toPoint()))
    else: super().mouseMoveEvent(event)

  def mouseReleaseEvent(self, event):
    self.previous = None
    super().mouseReleaseEvent(event)

  def paint_to(self, point):
    for image, color, mode in [(self.mask, Qt.GlobalColor.transparent, QPainter.CompositionMode.CompositionMode_Clear), (self.overlay, QColor(230, 80, 70, 130), QPainter.CompositionMode.CompositionMode_Source)]:
      painter = QPainter(image)
      painter.setRenderHint(QPainter.RenderHint.Antialiasing)
      painter.setCompositionMode(mode)
      painter.setPen(QPen(color, self.brush, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
      painter.drawLine(self.previous, point)
      painter.end()
    self.previous = point
    self.overlay_item.setPixmap(QPixmap.fromImage(self.overlay))

  def undo(self):
    if self.history:
      self.mask, self.overlay = self.history.pop()
      self.overlay_item.setPixmap(QPixmap.fromImage(self.overlay))

  def clear(self):
    self.history.append((self.mask.copy(), self.overlay.copy()))
    self.history = self.history[-5:]
    self.mask.fill(Qt.GlobalColor.white)
    self.overlay.fill(Qt.GlobalColor.transparent)
    self.overlay_item.setPixmap(QPixmap.fromImage(self.overlay))


class MaskDialog(QDialog):
  def __init__(self, path, parent=None):
    super().__init__(parent)
    self.setWindowTitle('局部修改 · 涂抹需要修改的区域')
    self.resize(1000, 760)
    layout = QVBoxLayout(self)
    layout.addWidget(QLabel('红色区域将交给模型修改；其余区域保留。滚轮缩放画布。'))
    self.view = MaskView(path)
    layout.addWidget(self.view, 1)
    tools = QHBoxLayout()
    tools.addWidget(QLabel('画笔大小'))
    size = QSpinBox()
    size.setRange(5, 500)
    size.setValue(60)
    size.valueChanged.connect(lambda value: setattr(self.view, 'brush', value))
    tools.addWidget(size)
    for label, callback in [('撤销', self.view.undo), ('清空涂抹', self.view.clear), ('适应窗口', self.view.fit_image)]:
      button = QPushButton(label)
      button.clicked.connect(callback)
      tools.addWidget(button)
    tools.addStretch()
    layout.addLayout(tools)
    buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
    buttons.button(QDialogButtonBox.StandardButton.Ok).setText('使用蒙版')
    buttons.button(QDialogButtonBox.StandardButton.Cancel).setText('取消')
    buttons.accepted.connect(self.accept)
    buttons.rejected.connect(self.reject)
    layout.addWidget(buttons)
