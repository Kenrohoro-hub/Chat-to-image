"""从明确文件清单生成含 Python 与 WebView2 离线组件的 Windows 安装器。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile


PYTHON_VERSION = '3.13.16'
PYTHON_SHA256 = '97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297'
APP_FILES = (
  'run-app.cmd', 'run-sync.cmd', 'chat-to-image.cmd',
  'package.json', 'requirements-desktop.txt', 'LICENSE', 'README.md', 'README_使用说明.md', 'RELEASE.md',
  'README.en.md', 'README_User_Guide.en.md', 'docs/codex-image-interface.md', 'docs/image-protocols.md',
  'scripts/desktop_app.pyw', 'scripts/desktop_host.py', 'scripts/desktop_config.py', 'scripts/app_update.py',
  'scripts/playground_config.py', 'scripts/playground_image.py', 'scripts/gemini_image.py', 'scripts/image_protocol.py',
  'scripts/serve_app.py', 'scripts/sync_app.py', 'scripts/chat_to_image.py',
  'scripts/agent_connections.py', 'scripts/image_batch.py', 'scripts/prompt_storage.py', 'scripts/ui_language.py',
)


def stage_app(root, stage):
  for name in APP_FILES:
    target = stage / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, target)
  shutil.copytree(root / 'dist', stage / 'dist')


def download(url, path):
  if path.exists():
    return
  temporary = path.with_suffix(path.suffix + '.download')
  try:
    with urllib.request.urlopen(url, timeout=180) as response, temporary.open('wb') as output:
      shutil.copyfileobj(response, output)
    temporary.replace(path)
  finally:
    temporary.unlink(missing_ok=True)


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/chat-to-image-installer')
  parser.add_argument('--iscc', type=Path)
  args = parser.parse_args()
  root = Path(__file__).resolve().parent.parent
  cache = args.cache.resolve()
  cache.mkdir(parents=True, exist_ok=True)
  compiler = args.iscc or shutil.which('ISCC.exe') or Path(os.environ['ProgramFiles(x86)']) / 'Inno Setup 6/ISCC.exe'
  if not Path(compiler).is_file():
    raise ValueError('请先安装 Inno Setup 6，或用 --iscc 指定 ISCC.exe。')
  output = root / 'release'
  output.mkdir(exist_ok=True)
  signer = root / 'scripts/sign_installer.ps1'
  thumbprint = subprocess.check_output(['pwsh', '-NoProfile', '-File', str(signer),
    '-ExportPath', str(output / 'Chat-to-image-signing.cer')], encoding='utf-8').strip()
  if len(thumbprint) != 40 or any(c not in '0123456789ABCDEF' for c in thumbprint):
    raise ValueError('签名证书准备失败。')
  sign_command = f'pwsh.exe -NoProfile -File $q{signer}$q -CertificateThumbprint {thumbprint} -FilePath $f'
  subprocess.run([sys.executable, '-B', str(root / 'scripts/build_app.py')], check=True)
  if not (root / 'dist/index.html').is_file():
    raise ValueError('缺少前端构建，请先运行 build-app.cmd。')
  archive = cache / f'python-{PYTHON_VERSION}-embed-amd64.zip'
  download(f'https://www.python.org/ftp/python/{PYTHON_VERSION}/{archive.name}', archive)
  if hashlib.sha256(archive.read_bytes()).hexdigest() != PYTHON_SHA256:
    raise ValueError('Python 运行时校验失败，请移走构建缓存中的 ZIP 后重试。')
  webview = cache / 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
  download('https://go.microsoft.com/fwlink/?linkid=2124701', webview)
  # Evergreen 文件会更新，使用微软 Authenticode 签名校验发布者。
  subprocess.run(['pwsh', '-NoProfile', '-Command',
    "$s=Get-AuthenticodeSignature -LiteralPath $env:CHAT_TO_IMAGE_WEBVIEW_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){exit 1}",
    ], check=True, env={**os.environ, 'CHAT_TO_IMAGE_WEBVIEW_INSTALLER': str(webview)})
  wheels = cache / 'wheels'
  wheels.mkdir(exist_ok=True)
  subprocess.run([sys.executable, '-m', 'pip', 'wheel', '--no-deps', '--wheel-dir', str(wheels), 'proxy_tools==0.1.0'], check=True)
  subprocess.run([sys.executable, '-m', 'pip', 'download', '--only-binary=:all:', '--platform', 'win_amd64',
    '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313', '--find-links', str(wheels),
    '--dest', str(wheels), '-r', str(root / 'requirements-windows.txt')], check=True)
  version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
  with tempfile.TemporaryDirectory(prefix='payload-', dir=cache) as directory:
    stage = Path(directory)
    stage_app(root, stage)
    runtime = stage / 'runtime'
    with zipfile.ZipFile(archive) as bundle:
      bundle.extractall(runtime)
    (runtime / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../scripts\nimport site\n', encoding='ascii')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-index', '--find-links', str(wheels),
      '--only-binary=:all:', '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp',
      '--abi', 'cp313', '--no-compile', '--target', str(runtime / 'Lib/site-packages'),
      '-r', str(root / 'requirements-windows.txt')], check=True)
    subprocess.run([str(runtime / 'python.exe'), '-B', '-c', 'import webview, clr; from webview.platforms import winforms'], check=True)
    subprocess.run([str(runtime / 'python.exe'), '-B', str(stage / 'scripts/chat_to_image.py'), '--version'], check=True)
    manifest = '\n'.join(sorted(p.relative_to(stage).as_posix() for p in stage.rglob('*') if p.is_file())) + '\n'
    (output / 'package-files.txt').write_text(manifest, encoding='utf-8')
    subprocess.run([str(compiler), '/Qp', f'/Schattoimage={sign_command}', f'/DAppVersion={version}', f'/DPayloadDir={stage}',
      f'/DWebViewInstaller={webview}', f'/O{output}', str(root / 'installer/windows.iss')], check=True)
  installer = output / f'Chat-to-image-{version}-windows-x64-setup.exe'
  checksum = hashlib.sha256(installer.read_bytes()).hexdigest()
  (output / (installer.name + '.sha256')).write_text(f'{checksum}  {installer.name}\n', encoding='ascii')
  print(f'Installer: {installer}', flush=True)


if __name__ == '__main__':
  main()
