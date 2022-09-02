import { EventEmitter } from 'events';
// TODO fork this
// TODO: PointerEvent, StorageEvent
// import { CustomEvent, Event, ErrorEvent, AnimationEvent, FocusEvent, InputEvent, KeyboardEvent, MouseEvent, ProgressEvent, WheelEvent } from 'happy-dom';

const globalEventEmitter = new EventEmitter();

globalEventEmitter.on('load', (event) => {
    if(typeof globalThis.onload === 'function') {
        globalThis.onload.call(globalThis, event);
    }
});

globalEventEmitter.on('beforeunload', (event) => {
    if(typeof globalThis.beforeunload === 'function') {
        globalThis.beforeunload.call(globalThis, event);
    }
});

globalEventEmitter.on('unload', (event) => {
    if(typeof globalThis.unload === 'function') {
        globalThis.unload.call(globalThis, event);
    }
});

// globalEventEmitter.emit('load', new Event('load'))

if (!globalThis.addEventListener) Object.defineProperty(globalThis, 'addEventListener', { value: globalEventEmitter.addListener });
if (!globalThis.removeEventListener) Object.defineProperty(globalThis, 'removeEventListener', { value: globalEventEmitter.removeListener });

// if (!globalThis.CustomEvent) Object.defineProperty(globalThis, 'CustomEvent', { value: CustomEvent });
// if (!globalThis.Event) Object.defineProperty(globalThis, 'Event', { value: Event });
// if (!globalThis.ErrorEvent) Object.defineProperty(globalThis, 'ErrorEvent', { value: ErrorEvent });
// if (!globalThis.AnimationEvent) Object.defineProperty(globalThis, 'AnimationEvent', { value: AnimationEvent });
// if (!globalThis.InputEvent) Object.defineProperty(globalThis, 'InputEvent', { value: InputEvent });
// if (!globalThis.KeyboardEvent) Object.defineProperty(globalThis, 'KeyboardEvent', { value: KeyboardEvent });
// if (!globalThis.MouseEvent) Object.defineProperty(globalThis, 'MouseEvent', { value: MouseEvent });
// if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', { value: ProgressEvent });
// if (!globalThis.WheelEvent) Object.defineProperty(globalThis, 'WheelEvent', { value: WheelEvent });

// export { CustomEvent, Event, ErrorEvent, AnimationEvent, FocusEvent, InputEvent, KeyboardEvent, MouseEvent, ProgressEvent, WheelEvent }