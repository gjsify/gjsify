// Native EventTarget/Event implementation for GJS — no Deno dependency.

type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(evt: Event): void;
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface EventListenerOptions {
  capture?: boolean;
}

interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

interface CustomEventInit<T = any> extends EventInit {
  detail?: T;
}

interface ListenerEntry {
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
  once: boolean;
  passive: boolean;
  removed: boolean;
}

export class Event {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly timeStamp: number;

  target: EventTarget | null = null;
  currentTarget: EventTarget | null = null;
  eventPhase: number = 0;
  defaultPrevented: boolean = false;
  isTrusted: boolean = false;

  private _stopPropagation = false;
  private _stopImmediatePropagation = false;

  // Event phase constants
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;

  readonly NONE = 0;
  readonly CAPTURING_PHASE = 1;
  readonly AT_TARGET = 2;
  readonly BUBBLING_PHASE = 3;

  get [Symbol.toStringTag]() { return 'Event'; }

  constructor(type: string, eventInitDict?: EventInit) {
    this.type = type;
    this.bubbles = eventInitDict?.bubbles ?? false;
    this.cancelable = eventInitDict?.cancelable ?? false;
    this.composed = eventInitDict?.composed ?? false;
    this.timeStamp = Date.now();
  }

  composedPath(): EventTarget[] {
    if (this.currentTarget) return [this.currentTarget];
    return [];
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this._stopPropagation = true;
  }

  stopImmediatePropagation(): void {
    this._stopPropagation = true;
    this._stopImmediatePropagation = true;
  }

  /** @internal */
  get _stopped(): boolean { return this._stopPropagation; }
  /** @internal */
  get _immediateStopped(): boolean { return this._stopImmediatePropagation; }
}

export class CustomEvent<T = any> extends Event {
  readonly detail: T;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    super(type, eventInitDict);
    this.detail = eventInitDict?.detail as T;
  }
}

export class EventTarget {
  private _listeners = new Map<string, ListenerEntry[]>();

  get [Symbol.toStringTag]() { return 'EventTarget'; }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (callback === null) return;

    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    const once = typeof options === 'object' ? (options?.once ?? false) : false;
    const passive = typeof options === 'object' ? (options?.passive ?? false) : false;

    let list = this._listeners.get(type);
    if (!list) {
      list = [];
      this._listeners.set(type, list);
    }

    // Don't add duplicate listeners
    for (const entry of list) {
      if (entry.listener === callback && entry.capture === capture) return;
    }

    const entry: ListenerEntry = { listener: callback, capture, once, passive, removed: false };
    list.push(entry);

    // Support AbortSignal for automatic removal
    if (typeof options === 'object' && options?.signal) {
      options.signal.addEventListener('abort', () => {
        this.removeEventListener(type, callback, { capture });
      }, { once: true });
    }
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (callback === null) return;

    const capture = typeof options === 'boolean' ? options : (options?.capture ?? false);
    const list = this._listeners.get(type);
    if (!list) return;

    const idx = list.findIndex(e => e.listener === callback && e.capture === capture);
    if (idx !== -1) {
      list[idx].removed = true;
      list.splice(idx, 1);
    }
  }

  dispatchEvent(event: Event): boolean {
    (event as any).target = this;
    (event as any).currentTarget = this;
    (event as any).eventPhase = Event.AT_TARGET;

    const list = this._listeners.get(event.type);
    if (list) {
      // Copy to allow modifications during iteration
      const entries = [...list];
      for (const entry of entries) {
        if (entry.removed) continue;
        if ((event as any)._immediateStopped) break;

        if (entry.once) {
          this.removeEventListener(event.type, entry.listener, { capture: entry.capture });
        }

        try {
          if (typeof entry.listener === 'function') {
            entry.listener.call(this, event);
          } else {
            entry.listener.handleEvent(event);
          }
        } catch (err) {
          // Listener errors should not stop dispatch
          console.error(err);
        }
      }
    }

    (event as any).eventPhase = Event.NONE;
    (event as any).currentTarget = null;

    return !event.defaultPrevented;
  }
}

export default { Event, CustomEvent, EventTarget };
