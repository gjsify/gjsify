// W3C EventSource (Server-Sent Events) for GJS
// Adapted from refs/deno/ext/fetch/27_eventsource.js
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS — pure TypeScript using fetch + Web Streams.

// EventSource's internal TextLineStream extends TransformStream<string, string>
// at module-load time — the class declaration itself needs the TransformStream
// constructor to exist before it can be evaluated. We therefore register the
// web-streams globals here; this is the single legitimate exception to the
// "no side-effects in index.ts" rule because eventsource is non-functional
// without a WHATWG stream implementation.
import '@gjsify/web-streams/register';
// Import DOM Events polyfill — provides Event, EventTarget, MessageEvent, etc. on GJS
import {
  Event as DomEvent,
  EventTarget as DomEventTarget,
  MessageEvent as DomMessageEvent,
} from '@gjsify/dom-events';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

// Use native globals if available (Node.js, browser), polyfill otherwise (GJS)
const _Event: typeof Event = typeof globalThis.Event === 'function'
  ? globalThis.Event
  : DomEvent as any;
const _EventTarget: { new(): EventTarget } = typeof globalThis.EventTarget === 'function'
  ? globalThis.EventTarget
  : DomEventTarget as any;
const _MessageEvent: typeof MessageEvent = typeof globalThis.MessageEvent === 'function'
  ? globalThis.MessageEvent
  : DomMessageEvent as any;

/**
 * TextLineStream splits a string stream into individual lines.
 * Handles \n, \r\n, and standalone \r line endings.
 */
class TextLineStream extends TransformStream<string, string> {
  #buf = '';

  constructor() {
    super({
      transform: (chunk: string, controller) => this.#handle(chunk, controller),
      flush: (controller) => {
        if (this.#buf.length > 0) {
          controller.enqueue(this.#buf);
        }
      },
    });
  }

  #handle(chunk: string, controller: TransformStreamDefaultController<string>) {
    chunk = this.#buf + chunk;

    for (;;) {
      const lfIndex = chunk.indexOf('\n');

      if (lfIndex !== -1) {
        let crOrLfIndex = lfIndex;
        if (chunk[lfIndex - 1] === '\r') {
          crOrLfIndex--;
        }
        controller.enqueue(chunk.slice(0, crOrLfIndex));
        chunk = chunk.slice(lfIndex + 1);
        continue;
      }

      // Handle standalone \r (not followed by \n)
      const crIndex = chunk.indexOf('\r');
      if (crIndex !== -1 && crIndex !== chunk.length - 1) {
        controller.enqueue(chunk.slice(0, crIndex));
        chunk = chunk.slice(crIndex + 1);
        continue;
      }

      break;
    }

    this.#buf = chunk;
  }
}

export interface EventSourceInit {
  withCredentials?: boolean;
}

/**
 * EventSource — W3C Server-Sent Events API.
 *
 * Connects to an SSE endpoint via fetch, pipes the response through
 * TextDecoderStream and TextLineStream, then parses SSE fields.
 */
export class EventSource extends (_EventTarget as any) {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSED = CLOSED;

  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSED = CLOSED;

  #abortController = new AbortController();
  #reconnectionTimerId: ReturnType<typeof setTimeout> | undefined;
  #reconnectionTime = 5000;
  #lastEventId = '';
  #readyState = CONNECTING;
  #url: string;
  #withCredentials: boolean;

  // Event handler attributes
  onopen: ((this: EventSource, ev: Event) => any) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null;
  onerror: ((this: EventSource, ev: Event) => any) | null = null;

  constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
    super();

    const urlStr = String(url);
    try {
      this.#url = new URL(urlStr).href;
    } catch {
      throw new DOMException(`Failed to construct 'EventSource': ${urlStr} is not a valid URL`, 'SyntaxError');
    }

    this.#withCredentials = eventSourceInitDict?.withCredentials ?? false;
    this.#loop();
  }

  get readyState(): number {
    return this.#readyState;
  }

  get url(): string {
    return this.#url;
  }

  get withCredentials(): boolean {
    return this.#withCredentials;
  }

  close(): void {
    this.#abortController.abort();
    this.#readyState = CLOSED;
    if (this.#reconnectionTimerId !== undefined) {
      clearTimeout(this.#reconnectionTimerId);
      this.#reconnectionTimerId = undefined;
    }
  }

  dispatchEvent(event: Event): boolean {
    // Wire up on* attribute handlers
    const type = event.type;
    if (type === 'open' && this.onopen) {
      this.onopen.call(this, event);
    } else if (type === 'message' && this.onmessage) {
      this.onmessage.call(this, event as MessageEvent);
    } else if (type === 'error' && this.onerror) {
      this.onerror.call(this, event);
    }
    return super.dispatchEvent(event);
  }

  async #loop(): Promise<void> {
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (this.#lastEventId) {
      headers['Last-Event-ID'] = this.#lastEventId;
    }

    let res: Response;
    try {
      res = await fetch(this.#url, {
        headers,
        signal: this.#abortController.signal,
      });
    } catch {
      this.#reestablishConnection();
      return;
    }

    // Validate response
    const contentType = res.headers.get('content-type') || '';
    if (res.status !== 200 || !contentType.toLowerCase().includes('text/event-stream')) {
      this.#failConnection();
      return;
    }

    if (this.#readyState === CLOSED) {
      return;
    }
    this.#readyState = OPEN;
    this.dispatchEvent(new _Event('open'));

    let data = '';
    let eventType = '';
    let lastEventId = this.#lastEventId;

    try {
      const body = res.body;
      if (!body) {
        this.#reestablishConnection();
        return;
      }

      const lineStream = body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

      const reader = lineStream.getReader();
      while (true) {
        const { value: line, done } = await reader.read();
        if (done) break;

        if (line === '') {
          // Dispatch event
          this.#lastEventId = lastEventId;
          if (data === '') {
            eventType = '';
            continue;
          }
          // Remove trailing newline from data
          if (data.endsWith('\n')) {
            data = data.slice(0, -1);
          }
          const event = new _MessageEvent(eventType || 'message', {
            data,
            origin: this.#url,
            lastEventId: this.#lastEventId,
          });
          data = '';
          eventType = '';
          if (this.#readyState !== CLOSED) {
            this.dispatchEvent(event);
          }
        } else if (line.startsWith(':')) {
          // Comment — ignore
          continue;
        } else {
          // Parse field
          let field = line;
          let value = '';
          const colonIndex = line.indexOf(':');
          if (colonIndex !== -1) {
            field = line.slice(0, colonIndex);
            value = line.slice(colonIndex + 1);
            if (value.startsWith(' ')) {
              value = value.slice(1);
            }
          }

          switch (field) {
            case 'event':
              eventType = value;
              break;
            case 'data':
              data += value + '\n';
              break;
            case 'id':
              if (!value.includes('\0')) {
                lastEventId = value;
              }
              break;
            case 'retry': {
              const ms = Number(value);
              if (!Number.isNaN(ms) && Number.isFinite(ms)) {
                this.#reconnectionTime = ms;
              }
              break;
            }
          }
        }
      }
    } catch {
      // Connection lost — will reestablish below
    }

    this.#reestablishConnection();
  }

  #reestablishConnection(): void {
    if (this.#readyState === CLOSED) {
      return;
    }
    this.#readyState = CONNECTING;
    this.dispatchEvent(new _Event('error'));
    this.#reconnectionTimerId = setTimeout(() => {
      if (this.#readyState !== CONNECTING) {
        return;
      }
      this.#abortController = new AbortController();
      this.#loop();
    }, this.#reconnectionTime);
  }

  #failConnection(): void {
    if (this.#readyState !== CLOSED) {
      this.#readyState = CLOSED;
      this.dispatchEvent(new _Event('error'));
    }
  }
}

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/eventsource/register'`) if you need
// globalThis.EventSource / Event / EventTarget / MessageEvent to be set on GJS.

export { TextLineStream };

export default EventSource;
