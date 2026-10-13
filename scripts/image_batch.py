"""用可终止的短时子进程执行 CLI 批次，不重复提交失败图片。"""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import json
from pathlib import Path
import subprocess
import sys
import threading

from ui_language import t


def run_image_batch(args, paths):
  from playground_image import read_image, CallError
  command = [sys.executable, '-B', str(Path(__file__).with_name('playground_image.py'))]
  for name, value in vars(args).items():
    if name in ('count', 'output', 'concurrency') or value is None or value is False: continue
    flag = '--' + name.replace('_', '-')
    for item in value if isinstance(value, list) else [value]:
      command.extend([flag] if item is True else [flag, str(item)])
  command.extend(['--count', '1', '--concurrency', '1'])
  processes = set()
  lock = threading.Lock()
  stopped = threading.Event()

  def generate(path):
    with lock:
      if stopped.is_set(): return {'ok': False, 'images': [], 'error': {'code': 'INTERRUPTED', 'message': t('批次已停止。', 'The batch was stopped.')}}
      try:
        process = subprocess.Popen(command + ['--output', str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
      except OSError:
        return {'ok': False, 'images': [], 'error': {'code': 'PROCESS_START_FAILED', 'message': t('无法启动本次生图进程，已完成图片保留。', 'Could not start an image generation process. Completed images were kept.')}}
      processes.add(process)
    try:
      output, _ = process.communicate()
      if output:
        try: return json.loads(output.decode('utf-8'))
        except (ValueError, UnicodeDecodeError): pass
      images = []
      for saved_path in dict.fromkeys([path, *(path.with_suffix('.' + fmt) for fmt in ('png', 'jpeg', 'webp'))]):
        try:
          raw, info = read_image(saved_path)
          images.append({'path': str(saved_path), 'format': info[0], 'width': info[1], 'height': info[2], 'bytes': len(raw)})
        except (CallError, OSError): pass
      return {'ok': False, 'images': images, 'error': {'code': 'INTERRUPTED', 'message': t('任务已停止，在途请求状态不明；请核对服务商记录，勿自动重跑。', 'The task stopped while a request was in flight, so its status is unknown. Check provider records; do not retry automatically.')}}
    finally:
      with lock: processes.discard(process)

  results = {}
  with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
    pending = {}
    next_index = 0
    try:
      while pending or (next_index < len(paths) and not stopped.is_set()):
        while len(pending) < args.concurrency and next_index < len(paths) and not stopped.is_set():
          pending[pool.submit(generate, paths[next_index])] = next_index
          next_index += 1
        done, _ = wait(pending, return_when=FIRST_COMPLETED)
        for future in done:
          result = future.result()
          results[pending.pop(future)] = result
          if not result['ok']: stopped.set()
    except KeyboardInterrupt:
      stopped.set()
      with lock:
        for process in processes:
          if process.poll() is None: process.terminate()
      for future, index in pending.items(): results[index] = future.result()
  ordered = [result for _, result in sorted(results.items())]
  failed = next((result for result in ordered if not result['ok']), None)
  if failed is None and next_index < len(paths):
    failed = {'error': {'code': 'INTERRUPTED', 'message': t('批次已停止，已完成图片保留。', 'The batch was stopped. Completed images were kept.')}}
  return {
    'ok': failed is None,
    'stage': 'done' if failed is None else failed.get('stage', 'interrupted'),
    'images': [image for result in ordered for image in result.get('images', [])],
    'attempted_requests': sum(result.get('attempted_requests', 0) for result in ordered),
    'completed_requests': sum(result.get('completed_requests', 0) for result in ordered),
    'request_ids': [item for result in ordered for item in result.get('request_ids', [])],
    'warnings': list(dict.fromkeys(item for result in ordered for item in result.get('warnings', []))),
    **({'error': failed['error']} if failed else {}),
    **next(({'used_profile': result['used_profile']} for result in reversed(ordered) if result.get('used_profile')), {}),
  }
