// What a bare identifier in a `.blp` means, answered from the `@girs` vocabulary.
//
// `emit-xml.mjs` has one seam through which introspection reaches it — `EmitOptions.resolveIdent`
// — because `orientation: vertical` leaves `blueprint-compiler` as
// `<property name="orientation">1</property>` and nothing in the syntax carries that `1`. This
// module is the implementation of that seam, and it is a separate file so the emitter stays a
// function of its AST and a table it is handed.
//
// WHY `@girs` AND NOT THE INSTALLED TYPELIB
//
// ADR 0053 clause 4 reserved the installed typelib for VALIDATION — "a parser reading into a
// tree does not perform" a ParamSpec lookup. Emission turns out to need a lookup of its own, and
// answering it from the typelib would have cost the property the corpus exists to have: the
// shadow run has no skip path and runs on EVERY runner, including the no-GNOME ones, so a
// resolver that needs a GNOME runtime would have reintroduced the hole `--require-oracle` was
// added to close one stage over. `@girs/<ns>/vocabulary` is a pinned npm dependency, generated
// from the GIR, present wherever `gjsify install` has run. The typelib keeps validation; this
// takes emission. ADR 0053 § Amendment 1 records the split.
//
// TWO LOOKUPS, AND THE SECOND ONE IS WHY THIS IS NEW
//
// Resolving `vertical` to `1` needs to know WHICH enum `GtkBox.orientation` is, and then what
// that enum numbers `vertical` as. Until `@girs` 4.8.0 the vocabulary carried only `ENUM_NICKS`
// — the names, in declaration order — so the second lookup was answered by reading the
// installed typelib into a committed table and the first could not be answered at all:
// `corpus/divergences.mjs` used to say so, and searching the nick lists for an enum with a
// member called `never` finds several. 4.8.0 added `ENUM_VALUES` (ts-for-gir #465) and 4.9.0
// added `PROP_ENUMS` (#467), which is the join. Both lookups are now data.
//
// THE MEMBER SPELLING IS BLUEPRINT'S, THE KEY SPELLING IS THE GIR'S
//
// Measured against blueprint-compiler 0.20.4: `halign: baseline-fill` is an ERROR ("not a
// member of Gtk.Align", hint `baseline_fill`) and `halign: baseline_fill` compiles to `4`.
// Blueprint spells a member with UNDERSCORES and the vocabulary keys it with the GIR's kebab
// nick, so exactly one transform stands between them and it is applied here rather than assumed
// anywhere else. `rules/03-property-enum.blp` pins it.
//
// A FLAG SET IS NOT A NUMBER
//
// Also measured on 0.20.4: `input-hints: word_completion | lowercase` compiles to
// `<property name="input-hints">word-completion|lowercase</property>` — the nicks survive,
// hyphenated, joined with no spaces. So the same join that numbers an enum normalises a flag
// set, and the two answers differ in kind, which is why this seam returns TEXT and not a
// number. `rules/27-property-flags.blp` pins it.
//
// AN UNKNOWN MEMBER OF A KNOWN ENUM IS AN ERROR
//
// Where the join finds no enum the identifier is not one — `menu-model: mainMenu` is an object
// id and takes this path unresolved and correct — so `null` means "not ours" and the emitter
// writes the source spelling. But where the join DOES name an enum and the member is not in it,
// emitting the spelling would be silently wrong output, which is the failure ADR 0053 clause 3
// exists to prevent. That throws, naming the line, the property, the enum and the member, the
// way the oracle does.

import {
    DECLS as ADW_DECLS,
    ENUM_NICKS as ADW_ENUM_NICKS,
    ENUM_VALUES as ADW_ENUM_VALUES,
    ENUM_VALUES_UNREADABLE as ADW_ENUM_UNREADABLE,
    FLAG_VALUES as ADW_FLAG_VALUES,
    FLAG_VALUES_UNREADABLE as ADW_FLAG_UNREADABLE,
    PROP_ENUMS as ADW_PROP_ENUMS,
} from '@girs/adw-1/vocabulary';
import {
    DECLS as GTK_DECLS,
    ENUM_NICKS as GTK_ENUM_NICKS,
    ENUM_VALUES as GTK_ENUM_VALUES,
    ENUM_VALUES_UNREADABLE as GTK_ENUM_UNREADABLE,
    FLAG_VALUES as GTK_FLAG_VALUES,
    FLAG_VALUES_UNREADABLE as GTK_FLAG_UNREADABLE,
    PROP_ENUMS as GTK_PROP_ENUMS,
} from '@girs/gtk-4.0/vocabulary';

// Two namespaces and not more, because those are the two `using` lines the corpus has and the
// two the vocabulary is generated for. A GType NAME is globally unique, so merging cannot
// collide by construction — and Gtk's tables already carry the enums it inherits from its
// dependency closure (`PangoEllipsizeMode` is in there), so a third import would add names
// neither namespace declares.
const DECLS = { ...GTK_DECLS, ...ADW_DECLS };
const PROP_ENUMS = { ...GTK_PROP_ENUMS, ...ADW_PROP_ENUMS };
const ENUM_NICKS = { ...GTK_ENUM_NICKS, ...ADW_ENUM_NICKS };
const ENUM_VALUES = { ...GTK_ENUM_VALUES, ...ADW_ENUM_VALUES };
const FLAG_VALUES = { ...GTK_FLAG_VALUES, ...ADW_FLAG_VALUES };
const UNREADABLE = {
    ...GTK_ENUM_UNREADABLE,
    ...ADW_ENUM_UNREADABLE,
    ...GTK_FLAG_UNREADABLE,
    ...ADW_FLAG_UNREADABLE,
};

/**
 * Which enum or flags type a property is, or `null` when it is neither.
 *
 * `PROP_ENUMS` is keyed by the type that DECLARES the property, the way `OWN_PROPS` is, so
 * `GtkBox.orientation` is not in it — `orientation` comes from the `GtkOrientable` interface.
 * `DECLS` is the flattened ancestry and interface list the vocabulary already ships for exactly
 * this kind of question, so the walk is a lookup and not a graph traversal.
 *
 * A type the vocabulary does not describe falls back to itself: the answer is then right when
 * the property is declared on that type and `null` otherwise, which is the same "not ours" the
 * emitter handles.
 *
 * @param {string} typeName  GType name of the object the property sits on
 * @param {string} propertyName  the property, kebab-spelled as GObject knows it
 * @returns {string | null}  GType name of the enum or flags type
 */
function typeOfProperty(typeName, propertyName) {
    for (const declaration of DECLS[typeName] ?? [typeName]) {
        const found = PROP_ENUMS[`${declaration}.${propertyName}`];
        if (found !== undefined) return found;
    }
    return null;
}

/**
 * The text one member of a known enum or flags type becomes, or a thrown error naming it.
 *
 * @param {string} enumType @param {string} member @param {string} where
 * @returns {string}
 */
function memberText(enumType, member, where) {
    const nick = member.replaceAll('_', '-');
    const key = `${enumType}.${nick}`;

    const value = ENUM_VALUES[key];
    if (value !== undefined) return String(value);
    // A flag member keeps its nick; the caller joins a set of them. The value is read anyway so
    // an unknown flag name reaches the error below instead of being passed through.
    if (FLAG_VALUES[key] !== undefined) return nick;

    // Two different failures, and the repair differs. A nick the enum HAS but whose value the
    // GIR could not read is a declared gap upstream — today both namespaces declare none, and
    // the entry says which library produced it. A nick the enum does not have is a typo, and
    // the oracle refuses the same file with the same information.
    if (UNREADABLE[key] !== undefined) {
        throw new Error(
            `blueprint: ${where}: \`${member}\` is a member of ${enumType} whose value ` +
                `@girs could not read (${UNREADABLE[key]}), so its number cannot be emitted`,
        );
    }
    // The nick is printed beside the member because the two differ by the one transform this
    // module applies, and a message that showed only the member read as a contradiction the
    // day that transform was the thing that broke: "`baseline_fill` is not a member of
    // GtkAlign — it has …, `baseline_fill`, …".
    const nicks = membersOf(enumType);
    throw new Error(
        `blueprint: ${where}: \`${member}\` (nick \`${nick}\`) is not a member of ${enumType}` +
            (nicks.length === 0 ? '' : ` — it has ${nicks.map((n) => `\`${n.replaceAll('-', '_')}\``).join(', ')}`),
    );
}

/**
 * Every member of one enum or flags type, in the Blueprint spelling, for the message above.
 *
 * `ENUM_NICKS` is the vocabulary's list and it covers ENUMS ONLY — measured on 4.9.0, all 21
 * flags types the gtk vocabulary numbers are absent from its 104 entries. Deriving the flags
 * half from `FLAG_VALUES`' own keys keeps the two errors symmetric; reading `ENUM_NICKS` alone
 * would have printed a bare "is not a member of GtkInputHints" and left the asymmetry looking
 * like a defect in this file.
 *
 * @param {string} enumType @returns {string[]}
 */
function membersOf(enumType) {
    const listed = ENUM_NICKS[enumType];
    if (listed !== undefined) return [...listed];
    const prefix = `${enumType}.`;
    return Object.keys(FLAG_VALUES)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
}

/**
 * Resolve one identifier written as a property value.
 *
 * The signature the emitter's `EmitOptions.resolveIdent` declares. Returning `null` means the
 * identifier is not an enum or flags member of that property, and the emitter then writes it as
 * the source spelled it — which is what an object id needs.
 *
 * @param {string} typeName  GType name of the object the property sits on
 * @param {string} propertyName
 * @param {string} member  the identifier as the source spelled it; a flag set is `a|b`
 * @param {string} where  `line N`, for an error message that can be acted on
 * @returns {string | null}
 */
export function resolveIdent(typeName, propertyName, member, where) {
    const enumType = typeOfProperty(typeName, propertyName);
    if (enumType === null) return null;
    return member
        .split('|')
        .map((part) => memberText(enumType, part.trim(), where))
        .join('|');
}
