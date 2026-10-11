#!/usr/bin/env python3
"""Chat to image 的无第三方依赖 Images API 调用入口。"""

import argparse
import base64
import binascii
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from playground_config import read_snapshot, snapshot_key
from desktop_config import candidates, read_desktop, profile_key, normalize_url, report_route


MAX_IMAGE_BYTES = 50 * 1024 * 1024
MAX_RESPONSE_BYTES = 80 * 1024 * 1024
SIZES = {
  '1k': '1024x1024', '1k-landscape': '1536x1024', '1k-portrait': '1024x1536',
  '2k': '2048x2048', '2k-landscape': '2560x1440', '2k-portrait': '1440x2560',
  '4k': '3840x2160', '4k-landscape': '3840x2160', '4k-portrait': '2160x3840',
}


class CallError(Exception):
  def __init__(self, code, message):
    super().__init__(message)
    self.code = code


class Parser(argparse.ArgumentParser):
  def error(self, message):
    raise CallError('INVALID_ARGUMENT', message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
  # 不转发带凭据的请求，亦不将生图 POST 隐式改成 GET。
  def redirect_request(self, req, fp, code, msg, headers, newurl):
    return None


def checked_url(value):
  try:
    url = urllib.parse.urlsplit(value)
    _ = url.port
  except ValueError:
    raise CallError('INVALID_URL', '服务地址格式错误。') from None
  if not url.hostname or url.username or url.password or url.query or url.fragment:
    raise CallError('INVALID_URL', 'Base URL 必须是无用户名、密码、查询参数或片段的完整地址。')
  try:
    local = ipaddress.ip_address(url.hostname).is_loopback
  except ValueError:
    local = url.hostname.lower() == 'localhost'
  if url.scheme != 'https' and not (url.scheme == 'http' and local):
    raise CallError('INVALID_URL', '远程 API 必须使用 HTTPS；HTTP 仅允许本机回环地址。')
  return value.rstrip('/')


def image_info(data):
  # 读取图片容器头；不解码像素，不将扩展名或 HTTP Content-Type 当作图片证据。
  if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 33 and data[12:16] == b'IHDR':
    width, height = struct.unpack('>II', data[16:24])
    if width and height and b'IEND' in data[-12:]:
      return 'png', width, height, data[25] in (4, 6)
  if data.startswith(b'\xff\xd8'):
    pos = 2
    dimensions = None
    has_scan = False
    while pos + 2 <= len(data):
      if data[pos] != 255:
        break
      while pos < len(data) and data[pos] == 255:
        pos += 1
      if pos >= len(data):
        break
      marker = data[pos]
      pos += 1
      # 相机 JPEG 可在 EOI 后附加数据；必须沿段和扫描数据找到真实 EOI，不能搜索 EXIF 中的同名字节。
      if marker == 0xd9:
        if dimensions and has_scan:
          return 'jpeg', dimensions[0], dimensions[1], False
        break
      if marker in (0xd8, 0x01) or 0xd0 <= marker <= 0xd7:
        continue
      if pos + 2 > len(data):
        break
      length = int.from_bytes(data[pos:pos + 2], 'big')
      if length < 2 or pos + length > len(data):
        break
      if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf) and length >= 8:
        height, width = struct.unpack('>HH', data[pos + 3:pos + 7])
        if width and height:
          dimensions = (width, height)
      pos += length
      if marker == 0xda:
        has_scan = True
        while pos < len(data):
          pos = data.find(b'\xff', pos)
          if pos < 0:
            pos = len(data)
            break
          start = pos
          while pos < len(data) and data[pos] == 255:
            pos += 1
          if pos >= len(data):
            break
          if data[pos] == 0 or 0xd0 <= data[pos] <= 0xd7:
            pos += 1
            continue
          pos = start
          break
  if len(data) >= 30 and data[:4] == b'RIFF' and data[8:12] == b'WEBP' and int.from_bytes(data[4:8], 'little') + 8 == len(data):
    kind = data[12:16]
    if kind == b'VP8X':
      return 'webp', 1 + int.from_bytes(data[24:27], 'little'), 1 + int.from_bytes(data[27:30], 'little'), bool(data[20] & 16)
    if kind == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a':
      return 'webp', int.from_bytes(data[26:28], 'little') & 0x3fff, int.from_bytes(data[28:30], 'little') & 0x3fff, False
    if kind == b'VP8L' and data[20] == 0x2f:
      bits = int.from_bytes(data[21:25], 'little')
      return 'webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, bool(bits & (1 << 28))
  raise CallError('INVALID_IMAGE', '未识别到完整容器头的 PNG、JPEG 或 WebP 图片。')


def read_image(path):
  with Path(path).open('rb') as file:
    data = file.read(MAX_IMAGE_BYTES + 1)
  if len(data) > MAX_IMAGE_BYTES:
    raise CallError('IMAGE_TOO_LARGE', '单张参考图或蒙版不能超过 50 MiB。')
  return data, image_info(data)


def load_profile(args):
  if not args.config:
    if args.profile:
      raise CallError('INVALID_CONFIG', '--profile 必须与 --config 一起使用。')
    explicit = args.base_url or args.model or args.api_key_env or (not args.saved_profile and (os.environ.get('PLAYGROUND_BASE_URL') or os.environ.get('PLAYGROUND_MODEL')))
    if explicit:
      return {}
    if read_desktop() is not None:
      pool = candidates(args.saved_profile, args.saved_model)
      valid = []
      for candidate in pool:
        try:
          normalize_url(candidate.get('baseUrl') or '')
          if not (candidate.get('model') or '').strip():
            continue
          valid.append(candidate)
        except (CallError, ValueError):
          continue
      pool = valid
      if not pool:
        raise CallError('NO_AVAILABLE_PROFILE', '请在桌面设置中启用至少一套 OpenAI 兼容 Images API 配置。')
      return {**pool[0], '_desktop_candidates': pool, '_desktop_selected': args.saved_profile}
    snapshot = read_snapshot()
    if not snapshot:
      return {}
    if snapshot.get('error'):
      raise CallError('BROWSER_CONFIG_UNAVAILABLE', snapshot['error'])
    return {**snapshot['profile'], '_browser_snapshot': snapshot}
  value = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
  if not isinstance(value, dict):
    raise CallError('INVALID_CONFIG', '配置必须是 JSON 对象。')
  profiles = value.get('profiles', [value])
  if not isinstance(profiles, list) or not profiles or not all(isinstance(p, dict) for p in profiles):
    raise CallError('INVALID_CONFIG', 'profiles 必须是非空配置对象列表。')
  if args.profile:
    profiles = [p for p in profiles if p.get('id') == args.profile]
  elif len(profiles) > 1:
    profiles = [p for p in profiles if p.get('isDefault') is True]
  if len(profiles) != 1:
    raise CallError('INVALID_CONFIG', '请用 --profile 指定唯一配置 ID，或设置一个 isDefault。')
  profile = profiles[0]
  if profile.get('provider', 'openai') != 'openai' or profile.get('apiMode', 'images') != 'images':
    raise CallError('UNSUPPORTED_PROVIDER', '此入口支持 OpenAI 兼容 Images API；当前配置不是该类型。')
  if profile.get('codexCli'):
    raise CallError('UNSUPPORTED_PROVIDER', '此入口不支持网页的 Codex CLI 特殊参数模式。')
  return profile


def request(url, timeout, result, body=None, key=None, content_type=None):
  headers = {'Accept': 'application/json' if body is not None else 'image/*', 'User-Agent': 'Chat-to-image-CLI/1'}
  if key is not None:
    headers['Authorization'] = 'Bearer ' + key
  if content_type:
    headers['Content-Type'] = content_type
  req = urllib.request.Request(url, data=body, headers=headers)
  opener = urllib.request.build_opener(NoRedirect())
  try:
    with opener.open(req, timeout=timeout) as response:
      request_id = response.headers.get('x-request-id')
      if request_id:
        result['request_ids'].append(request_id)
      if response.status != 200:
        raise CallError('UNSUPPORTED_RESPONSE', '接口未同步返回图片；此入口不支持异步任务响应。')
      data = response.read(MAX_RESPONSE_BYTES + 1)
      if len(data) > MAX_RESPONSE_BYTES:
        raise CallError('RESPONSE_TOO_LARGE', '响应超过 80 MiB，已停止读取。')
      return data
  except urllib.error.HTTPError as exc:
    result['http_status'] = exc.code
    request_id = exc.headers.get('x-request-id')
    if request_id:
      result['request_ids'].append(request_id)
    # 服务商错误正文可能回显密钥、输入或大段 Base64，不透传到日志。
    hints = {400: '检查模型和图片参数。', 401: '检查 API Key。', 403: '检查密钥权限。', 404: '检查完整 Base URL 和模型。', 429: '检查余额或限流。'}
    raise CallError('HTTP_ERROR', f'HTTP {exc.code}。' + hints.get(exc.code, '请核对服务商请求日志；不会自动重试。')) from None
  except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError):
    raise CallError('NETWORK_ERROR', '网络中断或超时。提交状态可能不确定，请核对服务商记录；不会自动重试。') from None


def encode_request(body, inputs, mask):
  if not inputs:
    return json.dumps(body, ensure_ascii=False).encode('utf-8'), 'application/json'
  boundary = 'playground-' + uuid.uuid4().hex
  parts = []
  for name, value in body.items():
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode('utf-8'))
  for i, (data, info) in enumerate(inputs + ([mask] if mask else [])):
    name = 'mask' if i == len(inputs) else 'image[]'
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="input-{i}.{info[0]}"\r\nContent-Type: image/{info[0]}\r\n\r\n'.encode('ascii') + data + b'\r\n')
  return b''.join(parts) + f'--{boundary}--\r\n'.encode('ascii'), 'multipart/form-data; boundary=' + boundary


def image_model_rule(profile, model):
  rules = profile.get('imageCapabilities') or {}
  rule = rules.get(model, {}) if isinstance(rules, dict) else None
  if not isinstance(rule, dict):
    raise CallError('INVALID_CONFIG', '图像模型限制配置格式错误。')
  for field in ('sizes', 'qualities', 'formats'):
    values = rule.get(field)
    if values is not None and (not isinstance(values, list) or any(not isinstance(value, str) for value in values)):
      raise CallError('INVALID_CONFIG', '图像模型限制列表格式错误。')
  if any(value != 'auto' and not re.fullmatch(r'[1-9]\d{0,4}x[1-9]\d{0,4}', value) for value in rule.get('sizes') or []):
    raise CallError('INVALID_CONFIG', '模型尺寸限制应为 auto 或合法的宽x高。')
  maximum = rule.get('maxInputImages')
  if maximum is not None and (type(maximum) is not int or not 0 <= maximum <= 16):
    raise CallError('INVALID_CONFIG', '模型参考图上限需为 0–16。')
  return rule


def validate_image_model(profile, body, input_count):
  rule = image_model_rule(profile, body['model'])
  for field, param, label in [('sizes', 'size', '尺寸'), ('qualities', 'quality', '质量'), ('formats', 'output_format', '格式')]:
    allowed = rule.get(field)
    if allowed and body[param] not in allowed:
      raise CallError('MODEL_CAPABILITY', f"模型 {body['model']} 的{label}仅支持 {'、'.join(allowed)}。")
  if not rule.get('sizes') and body['size'] != 'auto':
    match = re.fullmatch(r'(\d{1,4})x(\d{1,4})', body['size'])
    if not match:
      raise CallError('INVALID_ARGUMENT', '尺寸应为 auto、1k/2k/4k 或合法的宽x高。')
    width, height = map(int, match.groups())
    if not width or not height or width % 16 or height % 16 or max(width, height) > 3840 or max(width, height) > 3 * min(width, height) or not 655360 <= width * height <= 8294400:
      raise CallError('INVALID_ARGUMENT', '未配置模型专用尺寸时，尺寸需为 16 的倍数，长边不超过 3840，比例不超过 3:1，像素数为 655360–8294400。')
  if rule.get('transparent') is False and body.get('background') == 'transparent':
    raise CallError('MODEL_CAPABILITY', f"模型 {body['model']} 不支持原生透明背景。")
  if rule.get('maxInputImages') is not None and input_count > rule['maxInputImages']:
    raise CallError('MODEL_CAPABILITY', f"模型 {body['model']} 最多支持 {rule['maxInputImages']} 张参考图。")


def submit_image(args, profile, body, inputs, mask, endpoint, key, result):
  pool = profile.get('_desktop_candidates', [profile])
  if '_desktop_candidates' in profile:
    order = {p['id']: i for i, p in enumerate(candidates(profile.get('_desktop_selected'), args.saved_model))}
    pool = sorted((p for p in pool if p['id'] in order), key=lambda p: order[p['id']])
  for index, candidate in enumerate(pool):
    current = dict(body)
    if '_desktop_candidates' in profile:
      endpoint = normalize_url(candidate['baseUrl']) + ('/images/edits' if inputs else '/images/generations')
      current['model'] = args.saved_model or candidate['model']
      key = profile_key(candidate, args.saved_model)
      if not key or '\r' in key or '\n' in key:
        report_route(candidate['id'], False, 'MISSING_API_KEY')
        if index + 1 < len(pool):
          result['warnings'].append(f"配置 {candidate['name']} 缺少有效 Key，已切换备用。")
          continue
        raise CallError('MISSING_API_KEY', '主备配置均缺少可用 Key。')
      if not args.response_format:
        current.pop('response_format', None)
        if candidate.get('responseFormatB64Json'):
          current['response_format'] = 'b64_json'
    try:
      validate_image_model(candidate, current, len(inputs))
    except CallError as exc:
      if exc.code not in ('MODEL_CAPABILITY', 'INVALID_ARGUMENT') or index + 1 == len(pool): raise
      result['warnings'].append(f"配置 {candidate.get('name', '')} 不支持当前图像参数，未提交，继续检查备用。")
      continue
    payload, content_type = encode_request(current, inputs, mask)
    result.update({'endpoint': endpoint, 'model': current['model'], 'stage': 'submit'})
    result.pop('http_status', None)
    result['attempted_requests'] += 1
    try:
      raw = request(endpoint, args.timeout or candidate.get('timeout') or 600, result, payload, key, content_type)
      result['completed_requests'] += 1
      if '_desktop_candidates' in profile:
        report_route(candidate['id'], True)
        result['used_profile'] = {'id': candidate['id'], 'name': candidate['name'], 'model': current['model']}
      return raw
    except CallError as exc:
      if '_desktop_candidates' not in profile:
        raise
      status = result.get('http_status')
      refused = exc.code == 'HTTP_ERROR' and status in (401, 402, 403, 404, 429)
      if refused or exc.code == 'NETWORK_ERROR' or (isinstance(status, int) and status >= 500):
        report_route(candidate['id'], False, f'HTTP_{status}' if status else exc.code)
      if not refused or index + 1 == len(pool):
        raise
      result['warnings'].append(f"配置 {candidate['name']} 返回 HTTP {status}，已按顺序切换备用。")
  raise CallError('NO_AVAILABLE_PROFILE', '没有可用的主备配置。')


def main(argv=None):
  result = {'schema_version': 1, 'ok': False, 'request_mode': 'sync', 'stage': 'validate', 'attempted_requests': 0, 'completed_requests': 0, 'images': [], 'request_ids': [], 'warnings': []}
  code = 1
  try:
    parser = Parser(description=__doc__)
    prompts = parser.add_mutually_exclusive_group(required=True)
    prompts.add_argument('--prompt', help='图片生成或编辑提示词')
    prompts.add_argument('--prompt-file', help='UTF-8 提示词文件')
    parser.add_argument('--config', help='本地 JSON 配置或 Chat to image profiles 配置文件')
    parser.add_argument('--profile', help='配置 ID')
    parser.add_argument('--saved-profile', help='桌面已保存的配置 ID，默认使用主用方案')
    parser.add_argument('--saved-model', help='从已保存方案启用的模型中选择，备用必须支持同一模型')
    parser.add_argument('--base-url', help='完整 API 前缀，例如 https://api.example.com/v1')
    parser.add_argument('--model', help='服务商支持的图片模型 ID')
    parser.add_argument('--api-key-env', help='存放 Key 的环境变量名，默认 PLAYGROUND_API_KEY')
    parser.add_argument('--image', action='append', default=[], help='本地参考图，可重复，最多 16 张')
    parser.add_argument('--mask', help='有 Alpha 通道的 PNG 蒙版；透明区域用于修改')
    parser.add_argument('--size', default='1k', help='auto、宽x高、1k/2k/4k，可附 -landscape/-portrait')
    parser.add_argument('--quality', choices=['auto', 'low', 'medium', 'high', 'xhigh', 'max'], default='auto')
    parser.add_argument('--moderation', choices=['auto', 'low'])
    parser.add_argument('--output-compression', type=int)
    parser.add_argument('--format', choices=['png', 'jpeg', 'webp'], default='png')
    parser.add_argument('--background', choices=['auto', 'opaque', 'transparent'])
    parser.add_argument('--response-format', choices=['b64_json', 'url'], help='仅服务商要求时指定')
    parser.add_argument('--count', type=int, default=1, help='独立请求数，每次 n=1，默认最多两并发')
    parser.add_argument('--concurrency', type=int, choices=[1, 2], default=2, help='批次最大并发数，默认 2')
    parser.add_argument('--timeout', type=int, help='每次网络操作超时秒数，默认使用配置或 600 秒')
    parser.add_argument('--output', help='输出目录或单张图片文件名；默认保存在本机用户目录')
    parser.add_argument('--dry-run', action='store_true', help='只校验参数；不读取 Key、不联网、不写文件')
    args = parser.parse_args(argv)
    if args.saved_profile and (args.config or args.base_url or args.model or args.api_key_env):
      raise CallError('INVALID_ARGUMENT', '--saved-profile 不能与独立配置参数同时使用。')
    profile = load_profile(args)
    if args.saved_model and '_desktop_candidates' not in profile:
      raise CallError('INVALID_ARGUMENT', '--saved-model 只能用于桌面已保存的方案。')
    base_url = profile.get('baseUrl') if args.saved_profile else args.base_url or os.environ.get('PLAYGROUND_BASE_URL') or profile.get('baseUrl')
    model = profile.get('model') if args.saved_profile else args.model or os.environ.get('PLAYGROUND_MODEL') or profile.get('model')
    model = args.saved_model or model
    key_env = args.api_key_env or profile.get('apiKeyEnv') or 'PLAYGROUND_API_KEY'
    if not isinstance(base_url, str) or not base_url.strip() or not isinstance(model, str) or not model.strip():
      raise CallError('MISSING_CONFIG', '请用 run-app.cmd 打开桌面设置并填写 API；也可使用 --config 或环境变量。')
    if not isinstance(key_env, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key_env):
      raise CallError('INVALID_CONFIG', 'apiKeyEnv 必须是环境变量名。')
    base_url = normalize_url(base_url.strip()) if '_desktop_candidates' in profile else checked_url(base_url.strip())
    if profile.get('apiKey'):
      result['warnings'].append('配置文件中的 apiKey 已忽略；凭据仅从指定环境变量读取。')
    if profile.get('streamImages'):
      result['warnings'].append('此入口使用同步非流式请求，已忽略配置中的 streamImages。')
    prompt = Path(args.prompt_file).read_text(encoding='utf-8-sig') if args.prompt_file else args.prompt
    if not prompt.strip():
      raise CallError('INVALID_ARGUMENT', '提示词不能为空。')
    if not 1 <= args.count <= 100 or (args.timeout is not None and not 1 <= args.timeout <= 3600):
      raise CallError('INVALID_ARGUMENT', 'count 必须为 1–100，timeout 必须为 1–3600 秒。')
    if len(args.image) > 16 or (args.mask and not args.image):
      raise CallError('INVALID_ARGUMENT', '最多 16 张参考图；蒙版必须和参考图一起使用。')
    size = SIZES.get(args.size.lower(), re.sub(r'\s+', '', args.size.lower()).replace('×', 'x'))
    if args.background == 'transparent' and args.format == 'jpeg':
      raise CallError('INVALID_ARGUMENT', '透明背景需要 PNG 或 WebP。')
    inputs = []
    for index, image_path in enumerate(args.image):
      result['stage'] = 'validate_input'
      try:
        inputs.append(read_image(image_path))
      except CallError as exc:
        raise CallError(exc.code, f'第 {index + 1} 张参考图检查失败，尚未提交生图请求：{exc}') from None
    mask = None
    if args.mask:
      result['stage'] = 'validate_mask'
      try:
        mask = read_image(args.mask)
      except CallError as exc:
        raise CallError(exc.code, f'蒙版检查失败，尚未提交生图请求：{exc}') from None
    if mask and (mask[1][0] != 'png' or not mask[1][3] or mask[1][1:3] != inputs[0][1][1:3]):
      raise CallError('INVALID_MASK', '蒙版需为有 Alpha 通道的 PNG，尺寸与第一张参考图一致。')
    if sum(len(item[0]) for item in inputs) + (len(mask[0]) if mask else 0) > MAX_IMAGE_BYTES:
      raise CallError('IMAGE_TOO_LARGE', '参考图与蒙版合计不能超过 50 MiB。')
    body = {'model': model.strip(), 'prompt': prompt, 'size': size, 'quality': args.quality, 'output_format': args.format, 'n': 1}
    if args.moderation:
      body['moderation'] = args.moderation
    if args.output_compression is not None:
      if not 0 <= args.output_compression <= 100:
        raise CallError('INVALID_ARGUMENT', '压缩质量必须为 0–100。')
      body['output_compression'] = args.output_compression
    if args.background:
      body['background'] = args.background
    response_format = args.response_format or ('b64_json' if profile.get('responseFormatB64Json') else None)
    if response_format:
      body['response_format'] = response_format
    capability_error = None
    for candidate in profile.get('_desktop_candidates', [profile]):
      candidate_model = args.saved_model or candidate.get('model', model) if '_desktop_candidates' in profile else model.strip()
      try:
        validate_image_model(candidate, {**body, 'model': candidate_model}, len(inputs))
        capability_error = None
        break
      except CallError as exc:
        if exc.code not in ('MODEL_CAPABILITY', 'INVALID_ARGUMENT'): raise
        capability_error = exc
    if capability_error: raise capability_error
    endpoint = base_url + ('/images/edits' if inputs else '/images/generations')
    from playground_config import local_data_dir
    output = Path(args.output).expanduser().resolve() if args.output else local_data_dir() / 'outputs'
    suffixes = {'.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp'}
    is_file = output.suffix.lower() in suffixes and not output.is_dir()
    if is_file and (args.count != 1 or suffixes[output.suffix.lower()] != args.format):
      raise CallError('INVALID_OUTPUT', '指定文件名时 count 必须为 1，扩展名需匹配 --format。')
    job_id = uuid.uuid4().hex
    paths = [output] if is_file else [output / f'{job_id}-{i + 1}.{args.format}' for i in range(args.count)]
    if any(path.exists() for path in paths):
      raise CallError('OUTPUT_EXISTS', '输出文件已存在，请指定新文件名；不会覆盖。')
    result.update({'endpoint': endpoint, 'model': model.strip(), 'size': size, 'count': args.count, 'config_source': 'browser_sync' if '_browser_snapshot' in profile else 'manual', 'output_paths': [str(p) for p in paths]})
    if '_desktop_candidates' in profile:
      result['config_source'] = 'desktop'
      result['profile_order'] = [{'id': p['id'], 'name': p['name']} for p in profile['_desktop_candidates']]
    if args.dry_run:
      result.update({'ok': True, 'dry_run': True, 'stage': 'validated', 'credential_source': 'windows_dpapi' if '_browser_snapshot' in profile or '_desktop_candidates' in profile else 'environment', 'input_count': len(inputs), 'has_mask': bool(mask)})
      if '_browser_snapshot' not in profile and '_desktop_candidates' not in profile:
        result['api_key_env'] = key_env
    else:
      key = snapshot_key(profile['_browser_snapshot']) if '_browser_snapshot' in profile else os.environ.get(key_env, '').strip()
      if '_desktop_candidates' not in profile and (not key or '\r' in key or '\n' in key):
        raise CallError('MISSING_API_KEY', f'请在环境变量 {key_env} 中配置有效 API Key。')
      if args.count > 1 and args.concurrency > 1:
        from image_batch import run_image_batch
        result.update(run_image_batch(args, paths))
        if not result['ok']:
          raise CallError(result['error']['code'], result['error']['message'])
      else:
        for path in paths:
          result['stage'] = 'prepare_output'
          path.parent.mkdir(parents=True, exist_ok=True)
          # 先独占创建目标文件，防止覆盖，也在付费请求前发现路径或权限错误。
          with path.open('xb') as target:
            saved = False
            try:
              raw = submit_image(args, profile, body, inputs, mask, endpoint, key, result)
              result['stage'] = 'decode'
              response = json.loads(raw)
              data = response.get('data') if isinstance(response, dict) else None
              if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
                raise CallError('INVALID_RESPONSE', '接口未返回 n=1 对应的 data 图片列表。请核对服务商记录。')
              item = data[0]
              if isinstance(item.get('b64_json'), str) and item['b64_json']:
                image = base64.b64decode(item['b64_json'], validate=True)
              elif isinstance(item.get('url'), str):
                # 下载地址可能带签名查询参数，但不携带 API Key。
                image_url = urllib.parse.urlsplit(item['url'])
                checked_url(urllib.parse.urlunsplit(image_url._replace(query='', fragment='')))
                result['stage'] = 'download'
                image = request(item['url'], args.timeout or profile.get('timeout') or 600, result)
              else:
                raise CallError('INVALID_RESPONSE', '接口返回的图片缺少 b64_json 或 URL。')
              if len(image) > MAX_IMAGE_BYTES:
                raise CallError('IMAGE_TOO_LARGE', '输出图片超过 50 MiB。')
              result['stage'] = 'validate_output'
              try:
                info = image_info(image)
              except CallError as exc:
                raise CallError(exc.code, f'接口返回的图片检查失败：{exc}') from None
              if info[0] != args.format:
                raise CallError('FORMAT_MISMATCH', '服务商返回的图片格式与 --format 不一致。请检查服务商的参数支持情况。')
              if size != 'auto' and f'{info[1]}x{info[2]}' != size:
                result['warnings'].append(f'实际返回尺寸为 {info[1]}x{info[2]}，请求尺寸为 {size}。')
              result['stage'] = 'save'
              target.write(image)
              target.flush()
              os.fsync(target.fileno())
              saved = True
              result['images'].append({'path': str(path), 'format': info[0], 'width': info[1], 'height': info[2], 'bytes': len(image),
                'used_profile': result.get('used_profile'), 'revised_prompt': item.get('revised_prompt')})
            finally:
              if not saved:
                target.close()
                path.unlink(missing_ok=True)
        result.update({'ok': True, 'stage': 'done'})
    code = 0
  except (CallError, OSError, ValueError, binascii.Error, KeyboardInterrupt) as exc:
    error_code = exc.code if isinstance(exc, CallError) else ('INTERRUPTED' if isinstance(exc, KeyboardInterrupt) else 'LOCAL_OR_RESPONSE_ERROR')
    message = str(exc) if isinstance(exc, CallError) else '本地文件、响应解析或用户中断错误。请检查路径与服务商请求记录。'
    result['error'] = {'code': error_code, 'message': message}
    if result['attempted_requests']:
      result['warnings'].append('已提交过请求，服务商可能已计费；不要自动重跑。已保存图片见 images。')
  print(json.dumps(result, ensure_ascii=False))
  return code


if __name__ == '__main__':
  sys.stdout.reconfigure(encoding='utf-8')
  sys.stderr.reconfigure(encoding='utf-8')
  sys.exit(main())
