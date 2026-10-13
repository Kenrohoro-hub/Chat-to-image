"""图像协议识别与 Seedream / Qwen 的同步 JSON 请求。"""
import base64
import re
from urllib.parse import urlsplit, urlunsplit

from ui_language import t


def resolve_image_protocol(profile, model):
  if profile.get('provider', 'openai') != 'openai' or profile.get('apiMode', 'images') != 'images':
    return 'openai'
  protocol = profile.get('imageProtocol') or 'auto'
  if protocol != 'auto':
    return protocol
  name = (model or '').removeprefix('models/').lower()
  if name.startswith('gemini-'):
    return 'gemini'
  if name.startswith(('seedream-', 'doubao-seedream-')):
    return 'seedream'
  if name.startswith('qwen-image'):
    return 'qwen'
  raw = profile.get('baseUrl') or ''
  try:
    host = urlsplit(raw if '://' in raw else 'https://' + raw).hostname or ''
  except ValueError:
    return 'openai'
  if re.fullmatch(r'ark\.[^.]+\.volces\.com', host, re.I):
    return 'seedream'
  return 'openai'


def json_image_endpoint(base_url, protocol):
  raw = base_url.strip().rstrip('/')
  url = urlsplit(raw if '://' in raw else 'https://' + raw)
  path = url.path.rstrip('/')
  if path.endswith('/images/generations'):
    return urlunsplit(url._replace(path=path))
  if not path:
    path = '/api/v3' if protocol == 'seedream' else '/compatible-mode/v1'
  return urlunsplit(url._replace(path=path + '/images/generations'))


def validate_json_image(protocol, body, input_count):
  model = body['model'].lower()
  old_seedream = bool(re.search(r'seedream-4[.-][05]', model))
  high_resolution = bool(re.search(r'seedream-(?:4[.-]5|5[.-]0-lite)', model))
  if protocol == 'seedream':
    minimum = 3686400 if high_resolution else 921600
    maximum = 16777216 if old_seedream or high_resolution else 4624220
    ratio = 16
    max_inputs = 14 if old_seedream or high_resolution else 10
    if body['output_format'] == 'webp':
      raise ValueError(t('Seedream 原生输出格式支持 PNG 或 JPEG，请选择其中一种。', 'Seedream supports PNG or JPEG output. Select one of those formats.'))
  else:
    minimum, maximum, ratio = 262144, 4194304, 8
    max_inputs = 10 if re.match(r'qwen-image-2[.-]1', model) else 3
  if input_count > max_inputs:
    raise ValueError(t(f'{body["model"]} 最多支持 {max_inputs} 张参考图。', f'{body["model"]} supports up to {max_inputs} reference images.'))
  if body['size'] != 'auto':
    match = re.fullmatch(r'([1-9]\d{0,4})x([1-9]\d{0,4})', body['size'])
    if not match:
      raise ValueError(t('尺寸应为 auto 或合法的宽x高。', 'Size must be auto or a valid width-by-height value.'))
    width, height = map(int, match.groups())
    if not minimum <= width * height <= maximum or max(width, height) > ratio * min(width, height):
      raise ValueError(t(f'{body["model"]} 的总像素需为 {minimum}–{maximum}，宽高比需在 1:{ratio} 至 {ratio}:1 之间；也可使用自动尺寸。', f'{body["model"]} requires {minimum}–{maximum} pixels and an aspect ratio between 1:{ratio} and {ratio}:1. You can also use auto size.'))


def json_image_request(protocol, body, inputs, mask):
  validate_json_image(protocol, body, len(inputs))
  if mask:
    raise ValueError(t('此生图协议不支持蒙版参数，请使用参考图并在提示词中说明修改区域。', 'This image protocol does not support masks. Use a reference image and describe the edit in the prompt.'))
  result = {'model': body['model'], 'prompt': body['prompt']}
  if protocol == 'qwen' or body['size'] != 'auto':
    result['size'] = body['size']
  if protocol == 'seedream':
    if any(len(data) > 30 * 1024 * 1024 for data, _ in inputs):
      raise ValueError(t('Seedream 单张参考图不能超过 30 MiB。', 'Each Seedream reference image must be at most 30 MiB.'))
    if any(min(info[1:3]) <= 14 or info[1] * info[2] > 36000000 or max(info[1:3]) > 16 * min(info[1:3]) for _, info in inputs):
      raise ValueError(t('Seedream 参考图宽高需大于 14 像素，总像素不超过 3600 万，宽高比不超过 16:1。', 'Seedream reference dimensions must exceed 14 pixels, with at most 36 million pixels and an aspect ratio no greater than 16:1.'))
    if re.search(r'seedream-5[.-]0', body['model'], re.I):
      result['output_format'] = body['output_format']
    result['response_format'] = body.get('response_format', 'url')
  else:
    if any(len(data) > 10 * 1024 * 1024 for data, _ in inputs):
      raise ValueError(t('Qwen-Image 单张参考图不能超过 10 MiB。', 'Each Qwen-Image reference image must be at most 10 MiB.'))
    if any(max(info[1:3]) > 8000 or max(info[1:3]) > 10 * min(info[1:3]) for _, info in inputs):
      raise ValueError(t('Qwen-Image 参考图宽高不能超过 8000 像素，宽高比不能超过 10:1。', 'Qwen-Image reference dimensions must not exceed 8000 pixels, with an aspect ratio no greater than 10:1.'))
    result['n'] = 1
  if body.get('background') == 'transparent':
    supported = protocol == 'seedream' and re.search(r'seedream-5[.-]0-(?:pro|flash)', body['model'], re.I)
    if not supported or len(inputs) != 1 or inputs[0][1][0] != 'png' or not inputs[0][1][3] or body['output_format'] != 'png':
      raise ValueError(t('此协议的原生透明背景仅支持 Seedream 5.0 Pro/Flash，且需要一张带透明通道的 PNG 参考图和 PNG 输出；其他场景可使用本地透明处理。', 'Native transparency requires Seedream 5.0 Pro/Flash, one PNG reference with an alpha channel, and PNG output. Use local transparency processing for other cases.'))
    result['background'] = 'transparent'
  images = ['data:image/' + info[0] + ';base64,' + base64.b64encode(data).decode('ascii') for data, info in inputs]
  if images:
    result['image'] = images[0] if len(images) == 1 else images
  return result
