"""无控制台启动器；使用专用运行环境和原生错误提示。"""
import importlib.util
import ctypes
from pathlib import Path
import subprocess
import sys


def launch():
  if sys.version_info < (3, 10):
    raise RuntimeError('请先安装 Python 3.10 或更新版本。')
  from playground_config import local_data_dir, project_id
  runtime = local_data_dir() / 'desktop-runtime'
  if Path(sys.prefix).resolve() != runtime.resolve():
    python = runtime / 'Scripts' / 'python.exe'
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    mutex = kernel.CreateMutexW(None, False, 'Local\\PlaygroundStartup-' + project_id())
    if not mutex:
      raise RuntimeError('无法创建桌面初始化锁。')
    acquired = False
    try:
      acquired = kernel.WaitForSingleObject(mutex, 60000) in (0, 128)
      if not acquired:
        raise RuntimeError('桌面组件正在准备，请稍后重新打开。')
      if not python.exists():
        process = subprocess.run([sys._base_executable, '-m', 'venv', str(runtime)], stdin=subprocess.DEVNULL,
          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        if process.returncode:
          raise RuntimeError('无法建立桌面运行环境，请确认 Python 支持 venv 和 pip。')
      result = subprocess.run([str(python), '-B', '-c', 'import webview'], stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
      if result.returncode:
        result = subprocess.run([str(python), '-m', 'pip', 'install', '--prefer-binary',
          '-r', str(Path(__file__).resolve().parent.parent / 'requirements-desktop.txt')], stdin=subprocess.DEVNULL,
          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
          raise RuntimeError('桌面组件安装未完成，请检查网络后重新启动。')
    finally:
      if acquired:
        kernel.ReleaseMutex(mutex)
      kernel.CloseHandle(mutex)
    result = subprocess.run([str(python.with_name('pythonw.exe')), '-B', str(Path(__file__).resolve()), *sys.argv[1:]],
      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
      raise RuntimeError('桌面运行环境启动失败，请重新打开工具。')
    return
  if importlib.util.find_spec('webview') is None:
    raise RuntimeError('桌面组件缺失，请重新启动以安装。')
  from desktop_host import main
  main()


if __name__ == '__main__':
  try:
    launch()
  except Exception as error:
    ctypes.windll.user32.MessageBoxW(None, str(error), 'Chat to image 启动失败', 0x10)
    raise SystemExit(1)
