// The ADR 0034 stage 9 probe, in the shape the ADR names: a `gi://` DEFAULT import, a
// widget class taken out of the namespace, and a subclass of it. `class extends` is the
// operation that produced the measured red — `Class extends value undefined is not a
// constructor or null` — when the specifier resolved to an empty module.
//
// `actionRow` is exported so the suite can compare IDENTITY rather than a class name:
// `gjsify build` minifies, and a name assertion would be measuring the minifier.
import Adw from 'gi://Adw?version=1';

export const actionRow = Adw.ActionRow;
export const kind = typeof Adw.ActionRow;

export class ProbeRow extends Adw.ActionRow {}
