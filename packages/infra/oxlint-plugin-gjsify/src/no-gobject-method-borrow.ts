// `gjsify/no-gobject-method-borrow` — borrowing a GObject instance method and
// `.call()`-ing it on a CLASS object works under gjs and answers WRONG over the
// reverse bridge, with no error on either.
//
// THE MECHANISM. `GObject.Object.find_property.call(SomeClass, 'x')` and
// `GObject.Object.list_properties.call(SomeClass)` read a class's ParamSpecs by
// taking the instance method off the base prototype and applying it to a
// constructor. Under gjs that resolves; over node-gi it does NOT, because
// node-gi's class proxy takes no `g_type_class_ref`, so the class the process has
// not realised has no properties to report. Measured, and the two halves disagree
// SILENTLY:
//
//   `GObject.Object.list_properties.call(Gtk.ListItem)`  gjs → array(9), node-gi → array(0)
//   `Gtk.ListItem.list_properties()`                     gjs → array(9), node-gi → array(9)
//
// So the direct form is portable and the borrowed form is not. Nothing throws:
// the borrowed form returns an EMPTY array or NULL, which a caller reads as "the
// class has no such property" — a wrong answer, not a failure. Tracked as issue
// #1438.
//
// THE INCIDENT, and why a comment beside the idiom was not enough. Two
// occurrences arose independently — `list_properties` in the list family, and
// `find_property` in the style partition's theme spec — both written by someone
// who did not know the direct form existed. The second cost two red CI rounds on
// three legs, and was MASKED by a different defect in the same three lines: the
// first fix made the vector assert the right thing, and the assertion then failed
// on the borrowed read underneath it.
//
// WHY A LINT RULE AND NOT A TEST. The defect is invisible on Linux by
// construction — gjs answers correctly, so a green local run and a green main leg
// prove nothing about it. Only the reverse-bridge and darwin legs can see it, and
// those are the legs nobody watches. A rule catches it at the keystroke instead,
// which is the only place the cost is zero.
//
// WHAT IT FLAGS. `GObject.Object.<method>.call(…)` / `.apply(…)`, with or without
// an explicit `.prototype`. Deliberately narrow: the base class is the only
// object whose methods are borrowed this way in practice, and a rule that means
// something is worth more than one that catches every conceivable spelling.
//
// WHAT IT DOES NOT FLAG. The direct form (`SomeClass.list_properties()`), which is
// the fix. `paramSpecs()` in `@gjsify/gtk-host`, which is that form behind a cache
// and is what a spec in this repo should reach for.

import type { Context, Node, Rule } from './types.ts';

/** `a.b` → `'a.b'` for plain identifier chains, else `undefined`. */
function dottedName(node: Node | undefined): string | undefined {
    if (!node) return undefined;
    if (node.type === 'Identifier') return typeof node.name === 'string' ? node.name : undefined;
    if (node.type !== 'MemberExpression' || node.computed === true) return undefined;
    const object = dottedName(node.object as Node | undefined);
    const property = node.property as Node | undefined;
    if (object === undefined || property?.type !== 'Identifier') return undefined;
    return typeof property.name === 'string' ? `${object}.${property.name}` : undefined;
}

export const noGObjectMethodBorrowRule: Rule = {
    meta: {
        // No autofix. The repair depends on what the borrowed method is and what
        // the caller wants back — `list_properties.call(K)` becomes
        // `K.list_properties()`, but in this repo it should usually become
        // `paramSpecs(K, 'GTypeName')`, and only the author knows which.
        fixable: false,
    },
    create(context: Context) {
        return {
            CallExpression(node: Node) {
                const callee = node.callee as Node | undefined;
                if (callee?.type !== 'MemberExpression' || callee.computed === true) return;
                const invoked = callee.property as Node | undefined;
                if (invoked?.type !== 'Identifier') return;
                if (invoked.name !== 'call' && invoked.name !== 'apply') return;

                // `GObject.Object.<method>` or `GObject.Object.prototype.<method>`.
                const borrowed = callee.object as Node | undefined;
                if (borrowed?.type !== 'MemberExpression' || borrowed.computed === true) return;
                const holder = dottedName(borrowed.object as Node | undefined);
                if (holder !== 'GObject.Object' && holder !== 'GObject.Object.prototype') return;
                const method = borrowed.property as Node | undefined;
                if (method?.type !== 'Identifier' || typeof method.name !== 'string') return;

                context.report({
                    message:
                        `\`GObject.Object.${method.name}.${invoked.name}(…)\` borrows a GObject instance method and ` +
                        'applies it to a class object. That resolves under gjs and answers WRONG over the reverse ' +
                        "bridge — node-gi's class proxy takes no `g_type_class_ref`, so a class the process has not " +
                        'realised reports nothing. MEASURED: `GObject.Object.list_properties.call(Gtk.ListItem)` is ' +
                        'array(9) under gjs and array(0) over node-gi, while `Gtk.ListItem.list_properties()` is 9 ' +
                        'on both. Nothing throws — you get an empty array or null, which reads as "the class has no ' +
                        `such property". Call it directly on the class (\`SomeClass.${method.name}(…)\`), or in this ` +
                        "repo use `paramSpecs(SomeClass, 'GTypeName')` from `@gjsify/gtk-host`, which is the direct " +
                        'form behind a cache. See issue #1438.',
                    node,
                });
            },
        };
    },
};
