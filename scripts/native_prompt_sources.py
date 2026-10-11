"""现有提示词网站的原生 Python 读取与解析。"""
import json
import re
import urllib.error
import urllib.request

from playground_image import CallError, NoRedirect, image_info

SOURCES = [
  {'id': 'garden', 'name': '水仙', 'home': 'https://prompt.qqsrc.com/', 'categories': []},
  {'id': 'promptfill', 'name': 'PromptFill', 'home': 'https://promptfill.tanshilong.com/explore', 'categories': []},
  {'id': 'youmind', 'name': 'YouMind', 'home': 'https://youmind.com/zh-CN/nano-banana-pro-prompts', 'categories': []},
  {'id': 'pixto', 'name': 'PixtoAI', 'home': 'https://www.pixtoai.com/styles/', 'categories': []},
  {'id': 'nanoimage', 'name': 'NanoPrompts GPT-2', 'home': 'https://nanoprompts.org/zh/gpt-image-2', 'categories': []},
  {'id': 'nano', 'name': 'NanoPrompts', 'home': 'https://nanoprompts.org/zh', 'categories': []},
  {'id': 'hero', 'name': 'HeroPrompt', 'home': 'https://heroprompt.sortes.ai/zh', 'categories': []},
]
MAX_PROMPT_IMAGE_BYTES = 32 * 1024 * 1024
IMAGE_PREFIXES = ('https://r2.qqsrc.com/images/', 'https://cms-assets.youmind.com/media/',
  'https://cdn.youmindassets.com/gen-images/', 'https://s3.bmp.ovh/imgs/', 'https://s41.ax1x.com/',
  'https://img.wjwj.top/', 'https://banana-prompt.nanoprompts.org/', 'https://turing-img.animelook.top/pic/',
  'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/')
LABELS = {'Trending': '热门', 'Artistic': '艺术', 'Character': '角色', 'Image Editing': '图片编辑', 'Info Viz': '信息可视化',
  'Lab': '创意实验', 'Manga': '漫画', 'Map': '地图', 'Marketing': '营销', 'Portrait': '人像', 'Product Design': '产品设计',
  'Spatial': '空间', 'Editing': '图片编辑', 'Multi-image': '多图融合', 'Product': '产品', 'Style Transfer': '风格转换', 'Text & Poster': '图文海报'}


def prompt_image_url(value):
  if not isinstance(value, str) or '..' in value:
    return ''
  if value.startswith('https://pbs.twimg.com/media/'):
    return value if re.fullmatch(r'https://pbs\.twimg\.com/media/[A-Za-z0-9_-]+(?:\.(?:jpg|png|webp))?(?:\?format=(?:jpg|png|webp)&name=(?:orig|large|medium|small)|\?name=(?:orig|large|medium|small)&format=(?:jpg|png|webp))?', value) else ''
  return value if value.startswith(IMAGE_PREFIXES) and re.fullmatch(r'https://[A-Za-z0-9.-]+/[A-Za-z0-9_./-]+', value) else ''


def localized(value):
  if isinstance(value, str):
    return value.strip()
  if isinstance(value, dict):
    return str(value.get('cn') or value.get('en') or '').strip()
  return ''


def _record(source, item_id, title, prompt, category='未分类', image='', url='', categories=None, params=None):
  if not title or not prompt:
    return None
  value = {'id': f'{source}-{item_id}', 'source': source, 'title': title.strip(), 'prompt': prompt.strip(),
    'category': category or '未分类', 'sourceUrl': url or next(row['home'] for row in SOURCES if row['id'] == source)}
  if image:
    value['images'] = [image]
  if categories:
    value['categories'] = categories
  if params:
    value['params'] = params
  return value


def normalize_source(source, value):
  if source == 'garden':
    if not isinstance(value, list): raise ValueError('水仙的数据格式已变化，请稍后重试。')
    result = []
    for item in value:
      if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] <= 0 or not isinstance(item.get('title'), str) or not isinstance(item.get('prompt'), str): continue
      row = _record(source, item['id'], item['title'].strip(), item['prompt'].strip(), item.get('category', '未分类'),
        prompt_image_url('https://r2.qqsrc.com/' + item['image']) if isinstance(item.get('image'), str) else '', f"https://prompt.qqsrc.com/detail.html?id={item['id']}")
      if row: result.append(row)
    return result
  if source == 'promptfill':
    config = value.get('templates', {}).get('config') if isinstance(value, dict) else None
    bank_data = value.get('banks') if isinstance(value, dict) else None
    defaults = bank_data.get('defaults') if isinstance(bank_data, dict) else None
    if defaults is None and isinstance(bank_data, dict) and isinstance(bank_data.get('banks'), dict):
      defaults = {key: localized(options[0]) for key, bank in bank_data['banks'].items()
        if isinstance(bank, dict) and isinstance((options := bank.get('options')), list) and options and localized(options[0])}
    if not isinstance(config, list) or not isinstance(defaults, dict): raise ValueError('PromptFill 的模板格式已变化，请刷新重试。')
    result = []
    for item in config:
      if not isinstance(item, dict) or not isinstance(item.get('id'), str) or item.get('type') == 'video': continue
      title, prompt = localized(item.get('name')), localized(item.get('content'))
      counts = {}
      def replace(match):
        body = match.group(1)
        key, sep, inline = body.partition(':')
        key = key.strip(); inline = inline.lstrip(':').strip() if sep else ''
        idx = counts.get(key, 0); counts[key] = idx + 1
        selections = item.get('selections') if isinstance(item.get('selections'), dict) else {}
        return localized(selections.get(f'{key}-{idx}')) or localized(selections.get(key)) or inline or localized(defaults.get(re.sub(r'_\d+$', '', key))) or match.group(0)
      prompt = re.sub(r'\{\{(.*?)\}\}', replace, prompt)
      categories = list(dict.fromkeys(tag.strip() for tag in item.get('tags', []) if isinstance(tag, str) and tag.strip())) if isinstance(item.get('tags'), list) else []
      row = _record(source, item['id'], title, prompt, categories[0] if categories else '未分类', prompt_image_url(item.get('imageUrl')), categories=categories or ['未分类'])
      if row: result.append(row)
    return result
  if source == 'youmind':
    if not isinstance(value, list): raise ValueError('YouMind 的目录格式已变化，请刷新重试。')
    result = []
    for item in value:
      if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] <= 0 or not isinstance(item.get('title'), str): continue
      prompt = localized(item.get('translatedContent')) or localized(item.get('content'))
      prompt = re.sub(r'\{argument\s+[^{}]*?default=(?:"([^"{}]*)"|\'([^\'{}]*)\')[^{}]*\}', lambda m: m.group(1) if m.group(1) is not None else m.group(2), prompt)
      media = item.get('media') if isinstance(item.get('media'), list) else []
      row = _record(source, item['id'], item.get('title', '').strip(), prompt, '需要参考图' if item.get('needReferenceImages') is True else '无需参考图', prompt_image_url(media[0]) if media else '', f"https://youmind.com/zh-CN/nano-banana-pro-prompts/explore?id={item['id']}")
      if row: result.append(row)
    return result
  if not isinstance(value, list): raise ValueError('网站目录格式已变化，请稍后重试。')
  result = []
  for item in value:
    if not isinstance(item, dict): continue
    if source == 'pixto':
      if type(item.get('id')) is not int or item['id'] <= 0 or item.get('category_id') == 48: continue
      prompt = '\n\n'.join(filter(None, (localized(item.get('pre_prompt')), localized(item.get('fe_prompt')))))
      category = localized((item.get('category') or {}).get('name')) if isinstance(item.get('category'), dict) else ''
      row = _record(source, item['id'], localized(item.get('name')), prompt, category, prompt_image_url(item.get('logo')), f"https://www.pixtoai.com/style/{item['id']}/")
    elif source == 'hero':
      if not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', item['id']): continue
      i18n = item.get('i18nContent') or {}; cn = i18n.get('zh-CN') or {}; en = i18n.get('en') or {}
      title, prompt = localized(cn.get('title')) or localized(en.get('title')), localized(cn.get('prompt')) or localized(en.get('prompt'))
      prompt = re.sub(r'\{\{([^{}]+)\}\}', lambda m: (m.group(1).split('|')[2:] and '|'.join(m.group(1).split('|')[2:]).strip()) or m.group(0) if len(m.group(1).split('|')) >= 3 else m.group(0), prompt)
      tags = ((item.get('tagsArray') or {}).get('zh-CN') or (item.get('tagsArray') or {}).get('en') or [])
      categories = list(dict.fromkeys(tag.strip() for tag in tags if isinstance(tag, str) and tag.strip())) if isinstance(tags, list) else []
      row = _record(source, item['id'], title, prompt, categories[0] if categories else '未分类', prompt_image_url(item.get('imageUrl')), f"https://heroprompt.sortes.ai/zh/posts/{item['id']}", categories or ['未分类'])
    else:
      if not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', item['id']): continue
      category = localized(item.get('category_label')) or LABELS.get(item.get('category'), localized(item.get('category')))
      link = item.get('link', '')
      url = 'https://nanoprompts.org' + link if isinstance(link, str) and link.startswith('/zh/') else next(row['home'] for row in SOURCES if row['id'] == source)
      row = _record(source, item['id'], localized(item.get('title')), localized(item.get('prompt')), category, prompt_image_url(item.get('image_url')), url)
    if row: result.append(row)
  return result


def _json(url, data=None, headers=None):
  request = urllib.request.Request(url, data=data, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', **(headers or {})})
  try:
    with urllib.request.urlopen(request, timeout=15) as response:
      raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024: raise ValueError('提示词网站目录超过大小限制。')
    return json.loads(raw)
  except urllib.error.HTTPError as error:
    raise ValueError(f'目录读取失败（HTTP {error.code}），原缓存已保留。') from None
  except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeError):
    raise ValueError('目录连接失败或超时，原缓存已保留。') from None


def download_bytes(url):
  if not prompt_image_url(url):
    raise ValueError('图片地址不在提示词来源允许的范围内。')
  request = urllib.request.Request(url, headers={'User-Agent': 'Chat-to-image-Desktop/1', 'Accept': 'image/*'})
  opener = urllib.request.build_opener(NoRedirect)
  try:
    with opener.open(request, timeout=15) as response:
      raw = response.read(MAX_PROMPT_IMAGE_BYTES + 1)
    if len(raw) > MAX_PROMPT_IMAGE_BYTES:
      raise ValueError('提示词预览图超过 32 MiB。')
    image_info(raw)
    return raw
  except urllib.error.HTTPError as error:
    if 300 <= error.code < 400:
      raise ValueError('提示词预览图源不允许重定向。') from None
    raise ValueError(f'预览图读取失败（HTTP {error.code}）。') from None
  except (urllib.error.URLError, TimeoutError, OSError):
    raise ValueError('提示词预览图连接失败或超时。') from None
  except CallError:
    raise ValueError('提示词预览图不是完整的 PNG、JPEG 或 WebP 图片。') from None

def fetch_source(source, progress=lambda _message: None):
  if source == 'garden':
    parts = []
    for part in (1, 2, 3):
      if progress: progress(f'正在读取水仙目录：{part} / 3')
      parts.append(_json(f'https://prompt.qqsrc.com/data/prompts.part{part}.json'))
    if any(not normalize_source(source, part) for part in parts): raise ValueError('水仙返回了空目录，原缓存已保留。')
    return [item for part in parts for item in part]
  if source == 'promptfill':
    templates = _json('https://promptfill.tanshilong.com/data/templates.json')
    if progress: progress('正在读取 PromptFill 分类…')
    banks = _json('https://promptfill.tanshilong.com/data/banks.json')
    return {'templates': templates, 'banks': banks}
  if source in ('nano', 'nanoimage'):
    filename = 'prompts_zh.json' if source == 'nano' else 'prompts_gpt_image_2_zh.json'
    return _json('https://nanoprompts.org/assets/data/' + filename)
  if source not in {row['id'] for row in SOURCES}: raise ValueError('未知提示词库。')
  first = _read_page(source, 1)
  pages = [first['prompts']]
  for page in range(2, first['totalPages'] + 1):
    pages.append(_read_page(source, page)['prompts'])
    progress(f"正在读取 {next(row['name'] for row in SOURCES if row['id'] == source)} 目录：{page} / {first['totalPages']} 页")
  return [item for page in pages for item in page]


def _read_page(source, page):
  if source == 'youmind':
    payload = {'model': 'nano-banana-pro', 'page': page, 'limit': 100, 'locale': 'zh-CN', 'campaign': 'nano-banana-pro-prompts', 'filterMode': 'imageCategories'}
    result = _json('https://youmind.com/youmarketing-api/prompts', json.dumps(payload).encode('utf-8'), {'Content-Type': 'application/json', 'Referer': 'https://youmind.com/zh-CN/nano-banana-pro-prompts/explore'})
    if not isinstance(result, dict) or not isinstance(result.get('prompts'), list) or result.get('page') != page or type(result.get('totalPages')) is not int or not 1 <= result['totalPages'] <= 1000: raise ValueError('YouMind 目录格式已变化，原缓存已保留。')
    return {'prompts': result['prompts'], 'totalPages': result['totalPages']}
  if source == 'hero':
    result = _json(f'https://heroprompt.sortes.ai/api/posts?offset={(page - 1) * 50}&limit=50&q=&tags=&sort=new')
    if not isinstance(result, dict) or not isinstance(result.get('posts'), list) or type(result.get('total')) is not int or not 0 <= result['total'] <= 50000: raise ValueError('HeroPrompt 目录格式已变化，原缓存已保留。')
    return {'prompts': result['posts'], 'totalPages': max(1, (result['total'] + 49) // 50)}
  result = _json(f'https://camera.animelook.top/api/normal/web-styles?page={page}')
  data = result.get('data') if isinstance(result, dict) else None
  if not isinstance(result, dict) or result.get('code') != 0 or not isinstance(data, dict) or not isinstance(data.get('data'), list) or data.get('current_page') != page or type(data.get('last_page')) is not int or not 1 <= data['last_page'] <= 1000: raise ValueError('PixtoAI 目录格式已变化，原缓存已保留。')
  return {'prompts': data['data'], 'totalPages': data['last_page']}
