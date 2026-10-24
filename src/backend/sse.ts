// Incremental Server-Sent Events parser over a streaming fetch body.
//
// The backend emits frames of the form:
//   id: <n>\nevent: <name>\ndata: <json>\n\n
// with a `heartbeat` event every 15s. This parser is pure (no network) so it
// can be unit-tested by feeding chunks.

export interface SseFrame {
  event: string
  data: string
  id?: string
}

export class SseParser {
  private buffer = ''

  /** Feed a chunk of the stream; returns any complete frames. */
  feed(chunk: string): SseFrame[] {
    // Normalise line endings: SSE allows \r\n, \n, or \r as terminators.
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const frames: SseFrame[] = []
    let idx: number
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 2)
      const frame = parseFrame(raw)
      if (frame) frames.push(frame)
    }
    return frames
  }

  /** Flush any trailing frame left in the buffer (stream ended without a final blank line). */
  flush(): SseFrame[] {
    const rest = this.buffer
    this.buffer = ''
    const frame = parseFrame(rest)
    return frame ? [frame] : []
  }
}

function parseFrame(raw: string): SseFrame | null {
  if (!raw.trim()) return null
  let event = 'message'
  let id: string | undefined
  const dataLines: string[] = []

  for (const line of raw.split('\n')) {
    if (!line) continue
    if (line.startsWith(':')) continue // comment / keep-alive
    const colon = line.indexOf(':')
    let field: string
    let value: string
    if (colon === -1) {
      field = line
      value = ''
    } else {
      field = line.slice(0, colon)
      value = line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
    }
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') id = value
  }

  if (dataLines.length === 0 && event === 'message') return null
  return { event, data: dataLines.join('\n'), id }
}

/**
 * Read a streaming fetch response as SSE frames, invoking `onFrame` for each.
 * Resolves when the stream ends, rejects on read errors (including abort).
 */
export async function readSseStream(
  res: Response,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  if (!res.body) throw new Error('Response has no body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parser = new SseParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      for (const frame of parser.feed(text)) onFrame(frame)
    }
    // Flush any trailing frame.
    for (const frame of parser.flush()) onFrame(frame)
  } finally {
    try {
      reader.cancel()
    } catch {
      /* already closed */
    }
  }
}

/** Parse a frame's `data` field as JSON, falling back to a raw wrapper. */
export function parseEventData(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}
