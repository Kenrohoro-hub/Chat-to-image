import { expect, it } from 'vitest'
import { getApiFailureAdvice } from './apiDiagnostics'
it.each([['HTTP 401', 'Key'], ['HTTP 429', '余额'], ['HTTP 404', '手动添加'], ['TimeoutError', '已被受理'], ['Failed to fetch', '跨域'], ['unknown', '手动添加']])('explains %s without retrying or exposing raw responses', (message, expected) => {
  expect(getApiFailureAdvice(new Error(message))).toContain(expected)
  expect(getApiFailureAdvice(new Error('secret-value'))).not.toContain('secret-value')
})
