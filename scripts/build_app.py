"""在本机缓存目录构建，避免 Vite 解析网络共享路径失败。"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess



def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--test', action='store_true', help='运行前端检查，不更新构建产物')
  parser.add_argument('--test-file', action='append', default=[], help='仅运行指定检查文件，可重复指定')
  args = parser.parse_args()
  root = Path(__file__).resolve().parent.parent
  # Codex 商店版可能虚拟化 LOCALAPPDATA，导致父子目录解析为不同路径。
  stage = Path.home() / '.cache' / 'gpt-image-playground' / hashlib.sha256(str(root).encode()).hexdigest()[:16]
  stage.mkdir(parents=True, exist_ok=True)
  stage = stage.resolve()
  for name in ('package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json',
               'tailwind.config.js', 'postcss.config.js', '.env.test'):
    if (root / name).exists():
      shutil.copy2(root / name, stage / name)
  for name in ('src', 'public'):
    destination = stage / name
    if destination.exists():
      if destination.is_symlink() or not destination.resolve().is_relative_to(stage.resolve()):
        raise ValueError('构建缓存路径异常。')
      shutil.rmtree(destination)
    shutil.copytree(root / name, destination)
  npm = shutil.which('npm.cmd') or shutil.which('npm')
  if not npm:
    raise ValueError('请先安装 Node.js 与 npm。')
  digest = hashlib.sha256((root / 'package-lock.json').read_bytes()).hexdigest()
  marker = stage / '.installed-lock'
  env = dict(os.environ)
  # 本机构建不导入 shell 中遗留的预置服务配置或凭据。
  env.pop('VITE_DEFAULT_API_URL', None)
  if not (stage / 'node_modules').exists() or not marker.exists() or marker.read_text() != digest:
    subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=stage, env=env, check=True)
    marker.write_text(digest)
  command = [npm, 'test', '--', *args.test_file] if args.test else [npm, 'run', 'build']
  subprocess.run(command, cwd=stage, env=env, check=True)
  if not args.test:
    destination = root / 'dist'
    if destination.exists():
      if destination.is_symlink() or destination.resolve() != root.resolve() / 'dist':
        raise ValueError('构建输出路径异常。')
      shutil.rmtree(destination)
    shutil.copytree(stage / 'dist', destination)
    print('Build completed. Updated project dist directory.', flush=True)


if __name__ == '__main__':
  main()
