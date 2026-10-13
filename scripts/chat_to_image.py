"""Chat to image：独立生图 CLI 与 Agent 接入管理。"""
import argparse
import json
import os
from pathlib import Path
import sys

from playground_image import CallError, Parser
from playground_config import config_path, read_snapshot
from desktop_config import read_desktop
from image_protocol import resolve_image_protocol


ROOT = Path(__file__).resolve().parent.parent


def doctor():
  record = read_desktop()
  config = {'source': 'missing', 'path': str(config_path().parent), 'ready': False, 'profiles': []}
  if record:
    pool = record.get('failover') or {}
    disabled = pool.get('disabledIds', [])
    profiles = [p for p in record.get('profiles', []) if p.get('provider') == 'openai' and
      p.get('apiMode') == 'images' and p.get('id') not in disabled and
      not any(p.get(k) for k in ('codexCli', 'apiProxy')) and
      (not p.get('streamImages') or resolve_image_protocol(p, p.get('model', '')) != 'openai')]
    config.update(source='desktop', ready=bool(record.get('encrypted') and any(p.get('hasKey') and p.get('baseUrl') and p.get('model') for p in profiles)),
      profiles=[{'id': p.get('id'), 'name': p.get('name'), 'model': p.get('model'),
        'models': p.get('models') or [p.get('model')]} for p in profiles])
  else:
    snapshot = read_snapshot()
    if snapshot:
      profile = snapshot.get('profile', {})
      config.update(source='browser_sync', ready=bool(snapshot.get('encryptedKey') and not snapshot.get('error')),
        profiles=[{'id': profile.get('id'), 'name': profile.get('name'), 'model': profile.get('model')}])
  runtime = {'ready': sys.version_info >= (3, 10) and (ROOT / 'scripts/playground_image.py').is_file(),
    'python': sys.executable, 'entry': str(Path(__file__).resolve())}
  return {'schema_version': 1, 'ok': runtime['ready'] and config['ready'], 'runtime': runtime, 'config': config,
    'message': '本地检查不解密 Key、不联网，不代表凭据有效或供应商可用。'}


def main(argv=None):
  try:
    parser = Parser(description=__doc__)
    parser.add_argument('--version', action='version', version='chat-to-image ' + json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version'])
    parser.add_argument('--config-dir', help='本次调用使用的共享配置目录')
    parser.add_argument('command', choices=['generate', 'doctor', 'agent-guide', 'agents'])
    parser.add_argument('args', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.config_dir:
      directory = Path(args.config_dir).expanduser()
      if not directory.is_absolute():
        raise CallError('INVALID_ARGUMENT', '--config-dir 必须是绝对路径。')
      os.environ['PLAYGROUND_CONFIG_DIR'] = str(directory)
    if args.command == 'generate':
      from playground_image import main as generate
      return generate(args.args)
    if args.command == 'agents':
      from agent_connections import TARGETS, change, status
      agent_parser = Parser(prog='chat-to-image agents', description='连接、检查、更新或断开外部 Agent。')
      agent_parser.add_argument('action', choices=['status', 'connect', 'update', 'disconnect'])
      agent_parser.add_argument('--target', choices=list(TARGETS))
      agent = agent_parser.parse_args(args.args)
      if agent.action != 'status' and not agent.target:
        raise CallError('INVALID_ARGUMENT', '连接操作必须指定 --target。')
      try:
        result = status() if agent.action == 'status' else {'schema_version': 1, **change(agent.action, agent.target)}
        if agent.action == 'status' and agent.target:
          result['targets'] = [row for row in result['targets'] if row['id'] == agent.target]
      except ValueError as exc:
        raise CallError('CONNECTION_ERROR', str(exc)) from None
      print(json.dumps(result, ensure_ascii=False))
      return 0 if result['ok'] else 1
    if args.command == 'agent-guide':
      guides = {'usage': ROOT / 'docs/codex-image-interface.md'}
      section = args.args[0] if args.args else 'usage'
      if len(args.args) > 1 or section not in guides:
        raise CallError('INVALID_ARGUMENT', '可用指南：agent-guide [usage]。')
      print(guides[section].read_text(encoding='utf-8'))
      return 0
    if args.args:
      raise CallError('INVALID_ARGUMENT', 'doctor 不接受额外参数。')
    result = doctor()
  except (CallError, OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
    result = {'schema_version': 1, 'ok': False, 'error': {
      'code': exc.code if isinstance(exc, CallError) else 'LOCAL_ERROR',
      'message': str(exc) if isinstance(exc, CallError) else '本地配置或文件无法读取，请检查配置目录和运行环境。'}}
  print(json.dumps(result, ensure_ascii=False))
  return 0 if result['ok'] else 1


if __name__ == '__main__':
  sys.stdout.reconfigure(encoding='utf-8')
  sys.stderr.reconfigure(encoding='utf-8')
  sys.exit(main())
