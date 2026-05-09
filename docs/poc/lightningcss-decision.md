# Phase D-2 — lightningcss POC decision matrix

**Date**: 2026-05-09
**POCs**: `@gjsify/lightningcss-native` (Vala+Rust FFI, PR #133) vs `@gjsify/lightningcss-wasm` (vendored WASM, PR #134)
**Hardware**: Fedora 44, GJS 1.88, x86_64

## TL;DR

**Native (FFI) wins the slot in `cssAsStringPlugin`.** WASM stays in-tree as a fallback for architectures without a prebuilt cdylib.

Reasons (in priority order):
1. **3–5× faster transforms** on real fixtures.
2. **~960× faster cold start** (0.4 ms vs 364 ms) — matters for one-shot CLI invocations.
3. Both produce **byte-identical output** for the same input.
4. WASM's "single binary all archs" advantage is offset by gjsify's existing multi-arch CI prebuild matrix
   (`prebuilds.yml` already builds for 5 Linux arches via QEMU `uraimo/run-on-arch-action`).

## Benchmark methodology

Stock `gjs -m` 1.88, no `gjsify build` overhead. Both engines loaded in the same process so init costs are measured directly. Fixtures:

- **SMALL**: 90-byte CSS — `.foo{color:red; & .bar{color:blue;}} .x{color:red; margin:0 0 0 0;}` (nesting + redundant longhand)
- **BIG**: 67.6 KiB CSS — 500 `.item-N { color: hsl(N, 50%, 50%); padding: Npx; & .nested-N { … & .deep-N { background: lch(50% 100 N); } } }` blocks (deep nesting + lch colors)

Each measurement: 5 warm-up iterations, then N measured iterations, total wall-clock divided by N.

## Results

| Workload | WASM | Native | Native vs WASM |
|---|---:|---:|---:|
| Init (load + instantiate) | **364.02 ms** | **0.38 ms** | **958× faster** |
| SMALL transform, no targets, minify | 0.083 ms (n=1000) | 0.019 ms (n=1000) | **4.4× faster** |
| SMALL transform, `firefox >= 60`, minify | 0.073 ms (n=1000) | 0.033 ms (n=1000) | **2.2× faster** |
| BIG transform, no targets, minify | 13.135 ms (n=100) | 3.584 ms (n=100) | **3.7× faster** |
| BIG transform, `firefox >= 60`, minify | 15.078 ms (n=100) | 4.187 ms (n=100) | **3.6× faster** |

Output verified byte-identical for SMALL+`firefox >= 60`+minify.

## Per-axis comparison

| Axis | WASM | Native | Winner |
|---|---|---|---|
| Cold init | 364 ms (Module compile is dominant) | 0.4 ms | **Native** |
| Transform speed | 0.07–15 ms depending on fixture | 0.02–4 ms (3–5× faster) | **Native** |
| Output correctness | byte-identical | byte-identical | tie |
| Distribution size | one 15.8 MiB `.wasm` covers every arch | per-arch cdylib (~7.7 MiB on x86_64) + ~24 KiB Vala bridge + tiny typelib | **WASM** (raw size) |
| Distribution complexity | npm publish ships everything | per-arch `prebuilds/linux-<arch>/` matrix (5 arches today) | WASM (simpler) |
| Build chain locally | none — vendored bytes | `cargo build --release` + `meson compile` + `valac` + `g-ir-compiler` | WASM |
| Build chain in CI | none — vendored bytes | extends existing multi-arch `prebuilds.yml` workflow | WASM (no CI changes) |
| Maintenance per lightningcss release | re-vendor `.wasm` (+ `napi-wasm` if ABI changes) | bump `lightningcss = "1"` in `Cargo.toml` + rebuild prebuilds | WASM (single file copy) |
| API surface today | full lightningcss API: `transform`, `transformStyleAttribute`, `bundle`, `bundleAsync`, `composeVisitors`, `Features`, `browserslistToTargets` | `transform()` only (parse → minify(targets) → to_css) | **WASM** (richer, free) |
| Cross-arch portability | works wherever WebAssembly works | needs prebuild for each target arch | WASM |
| Crypto dep | needs `globalThis.crypto.getRandomValues` (`@gjsify/webcrypto/register` under `--app gjs`) | none | Native |
| Async overhead in JS | sync (asyncify suspends on demand) | sync from JS view (Vala synchronous) | tie |
| Memory profile | ~16 MiB resident from `.wasm` | ~7.7 MiB resident from `.so` + transient Rust allocations per call | Native |

## Decision

**`cssAsStringPlugin` defaults to `@gjsify/lightningcss-native` when its prebuild for the running architecture is present, with a graceful fallback to `@gjsify/lightningcss-wasm` otherwise.**

This mirrors the established `@gjsify/http2-native` / `@gjsify/terminal-native` pattern: the consumer (`cssAsStringPlugin`) does a `hasNativeLightningcss()` check at module load and routes accordingly. The same `transform({filename, code, targets, minify, sourceMap})` shape works for both backends — selection is invisible to the caller.

### Why not WASM-only

Despite WASM's distribution-simplicity advantage, the **3-5× runtime cost on every transform** is unacceptable for a build pipeline that lowers tens to hundreds of CSS files per `gjsify build` invocation. The cold-init penalty alone (~360 ms) wipes out the per-call advantage of bundling a single CSS file: by the second `transform()` call the native bridge is already ahead.

For an interactive `--watch` build, the cold-init cost amortizes — but cold builds are exactly where the user experience matters most (`gjsify build && gjsify run`).

### Why not native-only

Three real-world cases keep WASM in tree as a fallback:
1. **Unsupported arch** — riscv64/loongarch/freebsd users get the WASM path automatically.
2. **Local dev without the Rust toolchain** — contributors who have never installed cargo/meson/valac can still run `gjsify build` because the WASM is vendored bytes.
3. **Sandboxed builds** — Flatpak/CI environments without the `org.freedesktop.Sdk.Extension.rust-stable` Flatpak SDK extension can fall back to WASM at runtime.

## Open follow-ups

- [ ] Wire selection logic into `packages/infra/rolldown-plugin-gjsify/src/plugins/css-as-string.ts` — `try { native } catch { wasm } catch { npm lightningcss }`.
- [ ] Extend `.github/workflows/prebuilds.yml` to build `@gjsify/lightningcss-native` for all five arches the other native packages cover (linux-{x86_64,aarch64,ppc64,s390x,riscv64}).
- [ ] Add `tests/integration/lightningcss/` running both backends against the same fixture set, asserting byte-identical output (regression-protect the byte-equality property the decision rests on).
- [ ] Phase B: CSS modules + `analyzeDependencies` + `pseudoClasses` rewrites — both backends today only expose the warm-up subset.

## Implications for rolldown (Phase D-2 POC 2)

The lightningcss measurement validates the **FFI track is the right default** when both options exist. For rolldown, the same logic applies — but the WASM track has an additional blocker (SAB-disabled SpiderMonkey rejects `@rolldown/binding-wasm32-wasi`'s `WebAssembly.Memory({shared:true})`, see `docs/poc/wasi-imports.md`). Combined with the lightningcss data, the rolldown plan is:

1. **Default to FFI** — `@gjsify/rolldown-native`, similar Vala+Rust+cdylib pattern (Phase D-2 POC 31).
2. **Skip rolldown WASM** — the SAB blocker requires a single-threaded rolldown rebuild that loses parallel transforms (5–10× slower). Combined with the lightningcss WASM track being already 3–5× slower, the rolldown WASM cost stack is too steep to justify the effort.
