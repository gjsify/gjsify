// L2 — the primitive descriptors, and the one function that executes them.
//
// Exported as a whole so a NON-React binding needs exactly one import to render the
// React Native vocabulary onto GTK: `resolvePrimitive(name, props, { tokens, sheet,
// parent, children })` answers with the tag, the widget properties, the class name,
// the events and what is still unresolved. ADR 0032 § 1 puts this layer below the
// framework, and a barrel that leaked a React type would be the first place that
// stopped being true.

export { splitVariants } from './classes.js';
export type { ClassGroups, ClassNameInput } from './classes.js';
export { PrimitiveError } from './errors.js';
export { resolveIntent } from './intents.js';
export type { ChildContext, ChildFacts, IntentInput, IntentResolution, Orientation, WidgetFacts } from './intents.js';
export { declaresAbsolute, resolvePrimitive } from './resolve.js';
export type { PrimitiveContext, PrimitivePlan, PrimitiveProps, ResolvedEvent, WidgetNode } from './resolve.js';
export { flattenStyle, mintClass, normalise, variantDeclarations } from './style.js';
export type { ClassNameSink, StyleAuthored, StyleInput, StyleObject } from './style.js';
export { FRAMEWORK_PROPS, PRIMITIVE_NAMES, PRIMITIVES } from './table.js';
export type {
    Coercion,
    ContentSpec,
    EventRoute,
    IgnoredRoute,
    PrimitiveSpec,
    PropRoute,
    PropertyRoute,
    RefusedRoute,
    StylePropertyRoute,
} from './table.js';
