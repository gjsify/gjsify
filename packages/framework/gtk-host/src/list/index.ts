// `@gjsify/gtk-host/list` — the framework-neutral half of a GTK4 list.
//
// A subpath and not a package: the repository's rule is that "a `/core` subpath beats a
// new `-core` package — a separate NAME needs a package-level cycle or independent
// external consumers, never onboarding cost". There is neither here. What there is, is
// GTK and GObject knowledge that three dialects would otherwise each own a copy of.

export { ListController, type ListRowKey, type ListRowSink } from './controller.js';
