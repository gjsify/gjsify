// `gjsify/register-class-order` — keep GObject metadata fields above the
// `GObject.registerClass` static block.
//
// GJS classes register their GObject type from a `static { … }` block:
//
//     class MyWidget extends Gtk.Widget {
//         static {
//             GObject.registerClass({ GTypeName: 'MyWidget', … }, this);
//         }
//         static Properties = { … };   // ← read by registerClass, declared AFTER it
//     }
//
// The alternate GJS idiom puts the GObject metadata in `static` class fields
// (`static GTypeName`, `static Properties`, `static InternalChildren`, …) that
// `GObject.registerClass(this)` reads off the class. When such a field is
// declared AFTER the `static {}` block that calls `registerClass`, the
// registration runs before the field is assigned — the metadata is silently
// ignored. This rule flags those fields and hoists them above the block.
//
// Refs: GNOME/gjs#704, gjsify/ts-for-gir#410.

import type { ClassBody, Context, Fixer, Node, PropertyDefinition, Rule, StaticBlock } from './types.ts';

/**
 * GObject metadata keys that `GObject.registerClass` reads off a class (whether
 * passed inline as the first argument or declared as `static` class fields).
 * A `static` field whose key is one of these and that sits AFTER the
 * registerClass static block is the bug this rule targets.
 */
const GOBJECT_METADATA_KEYS = new Set<string>([
    'GTypeName',
    'GTypeFlags',
    'Properties',
    'Signals',
    'InternalChildren',
    'Children',
    'Template',
    'CssName',
    'CssTemplate',
    'Implements',
    'Requires',
]);

function isStaticBlockCallingRegisterClass(el: Node): el is StaticBlock {
    if (el.type !== 'StaticBlock') return false;
    const body = (el as StaticBlock).body;
    for (const stmt of body) {
        if (stmt.type !== 'ExpressionStatement') continue;
        const expr = stmt.expression as Node | undefined;
        if (!expr || expr.type !== 'CallExpression') continue;
        const callee = (expr as Node).callee as Node | undefined;
        // Match `GObject.registerClass(...)` (and any `<X>.registerClass(...)`).
        if (
            callee &&
            callee.type === 'MemberExpression' &&
            !(callee.computed as boolean) &&
            (callee.property as Node | undefined)?.type === 'Identifier' &&
            ((callee.property as Node).name as string) === 'registerClass'
        ) {
            return true;
        }
    }
    return false;
}

/** Read the static-property key name when it is a plain (non-computed) identifier. */
function staticMetadataKeyName(el: Node): string | null {
    if (el.type !== 'PropertyDefinition' && el.type !== 'TSAbstractPropertyDefinition') return null;
    const field = el as PropertyDefinition;
    if (!field.static || field.computed) return null;
    const key = field.key;
    if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
    return null;
}

export const registerClassOrderRule: Rule = {
    meta: {
        fixable: 'code',
    },
    create(context: Context) {
        return {
            ClassBody(node: Node) {
                const elements = (node as ClassBody).body;

                // Find the FIRST static block that calls registerClass.
                let blockIndex = -1;
                let block: StaticBlock | null = null;
                for (let i = 0; i < elements.length; i++) {
                    if (isStaticBlockCallingRegisterClass(elements[i])) {
                        blockIndex = i;
                        block = elements[i] as StaticBlock;
                        break;
                    }
                }
                if (blockIndex === -1 || block === null) return;

                // Collect static GObject-metadata fields that appear AFTER it.
                const offending: PropertyDefinition[] = [];
                for (let i = blockIndex + 1; i < elements.length; i++) {
                    const key = staticMetadataKeyName(elements[i]);
                    if (key !== null && GOBJECT_METADATA_KEYS.has(key)) {
                        offending.push(elements[i] as PropertyDefinition);
                    }
                }
                if (offending.length === 0) return;

                const blockNode = block;
                const sourceText = context.sourceCode.text;

                // One report per offending field for precise diagnostics, but a
                // SINGLE combined autofix attached to the first report only.
                // Reason: every field's hoist inserts at the same anchor (before
                // the static block), so per-field fixes would conflict and oxlint
                // applies only one per pass — `oxlint --fix` would need multiple
                // runs to converge. A single combined fix hoists all fields in one
                // pass and removes them (plus trailing whitespace, so no blank gap
                // is left behind).
                const combinedFix = (fixer: Fixer) => {
                    const hoisted = offending.map((f) => context.sourceCode.getText(f)).join('\n\n    ');
                    const fixes = [fixer.insertTextBefore(blockNode, `${hoisted}\n\n    `)];
                    for (const f of offending) {
                        let removeEnd = f.end;
                        while (removeEnd < sourceText.length && /[ \t\r\n]/.test(sourceText[removeEnd])) {
                            removeEnd++;
                        }
                        fixes.push(fixer.removeRange([f.start, removeEnd]));
                    }
                    return fixes;
                };

                offending.forEach((field, idx) => {
                    const keyName = staticMetadataKeyName(field) ?? 'field';
                    context.report({
                        message:
                            `GObject metadata field \`static ${keyName}\` is declared after the \`GObject.registerClass\` ` +
                            `static block — registerClass runs before it is assigned, so the metadata is ignored. ` +
                            `Move it above the static block.`,
                        node: field,
                        // Attach the combined fix to the first report only.
                        ...(idx === 0 ? { fix: combinedFix } : {}),
                    });
                });
            },
        };
    },
};
