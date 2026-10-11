"""只管理本工具创建的 Agent 接入文件，保留个人修改与其他文件。"""
from contextlib import contextmanager
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

from desktop_config import write_json
from playground_config import config_path, local_data_dir


ROOT = Path(__file__).resolve().parent.parent
TARGETS = {'codex': ('Codex', '.agents/skills'), 'claude': ('Claude Code', '.claude/skills'), 'cursor': ('Cursor', '.cursor/skills'), 'deepseek-harness': ('DeepSeek Harness', '.dsh/skills')}
FILES = ('SKILL.md', '.connection.json')


def check_path(path):
  for item in (path, *path.parents):
    if not item.exists() and not item.is_symlink():
      continue
    info = item.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
      raise ValueError('接入路径含符号链接或重解析点，请使用普通用户目录。')


def target_path(target):
  if target not in TARGETS:
    raise ValueError('请选择 Codex、Claude Code、Cursor 或 DeepSeek Harness。')
  home = Path(os.environ.get('CHAT_TO_IMAGE_AGENT_HOME') or Path.home()).expanduser()
  root = Path(os.environ['CLAUDE_CONFIG_DIR']).expanduser() if target == 'claude' and os.environ.get('CLAUDE_CONFIG_DIR') else home / TARGETS[target][1]
  if target == 'claude' and os.environ.get('CLAUDE_CONFIG_DIR'):
    root = root / 'skills'
  if target == 'deepseek-harness' and os.environ.get('DSH_HOME', '').strip():
    root = Path(os.environ['DSH_HOME'].strip()).expanduser() / 'skills'
  if not root.is_absolute():
    raise ValueError('Agent 用户目录必须是绝对路径。')
  path = root / 'chat-to-image-cli'
  check_path(path)
  return path


def invocation():
  python = Path(sys.executable)
  if python.name.lower() == 'pythonw.exe':
    python = python.with_name('python.exe')
  return [str(python), '-B', str(ROOT / 'scripts/chat_to_image.py'), '--config-dir', str(config_path().parent.resolve())]


def skill_content(command):
  prefix = '& ' + ' '.join("'" + part.replace("'", "''") + "'" for part in command)
  return (f'---\nname: chat-to-image-cli\ndescription: 使用本机 Chat to image 生成图片、参考图编辑或蒙版重绘；用户指定本工具时调用。\n---\n\n'
    '# Chat to image\n\n先执行以下命令读取当前版本指南，再追加 `generate` 及指南参数执行任务：\n\n'
    f'```powershell\n{prefix} agent-guide\n```\n\n'
    '将以上完整命令作为本机 CLI 前缀；调用不依赖桌面窗口。先用 `doctor` 检查本地配置，结果不代表 Key 或供应商有效。'
    '只按用户请求生成或编辑，不因引用示例或明确禁止生成而提交；Key 不写入命令、文件或回复。'
    '只把结果 `images` 中实际保存的路径作为完成依据；超时、断线或保存失败后先核对请求记录，不自动重发。\n').encode('utf-8')


def describe(target, command):
  row = {'id': target, 'label': TARGETS[target][0], 'path': '', 'status': 'missing', 'message': '尚未连接。', 'invocation': command}
  try:
    folder = target_path(target)
    row['path'] = str(folder)
    for name in FILES:
      check_path(folder / name)
    if not any((folder / name).exists() for name in FILES):
      return row
    receipt_path = folder / '.connection.json'
    skill = folder / 'SKILL.md'
    if not receipt_path.is_file() or receipt_path.stat().st_size > 65536:
      row.update(status='conflict', message='存在未知接入文件，未接管。')
      return row
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    if not isinstance(receipt, dict) or receipt.get('schema_version') != 1 or receipt.get('target') != target or receipt.get('project') != str(ROOT):
      row.update(status='conflict', message='接入属于其他项目或归属信息无效，未接管。')
      return row
    if not skill.is_file() or skill.stat().st_size > 65536 or hashlib.sha256(skill.read_bytes()).hexdigest() != receipt.get('skill_sha256'):
      row.update(status='modified', message='接入文件已被修改或缺失，请先保留个人修改，未自动覆盖。')
      return row
    if skill.read_bytes() != skill_content(command):
      row.update(status='stale', message='本机路径或接入说明已变化，可更新连接。')
      return row
    row.update(status='connected', message='接入文件已就绪；Agent 是否加载仍需在新会话确认。')
  except (OSError, ValueError, TypeError):
    row.update(status='error', message='接入路径或文件无法读取，请检查目录权限及格式。')
  return row


def status():
  command = invocation()
  ready = False
  try:
    probe = subprocess.run(command + ['--version'], stdin=subprocess.DEVNULL, capture_output=True,
      encoding='utf-8', timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
    ready = probe.returncode == 0 and probe.stdout.startswith('chat-to-image ')
  except (OSError, subprocess.TimeoutExpired):
    pass
  return {'schema_version': 1, 'ok': True, 'runtime_ready': ready, 'command': command,
    'manual_command': [str(ROOT / 'chat-to-image.cmd')],
    'targets': [describe(target, command) for target in TARGETS]}


@contextmanager
def connection_lock(folder):
  check_path(folder.parent)
  folder.parent.mkdir(parents=True, exist_ok=True)
  path = folder.parent / '.chat-to-image.lock'
  check_path(path)
  with path.open('a+b') as file:
    if not file.tell():
      file.write(b'0')
      file.flush()
    file.seek(0)
    try:
      msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
      raise ValueError('该 Agent 连接正忙，请稍后重试。') from None
    try:
      yield
    finally:
      file.seek(0)
      msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)


def replace_bytes(path, content):
  temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
  try:
    with temporary.open('xb') as file:
      file.write(content)
      file.flush()
      os.fsync(file.fileno())
    os.replace(temporary, path)
  finally:
    temporary.unlink(missing_ok=True)


def change(action, target):
  if action not in ('connect', 'update', 'disconnect'):
    raise ValueError('连接操作不支持。')
  folder = target_path(target)
  command = invocation()
  if action != 'disconnect' and not status()['runtime_ready']:
    raise ValueError('CLI 运行环境未通过检查，请检查 Python 和项目路径。')
  with connection_lock(folder):
    row = describe(target, command)
    if row['status'] not in ('missing', 'connected', 'stale'):
      raise ValueError(row['message'])
    if action == 'update' and row['status'] == 'missing':
      raise ValueError('尚未连接，请先点击连接。')
    if (action == 'disconnect' and row['status'] == 'missing') or (action != 'disconnect' and row['status'] == 'connected'):
      return {'ok': True, 'changed': False, 'backup': '', 'target': target}
    original = {name: (folder / name).read_bytes() if (folder / name).exists() else None for name in FILES}
    backup = None
    if any(value is not None for value in original.values()):
      backup = local_data_dir() / 'agent-backups' / uuid.uuid4().hex
      check_path(backup)
      backup.mkdir(parents=True)
      for name, value in original.items():
        if value is not None:
          shutil.copy2(folder / name, backup / name)
    content = skill_content(command)
    try:
      check_path(folder)
      folder.mkdir(parents=True, exist_ok=True)
      for name in FILES:
        check_path(folder / name)
      if action == 'disconnect':
        for name in FILES:
          (folder / name).unlink()
      else:
        replace_bytes(folder / 'SKILL.md', content)
        write_json(folder / '.connection.json', {'schema_version': 1, 'target': target,
          'project': str(ROOT), 'skill_sha256': hashlib.sha256(content).hexdigest()})
    except OSError:
      try:
        for name, value in original.items():
          path = folder / name
          check_path(path)
          if value is None:
            path.unlink(missing_ok=True)
          else:
            replace_bytes(path, value)
      except (OSError, ValueError):
        raise ValueError(f'连接操作失败，恢复未完成。原文件备份：{backup or "本次无原接入文件"}。') from None
      raise ValueError(f'连接操作未完成，已恢复原文件。备份：{backup or "本次无原接入文件"}。') from None
    return {'ok': True, 'changed': True, 'backup': str(backup) if backup else '', 'target': target}
