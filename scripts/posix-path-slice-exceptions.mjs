// `<file>` → WHY splitting that value on `'/'` alone is correct there.
//
// A `/`-separated IDENTIFIER is not a filesystem path, and this tree is full of the former:
// D-Bus object paths, URL pathnames, npm package specifiers, git paths. Every one of those is
// `/`-separated by its own specification on every operating system, so slicing it at a `/` is
// right and needs no helper. A FILESYSTEM path is the opposite — its separator depends on the
// host — and the two are indistinguishable to a grep.
//
// Hence a ledger of stated reasons rather than a ban. Same shape as `E2E_UNLISTED_SUITES` and
// the since-retired `PREBUILD_GIR_GAPS`, with the same self-retiring half: an entry whose file
// no longer slices anything FAILS, so the ledger cannot outlive its cause. `PREBUILD_GIR_GAPS`
// is the worked example of where that ends — it drained to zero and the module was deleted.
//
// The reason must say WHAT KIND OF VALUE is being split and why that kind is always
// `/`-separated. "It works on Linux" is not a reason — that is the defect this check exists
// to find (#1143).

/** @type {Record<string, string>} */
export const POSIX_PATH_SLICE_EXCEPTIONS = {
    'packages/framework/devtools/src/widget-tree.ts':
        'A D-Bus OBJECT PATH, whose grammar (D-Bus spec §Object paths) is `/`-separated on ' +
        'every platform — it never touches a filesystem.',
    'packages/nativescript-bridge/devtools/src/view-tree.ts':
        'The same D-Bus object-path grammar as the GTK devtools tree, over an NS view hierarchy.',
    'packages/infra/cli/src/utils/trust-registry.ts':
        'A trust-registry KEY, which is the npm package specifier grammar (`@scope/name`) — ' +
        '`/` is the scope separator and is not a directory separator.',
    'packages/infra/rolldown-plugin-gjsify/src/utils/scan-globals.ts':
        'Module SPECIFIERS as written in import statements. ESM specifiers are `/`-separated by ' +
        'the resolution spec regardless of host, which is why a Windows import still reads ' +
        '`@gjsify/fs`, never `@gjsify\\fs`.',
    'packages/infra/npm-registry/src/auth.ts':
        'A `URL.pathname`, already normalised to `/` by the URL parser before this code sees it.',
    'packages/node/fs/src/browser/opfs.ts':
        'An OPFS virtual path. The Origin Private File System has no host separator to inherit ' +
        '— its directory delimiter is `/` by the File System Access spec.',
    'packages/infra/cli/src/utils/ship/stage-manifest.ts':
        'A PAYLOAD path out of `.gjsify-ship-stage.json` — the same `/`-separated archive ' +
        'path that ends up inside the `.deb`/`.rpm`. `PayloadEntry.path` is POSIX-separated ' +
        'by its own type contract and `planStage` builds every one with `posix.join`, ' +
        'deliberately: the two-phase split exists so a stage assembled on one host is packed ' +
        'on another, which a host-separated manifest could not survive. The `.join(sep)` here ' +
        'is the one-way conversion FROM that portable identifier TO a host path, so the split ' +
        'side must be `/` — using a both-separator helper would corrupt a legitimate Linux ' +
        'filename containing a backslash.',
    'packages/infra/cli/src/utils/ship/rpm.ts':
        'An ARCHIVE path. RPM describes the TARGET filesystem, not the build host: `DIRNAMES` ' +
        'entries are `/`-terminated and `BASENAMES` carries the last component, both defined ' +
        '`/`-separated by the RPM format, and the cpio payload names are the same strings with a ' +
        '`./` prefix. A `.rpm` built on Windows still installs `/usr/bin/foo` on Linux.',
    'packages/infra/cli/src/utils/ship/stage-writer.ts':
        'A prefix-relative PAYLOAD path, which the planner builds with `posix.join` precisely so ' +
        "one payload description serves every format. The `split('/')` is the identifier side " +
        'of the conversion and `join(sep)` is what turns it into a host path — this is the one ' +
        'place that crossing happens, which is why it reads as a split.',
    'packages/infra/cli/src/utils/ship/signing.ts':
        'The same prefix-relative PAYLOAD path as `stage-writer.ts` one file over, and the same ' +
        'crossing: the signer materialises `PayloadEntry.path` — POSIX-separated by its own type ' +
        'contract, built with `posix.join` — into a host path so `codesign`/`signtool` has a file ' +
        'to open, then reads the same paths back. A both-separator helper would corrupt a ' +
        'legitimate Linux filename containing a backslash, and the signed payload has to come ' +
        'back keyed on exactly the identifiers it went in under or the packer would not find it.',
    'packages/infra/workspace/src/changed-files.ts':
        'A git path from `git diff --name-only`, which git emits `/`-separated on every platform ' +
        '(core.quotePath notwithstanding) — including on Windows, where the working tree uses `\\`.',
};
