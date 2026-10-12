"""本地网页服务器及同源 Codex 配置同步入口。"""

import argparse
import hmac
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
from urllib.parse import urlsplit, parse_qs

from playground_config import config_path, project_id, read_snapshot, save_profile, snapshot_status
from desktop_config import read_desktop, candidates, settings_revision, SettingsConflict
from desktop_host import DesktopApi
from ui_language import system_ui_language, set_request_ui_language, t


class LocalApi(DesktopApi):
  def _check(self):
    # 网页访问边界由 Handler 的同源检查及会话令牌负责。
    if self._closing:
      raise ValueError(t('本机服务正在关闭。', 'The local service is closing.'))


class LocalServer(ThreadingHTTPServer):
  # 停服等待请求退出，确保生图线程清理其临时提示词和图片。
  daemon_threads = False

  def server_close(self):
    if hasattr(self, 'api'):
      self.api._stop()
    super().server_close()


class Handler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(Path(__file__).resolve().parent.parent / 'dist'), **kwargs)

  def setup(self):
    super().setup()
    self.connection.settimeout(10)

  def log_message(self, *args):
    # URL 查询参数可能包含网页导入密钥，不记录访问路径或请求正文。
    pass

  def allowed_host(self):
    return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

  def respond(self, status, data, mime='application/json; charset=utf-8'):
    if not isinstance(data, bytes):
      data = json.dumps(data, ensure_ascii=False).encode('utf-8')
    self.send_response(status)
    self.send_header('Content-Type', mime)
    self.send_header('Content-Length', str(len(data)))
    self.send_header('Cache-Control', 'no-store')
    self.send_header('X-Content-Type-Options', 'nosniff')
    self.send_header('X-Frame-Options', 'DENY')
    self.end_headers()
    if self.command != 'HEAD':
      self.wfile.write(data)

  def list_directory(self, path):
    self.send_error(404)
    return None

  def do_HEAD(self):
    self.do_GET()

  def do_GET(self):
    if not self.allowed_host():
      return self.respond(403, {'error': 'Host rejected'})
    path = urlsplit(self.path).path
    if path == '/__codex/status':
      revision = self.server.sync_revision
      try:
        record = read_desktop()
        if record:
          revision = settings_revision()
          eligible = candidates()
          profile = next((p for p in eligible if p.get('baseUrl') and p.get('model') and p.get('hasKey', True)), {})
          status = {'synced': bool(profile.get('baseUrl') and profile.get('model') and profile.get('hasKey', True)),
            'name': profile.get('name', ''), 'model': profile.get('model', ''),
            'message': t('本机配置已共享，桌面、网页和 Codex 使用同一份设置。', 'Local settings are shared by the desktop app, browser and Codex.')}
        else:
          status = snapshot_status(read_snapshot())
      except (OSError, ValueError):
        status = {'synced': False, 'message': t('同步配置无法读取，请从网页重新同步。', 'Cannot read synchronized settings. Synchronize them again from the browser.')}
      return self.respond(200, {
        'service': 'playground-codex-sync', 'sync_version': 4,
        'project_id': project_id(),
        'sync_revision': revision, **status,
      })
    if path in ('/__codex/session', '/__local/session', '/__codex/bridge.js'):
      # 仅同源网页可读取；此令牌不包含 API 凭据。
      origin = self.headers.get('Origin')
      if origin and origin != 'http://' + self.headers.get('Host', ''):
        return self.respond(403, {'error': 'Origin rejected'})
      if self.headers.get('Sec-Fetch-Site') == 'cross-site':
        return self.respond(403, {'error': 'Site rejected'})
      if path == '/__codex/bridge.js':
        script = Path(__file__).with_name('playground_bridge.js').read_text(encoding='utf-8')
        script = script.replace('__CODEX_SYNC_TOKEN__', self.server.sync_token)
        return self.respond(200, script.encode('utf-8'), 'text/javascript; charset=utf-8')
      return self.respond(200, {'token': self.server.sync_token})
    if path in ('/', '/index.html'):
      index = (Path(self.directory) / 'index.html').read_bytes()
      flags = b'window.__PLAYGROUND_LOCAL__=true;'
      if getattr(self.server, 'desktop', False) and parse_qs(urlsplit(self.path).query).get('desktop') == ['1']:
        flags += b'window.__PLAYGROUND_DESKTOP__=true;'
        flags += ('window.__PLAYGROUND_UI_LANGUAGE__=' + json.dumps(system_ui_language()) + ';').encode('ascii')
      index = index.replace(b'<head>', b'<head><script>' + flags + b'</script>')
      return self.respond(200, index, 'text/html; charset=utf-8')
    if path.startswith(('/__codex/', '/__local/')):
      return self.respond(404, {'error': 'Not found'})
    if self.command == 'HEAD':
      return super().do_HEAD()
    return super().do_GET()

  def do_POST(self):
    if not self.allowed_host() or self.headers.get('Origin') != 'http://' + self.headers.get('Host', ''):
      return self.respond(403, {'error': 'Origin rejected'})
    if not hmac.compare_digest(self.headers.get('X-Codex-Sync', ''), self.server.sync_token):
      return self.respond(403, {'error': 'Sync token rejected'})
    if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
      return self.respond(415, {'error': 'JSON required'})
    path = urlsplit(self.path).path
    if path not in ('/__codex/config', '/__local/api'):
      return self.respond(404, {'error': 'Not found'})
    language = self.headers.get('X-Playground-Language')
    set_request_ui_language(language if language in ('zh-CN', 'en') else system_ui_language())
    try:
      length = int(self.headers.get('Content-Length', '0'))
      if not 0 < length <= (128 * 1024 * 1024 if path == '/__local/api' else 65536) or self.headers.get('Transfer-Encoding'):
        return self.respond(413, {'error': 'Body exceeds limit'})
      value = json.loads(self.rfile.read(length))
      if path == '/__local/api':
        if not isinstance(value, dict) or set(value) != {'method', 'args'} or not isinstance(value['args'], list):
          return self.respond(400, {'error': 'Invalid local API payload'})
        method = value['method']
        counts = {'load_settings': 0, 'recover_settings': 1, 'save_settings': 2, 'status': 0, 'reset_routes': 0,
          'prompt_storage': 2, 'read_youmind_prompts': 1, 'read_heroprompt_posts': 1, 'download_prompt_image': 1, 'list_models': 1, 'generate': 1, 'cancel_generation': 1}
        if not isinstance(method, str) or method not in counts or len(value['args']) != counts[method]:
          return self.respond(400, {'error': 'Invalid local API method'})
        if method not in ('generate', 'prompt_storage') and length > 2 * 1024 * 1024:
          return self.respond(413, {'error': 'Body exceeds limit'})
        if method in ('prompt_storage', 'download_prompt_image', 'read_youmind_prompts', 'read_heroprompt_posts', 'list_models'):
          try:
            return self.respond(200, getattr(self.server.api, method)(*value['args']))
          except ValueError as error:
            return self.respond(400, {'error': str(error)})
        return self.respond(200, getattr(self.server.api, method)(*value['args']))
      if not isinstance(value, dict) or set(value) != {'profile'}:
        return self.respond(400, {'error': 'Invalid config payload'})
      if read_desktop():
        return self.respond(409, {'error': t('请刷新网页，使用本机共享配置入口。', 'Refresh the page to use the local shared settings entry.')})
      status = save_profile(value['profile'])
      self.server.sync_revision = str(time.time_ns())
      return self.respond(200, status)
    except SettingsConflict as error:
      return self.respond(409, {'error': str(error)})
    except (OSError, ValueError, TypeError, KeyError):
      return self.respond(400, {'error': t('配置同步失败，请检查网页设置或本机用户目录。', 'Settings synchronization failed. Check the browser settings or local user directory.')})


def make_server(port):
  config_path().parent.mkdir(parents=True, exist_ok=True)
  server = LocalServer(('127.0.0.1', port), Handler, bind_and_activate=False)
  server.api = LocalApi()
  try:
    if os.name == 'nt':
      # Windows 的地址复用可能让两个实例同时绑定同一端口。
      server.allow_reuse_address = False
      server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    server.server_bind()
    server.server_activate()
  except BaseException:
    server.server_close()
    raise
  server.sync_token = secrets.token_hex(32)
  server.sync_revision = '0'
  return server


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--port', type=int, default=4173)
  parser.add_argument('--control-stdin', action='store_true', help='Accept a stop command from the owning launcher')
  args = parser.parse_args()
  server = make_server(args.port)
  print(f'Chat to image: http://127.0.0.1:{server.server_port}', flush=True)
  print('Local settings are shared with the desktop app and Codex.', flush=True)
  if args.control_stdin:
    def stop_from_launcher():
      # 启动器正常退出后的 EOF 不停服，保留独立后台生命周期。
      if sys.stdin.buffer.readline(64) == b'stop\n':
        server.shutdown()
    threading.Thread(target=stop_from_launcher, daemon=True).start()
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    pass
  finally:
    server.server_close()
