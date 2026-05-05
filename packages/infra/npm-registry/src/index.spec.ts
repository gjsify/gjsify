import { describe, it, expect } from "@gjsify/unit";
import {
    DEFAULT_REGISTRY,
    parseNpmrc,
    packumentUrl,
    registryFor,
    resolveAuthForUrl,
    buildHeaders,
    verifyIntegrity,
    fetchPackument,
    fetchTarball,
    PackageNotFoundError,
    IntegrityError,
    type NpmrcConfig,
} from "./index.ts";

const sampleNpmrc = `
# default registry override
registry = https://registry.example.com/

# scoped registry
@gjsify:registry = https://registry.npmjs.org/
@private:registry = "https://artifacts.example.com/api/npm/"

# token auth
//registry.npmjs.org/:_authToken = npm_FAKETOKEN_abc123
//artifacts.example.com/api/npm/:_authToken = \${NPM_TOKEN_BASIC}

# basic auth
//mirror.example.com/:username = alice
//mirror.example.com/:_password = c2VjcmV0
`;

function makeMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
    return ((url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        return handler(u, init);
    }) as typeof fetch;
}

export default async () => {
    await describe("@gjsify/npm-registry — packumentUrl + registryFor", async () => {
        await it("plain name", async () => {
            expect(packumentUrl("lodash", DEFAULT_REGISTRY)).toBe(
                "https://registry.npmjs.org/lodash",
            );
        });

        await it("scoped name encodes slash", async () => {
            expect(packumentUrl("@gjsify/path", DEFAULT_REGISTRY)).toBe(
                "https://registry.npmjs.org/%40gjsify/path",
            );
        });

        await it("registryFor picks scope override", async () => {
            const npmrc: NpmrcConfig = {
                registry: "https://default/",
                scopes: { "@gjsify": "https://gjsify-registry/" },
                authTokens: {},
                basicAuth: {},
            };
            expect(registryFor("@gjsify/cli", npmrc)).toBe("https://gjsify-registry/");
            expect(registryFor("lodash", npmrc)).toBe("https://default/");
            expect(registryFor("lodash", undefined)).toBe(DEFAULT_REGISTRY);
        });
    });

    await describe("@gjsify/npm-registry — parseNpmrc", async () => {
        await it("parses registry + scopes + tokens + basic", async () => {
            const cfg = parseNpmrc(sampleNpmrc);
            expect(cfg.registry).toBe("https://registry.example.com/");
            expect(cfg.scopes["@gjsify"]).toBe("https://registry.npmjs.org/");
            expect(cfg.scopes["@private"]).toBe("https://artifacts.example.com/api/npm/");
            expect(cfg.authTokens["//registry.npmjs.org"]).toBe("npm_FAKETOKEN_abc123");
            expect(cfg.basicAuth["//mirror.example.com"].username).toBe("alice");
            expect(cfg.basicAuth["//mirror.example.com"].password).toBe("secret");
        });

        await it("expands ${ENV_VAR} from process.env when present", async () => {
            const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
            const original = proc?.env?.NPM_TOKEN_BASIC;
            if (proc?.env) proc.env.NPM_TOKEN_BASIC = "from-env-token";
            try {
                const cfg = parseNpmrc(sampleNpmrc);
                expect(cfg.authTokens["//artifacts.example.com/api/npm"]).toBe("from-env-token");
            } finally {
                if (proc?.env) {
                    if (original === undefined) delete proc.env.NPM_TOKEN_BASIC;
                    else proc.env.NPM_TOKEN_BASIC = original;
                }
            }
        });

        await it("ignores comments + blank lines", async () => {
            const cfg = parseNpmrc("\n# comment\n;another\n   \nregistry=https://x/\n");
            expect(cfg.registry).toBe("https://x/");
        });
    });

    await describe("@gjsify/npm-registry — auth resolution", async () => {
        await it("longest path-prefix wins", async () => {
            const cfg: NpmrcConfig = {
                registry: DEFAULT_REGISTRY,
                scopes: {},
                authTokens: {
                    "//artifacts.example.com": "wide-token",
                    "//artifacts.example.com/api/npm": "narrow-token",
                },
                basicAuth: {},
            };
            expect(
                resolveAuthForUrl("https://artifacts.example.com/api/npm/lodash", cfg),
            ).toBe("Bearer narrow-token");
        });

        await it("host-only token applies to root URLs", async () => {
            const cfg: NpmrcConfig = {
                registry: DEFAULT_REGISTRY,
                scopes: {},
                authTokens: { "//registry.npmjs.org": "tok-1" },
                basicAuth: {},
            };
            expect(resolveAuthForUrl("https://registry.npmjs.org/lodash", cfg)).toBe(
                "Bearer tok-1",
            );
        });

        await it("buildHeaders attaches token + UA", async () => {
            const cfg: NpmrcConfig = {
                registry: DEFAULT_REGISTRY,
                scopes: {},
                authTokens: { "//registry.npmjs.org": "tok-x" },
                basicAuth: {},
            };
            const h = buildHeaders("https://registry.npmjs.org/lodash", { npmrc: cfg });
            expect(h["authorization"]).toBe("Bearer tok-x");
            expect(typeof h["user-agent"]).toBe("string");
        });
    });

    await describe("@gjsify/npm-registry — verifyIntegrity", async () => {
        await it("verifies sha256 of known bytes", async () => {
            const data = new TextEncoder().encode("hello world");
            // sha256("hello world") = uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=
            const expected = "sha256-uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=";
            expect(await verifyIntegrity(data, expected)).toBe(true);
        });

        await it("rejects bad digest", async () => {
            const data = new TextEncoder().encode("hello world");
            expect(await verifyIntegrity(data, "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(false);
        });

        await it("accepts any of multiple digests", async () => {
            const data = new TextEncoder().encode("hello world");
            const composite =
                "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= " +
                "sha256-uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=";
            expect(await verifyIntegrity(data, composite)).toBe(true);
        });
    });

    await describe("@gjsify/npm-registry — fetchPackument (mocked)", async () => {
        await it("parses a happy-path packument", async () => {
            const mock = makeMockFetch(async (url) => {
                if (url === "https://registry.npmjs.org/lodash") {
                    return new Response(
                        JSON.stringify({
                            name: "lodash",
                            "dist-tags": { latest: "4.17.21" },
                            versions: {
                                "4.17.21": {
                                    name: "lodash",
                                    version: "4.17.21",
                                    dist: { tarball: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" },
                                },
                            },
                        }),
                        { status: 200, headers: { "content-type": "application/json" } },
                    );
                }
                return new Response("nope", { status: 404 });
            });
            const p = await fetchPackument("lodash", { fetch: mock });
            expect(p.name).toBe("lodash");
            expect(p["dist-tags"].latest).toBe("4.17.21");
            expect(p.versions["4.17.21"].dist.tarball).toMatch(/lodash-4\.17\.21\.tgz$/);
        });

        await it("rejects on schema mismatch", async () => {
            const mock = makeMockFetch(async () =>
                new Response(JSON.stringify({ name: "lodash" }), { status: 200 }),
            );
            let threw = false;
            try {
                await fetchPackument("lodash", { fetch: mock });
            } catch (e) {
                threw = true;
                expect(String((e as Error).message)).toMatch(/missing versions map/);
            }
            expect(threw).toBe(true);
        });

        await it("404 → PackageNotFoundError", async () => {
            const mock = makeMockFetch(async () =>
                new Response("not found", { status: 404, statusText: "Not Found" }),
            );
            let caught: Error | null = null;
            try {
                await fetchPackument("definitely-not-real-pkg", { fetch: mock });
            } catch (e) {
                caught = e as Error;
            }
            expect(caught).toBeTruthy();
            expect(caught instanceof PackageNotFoundError).toBe(true);
        });

        await it("includes auth header when npmrc provides a token", async () => {
            let seenAuth: string | null = null;
            const mock = makeMockFetch(async (url, init) => {
                seenAuth =
                    (init?.headers as Record<string, string> | undefined)?.["authorization"] ?? null;
                return new Response(
                    JSON.stringify({
                        name: "lodash",
                        "dist-tags": {},
                        versions: {},
                    }),
                    { status: 200 },
                );
            });
            await fetchPackument("lodash", {
                fetch: mock,
                npmrc: {
                    registry: DEFAULT_REGISTRY,
                    scopes: {},
                    authTokens: { "//registry.npmjs.org": "secret-tok" },
                    basicAuth: {},
                },
            });
            expect(seenAuth).toBe("Bearer secret-tok");
        });
    });

    await describe("@gjsify/npm-registry — fetchTarball (mocked)", async () => {
        await it("returns Uint8Array bytes", async () => {
            const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // gzip magic
            const mock = makeMockFetch(async () => new Response(bytes, { status: 200 }));
            const got = await fetchTarball("https://r/x.tgz", { fetch: mock });
            expect(got.length).toBe(4);
            expect(got[0]).toBe(0x1f);
            expect(got[1]).toBe(0x8b);
        });

        await it("verifies integrity when supplied", async () => {
            const data = new TextEncoder().encode("hello world");
            const ok = "sha256-uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=";
            const mock = makeMockFetch(async () => new Response(data, { status: 200 }));
            const got = await fetchTarball("https://r/x.tgz", { fetch: mock, integrity: ok });
            expect(got.length).toBe(11);
        });

        await it("integrity mismatch → IntegrityError", async () => {
            const data = new TextEncoder().encode("hello world");
            const bad = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
            const mock = makeMockFetch(async () => new Response(data, { status: 200 }));
            let caught: Error | null = null;
            try {
                await fetchTarball("https://r/x.tgz", { fetch: mock, integrity: bad });
            } catch (e) {
                caught = e as Error;
            }
            expect(caught instanceof IntegrityError).toBe(true);
        });
    });
};
