"""一键启动或复用本地服务，打开配置页并等待本次网页同步。"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

from playground_config import local_data_dir, project_id


class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self, req, fp, code, msg, headers, newurl):
    return None


def service_status(origin):
  # 回环探测不经过系统代理，也不跟随重定向到其他服务。
  opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
  try:
    with opener.open(origin + '/__codex/status', timeout=3) as response:
      status = json.loads(response.read(65536))
  except urllib.error.HTTPError:
    raise RuntimeError('端口已被其他服务占用，请检查原服务；脚本不会停止它。') from None
  except urllib.error.URLError as exc:
    if isinstance(exc.reason, ConnectionRefusedError):
      return None
    raise RuntimeError('无法连接本机同步服务，请检查访问地址和端口。') from None
  except (ValueError, TimeoutError, OSError):
    raise RuntimeError('本机端口未返回有效的同步状态，请检查原服务。') from None
  if not isinstance(status, dict) or status.get('service') != 'playground-codex-sync':
    raise RuntimeError('端口上的服务不是 Chat to image 配置同步服务。')
  if status.get('sync_version') != 4:
    raise RuntimeError('检测到旧版服务。请先关闭旧启动窗口，再运行本脚本；此次升级仅需重启一次。')
  if status.get('project_id') != project_id():
    raise RuntimeError('端口属于另一个 Chat to image 项目，请使用它的启动入口或指定其他端口。')
  return status


def ensure_service(root, origin, port):
  status = service_status(origin)
  if status is not None:
    return status, None
  log_path = local_data_dir() / 'service.log'
  log_path.parent.mkdir(parents=True, exist_ok=True)
  with log_path.open('ab') as log:
    process = subprocess.Popen(
      [sys.executable, '-B', str(root / 'scripts' / 'serve_app.py'), '--port', str(port), '--control-stdin'],
      cwd=root, stdin=subprocess.PIPE, stdout=log, stderr=log,
      creationflags=subprocess.CREATE_NO_WINDOW,
    )
  try:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
      status = service_status(origin)
      if status is not None:
        return status, process if process.poll() is None else None
      if process.poll() is not None:
        break
      time.sleep(0.25)
    raise RuntimeError(f'服务启动失败，请查看日志：{log_path}')
  except BaseException:
    stop_service(process)
    raise


def stop_service(process):
  try:
    if process.poll() is not None:
      return
    process.stdin.write(b'stop\n')
    process.stdin.flush()
    process.wait(timeout=15)
  except (OSError, ValueError, subprocess.TimeoutExpired):
    if process.poll() is None:
      raise RuntimeError('服务停止尚未完成，请查看本机用户目录中的 service.log；未强制终止父进程，以便它继续清理所属任务。') from None
  finally:
    try:
      process.stdin.close()
    except OSError:
      pass


def wait_sync(origin, timeout):
  deadline = time.monotonic() + timeout
  message = ''
  while time.monotonic() < deadline:
    status = service_status(origin)
    if status is None:
      raise RuntimeError('同步服务已停止，请重新运行启动脚本。')
    if status.get('synced'):
      return status
    current = status.get('message', '')
    if not status.get('synced') and current != message:
      print(current, flush=True)
      message = current
    time.sleep(1)
  raise RuntimeError('等待本次网页同步超时。请在原浏览器打开上方网址；新设备需先在设置中导入或填写 API 配置。服务仍可使用，完成后重新运行本脚本。')


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--host', choices=('127.0.0.1', 'localhost'), default='127.0.0.1')
  parser.add_argument('--port', type=int, default=4173)
  parser.add_argument('--timeout', type=int, default=180)
  parser.add_argument('--stay-open', action='store_true', help='同步后保持启动窗口，Ctrl+C 停止本窗口启动的服务')
  parser.add_argument('--no-browser', action='store_true', help='不自动打开浏览器，手动打开显示的网址')
  parser.add_argument('--no-register-path', action='store_true', help='不更新当前用户的项目定位变量')
  args = parser.parse_args()
  if os.name != 'nt' or sys.version_info < (3, 10):
    parser.error('需要 Windows 和 Python 3.10 或更新版本。')
  if not 1 <= args.port <= 65535 or not 1 <= args.timeout <= 3600:
    parser.error('端口需在 1–65535，等待时间需在 1–3600 秒。')
  root = Path(__file__).resolve().parent.parent
  if not (root / 'dist' / 'index.html').is_file():
    raise RuntimeError('缺少 dist/index.html，请复制完整项目后重试。')
  origin = f'http://{args.host}:{args.port}'
  status, process = ensure_service(root, origin, args.port)
  if not args.no_register_path:
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Environment', 0, winreg.KEY_SET_VALUE) as key:
      winreg.SetValueEx(key, 'PLAYGROUND_PROJECT_ROOT', 0, winreg.REG_SZ, str(root))
    print('已登记当前设备的项目位置。', flush=True)
  print('本地服务已启动。' if process else '已复用本项目的本地服务。', flush=True)
  print(f'配置页面：{origin}/', flush=True)
  print('桌面、网页和 Codex 共用本机配置；新电脑请在设置中填写 API 并保存。', flush=True)
  try:
    if not args.no_browser:
      if not webbrowser.open(origin + '/?codex-sync=' + str(time.time_ns()), new=2):
        print('浏览器未能自动打开，请手动打开上方网址。', flush=True)
    synced = wait_sync(origin, args.timeout)
    print(f"同步成功：{synced.get('name', '')} / {synced.get('model', '')}。Codex 可直接生图。", flush=True)
    if args.stay_open:
      print('网页更换 API 后会自动同步。按 Ctrl+C 退出；仅停止本窗口启动的服务。', flush=True)
      while True:
        if process and process.poll() is not None:
          raise RuntimeError('本窗口启动的服务已退出，请查看本机用户目录中的 service.log。')
        time.sleep(1)
    else:
      print('同步完成，服务继续在后台运行；关闭此窗口不影响网页同步。', flush=True)
  except KeyboardInterrupt:
    if process and process.poll() is None:
      stop_service(process)
      print('\n已停止本窗口启动的服务。', flush=True)
    else:
      print('\n已退出；复用的服务继续运行。', flush=True)


if __name__ == '__main__':
  sys.stdout.reconfigure(encoding='utf-8')
  try:
    main()
  except (OSError, RuntimeError) as exc:
    print(f'未完成同步：{exc}', flush=True)
    sys.exit(1)
