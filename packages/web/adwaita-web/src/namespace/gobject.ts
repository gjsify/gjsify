// The GObject half of `@gjsify/adwaita-web`'s vocabulary (ADR 0096) — `GObject.registerClass`,
// `GObject.ParamSpec` and the rest of the subset, the way `./adw.ts` and `./gtk.ts` export their
// members. `export * as GObject from './namespace/gobject.js'` in `src/index.ts` makes it the
// namespace. Everything is the core's (`@gjsify/adwaita-core`); this port supplies only the door
// to custom elements, in `../gobject-door.ts`.
//
// `Object` is re-exported under its GIR name, so it is bound to a local first: a module-level
// `export const Object` would shadow the global one for this file.

import { createGObject } from '@gjsify/adwaita-core';

import { webDoor } from '../gobject-door.js';

const gobject = createGObject(webDoor);

const GObjectObject = gobject.Object;

export { GObjectObject as Object };
export const registerClass = gobject.registerClass;
export const type_ensure = gobject.type_ensure;
export const signal_stop_emission_by_name = gobject.signal_stop_emission_by_name;
export const ParamSpec = gobject.ParamSpec;
export const ParamFlags = gobject.ParamFlags;
export const Value = gobject.Value;
export const TYPE_STRING = gobject.TYPE_STRING;
export const TYPE_BOOLEAN = gobject.TYPE_BOOLEAN;
export const TYPE_INT = gobject.TYPE_INT;
export const TYPE_UINT = gobject.TYPE_UINT;
export const TYPE_DOUBLE = gobject.TYPE_DOUBLE;
export const GTypeName = gobject.GTypeName;
export const GTypeFlags = gobject.GTypeFlags;
export const interfaces = gobject.interfaces;
export const properties = gobject.properties;
export const signals = gobject.signals;
export const requires = gobject.requires;
export const __gtkTemplate__ = gobject.__gtkTemplate__;
export const __gtkCssName__ = gobject.__gtkCssName__;
export const __gtkChildren__ = gobject.__gtkChildren__;
export const __gtkInternalChildren__ = gobject.__gtkInternalChildren__;
