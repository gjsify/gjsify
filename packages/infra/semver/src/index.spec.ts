import { describe, it, expect } from "@gjsify/unit";
import {
    SemVer,
    Range,
    parse,
    valid,
    compare,
    satisfies,
    maxSatisfying,
    minSatisfying,
    validRange,
} from "./index.js";

export default async () => {
    await describe("@gjsify/semver — SemVer", async () => {
        await it("parses major.minor.patch", async () => {
            const v = new SemVer("1.2.3");
            expect(v.major).toBe(1);
            expect(v.minor).toBe(2);
            expect(v.patch).toBe(3);
            expect(v.version).toBe("1.2.3");
        });

        await it("parses prerelease + build", async () => {
            const v = new SemVer("1.2.3-alpha.1+build.7");
            expect(v.prerelease.length).toBe(2);
            expect(v.prerelease[0]).toBe("alpha");
            expect(v.prerelease[1]).toBe(1);
            expect(v.build[0]).toBe("build");
            expect(v.version).toBe("1.2.3-alpha.1+build.7");
        });

        await it("strips leading v", async () => {
            expect(new SemVer("v1.2.3").version).toBe("1.2.3");
        });

        await it("rejects garbage", async () => {
            expect(parse("not-a-version")).toBeNull();
            expect(parse("1.2")).toBeNull();
            expect(valid("1.2.3.4")).toBeNull();
        });

        await it("compares major/minor/patch", async () => {
            expect(compare("1.0.0", "2.0.0")).toBe(-1);
            expect(compare("1.2.3", "1.2.3")).toBe(0);
            expect(compare("1.2.10", "1.2.9")).toBe(1);
        });

        await it("non-prerelease > any prerelease", async () => {
            expect(compare("1.0.0", "1.0.0-alpha")).toBe(1);
            expect(compare("1.0.0-alpha", "1.0.0")).toBe(-1);
        });

        await it("compares prerelease tags by parts (numeric < alpha)", async () => {
            expect(compare("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
            expect(compare("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(-1);
            expect(compare("1.0.0-alpha.10", "1.0.0-alpha.9")).toBe(1);
            expect(compare("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
            expect(compare("1.0.0-1", "1.0.0-alpha")).toBe(-1); // numeric < alpha
        });
    });

    await describe("@gjsify/semver — Range", async () => {
        await it("caret narrows on 0.x.y", async () => {
            const r = new Range("^0.3.7");
            expect(r.test(new SemVer("0.3.7"))).toBe(true);
            expect(r.test(new SemVer("0.3.99"))).toBe(true);
            expect(r.test(new SemVer("0.4.0"))).toBe(false);
            expect(r.test(new SemVer("0.3.6"))).toBe(false);
        });

        await it("caret on >=1 keeps the major", async () => {
            const r = new Range("^1.2.3");
            expect(r.test("1.2.3")).toBe(true);
            expect(r.test("1.999.999")).toBe(true);
            expect(r.test("2.0.0")).toBe(false);
            expect(r.test("1.2.2")).toBe(false);
        });

        await it("caret 0.0.x is exact", async () => {
            const r = new Range("^0.0.3");
            expect(r.test("0.0.3")).toBe(true);
            expect(r.test("0.0.4")).toBe(false);
        });

        await it("tilde", async () => {
            const r = new Range("~1.2.3");
            expect(r.test("1.2.3")).toBe(true);
            expect(r.test("1.2.99")).toBe(true);
            expect(r.test("1.3.0")).toBe(false);
            expect(r.test("1.2.2")).toBe(false);
        });

        await it("x-ranges", async () => {
            expect(satisfies("1.2.3", "1.x")).toBe(true);
            expect(satisfies("2.0.0", "1.x")).toBe(false);
            expect(satisfies("1.2.99", "1.2.x")).toBe(true);
            expect(satisfies("1.3.0", "1.2.x")).toBe(false);
        });

        await it("primitives", async () => {
            expect(satisfies("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
            expect(satisfies("2.0.0", ">=1.0.0 <2.0.0")).toBe(false);
            expect(satisfies("1.2.3", ">1.2.2")).toBe(true);
            expect(satisfies("1.2.2", ">1.2.2")).toBe(false);
            expect(satisfies("1.2.3", "<=1.2.3")).toBe(true);
        });

        await it("primitives on partial RHS", async () => {
            expect(satisfies("2.0.0", ">1")).toBe(true);
            expect(satisfies("1.5.0", ">1")).toBe(false);
            expect(satisfies("0.9.0", "<1")).toBe(true);
            expect(satisfies("1.0.0", "<1")).toBe(false);
            expect(satisfies("1.9.9", "<=1")).toBe(true);
            expect(satisfies("2.0.0", "<=1")).toBe(false);
        });

        await it("hyphen ranges", async () => {
            const r = new Range("1.2.3 - 2.3.4");
            expect(r.test("1.2.3")).toBe(true);
            expect(r.test("2.0.0")).toBe(true);
            expect(r.test("2.3.4")).toBe(true);
            expect(r.test("2.3.5")).toBe(false);
            expect(r.test("1.2.2")).toBe(false);
        });

        await it("partial hyphen RHS extends", async () => {
            const r = new Range("1.2.3 - 2.3");
            expect(r.test("2.3.99")).toBe(true);
            expect(r.test("2.4.0")).toBe(false);
        });

        await it("OR sets", async () => {
            const r = new Range("^1.0.0 || ^2.0.0");
            expect(r.test("1.5.0")).toBe(true);
            expect(r.test("2.5.0")).toBe(true);
            expect(r.test("3.0.0")).toBe(false);
        });

        await it("star/* matches anything stable", async () => {
            expect(satisfies("0.0.0", "*")).toBe(true);
            expect(satisfies("99.99.99", "*")).toBe(true);
        });

        await it("rejects prereleases unless explicitly mentioned", async () => {
            expect(satisfies("1.2.3-alpha", ">=1.0.0")).toBe(false);
            expect(satisfies("1.2.3-alpha", ">=1.2.3-alpha")).toBe(true);
            expect(satisfies("1.2.3-beta", ">=1.2.3-alpha")).toBe(true);
            // Different mmp tuple — not eligible.
            expect(satisfies("1.3.0-beta", ">=1.2.3-alpha")).toBe(false);
        });

        await it("validRange formats / rejects garbage", async () => {
            expect(validRange("^1.2.3")).toBe(">=1.2.3 <2.0.0");
            expect(validRange("not-a-range !!")).toBeNull();
        });
    });

    await describe("@gjsify/semver — maxSatisfying / minSatisfying", async () => {
        const versions = [
            "0.0.1",
            "0.1.0",
            "0.3.6",
            "0.3.7",
            "0.3.7-rc.1",
            "1.0.0",
            "1.2.3",
            "2.0.0-rc.1",
            "2.0.0",
        ];

        await it("maxSatisfying ^0.3.0", async () => {
            expect(maxSatisfying(versions, "^0.3.0")).toBe("0.3.7");
        });

        await it("maxSatisfying ^1.0.0", async () => {
            expect(maxSatisfying(versions, "^1.0.0")).toBe("1.2.3");
        });

        await it("maxSatisfying *", async () => {
            expect(maxSatisfying(versions, "*")).toBe("2.0.0");
        });

        await it("minSatisfying >=1", async () => {
            expect(minSatisfying(versions, ">=1")).toBe("1.0.0");
        });

        await it("returns null for empty match", async () => {
            expect(maxSatisfying(versions, "^9.0.0")).toBeNull();
            expect(minSatisfying([], "*")).toBeNull();
        });

        await it("ignores invalid version strings", async () => {
            expect(maxSatisfying(["1.0.0", "garbage", "1.1.0"], "^1.0.0")).toBe("1.1.0");
        });
    });
};
