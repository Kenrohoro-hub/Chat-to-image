"""Resolve the UI language from a request, an explicit process setting, or the system."""
import contextvars
import ctypes
import locale
import os


_LANGUAGE = contextvars.ContextVar('ui_language', default=None)
_LANGUAGES = ('zh-CN', 'en')


def system_ui_language():
  if os.name == 'nt':
    return 'zh-CN' if ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3ff == 4 else 'en'
  language = locale.getlocale()[0] or 'en'
  return 'zh-CN' if language.lower().split('_')[0].split('-')[0] == 'zh' else 'en'


def current_ui_language():
  language = _LANGUAGE.get()
  if language in _LANGUAGES:
    return language
  language = os.environ.get('PLAYGROUND_UI_LANGUAGE')
  if language in _LANGUAGES:
    return language
  return system_ui_language()


def set_request_ui_language(language):
  if language not in _LANGUAGES:
    raise ValueError('language must be zh-CN or en')
  return _LANGUAGE.set(language)


def t(zh, en):
  return zh if current_ui_language() == 'zh-CN' else en
