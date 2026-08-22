// `gjsify/no-literal-widget-label` — user-visible text hard-coded into a widget from TypeScript.
//
// This is the half of the Blueprint problem that survives even after a class HAS a template: a
// label handed to a constructor or a setter as a bare string literal. It is not a style question.
// `xgettext` collects `translatable="yes"` out of Blueprint and `_("…")` out of TypeScript, and a
// bare literal is neither — so the string is invisible to extraction, absent from every catalogue,
// and shows up in the user's language only by accident. The failure is silent in the worst way:
// the interface looks untranslated rather than untranslatABLE, so it never gets filed.
//
// Two repairs, and the rule accepts both because the right one depends on the string:
//   · move it into the co-located `.blp` as `title: _("…")` — correct for anything static;
//   · wrap it here as `_("…")` — correct for a string a runtime value picks.
// Either turns the literal into something extraction can see, which is why wrapping silences it.
//
// Only PROSE positions are checked. `icon-name`, `css-classes`, `action-name`, a stack page's
// `name` and an `Adw.EntryRow`'s `text` (which carries user data, not a caption) are deliberately
// absent: a false finding on those would teach people to disable the rule.

import type { Context, Node, Rule } from './types.ts';
import { walk } from './walk.ts';

/** Constructor-object keys whose value is shown to a person. Both GJS spellings. */
const PROSE_PROPERTIES = new Set<string>([
    'label',
    'title',
    'subtitle',
    'description',
    'heading',
    'body',
    'tooltipText',
    'tooltip_text',
    'placeholderText',
    'placeholder_text',
    'secondaryText',
    'secondary_text',
]);

/** Setters that write the same prose positions. */
const PROSE_SETTERS = new Set<string>([
    'set_label',
    'set_title',
    'set_subtitle',
    'set_description',
    'set_heading',
    'set_body',
    'set_tooltip_text',
    'set_placeholder_text',
]);

/**
 * Is this literal worth reporting?
 *
 * A caption needs letters. `""`, `"—"`, `"…"`, `"%"` and `"3"` are punctuation or data with
 * nothing to translate, and reporting them is how a rule loses its audience.
 */
function isProse(value: unknown): value is string {
    return typeof value === 'string' && /\p{L}/u.test(value);
}

/** The string value of a plain literal (not a template, not a concatenation); else null. */
function literalString(node: Node | undefined): string | null {
    if (!node) return null;
    if (node.type === 'Literal' && isProse(node.value)) return node.value as string;
    // A no-substitution template literal is a literal in every way that matters here.
    if (node.type === 'TemplateLiteral') {
        const expressions = node.expressions as Node[] | undefined;
        const quasis = node.quasis as Node[] | undefined;
        if (expressions?.length === 0 && quasis?.length === 1) {
            const cooked = (quasis[0].value as { cooked?: unknown } | undefined)?.cooked;
            if (isProse(cooked)) return cooked;
        }
    }
    return null;
}

/** `Gtk`/`Adw` namespaced callee — `new Adw.ActionRow(…)`. */
function isGtkAdwNew(node: Node): boolean {
    if (node.type !== 'NewExpression') return false;
    const callee = node.callee as Node | undefined;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed === true) return false;
    const object = callee.object as Node | undefined;
    if (object?.type !== 'Identifier') return false;
    const ns = object.name as string;
    return ns === 'Gtk' || ns === 'Adw';
}

export const noLiteralWidgetLabelRule: Rule = {
    create(context: Context) {
        const report = (node: Node, key: string, text: string): void => {
            const shown = text.length > 40 ? `${text.slice(0, 40)}…` : text;
            context.report({
                message:
                    `\`${key}\` is set to the literal "${shown}". Extraction sees neither a Blueprint ` +
                    `\`translatable\` attribute nor a \`_()\` call here, so this text can never reach a ` +
                    `catalogue. Move it into the co-located .blp as \`${key}: _("…")\`, or wrap it as \`_("…")\` ` +
                    `if a runtime value picks it.`,
                node,
            });
        };

        return {
            Program(program: Node) {
                walk(program, (node) => {
                    // new Gtk.X({ title: "…" })
                    if (isGtkAdwNew(node)) {
                        for (const arg of (node.arguments as Node[] | undefined) ?? []) {
                            if (arg.type !== 'ObjectExpression') continue;
                            for (const prop of (arg.properties as Node[] | undefined) ?? []) {
                                if (prop.type !== 'Property' || prop.computed === true) continue;
                                const key = prop.key as Node | undefined;
                                if (key?.type !== 'Identifier') continue;
                                const name = key.name as string;
                                if (!PROSE_PROPERTIES.has(name)) continue;
                                const text = literalString(prop.value as Node | undefined);
                                if (text !== null) report(prop, name, text);
                            }
                        }
                        return;
                    }
                    // widget.set_title("…")
                    if (node.type === 'CallExpression') {
                        const callee = node.callee as Node | undefined;
                        if (!callee || callee.type !== 'MemberExpression' || callee.computed === true) return;
                        const property = callee.property as Node | undefined;
                        if (property?.type !== 'Identifier') return;
                        const name = property.name as string;
                        if (!PROSE_SETTERS.has(name)) return;
                        const args = (node.arguments as Node[] | undefined) ?? [];
                        const text = literalString(args[0]);
                        if (text !== null) report(node, name, text);
                    }
                });
            },
        };
    },
};
