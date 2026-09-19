// Blueprint's own built-in type keywords, and the GType name each one means.
//
// `as <string>` is `gchararray`, `as <bool>` is `gboolean`, `as <int>` is `gint`. Twelve
// keywords, no namespace, no `using` line behind any of them.
//
// WHY THIS TABLE IS HAND-WRITTEN, AND WHY ADR 0053 CLAUSE 6 DOES NOT FORBID IT
//
// Clause 6 forbids a hand-written table THAT COULD BE GENERATED FROM `@girs`, and it is
// right to: `resolve-ident.mjs` exists because an enum-member table written by hand is a
// table whose first wrong row is wrong silently. So this file has to answer the same
// question clause 6 asks, and "this is a different kind of table" is exactly what someone
// says before writing the forbidden one. Three reasons, in the order they decide it:
//
//   1. THE KEYS ARE NOT IN ANY GIR. `string`, `bool`, `int`, `uint`, `long`, `ulong`,
//      `int64`, `uint64`, `float`, `double`, `char`, `uchar` are TOKENS OF BLUEPRINT'S
//      GRAMMAR. A GIR describes one namespace's classes, enums, properties and signals;
//      it has no row keyed by a Blueprint keyword, because Blueprint is not a namespace.
//      `@girs` can be asked "what GType is `Gtk.Label`" and cannot be asked "what does the
//      word `int` mean in this language" — there is nowhere in that data for the question
//      to land.
//   2. THE VALUES ARE NOT A GENERAL GOBJECT FACT EITHER. `double` maps to `gfloat` here.
//      That is measured, not assumed: `blueprint-compiler` 0.20.4 answers
//      `bind $f() as <double>` with `<closure function="f" type="gfloat">`, and
//      `value: bind 1.0 as <double>` with `<constant type="gfloat">1</constant>`. Any
//      table DERIVED from GObject's fundamentals would have said `gdouble`, which is the
//      semantically right answer and the wrong bytes — a derived table would be wrong on
//      exactly the row that proves the mapping belongs to this compiler and not to GObject.
//      ADR 0053 clause 4 measures against the oracle's bytes, so the oracle's answer is the
//      answer, and clause 5 makes a future release that changes it the upgrade notice.
//   3. IT IS CLOSED, SMALL AND MEASURED IN ONE PASS. The list was obtained by asking the
//      oracle for every candidate spelling and keeping the twelve it accepted; the
//      rejected ones are recorded below so the next reader can redo the measurement
//      instead of trusting this sentence. An enum table is thousands of rows across
//      namespaces that release independently — the property clause 6 is protecting
//      against. This one cannot silently gain a row: a spelling not in it is not a
//      built-in, and falls through to the ordinary type resolver, which refuses an unknown
//      name by name.
//
// So it is DATA about the language, checked in beside the parser that reads the language,
// and `corpus/rules/44-expression-cast.blp` holds the oracle's answer for it.
//
// WHAT THE ORACLE REFUSED, so the list is a measurement and not a memory. Asked as
// `Label { label: bind $f() as <T>; }` on 0.20.4, these answered `Closure expression must
// be cast to the closure's return type` — i.e. the name is not a type it knows:
// `gtype`, `object`, `void`, `none`, `short`, `byte`, `number`, `size`, `utf8`,
// `gboolean`, `gint`. The C spellings are NOT accepted; only the Blueprint ones are.
// `type` is a thirteenth case and is deliberately absent: 0.20.4 does not refuse it, it
// CRASHES with a Python traceback, so there is no answer to record.

/**
 * The Blueprint built-in type keywords, in the order the language documents them, mapped to
 * the GType name `blueprint-compiler` 0.20.4 writes for each.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const BUILTIN_GTYPES = new Map([
    ['string', 'gchararray'],
    ['bool', 'gboolean'],
    ['int', 'gint'],
    ['uint', 'guint'],
    ['long', 'glong'],
    ['ulong', 'gulong'],
    ['int64', 'gint64'],
    ['uint64', 'guint64'],
    ['float', 'gfloat'],
    // Measured, not a typo — see reason 2 in the header.
    ['double', 'gfloat'],
    ['char', 'gchar'],
    ['uchar', 'guchar'],
]);

/**
 * Which LITERAL a built-in type can be a cast of.
 *
 * The oracle validates a cast on a literal by kind and refuses a mismatch — measured on
 * 0.20.4: `bind "x" as <int>` is `Cannot convert string to number`, `bind 1 as <bool>` is
 * `Cannot convert number to bool`, `bind true as <int>` is `Cannot assign boolean to int`.
 * The cast never changes the emitted type — `bind 5 as <uint>` is still
 * `<constant type="gint">5</constant>` — so this table decides only whether the file is
 * legal, never what is written.
 *
 * @type {ReadonlyMap<string, 'string' | 'bool' | 'number'>}
 */
export const BUILTIN_LITERAL_CLASS = new Map([
    ['string', 'string'],
    ['bool', 'bool'],
    ['int', 'number'],
    ['uint', 'number'],
    ['long', 'number'],
    ['ulong', 'number'],
    ['int64', 'number'],
    ['uint64', 'number'],
    ['float', 'number'],
    ['double', 'number'],
    ['char', 'number'],
    ['uchar', 'number'],
]);

/**
 * The built-ins that hold a whole number, so a literal the source spelled with a `.` cannot
 * be cast to one: `bind 1.0 as <int>` is `Cannot convert 1.0 to integer` on 0.20.4, and it
 * is the SPELLING and not the value that decides — `1.0` is a whole number and is refused.
 *
 * @type {ReadonlySet<string>}
 */
export const BUILTIN_INTEGERS = new Set(['int', 'uint', 'long', 'ulong', 'int64', 'uint64', 'char', 'uchar']);
