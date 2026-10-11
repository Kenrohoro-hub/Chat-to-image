"""共享原生生图队列：最多两个受本程序持有的短时 CLI 子进程。"""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import shutil
import threading
import time
import uuid

from desktop_config import settings_snapshot
from playground_image import read_image, CallError


class ImageService:
  def __init__(self, store):
    self.store = store
    self._slots = threading.BoundedSemaphore(2)
    self._lock = threading.RLock()
    self._cancel = set()
    self._processes = set()
    self._closed = False

  def close(self):
    with self._lock:
      self._closed = True
      for event in self._cancel: event.set()
      for process in self._processes:
        if process.poll() is None: process.terminate()

  def generate(self, request, cancel, on_image=None):
    task = {'id': uuid.uuid4().hex, 'prompt': request.get('prompt', ''), 'params': {'size': request.get('size', 'auto'), 'quality': request.get('quality', 'auto'), 'output_format': request.get('format', 'png'), 'n': request.get('count', 1), 'background': request.get('background'), 'moderation': request.get('moderation'), 'output_compression': request.get('output_compression')}, 'inputImageIds': [], 'outputImages': [], 'status': 'running', 'error': None, 'createdAt': int(time.time() * 1000), 'finishedAt': None, 'elapsed': None, 'sourceMode': request.get('sourceMode', 'gallery')}
    for key in ('agentConversationId', 'agentRoundId'):
      if request.get(key): task[key] = request[key]
    images, warnings, errors = [], [], []
    pending_stop = threading.Event()
    work = None
    self.store.put_record('tasks', task)
    with self._lock:
      self._cancel.add(cancel)
      if self._closed: cancel.set()
    try:
      if cancel.is_set(): raise ValueError('本地任务已停止，未提交新请求。')
      if not isinstance(task['prompt'], str) or not task['prompt'].strip(): raise ValueError('请输入图片描述。')
      count = int(request.get('count', 1))
      if not 1 <= count <= 100: raise ValueError('图片数量需为 1–100。')
      snapshot = settings_snapshot()
      if snapshot.get('error'): raise ValueError(snapshot['error'])
      settings = snapshot.get('settings') or {}
      profile_id = request.get('profileId') or (settings.get('failover') or {}).get('primaryId') or settings.get('activeProfileId')
      profiles = settings.get('profiles', [])
      profile = next((p for p in profiles if p['id'] == profile_id and p.get('apiMode') == 'images'), None)
      if profile is None: profile = next((p for p in profiles if p.get('apiMode') == 'images'), None)
      if not profile: raise ValueError('请在设置中保存 Images API 配置。')
      task.update({'apiProfileId': profile['id'], 'apiProfileName': profile.get('name', ''), 'apiModel': request.get('model') or profile.get('model'), 'apiMode': 'images'})
      input_paths = request.get('images', [])
      if not isinstance(input_paths, list) or len(input_paths) > 16: raise ValueError('最多支持 16 张参考图。')
      for path in input_paths:
        raw, _ = read_image(path)
        item = self.store.add_image(raw)
        task['inputImageIds'].append(item['id'])
      mask_path = request.get('mask')
      if mask_path:
        raw, _ = read_image(mask_path)
        mask_item = self.store.add_image(raw, source='mask')
        task['maskImageId'] = mask_item['id']
      self.store.put_record('tasks', task)
      work_root = self.store.root / 'work'
      work_root.mkdir(exist_ok=True)
      work = Path(tempfile.mkdtemp(prefix='image-', dir=work_root))
      prompt = work / 'prompt.txt'
      prompt.write_text(task['prompt'], encoding='utf-8')
      python = Path(sys.executable)
      if python.name.lower() == 'pythonw.exe': python = python.with_name('python.exe')
      command = [str(python), '-B', str(Path(__file__).with_name('playground_image.py')), '--prompt-file', str(prompt), '--saved-profile', profile['id'], '--count', '1', '--concurrency', '1']
      for field, flag, default in [('size', '--size', 'auto'), ('quality', '--quality', 'auto'), ('format', '--format', 'png'), ('background', '--background', None), ('moderation', '--moderation', None), ('output_compression', '--output-compression', None), ('model', '--saved-model', None)]:
        value = request.get(field, default)
        if value is not None and value != '': command.extend([flag, str(value)])
      for image_id in task['inputImageIds']: command.extend(['--image', str(self.store.image_path(image_id))])
      if mask_path: command.extend(['--mask', str(self.store.image_path(task['maskImageId']))])
      env = {key: value for key, value in os.environ.items() if key not in ('PLAYGROUND_BASE_URL', 'PLAYGROUND_MODEL')}

      def generate_one(index):
        acquired = False
        process = None
        try:
          while not acquired:
            if cancel.is_set() or pending_stop.is_set(): return None
            acquired = self._slots.acquire(timeout=.1)
          with self._lock:
            if cancel.is_set() or self._closed or pending_stop.is_set(): return None
            output = work / f'{index}.{request.get("format", "png")}'
            process = subprocess.Popen(command + ['--output', str(output)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            self._processes.add(process)
          while True:
            try:
              stdout, _ = process.communicate(timeout=.15)
              break
            except subprocess.TimeoutExpired:
              if cancel.is_set() and process.poll() is None: process.terminate()
          try:
            result = json.loads(stdout.decode('utf-8'))
          except (ValueError, UnicodeDecodeError):
            result = {'ok': False, 'images': [], 'error': {'message': '本地任务停止或异常结束，请核对服务商记录，勿自动重试。'}}
            if output.exists():
              try:
                read_image(output)
                result['images'] = [{'path': str(output)}]
              except (OSError, ValueError, CallError): output.unlink(missing_ok=True)
          saved = []
          for item in result.get('images', []):
            path = Path(item['path']).resolve()
            if path != output.resolve(): raise ValueError('生图结果路径超出本次任务。')
            image = self.store.add_image(path, source='generated')
            output.unlink(missing_ok=True)
            image['used_profile'] = item.get('used_profile') or result.get('used_profile')
            image['revised_prompt'] = item.get('revised_prompt')
            saved.append(image)
            with self._lock:
              task['outputImages'].append(image['id'])
              self.store.put_record('tasks', task)
            if on_image: on_image(image)
          return {**result, 'images': saved}
        finally:
          if process:
            with self._lock: self._processes.discard(process)
          if acquired: self._slots.release()

      with ThreadPoolExecutor(max_workers=2) as pool:
        pending = {}
        index = 0
        while pending or (index < count and not cancel.is_set() and not pending_stop.is_set()):
          while len(pending) < 2 and index < count and not cancel.is_set() and not pending_stop.is_set():
            pending[pool.submit(generate_one, index)] = index
            index += 1
          if not pending: break
          done, _ = wait(pending, return_when=FIRST_COMPLETED)
          for future in done:
            pending.pop(future)
            try:
              result = future.result()
            except (OSError, ValueError, CallError) as exc:
              result = {'ok': False, 'error': {'message': str(exc)}}
            if result:
              images.extend(result.get('images', []))
              warnings.extend(result.get('warnings', []))
              if not result.get('ok'):
                errors.append(result.get('error', {}).get('message', '图片生成失败。'))
                pending_stop.set()
      if cancel.is_set(): errors.append('本地任务已停止，完成的图片保留；在途请求是否计费请核对服务商记录。')
    except (OSError, ValueError, CallError) as exc:
      errors.append(str(exc))
    finally:
      if work is not None:
        retained = [path for path in work.iterdir() if path.suffix in ('.png', '.jpeg', '.webp')]
        if retained:
          errors.append('图片已生成但未能登记到作品库，原结果保留在：' + str(work))
        else:
          shutil.rmtree(work)
      with self._lock: self._cancel.discard(cancel)
      task['finishedAt'] = int(time.time() * 1000)
      task['elapsed'] = task['finishedAt'] - task['createdAt']
      task['status'] = 'cancelled' if cancel.is_set() else 'error' if errors else 'success'
      task['error'] = '\n'.join(dict.fromkeys(errors)) or None
      task['routeWarnings'] = list(dict.fromkeys(warnings))
      self.store.put_record('tasks', task)
    return {'ok': not errors, 'taskId': task['id'], 'images': images, 'warnings': list(dict.fromkeys(warnings)), **({'error': {'message': task['error']}} if errors else {})}
