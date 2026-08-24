// `gjsify/prefer-blueprint-template` — a widget class that BUILDS its children in TypeScript
// instead of declaring them in a Blueprint template.
//
// The incident this rule exists for is structural rather than a crash, which is why nothing else
// catches it. Measured across this workspace in 2026-08:
//
//     Learn6502 (the reference app)   24 .blp   8 programmatic `new Gtk/Adw.X`
//     bauplaner                        0 .blp  422
//     steuererklaerung                15 .blp  895   — and those 15 are empty scaffolds
//
// Learn6502 is proof that a whole application's interface fits in Blueprint. The other two grew
// the opposite way, one `append()` at a time, and the cost only shows up later and all at once:
//
//   · A string built into a widget from TypeScript cannot be marked `translatable`, so xgettext
//     never sees it. The interface is then untranslatable by construction, and it looks exactly
//     like an interface nobody has translated yet.
//   · `bind` and `notify` wiring has to be hand-written, so state and widget drift apart.
//   · There is no artifact a designer can read or a screenshot tool can diff against.
//
// WHAT IS NOT A FINDING. A template that populates DATA-DRIVEN children at runtime is the
// intended pattern, not a violation — declare the container in Blueprint, fill it in TypeScript.
// Such a class has a `Template`, so it is silent here. So is a class that constructs no widget at
// all (a model, a controller, a `vfunc_snapshot` drawing widget), and so is one that constructs
// widgets but never parents any — the rule requires BOTH signals before it says anything, because
// either one alone is ordinary code.
//
// Library code that implements widgets for others (a renderer, a host, a storybook harness) is
// exempt by nature; scope the rule to application packages in `.oxlintrc.json` rather than
// disabling it line by line.

import type { ClassBody, Context, Node, PropertyDefinition, Rule, StaticBlock } from './types.ts';
import { memberCallName, newGtkAdwType, walk } from './walk.ts';

/**
 * Methods that take a WIDGET and place it inside another one. Membership here is what separates
 * "constructs a widget" from "assembles an interface" — the second is the finding.
 */
const PARENTING_METHODS = new Set<string>([
    'set_child',
    'append',
    'prepend',
    'insert_child_after',
    'add',
    'add_row',
    'add_prefix',
    'add_suffix',
    'add_child',
    'add_overlay',
    'add_titled',
    'add_named',
    'add_page',
    'add_top_bar',
    'add_bottom_bar',
    'add_toolbar',
    'set_content',
    'set_title_widget',
    'set_start_widget',
    'set_end_widget',
    'set_center_widget',
    'set_header_suffix',
    'set_extra_child',
    'attach',
]);

/**
 * Constructions that are NOT widgets, so building one is never "assembling an interface".
 *
 * The rule needs both its signals to be about widgets, and it cannot type-check: it sees
 * `new Gtk.X` and a method NAME, never a GType. Most non-widgets are harmless because their own
 * API shares no name with a parenting method — `new Gtk.GestureClick()` + `add_controller` is
 * already silent. The ones that DO collide are listed here, `Gtk.StringList` being the case that
 * actually occurs: a combo row filling a model with `.append(<string>)` was reported as assembling
 * an interface, which is exactly the model case the header promises is silent.
 *
 * Families are matched by prefix below rather than enumerated, because their members are many and
 * the list would drift against the GIR.
 */
const NON_WIDGET_CONSTRUCTIONS = new Set<string>([
    'Gtk.Adjustment',
    'Gtk.AnyFilter',
    'Gtk.BoolFilter',
    'Gtk.Builder',
    'Gtk.BuilderListItemFactory',
    'Gtk.CssProvider',
    'Gtk.CustomFilter',
    'Gtk.CustomSorter',
    'Gtk.EntryBuffer',
    'Gtk.EveryFilter',
    'Gtk.FileDialog',
    'Gtk.FileFilter',
    'Gtk.ListStore',
    'Gtk.NumericSorter',
    'Gtk.SignalListItemFactory',
    'Gtk.SizeGroup',
    'Gtk.StringFilter',
    'Gtk.StringList',
    'Gtk.StringObject',
    'Gtk.StringSorter',
    'Gtk.TextBuffer',
    'Gtk.TextTag',
    'Gtk.TextTagTable',
    'Adw.Breakpoint',
    'Adw.BreakpointCondition',
    'Adw.CallbackAnimationTarget',
    'Adw.EnumListModel',
    'Adw.PropertyAnimationTarget',
    'Adw.SpringAnimation',
    'Adw.SpringParams',
    'Adw.StyleManager',
    'Adw.TimedAnimation',
    'Adw.Toast',
]);

/** Prefixes whose whole family is non-widget: controllers, gestures and list models. */
const NON_WIDGET_PREFIXES = ['Gtk.EventController', 'Gtk.Gesture', 'Gtk.MultiSorter'];

/** Suffixes covering the list-model and selection families without enumerating them. */
const NON_WIDGET_SUFFIXES = ['ListModel', 'Selection'];

function isNonWidgetConstruction(type: string): boolean {
    if (NON_WIDGET_CONSTRUCTIONS.has(type)) return true;
    if (NON_WIDGET_PREFIXES.some((prefix) => type.startsWith(prefix))) return true;
    return NON_WIDGET_SUFFIXES.some((suffix) => type.endsWith(suffix));
}

/**
 * Bases that are NOT widgets, so there is no interface for a template to hold. `Gtk.Application` /
 * `Adw.Application` are the ones that actually occur: an application object legitimately builds a
 * `Gtk.CssProvider` and an `Adw.AboutDialog` from its own metadata, and reporting that taught the
 * rule's first reader that it cries wolf.
 */
const NON_WIDGET_BASES = new Set<string>(['Gtk.Application', 'Adw.Application']);

/** `class X extends Gtk.Widget` / `extends Adw.Bin` → the base name; null for anything else. */
function gtkAdwSuperClass(node: Node): string | null {
    const superClass = node.superClass as Node | undefined;
    if (!superClass || superClass.type !== 'MemberExpression' || superClass.computed === true) return null;
    const object = superClass.object as Node | undefined;
    const property = superClass.property as Node | undefined;
    if (object?.type !== 'Identifier' || property?.type !== 'Identifier') return null;
    const ns = object.name as string;
    if (ns !== 'Gtk' && ns !== 'Adw') return null;
    const base = `${ns}.${property.name as string}`;
    return NON_WIDGET_BASES.has(base) ? null : base;
}

/** A `Template` key directly on this object literal — not nested anywhere inside it. */
function objectDeclaresTemplate(node: Node): boolean {
    if (node.type !== 'ObjectExpression') return false;
    for (const prop of (node.properties as Node[] | undefined) ?? []) {
        if (prop.type !== 'Property' || prop.computed === true) continue;
        const key = prop.key as Node | undefined;
        if (key?.type === 'Identifier' && (key.name as string) === 'Template') return true;
    }
    return false;
}

/** A `registerClass(…)` call inside this static block whose metadata object carries `Template`. */
function staticBlockDeclaresTemplate(block: StaticBlock): boolean {
    let found = false;
    walk(block, (node) => {
        if (found || node.type !== 'CallExpression') return;
        const callee = node.callee as Node | undefined;
        const named =
            (callee?.type === 'MemberExpression' &&
                callee.computed !== true &&
                (callee.property as Node | undefined)?.type === 'Identifier' &&
                ((callee.property as Node).name as string) === 'registerClass') ||
            (callee?.type === 'Identifier' && (callee.name as string) === 'registerClass');
        if (!named) return;
        for (const arg of (node.arguments as Node[] | undefined) ?? []) {
            if (objectDeclaresTemplate(arg)) found = true;
        }
    });
    return found;
}

/**
 * True when THIS class body declares a `Template`: a `static Template` field of its own, or a
 * `registerClass` metadata object inside its own `static {}` block, which is this repo's
 * convention (see the sibling `gjsify/register-class-order`).
 *
 * Deliberately NOT a subtree search. An unbounded walk for the identifier `Template` was silenced
 * by things that declare nothing — a data literal that merely uses the word (`{ Template: false }`,
 * `{ columns: [{ Template: 'row.ui' }] }`), and a NESTED helper class carrying the only real
 * template. The rule's whole value is that it cannot be switched off by accident, so an accidental
 * silencer is worse here than a missed case.
 *
 * A class defined INSIDE the static block still counts, which is pathological enough to leave.
 */
function declaresTemplate(body: ClassBody): boolean {
    for (const element of body.body) {
        if (element.type === 'PropertyDefinition' || element.type === 'TSAbstractPropertyDefinition') {
            const field = element as PropertyDefinition;
            const key = field.key;
            if (field.static && !field.computed && key.type === 'Identifier' && key.name === 'Template') {
                return true;
            }
            continue;
        }
        if (element.type === 'StaticBlock' && staticBlockDeclaresTemplate(element as StaticBlock)) return true;
    }
    return false;
}

export const preferBlueprintTemplateRule: Rule = {
    create(context: Context) {
        const check = (node: Node): void => {
            const base = gtkAdwSuperClass(node);
            if (base === null) return;
            const body = node.body as ClassBody | undefined;
            if (!body || body.type !== 'ClassBody') return;
            if (declaresTemplate(body)) return;

            const constructed: string[] = [];
            let parents = false;
            walk(body, (inner) => {
                const type = newGtkAdwType(inner);
                if (type !== null) {
                    if (!isNonWidgetConstruction(type) && !constructed.includes(type)) constructed.push(type);
                    return;
                }
                const method = memberCallName(inner);
                if (method !== null && PARENTING_METHODS.has(method)) parents = true;
            });

            // BOTH signals, deliberately: constructing without parenting is a model or an
            // adjustment, and parenting without constructing is moving an existing widget.
            if (constructed.length === 0 || !parents) return;

            const shown = constructed.slice(0, 3).join(', ');
            const more = constructed.length > 3 ? `, +${constructed.length - 3} more` : '';
            context.report({
                message:
                    `\`${base}\` subclass assembles its interface in TypeScript (${shown}${more}) with no ` +
                    `Blueprint \`Template\`. Declare the widget tree in a co-located \`.blp\` and keep only ` +
                    `logic here — a string set from TypeScript can never be marked translatable, so an ` +
                    `interface built this way cannot be translated at all. Populating data-driven children ` +
                    `inside a template is fine and is not reported.`,
                node,
            });
        };
        return { ClassDeclaration: check, ClassExpression: check };
    },
};
