"""桌面窗口及其专属服务；独立 Codex 命令行进程不受窗口生命周期影响。"""

import base64
import ctypes
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error
from urllib.parse import urlsplit, parse_qsl

from desktop_config import initial_settings, save_desktop, route_state, write_json, route_lock, normalize_url, settings_snapshot, settings_revision, recover_settings
from playground_config import local_data_dir, project_id


class DesktopApi:
  def __init__(self):
    self._window = None
    self._origin = ''
    self._processes = set()
    self._requests = {}
    self._cancelled = set()
    self._queued = set()
    self._image_slots = threading.BoundedSemaphore(2)
    self._lock = threading.Lock()
    self._closing = False

  def _check(self):
    url = urlsplit(self._window.get_current_url() or '')
    if f'{url.scheme}://{url.netloc}' != self._origin or self._closing:
      raise ValueError('当前页面不能访问桌面设置。')

  def load_settings(self):
    self._check()
    return settings_snapshot()

  def recover_settings(self, revision):
    self._check()
    return recover_settings(revision)

  def save_settings(self, settings, revision):
    self._check()
    if not isinstance(revision, str):
      raise ValueError('缺少配置版本，请重新加载设置。')
    return save_desktop(settings, revision)

  def prompt_storage(self, action, payload):
    self._check()
    from prompt_storage import dispatch
    try:
      return dispatch(action, payload)
    except OSError:
      raise ValueError('提示词文件读写失败，请检查目录是否可用、权限和磁盘空间；原保存位置未自动更换。') from None

  def choose_prompt_directory(self):
    self._check()
    if not self._window:
      raise ValueError('请选择桌面窗口中的目录按钮，或手动填写路径。')
    import webview
    paths = self._window.create_file_dialog(webview.FOLDER_DIALOG)
    return str(paths[0]) if paths else None

  def download_prompt_image(self, url):
    self._check()
    prefixes = ('https://r2.qqsrc.com/images/', 'https://cms-assets.youmind.com/media/',
      'https://cdn.youmindassets.com/gen-images/', 'https://s3.bmp.ovh/imgs/',
      'https://s41.ax1x.com/', 'https://img.wjwj.top/',
      'https://banana-prompt.nanoprompts.org/', 'https://turing-img.animelook.top/pic/',
      'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/')
    if not isinstance(url, str) or '..' in url:
      raise ValueError('只允许读取已接入提示词库的预览图地址。')
    parsed = urlsplit(url)
    params = parse_qsl(parsed.query, keep_blank_values=True)
    twitter = bool(re.fullmatch(r'https://pbs\.twimg\.com/media/[A-Za-z0-9_-]+(?:\.(?:jpg|png|webp))?(?:\?[a-z0-9=&]+)?', url)) and (not parsed.query or (len(params) == 2 and dict(params).get('format') in ('jpg', 'png', 'webp') and dict(params).get('name') in ('orig', 'large', 'medium', 'small')))
    if not twitter and (not url.startswith(prefixes) or not re.fullmatch(r'https://[A-Za-z0-9.-]+/[A-Za-z0-9_./-]+', url)):
      raise ValueError('只允许读取已接入提示词库的预览图地址。')
    from playground_image import NoRedirect
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*'})
    try:
      with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        content_type = response.headers.get_content_type()
        if content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'):
          raise ValueError('预览图响应不是支持的图片格式。')
        raw = response.read(32 * 1024 * 1024 + 1)
      if not raw or len(raw) > 32 * 1024 * 1024:
        raise ValueError('预览图为空或超过 32 MB。')
      return {'dataUrl': f'data:{content_type};base64,' + base64.b64encode(raw).decode('ascii')}
    except urllib.error.HTTPError as error:
      raise ValueError(f'预览图读取失败（HTTP {error.code}）。') from None
    except (urllib.error.URLError, TimeoutError):
      raise ValueError('预览图连接失败或超时，请稍后重试。') from None

  def read_youmind_prompts(self, page):
    self._check()
    if type(page) is not int or not 1 <= page <= 1000:
      raise ValueError('YouMind 目录页码无效。')
    from playground_image import NoRedirect
    value = {'model': 'nano-banana-pro', 'page': page, 'limit': 100, 'locale': 'zh-CN',
      'campaign': 'nano-banana-pro-prompts', 'filterMode': 'imageCategories'}
    request = urllib.request.Request('https://youmind.com/youmarketing-api/prompts',
      data=json.dumps(value).encode('utf-8'), headers={'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json', 'Referer': 'https://youmind.com/zh-CN/nano-banana-pro-prompts/explore'})
    try:
      with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
      if len(raw) > 8 * 1024 * 1024:
        raise ValueError('YouMind 单页目录超过大小限制。')
      result = json.loads(raw)
      if not isinstance(result, dict) or not isinstance(result.get('prompts'), list) or result.get('page') != page or type(result.get('totalPages')) is not int or not 1 <= result['totalPages'] <= 1000:
        raise ValueError('YouMind 目录格式已变化，请稍后重试。')
      return {'prompts': result['prompts'], 'totalPages': result['totalPages']}
    except urllib.error.HTTPError as error:
      raise ValueError(f'YouMind 读取失败（HTTP {error.code}），原缓存已保留。') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
      raise ValueError('YouMind 目录连接失败或超时，原缓存已保留。') from None

  def read_heroprompt_posts(self, page):
    self._check()
    if type(page) is not int or not 1 <= page <= 1000:
      raise ValueError('HeroPrompt 目录页码无效。')
    from playground_image import NoRedirect
    url = f'https://heroprompt.sortes.ai/api/posts?offset={(page - 1) * 50}&limit=50&q=&tags=&sort=new'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    try:
      with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
      if len(raw) > 8 * 1024 * 1024:
        raise ValueError('HeroPrompt 单页目录超过大小限制。')
      result = json.loads(raw)
      if not isinstance(result, dict) or not isinstance(result.get('posts'), list) or type(result.get('total')) is not int or not 0 <= result['total'] <= 50000:
        raise ValueError('HeroPrompt 目录格式已变化，请稍后重试。')
      return {'prompts': result['posts'], 'totalPages': max(1, (result['total'] + 49) // 50)}
    except urllib.error.HTTPError as error:
      raise ValueError(f'HeroPrompt 读取失败（HTTP {error.code}），原缓存已保留。') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
      raise ValueError('HeroPrompt 目录连接失败或超时，原缓存已保留。') from None

  def list_models(self, profile_id):
    self._check()
    if isinstance(profile_id, dict):
      profile = profile_id
    else:
      settings = initial_settings() or {}
      profile = next((p for p in settings.get('profiles', []) if p['id'] == profile_id), None)
    if not profile or not isinstance(profile.get('baseUrl'), str) or not isinstance(profile.get('apiKey'), str):
      raise ValueError('请填写 API 地址与 Key。')
    url = urlsplit(profile['baseUrl'] if '://' in profile['baseUrl'] else 'https://' + profile['baseUrl'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
      raise ValueError('API 地址必须是有效 HTTP(S) 地址，不能包含凭据或查询参数。')
    key = profile.get('apiKey', '').strip()
    if not key or '\r' in key or '\n' in key:
      raise ValueError('请填写有效 API Key。')
    from playground_image import NoRedirect
    request = urllib.request.Request(normalize_url(profile['baseUrl']) + '/models', headers={'Authorization': 'Bearer ' + key, 'User-Agent': 'Chat-to-image-CLI/1'})
    try:
      with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
      if len(raw) > 2 * 1024 * 1024:
        raise ValueError('模型目录超过大小限制。')
      result = json.loads(raw)
      if not isinstance(result, dict) or not isinstance(result.get('data'), list):
        raise ValueError('服务未返回兼容的模型列表，可手动添加。')
      ids = list(dict.fromkeys(item['id'].strip() for item in result['data']
        if isinstance(item, dict) and isinstance(item.get('id'), str) and item['id'].strip()))
      return {'ids': ids, 'fetchedAt': int(time.time() * 1000)}
    except urllib.error.HTTPError as error:
      raise ValueError(f'模型列表获取失败（HTTP {error.code}），可继续手动添加。') from None
    except (urllib.error.URLError, TimeoutError) as error:
      if isinstance(error, TimeoutError) or isinstance(getattr(error, 'reason', None), TimeoutError):
        raise ValueError('模型目录请求超时，请检查网络后重试。') from None
      raise ValueError('模型目录连接失败，请检查地址与网络；原选择已保留。') from None
    except (json.JSONDecodeError, UnicodeError):
      raise ValueError('服务未返回兼容的模型目录，可手动添加。') from None

  def status(self):
    self._check()
    return {**route_state(), 'running': len(self._processes), 'revision': settings_revision()}

  def reset_routes(self):
    self._check()
    with route_lock():
      write_json(local_data_dir() / 'route-state.json', {'failed': {}, 'events': []})
    return {'ok': True}

  def agent_connections(self, action, target=None):
    self._check()
    from agent_connections import TARGETS, change, status
    if not isinstance(action, str) or action not in ('status', 'connect', 'update', 'disconnect'):
      raise ValueError('Agent 连接操作不支持。')
    if target is not None and (not isinstance(target, str) or target not in TARGETS):
      raise ValueError('Agent 目标不支持。')
    result = None if action == 'status' else change(action, target)
    return {**status(), 'result': result}

  def generate(self, value):
    self._check()
    request_id = value.get('requestId') if isinstance(value, dict) else None
    if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 80):
      raise ValueError('任务标识错误。')
    with self._lock:
      if request_id and (request_id in self._queued or request_id in self._requests):
        raise ValueError('此任务已在执行。')
      if request_id: self._queued.add(request_id)
    acquired = False
    try:
      while not acquired:
        with self._lock:
          if self._closing or request_id in self._cancelled:
            raise ValueError('本地任务已停止，未提交新的生图请求。')
        acquired = self._image_slots.acquire(timeout=.1)
      return self._generate(value)
    finally:
      with self._lock:
        self._queued.discard(request_id)
        self._cancelled.discard(request_id)
      if acquired: self._image_slots.release()

  def _generate(self, value):
    self._check()
    if not isinstance(value, dict) or not isinstance(value.get('prompt'), str):
      raise ValueError('生图参数格式错误。')
    params = value.get('params', {})
    if not isinstance(params, dict) or not isinstance(value.get('profileId'), str) or not value['profileId']:
      raise ValueError('生图参数或 API 配置标识错误。')
    request_id = value.get('requestId')
    if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 80):
      raise ValueError('任务标识错误。')
    with tempfile.TemporaryDirectory(prefix='playground-ui-') as directory:
      work = Path(directory)
      (work / 'prompt.txt').write_text(value['prompt'], encoding='utf-8')
      python = str(Path(sys.executable).with_name('python.exe'))
      command = [python, '-B', str(Path(__file__).with_name('playground_image.py')),
        '--prompt-file', str(work / 'prompt.txt'), '--output', str(work / 'results'),
        '--saved-profile', value['profileId'], '--size', str(params.get('size', 'auto')),
        '--quality', params.get('quality', 'auto'), '--format', params.get('output_format', 'png'),
        '--count', str(params.get('n', 1)), '--concurrency', '1']
      if value.get('model'):
        command.extend(['--saved-model', str(value['model'])])
      for field, flag in [('moderation', '--moderation'), ('output_compression', '--output-compression')]:
        if params.get(field) is not None:
          command.extend([flag, str(params[field])])
      if value.get('nativeTransparentBackground'):
        command.extend(['--background', 'transparent'])
      images = value.get('inputImageDataUrls', [])
      if not isinstance(images, list) or len(images) > 16:
        raise ValueError('最多支持 16 张参考图。')
      files = [(image, '--image') for image in images]
      if value.get('maskDataUrl'):
        files.append((value['maskDataUrl'], '--mask'))
      for i, (data_url, flag) in enumerate(files):
        if not isinstance(data_url, str) or len(data_url) > 72 * 1024 * 1024 or not data_url.startswith('data:image/'):
          raise ValueError('参考图片格式错误或超过大小限制。')
        header, data = data_url.split(',', 1)
        if ';base64' not in header:
          raise ValueError('参考图需要 Base64 编码。')
        path = work / f'input-{i}.bin'
        path.write_bytes(base64.b64decode(data, validate=True))
        command.extend([flag, str(path)])
      env = {k: v for k, v in os.environ.items() if k not in ('PLAYGROUND_BASE_URL', 'PLAYGROUND_MODEL')}
      with self._lock:
        if self._closing:
          raise ValueError('窗口正在关闭。')
        if request_id in self._cancelled:
          self._cancelled.discard(request_id)
          raise ValueError('本地任务已停止，未提交新的生图请求。')
        if request_id and request_id in self._requests:
          raise ValueError('此任务已在执行。')
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
          creationflags=subprocess.CREATE_NO_WINDOW, env=env)
        self._processes.add(process)
        if request_id:
          self._requests[request_id] = process
      try:
        output, _ = process.communicate()
        try:
          result = json.loads(output.decode('utf-8')) if output else None
        except (ValueError, UnicodeDecodeError):
          result = None
        if result is None:
          result = {'ok': False, 'images': [], 'error': {'message': '任务已停止，已完成图片已保留。'}}
          from playground_image import read_image, CallError
          # 子进程可能在最终 JSON 回传前停止；只接收通过完整容器校验的结果文件。
          for path in sorted((work / 'results').glob('*')):
            if path.suffix.lower() not in ('.png', '.jpeg', '.webp'): continue
            try:
              _, info = read_image(path)
            except (CallError, OSError):
              continue
            result['images'].append({'path': str(path), 'format': info[0], 'width': info[1], 'height': info[2]})
          result['warnings'] = ['停止本地任务不保证服务商停止处理；请勿自动重复提交。']
        images = []
        for entry in result.get('images', []):
          path = Path(entry['path']).resolve()
          if not path.is_relative_to(work.resolve()):
            raise ValueError('输出路径超出任务目录。')
          images.append('data:image/' + entry['format'] + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii'))
        return {'ok': result['ok'], 'images': images, 'warnings': result.get('warnings', []),
          'usedProfile': result.get('used_profile'), 'error': result.get('error'),
          'usedProfiles': [entry.get('used_profile') for entry in result.get('images', [])],
          'actualParamsList': [{'size': f"{entry['width']}x{entry['height']}"} for entry in result.get('images', [])],
          'revisedPrompts': [entry.get('revised_prompt') for entry in result.get('images', [])]}
      finally:
        with self._lock:
          self._processes.discard(process)
          self._requests.pop(request_id, None)
          self._cancelled.discard(request_id)

  def cancel_generation(self, request_id):
    self._check()
    if not isinstance(request_id, str) or not request_id or len(request_id) > 80:
      raise ValueError('任务标识错误。')
    with self._lock:
      process = self._requests.get(request_id)
      self._cancelled.add(request_id)
      if process and process.poll() is None:
        process.terminate()
    return {'ok': True}

  def _stop(self):
    with self._lock:
      self._closing = True
      processes = list(self._processes)
    for process in processes:
      try:
        if process.poll() is None:
          process.terminate()
        try:
          process.wait(timeout=5)
        except subprocess.TimeoutExpired:
          process.kill()
          process.wait(timeout=5)
      except (OSError, subprocess.TimeoutExpired):
        # 一个任务回收失败不能跳过其他已归属本窗口的任务。
        continue


def main():
  import webview
  import winreg
  from serve_app import make_server
  root = Path(__file__).resolve().parent.parent
  if not (root / 'dist/index.html').exists():
    raise ValueError('缺少网页构建文件，请先运行 build-app.cmd。')
  local = local_data_dir()
  local.mkdir(parents=True, exist_ok=True)
  kernel = ctypes.WinDLL('kernel32', use_last_error=True)
  kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
  kernel.CreateMutexW.restype = ctypes.c_void_p
  kernel.CloseHandle.argtypes = [ctypes.c_void_p]
  mutex = kernel.CreateMutexW(None, False, 'Local\\GPTImagePlayground-' + project_id())
  if not mutex:
    raise OSError('无法创建桌面窗口锁。')
  if ctypes.get_last_error() == 183:
    kernel.CloseHandle(mutex)
    raise ValueError('此项目的桌面窗口已打开，请从任务栏切换到现有窗口。')
  api = DesktopApi()
  server = None
  thread = None
  try:
    port_file = local / 'desktop-port.json'
    port = json.loads(port_file.read_text())['port'] if port_file.exists() else 0
    server = make_server(port)
    server.desktop = True
    write_json(port_file, {'port': server.server_port})
    api._origin = f'http://127.0.0.1:{server.server_port}'
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, 'Environment', 0, winreg.KEY_SET_VALUE) as key:
      winreg.SetValueEx(key, 'PLAYGROUND_PROJECT_ROOT', 0, winreg.REG_SZ, str(root))
    webview.settings['ALLOW_DOWNLOADS'] = True
    api._window = webview.create_window('Chat to image', api._origin + '/?desktop=1', js_api=api,
      width=1360, height=900, min_size=(980, 680), background_color='#faf9f6', text_select=True)
    api._window.events.closing += api._stop
    webview.start(gui='edgechromium', private_mode=False, storage_path=str(local / 'webview'))
  finally:
    try:
      api._stop()
    finally:
      try:
        if server:
          try:
            if thread:
              server.shutdown()
              thread.join(timeout=5)
          finally:
            server.server_close()
      finally:
        kernel.CloseHandle(mutex)


if __name__ == '__main__':
  main()
