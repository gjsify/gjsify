# 0064 — The vocabulary RESOLVES the GIR; it does not cache it

## Status

Proposed

## Context

`@girs/<ns>/vocabulary` carries derived tables — `OWN_PROPS`, `PROP_ENUMS`, `PROP_TYPES`,
`ENUM_VALUES`, `DECLS` and the rest — that consumers read instead of the GIR. The Blueprint
parser in `packages/infra/blueprint` is the largest consumer.

That shape has a cost this repository has now paid twice. A consumer can only answer what
ts-for-gir chose to emit. Blueprint refused two constructs — the middle of an uncast lookup
chain and an uncast closure's return type — for want of one table, and closing that gap took a
change in another repository, a release and a pin bump. The same round trip closed the
namespace-vocabulary gate before it (ts-for-gir #476). Neither was a defect in either repo; both
were the coupling working as designed, and the coupling is what is under discussion.

The obvious alternative is to ship the `.gir` files in the type packages and let each consumer
parse them. It is attractive because the GIR is the source: every fact is in it, including the
ones nobody thought to emit, and a consumer that reads it is independent of the generator's
release cadence.

**Measured, this tree:**

| | GIR | vocabulary | ratio |
|---|---:|---:|---:|
| Gtk-4.0 | 8.0 MB | 176 kB | 45× |
| Gio-2.0 | 5.9 MB | 53 kB | 111× |
| whole corpus | 378 MB | 31.4 MB | 12× |

The size argument is real but NARROW, and stating it without its limit would overstate it:
Blueprint parses at BUILD time, where 16 MB of XML for Gtk+Adw+Gio is affordable. The renderers
read the vocabulary at RUNTIME, where it is not. So size rules out raw GIR for one use and not
for the other.

The argument that decides it is a different one. **The vocabulary is not a cache of the GIR, it
is a RESOLUTION of it.** The facts are in the GIR; the RULES that turn them into what GObject
actually answers to are ts-for-gir's:

- a GType name is not the namespace plus the type. `Gio.ListStore` is `GListStore` and
  `GObject.Object` is `GObject`, because the C identifier prefix of both namespaces is `G`.
  Concatenation writes `GioListStore`, a class `GtkBuilder` resolves to nothing — **with no error
  anywhere**. `rules/49-namespace-core-vocabulary.blp` exists because that shape once had to be
  held as a refusal.
- nick derivation has its own rules, with `scripts/check-nick-derivation.mjs` in ts-for-gir
  holding them.
- a nullable type is one type and an absence, not two types — a distinction a naive walk gets
  wrong silently (measured: 138 of 1100 Gtk-4.0 rows).

A consumer parsing raw GIR re-implements those rules. The failure mode of a second
implementation is not a crash but a wrong answer nobody sees, which is the most expensive class
this repository tracks.

## Decision

1. **The vocabulary stays the fast path** for resolved facts. It is small, it is a contract, and
   it is the only artifact the runtime consumers can afford.
2. **`@ts-for-gir/lib` becomes usable as a library** — the escape hatch for a fact nobody
   emitted. A consumer that needs one resolves it with the SAME code, not a second
   implementation of the same rules. It is already published and not private.
3. **Raw GIRs, if shipped at all, ship as their own package** (`@girs/<ns>-gir`), never bundled
   into the type package. The bytes stay a decision the consumer makes.

## Consequences

- The coupling is not removed, it is given a bypass. A missing table still wants a release to
  become the fast path; it no longer BLOCKS the consumer in the meantime.
- There is exactly one implementation of the resolution rules, and it is the one the generator
  itself uses — so a consumer using the bypass cannot drift from the tables.
- `@ts-for-gir/lib` today pulls `ejs`, `glob`, `lodash` and `colorette`: generator baggage a
  runtime consumer does not want. The lean core is `@gi.ts/parser` with only `fast-xml-parser`.
  Making the resolution usable means EXTRACTING it from the generator, which is the work this
  ADR commits to and not a by-product of it.
- Nothing here changes what is emitted today. Point 3 is permission, not a plan.

## Implementation

- ts-for-gir: extract the resolution from the generator into an entry point a consumer can call
  without the template stack — identifier prefixes, GType naming, nick derivation, the nullable
  rule. Tracked as an issue in that repository.
- gjsify: no change until that entry point exists. When it does, the Blueprint parser's refusals
  that name "a table `@girs` does not ship" become the first callers, and each one that turns
  into an answer is measured against `scripts/blueprint-wild-sweep.mjs` like every other.
