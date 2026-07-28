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
}
export declare function readLibrary(file: string): LibInfo | null;
export declare function readTypelibSharedLibraries(file: string): string[] | null;
export declare function checkPrebuildDir(dir: string, options?: { verbose?: boolean }): string[];

export declare const PLATFORM_RE: RegExp;
export declare const ARCH_ALIASES: Record<string, string>;
export declare const KNOWN_ARCH_TOKENS: Set<string>;
export declare const LIB_EXT: Record<string, string>;
export declare const HOST_TARGET: string;
export declare function canonicalPlatform(token: string): string;

export declare const packageOutputsRule: Rule;
export declare const prebuildArtifactsRule: Rule;
export declare const headlessRule: Rule;
export declare const fieldCoverageRule: Rule;
