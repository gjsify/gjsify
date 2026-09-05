/**
 * Every failure this host reports names the tag, the property and the fix.
 *
 * The reason is measured, not stylistic: GTK's own failure mode is Exit 0.
 * Writing a string nick to an enum property is a SILENT no-op through both
 * `set_property()` and the JS setter (`box.orientation = 'vertical'` leaves it
 * at `HORIZONTAL`, gjs 1.88.1); writing a read-only property does not throw; and
 * a mis-parented widget floods stderr with `Gtk-WARNING` while the process still
 * exits 0. A renderer that stays quiet here produces a wrong window and a green
 * test run, so this host is loud on purpose.
 */
export class GtkHostError extends Error {
    override readonly name = 'GtkHostError';
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export const err = {
    unknownTag: (tag: string) =>
        new GtkHostError(
            'unknown-tag',
            `No descriptor registered for <${tag}>. Register one with registerWidget({ gtype: '${tag}', … }). ` +
                // NOT "or use a raw GType tag": `lookupWidget` is a Map.get and nothing
                // else — there is no `GObject.type_from_name` anywhere in this package —
                // so a real, installed GType name lands right back here. That is ADR
                // 0028's decision, not an omission ("As a TAG it does not: createElement
                // looks the GType name up exactly"), and the hierarchy walk that DOES
                // exist, `nearestRegistered`, only ever answers for a mount container.
                `Being a real GType in the installed typelib is not enough on its own.`,
        ),
    missingConstructProp: (tag: string, prop: string) =>
        new GtkHostError(
            'missing-construct-prop',
            `<${tag}> cannot be constructed without ${prop}. In the installed library this is not an ` +
                `exception but a g_error(): the process ABORTS (SIGABRT, exit 134, core dump) with no ` +
                `catch and no diagnostic, so the host refuses here while a refusal is still reportable. ` +
                `Author ${prop} on the element.`,
        ),
    unknownProp: (tag: string, prop: string) =>
        new GtkHostError(
            'unknown-prop',
            `<${tag}> has no property "${prop}". Check the spelling against the installed GTK ` +
                `(camelCase and kebab-case both resolve), or bind it as a signal with on${prop[0]?.toUpperCase()}${prop.slice(1)}.`,
        ),
    readOnlyProp: (tag: string, prop: string) =>
        new GtkHostError(
            'read-only-prop',
            `<${tag}>.${prop} is read-only in the installed GTK. Writing it is a silent no-op in GObject, ` +
                `so this host refuses it instead of dropping the value.`,
        ),
    noAccessor: (tag: string, prop: string, accessor: string) =>
        new GtkHostError(
            'no-accessor',
            `<${tag}>.${prop} has to be written through its JS accessor — a null or a list cannot be ` +
                `handed to set_property, which guesses a GType and finds none — and GJS installed no ` +
                `"${accessor}" on this object. Assigning it anyway would create a plain JS property: no ` +
                `GObject write, no error, and notify::${prop} never fires.`,
        ),
    badDetailedAction: (label: string, detailed: string, why: string) =>
        new GtkHostError(
            'bad-detailed-action',
            `The menu item "${label}" names the action ${JSON.stringify(detailed)}, which GIO cannot ` +
                `parse: ${why}. In the installed GIO this is not an exception but a g_error() inside ` +
                `g_menu_item_set_detailed_action: the process ABORTS (SIGABRT, exit 134) with no catch ` +
                `and no diagnostic, so the host refuses here while a refusal is still reportable. ` +
                `A detailed action name is "app.act", "app.act::target" or "app.act(variant)".`,
        ),
    badEnum: (tag: string, prop: string, nick: string, gtypeName: string) =>
        new GtkHostError(
            'bad-enum',
            `<${tag}>.${prop} expects ${gtypeName}, and "${nick}" is not one of its values. ` +
                `Note that GObject accepts the wrong string SILENTLY — the property would have kept its old value.`,
        ),
    unknownSignal: (tag: string, prop: string, signal: string) =>
        new GtkHostError(
            'unknown-signal',
            `<${tag}> emits no signal "${signal}" (bound as ${prop}). Check the spelling against the installed GTK, ` +
                `or use the escape hatch on:<raw-signal-name> if the name is irregular.`,
        ),
    signalTaken: (tag: string, prop: string, other: string, signal: string) =>
        new GtkHostError(
            'signal-taken',
            `<${tag}> already binds "${signal}" through ${other}, so ${prop} would silently replace it — ` +
                `GObject has one handler per connect, and this host keeps one per signal name. ` +
                `Use one spelling, or combine the two callbacks yourself.`,
        ),
    /**
     * A DOM event-phase modifier has no GObject translation, so it is named, not guessed.
     *
     * `capture` selects a phase of DOM tree propagation and a GObject signal does not
     * propagate through a tree at all — it is emitted on ONE object. `passive` is a
     * promise not to call `preventDefault`, which no GObject signal has. Kebabing
     * either into the signal name produced `emits no signal "clicked-capture"`, i.e.
     * this host blaming the user's spelling for a concept it simply does not carry.
     *
     * It lived in `signals.ts` as a bare `new GtkHostError` for its whole life, which
     * made this file's claim to BE the list false: the code existed, and the only
     * place that enumerates the codes did not know it.
     */
    eventModifier: (prop: string, modifier: string) =>
        new GtkHostError(
            'event-modifier',
            `${prop} carries the DOM listener modifier ".${modifier}", which has no GObject meaning: a signal is ` +
                `emitted on one object and does not propagate through a tree, so there is no capture phase and ` +
                `nothing to be passive about. Drop the modifier (${prop.slice(0, prop.length - modifier.length)}); ` +
                `for GTK4's own propagation phases set "propagation-phase" on a Gtk.EventController instead.`,
        ),
    badString: (tag: string, prop: string, got: string) =>
        new GtkHostError(
            'bad-string',
            `<${tag}>.${prop} is a string property and got a ${got}. Numbers and booleans are stringified; ` +
                `anything else has no unambiguous spelling, and GObject would have thrown from inside the next rebuild.`,
        ),
    badBoolean: (tag: string, prop: string, value: string) =>
        new GtkHostError(
            'bad-boolean',
            `<${tag}>.${prop} is a boolean and got the string "${value}". JS truthiness would make ` +
                `"false" mean TRUE — the exact silent-wrong-value this host exists to refuse. ` +
                `Pass a real boolean.`,
        ),
    badFlags: (tag: string, prop: string, value: string, gtypeName: string) =>
        new GtkHostError(
            'bad-flags',
            `<${tag}>.${prop} expects the flags type ${gtypeName}, and a string ("${value}") cannot be resolved to one. ` +
                `Pass the numeric value (bitwise-or the members). GObject would have dropped the string silently.`,
        ),
    unresolvableEnum: (gtypeName: string) =>
        new GtkHostError(
            'unresolvable-enum',
            `Cannot resolve the enum type ${gtypeName} to a GI namespace. Pass the numeric value instead, ` +
                `or extend ENUM_NAMESPACES in props.ts.`,
        ),
    textNotAccepted: (tag: string, text: string) =>
        new GtkHostError(
            'text-not-accepted',
            `<${tag}> has no text sink, so the text ${JSON.stringify(text.slice(0, 32))} has nowhere to go. ` +
                `Wrap it in a widget that takes text (<GtkLabel>), or set the property directly.`,
        ),
    unclaimedChild: (parentTag: string, childTag: string) =>
        new GtkHostError(
            'unclaimed-child',
            `<${parentTag}> declares children: { kind: 'none' }, so it cannot adopt <${childTag}>. ` +
                `Fix one of three things: give the parent a child policy, wrap the child in a container, ` +
                `or set the child on a property (e.g. a "child" or "content" property).`,
        ),
    unknownSlot: (parentTag: string, slot: string, known: string[]) =>
        new GtkHostError('unknown-slot', `<${parentTag}> has no slot "${slot}". Known slots: ${known.join(', ')}.`),
    /**
     * An adder-backed slot with nothing that takes the child back out.
     *
     * `descriptorProblems()` rejects this shape up front, so a BUILT-IN descriptor can
     * never reach here — but `registerWidget` takes descriptors from applications, which
     * run no such check. Without this the unmount would be
     * `TypeError: host[undefined] is not a function`, blaming the host for a claim the
     * descriptor made.
     */
    slotNeedsRemove: (parentTag: string, slot: string, adder: string) =>
        new GtkHostError(
            'slot-needs-remove',
            `<${parentTag}> puts children into slot "${slot}" with ${adder}() and its policy names no ` +
                `"remove" method, so this child cannot be taken out again. A set_-prefixed slot is emptied ` +
                `by writing null back through the setter and needs nothing; an adder-backed one needs ` +
                `children.remove. Add it to the descriptor.`,
        ),
    rejectedChild: (parentTag: string, childTag: string, reason: string) =>
        new GtkHostError(
            'rejected-child',
            `<${parentTag}> refused <${childTag}>: ${reason}. The container accepts only certain child types ` +
                `(e.g. AdwPreferencesPage takes AdwPreferencesGroup); the descriptor cannot know that, GTK does.`,
        ),
    uncuratedPlacement: (parentTag: string, childTag: string) =>
        new GtkHostError(
            'uncurated-placement',
            `<${parentTag}> comes from the GENERATED table, which knows the tag but not how the widget ` +
                `adopts a child, so it cannot take <${childTag}>. Guessing is the one thing that is not ` +
                `available here: \`add\`, \`append\` and \`set_child\` all exist somewhere in GTK and calling ` +
                `the wrong one is a warning at exit 0. Add a curated policy for ${parentTag} in ` +
                `descriptors/, or mount into a container that has one.`,
        ),
    siblingCycle: (parentTag: string) =>
        new GtkHostError(
            'sibling-cycle',
            `The child list of <${parentTag}> does not terminate. A renderer linked a node to itself ` +
                `or into a loop; the host refuses to walk it rather than spin. This is a host or adapter ` +
                `bug, not an application one — please report it with the reordering that produced it.`,
        ),
    notAWidget: (tag: string) =>
        new GtkHostError(
            'not-a-widget',
            `<${tag}> is not a Gtk.Widget, so it cannot be placed as a child. ` +
                `Non-widget GObjects (controllers, filters, models) attach to a property, not to a parent.`,
        ),
    occupiedSlot: (parentTag: string, childTag: string, setter: string) =>
        new GtkHostError(
            'occupied-slot',
            `<${parentTag}> already holds a child the application put there, and ${setter}() takes only ONE — ` +
                `placing <${childTag}> would unparent it. GTK does that silently: no throw, no warning, exit 0, ` +
                `and the application's own widget is simply gone. Mount into a container of your own inside ` +
                `<${parentTag}>, or clear the existing child first (${setter}(null)) if replacing it is the intent.`,
        ),
    /**
     * A portal descriptor naming a method the installed class does not have.
     *
     * `descriptorProblems()` rejects this shape up front, so a BUILT-IN descriptor
     * can never reach here — an application-registered one is checked by nobody,
     * and the alternative is `TypeError: widget[placement.present] is not a
     * function` thrown from inside an insert, naming neither the tag nor the axis.
     */
    portalMethodMissing: (tag: string, method: string, role: 'present' | 'close') =>
        new GtkHostError(
            'portal-method-missing',
            `<${tag}> declares placement: { kind: 'portal', ${role}: '${method}' } and the installed class has ` +
                `no ${method}(). A portal is placed by calling that method on the node itself — nothing goes ` +
                `into the parent — so without it the node can never reach the screen and never leave it. ` +
                `Fix the descriptor, or drop the portal placement and give the widget an ordinary child policy.`,
        ),
    notAnElement: (kind: string) =>
        new GtkHostError(
            'not-an-element',
            `Only an element node owns a widget, and this node is a ${kind}. A text node's content lives in its ` +
                `PARENT's text sink and an anchor owns nothing at all — neither has a widget to hand back. ` +
                `Ask the parent element instead.`,
        ),
    destroyedNode: (tag: string) =>
        new GtkHostError(
            'destroyed-node',
            `<${tag}> was destroyed, so its widget is gone. Asking again would MATERIALISE a fresh, propertyless, ` +
                `unparented widget — \`destroy\` clears props and layout precisely so a destroyed element cannot ` +
                `look re-materialisable — and a caller holding that widget would be looking at nothing on screen.`,
        ),
    notAHostParent: (got: string) =>
        new GtkHostError(
            'not-a-host-parent',
            `insert() needs a host element as the parent and got ${got}. A raw widget cannot be one: the shadow ` +
                `tree lives in the host's own fields, so writing them onto a GObject wrapper renders nothing and ` +
                `reports nothing — Vue's <Teleport to="someWidget"> hands the widget through verbatim and landed ` +
                `exactly here. Wrap it with adopt(widget) first, which is what mountRoot() does.`,
        ),
};
