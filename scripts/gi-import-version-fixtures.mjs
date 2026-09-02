// SPDX-License-Identifier: MIT
// Vectors for `check-gi-import-versions.mjs`: a source fragment, the namespaces the
// reader must report as unversioned, and whether to read it as markdown.
//
// SEPARATE FILE, and the scan SKIPS it, because a reader that looks for
// `import … 'gi://Ns'` anywhere in a file cannot also carry unpinned specifiers as data:
// it would report its own vectors and the fix would be to delete them. Nothing but
// vectors lives here, so the exclusion cannot hide a real import — and the self-test
// still proves the reader sees every shape in the list.

/** @type {[source: string, unversioned: string[], markdown?: boolean][]} */
export const GI_IMPORT_VERSION_VECTORS = [
    ["import Gtk from 'gi://Gtk';", ['Gtk']],
    ['import Gtk from "gi://Gtk";', ['Gtk']],
    ["import Gtk from 'gi://Gtk?version=4.0';", []],
    ["import { foo } from 'gi://Gio';", ['Gio']],
    ["    import GLib from 'gi://GLib';", ['GLib']],
    // Prose is not an import. A gate that fires on its own rationale gets the rationale
    // deleted, and the rationale is the half that survives a rewrite.
    // Both quote the specifier after a BACKTICK, which is the template-literal arm's
    // anchor — so each one goes red the moment its half of the comment scanner stops
    // working, instead of passing on the line anchor alone.
    ["// `import Gtk from 'gi://Gtk'` is what this forbids\nconst x = 1;", []],
    ["/* `import Gtk from 'gi://Gtk'` */\nconst x = 1;", []],
    // The ordering case the shared stripper exists for. The trailing `/** … */` is part of
    // the vector: with no later `*/` the lazy block regex finds no match and the bug does
    // not reproduce, so a version of this without it passed under BOTH orderings.
    ["// types live under `@girs/*`\nimport Gtk from 'gi://Gtk';\n/** doc */\nconst x = 1;", ['Gtk']],
    // Not an import at all: a runtime require, and a string that merely contains one.
    ["const Gtk = require('gi://Gtk');", []],
    ["const spec = 'gi://Gtk';", []],

    // A QUERY IS NOT A PIN. Only `version=<something>` answers the question the loader
    // asks; anything else leaves it picking whichever typelib it finds first, and the
    // first reader here reported all three of these as versioned.
    ["import Gtk from 'gi://Gtk?theme=dark';", ['Gtk']],
    ["import Gtk from 'gi://Gtk?version=';", ['Gtk']],
    ["import Gtk from 'gi://Gtk?lang=de&version=4.0';", []],

    // THE SHAPES A LINE-ANCHORED `import … from` READER MISSED, each one measured in this
    // tree at the time these landed. A GJS program written as a template literal and
    // handed to `gjs -m` is an import; so is a side-effect import with no clause, a
    // dynamic one, and one whose clause is wrapped across lines.
    ["const p = `import GLib from 'gi://GLib';`;", ['GLib']],
    ["import 'gi://Gtk';", ['Gtk']],
    ["const importer = () => import('gi://Manette');", ['Manette']],
    ["import {\n    Widget,\n} from 'gi://Gtk';", ['Gtk']],
    // A program written as ONE template literal joined by escaped newlines — the shape
    // `node-gi`'s gold-standard probes and `tests/e2e/gi-runtime-prologue` use. Only the
    // first import of such a line sits after the backtick; the rest sit after a `\n`.
    ["const p = `import GLib from 'gi://GLib';\\nimport Gio from 'gi://Gio';`;", ['GLib', 'Gio']],
    ["const p = `x();\\nimport 'gi://Gtk';`;", ['Gtk']],

    // Markdown is read as prose with code in it: line-anchored only, because an ADR
    // explaining the rule quotes the shape inline and a doc example teaches it.
    ["import Gtk from 'gi://Gtk';", ['Gtk'], true],
    ["so every STATIC `import … from 'gi://Ns'` in a bundle has loaded its typelib", [], true],
    ["A doc may quote `import Gtk from 'gi://Gtk'` mid-sentence.", [], true],
];
