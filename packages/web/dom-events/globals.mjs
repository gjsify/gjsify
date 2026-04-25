/**
 * Re-exports native DOM Events globals for use in Node.js/browser builds.
 * On Node.js, Event/EventTarget/CustomEvent are native globals.
 * On browsers, all UI event classes are native globals.
 */
export const Event = globalThis.Event;
export const EventTarget = globalThis.EventTarget;
export const CustomEvent = globalThis.CustomEvent;
export const UIEvent = globalThis.UIEvent;
export const MouseEvent = globalThis.MouseEvent;
export const PointerEvent = globalThis.PointerEvent;
export const KeyboardEvent = globalThis.KeyboardEvent;
export const WheelEvent = globalThis.WheelEvent;
export const FocusEvent = globalThis.FocusEvent;
export const InputEvent = globalThis.InputEvent;
export const CompositionEvent = globalThis.CompositionEvent;
export const DragEvent = globalThis.DragEvent;
export const ErrorEvent = globalThis.ErrorEvent;
export const CloseEvent = globalThis.CloseEvent;
export const MessageEvent = globalThis.MessageEvent;
export const ProgressEvent = globalThis.ProgressEvent;
export const StorageEvent = globalThis.StorageEvent;
export const HashChangeEvent = globalThis.HashChangeEvent;
export const PopStateEvent = globalThis.PopStateEvent;
