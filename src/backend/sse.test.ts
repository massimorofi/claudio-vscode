import { describe, it, expect } from 'vitest'
import { SseParser, parseEventData } from './sse'

describe('SseParser', () => {
  it('parses a single complete frame', () => {
    const p = new SseParser()
    const frames = p.feed('id: 1\nevent: token\ndata: {"text":"hi"}\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({ event: 'token', data: '{"text":"hi"}', id: '1' })
  })

  it('parses multiple frames in one chunk', () => {
    const p = new SseParser()
    const frames = p.feed(
      'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3\n\n',
    )
    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.event)).toEqual(['a', 'b', 'c'])
    expect(frames.map((f) => f.data)).toEqual(['1', '2', '3'])
  })

  it('reassembles a frame split across two chunks', () => {
    const p = new SseParser()
    const first = p.feed('event: token\ndata: {"te')
    expect(first).toHaveLength(0)
    const second = p.feed('xt":"x"}\n\n')
    expect(second).toHaveLength(1)
    expect(second[0]).toEqual({ event: 'token', data: '{"text":"x"}', id: undefined })
  })

  it('joins multi-line data fields with newlines', () => {
    const p = new SseParser()
    const frames = p.feed('event: x\ndata: line1\ndata: line2\n\n')
    expect(frames[0].data).toBe('line1\nline2')
  })

  it('normalises CRLF and CR line endings', () => {
    const p = new SseParser()
    const frames = p.feed('event: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\r')
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual({ event: 'a', data: '1', id: undefined })
    expect(frames[1]).toEqual({ event: 'b', data: '2', id: undefined })
  })

  it('ignores comment / keep-alive lines', () => {
    const p = new SseParser()
    const frames = p.feed(': keep-alive\nevent: a\ndata: 1\n\n')
    expect(frames).toHaveLength(1)
    expect(frames[0].event).toBe('a')
  })

  it('flush returns a trailing frame with no final blank line', () => {
    const p = new SseParser()
    expect(p.feed('event: tail\ndata: done')).toHaveLength(0)
    const flushed = p.flush()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toEqual({ event: 'tail', data: 'done', id: undefined })
  })

  it('drops an empty flush', () => {
    const p = new SseParser()
    expect(p.flush()).toHaveLength(0)
  })
})

describe('parseEventData', () => {
  it('parses valid JSON', () => {
    expect(parseEventData('{"a":1}')).toEqual({ a: 1 })
  })
  it('wraps non-JSON in {raw}', () => {
    expect(parseEventData('not json')).toEqual({ raw: 'not json' })
  })
  it('returns {} for empty', () => {
    expect(parseEventData('')).toEqual({})
  })
})
