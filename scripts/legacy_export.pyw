"""保留旧导出入口名称，打开与正式桌面相同的 WebView 历史。"""
import ctypes
from pathlib import Path
import subprocess
import sys


def main():
  if '--child' in sys.argv:
    from desktop_host import main as open_legacy
    open_legacy()
    return
  from playground_config import local_data_dir
  python = local_data_dir() / 'desktop-runtime' / 'Scripts' / 'pythonw.exe'
  if not python.is_file():
    raise ValueError('本机还没有桌面运行环境，请先运行 run-app.cmd。浏览器历史请从 run-sync.cmd 导出；其他电脑的桌面历史请在原电脑导出 ZIP。')
  result = subprocess.run([str(python), '-B', str(Path(__file__).resolve()), '--child'],
    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
  if result.returncode:
    raise ValueError('旧桌面导出入口未能启动，请检查原 WebView2 运行环境与 dist 构建。旧数据未改动。')


if __name__ == '__main__':
  try: main()
  except Exception as exc: ctypes.windll.user32.MessageBoxW(None, str(exc), '旧版数据导出', 0x10)
