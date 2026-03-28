// Reference: DOM Living Standard (https://dom.spec.whatwg.org/)
// EventTarget/Event implementation for GJS

// Re-export DOMException from dedicated package for backwards compatibility
import { DOMException } from '@gjsify/dom-exception';
export { DOMException };

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

// Internal symbols for writable access to readonly properties
const kType = Symbol('type');
const kBubbles = Symbol('bubbles');
const kCancelable = Symbol('cancelable');
const kComposed = Symbol('composed');
const kTarget = Symbol('target');
const kCurrentTarget = Symbol('currentTarget');
const kEventPhase = Symbol('eventPhase');
const kDefaultPrevented = Symbol('defaultPrevented');
const kIsTrusted = Symbol('isTrusted');
const kTimeStamp = Symbol('timeStamp');
const kStop = Symbol('stop');
const kImmediateStop = Symbol('immediateStop');
const kDispatching = Symbol('dispatching');
const kInPassiveListener = Symbol('inPassiveListener');

export class Event {
  // Internal state
  private [kType]: string;
  private [kBubbles]: boolean;
  private [kCancelable]: boolean;
  private [kComposed]: boolean;
  private [kTarget]: EventTarget | null = null;
  private [kCurrentTarget]: EventTarget | null = null;
  private [kEventPhase]: number = 0;
  private [kDefaultPrevented]: boolean = false;
  private [kIsTrusted]: boolean = false;
  private [kTimeStamp]: number;
  private [kStop]: boolean = false;
  private [kImmediateStop]: boolean = false;
  private [kDispatching]: boolean = false;
  private [kInPassiveListener]: boolean = false;

  // Readonly getters
  get type(): string { return this[kType]; }
  get bubbles(): boolean { return this[kBubbles]; }
  get cancelable(): boolean { return this[kCancelable]; }
  get composed(): boolean { return this[kComposed]; }
  get target(): EventTarget | null { return this[kTarget]; }
  get currentTarget(): EventTarget | null { return this[kCurrentTarget]; }
  get eventPhase(): number { return this[kEventPhase]; }
  get defaultPrevented(): boolean { return this[kDefaultPrevented]; }
  // isTrusted is defined as a non-configurable own property in the constructor
  get timeStamp(): number { return this[kTimeStamp]; }

  // Legacy compat
  get cancelBubble(): boolean { return this[kStop]; }
  set cancelBubble(value: boolean) { if (value) this.stopPropagation(); }

  get returnValue(): boolean { return !this[kDefaultPrevented]; }
  set returnValue(value: boolean) { if (!value) this.preventDefault(); }

  get srcElement(): EventTarget | null { return this[kTarget]; }

  // Phase constants (defined as non-writable, non-configurable on prototype below)
  static readonly NONE = 0;
  static readonly CAPTURING_PHASE = 1;
  static readonly AT_TARGET = 2;
  static readonly BUBBLING_PHASE = 3;
  declare readonly NONE: 0;
  declare readonly CAPTURING_PHASE: 1;
  declare readonly AT_TARGET: 2;
  declare readonly BUBBLING_PHASE: 3;

  get [Symbol.toStringTag]() { return 'Event'; }

  constructor(type: string, eventInitDict?: EventInit) {
    this[kType] = type;
    this[kBubbles] = eventInitDict?.bubbles ?? false;
    this[kCancelable] = eventInitDict?.cancelable ?? false;
    this[kComposed] = eventInitDict?.composed ?? false;
    this[kTimeStamp] = Date.now();

    // isTrusted must be a non-configurable own property so subclasses cannot override it
    Object.defineProperty(this, 'isTrusted', {
      get: () => this[kIsTrusted],
      enumerable: true,
      configurable: false,
    });
  }

  composedPath(): EventTarget[] {
    if (this[kCurrentTarget]) return [this[kCurrentTarget]];
    return [];
  }

  preventDefault(): void {
    if (this[kCancelable] && !this[kInPassiveListener]) {
      this[kDefaultPrevented] = true;
    }
  }

  stopPropagation(): void {
    this[kStop] = true;
  }

  stopImmediatePropagation(): void {
    this[kStop] = true;
    this[kImmediateStop] = true;
  }
}

export class CustomEvent<T = any> extends Event {
  readonly detail: T;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    super(type, eventInitDict);
    this.detail = eventInitDict?.detail as T;
  }
}

// -- MessageEvent --
// Reference: refs/happy-dom/packages/happy-dom/src/event/events/MessageEvent.ts
// Copyright (c) David Ortner (capricorn86). MIT license.

interface MessageEventInit<T = any> extends EventInit {
  data?: T;
  origin?: string;
  lastEventId?: string;
  source?: EventTarget | null;
  ports?: MessagePort[];
}

export class MessageEvent<T = any> extends Event {
  readonly data: T;
  readonly origin: string;
  readonly lastEventId: string;
  readonly source: EventTarget | null;
  readonly ports: readonly MessagePort[];

  constructor(type: string, eventInitDict?: MessageEventInit<T>) {
    super(type, eventInitDict);
    this.data = (eventInitDict?.data ?? null) as T;
    this.origin = eventInitDict?.origin ?? '';
    this.lastEventId = eventInitDict?.lastEventId ?? '';
    this.source = eventInitDict?.source ?? null;
    this.ports = eventInitDict?.ports ?? [];
  }

  get [Symbol.toStringTag]() { return 'MessageEvent'; }
}

// -- ErrorEvent --
// Reference: refs/happy-dom/packages/happy-dom/src/event/events/ErrorEvent.ts
// Copyright (c) David Ortner (capricorn86). MIT license.

interface ErrorEventInit extends EventInit {
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

export class ErrorEvent extends Event {
  readonly message: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  readonly error: unknown;

  constructor(type: string, eventInitDict?: ErrorEventInit) {
    super(type, eventInitDict);
    this.message = eventInitDict?.message ?? '';
    this.filename = eventInitDict?.filename ?? '';
    this.lineno = eventInitDict?.lineno ?? 0;
    this.colno = eventInitDict?.colno ?? 0;
    this.error = eventInitDict?.error ?? null;
  }

  get [Symbol.toStringTag]() { return 'ErrorEvent'; }
}

// -- CloseEvent --
// Reference: refs/happy-dom/packages/happy-dom/src/event/events/CloseEvent.ts
// Copyright (c) David Ortner (capricorn86). MIT license.

interface CloseEventInit extends EventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, eventInitDict?: CloseEventInit) {
    super(type, eventInitDict);
    this.code = eventInitDict?.code ?? 0;
    this.reason = eventInitDict?.reason ?? '';
    this.wasClean = eventInitDict?.wasClean ?? false;
  }

  get [Symbol.toStringTag]() { return 'CloseEvent'; }
}

// -- ProgressEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/ProgressEvent

interface ProgressEventInit extends EventInit {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

export class ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, eventInitDict?: ProgressEventInit) {
    super(type, eventInitDict);
    this.lengthComputable = eventInitDict?.lengthComputable ?? false;
    this.loaded = eventInitDict?.loaded ?? 0;
    this.total = eventInitDict?.total ?? 0;
  }

  get [Symbol.toStringTag]() { return 'ProgressEvent'; }
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

    for (const entry of list) {
      if (entry.listener === callback && entry.capture === capture) return;
    }

    const entry: ListenerEntry = { listener: callback, capture, once, passive, removed: false };
    list.push(entry);

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
      if (list.length === 0) this._listeners.delete(type);
    }
  }

  dispatchEvent(event: Event): boolean {
    // Prevent re-dispatching an event that is currently being dispatched
    if ((event as any)[kDispatching]) {
      throw new DOMException('The event is already being dispatched.', 'InvalidStateError');
    }

    (event as any)[kDispatching] = true;
    (event as any)[kTarget] = this;
    (event as any)[kCurrentTarget] = this;
    (event as any)[kEventPhase] = Event.AT_TARGET;

    const list = this._listeners.get(event.type);
    if (list) {
      const entries = [...list];
      for (const entry of entries) {
        if (entry.removed) continue;
        if ((event as any)[kImmediateStop]) break;
        if ((event as any)[kStop]) break;

        if (entry.once) {
          this.removeEventListener(event.type, entry.listener, { capture: entry.capture });
        }

        try {
          if (entry.passive) (event as any)[kInPassiveListener] = true;
          if (typeof entry.listener === 'function') {
            entry.listener.call(this, event);
          } else if (typeof entry.listener.handleEvent === 'function') {
            entry.listener.handleEvent.call(entry.listener, event);
          }
        } catch (err) {
          console.error(err);
        } finally {
          (event as any)[kInPassiveListener] = false;
        }
      }
    }

    (event as any)[kEventPhase] = Event.NONE;
    (event as any)[kCurrentTarget] = null;
    (event as any)[kDispatching] = false;

    return !event.defaultPrevented;
  }
}

// Define phase constants as non-writable, non-configurable on Event.prototype and Event constructor
for (const [name, value] of [['NONE', 0], ['CAPTURING_PHASE', 1], ['AT_TARGET', 2], ['BUBBLING_PHASE', 3]] as const) {
  Object.defineProperty(Event.prototype, name, { value, writable: false, enumerable: true, configurable: false });
  Object.defineProperty(Event, name, { value, writable: false, enumerable: true, configurable: false });
}

// -- UIEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/UIEvent

interface UIEventInit extends EventInit {
  detail?: number;
  view?: null;
}

export class UIEvent extends Event {
  readonly detail: number;
  readonly view: null;

  constructor(type: string, eventInitDict?: UIEventInit) {
    super(type, eventInitDict);
    this.detail = eventInitDict?.detail ?? 0;
    this.view = null;
  }

  get [Symbol.toStringTag]() { return 'UIEvent'; }
}

// -- MouseEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent

interface MouseEventInit extends UIEventInit {
  altKey?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  movementX?: number;
  movementY?: number;
  offsetX?: number;
  offsetY?: number;
  screenX?: number;
  screenY?: number;
  shiftKey?: boolean;
  relatedTarget?: EventTarget | null;
}

export class MouseEvent extends UIEvent {
  readonly altKey: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly movementX: number;
  readonly movementY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly shiftKey: boolean;
  readonly relatedTarget: EventTarget | null;

  // Legacy aliases
  get pageX(): number { return this.clientX; }
  get pageY(): number { return this.clientY; }
  get x(): number { return this.clientX; }
  get y(): number { return this.clientY; }

  constructor(type: string, eventInitDict?: MouseEventInit) {
    super(type, eventInitDict);
    this.altKey = eventInitDict?.altKey ?? false;
    this.button = eventInitDict?.button ?? 0;
    this.buttons = eventInitDict?.buttons ?? 0;
    this.clientX = eventInitDict?.clientX ?? 0;
    this.clientY = eventInitDict?.clientY ?? 0;
    this.ctrlKey = eventInitDict?.ctrlKey ?? false;
    this.metaKey = eventInitDict?.metaKey ?? false;
    this.movementX = eventInitDict?.movementX ?? 0;
    this.movementY = eventInitDict?.movementY ?? 0;
    this.offsetX = eventInitDict?.offsetX ?? 0;
    this.offsetY = eventInitDict?.offsetY ?? 0;
    this.screenX = eventInitDict?.screenX ?? 0;
    this.screenY = eventInitDict?.screenY ?? 0;
    this.shiftKey = eventInitDict?.shiftKey ?? false;
    this.relatedTarget = eventInitDict?.relatedTarget ?? null;
  }

  getModifierState(key: string): boolean {
    switch (key) {
      case 'Alt': return this.altKey;
      case 'Control': return this.ctrlKey;
      case 'Meta': return this.metaKey;
      case 'Shift': return this.shiftKey;
      default: return false;
    }
  }

  get [Symbol.toStringTag]() { return 'MouseEvent'; }
}

// -- PointerEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent

interface PointerEventInit extends MouseEventInit {
  pointerId?: number;
  width?: number;
  height?: number;
  pressure?: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  pointerType?: string;
  isPrimary?: boolean;
}

export class PointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, eventInitDict?: PointerEventInit) {
    super(type, eventInitDict);
    this.pointerId = eventInitDict?.pointerId ?? 0;
    this.width = eventInitDict?.width ?? 1;
    this.height = eventInitDict?.height ?? 1;
    this.pressure = eventInitDict?.pressure ?? 0;
    this.tangentialPressure = eventInitDict?.tangentialPressure ?? 0;
    this.tiltX = eventInitDict?.tiltX ?? 0;
    this.tiltY = eventInitDict?.tiltY ?? 0;
    this.twist = eventInitDict?.twist ?? 0;
    this.altitudeAngle = eventInitDict?.altitudeAngle ?? Math.PI / 2;
    this.azimuthAngle = eventInitDict?.azimuthAngle ?? 0;
    this.pointerType = eventInitDict?.pointerType ?? '';
    this.isPrimary = eventInitDict?.isPrimary ?? false;
  }

  getCoalescedEvents(): PointerEvent[] { return []; }
  getPredictedEvents(): PointerEvent[] { return []; }

  get [Symbol.toStringTag]() { return 'PointerEvent'; }
}

// -- KeyboardEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent

interface KeyboardEventInit extends UIEventInit {
  altKey?: boolean;
  code?: string;
  ctrlKey?: boolean;
  isComposing?: boolean;
  key?: string;
  location?: number;
  metaKey?: boolean;
  repeat?: boolean;
  shiftKey?: boolean;
  keyCode?: number;
  which?: number;
}

export class KeyboardEvent extends UIEvent {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly location: number;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly keyCode: number;
  readonly which: number;

  static readonly DOM_KEY_LOCATION_STANDARD = 0;
  static readonly DOM_KEY_LOCATION_LEFT = 1;
  static readonly DOM_KEY_LOCATION_RIGHT = 2;
  static readonly DOM_KEY_LOCATION_NUMPAD = 3;

  constructor(type: string, eventInitDict?: KeyboardEventInit) {
    super(type, eventInitDict);
    this.altKey = eventInitDict?.altKey ?? false;
    this.code = eventInitDict?.code ?? '';
    this.ctrlKey = eventInitDict?.ctrlKey ?? false;
    this.isComposing = eventInitDict?.isComposing ?? false;
    this.key = eventInitDict?.key ?? '';
    this.location = eventInitDict?.location ?? 0;
    this.metaKey = eventInitDict?.metaKey ?? false;
    this.repeat = eventInitDict?.repeat ?? false;
    this.shiftKey = eventInitDict?.shiftKey ?? false;
    this.keyCode = eventInitDict?.keyCode ?? 0;
    this.which = eventInitDict?.which ?? 0;
  }

  getModifierState(key: string): boolean {
    switch (key) {
      case 'Alt': return this.altKey;
      case 'Control': return this.ctrlKey;
      case 'Meta': return this.metaKey;
      case 'Shift': return this.shiftKey;
      default: return false;
    }
  }

  get [Symbol.toStringTag]() { return 'KeyboardEvent'; }
}

// -- WheelEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent

interface WheelEventInit extends MouseEventInit {
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  deltaMode?: number;
}

export class WheelEvent extends MouseEvent {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly deltaMode: number;

  static readonly DOM_DELTA_PIXEL = 0;
  static readonly DOM_DELTA_LINE = 1;
  static readonly DOM_DELTA_PAGE = 2;

  constructor(type: string, eventInitDict?: WheelEventInit) {
    super(type, eventInitDict);
    this.deltaX = eventInitDict?.deltaX ?? 0;
    this.deltaY = eventInitDict?.deltaY ?? 0;
    this.deltaZ = eventInitDict?.deltaZ ?? 0;
    this.deltaMode = eventInitDict?.deltaMode ?? 0;
  }

  get [Symbol.toStringTag]() { return 'WheelEvent'; }
}

// -- FocusEvent --
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/FocusEvent

interface FocusEventInit extends UIEventInit {
  relatedTarget?: EventTarget | null;
}

export class FocusEvent extends UIEvent {
  readonly relatedTarget: EventTarget | null;

  constructor(type: string, eventInitDict?: FocusEventInit) {
    super(type, eventInitDict);
    this.relatedTarget = eventInitDict?.relatedTarget ?? null;
  }

  get [Symbol.toStringTag]() { return 'FocusEvent'; }
}

export default {
  Event, CustomEvent, EventTarget,
  MessageEvent, ErrorEvent, CloseEvent, ProgressEvent,
  UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent,
};
