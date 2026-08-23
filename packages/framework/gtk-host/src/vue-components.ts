/**
 * The Vue surface: `GlobalComponents`, keyed by GType name.
 *
 * Import it once, for its side effect, anywhere in a Vue project:
 *
 *     import '@gjsify/gtk-host/vue-components';
 *
 * WHY GTYPE NAMES AND NOT KEBAB. Volar camelizes and capitalises a template tag
 * before it looks the component up, so ONE `GtkBox` key answers both `<GtkBox>`
 * and `<gtk-box>`. A kebab key answers only the kebab spelling — measured, a
 * Pascal tag against a kebab key is TS2339. So the GType name is the key, exactly
 * as it is the registry key and the GtkBuilder key.
 *
 * The exception is generated, not curated: that camelize has no acronym knowledge,
 * so `gtk-gl-area` becomes `GtkGlArea` and misses `GtkGLArea`. Those widgets get
 * an extra kebab key in `WidgetPropsVueAliases`, and the generator finds them by
 * rule rather than by bug report — one today.
 *
 * `strictTemplates: true` IS REQUIRED, AND IT MUST BE SET IN THE BASE OF THE
 * `extends` CHAIN. Measured on `vue-tsc@3.3.11`, four cells, all four: the BASE
 * tsconfig's value wins and the child's is ignored outright — a base with
 * `strictTemplates: true` stays strict under a child that sets `false`, and a lax
 * base stays lax under a child that sets `true`. So in a monorepo the shared base
 * config decides this for every package, a per-package override does nothing, and
 * nothing says so. Check the value with `vue-tsc --showConfig`, not by reading the
 * nearest tsconfig.
 *
 * This is the load-bearing warning.
 * Measured: without it, an unknown prop, an unknown event and an entirely
 * UNRESOLVED tag are all silently accepted, while wrong VALUE types still error.
 * A project without it therefore sees type errors appear and concludes the surface
 * is working, while every misspelled property and every widget whose key does not
 * resolve goes unchecked.
 */

import type { DefineComponent } from '@vue/runtime-core';

import type { VueAttributes, WithOnce } from './attrs.js';
import type { WidgetPropsByGType, WidgetPropsVueAliases } from './generated/props.js';

type VueWidgetProps = WidgetPropsByGType & WidgetPropsVueAliases;

export type GtkGlobalComponents = {
    [K in keyof VueWidgetProps]: DefineComponent<WithOnce<VueWidgetProps[K]> & VueAttributes>;
};

declare module '@vue/runtime-core' {
    interface GlobalComponents extends GtkGlobalComponents {}
}
