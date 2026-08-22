/**
 * Read this repository's git INDEX with no `git` binary on PATH.
 *
 * WHY THIS EXISTS — the Windows leg has a checkout and no git
 *
 * `workflow-rev-pin` needs exactly one number: the commit a `refs/` gitlink is STAGED
 * at. `git ls-files -s -- <path>` prints it in one line, and that is what the rule did
 * until `windows-suites.yml` ran it. That job DELETES every `\Git\` entry from PATH
 * before anything else runs, on purpose: npm dispatches package scripts through
 * `%COMSPEC%`, where Git for Windows' `chmod`/`cp`/`rm`/`sed` do not exist, so a leg
 * that kept them on PATH would turn cmd.exe-only failures green — the measurement that
 * whole workflow exists to make. Stripping those entries takes `git.exe` with them.
 *
 * The job still holds a COMPLETE git checkout. What it lacks is the BINARY, and
 * `audit-runtimes.mjs --check` is its last step, so the rule died with
 * `spawnSync git ENOENT` and reported nothing (run 32464553626).
 *
 * WHY NOT "SKIP WHEN GIT IS MISSING"
 *
 * Because that is this repository's most expensive defect shape, not a fix. A rule that
 * returns "not applicable" wherever the binary is absent goes green on that leg forever
 * while comparing nothing, and nobody would ever see the difference between that and a
 * held pin. Reading the index directly keeps the rule running on EVERY leg — Linux,
 * macOS and the stripped-PATH Windows one — and drops a subprocess on the others.
 *
 * It is also what the repo asks for anyway: shelling out where a file read answers the
 * question is a documented anti-pattern here.
 *
 * WHY NOT HEAD
 *
 * The index, not `HEAD`, is the pin a change MEANS: a `git add`ed submodule bump is
 * already the new pin, while forgetting to stage it still fails. `refs-pin` reads the
 * same side for the same reason. Reading `HEAD`'s tree without git would also mean
 * unpacking loose objects AND packfiles; the index is a single documented file.
 *
 * WHY `refs-pin` STILL SHELLS OUT
 *
 * It asks questions the index cannot answer — `rev-parse HEAD` inside the submodule
 * working copy, `describe --tags` for the human-readable form. It needs initialised
 * submodules regardless, which is why `audit-runtimes --check` registers it without
 * selecting it, so no PR leg runs it and no PR leg can hit the missing binary. This
 * module is the ONE git-index parser: a second reader of the same file is how the two
 * would start disagreeing about what is pinned.
 *
 * FORMAT REFERENCE: `Documentation/gitformat-index.txt` upstream.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Mode bits git writes for a gitlink (submodule) entry: `0160000`. */
const GITLINK_MODE = 0o160000;

/**
 * Where this checkout keeps its git metadata.
 *
 * `.git` is a DIRECTORY in a normal clone and a FILE holding `gitdir: <path>` in a
 * linked worktree or a submodule checkout. Both are live here: the CI runners use the
 * first, `git worktree add` (how this branch is developed) the second — and a reader
 * that only handled the directory would be correct in CI and wrong on the machine
 * writing the fix.
 *
 * @param {string} repoRoot
 * @returns {string} absolute path to the git directory
 */
export function resolveGitDir(repoRoot) {
    const dotGit = join(repoRoot, '.git');
    if (!existsSync(dotGit)) {
        throw new Error(`${dotGit} does not exist — this is not a git checkout, so nothing here has a staged pin.`);
    }
    if (statSync(dotGit).isDirectory()) return dotGit;
    const pointer = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (!pointer) {
        throw new Error(`${dotGit} is a file but does not name a \`gitdir:\` — cannot locate this checkout's index.`);
    }
    return isAbsolute(pointer) ? pointer : resolve(repoRoot, pointer);
}

/**
 * The directory a linked worktree shares with its main checkout — where `config` lives.
 * A normal clone shares with itself.
 *
 * @param {string} gitDir
 * @returns {string}
 */
function commonDir(gitDir) {
    const file = join(gitDir, 'commondir');
    if (!existsSync(file)) return gitDir;
    const rel = readFileSync(file, 'utf8').trim();
    return isAbsolute(rel) ? rel : resolve(gitDir, rel);
}

/**
 * Bytes per object name. The index header does NOT record this — git takes it from
 * `extensions.objectFormat` in the repository config, so a reader must too. gjsify is
 * SHA-1 and a wrong guess would not fail loudly: every offset after the first entry
 * would slide, the paths would come out as garbage and the gitlink would simply not be
 * found, which reads as "the submodule is gone" rather than as a parser bug.
 *
 * @param {string} gitDir
 * @returns {20 | 32}
 */
function objectNameLength(gitDir) {
    const config = join(commonDir(gitDir), 'config');
    if (!existsSync(config)) return 20;
    return /^\s*objectformat\s*=\s*sha256\s*$/im.test(readFileSync(config, 'utf8')) ? 32 : 20;
}

/**
 * git's offset-encoding varint, used by index version 4 to say how many bytes to strip
 * off the END of the previous entry's path before appending this entry's suffix.
 *
 * @param {Buffer} buf
 * @param {number} off
 * @returns {[value: number, next: number]}
 */
function readOffsetVarint(buf, off) {
    let byte = buf[off++];
    let value = byte & 0x7f;
    while ((byte & 0x80) !== 0) {
        value += 1;
        byte = buf[off++];
        value = (value << 7) + (byte & 0x7f);
    }
    return [value, off];
}

/**
 * Walk every entry the index stages, calling `visit(path, mode, sha)` for each.
 *
 * The ONE parser this file promises to be. Callers pick what they keep — gitlinks
 * alone, or every path — so that wanting a different subset never becomes a reason to
 * write a second reader of the same format. Paths are the index's own spelling: always
 * forward slashes, on every platform.
 *
 * @param {string} repoRoot
 * @param {(path: string, mode: number, sha: string) => void} visit
 */
function walkIndex(repoRoot, visit) {
    const gitDir = resolveGitDir(repoRoot);
    const indexFile = join(gitDir, 'index');
    if (!existsSync(indexFile)) {
        throw new Error(`${indexFile} does not exist — this checkout has no index, so nothing is staged.`);
    }
    const buf = readFileSync(indexFile);
    if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'DIRC') {
        throw new Error(`${indexFile} does not start with the \`DIRC\` signature — this is not a git index.`);
    }
    const version = buf.readUInt32BE(4);
    if (version < 2 || version > 4) {
        throw new Error(
            `${indexFile} is index version ${version}; this reader implements 2, 3 and 4. Upstream added a version ` +
                'rather than this being corruption — teach `scripts/manifest-conformance/git-index.mjs` the new ' +
                'layout, and do NOT downgrade the rule to a skip.',
        );
    }
    const count = buf.readUInt32BE(8);
    const hashLen = objectNameLength(gitDir);

    let off = 12;
    // Version 4 stores each path as a delta against the one before it, so the full
    // previous path has to be carried even for entries the caller does not want.
    let previousPath = '';
    for (let i = 0; i < count; i++) {
        const start = off;
        // ctime/mtime/dev/ino occupy the first 24 bytes; `mode` is the 7th 32-bit word.
        const mode = buf.readUInt32BE(off + 24);
        const sha = buf.toString('hex', off + 40, off + 40 + hashLen);
        const flags = buf.readUInt16BE(off + 40 + hashLen);
        off += 40 + hashLen + 2;
        // Version 3 introduced a second flags word, present only when the extended bit
        // is set. Version 2 never has it; version 4 kept the same encoding as 3.
        if (version >= 3 && (flags & 0x4000) !== 0) off += 2;

        let path;
        if (version < 4) {
            const nul = buf.indexOf(0, off);
            path = buf.toString('utf8', off, nul);
            // Entries are padded with 1-8 NUL bytes to a multiple of eight, measured
            // from the START of the entry — so the padding cannot be derived from the
            // name length alone once extended flags are in play.
            off = start + ((nul - start + 8) & ~7);
        } else {
            const [strip, suffixAt] = readOffsetVarint(buf, off);
            const nul = buf.indexOf(0, suffixAt);
            path = previousPath.slice(0, previousPath.length - strip) + buf.toString('utf8', suffixAt, nul);
            // No padding in version 4 — that is the point of the prefix compression.
            off = nul + 1;
        }
        previousPath = path;
        visit(path, mode, sha);
    }

    assertNotSplit(buf, off, hashLen, indexFile);
}

/**
 * Every SUBMODULE the index stages, as `<repo-relative path>` → `<40-hex commit>`.
 *
 * @param {string} repoRoot
 * @returns {Map<string, string>}
 */
export function readIndexGitlinks(repoRoot) {
    /** @type {Map<string, string>} */
    const gitlinks = new Map();
    walkIndex(repoRoot, (path, mode, sha) => {
        if (mode === GITLINK_MODE) gitlinks.set(path, sha);
    });
    return gitlinks;
}

/**
 * Every path the index stages — what a COLD checkout of this commit would contain.
 *
 * Unlike `readIndexGitlinks` this deliberately keeps all ~5000 entries, because the
 * question it answers is a membership test over the whole tree: whether a given file
 * is committed, and therefore present before anything is built.
 *
 * @param {string} repoRoot
 * @returns {Set<string>}
 */
export function readIndexPaths(repoRoot) {
    /** @type {Set<string>} */
    const paths = new Set();
    walkIndex(repoRoot, (path) => {
        paths.add(path);
    });
    return paths;
}

/**
 * `core.splitIndex` moves most entries into `.git/sharedindex.<oid>` and leaves this
 * file holding a `link` extension plus a delta. Nothing above follows that link, so a
 * split index would report a gitlink as ABSENT — a loud failure, but one that blames
 * the submodule for a reader limitation. Name the real cause instead.
 *
 * @param {Buffer} buf
 * @param {number} off first byte after the entries
 * @param {number} hashLen size of the trailing checksum
 * @param {string} indexFile
 */
function assertNotSplit(buf, off, hashLen, indexFile) {
    const end = buf.length - hashLen;
    while (off + 8 <= end) {
        const signature = buf.toString('latin1', off, off + 4);
        if (signature === 'link') {
            throw new Error(
                `${indexFile} is a SPLIT index (core.splitIndex), whose entries live in a shared index this reader ` +
                    'does not follow. Run `git update-index --no-split-index` in this checkout, or teach ' +
                    '`scripts/manifest-conformance/git-index.mjs` to read `.git/sharedindex.*`.',
            );
        }
        off += 8 + buf.readUInt32BE(off + 4);
    }
}
