// `gjsify upgrade` — drop-in replacement for `yarn upgrade-interactive`
// and `npx npm-check-updates`. Two modes:
//
//   1. Interactive (default): show outdated packages, prompt user to
//      select which ones to update (space-separated indices or `a` for
//      all), then write the new ranges to `package.json`.
//
//   2. Non-interactive (`--latest` / `--minor` / `--patch` / `--filter`):
//      bump matching packages automatically without prompting.
//
// Workspace-aware: `workspace:^` / `workspace:~` / `workspace:*` ranges
// are skipped — those are the gjsify monorepo internal links and `gjsify
// install` resolves them locally. Only external npm specs get checked
// against the registry.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { parse } from "@gjsify/semver";
import {
    DEFAULT_REGISTRY,
    fetchPackument,
    parseNpmrc,
    type NpmrcConfig,
    type Packument,
} from "@gjsify/npm-registry";
import type { Command } from "../types/index.js";

type ReleaseType = "major" | "minor" | "patch" | "prerelease" | "none";

interface UpgradeOptions {
    latest?: boolean;
    minor?: boolean;
    patch?: boolean;
    filter?: string;
    dryRun?: boolean;
    cwd?: string;
    verbose?: boolean;
    yes?: boolean;
}

interface DepEntry {
    name: string;
    field: "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
    currentRange: string;
    /** Parsed current version (the max-satisfying numeric from the range). */
    currentVersion: string | null;
    /** Range prefix preserved when writing back (`^`, `~`, `>=`, or ``). */
    prefix: string;
}

interface UpgradeCandidate extends DepEntry {
    latestVersion: string;
    diff: ReleaseType;
}

export const upgradeCommand: Command<unknown, UpgradeOptions> = {
    command: "upgrade",
    description:
        "Check the npm registry for newer versions of declared dependencies and update package.json. Interactive by default; `--latest` / `--minor` / `--patch` switch to non-interactive bulk-update mode.",
    builder: (yargs) => {
        return yargs
            .option("latest", {
                description:
                    "Non-interactive: bump every dependency to its latest version (allows major).",
                type: "boolean",
                default: false,
            })
            .option("minor", {
                description:
                    "Non-interactive: bump every dependency to the latest within the same major (semver-minor + semver-patch).",
                type: "boolean",
                default: false,
            })
            .option("patch", {
                description:
                    "Non-interactive: bump every dependency to the latest within the same minor (semver-patch only).",
                type: "boolean",
                default: false,
            })
            .option("filter", {
                description:
                    "Only consider packages whose name matches this substring (case-insensitive). Repeatable; comma-separated values are split.",
                type: "string",
            })
            .option("dry-run", {
                description: "Print the upgrade plan without writing package.json.",
                type: "boolean",
                default: false,
            })
            .option("cwd", {
                description: "Project directory. Default: process.cwd().",
                type: "string",
            })
            .option("yes", {
                alias: "y",
                description: "Interactive mode: select all without prompting.",
                type: "boolean",
                default: false,
            })
            .option("verbose", {
                description: "Print extra resolution details.",
                type: "boolean",
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = resolve((args.cwd as string | undefined) ?? process.cwd());
        const pkgJsonPath = join(cwd, "package.json");
        if (!existsSync(pkgJsonPath)) {
            throw new Error(`[gjsify upgrade] no package.json at ${pkgJsonPath}`);
        }
        const rawPkg = readFileSync(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(rawPkg) as Record<string, unknown>;

        const filters = args.filter
            ? (args.filter as string)
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
            : [];

        const entries = collectExternalDeps(pkg, filters);
        if (entries.length === 0) {
            console.log("[gjsify upgrade] no external npm dependencies to check.");
            return;
        }

        const npmrc = await loadNpmrcLight(cwd);

        const mode: "latest" | "minor" | "patch" | "interactive" = args.latest
            ? "latest"
            : args.minor
              ? "minor"
              : args.patch
                ? "patch"
                : "interactive";

        console.log(`[gjsify upgrade] checking ${entries.length} dependencies against ${npmrc.registry}…`);
        const candidates = await resolveCandidates(entries, npmrc, args.verbose ?? false, mode);

        if (candidates.length === 0) {
            console.log("✅ all dependencies are up to date");
            return;
        }

        printTable(candidates);

        let selected: UpgradeCandidate[];
        if (mode === "interactive" && !args.yes) {
            selected = await promptSelection(candidates);
        } else if (args.yes && mode === "interactive") {
            console.log("[gjsify upgrade] -y / --yes: selecting all");
            selected = candidates;
        } else {
            selected = candidates;
        }

        if (selected.length === 0) {
            console.log("[gjsify upgrade] nothing selected; package.json unchanged.");
            return;
        }

        if (args.dryRun) {
            console.log(`[gjsify upgrade] --dry-run: would update ${selected.length} dependencies (no write).`);
            return;
        }

        writePackageJson(pkgJsonPath, rawPkg, pkg, selected);
        console.log(
            `✏️  updated ${selected.length} dependencies in ${pkgJsonPath}. Run \`gjsify install\` to apply.`,
        );
    },
};

// ─── Resolution ─────────────────────────────────────────────────────────

const DEP_FIELDS = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
] as const;

function collectExternalDeps(
    pkg: Record<string, unknown>,
    filters: string[],
): DepEntry[] {
    const out: DepEntry[] = [];
    for (const field of DEP_FIELDS) {
        const map = pkg[field];
        if (!map || typeof map !== "object") continue;
        for (const [name, raw] of Object.entries(map as Record<string, string>)) {
            if (typeof raw !== "string") continue;
            if (filters.length && !filters.some((f) => name.toLowerCase().includes(f))) {
                continue;
            }
            // Skip workspace-protocol + file: + link: + git: + http(s): specs.
            if (
                raw.startsWith("workspace:") ||
                raw.startsWith("file:") ||
                raw.startsWith("link:") ||
                raw.startsWith("git+") ||
                raw.startsWith("git:") ||
                raw.startsWith("http") ||
                raw.startsWith("npm:") || // e.g. `foo: npm:@scope/foo@^1`
                raw === "*" ||
                raw === "latest"
            ) {
                continue;
            }
            const { prefix, version } = splitRange(raw);
            out.push({
                name,
                field,
                currentRange: raw,
                currentVersion: version,
                prefix,
            });
        }
    }
    return out;
}

/**
 * Split `^1.2.3` → { prefix: "^", version: "1.2.3" }. Honors `~`, `>=`,
 * `>`, `<=`, `<`, `=`. Defaults to "" prefix when the range is just a
 * literal version.
 */
function splitRange(range: string): { prefix: string; version: string | null } {
    const m = range.match(/^(\^|~|>=|<=|>|<|=)?\s*([0-9].*)$/);
    if (!m) return { prefix: "", version: null };
    const prefix = m[1] ?? "";
    const version = m[2]?.split(/\s|[|&,]/)[0] ?? null; // strip range modifiers (`||`, ` - `, etc.)
    const parsed = version ? parse(version) : null;
    return { prefix, version: parsed?.version ?? null };
}

async function resolveCandidates(
    entries: DepEntry[],
    npmrc: NpmrcConfig,
    verbose: boolean,
    mode: "latest" | "minor" | "patch" | "interactive",
): Promise<UpgradeCandidate[]> {
    const results: UpgradeCandidate[] = [];
    // Parallel fetch with a small concurrency cap.
    const cap = 8;
    let cursor = 0;
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= entries.length) return;
            const entry = entries[i]!;
            try {
                const packument = await fetchPackument(entry.name, { npmrc });
                const latest = packument["dist-tags"]?.latest;
                if (!latest) {
                    if (verbose) console.warn(`  ${entry.name}: no dist-tags.latest, skipping`);
                    continue;
                }
                if (!entry.currentVersion) {
                    if (verbose) console.warn(`  ${entry.name}: unable to parse current range "${entry.currentRange}"`);
                    continue;
                }
                const diff = classifyDiff(entry.currentVersion, latest);
                if (diff === "none") continue;
                if (mode === "minor" && diff === "major") continue;
                if (mode === "patch" && (diff === "major" || diff === "minor")) continue;
                results.push({
                    ...entry,
                    latestVersion: latest,
                    diff,
                });
            } catch (err) {
                if (verbose) console.warn(`  ${entry.name}: fetch failed (${(err as Error).message})`);
            }
        }
        void packumentToString;
    }
    await Promise.all(Array.from({ length: cap }, () => worker()));
    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
}

function classifyDiff(current: string, latest: string): ReleaseType {
    const c = parse(current);
    const l = parse(latest);
    if (!c || !l) return "none";
    if (c.major !== l.major) return l.major > c.major ? "major" : "none";
    if (c.minor !== l.minor) return l.minor > c.minor ? "minor" : "none";
    if (c.patch !== l.patch) return l.patch > c.patch ? "patch" : "none";
    if ((c.prerelease ?? []).join(".") !== (l.prerelease ?? []).join(".")) return "prerelease";
    return "none";
}

// ─── Output / Interaction ──────────────────────────────────────────────

const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
};

function colorForDiff(diff: ReleaseType): string {
    switch (diff) {
        case "major":
            return ANSI.red;
        case "minor":
            return ANSI.yellow;
        case "patch":
            return ANSI.green;
        case "prerelease":
            return ANSI.cyan;
        default:
            return "";
    }
}

function printTable(candidates: UpgradeCandidate[]): void {
    const nameW = Math.max(...candidates.map((c) => c.name.length), 4);
    const curW = Math.max(...candidates.map((c) => c.currentRange.length), 7);
    const newW = Math.max(...candidates.map((c) => c.latestVersion.length), 6);
    const idxW = String(candidates.length).length + 2;

    const head =
        " ".repeat(idxW) +
        ANSI.bold +
        "name".padEnd(nameW) +
        "  " +
        "current".padEnd(curW) +
        "  " +
        "latest".padEnd(newW) +
        "  " +
        "kind" +
        ANSI.reset;
    console.log(head);
    console.log(" ".repeat(idxW) + ANSI.dim + "─".repeat(nameW + curW + newW + 12) + ANSI.reset);
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        const idx = `${i + 1}.`.padEnd(idxW);
        const color = colorForDiff(c.diff);
        console.log(
            idx +
                c.name.padEnd(nameW) +
                "  " +
                ANSI.dim +
                c.currentRange.padEnd(curW) +
                ANSI.reset +
                "  " +
                color +
                c.latestVersion.padEnd(newW) +
                ANSI.reset +
                "  " +
                color +
                c.diff +
                ANSI.reset,
        );
    }
}

async function promptSelection(candidates: UpgradeCandidate[]): Promise<UpgradeCandidate[]> {
    if (!process.stdin.isTTY) {
        console.log(
            "[gjsify upgrade] non-TTY stdin: pass --latest / --minor / --patch (or --yes for interactive-all) to upgrade non-interactively.",
        );
        return [];
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        console.log(
            "\nSelect upgrades: comma- or space-separated indices, " +
                ANSI.bold +
                "a" +
                ANSI.reset +
                " for all, ranges like " +
                ANSI.bold +
                "1-3" +
                ANSI.reset +
                ", or " +
                ANSI.bold +
                "ENTER" +
                ANSI.reset +
                " to skip:",
        );
        const answer = (await rl.question("> ")).trim();
        if (!answer) return [];
        if (answer.toLowerCase() === "a" || answer.toLowerCase() === "all") return candidates;
        const picked = new Set<number>();
        for (const token of answer.split(/[\s,]+/).filter(Boolean)) {
            const range = token.match(/^(\d+)-(\d+)$/);
            if (range) {
                const a = Number(range[1]);
                const b = Number(range[2]);
                for (let i = Math.min(a, b); i <= Math.max(a, b); i++) picked.add(i - 1);
            } else if (/^\d+$/.test(token)) {
                picked.add(Number(token) - 1);
            }
        }
        return [...picked]
            .filter((i) => i >= 0 && i < candidates.length)
            .map((i) => candidates[i]!);
    } finally {
        rl.close();
    }
}

// ─── Write-back ────────────────────────────────────────────────────────

function writePackageJson(
    path: string,
    rawText: string,
    parsed: Record<string, unknown>,
    selected: UpgradeCandidate[],
): void {
    // Mutate the parsed object then re-stringify with the original indent.
    for (const c of selected) {
        const map = parsed[c.field] as Record<string, string> | undefined;
        if (!map) continue;
        map[c.name] = c.prefix + c.latestVersion;
    }
    const indent = detectIndent(rawText);
    writeFileSync(path, JSON.stringify(parsed, null, indent) + (rawText.endsWith("\n") ? "\n" : ""), "utf-8");
}

function detectIndent(json: string): number {
    const m = json.match(/^\{\n( +)/);
    if (m) return m[1]!.length;
    return 2;
}

// ─── npmrc loader (lightweight, shared shape with install-backend) ─────

async function loadNpmrcLight(cwd: string): Promise<NpmrcConfig> {
    let parsed: NpmrcConfig = {
        registry: DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    // Layered .npmrc lookup (most-specific wins): home → cwd. Same precedence
    // as install-backend-native, except env-var `npm_config_registry` wins
    // over file values (matches npm's real semantics, lets the test harness
    // point at a mock registry without touching `~/.npmrc`).
    for (const candidate of [join(homedir(), ".npmrc"), join(cwd, ".npmrc")]) {
        if (!existsSync(candidate)) continue;
        try {
            const proj = parseNpmrc(readFileSync(candidate, "utf-8"));
            parsed = {
                ...parsed,
                ...proj,
                scopes: { ...parsed.scopes, ...proj.scopes },
            };
        } catch {
            // ignore malformed .npmrc — same lenient policy as install-backend
        }
    }
    if (process.env.npm_config_registry) {
        parsed.registry = process.env.npm_config_registry;
    }
    return parsed;
}

function packumentToString(p: Packument): string {
    return `${p.name}@${p["dist-tags"]?.latest ?? "?"}`;
}
