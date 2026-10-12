"""无控制台启动器；使用专用运行环境和原生错误提示。"""
import importlib.util
import ctypes
from pathlib import Path
import subprocess
import sys



def launch():
  from ui_language import t
  if sys.version_info < (3, 10):
    raise RuntimeError(t('请先安装 Python 3.10 或更新版本。', 'Install Python 3.10 or later first.'))
  from playground_config import local_data_dir, project_id
  bundled = Path(__file__).resolve().parent.parent / 'runtime'
  runtime = bundled if (bundled / 'pythonw.exe').is_file() else local_data_dir() / 'desktop-runtime'
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
      raise RuntimeError(t('无法创建桌面初始化锁。', 'Could not create the desktop startup lock.'))
    acquired = False
    try:
      acquired = kernel.WaitForSingleObject(mutex, 60000) in (0, 128)
      if not acquired:
        raise RuntimeError(t('桌面组件正在准备，请稍后重新打开。', 'Desktop components are being prepared. Please reopen the app shortly.'))
      if not python.exists():
        process = subprocess.run([sys._base_executable, '-m', 'venv', str(runtime)], stdin=subprocess.DEVNULL,
          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        if process.returncode:
          raise RuntimeError(t('无法建立桌面运行环境，请确认 Python 支持 venv 和 pip。', 'Could not create the desktop environment. Make sure Python includes venv and pip.'))
      result = subprocess.run([str(python), '-B', '-c', 'import webview'], stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
      if result.returncode:
        result = subprocess.run([str(python), '-m', 'pip', 'install', '--prefer-binary',
          '-r', str(Path(__file__).resolve().parent.parent / 'requirements-desktop.txt')], stdin=subprocess.DEVNULL,
          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
          raise RuntimeError(t('桌面组件安装未完成，请检查网络后重新启动。', 'Desktop component installation did not finish. Check your network and restart the app.'))
    finally:
      if acquired:
        kernel.ReleaseMutex(mutex)
      kernel.CloseHandle(mutex)
    result = subprocess.run([str(python.with_name('pythonw.exe')), '-B', str(Path(__file__).resolve()), *sys.argv[1:]],
      stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
      raise RuntimeError(t('桌面运行环境启动失败，请重新打开工具。', 'Could not start the desktop environment. Please reopen the app.'))
    return
  if importlib.util.find_spec('webview') is None:
    raise RuntimeError(t('桌面组件缺失，请重新启动以安装。', 'Desktop components are missing. Restart the app to install them.'))
  from desktop_host import main
  main()


if __name__ == '__main__':
  from ui_language import t
  try:
    launch()
  except Exception as error:
    ctypes.windll.user32.MessageBoxW(None, str(error), t('Chat to image 启动失败', 'Chat to image failed to start'), 0x10)
    raise SystemExit(1)
