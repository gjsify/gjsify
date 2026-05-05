// SemVer - subset of node-semver for the gjsify install backend.
// Implements parse, compare, satisfies, maxSatisfying, minSatisfying, and Range
// for caret/tilde/hyphen/x/star/comparator/OR ranges.
// Reference: https://semver.org/spec/v2.0.0.html and refs/npm-cli/.../semver/.

const NUM_RE = /^(0|[1-9]\d*)$/;
const SEMVER_RE =
    /^(\d+)\.(\d+)\.(\d+)(?:-((?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export type ReleaseType = "major" | "minor" | "patch";

export function parse(version: string): SemVer | null {
    try {
        return new SemVer(version);
    } catch {
        return null;
    }
}

export function valid(version: string): string | null {
    const v = parse(version);
    return v ? v.version : null;
}

export function compare(a: string | SemVer, b: string | SemVer): -1 | 0 | 1 {
    const av = a instanceof SemVer ? a : new SemVer(a);
    const bv = b instanceof SemVer ? b : new SemVer(b);
    return av.compare(bv);
}

export function satisfies(version: string | SemVer, range: string | Range): boolean {
    const r = range instanceof Range ? range : new Range(range);
    const v = version instanceof SemVer ? version : parse(String(version));
    if (!v) return false;
    return r.test(v);
}

export function maxSatisfying(versions: ReadonlyArray<string>, range: string | Range): string | null {
    const r = range instanceof Range ? range : new Range(range);
    let best: SemVer | null = null;
    for (const raw of versions) {
        const v = parse(raw);
        if (!v || !r.test(v)) continue;
        if (best === null || v.compare(best) > 0) best = v;
    }
    return best ? best.version : null;
}

export function minSatisfying(versions: ReadonlyArray<string>, range: string | Range): string | null {
    const r = range instanceof Range ? range : new Range(range);
    let best: SemVer | null = null;
    for (const raw of versions) {
        const v = parse(raw);
        if (!v || !r.test(v)) continue;
        if (best === null || v.compare(best) < 0) best = v;
    }
    return best ? best.version : null;
}

export function validRange(range: string): string | null {
    try {
        return new Range(range).format();
    } catch {
        return null;
    }
}

export class SemVer {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: ReadonlyArray<string | number>;
    readonly build: ReadonlyArray<string>;
    readonly version: string;

    constructor(version: string) {
        const trimmed = String(version).trim().replace(/^v/, "");
        const m = SEMVER_RE.exec(trimmed);
        if (!m) throw new TypeError(`Invalid Version: ${version}`);
        this.major = Number(m[1]);
        this.minor = Number(m[2]);
        this.patch = Number(m[3]);
        this.prerelease = m[4]
            ? m[4].split(".").map((id) => (NUM_RE.test(id) ? Number(id) : id))
            : [];
        this.build = m[5] ? m[5].split(".") : [];
        this.version =
            `${this.major}.${this.minor}.${this.patch}` +
            (this.prerelease.length ? `-${this.prerelease.join(".")}` : "") +
            (this.build.length ? `+${this.build.join(".")}` : "");
    }

    compare(other: SemVer): -1 | 0 | 1 {
        if (this.major !== other.major) return this.major < other.major ? -1 : 1;
        if (this.minor !== other.minor) return this.minor < other.minor ? -1 : 1;
        if (this.patch !== other.patch) return this.patch < other.patch ? -1 : 1;
        return this.comparePre(other);
    }

    comparePre(other: SemVer): -1 | 0 | 1 {
        const a = this.prerelease;
        const b = other.prerelease;
        if (a.length === 0 && b.length === 0) return 0;
        if (a.length === 0) return 1;
        if (b.length === 0) return -1;
        for (let i = 0; ; i++) {
            const x = a[i];
            const y = b[i];
            if (x === undefined && y === undefined) return 0;
            if (y === undefined) return 1;
            if (x === undefined) return -1;
            if (x === y) continue;
            const xn = typeof x === "number";
            const yn = typeof y === "number";
            if (xn && !yn) return -1;
            if (!xn && yn) return 1;
            return x < y ? -1 : 1;
        }
    }

    toString(): string {
        return this.version;
    }
}

interface Comparator {
    operator: "" | "<" | ">" | "<=" | ">=" | "=";
    semver: SemVer | null;
}

export class Range {
    readonly raw: string;
    readonly set: ReadonlyArray<ReadonlyArray<Comparator>>;

    constructor(range: string | Range) {
        if (range instanceof Range) {
            this.raw = range.raw;
            this.set = range.set;
            return;
        }
        this.raw = String(range).trim();
        const sets = this.raw.split(/\s*\|\|\s*/);
        const parsed: Comparator[][] = [];
        for (const part of sets) {
            const c = parseRangePart(part);
            if (c.length === 0) {
                throw new TypeError(`Invalid range: ${this.raw}`);
            }
            parsed.push(c);
        }
        if (parsed.length === 0) {
            throw new TypeError(`Invalid range: ${this.raw}`);
        }
        this.set = parsed;
    }

    test(version: SemVer | string): boolean {
        const v = version instanceof SemVer ? version : parse(String(version));
        if (!v) return false;
        for (const conj of this.set) {
            if (conj.every((c) => testComparator(c, v))) {
                if (v.prerelease.length > 0) {
                    const allowed = conj.some(
                        (c) =>
                            c.semver !== null &&
                            c.semver.prerelease.length > 0 &&
                            c.semver.major === v.major &&
                            c.semver.minor === v.minor &&
                            c.semver.patch === v.patch,
                    );
                    if (!allowed) continue;
                }
                return true;
            }
        }
        return false;
    }

    format(): string {
        return this.set.map((c) => c.map(formatComparator).join(" ")).join(" || ");
    }

    toString(): string {
        return this.format();
    }
}

function testComparator(c: Comparator, v: SemVer): boolean {
    if (c.semver === null) return true;
    const cmp = v.compare(c.semver);
    switch (c.operator) {
        case "":
        case "=":
            return cmp === 0;
        case "<":
            return cmp < 0;
        case "<=":
            return cmp <= 0;
        case ">":
            return cmp > 0;
        case ">=":
            return cmp >= 0;
    }
}

function formatComparator(c: Comparator): string {
    if (c.semver === null) return "*";
    return `${c.operator}${c.semver.version}`;
}

function parseRangePart(part: string): Comparator[] {
    const trimmed = part.trim();
    if (trimmed === "" || trimmed === "*" || trimmed.toLowerCase() === "latest") {
        return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    }
    const hyphen = trimmed.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/);
    if (hyphen) return hyphenRange(hyphen[1], hyphen[2]);
    const tokens = trimmed.split(/\s+/);
    const out: Comparator[] = [];
    for (const tok of tokens) out.push(...parseSimple(tok));
    return out;
}

function parseSimple(tok: string): Comparator[] {
    if (tok === "*" || tok === "" || tok.toLowerCase() === "latest") {
        return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    }
    if (tok.startsWith("^")) return caretRange(tok.slice(1));
    if (tok.startsWith("~")) return tildeRange(tok.slice(1).replace(/^>/, ""));
    const opMatch = tok.match(/^(<=|>=|<|>|=)\s*(.+)$/);
    if (opMatch) {
        const op = opMatch[1] as Comparator["operator"];
        return primitiveRange(op, opMatch[2]);
    }
    return partialRange(tok);
}

interface PartialVersion {
    major: number | null;
    minor: number | null;
    patch: number | null;
    pre: string;
    build: string;
}

function parsePartial(s: string): PartialVersion {
    const trimmed = s.trim().replace(/^v/, "");
    if (trimmed === "" || trimmed === "*") {
        return { major: null, minor: null, patch: null, pre: "", build: "" };
    }
    let pre = "";
    let build = "";
    let core = trimmed;
    const plus = core.indexOf("+");
    if (plus >= 0) {
        build = core.slice(plus + 1);
        core = core.slice(0, plus);
    }
    const dash = core.indexOf("-");
    if (dash >= 0) {
        pre = core.slice(dash + 1);
        core = core.slice(0, dash);
    }
    const parts = core.split(".");
    const xr = (part: string | undefined): number | null => {
        if (part === undefined || part === "") return null;
        if (part === "x" || part === "X" || part === "*") return null;
        if (!/^\d+$/.test(part)) {
            throw new TypeError(`Invalid partial version: ${s}`);
        }
        return Number(part);
    };
    return {
        major: xr(parts[0]),
        minor: xr(parts[1]),
        patch: xr(parts[2]),
        pre,
        build,
    };
}

function partialToVersion(p: PartialVersion): string {
    return `${p.major ?? 0}.${p.minor ?? 0}.${p.patch ?? 0}${p.pre ? `-${p.pre}` : ""}${
        p.build ? `+${p.build}` : ""
    }`;
}

function partialRange(tok: string): Comparator[] {
    const p = parsePartial(tok);
    if (p.major === null) return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    if (p.minor === null) {
        return [
            { operator: ">=", semver: new SemVer(`${p.major}.0.0`) },
            { operator: "<", semver: new SemVer(`${p.major + 1}.0.0`) },
        ];
    }
    if (p.patch === null) {
        return [
            { operator: ">=", semver: new SemVer(`${p.major}.${p.minor}.0`) },
            { operator: "<", semver: new SemVer(`${p.major}.${p.minor + 1}.0`) },
        ];
    }
    return [{ operator: "=", semver: new SemVer(partialToVersion(p)) }];
}

function caretRange(tok: string): Comparator[] {
    const p = parsePartial(tok);
    if (p.major === null) return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    const lower = `${p.major}.${p.minor ?? 0}.${p.patch ?? 0}${p.pre ? `-${p.pre}` : ""}`;
    let upper: string;
    if (p.major > 0 || p.minor === null) {
        upper = `${p.major + 1}.0.0`;
    } else if (p.minor > 0 || p.patch === null) {
        upper = `0.${p.minor + 1}.0`;
    } else {
        upper = `0.0.${p.patch + 1}`;
    }
    return [
        { operator: ">=", semver: new SemVer(lower) },
        { operator: "<", semver: new SemVer(upper) },
    ];
}

function tildeRange(tok: string): Comparator[] {
    const p = parsePartial(tok);
    if (p.major === null) return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    const lower = `${p.major}.${p.minor ?? 0}.${p.patch ?? 0}${p.pre ? `-${p.pre}` : ""}`;
    const upper =
        p.minor === null
            ? `${p.major + 1}.0.0`
            : `${p.major}.${p.minor + 1}.0`;
    return [
        { operator: ">=", semver: new SemVer(lower) },
        { operator: "<", semver: new SemVer(upper) },
    ];
}

function primitiveRange(op: Comparator["operator"], rhs: string): Comparator[] {
    const p = parsePartial(rhs);
    if (p.major === null) return [{ operator: ">=", semver: new SemVer("0.0.0") }];
    if (op === "=" || op === "") return partialRange(rhs);
    if (op === ">") {
        if (p.minor === null) return [{ operator: ">=", semver: new SemVer(`${p.major + 1}.0.0`) }];
        if (p.patch === null) return [{ operator: ">=", semver: new SemVer(`${p.major}.${p.minor + 1}.0`) }];
        return [{ operator: ">", semver: new SemVer(partialToVersion(p)) }];
    }
    if (op === "<") {
        if (p.minor === null) return [{ operator: "<", semver: new SemVer(`${p.major}.0.0`) }];
        if (p.patch === null) return [{ operator: "<", semver: new SemVer(`${p.major}.${p.minor}.0`) }];
        return [{ operator: "<", semver: new SemVer(partialToVersion(p)) }];
    }
    if (op === ">=") return [{ operator: ">=", semver: new SemVer(partialToVersion(p)) }];
    if (p.minor === null) return [{ operator: "<", semver: new SemVer(`${p.major + 1}.0.0`) }];
    if (p.patch === null) return [{ operator: "<", semver: new SemVer(`${p.major}.${p.minor + 1}.0`) }];
    return [{ operator: "<=", semver: new SemVer(partialToVersion(p)) }];
}

function hyphenRange(left: string, right: string): Comparator[] {
    const a = parsePartial(left);
    const b = parsePartial(right);
    const lower: Comparator =
        a.major === null
            ? { operator: ">=", semver: new SemVer("0.0.0") }
            : {
                operator: ">=",
                semver: new SemVer(
                    `${a.major}.${a.minor ?? 0}.${a.patch ?? 0}${a.pre ? `-${a.pre}` : ""}`,
                ),
            };
    let upper: Comparator;
    if (b.major === null) {
        upper = { operator: ">=", semver: new SemVer("0.0.0") };
    } else if (b.minor === null) {
        upper = { operator: "<", semver: new SemVer(`${b.major + 1}.0.0`) };
    } else if (b.patch === null) {
        upper = { operator: "<", semver: new SemVer(`${b.major}.${b.minor + 1}.0`) };
    } else {
        upper = {
            operator: "<=",
            semver: new SemVer(
                `${b.major}.${b.minor}.${b.patch}${b.pre ? `-${b.pre}` : ""}`,
            ),
        };
    }
    return [lower, upper];
}
