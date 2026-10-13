"""Gemini 原生图片协议；桌面与 CLI 共用。"""
import base64
import re
from urllib.parse import quote

from ui_language import t


def gemini_endpoint(base_url, model):
  base = base_url.rstrip('/')
  if '://' not in base:
    base = 'https://' + base
  base = re.sub(r'/models/[^/]+:(?:streamGenerateContent|generateContent)$', '', base)
  base = re.sub(r'/v1$', '/v1beta', base)
  if not re.search(r'/v1(?:beta)?$', base):
    base += '/v1beta'
  return base + '/models/' + quote(model.removeprefix('models/'), safe='') + ':generateContent'


def gemini_request(body, inputs, mask):
  if mask:
    raise ValueError(t('Gemini 原生接口不支持蒙版参数，请使用参考图并在提示词中描述修改区域。', 'The native Gemini API does not support masks. Use a reference image and describe the area to edit in the prompt.'))
  if body.get('background') == 'transparent':
    raise ValueError(t('Gemini 原生接口不支持透明背景参数，请在设置中选择本地透明处理。', 'The native Gemini API does not support the transparent background parameter. Select local transparency processing in Settings.'))
  parts = [{'text': body['prompt']}]
  parts.extend({'inlineData': {'mimeType': 'image/' + info[0], 'data': base64.b64encode(data).decode('ascii')}} for data, info in inputs)
  generation = {'responseModalities': ['TEXT', 'IMAGE']}
  if body['size'] != 'auto':
    width, height = map(int, body['size'].split('x'))
    ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
    ratio = min(ratios, key=lambda item: abs(int(item.split(':')[0]) / int(item.split(':')[1]) - width / height))
    generation['imageConfig'] = {'aspectRatio': ratio, 'imageSize': '1K' if max(width, height) <= 1536 else '2K' if max(width, height) <= 2560 else '4K'}
  return {'contents': [{'role': 'user', 'parts': parts}], 'generationConfig': generation}


def gemini_images(response):
  candidates = response.get('candidates') if isinstance(response, dict) else None
  first = candidates[0] if isinstance(candidates, list) and candidates else None
  content = first.get('content') if isinstance(first, dict) else None
  parts = content.get('parts') if isinstance(content, dict) else None
  images = []
  for part in parts if isinstance(parts, list) else []:
    if not isinstance(part, dict):
      continue
    inline = part.get('inlineData') or part.get('inline_data')
    if isinstance(inline, dict) and isinstance(inline.get('data'), str) and inline['data']:
      images.append({'b64_json': inline['data']})
  if not images:
    raise ValueError(t('Gemini 未返回图片，可能只返回文字或被服务商拦截；请核对服务商记录。', 'Gemini returned no image. It may have returned text only or been blocked by the provider. Check the provider records.'))
  return images
