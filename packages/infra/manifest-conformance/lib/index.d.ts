/**
 * Hand-written declarations for `@gjsify/manifest-conformance`.
 *
 * The implementation is plain ESM (`lib/*.mjs`) with NO build step, exactly like
 * `@gjsify/resolve-npm`. That is what lets the same rule modules be imported by
 * a zero-install CI script (a relative path into this directory, no
 * `node_modules`, no compiled output) AND by the TypeScript CLI. A build step
 * here would break the first half; a TypeScript source would break it harder.
 * The cost is this file, kept in sync by hand.
 */

export type RuleScope = 'portable' | 'repo';

export interface RuleResult {
    /** Findings that fail the run. Each names the fix. */
    failures?: string[];
    /** Caveats + deliberate deferrals. Printed on success as well as failure. */
    notes?: string[];
    /** Rule-specific counters. */
    stats?: Record<string, unknown>;
    /** One line printed when the rule passes. */
    summary?: string;
    [extra: string]: unknown;
}

export interface Rule {
    id: string;
    scope: RuleScope;
    /**
     * Manifest fields the rule governs. `gjsify.*` keys carry the prefix; plain
     * npm fields are bare. `field-coverage` reads the `gjsify.` ones to prove
     * no declaration kind exists without a rule.
     */
    fields: string[];
    description: string;
    run(ctx: ConformanceContext): RuleResult | Promise<RuleResult>;
}

export interface PackageRecord {
    name: string;
    dir: string;
    rel: string;
    manifest: Record<string, any>;
    private: boolean;
    gjsify: Record<string, any>;
}

export interface ConformanceContext {
    root: string;
    mode: 'workspace' | 'single';
    /** Packages matched by the root manifest's `workspaces` globs. */
    packages: PackageRecord[];
    /** `packages` plus everything found under the configured `discoveryRoots`. */
    allPackages: PackageRecord[];
    byName: Map<string, PackageRecord>;
    get(name: string): PackageRecord | undefined;
    packagesUnder(dir: string): PackageRecord[];
    only: string[];
    allowUnbuilt: boolean;
    options: Record<string, any>;
}

export interface CreateContextOptions {
    root?: string;
    only?: string[];
    allowUnbuilt?: boolean;
    discoveryRoots?: string[];
    extra?: Record<string, unknown>;
}

export interface RunSummary {
    results: Array<{ rule: Rule; result: RuleResult }>;
    failures: string[];
    notes: string[];
    ok: boolean;
}

export declare function defineRule(rule: Rule): Rule;
export declare function allRules(): Rule[];
export declare function portableRules(): Rule[];
export declare function getRule(id: string): Rule | undefined;
export declare function selectRules(selection?: { only?: string[]; scope?: RuleScope }): Rule[];
export declare function runRules(rules: Rule[], ctx: ConformanceContext): Promise<RunSummary>;
export declare function claimedGjsifyFields(): Set<string>;
export declare function rulesClaimingField(key: string): string[];

export declare function createContext(options?: CreateContextOptions): ConformanceContext;
export declare function readManifest(dir: string): Record<string, any> | null;
export declare function packagesUnder(dir: string, out?: string[]): string[];

export declare function renderReport(
    run: RunSummary,
    options?: { title?: string; out?: (s: string) => void; err?: (s: string) => void },
): boolean;
export declare function formatFindings(findings: string[], options?: { bullet?: string; indent?: string }): string;

export interface LibInfo {
    format: 'macho' | 'elf' | 'pe';
    os: 'linux' | 'darwin' | 'win32';
    arch: string | null;
    inspectable: boolean;
    needed: string[];
    searchPaths: string[];
    /** Mach-O `LC_ID_DYLIB`; null for ELF/PE and for a Mach-O bundle. */
    id: string | null;
    /** Does the image carry a Mach-O `LC_CODE_SIGNATURE`? Always false for ELF/PE. */
    signed: boolean;
}
export declare function readLibrary(file: string): LibInfo | null;
export declare function isBuildHostAbsolutePath(p: string): boolean;
export declare function readTypelibSharedLibraries(file: string): string[] | null;
export declare function checkPrebuildDir(dir: string, options?: { verbose?: boolean }): string[];

/**
 * `null` means NOT MEASURED (not an ELF, or a stripped section table); `[]` means
 * measured and the image records no dependency. Collapsing the two turns an
 * unread file into a claim — see `binary.mjs`.
 */
export declare function readElfNeeded(file: string): string[] | null;
/** Highest required `GLIBC_<x.y[.z]>`, bare version; null when none/unreadable. */
export declare function readElfGlibcRequires(file: string): string | null;
/** Component-wise NUMERIC comparison — `'2.9'` must not sort above `'2.34'`. */
export declare function compareGlibcVersions(a: string, b: string): number;

/** Which C library an ELF's DT_NEEDED list names; null = libc-agnostic. */
export type PrebuildLibc = 'glibc' | 'musl';
export declare function libcFlavourOfNeeded(needed: readonly string[]): PrebuildLibc | null;
/** Split `<os>-<arch>[-musl]`; `libc` is only ever set when `os === 'linux'`. */
export declare function parsePrebuildTarget(token: string): { os: string; arch: string; libc: 'musl' | null };
/** Canonical `<os>-<arch>[-musl]` — libc-AWARE, unlike `canonicalPlatform`. */
export declare function canonicalPrebuildTarget(token: string): string;
/** The ONE target a build on this host may stage into (write side; exact). */
export declare function hostPrebuildTarget(platform: string, arch: string, libc?: PrebuildLibc | null): string;
export declare function measurePrebuildLibc(dir: string): {
    flavour: PrebuildLibc | null;
    glibcRequires: string | null;
    libs: string[];
    mixed: boolean;
    unreadable: string[];
};
export declare function auditPrebuildLibc(nativePkgs: Array<Record<string, any>>): {
    failures: string[];
    notes: string[];
    stats: Record<string, unknown>;
};
export declare function collectLibcPackages(ctx: ConformanceContext): Array<Record<string, any>>;
export declare function renderPrebuildLibcSummary(result: {
    failures: string[];
    notes: string[];
    stats: Record<string, unknown>;
}): string;

export declare const PLATFORM_RE: RegExp;
export declare const ARCH_ALIASES: Record<string, string>;
export declare const KNOWN_ARCH_TOKENS: Set<string>;
export declare const LIB_EXT: Record<string, string>;
export declare const HOST_TARGET: string;
export declare function canonicalPlatform(token: string): string;

export declare const packageOutputsRule: Rule;
export declare const prebuildArtifactsRule: Rule;
export declare const prebuildLibcRule: Rule;
export declare const headlessRule: Rule;
export declare const portableScriptsRule: Rule;
export declare const fieldCoverageRule: Rule;
export declare const repositoryDirectoryRule: Rule;

/** POSIX-only utilities a script invokes in command position. Empty when portable. */
export declare function unportableCommands(script: string): string[];

/** One load-command record, with its file offset. */
export interface MachOCommand {
    cmd: number;
    offset: number;
    size: number;
}

/** The load-command layout of a thin 64-bit Mach-O, with file offsets. */
export interface MachOLayout {
    le: boolean;
    ncmds: number;
    sizeofcmds: number;
    commands: MachOCommand[];
    codeSignature: { offset: number; dataoff: number; datasize: number } | null;
    uuid: MachOCommand | null;
    linkedit: { offset: number } | null;
}

export declare function readMachOLayout(data: Buffer): MachOLayout;

export declare function compareMachOAfterResign(
    before: Buffer,
    after: Buffer,
): { verdict: 'identical' | 'signature-only' | 'differs'; reasons: string[] };
