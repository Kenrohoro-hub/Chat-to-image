import codecs
import json
from urllib.parse import urlsplit

from PySide6.QtCore import QEventLoop, QTimer, QUrl
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest

from desktop_config import normalize_url


REJECTION_STATUSES = {401, 402, 403, 404, 429}
IMAGE_TOOLS = [
  {
    'type': 'function',
    'name': name,
    'description': description,
    'parameters': {
      'type': 'object',
      'properties': {
        'id': {'type': 'string'},
        'prompt': {'type': 'string'},
      },
      'required': ['id', 'prompt'],
      'additionalProperties': False,
    },
    'strict': False,
  }
  for name, description in (
    ('generate_image', 'Generate one image using the selected gallery settings.'),
    ('edit_image', 'Edit a referenced image using the selected gallery settings.'),
  )
]


def route_profiles(settings, profile_id=None):
  profiles = settings.get('profiles', [])
  by_id = {p.get('id'): p for p in profiles if isinstance(p, dict)}
  if profile_id:
    profile = by_id.get(profile_id)
    if not profile or profile.get('provider') != 'openai' or profile.get('apiMode') != 'responses':
      raise ValueError('所选配置不是可用的 Responses 配置。')
    return [profile]

  pool = settings.get('agentFailover') or {}
  ids = pool.get('slots') or [p.get('id') for p in profiles if p.get('provider') == 'openai' and p.get('apiMode') == 'responses']
  primary_id = pool.get('primaryId')
  ids = ([primary_id] if primary_id in ids else []) + [item for item in ids if item != primary_id]
  model = settings.get('agentModel')
  if model:
    ids = [item for item in ids if item in by_id and model in (by_id[item].get('models') or [by_id[item].get('model')])]
  disabled = set(pool.get('disabledIds') or [])
  if pool and not pool.get('enabled', True):
    ids = ids[:1]
  result = [by_id[item] for item in ids if item in by_id and item not in disabled
            and by_id[item].get('provider') == 'openai' and by_id[item].get('apiMode') == 'responses']
  if not result:
    raise ValueError('Agent 没有已启用的 Responses 配置。')
  return result


def parse_sse(lines):
  event = 'message'
  data = []
  for raw in lines:
    line = raw.decode('utf-8', errors='replace') if isinstance(raw, bytes) else str(raw)
    line = line.rstrip('\r\n')
    if not line:
      if data:
        payload = '\n'.join(data)
        try:
          yield event, json.loads(payload)
        except json.JSONDecodeError:
          yield event, payload
      event, data = 'message', []
      continue
    if line.startswith(':'):
      continue
    key, sep, value = line.partition(':')
    if not sep:
      continue
    value = value[1:] if value.startswith(' ') else value
    if key == 'event':
      event = value
    elif key == 'data':
      data.append(value)
  if data:
    payload = '\n'.join(data)
    try:
      yield event, json.loads(payload)
    except json.JSONDecodeError:
      yield event, payload


def _endpoint(profile):
  normalized = normalize_url(profile.get('baseUrl', ''))
  url = urlsplit(normalized)
  if not url.hostname:
    raise ValueError('Responses 配置缺少服务地址。')
  return url, (url.path.rstrip('/') + '/responses')


def _input_messages(messages, vision=False):
  content = []
  for message in messages:
    role = message.get('role')
    if message.get('type') in ('function_call', 'function_call_output', 'reasoning', 'web_search_call', 'image_generation_call', 'computer_call', 'code_interpreter_call'):
      content.append(message)
      continue
    if role not in ('user', 'assistant', 'system', 'developer'):
      continue
    text = message.get('content', '')
    if role == 'user' and message.get('imageDataUrls'):
      parts = [{'type': 'input_text', 'text': text}]
      if vision:
        parts.extend({'type': 'input_image', 'image_url': image} for image in message['imageDataUrls'])
      else:
        parts[0]['text'] = (text + '\n[图片附件已保留，但当前模型明确不支持视觉输入。]').strip()
      content.append({'role': role, 'content': parts})
    else:
      content.append({'role': role, 'content': text})
  return content


def _sse_feed(state, chunk, on_event, final=False):
  state['buffer'] += state['decoder'].decode(chunk, final=final)

  def dispatch():
    if state['data']:
      payload = '\n'.join(state['data'])
      try:
        on_event(state['event'], json.loads(payload))
      except json.JSONDecodeError:
        on_event(state['event'], payload)
    state['event'], state['data'] = 'message', []

  if final and state['buffer'] and not state['buffer'].endswith('\n'):
    state['buffer'] += '\n'
  while '\n' in state['buffer']:
    line, state['buffer'] = state['buffer'].split('\n', 1)
    line = line.rstrip('\r')
    if not line:
      dispatch()
    elif not line.startswith(':'):
      key, sep, value = line.partition(':')
      value = value[1:] if value.startswith(' ') else value
      if key == 'event':
        state['event'] = value
      elif key == 'data':
        state['data'].append(value)
  if final:
    if state['buffer'] and not state['buffer'].startswith(':'):
      key, sep, value = state['buffer'].partition(':')
      value = value[1:] if value.startswith(' ') else value
      if key == 'event':
        state['event'] = value
      elif key == 'data':
        state['data'].append(value)
      state['buffer'] = ''
    dispatch()

def _post(profile, url, path, body, cancel, on_event=None):
  manager = QNetworkAccessManager()
  request_url = url._replace(path=path).geturl()
  request = QNetworkRequest(QUrl(request_url))
  request.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, 'application/json')
  request.setRawHeader(b'Authorization', ('Bearer ' + profile.get('apiKey', '')).encode('utf-8'))
  request.setRawHeader(b'Accept', b'text/event-stream' if body.get('stream') else b'application/json')
  request.setAttribute(QNetworkRequest.Attribute.RedirectPolicyAttribute, QNetworkRequest.RedirectPolicy.ManualRedirectPolicy)
  request.setTransferTimeout(max(1, min(int(profile.get('timeout', 600)), 3600)) * 1000)
  reply = manager.post(request, json.dumps(body, ensure_ascii=False).encode('utf-8'))
  loop = QEventLoop()
  timer = QTimer()
  timer.setInterval(40)
  response = bytearray()
  parser = {'buffer': '', 'event': 'message', 'data': [], 'decoder': codecs.getincrementaldecoder('utf-8')()}
  event_error = []

  def dispatch(event, payload):
    try:
      on_event(event, payload)
    except Exception as error:
      event_error.append(error)
      reply.abort()

  def read_ready():
    if not reply.isOpen(): return
    chunk = bytes(reply.readAll())
    if on_event:
      _sse_feed(parser, chunk, dispatch)
    else:
      response.extend(chunk)

  def check_cancel():
    if cancel.is_set() and not reply.isFinished():
      reply.abort()

  reply.readyRead.connect(read_ready)
  reply.finished.connect(loop.quit)
  timer.timeout.connect(check_cancel)
  timer.start()
  if cancel.is_set():
    reply.abort()
  if not reply.isFinished():
    loop.exec()
  read_ready()
  if on_event:
    _sse_feed(parser, b'', dispatch, final=True)
  timer.stop()
  status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute) or 0
  error = reply.error()
  reply.deleteLater()
  manager.deleteLater()
  if cancel.is_set():
    raise InterruptedError('请求已取消。')
  if status in REJECTION_STATUSES:
    raise PermissionError('接口拒绝请求（HTTP %s）。' % status)
  if status < 200 or status >= 300:
    raise RuntimeError('Responses 请求失败（HTTP %s），未自动重试。' % status)
  if event_error:
    raise event_error[0]
  if error != reply.NetworkError.NoError:
    raise RuntimeError('Responses 连接中断，未自动重试。')
  return bytes(response)

def _request(profile, settings, messages, cancel, on_delta=None):
  if cancel.is_set():
    raise InterruptedError('请求已取消。')
  model = settings.get('agentModel') or profile.get('model')
  if not model:
    raise ValueError('Responses 配置缺少模型。')
  if profile.get('models') and model not in profile['models']:
    raise ValueError('所选模型未在当前 Responses 配置中启用。')
  capability = (profile.get('modelCapabilities') or {}).get(model, {})
  effort = settings.get('agentReasoningEffort')
  if effort and (capability.get('reasoning') is False or (capability.get('reasoningEfforts') and effort not in capability['reasoningEfforts'])):
    raise ValueError('模型「%s」不支持所选推理强度 %s。' % (model, effort))
  instructions = '你是对话与图像创作助手。按用户语言回复。新图使用 generate_image，修改已有图使用 edit_image，并引用对应参考图标签。只在用户明确要求时调用图像工具。'
  if settings.get('allowPromptRewrite') is False:
    instructions += ' 生成图片时保留用户指定提示词，不擅自改写。'
  if settings.get('agentMathFormattingPrompt'):
    instructions += ' 数学公式使用纯文本或普通 Markdown 表达，避免依赖 KaTeX 等原生界面无法保证支持的格式。'
  body = {
    'model': model,
    'instructions': instructions,
    'input': _input_messages(messages, capability.get('vision') is not False),
    'stream': bool(profile.get('streamImages', True)),
  }
  if effort:
    body['reasoning'] = {'effort': effort}
  tools = IMAGE_TOOLS[:] if settings.get('agentImageTools', True) and capability.get('tools') is not False else []
  if settings.get('agentWebSearch'):
    tools.append({'type': 'web_search'})
  if tools:
    body['tools'] = tools
  text_parts = []
  output = {}
  order = []
  full = None

  def handle_event(event, payload):
    nonlocal full, output, order
    if not isinstance(payload, dict):
      return
    if event == 'response.output_text.delta':
      delta = payload.get('delta', '')
      if delta:
        text_parts.append(delta)
        if on_delta:
          on_delta(delta)
    elif event in ('response.output_item.added', 'response.output_item.done'):
      item = payload.get('item') or {}
      index = payload.get('output_index')
      if isinstance(index, int):
        output[index] = item
        if index not in order:
          order.append(index)
    elif event == 'response.function_call_arguments.delta':
      index = payload.get('output_index')
      if isinstance(index, int):
        item = output.setdefault(index, {'type': 'function_call'})
        item['arguments'] = item.get('arguments', '') + payload.get('delta', '')
    elif event == 'response.function_call_arguments.done':
      index = payload.get('output_index')
      if isinstance(index, int):
        item = output.setdefault(index, {'type': 'function_call'})
        item['arguments'] = payload.get('arguments', item.get('arguments', ''))
    elif event in ('response.failed', 'error'):
      raise RuntimeError('Responses 服务端返回错误，未自动重试。')
    elif event == 'response.completed':
      full = payload.get('response') or payload
      if isinstance(full.get('output'), list):
        output = {i: item for i, item in enumerate(full['output'])}
        order = list(output)

  url, path = _endpoint(profile)
  response_body = _post(profile, url, path, body, cancel, handle_event if body['stream'] else None)
  if not body['stream']:
    payload = json.loads(response_body.decode('utf-8'))
    text = payload.get('output_text', '')
    for item in payload.get('output', []):
      if item.get('type') == 'message':
        text += ''.join(part.get('text', '') for part in item.get('content', []) if part.get('type') in ('output_text', 'text'))
    return {'id': payload.get('id'), 'text': text, 'output': payload.get('output', [])}

  if cancel.is_set():
    raise InterruptedError('请求已取消。')
  if full is None:
    raise RuntimeError('Responses 连接中断或响应未完成，未自动重试。')
  output_items = [output[i] for i in sorted(order)]
  text = ''.join(text_parts)
  if not text:
    text = ''.join(part.get('text', '') for item in output_items if item.get('type') == 'message' for part in item.get('content', []) if part.get('type') in ('output_text', 'text'))
  return {'id': full.get('id'), 'text': text, 'output': output_items}


def call_responses(settings, messages, cancel, on_delta=None, profile_id=None, on_profile=None):
  candidates = route_profiles(settings, profile_id)
  for index, profile in enumerate(candidates):
    if not profile.get('baseUrl') or not profile.get('apiKey') or not (settings.get('agentModel') or profile.get('model')):
      if index + 1 < len(candidates):
        continue
      raise ValueError('Responses 配置缺少服务地址、密钥或模型。')
    if on_profile:
      on_profile(profile)
    try:
      return _request(profile, settings, messages, cancel, on_delta), profile
    except PermissionError:
      if index + 1 == len(candidates):
        raise
  raise RuntimeError('没有可用的 Responses 配置。')
