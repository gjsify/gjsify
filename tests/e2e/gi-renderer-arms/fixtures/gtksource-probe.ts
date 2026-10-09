// `gi://GtkSource` answered by `@gjsify/gtksource-nativescript` (ADR 0094): a view class to
// subclass, and `init()`, which GJS exposes and which returns nothing.
import GtkSource from 'gi://GtkSource?version=5';

export const kind = typeof GtkSource.init;
export const button = GtkSource.View;
export const initReturns = GtkSource.init() === undefined;

export class ProbeButton extends GtkSource.View {}
