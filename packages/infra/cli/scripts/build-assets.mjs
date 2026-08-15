// Copy the CLI's runtime templates into `lib/` and mark the entry executable.
//
// WHY A SCRIPT AND NOT A SHELL CHAIN
//
// This step used to be five POSIX commands in the `build` script:
//
//   mkdir -p lib/templates/flatpak && cp -L src/templates/install.mjs.tmpl … &&
//   cp src/templates/flatpak/*.tmpl … && … && gjsify run chmod
//
// npm runs package scripts through `cmd.exe` on Windows, where `mkdir -p`
// creates a directory literally named `-p`, `cp` does not exist at all, and the
// `*.tmpl` glob is never expanded. So `@gjsify/cli`'s own build — the first
// link in `build:infra` — could not complete on Windows, which is the whole
// toolchain: nothing downstream builds without the CLI.
//
// The `gjsify run chmod` tail had a second problem independent of the OS: it
// made the CLI's build depend on an ALREADY-BUILT CLI. On a cold tree there is
// no `gjsify` to run yet (`lib/index.js` is what this very script is finishing),
// so the last step of the bootstrap needed the bootstrap's own output. Doing it
// in-process removes that circularity on every platform.
//
// `cp -L` dereferenced a symlinked template; `copyFileSync` follows symlinks by
// default, so the behaviour carries over unchanged.

import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcTemplates = join(pkgRoot, 'src', 'templates');
const libTemplates = join(pkgRoot, 'lib', 'templates');

mkdirSync(libTemplates, { recursive: true });

for (const name of ['install.mjs.tmpl', 'oxlintrc.json.tmpl', 'oxfmtrc.tmpl']) {
    copyFileSync(join(srcTemplates, name), join(libTemplates, name));
}

// The former `cp src/templates/flatpak/*.tmpl` — expanded here, because cmd.exe
// does not expand globs and would have passed the pattern through verbatim.
// The subdirectory SET is read rather than listed: `templates/app/` exists
// because the desktop entry stopped being Flatpak's, and a hardcoded directory
// list is how the next such move ships a CLI whose template is missing from
// `lib/` — an ENOENT at the user's first run, invisible to every build check.
for (const dir of readdirSync(srcTemplates, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    mkdirSync(join(libTemplates, dir.name), { recursive: true });
    for (const name of readdirSync(join(srcTemplates, dir.name))) {
        if (!name.endsWith('.tmpl')) continue;
        copyFileSync(join(srcTemplates, dir.name, name), join(libTemplates, dir.name, name));
    }
}

// The npm `bin` entry carries a shebang and is executed directly on POSIX.
// Windows ignores the mode bits (`fs.chmod` there only toggles read-only), so
// this is harmless rather than conditional.
chmodSync(join(pkgRoot, 'lib', 'index.js'), 0o755);
