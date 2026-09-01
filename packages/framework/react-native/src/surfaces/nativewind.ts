// `nativewind` — declared, and answered on another track (ADR 0036 § 5b).
//
// A ROW AND A POINTER, not a folder. Before ADR 0036 an import of this package failed
// at MODULE RESOLUTION: the bundler said npm could not find it, which tells a porter
// nothing about whether a desktop answer exists. Now every name refuses with the
// support table's own sentence — which says what the GTK counterpart is and which
// track owns it — and the build gate says it before anything runs.
//
// Nothing here is hand-written: the exports below are generated from the table, so a
// status that changes changes the module.

export * from '../generated/unsupported-nativewind.js';
