// `className` + `style` → ONE property record → ONE partition → ONE class name.
//
// ADR 0032 § 4 is the whole of this file: two front ends, one normalised property
// set. `className="mt-2 bg-emphasis"` and `style={{ marginTop: 8, backgroundColor:
// '…' }}` are the same information arriving by different routes, and the measured
// application writes both — 469 `className=` against 57 `style={`, of which 48 are
// object literals carrying the class families' own property names. Partitioning
// them separately would be two truths about one question, and the one that answers
// first would win by accident.
//
// THE ORDER IS `className` THEN `style`, AND IT IS NOT ARBITRARY. CSS gives an
// inline style higher precedence than a class, NativeWind resolves the same way,
// and a reader who writes `className="mt-2" style={{ marginTop: 0 }}` means the
// zero. Last-assignment-wins over one record is how `resolveUtilities` already
// implements "later classes win", so extending it across the two front ends needs
// no second mechanism.
//
// WHAT LEAVES THIS FILE UNWRAPPED. An unknown utility or an unroutable property
// raises `@gjsify/gtk-host/style`'s own `UnknownUtilityError` and it is NOT
// re-thrown as a `PrimitiveError`. That message already names the utility and lists
// what the scale does hold, which is the actionable half; wrapping it would either
// hide the class from a caller's `catch` or print the same sentence twice. What a
// wrap would add is the primitive's name, and a React component stack already has
// it.

import { partition, resolveUtilities, type Partitioned, type StyleProps } from '@gjsify/gtk-host/style';
import type { StyleTokens } from '@gjsify/gtk-host/style';

import { isAnimatedValue, type AnimatedValueLike } from '../animated/brand.js';
import { splitVariants, type ClassGroups, type ClassNameInput } from './classes.js';
import { PrimitiveError } from './errors.js';

/**
 * A React Native `style` prop.
 *
 * Arrays nest, and `false` / `null` / `undefined` are what a short-circuit
 * (`style={[base, active && overlay]}`) leaves behind — React Native's own
 * `StyleSheet.flatten` accepts all of it, so the alias has to as well.
 */
export type StyleInput = StyleObject | StyleInputArray | false | null | undefined;
export type StyleObject = Readonly<Record<string, unknown>>;
interface StyleInputArray extends ReadonlyArray<StyleInput> {}

/**
 * A `style` prop → one flat object, later entries winning.
 *
 * React Native's own rule, and the reason it is spelled out rather than assumed:
 * `[a, b]` means "b over a", so a `reduce` that merged in the other direction
 * would make every conditional override a no-op — and a no-op override looks
 * exactly like a style that was never written.
 */
export function flattenStyle(style: StyleInput): StyleObject {
    if (style === null || style === undefined || style === false) return {};
    if (!Array.isArray(style)) return style as StyleObject;
    const out: Record<string, unknown> = {};
    for (const entry of style as StyleInputArray) Object.assign(out, flattenStyle(entry));
    return out;
}

/**
 * A style → its plain entries and its `Animated.Value`s, split before the partition.
 *
 * L2's and not `components.ts`', because TWO readers need this split and one of them
 * is a PARENT. `Animated.View` needs the animated half to bind; a parent counting its
 * absolutely positioned children needs to be able to READ an
 * `<Animated.View className="absolute" style={{ opacity: value }}>` at all, and
 * `normalise` refuses a non-scalar style value by design (`scalarOnly`). So the raw
 * style handed to `declaresAbsolute` threw where the parent wanted an answer, the
 * throw was swallowed as "not absolute", and the child then got the refusal that names
 * the PARENT for something the parent could not see — #1451, and the reason two
 * finished features (a 160 ms fade and `absolute`) did not compose.
 *
 * Dropping the animated half hides nothing. An `Animated.Value` under a plain `<View>`
 * is still refused BY NAME when that element resolves its own style, which is the
 * element that authored it — the parent's read is a question about somebody else's
 * props and never the place that judges them.
 */
export function splitAnimatedStyle(style: StyleInput): {
    readonly plain: StyleObject;
    readonly animated: Readonly<Record<string, AnimatedValueLike>>;
} {
    const plain: Record<string, unknown> = {};
    const animated: Record<string, AnimatedValueLike> = {};
    for (const [key, value] of Object.entries(flattenStyle(style))) {
        if (isAnimatedValue(value)) animated[key] = value;
        else plain[key] = value;
    }
    return { plain, animated };
}

/**
 * Style properties where a bare React Native NUMBER is not a length.
 *
 * React Native's rule is "every numeric style value is in density-independent
 * pixels", and these are its own exceptions. Appending `px` to them produces a value
 * the partition then refuses for the wrong reason: `flexGrow: 1` became `"1px"` and
 * came back as "there is no growth factor" — a refusal of a spelling nobody wrote.
 *
 * `flex`, `flexShrink`, `zIndex` and `aspectRatio` are not properties L1 routes at
 * all, and they are listed anyway: without them the diagnostic for
 * `style={{ flex: 1 }}` is a pixel complaint instead of L1's own "is not a property
 * the style partition routes", which is the message that says which layer to look in.
 */
const UNITLESS: ReadonlySet<string> = new Set([
    'flexGrow',
    'flexShrink',
    'flex',
    'opacity',
    'fontWeight',
    'zIndex',
    'aspectRatio',
]);

/** What one element authored, before any of it has been interpreted. */
export interface StyleAuthored {
    readonly className?: ClassNameInput;
    readonly style?: StyleInput;
}

/**
 * `{ className, style }` → the property record L1 partitions.
 *
 * The class list's VARIANTS do not come through here: they are a different
 * question (WHEN a declaration applies) with a different destination (a
 * pseudo-class on the generated selector), so they are returned beside the record
 * rather than folded into it.
 */
export function normalise(
    authored: StyleAuthored,
    tokens: StyleTokens,
    primitive: string,
): { readonly props: StyleProps; readonly groups: ClassGroups } {
    const groups = splitVariants(authored.className, primitive);
    const props: StyleProps = { ...resolveUtilities(groups.base, tokens) };
    // A `style` object is already in `StyleProps`' spelling — that IS ADR 0032 § 4's
    // claim, and `LayoutProps`/`PaintProps` are written in React Native's names
    // because of it. The partition reads strings, so the one coercion a style object
    // needs happens here rather than in six routes.
    for (const [key, value] of Object.entries(flattenStyle(authored.style))) {
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' && typeof value !== 'string') scalarOnly(primitive, key, value);
        (props as Record<string, unknown>)[key] = typeof value === 'number' ? stringify(key, value) : value;
    }
    return { props, groups };
}

/**
 * A variant group → the CSS declarations its pseudo-class carries.
 *
 * A VARIANT CAN ONLY CHANGE CSS, and that is the refusal this function exists for.
 * `active:opacity-70` is a declaration on `.x:active` and costs nothing at
 * runtime — GTK animates the state itself (ADR 0032 § 7). `active:flex-1` asks for
 * the widget property `hexpand` to change while a finger is down, and GTK has no
 * pseudo-class form of a widget property at all: there is no `:active` variant of
 * `hexpand`. Letting that through would emit a class whose `:active` rule is empty
 * and a widget property applied unconditionally — a style that is wrong in both
 * states and loud in neither.
 */
export function variantDeclarations(
    groups: ClassGroups,
    tokens: StyleTokens,
    primitive: string,
): Readonly<Record<string, readonly string[]>> {
    const out: Record<string, readonly string[]> = {};
    for (const [variant, utilities] of Object.entries(groups.variants)) {
        const partitioned = partition(resolveUtilities(utilities, tokens));
        const propNames = Object.keys(partitioned.props);
        const intentNames = Object.keys(partitioned.intent);
        if (propNames.length > 0 || intentNames.length > 0) {
            throw new PrimitiveError(
                primitive,
                `className "${variant}:${utilities.join(` ${variant}:`)}"`,
                `resolves to ${[...propNames, ...intentNames].join(', ')}, which ${propNames.length > 0 ? 'is a GTK WIDGET PROPERTY' : 'is a layout INTENT'} rather than a CSS declaration. A variant becomes a GTK CSS pseudo-class, and a widget property has no pseudo-class form — only the paint half of the vocabulary (colour, opacity, radius, border, font) can carry a variant`,
            );
        }
        out[variant] = partitioned.css;
    }
    return out;
}

/**
 * Refuse a style value that is neither a number nor a string.
 *
 * MEASURED, and it is the exit-0 class this whole partition exists against:
 * `@gjsify/gtk-host/style`'s `partitionPaint` composes `${cssName}: ${value}` with no
 * check on the value's type, so `style={{ opacity: someObject }}` reaches GTK as the
 * declaration `opacity: [object Object]` — which GTK's CSS parser drops in silence.
 * The element renders, the class is minted, and nothing about the appearance is what
 * was written.
 *
 * The commonest way to produce one is real: forgetting the `Animated.` on a `<View>`
 * whose style carries an `Animated.Value`. That case gets its own sentence, which is
 * why the brand lives in a module with no framework and no `gi://` in it — L2 has to
 * be able to recognise the type without importing the class.
 *
 * `null` and `undefined` never arrive here: they are React Native's own "no value" and
 * are skipped by the caller before this runs.
 */
function scalarOnly(primitive: string, key: string, value: unknown): never {
    throw new PrimitiveError(
        primitive,
        `style={{ ${key}: … }}`,
        isAnimatedValue(value)
            ? 'carries an `Animated.Value`, and this element is not an `Animated.View`. A plain element partitions its style into GTK CSS and widget properties before a widget sees it, so the value would land in a CSS declaration as "[object Object]" — which GTK drops without a diagnostic. Render `<Animated.View>` instead'
            : `is a ${Array.isArray(value) ? 'array' : typeof value}, and the style partition reads numbers and strings. GTK CSS is composed by interpolating the value into a declaration, so anything else becomes a declaration GTK’s parser drops in silence`,
    );
}

/** A React Native number → the string the partition reads, with a unit where there is one. */
const stringify = (key: string, value: number): string => (UNITLESS.has(key) ? `${value}` : `${value}px`);

/** The narrow half of `StyleSheet` L2 needs: declarations in, a class name out. */
export interface ClassNameSink {
    classFor(declarations: readonly string[], variants?: Readonly<Record<string, readonly string[]>>): string;
}

/**
 * Mint the ONE class name a set of declarations gets, or `null` for "no style".
 *
 * A STRUCTURAL interface rather than `StyleSheet` itself, and the reason is the
 * test rather than the abstraction: `StyleSheet` constructs a `Gtk.CssProvider` and
 * installs it on a `Gdk.Display`, so a spec that wanted to assert which class a
 * `<View className="…">` gets would need a display to check a pure-data decision.
 * `StyleSheet` satisfies this interface without knowing it exists.
 *
 * `classFor` REFUSES an empty declaration set by name ("an empty class would name
 * nothing"), so the empty case is answered here instead of being handed on.
 */
export function mintClass(
    sheet: ClassNameSink,
    declarations: readonly string[],
    variants: Readonly<Record<string, readonly string[]>>,
): string | null {
    const hasVariant = Object.values(variants).some((decls) => decls.length > 0);
    if (declarations.length === 0 && !hasVariant) return null;
    return sheet.classFor(declarations, variants);
}

/** `partition`, re-exported so a caller of L2 needs one import for the style path. */
export type { Partitioned, StyleProps, StyleTokens };
export { partition };
