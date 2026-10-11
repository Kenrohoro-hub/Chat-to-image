import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { DetailParamValue, getParamDisplay } from './paramDisplay'

describe('DetailParamValue', () => {
  const task = { params: { ...DEFAULT_PARAMS, quality: 'high' }, sourceMode: 'gallery', actualParams: { quality: 'medium' } } as TaskRecord

  it('localizes quality while preserving the requested and actual mismatch', () => {
    const html = renderToStaticMarkup(<DetailParamValue task={task} paramKey="quality" />)
    expect(html).toContain('>高</span>')
    expect(html).toContain('>中<')
    expect(html).toContain('bg-yellow-100')
    expect(getParamDisplay(task, 'quality')).toMatchObject({ requestedValue: 'high', displayValue: 'medium', isMismatch: true })
  })

  it('localizes automatic moderation and formats without changing task values', () => {
    expect(renderToStaticMarkup(<DetailParamValue task={task} paramKey="moderation" />)).toContain('>自动</span>')
    expect(renderToStaticMarkup(<DetailParamValue task={task} paramKey="output_format" />)).toContain('>PNG</span>')
    expect(task.params.output_format).toBe('png')
  })

  it('keeps unknown API values visible and marks automatic resolution separately', () => {
    const html = renderToStaticMarkup(<DetailParamValue task={{ ...task, params: { ...task.params, quality: 'auto' } }} paramKey="quality" actualParams={{ quality: 'vendor-tier' as TaskRecord['params']['quality'] }} />)
    expect(html).toContain('>自动</span>')
    expect(html).toContain('vendor-tier')
    expect(html).not.toContain('bg-yellow-100')
  })
})
