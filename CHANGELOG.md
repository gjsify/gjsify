# Changelog

## [Unreleased] — 2026-05-04

### Features

* **esbuild-plugin-gjsify:** rewrite `import.meta.url` in node_modules to build-time-known file URLs (Rollup CJS-polyfill pattern), enabling TypeDoc's eager filesystem reads to resolve via gjsify's GLib-backed `fs` polyfill at runtime
* **module:** `createRequire` walks all ancestor `node_modules` directories (matches Node.js resolution algorithm), fixing packages in a parent `node_modules` being unreachable when a closer `node_modules` exists but doesn't contain the requested package
* **ts-for-gir Phase 6:** TypeDoc stubs removed — `ts-for-gir json` and `ts-for-gir doc` work natively on GJS; 10 new tests (json/doc `--help` on Node + GJS, both run-from-Node and run-from-GJS); Node: 249/249, GJS: 209/209

---

## [0.3.3](https://github.com/gjsify/gjsify/compare/v0.3.2...v0.3.3) (2026-05-04)

### Bug Fixes

* **cli:** fall through on UNDECLARED_DEPENDENCY in Yarn PnP onResolve ([6c3b712](https://github.com/gjsify/gjsify/commit/6c3b7121ad256ea1e536f6030c8fb272ff7587a2))

## [0.3.2](https://github.com/gjsify/gjsify/compare/v0.3.1...v0.3.2) (2026-05-04)

### Features

* Yarn PnP support, excludeGlobals, fetch bridge-free ([#61](https://github.com/gjsify/gjsify/issues/61)) ([bf7d936](https://github.com/gjsify/gjsify/commit/bf7d93648bdd877107725bdf28d63fdf552c2935))

## [0.3.1](https://github.com/gjsify/gjsify/compare/v0.3.0...v0.3.1) (2026-05-04)

### Bug Fixes

* **esbuild-plugin-gjsify:** preserve caller plugins in detectAutoGlobals analysis passes ([33ccd48](https://github.com/gjsify/gjsify/commit/33ccd48aa2943e6bb1d43c97fb53eccd9d909ec2))

## [0.3.0](https://github.com/gjsify/gjsify/compare/v0.2.0...v0.3.0) (2026-05-04)

### Features

* **terminal-native:** optional Vala prebuild for real Linux terminal syscalls ([#60](https://github.com/gjsify/gjsify/issues/60)) ([d58a20a](https://github.com/gjsify/gjsify/commit/d58a20a95c7eb095e718cf23a2843f8d475816d6))

## [Unreleased] — 2026-05-02

### Features

* **terminal-native:** new optional Vala prebuild `@gjsify/terminal-native` with real Linux terminal syscalls (Posix.isatty, ioctl TIOCGWINSZ, termios raw mode, SIGWINCH ResizeWatcher). Loaded via synchronous `imports.gi.GjsifyTerminal` try/catch — no crash when typelib not installed.
* **tty:** `isatty()` now uses `Posix.isatty()` via terminal-native (GLib fallback). `getWindowSize()`/`columns`/`rows` use `ioctl TIOCGWINSZ` (env/default fallback). `setRawMode()` uses `tcgetattr/tcsetattr` (no-op fallback).
* **process:** `stdin`, `stdout`, `stderr` replaced with `ProcessReadStream`/`ProcessWriteStream` (isTTY, setRawMode, columns, rows). SIGWINCH wired to stdout/stderr `'resize'` event via `ResizeWatcher`.
* **e2e/terminal-native:** new E2E test suite `tests/e2e/terminal-native/` — 16/16 green (with + without native core module).

## [0.2.0](https://github.com/gjsify/gjsify/compare/v0.1.15...v0.2.0) (2026-05-01)

### Features

* **@gjsify/fetch + integration:** axios integration suite + double-decompression fix ([#54](https://github.com/gjsify/gjsify/issues/54)) ([a09bf9b](https://github.com/gjsify/gjsify/commit/a09bf9b9ebaeec2dc4ac77bf8bb39f747a6852ca))
* **@gjsify/fs:** add fs.promises.watch() as AsyncIterableIterator ([#51](https://github.com/gjsify/gjsify/issues/51)) ([f2ef61d](https://github.com/gjsify/gjsify/commit/f2ef61dd9b5b446586ced9ac7338e885eeb16183))
* **@gjsify/fs:** add watchFile/unwatchFile and statfsSync/statfs/promises.statfs ([#52](https://github.com/gjsify/gjsify/issues/52)) ([5fe86ed](https://github.com/gjsify/gjsify/commit/5fe86edc75abb608f487370ddac0b86e2c47e85d))
* **@gjsify/fs:** complete fs — utimes/lutimes/lchown/lchmod, all fd-ops, FileHandle stubs ([#53](https://github.com/gjsify/gjsify/issues/53)) ([2908669](https://github.com/gjsify/gjsify/commit/29086697723fadfe901c06e0ef5456203cd4cf37))
* **@gjsify/fs:** implement cp, Dir/opendir, and globSync/glob/promises.glob ([#50](https://github.com/gjsify/gjsify/issues/50)) ([4975f89](https://github.com/gjsify/gjsify/commit/4975f8983a583216ad3f9b5f4d1a67a4246bb7aa))
* **@gjsify/v8:** promote Stub → Partial with real heap stats and V8 wire-format serdes ([#54](https://github.com/gjsify/gjsify/issues/54)) ([e9e92fe](https://github.com/gjsify/gjsify/commit/e9e92fed9f2a5dd3e395a1cd5db355e59756c2ac))
* **deps:** add @gjsify/crypto workspace dependency ([8f03007](https://github.com/gjsify/gjsify/commit/8f03007d3518d090cd7fccd8fc38823737b78724))
* **example/cli-axios-http-client:** rewrite around jsonplaceholder.typicode.com (real HTTPS) ([ce9a512](https://github.com/gjsify/gjsify/commit/ce9a512ece293674e6778b5673df8756f5015df6))
* **examples:** add MCP server and client examples ([61336ef](https://github.com/gjsify/gjsify/commit/61336ef5216ee48d5312a4840166214ed751a87e))
* **examples:** add SQLite todo store cross-validated on GJS and Node.js ([6803555](https://github.com/gjsify/gjsify/commit/680355516d187c478104d2d9c49577a66563dc60))
* **examples:** socket.io ping-pong + chat-server examples + fix zlib TS errors ([26d9553](https://github.com/gjsify/gjsify/commit/26d95531804a94b71bdcb6247c1919b21c2f98d0))
* **framework:** new packages/framework pillar + @gjsify/adw-app ([252386a](https://github.com/gjsify/gjsify/commit/252386a7b71389947bc2c82463ba75ee05260d11))
* **http-soup-bridge:** new Vala bridge package wrapping Soup.Server ([eea4862](https://github.com/gjsify/gjsify/commit/eea4862aacd34ae7acd5757abcbaef528714d0b6))
* **http2:** implement Soup 3.0-backed compat + session API (Phase 1) ([a271401](https://github.com/gjsify/gjsify/commit/a271401959d8bb65ffa08adc8585b791eff4091b))
* **http2:** update yarn.lock with new [@girs](https://github.com/girs) dependencies for compatibility ([e4a31ce](https://github.com/gjsify/gjsify/commit/e4a31ceb64e910af1f188861e03816716af6c243))
* **integration/mcp:** add Streamable HTTP transport tests ([73dd84b](https://github.com/gjsify/gjsify/commit/73dd84b3e59a6e40ae47cde113f5724ff362a158))
* **integration/ts-for-gir:** @ts-for-gir/cli@4.0.0-rc.8 on GJS via async-safe @gjsify/process.exit ([#58](https://github.com/gjsify/gjsify/issues/58)) ([24414f3](https://github.com/gjsify/gjsify/commit/24414f3c015f2265ad83267aa25e35dee2ae613c))
* **integration/ts-for-gir:** Phase 1 — [@gi](https://github.com/gi).ts/parser on GJS ([#55](https://github.com/gjsify/gjsify/issues/55)) ([f26a61f](https://github.com/gjsify/gjsify/commit/f26a61f55ddb02a3aab19252a55a4dca4ad9bba9))
* **integration/ts-for-gir:** Phase 4a — non-interactive @ts-for-gir/cli on Node + supporting infra ([#57](https://github.com/gjsify/gjsify/issues/57)) ([7973f3d](https://github.com/gjsify/gjsify/commit/7973f3d547118c6ec1bb0dad9380b4107449e7f4))
* **integration/ts-for-gir:** Phases 2+3 — @ts-for-gir/lib type system + generator pipeline on GJS ([#56](https://github.com/gjsify/gjsify/issues/56)) ([066e431](https://github.com/gjsify/gjsify/commit/066e431e5f6bf184ada5157c101aa21ab2e17753))
* **integration:** add MCP TypeScript SDK integration tests ([757697c](https://github.com/gjsify/gjsify/commit/757697cd3b6d2078a0894b92c1546aa8ff112ea2))
* **integration:** socket.io 20/20 on GJS + 3 root-cause fixes in events/fetch/http/stream ([97dcc7f](https://github.com/gjsify/gjsify/commit/97dcc7f3e60fc396dc51ab0d0888f60a6ddce3fb))
* **integration:** webtorrent integration test pillar + 3 root-cause fixes ([b571b53](https://github.com/gjsify/gjsify/commit/b571b53807ca9b3b5ed3a4b458a16ae2c27282d3))
* **node/ws:** drop-in @gjsify/ws wrapper over Soup WebsocketConnection ([b11304c](https://github.com/gjsify/gjsify/commit/b11304c03ee7eb7a971661253b3e886dc53482ce))
* **socket.io-examples:** enable WebSocket transport + add READMEs ([706de51](https://github.com/gjsify/gjsify/commit/706de51e42a761965393c9f80fcba0e950a59362))
* **socket.io:** port socket.spec.ts + namespaces.spec.ts; fix WebSocket-only transport ([83f2db5](https://github.com/gjsify/gjsify/commit/83f2db5ffad906021cad34f2130cb9b79ce74bbf))
* **tests-integration,websocket:** Autobahn Testsuite pillar + /register subpath ([221db35](https://github.com/gjsify/gjsify/commit/221db35bf0737370012fd5be3b63a8ace25d42b5))
* **tests-integration:** enable Autobahn 9.* performance suite ([720ed04](https://github.com/gjsify/gjsify/commit/720ed04896cc3dba7cdaa3d89e35ed50e75bc853))
* **tests/browser:** add browser tests for dom-elements and canvas2d-core ([7a843f4](https://github.com/gjsify/gjsify/commit/7a843f43982dcaed048204f9795d8c527c86387c))
* **tests/browser:** add Playwright browser test infrastructure for Web/DOM packages ([5506b60](https://github.com/gjsify/gjsify/commit/5506b60062c125a9fcf3e764a94b1c56195f0eef))
* **tests:** add streamx integration test suite (155 Node + 156 GJS tests) ([a975669](https://github.com/gjsify/gjsify/commit/a975669425d86d874c4d60473fcb19c251b1d5e1))
* **video:** GstHTMLVideoElement + VideoBridge controls + two new examples ([#24](https://github.com/gjsify/gjsify/issues/24)) ([82e32b5](https://github.com/gjsify/gjsify/commit/82e32b51aefc7243e522bd2cbcd36582ab4d4db2)), closes [#0](https://github.com/gjsify/gjsify/issues/0) [#1](https://github.com/gjsify/gjsify/issues/1) [#2](https://github.com/gjsify/gjsify/issues/2) [#18](https://github.com/gjsify/gjsify/issues/18)
* **websocket,tests-integration:** permessage-deflate + Autobahn baseline expansion ([74487bc](https://github.com/gjsify/gjsify/commit/74487bcdd44ce91d38eefcaee9654129a467bc49)), closes [#30](https://github.com/gjsify/gjsify/issues/30)
* **websocket:** implement headers, origin, handshakeTimeout client options ([a2bb775](https://github.com/gjsify/gjsify/commit/a2bb775c42876e014bacb1af075c11db81b6a8fa))
* **ws,net,http:** WebSocket server Phase 3 — noServer+handleUpgrade+'headers' event ([93f4980](https://github.com/gjsify/gjsify/commit/93f498005b1439d4329ebdc907b5bbb61b5d1678))
* **ws:** implement createWebSocketStream + update docs ([09249a3](https://github.com/gjsify/gjsify/commit/09249a36da62024183b13c320f4e51f4f86ede1c))
* **ws:** WebSocket server hooks Phase 2 — verifyClient, handleProtocols, { server } mode ([a11a041](https://github.com/gjsify/gjsify/commit/a11a04197d6084567a55de3b99aadf9c85370271))

### Bug Fixes

* **@gjsify/unit:** add browserSignalDone — 13/13 browser tests green ([#48](https://github.com/gjsify/gjsify/issues/48)) ([0a81e1f](https://github.com/gjsify/gjsify/commit/0a81e1fe9fb28f52e42e914b08126bb6902eafb9))
* **child_process:** add ensureMainLoop() to spawn/exec/execFile — fix GJS-from-GJS subprocess deadlock (Phase 5) ([#59](https://github.com/gjsify/gjsify/issues/59)) ([2f04633](https://github.com/gjsify/gjsify/commit/2f046335682d844e3a85b64c506342b5be0dda6c))
* **child_process:** spawn() sets child.stdout/stderr as GioInputStreamReadable ([#49](https://github.com/gjsify/gjsify/issues/49)) ([8b3feac](https://github.com/gjsify/gjsify/commit/8b3feaceb0ff7ba7e6bf7352856fc2697c8f8900))
* **ci:** upgrade riscv64 base image to ubuntu:26.04 ([9484cf3](https://github.com/gjsify/gjsify/commit/9484cf3ef06878a58017da5e85343db47d8a3c2f))
* **dgram:** reject mismatched-family sends with EINVAL before hitting Gio ([280bbfa](https://github.com/gjsify/gjsify/commit/280bbfae7348eb3c115e72edd7dc659f6ddcda31))
* **esbuild-plugin-gjsify:** add resolveDir to __dirname onLoad result ([eec66e9](https://github.com/gjsify/gjsify/commit/eec66e92000683f0ea4c7c787c114faaadbd9fa5))
* **esbuild-plugin-gjsify:** fix random-access-file 'not a directory' build error ([5105dfa](https://github.com/gjsify/gjsify/commit/5105dfa0d004382ba18dd1da3b89f7f29694b406))
* **esbuild-plugin-gjsify:** inject __dirname/__filename for CJS node_modules ([d2471c0](https://github.com/gjsify/gjsify/commit/d2471c0c8ce6ca51da6f542dd986fb86415e8f27))
* **esbuild-plugin-gjsify:** use build.resolve for random-access-file redirect ([79e3009](https://github.com/gjsify/gjsify/commit/79e3009649ef9edaff1b51509fcf61ca03eb52e6))
* **example/cli-axios-http-client:** explicit process.exit(0) so GJS returns to shell ([d1a8b45](https://github.com/gjsify/gjsify/commit/d1a8b4542fd027fbc397b44704e7ceaf861dd3c9))
* **examples/mcp:** fix net-mcp-server session handling ([eb235f8](https://github.com/gjsify/gjsify/commit/eb235f8a06b4fed748aa14fc88af8a7de8dd57ef))
* **examples/mcp:** fix TS2339 union type in cli-mcp-client ([55c2eb4](https://github.com/gjsify/gjsify/commit/55c2eb442952c2405626d13cc785f20bd890e2de))
* **examples/mcp:** hold McpServer per session and use explicit resource path ([05b66cb](https://github.com/gjsify/gjsify/commit/05b66cb59ca278703adaa4170e8d7c0a086ec65d))
* **examples:** chat-server use CDN for socket.io client, serveClient: false ([eed71a3](https://github.com/gjsify/gjsify/commit/eed71a32d6cfd07acc8d820391a4ffeadd4e2552))
* **fetch,url,webrtc,webaudio:** XHR responseType + URL.createObjectURL at the source (unblocks Excalibur showcase audio) ([604f6fa](https://github.com/gjsify/gjsify/commit/604f6fae9454fa484da7d8e1b25230d6a57c224a))
* **fetch:** xhr.ts pass headersInit record directly, remove unused Headers import ([0557244](https://github.com/gjsify/gjsify/commit/0557244c0e3c3aa8cde88bff7838f8d0ba0efea1))
* **fs,stream:** serialize concurrent I/O to clear GIO_ERROR_PENDING ([2ad9471](https://github.com/gjsify/gjsify/commit/2ad94714dc2f7fd8f508589a420891a97fdd075f))
* **fs:** convert ReadStream and FileHandle to async Gio I/O ([c74c34a](https://github.com/gjsify/gjsify/commit/c74c34af8fb116c4898c289ea8a6b8cbc8b50aaf))
* **fs:** use _construct() for async ReadStream file open; add regression tests ([e75fab7](https://github.com/gjsify/gjsify/commit/e75fab7f89190a4222dce89c11b05450a39e10f6))
* **globals:** inject timer override into bundles via auto-globals ([0a4af05](https://github.com/gjsify/gjsify/commit/0a4af052c565d8f941404e373edc09eae05ec664))
* **http-soup-bridge:** hand-written ambient types instead of @girs/ ([4f42cc8](https://github.com/gjsify/gjsify/commit/4f42cc8e4a6ed5bb596097dc46a2b3fb88577a6f))
* **http-soup-bridge:** throw GLib.Error from listen() so JS gets EADDRINUSE ([fc73142](https://github.com/gjsify/gjsify/commit/fc731426b6a0f25a0637b700631cd97297666e82)), closes [#44](https://github.com/gjsify/gjsify/issues/44)
* **http,net,fetch:** make HTTP server lifecycle GJS-GC-safe and Hono-compatible ([ff4959f](https://github.com/gjsify/gjsify/commit/ff4959f38e6de02a8e93db1b7b724cc5bc10c28c))
* **http2:** use npm version ranges for @girs/* deps (not workspace:^) ([60c5055](https://github.com/gjsify/gjsify/commit/60c5055b920286bfdad8e398e74ef127386e413f))
* **http:** map Gio listen errors to EADDRINUSE + default start to GJS ([8374b34](https://github.com/gjsify/gjsify/commit/8374b344815b45fcdb95aa752ee932e2b97aaef7))
* **http:** restore broad upgrade-intercept condition, keep req.socket before block ([4675156](https://github.com/gjsify/gjsify/commit/4675156e9ca95e1aa4837c41ef6d9ab5e7e33f77))
* **integration/mcp:** fix API signatures and GJS URL normalization ([d94324f](https://github.com/gjsify/gjsify/commit/d94324f671c8adae4a796ade6189deb280f38dae))
* **integration/mcp:** fix TS2339 union type access on resource contents ([28edde7](https://github.com/gjsify/gjsify/commit/28edde72d250df9445d3bb10714f90cf0ff92360))
* **net-ws-server:** correct subprotocol to chat.v1, fix build:public idempotency ([4e29eb3](https://github.com/gjsify/gjsify/commit/4e29eb3877756bcaf4161a824c3e2adc1b338501))
* **net:** yield to GLib idle between socket reads to prevent GTK freeze ([03f9389](https://github.com/gjsify/gjsify/commit/03f93895df57d4f37a815730f649f4d9145f7e33))
* **process:** revert nextTick to microtask semantics ([cc953c7](https://github.com/gjsify/gjsify/commit/cc953c709a71f00de301e4c8635fc742a5bdee64))
* remove surplus null arg from GLib.timeout_add calls in excalibur tests ([496fa78](https://github.com/gjsify/gjsify/commit/496fa78eb7c63dbc211f097375aba04ebaeab06b))
* remove surplus null user_data arg from GLib.timeout_add/idle_add calls ([ba8aa76](https://github.com/gjsify/gjsify/commit/ba8aa76e38d71806305fa7006ec062c3fe2f1295))
* replace (globalThis as any).X with direct imports in impl code ([40f7ea1](https://github.com/gjsify/gjsify/commit/40f7ea12dd960f4ca9994ca8b743694a82fe2ddc))
* **stream,fetch:** implement Readable.toWeb/fromWeb + fix fetch Content-Type ([6f422c6](https://github.com/gjsify/gjsify/commit/6f422c6c7bce00711ff3a1e6604518aae7f40d72))
* **stream:** drain write buffer synchronously when _write completes sync ([b7f6d5b](https://github.com/gjsify/gjsify/commit/b7f6d5be825cf89dacbafffff686a69c6b3fae99))
* **stream:** preserve FIFO write order across drain emit re-entry ([d85eff4](https://github.com/gjsify/gjsify/commit/d85eff4ffcfae2599a1326c74bcbc46ad69dbbe2)), closes [#0](https://github.com/gjsify/gjsify/issues/0)
* **stream:** store _err on destroy(), fix finished() for already-destroyed streams ([9cb6c42](https://github.com/gjsify/gjsify/commit/9cb6c4229f26ff4ca4a0e1a96d311802d08170b2))
* **tests/browser:** exclude test.browser.mts from tsc in dom packages ([91156f1](https://github.com/gjsify/gjsify/commit/91156f12d6913b70e38fadcd446f3e8572de7ee7))
* **tests/browser:** pass DOMMatrix2DInit with 2D-only props to setTransform ([4ca4d35](https://github.com/gjsify/gjsify/commit/4ca4d35487ff4d7fc2a3a3a719f4d9afb34e5293))
* **utils,process:** route nextTick through GLib idle to unfreeze GTK window ([9f077ca](https://github.com/gjsify/gjsify/commit/9f077caef63f2653bf4de9c463071dce8b2c6673))
* **utils:** batch nextTick bursts to keep GTK input events dispatching ([c9febdc](https://github.com/gjsify/gjsify/commit/c9febdc888a54a69a4cdf95ffe8c9367969b132a))
* **utils:** point GJS crash hint at GitHub issues, not internal STATUS.md ([4c7dbca](https://github.com/gjsify/gjsify/commit/4c7dbcaa494dfc5af11090b0f642efb34955e1af))
* **utils:** print G_DEBUG advisory at GJS HTTP startup; document MainContext race ([de5cd8d](https://github.com/gjsify/gjsify/commit/de5cd8d6f8ae7f1f05d93a5bd0641d1190e34db0))
* **web-streams:** use queueMicrotask instead of nextTick for pipeTo scheduling ([fec7abb](https://github.com/gjsify/gjsify/commit/fec7abbf5c11cdcba25c9c54f024470db178260f))
* **webgl:** cast TypedArray to number[] for @girs/gwebgl-0.1 compat ([509b6f1](https://github.com/gjsify/gjsify/commit/509b6f1d94192b617b463de5817170b474031392))
* **webgl:** remove stale dom/webgl/prebuilds after move to framework/ ([dba474d](https://github.com/gjsify/gjsify/commit/dba474de19a26ca3d2bf929455219efed4cc3045))
* **webrtc-native,webgl:** remove build:meson from default build script ([8f74ca2](https://github.com/gjsify/gjsify/commit/8f74ca274de07deef03f314719251cf1b3720560))
* **websocket:** make perMessageDeflate opt-in to fix unit test regressions ([dbdf236](https://github.com/gjsify/gjsify/commit/dbdf2363ffb8530d67ae1f42fc29597a75f353fc))
* **websocket:** preserve NUL bytes in text-frame sends ([0b548bf](https://github.com/gjsify/gjsify/commit/0b548bf527d17aa8c87320fa7c8e034082550f69))
* **websocket:** set max_incoming_payload_size to 100 MB + refresh Autobahn baselines ([cf1fd74](https://github.com/gjsify/gjsify/commit/cf1fd74e26ce00da763b6a39f52a5cc0e1cdf06a))
* **ws,net-ws-server:** remove double 'connection' emit in handleUpgrade path ([c5c12e0](https://github.com/gjsify/gjsify/commit/c5c12e06258428b24d8139ee8346cfb25419ed8e))
* **ws:** replace @gjsify/http import type with local structural interface ([a4157a9](https://github.com/gjsify/gjsify/commit/a4157a9601e8c6d035f8cc2aa80e908fa1495cff))
* **yarn:** add workspace reference for @gjsify/buffer ([9cfdea3](https://github.com/gjsify/gjsify/commit/9cfdea39e122f5759a28f45df332335aafba926e))

### Performance Improvements

* **excalibur-jelly-jumper:** add performance profiling + GJS vs browser comparison ([a5bd29d](https://github.com/gjsify/gjsify/commit/a5bd29d765df7d4ea81e7ef8110428eb467efca3))
* **excalibur-jelly-jumper:** finalize GJS config after A/B tests ([6cf9eb1](https://github.com/gjsify/gjsify/commit/6cf9eb1afec890b8776f963d8ce4dd26623d1d0e))
* **excalibur-jelly-jumper:** fix HUD visibility + reduce physics cascade ([5e1a55d](https://github.com/gjsify/gjsify/commit/5e1a55d8bed7def97c671a432e0be2be686dc93c))
* **excalibur-jelly-jumper:** improve comparison script hints based on real data ([5ad2b62](https://github.com/gjsify/gjsify/commit/5ad2b62df8e9f93c0ac9cc9ad2c767f61c5ff380))
* **excalibur-jelly-jumper:** reduce per-frame GC allocations ([0415007](https://github.com/gjsify/gjsify/commit/0415007ae9148180812fc98e9638fdfb2eaf47da))
* **excalibur-jelly-jumper:** tie [PERF] logging to F1 toggle ([ca6877d](https://github.com/gjsify/gjsify/commit/ca6877dd349d7cc4f5a0cdd22bbf791dce8126ee))
* **excalibur-jelly-jumper:** use black HUD text (green bg) ([312c5cc](https://github.com/gjsify/gjsify/commit/312c5cc8e3dcde45725bacf93f01ac85a2e73011))
* **webgl,excalibur-jelly-jumper:** final allocation fixes ([9a78eaa](https://github.com/gjsify/gjsify/commit/9a78eaaeaf347cf459666bceeafe411192b50947))
* **webgl,webaudio:** eliminate per-frame GLib.Source + defer audio pipeline teardown ([d66a44f](https://github.com/gjsify/gjsify/commit/d66a44f8be4a6adbdd4a4577fa17fe2d695c375d))
* **webgl:** eliminate Vala GLenum[] conversion loops + cache VariantType ([0ee028a](https://github.com/gjsify/gjsify/commit/0ee028ad8e57a47e17af4f295f7f7a2b239dd02f))

## Unreleased

### feat(integration/ts-for-gir) — Phase 4b: non-interactive `@ts-for-gir/cli` on GJS (2026-04-30)

The same `@ts-for-gir/cli@4.0.0-rc.6` bundle that Phase 4a proved on Node now also runs on GJS. `dist/cli.gjs.mjs` is built via [`tests/integration/ts-for-gir/scripts/build-cli-gjs.mjs`](tests/integration/ts-for-gir/scripts/build-cli-gjs.mjs) — a small `gjsify build` wrapper that injects `--alias` paths from a per-test stub directory ([`tests/integration/ts-for-gir/src/stubs/`](tests/integration/ts-for-gir/src/stubs/)) for the bundle-hostile deps:

- `typedoc` and `@ts-for-gir/typedoc-theme` (read their own `package.json` via `import.meta.url`-relative path; bundle escapes the package and crashes)
- `prettier` (same `import.meta.url` issue + plugin auto-loader walks the filesystem)
- `@inquirer/prompts` and `inquirer` (hundreds of named exports; alias-resistant)
- `@ts-for-gir/generator-html-doc` and `@ts-for-gir/generator-json` (cut the dep tree at the highest level — these are the only two consumers of typedoc/prettier in the CLI's call graph)

The stubs export the symbols that `@ts-for-gir/cli`'s `commands/` and `generation-handler.ts` import, so the bundle compiles and every command that does not execute the stubbed code at runtime works (`--version`, `--help`, `list`, `copy`, `analyze`). Commands that DO need the stubbed code (`doc`, `json`, the interactive prompts inside `create`) throw a clear "stubbed on GJS" error at the call site.

`cli.spec.ts` now spawns BOTH bundles from the Node test runtime: `node dist/cli.node.mjs <args>` and `gjs -m dist/cli.gjs.mjs <args>`, with `LD_LIBRARY_PATH`/`GI_TYPELIB_PATH` pointing at the `@gjsify/*` prebuild dirs. Same 5 assertions per bundle = **10 CLI tests, all green on Node**. Skipped when the spec runs on the GJS test runtime — `@gjsify/child_process` (Gio.Subprocess) currently hangs the parent's main loop when it spawns another `gjs`, tracked as Phase 5 in STATUS.md. Spawning from Node still validates the GJS bundle end-to-end.

**Total ts-for-gir suite: Node 229/229, GJS 169/169.**

**Three runtime fixes in [`tests/integration/ts-for-gir/src/cli.entry.ts`](tests/integration/ts-for-gir/src/cli.entry.ts) that make the GJS bundle terminate cleanly:**

1. **GLib MainLoop bootstrap.** The CLI's `list`/`generate` handlers do async `fs/promises` I/O. On GJS that needs the GLib main context to dispatch — without it the process exits before the handler ever runs. We start an idempotent `GLib.MainLoop().runAsync()` inline (4 lines, accessing `imports.gi.GLib` directly) rather than importing `ensureMainLoop` from `@gjsify/utils`, because `@gjsify/utils`'s other source files have non-type imports of `@girs/glib-2.0` / `@girs/gio-2.0`, which become runtime `import "@girs/*"` statements in the Node bundle and crash Node's ESM loader on the first `gi://` URL.

2. **yargs `.exitProcess(false)`.** Without it, yargs's internal `process.exit(0)` for `--version` / `--help` runs synchronously inside `parseAsync`. On GJS that triggers `imports.system.exit` while the GLib MainLoop is still parked in `runAsync()`, deadlocking the process for the entire CLI test timeout. With `exitProcess(false)`, parseAsync resolves cleanly and our own `shutdown()` runs.

3. **`GLib.idle_add` + `imports.system.exit` shutdown.** Calling `imports.system.exit` from inside a promise-microtask continuation (which is where the `await yargs(…).parseAsync()` resolution lands) leaves the process parked even after the loop is quit. Scheduling the exit on a `GLib.idle_add` callback hands control back to the loop first, so the syscall fires from a fresh main-loop iteration.

Build script + entry file diffs are scoped to the integration test — no `@gjsify/*` package code changes in this PR. The corner cases above all live in upstream packages (yargs, typedoc, GLib's loop semantics) and are best worked around at the consumer level for now.

### feat(integration/ts-for-gir) — Phase 4a: non-interactive `@ts-for-gir/cli` on Node (2026-04-30)

Bundled `@ts-for-gir/cli@4.0.0-rc.6` runs end-to-end on Node via `gjsify build` + a small in-project `cli.entry.ts` shim that mirrors the upstream `start.ts` wiring (the published package's `exports` map only exposes `.`, not the full source tree). New `cli.spec.ts` (5 tests) spawns the bundled CLI as a subprocess and asserts on stdout/stderr:

- `--version` → `"4.0.0-rc.6"` (proves the new `gjsify build --define` flag injects the `__TS_FOR_GIR_VERSION__` build-time constant)
- `--help` → renders the full command tree (analyze, create, generate, json, list, copy, doc) — proves yargs's command registration loads cleanly
- yargs `.strict()` rejects unknown commands
- `list --help` → renders per-command flags (proves cosmiconfig + the option builder load)
- `list -g <dir>` → walks our local Vala-generated GIRs via `glob` and renders them through colorette

**Total ts-for-gir suite: Node 199/199, GJS 169/169 + 1 ignored (the gated CLI suite — see STATUS.md Phase 4b).**

**Three root-cause fixes landed in the same PR — surfaced by the bundling and runtime errors:**

1. **`@gjsify/util` gains `styleText` and `stripVTControlCharacters`** ([packages/node/util/src/index.ts](packages/node/util/src/index.ts)). Required by every `@inquirer/*` package — `@inquirer/core/lib/screen-manager.js` calls `stripVTControlCharacters`, and `theme.js`/`Separator.js` import `styleText`. Implementations follow Node's spec from `refs/node/lib/util.js:167` (styleText) and `refs/node/lib/internal/util/inspect.js:3036` (stripVTControlCharacters), reusing our existing `inspect.colors` map for ANSI code lookup. 12 new tests in `extended.spec.ts` (258 total, all green on Node + GJS).

2. **Per-source-file `__filename`/`__dirname` injection in the Node app target** ([packages/infra/esbuild-plugin-gjsify/src/app/node.ts](packages/infra/esbuild-plugin-gjsify/src/app/node.ts)). esbuild does not auto-shim CJS-only globals when emitting ESM output. Bundled `typescript` (`isFileSystemCaseSensitive` calls `swapCase(__filename)` for case-sensitive-FS detection) crashes with `ReferenceError: __filename is not defined`. Mirrors the existing GJS target hook: any `node_modules/*.{js,cjs}` file referencing these names gets a per-file `var` preamble with the source-file path. A top-of-bundle banner was attempted first but collided with source files that declare these names themselves (e.g. `@ts-for-gir/lib/src/utils/path.ts`).

3. **Three new pass-through flags on `gjsify build`: `--define`, `--external`, `--alias`** ([packages/infra/cli/src/commands/build.ts](packages/infra/cli/src/commands/build.ts), [packages/infra/cli/src/config.ts](packages/infra/cli/src/config.ts), [packages/infra/cli/src/actions/build.ts](packages/infra/cli/src/actions/build.ts), [packages/infra/cli/src/types/](packages/infra/cli/src/types/)). esbuild already supports all three natively; the CLI just needed surface area.
   - `--external <pkg>[,<pkg>...]` (repeatable): marks modules as runtime imports. The plugin merges user externals with the platform's built-in list (`EXTERNALS_NODE`, `gi://*`, `cairo`, etc.) so neither overrides the other.
   - `--define KEY=VALUE` (repeatable): substitutes compile-time constants. VALUE is a JS expression — string literals must be JSON-quoted (`--define VERSION='"1.2.3"'`). Required for upstream packages that gate behavior on `typeof __FOO__ !== 'undefined'`.
   - `--alias FROM=TO[,FROM=TO...]` (repeatable): layers user aliases on top of the gjsify built-in alias map.

**Re-bundling `@ts-for-gir/cli` from source needs explicit devDeps for the workspace generators.** `generation-handler.ts` imports `@ts-for-gir/generator-html-doc` and `@ts-for-gir/generator-json` at top level. Neither is listed under `dependencies` — and that is intentional: `@ts-for-gir/cli` publishes a pre-bundled `bin/ts-for-gir` (28k lines of esbuild output, all generators inlined) that end-users run directly, so the generator packages are dev-only for the upstream repo. Our integration test re-bundles `src/start.ts` ourselves to layer in gjsify's GJS-specific transforms, so we declare the generator packages as devDeps in `tests/integration/ts-for-gir/package.json`. Not an upstream bug.

### feat(tests/integration/ts-for-gir) — Phases 2+3: `@ts-for-gir/lib` type system + generator pipeline on GJS (2026-04-29)

Extends the ts-for-gir integration suite with two new spec files: **`lib.spec.ts`** (51 tests, Phase 2) and **`generator.spec.ts`** (18 tests, Phase 3). All 169 tests pass on both Node.js and GJS with 0 skips.

**Phase 2 — `@ts-for-gir/lib` type expression builders.** Tests the entire `TypeExpression` class hierarchy as pure value-objects: `TypeIdentifier`, `ModuleTypeIdentifier` (3-arg constructor `name/moduleName/namespace`), `NativeType`, `OrType`/`BinaryType` (set-semantic `equals()` — order-independent), `TupleType` (positional `equals()`), `FunctionType` (plain-object parameter map), `PromiseType`/`ClosureType` (`unwrap()` returns `this`; inner type at `.type`; `ClosureType.deepUnwrap()` returns inner type), `NullableType`, `ArrayType`, `GenericType`, and all 13 primitive singleton constants (`VoidType`, `BooleanType`, `StringType`, `NumberType`, `AnyType`, `NullType`, `NeverType`, `UnknownType`, `ThisType`, `ObjectType`, `Uint8ArrayType`, `AnyFunctionType`, `BigintOrNumberType`). No GIR pipeline — pure type system validation.

**Phase 3 — `@ts-for-gir/generator-typescript` pipeline.** Tests the full DependencyManager → GirModule.load → GirModule.parse → ModuleGenerator.generateModule chain against a minimal synthetic GIR written to `tmpdir()` at module load time. Key findings: `DependencyManager.get()` requires `girDirectories` to point at the real filesystem (it uses `glob` internally — not an in-memory API); `IntrospectedRecord.members` is an array (`.find()` not `.get()`); `initTransitiveDependencies([])` must be called before `new ModuleGenerator()` because the constructor reads `girModule.transitiveDependencies`; `allowMissingDeps: true` keeps GObject-2.0 as a stub dep so `generateModule()` succeeds. Exercises `glob`, `ejs`, `lodash`, `colorette` — all work on GJS via `@gjsify/*` polyfills.

**New devDeps** in `tests/integration/ts-for-gir/package.json`: `@ts-for-gir/lib@^4.0.0-rc.6`, `@ts-for-gir/generator-typescript@^4.0.0-rc.6`.

### feat(tests/integration/ts-for-gir) — Phase 1: `@gi.ts/parser` integration suite (2026-04-29)

New strategic goal: **`ts-for-gir` runs unmodified on GJS.** ts-for-gir publishes ~10 npm packages (`@gi.ts/parser`, `@ts-for-gir/lib`, `@ts-for-gir/cli`, `@ts-for-gir/generator-*`, `@ts-for-gir/language-server`, `@ts-for-gir/reporter`, `@ts-for-gir/typedoc-theme`); validating them progressively against `@gjsify/*` is the next surface that exercises the full Node.js pillar end-to-end.

**Phase 1 covers `@gi.ts/parser` v4.0.0-rc.6** — the smallest, most isolated package: one runtime dep (`fast-xml-parser`), pure-function API `parser.parseGir(xml: string): GirXML`. **Node: 18/18 green. GJS: 18/18 green, 0 skips.**

Fixtures are gjsify's own Vala-generated GIRs (`Gwebgl-0.1.gir`, `GjsifyWebrtc-0.1.gir`, `GjsifyHttpSoupBridge-1.0.gir`), committed under `tests/integration/ts-for-gir/girs/`. Real-world parser surface — exercises classes (10 total), 300 methods, 40 properties, 26 signals (`<glib:signal>`), an enumeration, the `<constructor>` rename/restore workaround for fast-xml-parser's prototype-pollution guard, and multi-namespace `<include>` deps (Soup, Gst, GstWebRTC, Gio, GObject, GLib).

`refs/ts-for-gir/` git submodule added for porting reference in subsequent phases. The suite is the first to deliberately omit `import '@gjsify/node-globals/register'` — `gjsify build --globals auto` (default) covers everything `fast-xml-parser` and the test code need; explicit `/register` imports in non-package code are now considered an anti-pattern (CLAUDE.md `### Don't patch — implement at the source`).

Out of scope for Phase 1, tracked in STATUS.md Open TODOs: `@ts-for-gir/lib` type-system tests, generator pipeline (Greeter.gir → .d.ts snapshot), CLI tarball end-to-end (blocked on yargs/inquirer/prettier GJS readiness), language-server vitest port (blocked on `typescript` package on GJS).

### fix(@gjsify/unit) — add browserSignalDone for Playwright test completion (2026-04-28)

`@gjsify/unit` now sets `window.__gjsify_test_results` and `document.documentElement.dataset.testsDone = 'true'` when a test run finishes in a browser context. This is required for the Playwright harness (`tests/browser/specs/unit.spec.ts`) to detect that tests have completed and to read pass/fail counts.

**Changes:**
- Added `testErrors` array — collects `{ suite, test, message }` for every failed `it()` call
- Added `currentSuite` tracking — `describe()` sets it on entry and restores on exit so nested describes work correctly
- Added `browserSignalDone()` — called from `run()` after `printResult()`; no-op when `document` is absent (GJS / Node.js)

Without this fix, `dom-elements` and `canvas2d-core` browser test bundles timed out in Playwright even though the tests ran successfully — the harness never received the done signal.

### feat(tests/browser) — promote to yarn workspace, add dom-elements + canvas2d-core (2026-04-28)

`tests/browser/` is now a proper yarn workspace (`@gjsify/tests-browser`) with `@playwright/test` as a dev dependency. This makes `playwright` available to the workspace without requiring a global install.

**New browser test bundles (verified green in Firefox):**
- `packages/dom/dom-elements/dist/test.browser.mjs` — Node tree ops, Element attributes, classList, HTMLElement properties, Text/Comment/DocumentFragment, DOMMatrix, CSSStyleDeclaration, FontFace, FontFaceSet, matchMedia
- `packages/dom/canvas2d-core/dist/test.browser.mjs` — clearRect with active state, save/restore for all context properties, transforms, ImageData (RGBA byte order), text metrics, composite ops, drawImage (3/5/9-arg), path ops

`discover-bundles.mjs` already scanned `packages/dom/` (added in a prior PR). Total: 13 passing browser bundles.

### feat(examples) — SQLite todo store example cross-validated on GJS and Node.js (2026-04-28)

New example `examples/node/cli-sqlite-json-store` (`@gjsify/example-node-cli-sqlite-json-store`) demonstrates `node:sqlite` (`DatabaseSync` + `StatementSync`) running identically on both GJS (via `@gjsify/sqlite` / `gi://Gda`) and Node.js (native).

**Features demonstrated:**
- `prepare().run()` for DDL (CREATE TABLE) and transaction control (BEGIN/COMMIT)
- Named parameter binding (`{ title, priority, done, created_at }`) via bare-name resolution
- `run()` returning `{ lastInsertRowid, changes }` for INSERT/UPDATE/DELETE
- `get()` for single-row queries (SELECT BY ID, COUNT)
- `all()` for multi-row queries with ORDER BY
- Prepared statement reuse across multiple calls
- Transaction-wrapped bulk insert
- File-based database in a temp directory (cleaned up after the demo)

Validates that the `@gjsify/sqlite` implementation handles the full CRUD cycle correctly on GJS: CREATE TABLE, INSERT, SELECT, UPDATE, DELETE, BEGIN/COMMIT all work. No core issues found — output is bit-identical between GJS and Node.js runs.

### feat(tests/browser) — browser tests for dom-elements and canvas2d-core (2026-04-28)

Extends the Playwright browser test infrastructure (from PR #42) to cover DOM packages:

- **`packages/dom/dom-elements/src/test.browser.mts`** (new): Browser tests using native browser globals covering Node tree operations, Element attributes, classList/DOMTokenList, HTMLElement properties (title, lang, hidden, tabIndex, draggable, contentEditable, on* handlers), Text/Comment/DocumentFragment, DOMMatrix (identity, 6/16-element init, multiply, inverse, translate, scale), CSSStyleDeclaration via `element.style`, FontFace/FontFaceSet, `window.matchMedia`.
- **`packages/dom/canvas2d-core/src/test.browser.mts`** (new): Browser tests using `document.createElement('canvas').getContext('2d')` covering clearRect (with transform/clip/globalAlpha/negative-width), save/restore state round-trips (fillStyle, strokeStyle, globalAlpha, globalCompositeOperation, lineWidth, lineCap, lineJoin, miterLimit, lineDash, font/textAlign/textBaseline, imageSmoothingEnabled), transforms (translate, scale, transform, setTransform, getTransform, DOMMatrix.multiply round-trip), ImageData (createImageData, getImageData, putImageData), text (measureText, fillText, strokeText), all 26 composite operations, drawImage (3/5/9-arg canvas-to-canvas), path operations (fillRect, arc, clip).
- **`tests/browser/scripts/discover-bundles.mjs`**: Extended to scan `packages/dom/*/dist/` in addition to `packages/web/*/dist/`. Total discovered bundles: 13 (11 web + 2 DOM).
- `build:test:browser` script added to both `packages/dom/dom-elements/package.json` and `packages/dom/canvas2d-core/package.json`.

GTK-only packages (`canvas2d` with Canvas2DBridge, `event-bridge` with attachEventControllers) are intentionally excluded — they have no browser equivalent.

### chore — extend native prebuilds to linux-ppc64, linux-s390x, linux-riscv64 (2026-04-28)

Added QEMU-based CI builds for three additional Linux architectures in `.github/workflows/prebuilds.yml`.

**New `build-prebuilds-qemu` job** uses `uraimo/run-on-arch-action@v2` on `ubuntu-latest` host runners with QEMU binary-format emulation:

- **`linux-ppc64`** (IBM POWER9/10) — `base_image: fedora:43` (official ppc64le manifest entry), same dnf packages as the native Fedora job. Targets Raptor Computing Talos II / Blackbird workstations running GNOME on Fedora.
- **`linux-s390x`** (IBM Z mainframes) — `base_image: fedora:43` (official s390x manifest entry), same dnf packages. Enterprise Linux server deployments.
- **`linux-riscv64`** (StarFive VisionFive 2, Milk-V Pioneer, SiFive HiFive, …) — `base_image: ubuntu:24.04` (fedora:43 has no riscv64 image), apt-get package equivalents. Auto-detected via `command -v dnf` in the `install:` block.

**Architecture → prebuilds dir** mapping relies on Node.js `process.arch` which already returns `'ppc64'`, `'s390x'`, `'riscv64'` for these platforms — the existing `nodeArchToLinuxArch()` in `packages/infra/cli/src/utils/detect-native-packages.ts` passes them through as-is, so no CLI changes were needed.

**`commit-prebuilds` job** updated to `needs: [build-prebuilds, build-prebuilds-qemu]` and downloads artifacts for all five architectures per package (15 download steps total across webgl, webrtc-native, http-soup-bridge).

Prebuilt `.so` + `.typelib` directories added: `prebuilds/linux-{ppc64,s390x,riscv64}/` in `@gjsify/webgl`, `@gjsify/webrtc-native`, `@gjsify/http-soup-bridge`. READMEs and STATUS.md updated to reflect the expanded platform matrix.

### chore — repo stability sweep (2026-04-28)

Three small fixes around the recent `@gjsify/http-soup-bridge` landing:

**CI: prebuilds workflow path correction.** `.github/workflows/prebuilds.yml` still pointed at `packages/dom/webgl`, but that package was moved to `packages/framework/webgl` in `319762fb1`. Every prebuild run on `main` was failing in the first `meson setup` step with `chdir to cwd packages/dom/webgl: no such file or directory`. Updated all path references (trigger paths, working-directory, artifact paths, commit-prebuilds add list) to `packages/framework/webgl`. The other two prebuild targets (`packages/web/webrtc-native`, `packages/node/http-soup-bridge`) were unaffected.

**Examples: `gjs -m` → `gjsify run` across all `examples/node/*`.** Once `@gjsify/http` started depending on the `GjsifyHttpSoupBridge-1.0` typelib, every example using `node:http` / Hono / Express / Koa / SSE / WebSocket needed `LD_LIBRARY_PATH` + `GI_TYPELIB_PATH` set to the prebuilds directory. `gjsify run` does that automatically; raw `gjs -m` does not. Migrated `start:gjs` (and `test:gjs` where present) in all 23 `examples/node/*` packages — both the directly-affected HTTP-stack examples (`gtk-http-dashboard`, `net-hono-rest`, `net-express-hello`, `net-koa-blog`, `net-sse-chat`, `net-ws-chat`, `net-static-file-server`) and the rest of the `cli-*` examples for consistency. Dashboard verified end-to-end: GTK window opens, HTTP server accepts requests, JSON responses round-trip.

**Tests: granular `/register` subpath migration.** `@gjsify/node-globals/register` is now genuinely opt-in (Step 3 of the split tracked in STATUS.md). The 9 per-package test entries in `packages/{node,web}/*/src/test.mts` and the 2 Autobahn driver bundles now import only the granular subpaths each test actually needs (`register/process` is universal for `@gjsify/unit`'s `process.env` / `process.exit` reads; the rest is per-package — `register/buffer`, `register/timers`, `register/url`, `register/microtask`, `register/structured-clone`). The two meta-package self-tests (`@gjsify/node-globals`, `@gjsify/web-globals`) keep the catch-all because they verify the entire register surface by design. Examples and integration suites (webtorrent, socket.io, streamx, mcp-typescript-sdk, mcp-inspector-cli) keep the catch-all — they're the legitimate "give me the full Node runtime surface" consumers (real third-party libraries pull in everything). Repo-wide `yarn check` clean; all migrated package tests green on Node + GJS.

### feat — `@gjsify/http-soup-bridge`: native Vala bridge for libsoup HTTP server (2026-04-27)

New native package + integration into `@gjsify/http`. Closes both libsoup-related entries from STATUS.md "Upstream GJS Patch Candidates" by moving the entire `Soup.Server` interaction into Vala-emitted C and exposing JS only through plain GObject classes. Same pattern as `@gjsify/webrtc-native` — see PR #44 for full context.

**The bridge package** (`packages/node/http-soup-bridge/`):

- `Server` (`src/vala/server.vala`) — wraps `Soup.Server` + `add_handler` + `add_websocket_handler`. Emits `request_received(req, res)` / `upgrade(req, iostream, head)` / `error_occurred(msg)` signals to JS.
- `Request` (`src/vala/request.vala`) — read-side snapshot. `method` / `url` / `header_pairs` / `remote_address` / `remote_port` are properties; `get_body()` is a method (a GIR-marshalled `uint8[]` property loses bytes through the round-trip).
- `Response` (`src/vala/response.vala`) — write side. Owns `SoupServerMessage` privately; all pause/unpause bookkeeping (the seven concerns previously in `SoupMessageLifecycle.ts`) move into Vala.
- `peer-close-watch.vala` — `g_socket_create_source(IN | HUP | ERR)` + non-blocking `g_socket_receive_message(MSG_PEEK)` for long-poll TCP-close detection. The capability we couldn't reach from JS (`Gio.Socket.receive_message` not introspectable, Linux POLLRDHUP not exposed in `IOCondition`).
- All cross-thread emissions hop through `GLib.Idle.add()` to the default main context before re-emission.

**`@gjsify/http` integration** (`packages/node/http/src/server.ts`):

- `Server` constructs a `BridgeServer`, wires `request-received` / `upgrade` / `error-occurred` signals into Node-style `'request'` / `'upgrade'` / `'error'` events.
- `ServerResponse` is a thin `Writable` over `BridgeResponse` — `set_header` / `write_head` / `write_chunk` / `end` delegate.
- `IncomingMessage` reads request fields from the bridge `Request` snapshot.
- `ServerRequestSocket` constructed from plain `string` / `uint` values rather than holding a `SoupServerMessage`.
- `soup-message-lifecycle.ts` deleted — its concerns are intrinsic to the bridge.
- All seven existing `@gjsify/http` test specs pass unchanged; 1038 GJS / 1034 Node tests green.

**Build / CI:**

- `meson` produces `libgjsifyhttpsoupbridge.so` + `GjsifyHttpSoupBridge-1.0.{gir,typelib}`.
- TS types bootstrapped locally via `ts-for-gir generate` until `@girs/gjsifyhttpsoupbridge-1.0` is published to npm.
- `.github/workflows/prebuilds.yml` extended with a `libsoup3-devel` install + matrix entry that produces `prebuilds/linux-{x86_64,aarch64}/` and auto-commits them on `main` pushes.

**Verification (local, Fedora 43, GJS 1.86 / libsoup 3.6.6):**

| Scenario | Pre-bridge | This change |
|---|---|---|
| Single Node.js fetch with chunked SSE → wait 30 s | 💥 SIGSEGV at ~13 s | ✅ alive |
| 50 sequential Node.js SSE fetches against the bridge alone | 💥 crash at ~5 | ✅ all 200, alive |
| `mcp-inspector-cli` sequential-call cap | 3 | 4 |
| Total tests on this branch | 1742 | 1788 |

**Known residual issue:** the example MCP server (which pulls MCP SDK + @hono/node-server + web-streams polyfill) still hits a deferred-GC SIGSEGV ~13 s after a Node-fetch SSE request. The crash signature (`BoxedBase::finalize → g_source_unref`) is the same shape as the original libsoup-side race, but the offending wrapper is no longer in our HTTP-server path — it's allocated by some Boxed-creating path in the MCP / Hono / streams stack. Tracked under STATUS.md "Open issues"; the fix needs a coredump with debug symbols to identify which Boxed type.



### refactor — `@gjsify/http`: consolidate Soup.ServerMessage lifecycle + fix MCP server crashes (2026-04-26)

Resolves the SIGSEGV that prevented MCP servers (and other Hono-based apps) from running on GJS. The fix landed across multiple files; the centerpiece is a new `SoupMessageLifecycle` helper that consolidates everything related to one in-flight Soup message: GC guard, `'finished'`/`'disconnected'` signal handling (translated to Node-style req/res `'close'`/`'aborted'` events), and `'wrote-chunk'`-driven re-unpause tracking via a unpause-ticket pattern (`consumeUnpauseTicket()`).

**Bug fixes** — these were the actual SIGSEGV causes:

- **GC use-after-free on `Soup.ServerMessage`**: After Hono drops its reference to `res`, SpiderMonkey GC was free to collect the JS wrapper around `_soupMsg` while Soup's IO was still touching it. The lifecycle helper now pins the GObject in a module-level `_activeMessages` Set until Soup signals `'finished'`.
- **Missing re-unpause on multi-chunk responses**: libsoup HTTP1 IO calls `soup_server_message_pause()` between chunks; without a matching `unpause()`, subsequent appended chunks (and the chunked terminator) were never sent. The `'wrote-chunk'` signal fires synchronously inside Soup's IO right before the auto-pause, so by the time JS resumes the unpause is safe and necessary.
- **Soup signals not propagated to req/res**: Frameworks that listen for `req.on('close')` (MCP SDK, engine.io, anything streaming) had no cleanup trigger. Now `'disconnected'` emits `'aborted'`+`'close'` on req and `'close'` on res; `'finished'` emits `'close'` on req for the normal completion path.
- **Async handler rejections swallowed by GLib's callback layer**: User-code `async (req, res) => { … }` rejections were lost as g_warnings — now caught and logged with a 500 fallback in `Server._handleRequest`.
- **`req.socket` was a plain object missing `destroySoon`**: Hono calls `socket.destroySoon()` after every response. New `ServerRequestSocket extends Duplex` provides a real `net.Socket` duck-type with `destroySoon`/`pause`/`resume`/`setNoDelay`/etc. — `pause/resume` now actually forward to the underlying Soup message so backpressure works.
- **`@gjsify/net.Socket.destroySoon()` was missing entirely**: added with a matching unit test.
- **`@gjsify/fetch` body wrapper raised inside the nextTick queue**: `controller.close()` would throw if the consumer cancelled; now guarded with a `closed` flag and try/catch (eliminates the constant `gjsify-nextTick-WARNING` spam during MCP responses).

**Refactor:**

- All defensive try/catch wrappers around Soup API calls in `_write`/`_final`/`_sendBatchResponse` removed — libsoup's GI-bound C API does not raise JS exceptions, so they were dead code. The async-handler catch in `_handleRequest` stays.
- `ServerResponse` is now thin: drops `_soupNeedsUnpause`/`_soupWroteChunkId`/etc., delegates everything via `_attachLifecycle()`.

**Examples:**

- `examples/node/net-mcp-server`: holds `McpServer` instances per session in a parallel `mcpServers` Map (was locally scoped inside the request handler — could be GC'd between requests, pulling down its underlying GLib sources). Resource URI changed from `info://server` to `info://server/meta` to work around a separate GJS URL-parsing quirk that adds a trailing slash to authority-only URIs.

**Tests:**

- New `tests/integration/mcp-typescript-sdk/streamable-http.spec.ts` cases: multiple sequential tool calls on a shared client, multiple per-session transports following the real-world pattern, raw HTTP fetch loop without MCP, forced `imports.system.gc()` between tool calls, inspector-style mixed workload.
- New `tests/integration/mcp-inspector-cli/` suite — drives the official `@modelcontextprotocol/inspector` CLI as a subprocess against both GJS and Node builds of the example MCP server. Catches regressions in the exact wire shape that produced the original crash. 14 tests (7 × 2 server targets).

**Known limitations (tracked in STATUS.md "Upstream GJS Patch Candidates"):**

1. *Long-poll/SSE peer-close not detected on paused messages.* libsoup stops polling the input stream while a server message is paused, so `'disconnected'` never fires for long-poll/SSE clients that hang up. `SoupMessageLifecycle` opts GET requests *out* of the GC guard so SpiderMonkey GC can eventually collect them, but the libsoup-side state accumulation still crashes the GJS process after ~5 hung long-polls. The inspector-CLI sequential-call test stays capped at 3 iterations.

2. *GJS Boxed-Source GC race for chunked responses to non-GJS HTTP clients.* A single `fetch()` from a Node.js process to our HTTP server with a chunked `text/event-stream` response causes a SIGSEGV ~10–13 s later (`gjs exited with code null`, no JS traceback). Backtrace: `BoxedBase::finalize → g_source_unref → assertion 'old_ref > 0' failed`. A libsoup-internal `GLib.Source` is exposed to JS without proper transfer ownership; GLib frees it when Soup completes the response, then GJS's deferred-GC heuristic (`g_timeout_add_seconds(10, …)`, `refs/gjs/gjs/context.cpp:873-906`) fires the JS finalizer which double-unrefs. **In-process MCP `client.callTool` does NOT trigger this** — the CI suite passes — but external HTTP clients (MCP Inspector subprocess, browser EventSource, raw `node -e 'fetch(…)'`) do. We attempted but rejected: eager `imports.system.gc()` after `'finished'` (corrupts shared keep-alive state when a sibling long-poll exists), idle-only GC gated on `_inFlightCount === 0` (paused long-polls keep count > 0 forever), forced `Connection: close` (no help), `condition_check(HUP|ERR)` watchdog (Linux POLLHUP only fires on bilateral close, not the typical client-side half-close), `Gio.Socket.receive_message(MSG_PEEK)` non-destructive probe (not introspectable from JS — `(out caller-allocates)` for `gint8[]` buffers is not bound). A real fix requires either a GJS GIR-bindings audit to identify and fix the offending transfer-mode annotation, or a libsoup patch moving chunked-write internals away from JS-visible Sources.

1742+ tests stay green on Node and GJS; new `mcp-inspector-cli` suite adds 14.

### feat — `@gjsify/http2`: compat layer + session API via Soup 3.0 (2026-04-25)

`http2.createServer()`, `http2.createSecureServer()`, `http2.connect()` are now functional instead of throwing.

**Server (Soup.Server-backed):**
- `createServer(handler)` → `Http2Server` — Soup.Server on plain TCP (HTTP/1.1, no h2c)
- `createSecureServer({ cert, key }, handler)` → `Http2SecureServer` — Soup.Server with TLS; auto-advertises `h2` via ALPN, falls back to HTTP/1.1
- Server emits both `'request'` (compat API: `(Http2ServerRequest, Http2ServerResponse)`) and `'stream'` (session API: `(ServerHttp2Stream, headers)`) on each request
- `Http2ServerRequest` extends `Readable` — method, url, headers, raw body stream
- `Http2ServerResponse` extends `Writable` — writeHead, setHeader, write, end, respond (session alias)
- `ServerHttp2Stream` — facade over response, exposes `respond(headers)`, `write()`, `end()`

**Client (Soup.Session-backed):**
- `connect(authority, options)` → `ClientHttp2Session` — wraps Soup.Session; over HTTPS auto-upgrades to HTTP/2 via ALPN
- `session.request(headers, { endStream })` → `ClientHttp2Stream` — Duplex: writable = request body, readable = response body; emits `'response'` event with response headers

**Phase 1 limitations** (documented in source): no `pushStream`, no stream IDs, no explicit flow control/priority (all Soup-internal). `createServer()` serves HTTP/1.1 only (Soup has no h2c support). Phase 2 requires a Vala/nghttp2 native extension.

**Tests:** 128 total (102 Node + 26 new GJS integration tests). Codebase refactored into `src/protocol.ts` (constants), `src/server.ts`, `src/client-session.ts`, `src/index.ts`.

### feat — `createWebSocketStream` + socket.io WebSocket transport (2026-04-24)

**`createWebSocketStream(ws, options)`** — wraps any `ws`-shaped WebSocket (client or server-side) in a Node.js `Duplex` stream. Text frames are converted to `Buffer` before being pushed into the readable side (non-objectMode). Backpressure: `ws.pause()` / `ws.resume()` are called if present. `_final` sends a close frame and waits for the corresponding 'close' event before completing. `_destroy` calls `ws.terminate()` for immediate teardown. 3 new GJS tests (echo via pipe, EOF on client close, write → message). 43 GJS / 19 Node tests total.

**socket.io examples** — `cli-socket.io-chat-server` and `cli-socket.io-pingpong` both remove the `transports: ['polling']` override. Engine.io now uses our `{ noServer: true }` + `handleUpgrade()` to upgrade browser connections to WebSocket automatically (confirmed via DevTools: 101 Switching Protocols visible). Added READMEs for both examples and for `net-ws-server`. Bug fix: removed spurious double `'connection'` emission from `_completeUpgrade` (caller's callback is now the sole emitter).

### feat — WebSocket server Phase 3: `{ noServer: true }` + `handleUpgrade()` + `'headers'` event (2026-04-24)

Completes the standard engine.io / socket.io integration pattern for `@gjsify/ws` `WebSocketServer`.

**`{ noServer: true }`** — Constructor no longer throws. In this mode no `Soup.Server` is created and no port is bound. The caller owns an `http.Server`, listens on the `'upgrade'` event, and passes the raw request + socket + head to `handleUpgrade()`. Mutually exclusive with `port` and `server`.

**`handleUpgrade(req, socket, head, cb)`** — Full manual upgrade implementation:
1. Validates request headers (method=GET, Upgrade=websocket, Sec-WebSocket-Key format, Sec-WebSocket-Version 13/8, path via `shouldHandle`). Rejects with HTTP 4xx via `socket.write` + `socket.destroy` on any failure.
2. Runs `verifyClient` (sync or async) if configured — 401 abort on rejection.
3. Computes `Sec-WebSocket-Accept` via SHA-1 + GUID (`@gjsify/crypto` `createHash('sha1')`).
4. Runs `handleProtocols` if configured — appends `Sec-WebSocket-Protocol` to response headers. **Unlike the Soup path, the client now sees the correct subprotocol** because we write the 101 ourselves (resolves the Phase 2 client-visible protocol limitation).
5. Emits `'headers'` (mutable `string[]`) — listeners may push additional response headers (e.g. `Set-Cookie`).
6. Writes the 101 response via `socket.write()`.
7. Calls `socket._releaseIOStream()` to hand the raw `Gio.IOStream` to `Soup.WebsocketConnection['new']()`. Wraps in `ServerSideWebSocket`, tracks in `clients`, emits `'connection'`, calls `cb(ws, req)`.

**`'headers'` event** — Mutable `string[]` emitted before every 101 write in the `handleUpgrade` path. Enables engine.io / socket.io to inject `Set-Cookie` and other headers.

**`_attachOutputOnly` in `@gjsify/net` `Socket`** — New internal method used by `http.Server._handleRequest` in the upgrade path instead of `_setupFromIOStream`. Sets up write capability and address info from the `Gio.IOStream` but does NOT start the async read loop, eliminating a fatal race where both the `NetSocket` read loop and `Soup.WebsocketConnection` would consume the same input stream.

**`_releaseIOStream` in `@gjsify/net` `Socket`** — Transfers `Gio.IOStream` ownership to the caller. The socket's references are nulled so it does not close the stream when garbage-collected or destroyed.

5 new tests added to `packages/node/ws/src/index.spec.ts` (updated stale "noServer throws" → "noServer accepted" + "noServer+port throws"). 4 new tests in `websocket-server.spec.ts` (GJS-only): echo via handleUpgrade, verifyClient reject via handleUpgrade, handleProtocols client-visible via handleUpgrade, 'headers' event. **40 GJS tests total** (up from 35), 18 Node tests unchanged.

### feat — WebSocket server hooks Phase 2: `verifyClient`, `handleProtocols`, `{ server }` (2026-04-24)

Adds server-side access control, subprotocol negotiation, and shared-port mode to `@gjsify/ws` `WebSocketServer`.

**`verifyClient`** — HTTP-level access control before the WebSocket upgrade is accepted. Implemented via Soup's handler ordering: `add_handler` fires before `add_websocket_handler` for the same path; setting a status code in the HTTP handler prevents the websocket handler from firing. Supports both the synchronous `(info) => boolean` form and the asynchronous `(info, callback)` form (detected by `fn.length >= 2`). Async uses `msg.pause()` / `msg.unpause()` so the GLib event loop continues running during the callback. The `info` object is fully populated: `origin`, `secure`, `req.method`, `req.url`, `req.headers`, `req.socket.remoteAddress`.

**`handleProtocols`** — Subprotocol selection after a connection is accepted. The callback receives a `Set<string>` of client-offered protocols and the request object; the return value is stored on the server-side `ws.protocol`. **Known limitation (Phase 3):** Soup commits the 101 response before `add_websocket_handler` fires, so the `Sec-WebSocket-Protocol` response header is already sent — client-visible protocol selection requires manual handshake via `handleUpgrade()` (out of scope for Phase 2).

**`{ server: existingHttpServer }`** — Attach a `WebSocketServer` to an existing `@gjsify/http` `Server` instead of creating its own `Soup.Server`. The http.Server exposes a new `get soupServer(): Soup.Server | null` getter that `WebSocketServer` uses to register `add_websocket_handler` (+ optionally `add_handler` for `verifyClient`) on the shared server. The caller controls `listen()`; `WebSocketServer` emits `'listening'` immediately (synchronous, via `queueMicrotask`).

**`_handleRequest` fix in `@gjsify/http`** — WebSocket upgrade requests that have no `'upgrade'` listener on the http.Server were previously paused and emitted as `'request'`, starving any `add_websocket_handler` registered on the same `Soup.Server`. The fix: return early for all `Connection: upgrade` + `Upgrade: websocket` requests, regardless of listener count. If an `'upgrade'` listener exists, it gets the stolen IOStream as before; otherwise Soup continues to the websocket handler transparently.

12 new tests added to `packages/node/ws/src/websocket-server.spec.ts` (all GJS-only): verifyClient sync reject/accept, verifyClient async reject/accept, verifyClient info fields, handleProtocols subprotocol selection, and `{ server }` shared-port echo. 35 GJS tests total (up from 23), 18 Node tests unchanged.

### feat — WebSocket client options: `headers`, `origin`, `handshakeTimeout` (2026-04-24)

Implements three commonly-used npm `ws` client options in `@gjsify/websocket` and forwards them through `@gjsify/ws`.

**`options.headers`** — Extra HTTP headers sent with the WebSocket upgrade request (e.g. `Cookie`, `Authorization`). Wired into `Soup.Message.get_request_headers()` before `websocket_connect_async` using `replace()` for single values and `append()` for array values.

**`options.origin`** — Sets the HTTP `Origin` header by passing the value as the second argument to `websocket_connect_async` (was hardcoded `null`).

**`options.handshakeTimeout`** — Aborts the opening handshake after N milliseconds. Implemented via `Gio.Cancellable`: a `setTimeout` fires after the deadline, sets a `_handshakeTimedOut` flag and calls `cancellable.cancel()`; in the async callback, the catch block checks the flag and emits an error with message `"Opening handshake has timed out"` (matching npm `ws` behavior exactly). The error event carries both `.error` (an `Error` instance) and `.message` so the `@gjsify/ws` wrapper surfaces a typed `Error` to its `EventEmitter` listeners.

Error events from connection failures now carry `.error` and `.message` properties so wrapper layers can extract a typed `Error` regardless of the failure mode.

3 new tests added to `packages/web/websocket/src/index.spec.ts` — headers, origin, and handshakeTimeout all verified end-to-end against real Soup.Server / Gio.SocketService listeners. 31 tests total, all passing.

### feat — Autobahn 9.* performance suite enabled (2026-04-24)

Removes the `9.*` exclusion from `tests/integration/autobahn/config/fuzzingserver.json`, completing the full RFC 6455 test matrix. The performance suite covers large-payload throughput: single frames up to 16 MB (9.1.*/9.2.*), fragmented large messages (9.3.*/9.4.*), high-frequency messaging up to 1 M messages × 2 KB (9.5.*/9.6.*), sleep/send timing (9.7.*), and slow-consumer scenarios (9.8.*). Approximately 46 additional cases per agent; expect a full run to take 30–90 min locally.

Driver case-timeout raised from 60 s → **480 s** to match Autobahn's own server-side ceiling. The previous 60 s was calibrated for the deflate cases (12.*); the 9.5.* throughput cases at maximum scale may legitimately need several minutes on the GLib event loop. No code changes to `@gjsify/websocket` or `@gjsify/ws` — pure test-coverage expansion.

Root-cause fix landed alongside: `Soup.WebsocketConnection` has a built-in default limit of 128 KB per incoming frame — any frame larger causes Soup to silently drop the connection. All 28 initially-FAILED 9.* cases (frames ≥ 256 KB) were caused by this limit. Fix: set `max_incoming_payload_size = 100 MB` immediately after `websocket_connect_finish()`, matching the npm `ws` package's default `maxPayload`. All 54 Autobahn 9.* cases now pass: **510 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** over 517 total cases per agent.

### feat — `@gjsify/websocket` permessage-deflate + Autobahn baseline expansion (2026-04-23)

Lands every remaining baseline-visible follow-up from PR #30 (Autobahn pillar) in one PR. Both agent drivers now score **456 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** against the full 463-case suite — up from `240 OK` over 247 cases in the initial Autobahn baseline.

**Shipped code changes:**

- **`@gjsify/websocket` negotiates permessage-deflate (RFC 7692).** The Soup docs claim a `WebsocketExtensionManager` ships in every `Soup.Session` by default, but in practice `new Soup.Session()` comes without one — so we never advertised `Sec-WebSocket-Extensions` and Autobahn reported every `12.*` / `13.*` case `UNIMPLEMENTED`. Fix: in the `WebSocket` constructor, explicitly `Session.add_feature_by_type(Soup.WebsocketExtensionManager.$gtype)` followed by `Session.add_feature_by_type(Soup.WebsocketExtensionDeflate.$gtype)`. Adding deflate without the manager triggers a runtime warning (`No feature manager for feature of type 'SoupWebsocketExtensionDeflate'`). Browsers always offer deflate — we match that unconditionally (no opt-out today). **216 previously-UNIMPLEMENTED deflate cases → OK.**
- **`WebSocket.extensions` now reflects the server-accepted extensions** (was hardcoded `''`). After `websocket_connect_finish` succeeds we call `get_extensions()` on the `Soup.WebsocketConnection` and serialize each `Soup.WebsocketExtension` to the `Sec-WebSocket-Extensions` response-header format (e.g. `"permessage-deflate"` or `"permessage-deflate; client_max_window_bits=15"`). The extension spec name isn't exposed on the JS object (class-level C field, not marshaled over GI), so we `instanceof`-check `Soup.WebsocketExtensionDeflate` and fall back to the stripped GType name for any third-party extension. Real W3C spec bug, surfaced by turning on deflate tests.
- **`tests/integration/autobahn/config/fuzzingserver.json` no longer excludes `12.*` / `13.*`.** Performance suite `9.*` remained excluded at this point — enabled in the follow-up PR.
- **Autobahn driver case-timeout bumped 10 s → 60 s.** The largest deflate cases (12.2.10+, 12.3.10+, 12.5.17 — 1000 × 131 072-byte messages, ~128 MB roundtrip) legitimately need 10–30 s; matches Autobahn's own server-side timeout.
- **`tests/integration/autobahn/scripts/run-driver.mjs` watchdog.** `System.exit(0)` from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (see STATUS.md Open TODOs for the isolation status of that bypass). The wrapper tails the log, waits for the `Done.` marker, grants a 3 s grace window, then `SIGKILL`s. Report is on disk before `Done.` is printed, so no data loss. Temporary — removed once the exit-bypass root cause is fixed.
- **Refreshed baselines** in `reports/baseline/gjsify-websocket.json` + `gjsify-ws.json` reflect the 216 new OK cases. Run diff vs. the old baseline is pure improvement (no regressions, no new missings).

**6.4.x documented as upstream libsoup gap.** The 4 NON-STRICT fragmented-text-with-invalid-UTF-8 cases stay NON-STRICT: `Soup.WebsocketConnection` only surfaces the coalesced `message` signal (no `frame`/`fragment` signal over GI), so validation can only run at end-of-message — RFC-correct close code 1007 but "late" by Autobahn's fast-fail definition. Added to STATUS.md "Upstream GJS Patch Candidates" with the proposed libsoup change (per-frame `incoming-fragment` signal or opt-in per-fragment validation mode on `SoupWebsocketConnection`).

### fix — Excalibur Jelly Jumper showcase startup crash (2026-04-21)

**Root cause:** Our `@gjsify/fetch` `XMLHttpRequest` ignored `responseType` and always returned the body as a string. Excalibur sets `responseType = 'arraybuffer'` for audio and `'blob'` for images, then feeds the (string) "arraybuffer" into `AudioContext.decodeAudioData`. Our webaudio decoder wraps the input in a `Uint8Array` and hands it to `Gst.Buffer.new_wrapped`; `new Uint8Array('')` is length 0, which marshals to a `NULL` data pointer and trips the `gst_memory_new_wrapped: assertion 'data != NULL' failed` critical — killing the GJS process before the game loop ran.

**Fix (bundled):**

- **`@gjsify/fetch` `XMLHttpRequest`** (`packages/web/fetch/src/xhr.ts`) now honours the spec: `arraybuffer` → real `ArrayBuffer`, `blob` → `Blob` with the body materialised to a GLib temp file and `_tmpPath` attached, `json` → parsed JSON, `text`/`''`/`document` → decoded text.
- **`URL.createObjectURL` / `URL.revokeObjectURL` are first-class static methods on `@gjsify/url`'s URL class** (`packages/node/url/src/index.ts`). `createObjectURL(blob)` reads `blob._tmpPath` and returns `file://<tmpPath>`; `revokeObjectURL(url)` unlinks the temp file. No more monkey-patching the URL class from `register/xhr.ts` — the API belongs to the package that owns URL.
- **`@gjsify/webaudio` decoder guard** (`packages/web/webaudio/src/gst-decoder.ts`) — reject non-ArrayBuffer / zero-byte input with `DOMException('Unable to decode audio data', 'EncodingError')` before touching GStreamer, so downstream consumers that hand us malformed buffers get a spec-compliant error instead of a process-killing critical.
- **Regression test** in `packages/web/fetch/src/index.spec.ts` — 4 new cases covering `responseType=arraybuffer|blob|text|''`, `_tmpPath` attachment, and the `URL.createObjectURL` → `file://` round-trip (all under `on('Gjs', …)` since Node has no native XHR).

**Review-driven cleanup — "imports over `globalThis`" pass:**

- **New `AGENTS.md` rule "Don't patch — implement at the source".** We own implementations of almost every Web / Node / DOM API surface; when a method is missing, the first question is which of our classes should own it — not where to monkey-patch it. `globalThis` reads in implementation code are now explicitly restricted to register-module writes, existence probes, env-var-like debug flags, GJS bootstrap, and genuinely soft deps.
- **`packages/web/fetch/globals.mjs` removed.** Node natively exposes `fetch`/`Headers`/`Request`/`Response`/`FormData` as globals (Node 18+); re-exporting them through an alias module only added friction. Specs read these off `globalThis`, matching the Node-native pattern. On GJS the same identifiers come from `@gjsify/fetch/register`. The `'fetch': '@gjsify/fetch/globals'` alias in `ALIASES_WEB_FOR_NODE` is gone.
- **`@gjsify/webrtc` DOMException / Blob reads** (`rtc-peer-connection.ts`, `rtc-data-channel.ts`) now import `DOMException` from `@gjsify/dom-exception` and `Blob` from `@gjsify/buffer` instead of reading `(globalThis as any).X`. 8 `DOMException` call sites and the `Blob` instanceof + constructor sites collapse to plain typed code; the `if (DOMExc) new DOMExc(…) else new Error(…)` fallbacks become dead code. `@gjsify/buffer` added as a hard dep of `@gjsify/webrtc`.
- **`URL.createObjectURL` method marker removed** from `packages/infra/esbuild-plugin-gjsify/src/utils/detect-free-globals.ts` — it was needed when `createObjectURL` lived in the XHR register module, but now that it's a static method on the URL class, the free `URL` identifier (already in `GJS_GLOBALS_MAP`) already pulls in the right register path.

### 🧪 Integration tests — streamx on GJS (2026-04-20)

**`tests/integration/streamx/`** — 6 spec files (155 Node + 156 GJS tests) ported from `refs/streamx/test/` plus a new `throughput.spec.ts`. All green on both runtimes.

- **`readable.spec.ts`** — Readable push/pause/resume/from/setEncoding/isDisturbed (24 tests)
- **`writable.spec.ts`** — write/drain/writev/cork/drained-helper (10 tests)
- **`transform.spec.ts`** — Transform teardown + PassThrough pipe (2 tests)
- **`pipeline.spec.ts`** — pipeline/pipelinePromise + error propagation (5 tests)
- **`duplex.spec.ts`** — Duplex open/map/readable/destroy (5 tests)
- **`throughput.spec.ts`** — queueMicrotask injection, 100-chunk no-loss, pipeline byte preservation, Duplex echo, timing (6 tests on GJS)

**Root cause identified for webtorrent-player 0 B/s symptom:** streamx falls back to `process.nextTick` if `queueMicrotask` is not defined globally. On GJS, `process.nextTick` routes through `GLib.idle_add(PRIORITY_HIGH_IDLE)`, which fires much later in the event loop than a true microtask. `queueMicrotask` is now injected via `@gjsify/node-globals/register/microtask` (auto-detected by the build system). The throughput GJS-only test confirms injection works and all pipeline operations complete in < 1 s.

### fix — `@gjsify/web-streams` pipeTo scheduling (2026-04-20)

`packages/web/streams/src/readable-stream.ts` was importing `nextTick as _queueMicrotask` from `@gjsify/utils`. On GJS, `nextTick` routes through `GLib.idle_add`, which requires a running GLib main loop to fire. Test suites using `async/await` without a GTK application loop never drain the GLib idle queue, causing `pipeThrough` and `TextEncoderStream + TextDecoderStream` round-trips to stall. Fixed by importing `queueMicrotask` (always `Promise.resolve().then()`) instead. Fixes 7 CI failures.

### 🧪 Integration tests — socket.io on GJS (2026-04-20)

**`tests/integration/socket.io/`** — 3 test suites ported from socket.io v4 upstream into `@gjsify/unit` style. **Node: 20/20 green. GJS: 20/20 green, 0 skips.**

- **`handshake.spec.ts`** — CORS OPTIONS/GET headers, `allowRequest` accept/reject (4 tests)
- **`socket-middleware.spec.ts`** — `socket.use()` middleware chain, error propagation (2 tests)
- **`socket-timeout.spec.ts`** — `socket.timeout().emit()` ack timeout, `emitWithAck()` with/without ack (4 tests)

Transport: polling only (`transports: ['polling']`). WebSocket transport requires a server-side `ws` shim and is deferred.

### Root-cause fixes uncovered by the socket.io port (bundled)

- **`@gjsify/fetch` POST body never sent** — `Request._send()` in `packages/web/fetch/src/request.ts` never attached the request body to the `Soup.Message`. Added `_rawBodyBuffer` getter to `Body` class (reads directly from `Body[INTERNALS].body` without draining the stream) and call `message.set_request_body_from_bytes(null, new GLib.Bytes(rawBuf))` in `_send()`. Previously, accessing the `.body` getter triggered streaming mode and drained the buffer before `_send()` read it.
- **`IncomingMessage` wrongly emitted `'close'` after body stream ends** — engine.io registers `req.on('close', onClose)` to detect premature TCP disconnection during long-poll. Our `Readable` base was auto-emitting `'close'` after `'end'` (matching `autoDestroy` behavior), which engine.io misinterpreted as a dropped connection, sending a `CLOSE` packet and killing the session. Fix: added `_autoClose()` protected hook to `Readable` (in `packages/node/stream/`) that emits `'close'` by default, and overrode it in `IncomingMessage` (in `packages/node/http/`) to be a no-op — `'close'` now only fires via `destroy()`, matching Node.js HTTP semantics.
- **`EventEmitter.prototype` methods were non-enumerable** — Socket.io v4 builds `Server` → Namespace proxy methods by iterating `Object.keys(EventEmitter.prototype)`. ES class methods are non-enumerable by default, so `Object.keys` returned `[]` and no proxy was created. `io.on('connection', handler)` attached to the Server's own EventEmitter instead of the default namespace, so the `connection` event (fired by `namespace._doConnect`) never reached the handler. Fix: after the class declaration in `packages/node/events/src/event-emitter.ts`, `Object.defineProperty` re-declares all 15 public instance methods as `enumerable: true`, matching Node.js's prototype-assignment style.

### 🧪 Integration tests — webtorrent on GJS (2026-04-20)

New `tests/integration/` pillar that runs curated upstream tests from popular npm packages against `@gjsify/*` implementations — validating the stack end-to-end in a real consumer. **Node: 185/185 green. GJS: 185/185 green, 0 skips.**

- **`tests/integration/webtorrent/`** — 7 test files ported from `refs/webtorrent/test/` into `@gjsify/unit` style: `selections`, `client-destroy`, `client-add`, `rarity-map`, `bitfield`, `file-buffer`, `iterator`. Fixtures (leaves.torrent, alice, numbers, …) copied from the `webtorrent-fixtures` npm dep at build time; parsed locally via `parse-torrent`.
- **New root scripts:** `yarn test:integration`, `yarn test:integration:node`, `yarn test:integration:gjs`. Not part of `yarn test` — opt-in target.
- **Port convention** documented in `AGENTS.md` `## References → Integration Tests` and `tests/integration/README.md`: manual rewrite into `@gjsify/unit` style (no `@gjsify/test-compat` shim until a second test-runner dialect lands).

### Root-cause fixes uncovered by the webtorrent port (bundled into this PR)

Per `AGENTS.md`'s strengthened **Root-cause fixes beat scope discipline** rule — integration gaps get fixed in the PR that surfaced them, not deferred.

- **`@gjsify/fs` now accepts `URL` path arguments** across every public entry point (`readFileSync`, `readFile`, `writeFile`, `stat`, `lstat`, `readdirSync`, `realpathSync`, `symlinkSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `accessSync`, `appendFileSync`, `readlinkSync`, `linkSync`, `truncateSync`, `chmodSync`, `chownSync`, `rmdirSync`, `rmSync`, `mkdirSync`, `promises.*`, `FSWatcher`, `ReadStream`, `FileHandle`, `watch`). New `normalizePath` helper in `packages/node/fs/src/utils.ts`. Closes the "Expected type string for argument 'path'" crash on `new URL('file:///…')` arguments. **494 fs tests green** on both runtimes.
- **ESM builds no longer pull CJS entries through the `require` condition.** `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` previously included `require` in its conditions list even for ESM format. esbuild picks the first matching condition in an exports-map's declared order; packages like `bitfield` that list `"require"` before `"import"` silently routed through the CJS entry, got wrapped by `__toESM(mod, 1)` into `{ default: { __esModule: true, default: X } }`, and threw `is not a constructor` at runtime. Matches Node's own ESM resolution: the `require` condition is never applied in ESM mode.
- **`random-access-file` browser stub aliased to its Node entry.** `packages/infra/resolve-npm/lib/index.mjs` `ALIASES_GENERAL_FOR_GJS` now maps `random-access-file` → `random-access-file/index.js`. The package's `browser` field points at a stub that unconditionally throws "random-access-file is not supported in the browser"; esbuild's `browser` mainField precedence otherwise silently routed to it, silently stalling every `client.seed(Buffer)` call through fs-chunk-store. GJS has a working `fs`, so the real implementation works out of the box.

### AGENTS.md — strengthened root-cause principle

New paragraph **Root-cause fixes beat scope discipline**: integration gaps get fixed in the PR that surfaces them, not deferred. Workarounds + TODOs rot; bundled root-cause fixes keep history coherent. Documented narrow exceptions (non-standard Node internals, upstream-GJS blockers, genuinely cross-cutting rewrites). Long-term goal: `@gjsify/*` wrappers that run arbitrary npm packages **out of the box**.

## [0.1.15](https://github.com/gjsify/gjsify/compare/v0.1.14...v0.1.15) (2026-04-17)

### Bug Fixes

* **ci:** add `git pull --rebase` before prebuild push to prevent race-condition rejection when multiple CI jobs write to `main` concurrently
* **webrtc-native:** ship missing aarch64 prebuilds (`libgjsifywebrtc.so` + `GjsifyWebrtc-0.1.typelib`) — `@gjsify/webrtc` now works on ARM Linux out of the box

## [0.1.14](https://github.com/gjsify/gjsify/compare/v0.1.13...v0.1.14) (2026-04-17)

### 🚀 WebRTC lands on GJS — real-time P2P, right in your GNOME app

This is the release we've been building toward. **`@gjsify/webrtc`** brings the full W3C WebRTC API to GJS, backed by GStreamer's battle-tested `webrtcbin` pipeline. For the first time, you can open peer connections, exchange data, stream audio/video, and seed torrents — all from a native GNOME application written in TypeScript. No browser required.

#### What's included

**Complete W3C surface** — `RTCPeerConnection`, `RTCDataChannel`, `RTCRtpSender/Receiver/Transceiver`, `MediaStream`, `MediaStreamTrack`, `RTCSessionDescription`, `RTCIceCandidate`, `RTCCertificate`, `RTCDTMFSender`, `RTCStatsReport` and all their events. The API is spec-compliant: ICE trickle, offer/answer state machine, `negotiationneeded`, rollback — it all works.

**GStreamer media pipeline** — `getUserMedia({ audio: true, video: true })` hooks into real hardware via PipeWire → PulseAudio → GStreamer fallback chain. `addTrack()` builds a full encoder chain (VP8/Opus → RTP payloaders → webrtcbin sink pads) automatically. Incoming tracks fire the `track` event and transition from muted to unmuted when media flows.

**Cross-pipeline architecture** — the `VideoBridge` (GTK `Gtk.Picture` + `gtk4paintablesink`) and the WebRTC sender can share the same camera source safely via an automatic `tee` branch — no "pipelines don't share a common ancestor" GStreamer warnings, no pipeline stalls.

**DTMF** — `RTCDTMFSender.insertDTMF()` sends tones over audio tracks, with `tonechange` events firing for each digit.

**WebTorrent on GJS** — because WebRTC data channels are first-class, WebTorrent works end-to-end: peer discovery via WebSocket trackers, chunk exchange via RTCDataChannel, multi-file downloads with progress and SHA1 verification. See the `webtorrent-download` and `webtorrent-stream` examples.

**Zero config for consumers** — `gjsify build --globals auto` detects `RTCPeerConnection`, `RTCDataChannel`, etc. in your bundle and injects the right register modules automatically. No `--globals` flag, no source-level register import needed.

**302 tests** — a comprehensive suite ported from the W3C WPT test suite and the MDN samples covering the full lifecycle: data channels, offer/answer, ICE, media tracks, DTMF, RTP parameters, negotiationneeded, rollback, stats.

#### New examples

| Example | What it shows |
|---------|--------------|
| `webrtc-loopback` | Two local peers, data channel echo, string + binary |
| `webrtc-video` | Live webcam preview via `getUserMedia` + `VideoBridge` |
| `webrtc-trickle-ice` | ICE candidate gathering — collect and print all candidate types |
| `webrtc-dtmf` | Audio loopback with DTMF tone insertion and `tonechange` logging |
| `webrtc-states` | Adwaita GUI monitoring signaling/ICE/connection state transitions live |
| `webtorrent-download` | Multi-file torrent download with per-file progress and verification |
| `webtorrent-stream` | Chunk-by-chunk torrent streaming via WebRTC data channels |

#### Under the hood

The native `@gjsify/webrtc-native` Vala bridge solves GJS's streaming-thread restriction: GStreamer fires `on-ice-candidate`, `on-data-channel`, and pad signals on a C thread that GJS cannot enter. The bridge captures these on the C side and re-dispatches them via `GLib.Idle.add()` on the main context — making the async handshake safe without any polling.

---

* **webrtc:** W3C WebRTC API — Phase 1–4 complete (data channel + media + outgoing pipeline + DTMF) ([#23](https://github.com/gjsify/gjsify/issues/23)) ([3ff1df6](https://github.com/gjsify/gjsify/commit/3ff1df6cda08a34a97a13c2a8c2e17068e250bf7))

## [0.1.13](https://github.com/gjsify/gjsify/compare/v0.1.12...v0.1.13) (2026-04-16)

### Features

* **infra:** lower CSS Nesting for GTK4 via esbuild target=firefox60 ([#22](https://github.com/gjsify/gjsify/issues/22)) ([3c946c3](https://github.com/gjsify/gjsify/commit/3c946c35392af475fd1c539bf3734695073381af))

## [0.1.12](https://github.com/gjsify/gjsify/compare/v0.1.11...v0.1.12) (2026-04-16)

### Features

* **infra:** @gjsify/esbuild-plugin-css — resolve CSS [@import](https://github.com/import) at build time ([#21](https://github.com/gjsify/gjsify/issues/21)) ([812276a](https://github.com/gjsify/gjsify/commit/812276a32c9f2b659a63eef242a6236346feeee9))

## [0.1.11](https://github.com/gjsify/gjsify/compare/v0.1.10...v0.1.11) (2026-04-15)

### Features

* **cli:** GJS app packaging — --shebang + gresource + gettext ([#18](https://github.com/gjsify/gjsify/issues/18)) ([fe267c4](https://github.com/gjsify/gjsify/commit/fe267c41596cb22385cbab3a24c1b08a4747160d))
* **create-app:** multi-template scaffolding with 7 starter templates ([#16](https://github.com/gjsify/gjsify/issues/16)) ([7a97c8f](https://github.com/gjsify/gjsify/commit/7a97c8f5009059bddb4e2c8934de122f3e092701))
* **examples:** update start script to use 'yarn start:gjs' ([2ddecca](https://github.com/gjsify/gjsify/commit/2ddeccaed242328b5107b9f8091252443ac95e6d))

### Bug Fixes

* **dom,event-bridge:** close input gaps surfaced by Excalibur in GJS ([#17](https://github.com/gjsify/gjsify/issues/17)) ([f9f01da](https://github.com/gjsify/gjsify/commit/f9f01da2ab18871158738762a52ba8639708304c))

## Unreleased

### Features

* **dom:** Unified GTK-DOM Bridge Architecture — renamed all widget containers to bridges (`Canvas2DWidget`→`Canvas2DBridge`, `CanvasWebGLWidget`→`WebGLBridge`, `IFrameWidget`→`IFrameBridge`). New `@gjsify/bridge-types` package with shared `DOMBridgeContainer` interface and `BridgeEnvironment` (isolated document/body/window per bridge). New `@gjsify/video` package: `VideoBridge` renders `HTMLVideoElement` via `Gtk.Picture` + GStreamer `gtk4paintablesink`, supports `video.srcObject = mediaStream` (getUserMedia/WebRTC) and `video.src` (URI playback via playbin). New `HTMLMediaElement` and `HTMLVideoElement` in `@gjsify/dom-elements`. New `examples/dom/webrtc-video` example: webcam preview via VideoBridge. Long-term vision (deferred): universal DOM container where `document.createElement("canvas")` auto-creates the right GTK widget

* **webrtc:** Phase 3 — Outgoing media pipeline + `getUserMedia`. `RTCPeerConnection.addTrack(track)` wires a GStreamer encoder chain (source → valve → audioconvert/videoconvert → opusenc/vp8enc → rtpopuspay/rtpvp8pay → capsfilter → webrtcbin sink pad) using `request_pad_simple` to create the transceiver and sink pad in one step (avoids the double-transceiver problem with `emit('add-transceiver')` + `request_pad_simple`). `getUserMedia({ audio, video })` wraps GStreamer sources (pipewiresrc → pulsesrc → autoaudiosrc → audiotestsrc fallback) as `MediaStreamTrack` instances with `_gstSource` backing. `MediaDevices` class with `enumerateDevices` (stub) and `getSupportedConstraints`. `navigator.mediaDevices` registered via `@gjsify/webrtc/register/media-devices`. `MediaStreamTrack` extended with GStreamer integration: `enabled` → valve `drop` property, `stop()` → NULL + pipeline cleanup, `_setEnableCallback` for sender control. `RTCRtpSender._wirePipeline` builds explicit encoder chains entirely on the main thread (no Vala bridge needed). `RTCRtpSender.replaceTrack` with atomic source swap. `capsfilter` with RTP caps ensures `createOffer` generates `m=audio`/`m=video` lines immediately without waiting for data flow. End-to-end test verified: pcA sends getUserMedia audio → pcB receives track event, track unmutes. 26 new tests (total: 229). Single-PC-per-track limitation for v1. Continues [#14](https://github.com/gjsify/gjsify/issues/14).
* **webrtc:** Phase 2.5 — Incoming media pipeline via new `ReceiverBridge` Vala class. The bridge manages the muted source → decodebin → tee switching entirely in C (decodebin's `pad-added` fires on GStreamer's streaming thread, which GJS blocks). `RTCRtpReceiver._connectToPad` wires webrtcbin's output pad through the bridge; when decoded media replaces the muted source, the bridge emits `media-flowing` on the main thread and the track transitions from muted to unmuted. `RTCPeerConnection.close()` disposes all receiver bridges. 5 new tests (total: 203). Full muted→unmuted transition requires actual media flowing (getUserMedia / addTrack, deferred to Phase 3).
* **webrtc:** Phase 2 — Media API surface. Adds `RTCRtpTransceiver` (wraps `GstWebRTC.WebRTCRTPTransceiver` with direction read/write, stop, setCodecPreferences), `RTCRtpSender` (getParameters/setParameters, getCapabilities), `RTCRtpReceiver` (track, jitterBufferTarget 0–4000ms, getCapabilities), `MediaStream` (collection container with addtrack/removetrack events), `MediaStreamTrack` (stub with kind/label/enabled/muted/readyState/contentHint/clone/stop), `RTCTrackEvent`. `RTCPeerConnection.addTransceiver(kind, init)` creates real GstWebRTC transceivers; `getSenders/getReceivers/getTransceivers` return live lists; `track` event fires on `pad-added`. Globals via `@gjsify/webrtc/register/media`. Vala bridge extended with `on-new-transceiver` + `pad-added` signal forwarding. 109 new WPT-ported tests (total: 198). Actual media pipeline plumbing (decodebin, tee, getUserMedia) deferred to Phase 2.5. Continues [#14](https://github.com/gjsify/gjsify/issues/14).
* **webrtc:** new `@gjsify/webrtc` package — W3C WebRTC API backed by GStreamer `webrtcbin` — **Phase 1 + Phase 1.5 (data channel end-to-end)**. Ships the full JS surface: `RTCPeerConnection` (offer/answer, ICE trickle, STUN/TURN config, `createDataChannel`, `close`, all sync state getters + `on<event>` attribute handlers), `RTCDataChannel` (string + binary send/receive, bufferedAmount, binaryType), `RTCSessionDescription` (Gst ↔ JS roundtrip via GstSDP), `RTCIceCandidate` (RFC 5245 candidate-line parser), `RTCError` (extends DOMException), `RTCPeerConnectionIceEvent`, `RTCDataChannelEvent`, `RTCErrorEvent`. Wires `globalThis.RTC*` via granular register subpaths (`@gjsify/webrtc/register/{peer-connection,data-channel,error}`) picked up automatically by `gjsify build --globals auto` — no source-level import needed in consumer projects. The async handshake works end-to-end on GJS via the new **`@gjsify/webrtc-native`** Vala bridge (see below). Tests: 23 green including full local-loopback (two peers, offer/answer, ICE trickle, data-channel open/send/receive/echo). Media (RTCRtpSender/Receiver, MediaStream, getUserMedia) deferred to Phase 2. System prerequisites: GStreamer ≥ 1.20 with `gst-plugins-bad` + `libnice-gstreamer1` (Fedora) / `gstreamer1.0-plugins-bad` + `gstreamer1.0-nice` (Ubuntu). Initial foundation work for [#14](https://github.com/gjsify/gjsify/issues/14); references: [refs/node-gst-webrtc/](refs/node-gst-webrtc/) (ISC, Ratchanan Srirattanamet) + [refs/node-datachannel/polyfill/](refs/node-datachannel/src/polyfill/) (MIT). New private example: `examples/dom/webrtc-loopback` — two local peers exchange offer/answer + ICE and echo strings/binary over a data channel.
* **webrtc-native:** new `@gjsify/webrtc-native` package — native Vala/GObject signal bridge consumed by `@gjsify/webrtc` to work around the GJS streaming-thread block. Exposes three main-thread signal bridges: `WebrtcbinBridge` (wraps webrtcbin's `on-negotiation-needed` / `on-ice-candidate` / `on-data-channel` + `notify::*-state`), `DataChannelBridge` (wraps GstWebRTCDataChannel's `on-open` / `on-close` / `on-error` / `on-message-string` / `on-message-data` / `on-buffered-amount-low` + `notify::ready-state`), `PromiseBridge` (wraps `Gst.Promise.new_with_change_func`). Each bridge connects on the C side (never invokes JS on the streaming thread), captures args, then re-emits mirror signals via `GLib.Idle.add()` on the main context. `WebrtcbinBridge` eagerly wraps incoming data channels into a `DataChannelBridge` on the streaming thread to avoid a race where early remote messages would arrive before JS-side setup. Ships as prebuilt `.so` + `.typelib` in `prebuilds/linux-{x86_64,aarch64}/`; CI (`.github/workflows/prebuilds.yml`) rebuilds on Vala source changes. The CLI's `detectNativePackages` now merges native-package discoveries across all `node_modules` dirs up the filesystem (instead of stopping at the first hit) so example/workspace projects transparently find root-hoisted prebuilds in yarn v4 hoisted mode.
* **infra:** `@gjsify/esbuild-plugin-css` — GTK4 CSS Nesting lowering. The GJS app target now defaults `css.target` to `['firefox60']` so esbuild lowers CSS Nesting (unsupported by GTK4's CSS parser) at build time: authored `.parent { &:hover { … } }` becomes `.parent:hover { … }` in the bundled string. Features GTK4 *does* support (`var()`, `calc()`, `:is()`, `:where()`, `:not()`) are preserved. Override via `gjsify.config.js` → `esbuild.css.target` if your GTK version accepts newer CSS. Browser + node targets still inherit the parent build's target. Demonstrated in the `adwaita-package-builder` showcase: `runtime-style.css` contains a nested `&:hover` rule; the bundled binary shows it flattened
* **infra:** new `@gjsify/esbuild-plugin-css` package. Bundles `.css` imports into a JS string at build time, resolving `@import` statements (including node_modules via `package.json#exports`) through esbuild's own resolver. Wired into `gjsify build` for GJS, browser, and node targets. Fixes the runtime GTK CSS Theme-parser warnings that occurred because `Gtk.CssProvider.load_from_string()` cannot resolve `@import "@scope/pkg/style.css"` at runtime — the imports are now resolved at build time. Config via `PluginOptions.css` (`{ minify, target }`, both default to the parent build's values)
* **showcases:** new `adwaita-package-builder` showcase — minimal Adwaita app demonstrating `gjsify gresource`, `gjsify gettext`, and `gjsify build --shebang` in a single build pipeline. Produces a directly-executable binary with an embedded GResource (CSS) and per-language `.mo` translations (de/es). Serves as the `gjsify showcase adwaita-package-builder` reference for "how to package a GJS/GNOME app with the gjsify CLI alone"

### Bug Fixes

* **cli/gettext:** `--format mo` no longer passes an invalid `--mo` flag to `msgfmt`. `msgfmt` produces a `.mo` file by default when no format flag is given; the `--mo` pseudo-flag never worked and caused every `gettext --format mo` invocation to fail with "Unbekannte Option »--mo«"
* **cli/gresource:** create the target directory automatically before invoking `glib-compile-resources`. Previously a target like `dist/app.gresource` failed with ENOENT when `dist/` did not exist, because `glib-compile-resources` writes a temp file next to the target

### Tests

* **event-bridge:** new `event-bridge.spec.ts` regression suite verifying the `motion` handler reads widget-local coords from the signal callback (NOT from `controller.get_current_event().get_position()`, which returns surface-local coords and produced a drag-jump on first move after click). Covers coord forwarding, clamping to widget allocation, and movementX/Y tracking across successive motions
* **cli-only E2E:** added coverage for `gjsify build --shebang` (shebang prepend + `chmod 0o755` + idempotence on repeated builds), `gjsify gresource` (binary bundle produced, `gresource list` lists the embedded path), and `gjsify gettext --format mo` (per-language locale tree under `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`). Skips gracefully when `glib-compile-resources` / `msgfmt` are not installed

## [0.1.10](https://github.com/gjsify/gjsify/compare/v0.1.9...v0.1.10) (2026-04-11)

### Features

* **showcases:** add focus to canvas widgets on initialization ([c2a1e4b](https://github.com/gjsify/gjsify/commit/c2a1e4b932aa347e0bbd64887db18e45c9b9bdb1))
* **website:** show Express.js example first in showcase slideshow ([5d8fe22](https://github.com/gjsify/gjsify/commit/5d8fe22be38d48705e1851dc7eef2f99374755e1))
* **website:** streamline docs with Quick Start, collapsible sections and CTA ([9f8a10e](https://github.com/gjsify/gjsify/commit/9f8a10e434fcd0151ee9d71e2f1e9b71b1e2f327))

### Bug Fixes

* **website:** rename Express showcase title to express-webserver.ts ([e86b055](https://github.com/gjsify/gjsify/commit/e86b055d387e1f4e149fc3b7c152fe3a154cdd25))

## [0.1.9](https://github.com/gjsify/gjsify/compare/v0.1.8...v0.1.9) (2026-04-11)

### Features

* **build:** --globals auto — two-pass esbuild analysis ([#15](https://github.com/gjsify/gjsify/issues/15)) ([943f61c](https://github.com/gjsify/gjsify/commit/943f61c972e9b01b93f933191c60128b370cd0a4))
* **showcase:** excalibur-jelly-jumper — 2D platformer + Browser API stubs ([#13](https://github.com/gjsify/gjsify/issues/13)) ([63e7c25](https://github.com/gjsify/gjsify/commit/63e7c25046527f9cb61c32ff634e78b503cbb786))

## Unreleased (2026-04-10)

### Features

* **webaudio:** new `@gjsify/webaudio` package — Web Audio API for GJS backed by GStreamer 1.26. Implements AudioContext, decodeAudioData (MP3/WAV/OGG/FLAC via GStreamer decodebin), AudioBufferSourceNode (per-play pipeline: appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), AudioBuffer (PCM Float32Array), HTMLAudioElement (canPlayType + playbin). 29 tests. Phase 1 — covers Excalibur.js audio needs
* **showcase:** add Excalibur Jelly Jumper — 2D platformer running natively on GJS/GTK4 and in the browser ([#13](https://github.com/gjsify/gjsify/pull/13)). Based on [excaliburjs/sample-jelly-jumper](https://github.com/excaliburjs/sample-jelly-jumper)
* **canvas2d:** HSL/HSLA color parsing, shadow blur approximation, pixel-perfect font rendering via FontFace + PangoCairo
* **webgl:** premultipliedAlpha support, clearBufferfv/iv/uiv/fi WebGL2 entry points, eager context init, uniform name resolution
* **dom-elements:** HTMLElement.dataset (DOMStringMap proxy), HTMLImageElement data: URI support
* **dom-elements:** stub `window.scrollX`, `window.scrollY`, `window.pageXOffset`, `window.pageYOffset` to `0`. GTK widgets have no page-scroll concept; without these stubs Excalibur's `getPosition()` computed `rect.x + undefined = NaN`, NaN-poisoning every pointer coordinate and producing a blank canvas on any drag/pan
* **dom-elements:** add `onwheel` property getter/setter to `HTMLElement`. Excalibur feature-detects wheel support via `'onwheel' in document.createElement('div')` and silently omits its wheel listener when the property is missing — previously wheel events flowed through event-bridge but never reached game code
* **event-bridge:** `motion` handler now uses widget-local coordinates from the `Gtk.EventControllerMotion::motion` signal directly, matching the coordinate frame used by `GestureClick::pressed`. Previously it pulled coords from `controller.get_current_event().get_position()` which returns surface-local coords, causing drag anchors to jump on the first move after a click
* **event-bridge:** wire keyboard input to window-level listeners
* **fetch:** support file:// URIs + root-relative URL rewrite for GJS
* **gamepad:** new `@gjsify/gamepad` package — Gamepad Web API for GJS backed by libmanette 0.2. Implements Gamepad, GamepadButton, GamepadEvent, GamepadHapticActuator (dual-rumble). Bridges libmanette's event-driven signals to W3C polling-based navigator.getGamepads(). Button/axis mapping from Manette enums to W3C standard layout. Lazy Monitor init + graceful degradation. 19 tests. Enables controller support in excalibur-jelly-jumper showcase
* **cli:** `--shebang` flag on `gjsify build` — after a successful GJS app build, prepends `#!/usr/bin/env -S gjs -m` to the outfile and sets it executable (`chmod 0o755`). Turns the bundle into a standalone, directly-executable GJS binary (e.g. `./org.myapp.Maker`) without a separate launcher script
* **cli:** new `gjsify gresource <xml>` command — thin wrapper around `glib-compile-resources` with `--sourcedir` and `--target` options. Default target is derived from the XML descriptor filename. Mirrors the meson/autotools step for packaging UI templates and assets into a binary `.gresource` bundle
* **cli:** new `gjsify gettext <poDir> <outDir>` command — wraps `msgfmt` for translation workflows. Supports `--format mo` (per-language locale tree `<outDir>/<lang>/LC_MESSAGES/<domain>.mo`, default), `xml` (metainfo template substitution via `msgfmt --template`, with optional `--remove-xml-comments`), `desktop`, and `json`. Replaces hand-rolled shell scripts in GNOME app build pipelines

### Bug Fixes

* **canvas2d:** drawImage via paint+clip, composite operation mapping
* **webgl:** offsetWidth/offsetHeight for Excalibur, extractImageData fix
* **showcase/jelly-jumper:** circular saw rotation precision, outline shader init, TypeScript type errors, MSAA disable, browser sprite rendering

### Chores

* **showcase/jelly-jumper:** clean up leftover files from original repo (.github, vite.config.ts, package-lock.json, social.jpg, .prettierrc, etc.), move assets from public/res/ to src/assets/, align structure with other showcases

## [0.1.8](https://github.com/gjsify/gjsify/compare/v0.1.7...v0.1.8) (2026-04-08)

### ⚠ BREAKING CHANGES

* **globals:** importing the root `@gjsify/<pkg>` module of a
global-providing package no longer registers globals. Callers must
explicitly import the `/register` subpath (`@gjsify/fetch/register`,
`@gjsify/abort-controller/register`, …) or use the aliased bare
specifier (`import 'fetch/register'`, `import 'abort-controller/register'`,
…). Stage 3 will add automatic injection via the esbuild plugin, so
this manual step disappears again for typical projects.

Stage 2 of the refactor plan at .claude/plans/indexed-popping-sloth.md.
* **globals:** projects that relied on `@gjsify/node-globals` to
implicitly register `fetch`, `Headers`, `Request`, `Response`,
`AbortController` or `AbortSignal` must now either import
`@gjsify/web-globals` or import the specific bare specifier
(`import 'fetch'`, `import 'abort-controller'`).

Stage 1 of the refactor plan at
.claude/plans/indexed-popping-sloth.md — next stages will introduce
`/register` subpaths and auto-injection in the esbuild plugin.

### Features

* **build:** stage 3 — auto-inject /register modules via esbuild plugin ([9f4018b](https://github.com/gjsify/gjsify/commit/9f4018bd52f0349d1fa083d9d5d192adc05b1cc4))
* **create-app:** livelier template showing Node.js + Web Crypto + Buffer ([94517d9](https://github.com/gjsify/gjsify/commit/94517d9b4bd4d7fdb77be4f02fd30be6864bd17c))
* **create-app:** template als echtes Workspace-Package ([89fecbf](https://github.com/gjsify/gjsify/commit/89fecbfe36cf853b9679cda876e0234315ef2431))
* **globals:** add node/web/dom group aliases for --globals flag ([4443779](https://github.com/gjsify/gjsify/commit/44437794ed7945d94c73c8f4041dffab53302d25))
* separate showcases from examples ([#5](https://github.com/gjsify/gjsify/issues/5)) ([086bbd0](https://github.com/gjsify/gjsify/commit/086bbd0c9f89b841b21acf13b69b0132d949eb2c)), closes [#222226](https://github.com/gjsify/gjsify/issues/222226) [#ffffff](https://github.com/gjsify/gjsify/issues/ffffff) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4) [#78aeed](https://github.com/gjsify/gjsify/issues/78aeed) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#613583](https://github.com/gjsify/gjsify/issues/613583) [#c061cb](https://github.com/gjsify/gjsify/issues/c061cb) [#dc8add](https://github.com/gjsify/gjsify/issues/dc8add) [#9141ac](https://github.com/gjsify/gjsify/issues/9141ac) [#3584e4](https://github.com/gjsify/gjsify/issues/3584e4)

### Bug Fixes

* **ci:** add blueprint-compiler to release workflow prerequisites ([0184b65](https://github.com/gjsify/gjsify/commit/0184b65867bfa3428377494e81e12436a752c596))
* **ci:** add libadwaita-devel to release workflow for blueprint compilation ([dc44b34](https://github.com/gjsify/gjsify/commit/dc44b34a86d334169299333741365d850705cc78))
* **ci:** build adwaita-web SCSS before website build ([460b932](https://github.com/gjsify/gjsify/commit/460b932afc7c0ca0b46a9b3a42a1784bd8a5ffc9))
* **create-app:** add check script to template, fix set_child typo ([4290b92](https://github.com/gjsify/gjsify/commit/4290b92b137bb3f709813c1fb627ea6d2698b9ea))
* **package:** update astro dependency to version 6.1.5 ([77ad702](https://github.com/gjsify/gjsify/commit/77ad70279e414edd9e0e05efa9b2959342d090d6))

### Code Refactoring

* **globals:** stage 1 — drop fetch/abort-controller from node-globals ([#6](https://github.com/gjsify/gjsify/issues/6)) ([94464bd](https://github.com/gjsify/gjsify/commit/94464bdc0a9a215f165ea1cba9445aabd81c4b89))
* **globals:** stage 2 — introduce /register subpath exports ([66957b9](https://github.com/gjsify/gjsify/commit/66957b9bf2bff7e3088f76be45627a578f96abbf))

## Unreleased

### ⚠ BREAKING CHANGES

* **node-globals:** `@gjsify/node-globals` no longer auto-registers `fetch`, `Headers`, `Request`, `Response`, `AbortController` or `AbortSignal`. These are Web APIs, not Node.js globals — importing them automatically pulled the full WHATWG Streams implementation into every bundle even when unused (~80 KB dead weight on a minimal Express app). Projects that need these APIs on GJS should now either:
  - Import `@gjsify/web-globals` to get the full Web API set, or
  - Import the specific package side-effect bundle, e.g. `import 'fetch'` or `import 'abort-controller'` (the aliases resolve to the correct GJS/Node package automatically).
* **node-globals:** The empty `ReadableStream`/`Blob` placeholder stubs in `@gjsify/node-globals` are removed. `Blob`/`File` remain available because `@gjsify/buffer` (still imported by node-globals) registers them. `ReadableStream` is only registered when something actually imports `@gjsify/streams` or a package that depends on it.

### Features

* **cli:** add `gjsify create <name>` subcommand that delegates to `@gjsify/create-app`, so users only need to remember a single npm scope (`@gjsify/cli`) to scaffold, build and run GJSify projects
* **create-app:** expose `createProject()` as a programmatic export (`import { createProject } from '@gjsify/create-app'`) in addition to the existing CLI entry

### Refactor

* **globals:** drop `fetch` and `abort-controller` side-effect imports from `@gjsify/node-globals` and `@gjsify/dom-elements`. Stage 1 of the globals tree-shaking refactor. Express showcase bundle shrinks from 1.83 MB → 1.68 MB (-157 KB, -8.5 %), WHATWG Streams references drop from 186 to 9.
* **fs:** make `FileHandle.readableWebStream()` resolve the `ReadableStream` constructor lazily from `globalThis` instead of importing `node:stream/web` at module load time. Apps that never call `readableWebStream()` no longer ship the full WHATWG Streams polyfill. Stage 1 of the globals tree-shaking refactor.
* **globals:** Stage 2 of the globals tree-shaking refactor — introduce `/register` subpath exports on every global-providing package. The root `@gjsify/<pkg>` exports are now pure named exports with no side effects; side-effects live in `@gjsify/<pkg>/register`. Meta-packages (`@gjsify/node-globals`, `@gjsify/web-globals`) are rewired to chain `/register` subpaths. Internal package dependencies (compression-streams → web-streams, webcrypto → dom-exception) now use pure named imports. Canvas2D fireworks showcase shrinks from 837 KB → 641 KB (-196 KB, -23.4 %). Packages migrated: `abort-controller`, `buffer`, `compression-streams`, `dom-elements`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `node-globals`, `web-globals`, `web-streams`, `webcrypto`. New bare-specifier aliases: `abort-controller/register`, `fetch/register`, `webcrypto/register`, etc. — resolve to the appropriate `/register` subpath on GJS and to `@gjsify/empty` on Node.
* **globals:** explicit `--globals` CLI flag for controlling which `/register` modules ship in the bundle. Users declare needed globals as a comma-separated list (`--globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController`); the CLI resolves each identifier against `GJS_GLOBALS_MAP`, writes a small ESM stub under `node_modules/.cache/gjsify/`, and passes it to the plugin via `autoGlobalsInject`. The plugin appends the stub to esbuild's `inject` list. The `@gjsify/create-app` template `package.json` ships with a sensible default list pre-wired into the `build` script, so typical Node-style apps work out of the box. There is deliberately no automatic scanning of user code — heuristic scanners (regex on entry points, AST on entry points, two-pass metafile scan across transitive deps) were prototyped and all three leaked in different ways (shadowed identifiers, isomorphic library guards, dynamic imports, bracket-notation global access). Explicit declaration keeps the CLI layer minimal and build output predictable.

### Features

* **cli/build:** add `--globals <list>` flag to `gjsify build` — comma-separated list of global identifiers to register in the bundle (e.g. `--globals fetch,Buffer,process`).

### Bug Fixes

* **website:** build `@gjsify/adwaita-web` SCSS as a prerequisite of the website build so `deploy-docs` CI (which runs only `yarn workspace @gjsify/website build`) can resolve `@gjsify/adwaita-web/style.css` after the CSS-in-JS → SCSS refactor

### Documentation

* **website:** refactor top-level docs to target framework users instead of monorepo contributors — new Getting Started walks through `npx @gjsify/cli create my-app` instead of `git clone`
* **website:** new `CLI Reference` and `How It Works` pages under `Documentation`
* **website:** move contributor docs (Architecture, TDD Workflow, Development Setup) into a dedicated top-level `Contributing` sidebar group
* **website:** home page cards for Node.js APIs, Web APIs and DOM & Graphics now link directly to their respective Packages pages

## [0.1.7](https://github.com/gjsify/gjsify/compare/v0.1.6...v0.1.7) (2026-04-04)

### Bug Fixes

* **ci:** build examples before npm publish in release workflow ([027a729](https://github.com/gjsify/gjsify/commit/027a72985899d4acd91f47bb6d5799b3b020a82d))

## [0.1.6](https://github.com/gjsify/gjsify/compare/v0.1.5...v0.1.6) (2026-04-04)

### Bug Fixes

* **publish:** build examples before npm publish + lint for missing dist ([eba07a5](https://github.com/gjsify/gjsify/commit/eba07a5b98ad10b77bc99827334cd53490c619b9))
* **refs:** update subproject commits for bun, deno, and undici ([e1751dd](https://github.com/gjsify/gjsify/commit/e1751dd0cd041c61bb0270326312b54e18a687da))
* **svg:** update favicon and logos ([4699da6](https://github.com/gjsify/gjsify/commit/4699da6dbc2a0f220e243deec2cc13862cf9bece))

## [0.1.5](https://github.com/gjsify/gjsify/compare/v0.1.4...v0.1.5) (2026-04-04)

### Bug Fixes

* **cli:** resolve gwebgl from CLI location, not user's cwd ([686c53d](https://github.com/gjsify/gjsify/commit/686c53dc6eac5ff2f0d8df54eefd0c365512e02d))
* **cli:** resolve npm packages from project first, CLI as fallback ([8d81c97](https://github.com/gjsify/gjsify/commit/8d81c97ef20f3eea5e79e0851d33344d5013fa31))

## [0.1.4](https://github.com/gjsify/gjsify/compare/v0.1.3...v0.1.4) (2026-04-03)

### Bug Fixes

* **examples:** update outdated engines fields and add lint check ([c27ad7c](https://github.com/gjsify/gjsify/commit/c27ad7cbd777299d99c87bbed5916cc3a4d357f2))

## [0.1.3](https://github.com/gjsify/gjsify/compare/v0.1.2...v0.1.3) (2026-04-03)

### Features

* add documentation link to README ([3e10f75](https://github.com/gjsify/gjsify/commit/3e10f751fda846bddc9c06d875935b0b3c8bf0fc))
* add release:patch script to package.json for patch releases ([f07f30a](https://github.com/gjsify/gjsify/commit/f07f30a243331871457f179291578dafe0fa870f))
* documentation site, WebGL conformance, CLI showcase, dependency updates ([#3](https://github.com/gjsify/gjsify/issues/3)) ([db41f07](https://github.com/gjsify/gjsify/commit/db41f07551d48282161458bb2648cb28560767a2)), closes [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version) [#version](https://github.com/gjsify/gjsify/issues/version)
* include website package.json in release-it bumper configuration ([58d4242](https://github.com/gjsify/gjsify/commit/58d42421bcc11e55824df6086682524983caf397))
* update favicon to SVG format and replace logo with new design ([f8e0f46](https://github.com/gjsify/gjsify/commit/f8e0f4615b19386f598101ecdb86c01d71994683))

# gjsify — Changelog

### 2026-04-07 — TypeScript: Spec Files Now Type-Checked Monorepo-Wide

**Problem:** VSCode raised `Cannot find name 'node:stream'` on every `*.spec.ts` that imported `node:*` modules. Root cause: all 60 package tsconfigs excluded `src/**/*.spec.{ts,mts}` from their `include`, so the IDE's language server fell back to an inferred project without `@types/node`. `yarn check` (`tsc --noEmit`) was also silently skipping all spec files.

**Fix:**
- Removed the `src/**/*.spec.{ts,mts}` exclusions from 58 package tsconfigs. VSCode's auto-discovered project now covers spec files and loads `@types/node` for them; `yarn check` now actually type-checks specs.
- `packages/dom/webgl/tsconfig.json` re-excludes spec files as a special case — they don't import `node:*` (so the user complaint doesn't manifest) but have pre-existing global DOM `WebGLRenderingContext` vs class-type conflicts that would otherwise flood the check with ~100 errors.
- Added TypeScript `paths` mappings in 9 web tsconfigs (`abort-controller`, `compression-streams`, `dom-events`, `dom-exception`, `eventsource`, `fetch`, `formdata`, `websocket`, `webstorage`) pointing each bare web alias to `./src/index.ts` so specs that use the `AGENTS.md`-mandated bare-specifier imports type-check without build-time esbuild alias resolution.
- Ambient module declarations in `packages/web/dom-events/src/spec-aliases.d.ts` and `packages/node/events/src/spec-aliases.d.ts` cover cross-package bare imports (`abort-controller`) without requiring cross-rootDir path mappings.
- `packages/node/stream/src/spec-internals.d.ts`: ambient module augmentation exposing `_readableState`/`_writableState` for white-box tests that probe stream internals.

**Spec type errors surfaced and fixed:**
- `as any` casts added for test-only invalid arguments (perf_hooks `EntryType` literal, webcrypto `Float32Array`, sqlite unsupported values, `crypto.KeyObject` private constructor, `KeyObject.export` format-only options, `http2.getPackedSettings()` zero-arg, `readline.cursorTo` 3-arg, `http.IncomingMessage` zero-arg).
- Type augmentations for Node internals missing from `@types/node`: `StringDecoder.encoding`, `dgram.Socket.type`, `http.Agent.{defaultPort, keepAlive, keepAliveMsecs, scheduling}`, `http2.constants.{NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL, DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE, HTTP2_HEADER_PROTOCOL}`.
- Explicit narrowing for `server.address(): string | AddressInfo | null` (net spec).
- String/Buffer narrowing for `'data'` event handlers in net specs.
- JSON result typing in fetch and stream-consumers specs.
- Loosened `tracingChannel`/`channel` types via local `as any` aliases for the many handler shapes in the diagnostics_channel spec.
- Renamed shadowed `resolve` in dns spec (promise resolve shadowed `dns.resolve`).
- Unused import/variable cleanup in canvas2d, dom-elements, webgl/textures specs.
- Added `declare readonly isTrusted: boolean` on `@gjsify/dom-events` `Event` class so white-box `isTrusted` access in specs type-checks (runtime behaviour unchanged — set via `Object.defineProperty` in the constructor).

**Documentation:**
- `AGENTS.md`: added explicit rule — "Changelog entries live ONLY in CHANGELOG.md. Do NOT add dated 'Latest:' lines, changelog highlights, or per-session summaries to STATUS.md."
- `STATUS.md`: removed the dated "Latest:" line pattern; `## Changelog` section now just points to CHANGELOG.md.
- `packages/node/events/src/callable.spec.ts`: header comment updated — the EventEmitter callable work is no longer a TODO, these specs are its regression coverage.

**Verification:** `yarn check` clean across the monorepo, `yarn build` succeeds, `yarn test` → 53,310 tests passing.

### 2026-04-07 — Stream GJS Fixes: 36→0 Failures, 509 Tests Passing on Both Platforms

**`@gjsify/stream` — GJS implementation fixes (all 36 GJS failures resolved):**

- **`_readableState` / `_writableState` fields** — both now expose `highWaterMark`, `objectMode`, and `pipes` (array), populated in constructors; required by tests that access internal state directly
- **`Writable_.Symbol.hasInstance`** — static `[Symbol.hasInstance]` added: checks prototype chain first (for real subclasses), then sentinel-guarded duck-type check (`writableHighWaterMark` numeric property) so `duplex instanceof Writable` and `transform instanceof Writable` work through the `makeCallable` Proxy
- **Split `highWaterMark` options** — `Duplex_` constructor now correctly handles `highWaterMark` (overrides both sides), `readableHighWaterMark`, and `writableHighWaterMark` independently; NaN validation added for all HWM options
- **Drain condition HWM=0** — `writableNeedDrain` drain check changed from `<` to `<=` so drain fires when `writableLength <= writableHighWaterMark` (critical for HWM=0 case where `0 < 0` is always false)
- **`Transform_` complete redesign:**
  - Constructor assigns `opts.transform`/`opts.flush`/`opts.final` directly as instance properties (`t._transform === opts.transform` equality holds)
  - `ERR_METHOD_NOT_IMPLEMENTED` re-throws synchronously from `_write` (test introspects the throw); other user-provided `_transform` errors become 'error' events
  - `ERR_MULTIPLE_CALLBACK` — `called` flag in `_write` detects second callback invocation and emits error
  - `_doPrefinishHooks` virtual method on `Duplex_` called between `_final` and `finish`; `Transform_` overrides it to run built-in `_final` (flush+push-null) when user supplied a custom `_final`
- **`Readable_.push()` type validation** — non-objectMode pushes of plain objects emit `ERR_INVALID_ARG_TYPE` error
- **`_destroy` virtual method** — `Readable_._destroy(error, callback)` prototype method added; `destroy()` calls `this._destroy()` so instance-overridden `_destroy` works correctly
- **`Stream_.pipe()` cleanup** — `source.on('end', cleanup)` removes all listeners when 'end' fires; `onclose` skips `destroy(dest)` for modern `Readable_` instances to avoid premature close
- **`unpipe()` sync** — maintains `_readableState.pipes` alongside `_pipeDests`

**`@gjsify/util` — `inherits` error codes:**
- All three validation throws now attach `code: 'ERR_INVALID_ARG_TYPE'` matching Node.js behaviour

**Test coverage:**
- Node.js: 507 tests passing | GJS: 509 tests passing (0 failures, up from 36)
- Stream spec files: 7 (readable, writable, duplex, transform, pipe, inheritance + base)

**AGENTS.md:**
- Added note: internal modules may import `@gjsify/stream` directly for non-standard exports; public code must use `node:stream`

### 2026-04-01 — DOM API, WebGL2, Blueprint, Adwaita Web, Three.js Teapot

**DOM API enhancements (`@gjsify/dom-elements`):**
- `Node.ownerDocument` returns `document` singleton (lazy, avoids circular deps)
- Event bubbling via `Node.dispatchEvent` override — walks parentNode chain
- `Document` establishes DOM tree: document → documentElement → body
- `Element`: `setPointerCapture()`, `releasePointerCapture()`, `hasPointerCapture()`
- `HTMLElement`: `getBoundingClientRect()` stub (uses clientWidth/clientHeight)
- Browser globals on import: `globalThis.self`, `devicePixelRatio`, `alert`

**WebGL2 fixes (`@gjsify/webgl`):**
- `WebGL2RenderingContext` overrides `texImage2D`, `texSubImage2D` — bypasses WebGL1 format validation (RGBA8, RGB8, SRGB8_ALPHA8 etc.)
- `WebGL2RenderingContext` overrides `drawElements` — UNSIGNED_INT as core feature (no extension gate)
- `CanvasWebGLWidget`: resize dispatches DOM event + re-invokes last rAF callback

**Blueprint support:**
- New `@gjsify/esbuild-plugin-blueprint` — compiles `.blp` → XML via `blueprint-compiler`
- Wired into `esbuild-plugin-gjsify` for GJS and browser targets
- Type declaration: `@gjsify/esbuild-plugin-blueprint/types`

**Adwaita web components (`@gjsify/adwaita-web`):**
- 5 Custom Elements (light DOM): AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwComboRow
- Embedded Adwaita CSS with light/dark theme (canonical colors from libadwaita)
- Adwaita Sans font via @font-face
- `notify::active` / `notify::selected` events mirror GJS GObject signals

**Three.js teapot example (`examples/gtk/three-geometry-teapot/`):**
- First Adwaita example: Adw.Application + Blueprint template
- First OrbitControls usage (event bridge validation)
- Dual-target: GJS native + browser with @gjsify/adwaita-web
- New convention: `src/gjs/` + `src/browser/` + shared `three-demo.ts`
- 6 shading modes (wireframe, flat, smooth, glossy, textured, reflective)

**New reference submodules:** `refs/adwaita-web`, `refs/libadwaita`, `refs/adwaita-fonts`, `refs/app-mockups`

### 2026-03-27 — WebGL Refactor: HTMLCanvasElement Inheritance, WebGLArea Widget

**Goal: enable browser-targeted game engines (e.g. Excalibur) to run on GJS/GTK with minimal changes.**

**Base `HTMLCanvasElement` in `@gjsify/dom-elements`:**
- New `packages/dom/dom-elements/src/html-canvas-element.ts` — DOM-spec base class extending `HTMLElement`
- Stubs for `getContext()`, `toDataURL()`, `toBlob()`, `captureStream()` (overridden in `@gjsify/webgl`)
- Side-effect globals on import: `Object.defineProperty(globalThis, 'HTMLCanvasElement', ...)`, `HTMLImageElement`, `Image` — same pattern as `@gjsify/node-globals` and `@gjsify/web-globals`
- Removes the `// TODO move this to dom globals` boilerplate from all WebGL examples

**`@gjsify/webgl` real inheritance + class renames:**
- Removed the fake interface trick (`export interface GjsifyHTMLCanvasElement extends HTMLCanvasElement {}`)
- `GjsifyHTMLCanvasElement` → `HTMLCanvasElement` — now extends `BaseHTMLCanvasElement` from `@gjsify/dom-elements`, overrides `width`/`height` getters with `Gtk.GLArea` allocated size
- `GjsifyWebGLRenderingContext` → `WebGLRenderingContext` (and all other `Gjsify*` class prefixes removed — 136 occurrences across 29 files)
- `getContext('webgl')` creates `WebGLRenderingContext` lazily via `??=`

**New `WebGLArea` widget (`packages/dom/webgl/src/ts/webgl-area.ts`):**
- `Gtk.GLArea` subclass registered with `GObject.registerClass({ GTypeName: 'GjsifyWebGLArea' }, ...)`
- Sets up ES 3.2 context + depth buffer + stencil buffer automatically
- `onWebGLReady(cb: (canvas, gl) => void)` — fires once GL context is initialized
- `requestAnimationFrame(cb)` — backed by `GLib.idle_add` + render signal (replaces per-example boilerplate)
- `installGlobals()` — sets `globalThis.requestAnimationFrame` scoped to this widget
- Handles `unrealize` cleanup (disconnects render handler, removes idle source)

**VAPI cleanup:**
- Deleted unused `packages/dom/webgl/src/vapi/glesv2.vapi` (Vala source uses `using GL;` from `epoxy.vapi` only)
- Updated `epoxy.vapi` header: removed vapigen-generated comment, added attribution to valagl

**Examples refactored (6 files):**
- `examples/gtk/webgl-tutorial-02` through `07` and `webgl-demo-fade` simplified from 60–120 lines → 22–33 lines
- All manual `Gtk.GLArea` setup, `requestAnimationFrame` implementations, and `globalThis.Image =` assignments removed
- All now use `new WebGLArea()` + `glArea.installGlobals()` + `glArea.onWebGLReady((canvas) => start(canvas))`

### 2026-03-27 — Restructure: new `packages/dom/` category

**New package category `packages/dom/` for DOM/platform-specific packages:**
- Moved `dom-elements` from `packages/web/` → `packages/dom/`
- Moved `webgl` from `packages/web/` → `packages/dom/`
- Merged `html-image-element` into `dom-elements` (HTMLImageElement, Image now part of @gjsify/dom-elements)
- Updated `@gjsify/webgl` dependency: `html-image-element` → `dom-elements`
- Updated root `package.json` workspaces, `meson.build`, WebGL example scripts, CLAUDE.md, STATUS.md

### 2026-03-27 — HTTP Upgrade Event, Web Globals, Client Auth, Test Coverage

**HTTP Server upgrade event:**
- `server.on('upgrade', (req, socket, head) => {...})` for custom protocol upgrades
- Uses `Soup.ServerMessage.steal_connection()` to take over raw TCP connection
- Socket is a net.Socket Duplex wrapping the stolen Gio.IOStream
- Note: WebSocket upgrades (`Upgrade: websocket`) are handled by Soup internally via `addWebSocketHandler()`

**HTTP Client improvements:**
- `auth` option for Basic authentication (`http.request({auth: 'user:pass'})`)
- `signal` option for AbortController support
- `localAddress` and `family` options in ClientRequestOptions
- Agent constructor options: `keepAlive`, `maxSockets`, `maxTotalSockets`, `maxFreeSockets`, `scheduling`
- Agent exposes `requests`/`sockets`/`freeSockets` objects for framework compatibility

**Web Globals consolidation:**
- `@gjsify/web-globals` now registers: URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver
- Previously only: DOMException, Event/EventTarget, AbortController, Streams, Compression, WebCrypto, EventSource

**Net Socket IOStream support:**
- `net.Socket._setupFromIOStream()` creates sockets from raw `Gio.IOStream` (for stolen connections)
- Proper IOStream lifecycle: `_final()` closes entire SoupIOStream for proper EOF signaling
- `@gjsify/net` exports `./socket` subpath for direct internal imports

**New tests (+200):**
- HTTP: 995→1034 (+39): upgrade event (5 tests), auth option (3), Agent constructor (8), signal option, round-trip
- Net: 361→378 (+17): destroy idempotency, getConnections, maxConnections, address info, bytesWritten/bytesRead
- Web-Globals: 45→66 (+21): URL/URLSearchParams, Blob/File, FormData, Performance globals

### 2026-03-26 — Networking Hardening, Timeout Enforcement, Stream Edge Cases

**HTTP Server improvements:**
- **Chunked streaming**: ServerResponse now uses `Soup.Encoding.CHUNKED` for true streaming via `responseBody.append()` instead of buffering the entire response. Each `res.write()` flushes a chunk.
- **Timeout enforcement**: `ServerResponse.setTimeout()`, `IncomingMessage.setTimeout()`, and `ClientRequest.setTimeout()` now emit `'timeout'` events via actual timers (previously properties existed but were inert).
- **ClientRequest timeout option**: `http.request({timeout: 50})` starts a timer that emits `'timeout'` if no response arrives in time. Timer cleared on response or abort.

**Net Socket improvements:**
- **allowHalfOpen enforcement**: `net.Server({allowHalfOpen})` now stores and passes the option to accepted sockets. When `allowHalfOpen=false` (default), the socket calls `end()` on read EOF, matching Node.js behavior.
- **Socket allowHalfOpen property**: `net.Socket` exposes `allowHalfOpen` as a public property and respects it during EOF handling in the read loop.

**New tests (+200):**
- HTTP: 890→995 (+105): ServerResponse.setTimeout, IncomingMessage.setTimeout, ClientRequest.setTimeout/timeout option, abort events, HEAD no-body, automatic headers, custom status messages, res.end() callback, multiple headers (Set-Cookie), flushHeaders, POST body streaming (empty/64KB), error handling (EADDRINUSE, connection refused), server lifecycle
- Net: 295→361 (+66): Socket.setTimeout (idle timeout, data resets, cancellation), allowHalfOpen enforcement, server lifecycle (listening, close, address, getConnections), connection lifecycle (connect/ready events, connecting state, bytesRead/bytesWritten), destroy/close events, error handling (connection refused, EADDRINUSE), setKeepAlive/setNoDelay chainability, maxConnections, echo/binary data
- Stream: 288→330 (+42): pipeline (error propagation from source/transform/sink, callback behavior), finished (writable/readable/error/premature close, cleanup), Transform _flush (data push, error propagation), Readable.from (array/generator/async generator/string/Buffer), addAbortSignal (abort/already-aborted), backpressure (write returns false, drain events), PassThrough, Duplex read+write, objectMode, async iteration with errors

### 2026-03-26 — Fetch Globals, WebSocket Server, EADDRINUSE Fix, GTK Dashboard

**Infrastructure fixes:**
- **Fetch API globals on GJS**: `@gjsify/fetch` now registers `fetch`, `Request`, `Response`, `Headers` on `globalThis`. `@gjsify/node-globals` imports `@gjsify/fetch` for side-effect registration (replaces empty stubs).
- **EADDRINUSE error on GJS**: `http.Server.listen()` now throws when port is busy and no `'error'` listener is registered, matching Node.js behavior (previously exited silently).
- **WebSocket server**: `http.Server.addWebSocketHandler(path, callback)` delegates to `Soup.Server.add_websocket_handler()` for server-side WebSocket on GJS.

**New examples:**
- `examples/net/ws-chat`: WebSocket chat using `Soup.WebsocketConnection` signals, with REST POST fallback
- `examples/gtk/http-dashboard`: GTK4 window + embedded HTTP server. Labels show request count/uptime, TextView shows request log. Uses `GLib.idle_add()` for thread-safe UI updates.

### 2026-03-26 — Real-World Examples Sprint (+6 examples, +116 tests)

**New examples (all work on both Node.js and GJS unless noted):**
- `examples/net/static-file-server`: `createReadStream().pipe(res)`, MIME types, gzip, directory listing, 304 caching
- `examples/net/sse-chat`: Real-time chat via Server-Sent Events + HTTP POST, EventEmitter message bus
- `examples/net/hono-rest`: Hono.js CRUD REST API with JSON validation (Node.js works, GJS needs Fetch API globals)
- `examples/cli/file-search`: Recursive file search using `createReadStream` + `readline.createInterface`
- `examples/cli/dns-lookup`: Interactive DNS tool using `dns.lookup/resolve4/resolve6/reverse`
- `examples/cli/worker-pool`: Task pool with MessageChannel for inter-worker communication

**New tests:**
- HTTP streaming (65 tests): `Readable.pipe(res)`, multi-chunk writes, large bodies (256KB), POST body, concurrent requests, routing, server lifecycle
- fs streams (27 tests): `createReadStream`/`createWriteStream`, pipe (ReadStream→WriteStream, Transform, PassThrough), Unicode, binary
- net TCP (24 tests): echo server, 64KB data transfer, connection events, socket properties, UTF-8/binary, error handling

**Validated:** `createReadStream().pipe(res)` works on GJS. TCP echo and data transfer work cross-platform. MessageChannel postMessage works for task distribution.

### 2026-03-26 — Static File Server Example

**New example:**
- `examples/net/static-file-server`: Static file server with `fs.createReadStream().pipe(res)`, MIME type detection, gzip compression (`zlib.gzipSync`), directory listing, `If-Modified-Since`/304, directory traversal prevention. Runs on both Node.js and GJS.

**Validated:** `createReadStream().pipe(res)` works correctly on GJS — the stream pipe mechanism (Readable→Writable with backpressure) and Soup.Server response buffering are fully compatible.

### 2026-03-26 — Real-World Application Examples & GJS Compat Fixes

**New examples:**
- `examples/net/koa-blog`: Koa.js blog with EJS templates, HTML forms, JSON API, CRUD. Runs on both Node.js and GJS.
- `examples/net/express-hello`: Updated to use `@gjsify/runtime` for platform detection.

**New packages:**
- `@gjsify/runtime`: Platform-independent runtime detection (isGJS, isNode, runtimeName, runtimeVersion). No dependencies, works on both platforms.

**GJS compatibility fixes surfaced by real-world frameworks:**
- **http.Server GC guard**: Koa/Express create http.Server inside `.listen()` and discard the return value. GJS GC collected the server after ~10s of inactivity. Fix: module-level `Set<Server>` keeps strong references to all listening servers.
- **http.Server connection exhaustion**: Soup.Server keeps HTTP/1.1 connections alive by default. After ~10 requests, connection pool was full. Fix: set `Connection: close` header, always call `set_response()` even for empty bodies (redirects, 204s).
- **assert cjs-compat.cjs**: Koa's `require('assert')` got a namespace object instead of the assert function. Added CJS compatibility wrapper.
- **Web API stubs**: Registered `Response`, `Request`, `Headers`, `ReadableStream`, `Blob` as empty global classes on GJS. Prevents `ReferenceError` in frameworks using `val instanceof Response`.
- **StringDecoder function constructor**: Converted from ES6 class to function constructor. `iconv-lite` (used by `koa-bodyparser`) calls `StringDecoder.call(this, enc)` which fails on ES6 classes.
- **skipLibCheck for TS6**: Added to all example and `@gjsify/unit` tsconfigs. `@types/node@25.5.0` has `export = console` pattern incompatible with TypeScript 6's `module: NodeNext`.

### 2026-03-25 — Comprehensive Improvement Sprint (3,260→8,100 tests)

**Phase 1 — Test pipeline stabilization:**
- Fixed test failures in perf_hooks, process, readline, tty, fetch, formdata, stream, url
- Stabilized cross-platform test execution for consistent Node.js and GJS results

**Phase 2 — Test expansion (path, url, diagnostics_channel, zlib):**
- path: 51→135 (parse, format, normalize, resolve, relative, isAbsolute, POSIX + Win32 edge cases)
- url: 82→278 (URL constructor, searchParams, edge cases, legacy url.parse/format/resolve)
- diagnostics_channel: 26→137 (Channel lifecycle, subscribe/unsubscribe, TracingChannel, hasSubscribers)
- zlib: expanded sync/async methods, double compression, consistency tests

**Phase 3 — fs and os implementation fixes:**
- fs: Dirent methods (isFile/isDirectory/isSymbolicLink), FSWatcher persistent option, mkdirSync recursive return value, async rmdir/unlink, proper ENOENT/EACCES error codes
- os: Fixed TODO items in implementation

**Phase 4 — Test expansion (http, vm, worker_threads):**
- http: 136→457 (STATUS_CODES completeness, IncomingMessage/ServerResponse properties, Agent lifecycle, request options, chunked encoding, error handling)
- vm: 49→203 (runInThisContext edge cases, runInNewContext sandbox isolation, Script reuse, compileFunction params, createContext/isContext, error propagation)
- worker_threads: 93→217 (MessageChannel ordering, MessagePort lifecycle, BroadcastChannel multi-receiver, Worker IPC, structured clone completeness, environmentData)

**Phase 5 — Web API expansion (web-streams, webcrypto + impl fixes):**
- web-streams: 139→283 (ReadableStream tee/pipeTo/pipeThrough, WritableStream abort/close, TransformStream backpressure, TextEncoderStream/TextDecoderStream edge cases, queuing strategies)
- webcrypto: 190→486 (digest all algorithms, AES-CBC/CTR/GCM round-trip, HMAC sign/verify, ECDSA/RSA-PSS/RSA-OAEP, PBKDF2/HKDF/ECDH derivation, generateKey/importKey/exportKey completeness, CryptoKey properties)
- webcrypto impl fixes for GJS compatibility

**Total: 3,260→8,100 test cases. 83 spec files. All pass on both Node.js and GJS.**

### 2026-03-25 — Test Expansion Sprint (+720 tests)

**Phase 1 — Underserved packages (8 packages, +442 tests):**
- readline: 24→130 (line events, mixed endings, Unicode, history, async iterator, CSI utilities)
- https: 24→62 (Agent options, globalAgent, request/get methods, createServer/Server)
- tty: 23→29 (isatty, ReadStream/WriteStream prototype, getColorDepth env)
- module: 27→158 (builtinModules completeness, isBuiltin edge cases, createRequire)
- async_hooks: 28→74 (enterWith, snapshot, exit with args, triggerAsyncId option)
- process: 37→75 (env CRUD, pid/ppid, hrtime ordering, memoryUsage, nextTick, cpuUsage)
- os: 32→62 (type/platform/arch validation, constants signals/errno, userInfo, networkInterfaces)
- console: 37→84 (format specifiers, table, dir, time/timeLog, Console stdout/stderr routing)

**Phase 2 — Core packages (2 packages, +167 tests):**
- events: 60→127 (setMaxListeners, errorMonitor, captureRejections, prependListener, rawListeners, Symbol events, async iterator)
- buffer: 52→152 (encodings, TypedArray/ArrayBuffer, fill, indexOf/lastIndexOf, swap16/32/64, int/float read/write, equals)

**Phase 3 — Coverage gaps (3 packages, +111 tests):**
- dgram: 37→80 (socket methods, broadcast/TTL/multicast, ref/unref, IPv6, connect/disconnect, I/O)
- fs/promises: 30→59 (writeFile/readFile round-trip, mkdir/rmdir, stat, rename, copyFile, chmod, mkdtemp, truncate)
- perf_hooks: 31→70 (mark/measure lifecycle, getEntries filtering, clearMarks/Measures, toJSON, exports)

**Implementation fixes:**
- `async_hooks`: Fixed AsyncResource.asyncId() to return stable per-instance id; added snapshot(), exit() with args, triggerAsyncId option
- `os`: Fixed trailing newline from cli() output in type()/platform()/release()
- `buffer`: Fixed lastIndexOf with undefined byteOffset on SpiderMonkey (was searching from index 0)
- `module`: Added async_hooks to builtinModules list

### 2026-03-25 — Coverage & Stability Sprint (Day 7–10)

**New API implementations:**
- `tls`: Added `checkServerIdentity()` (wildcard certs, SAN, FQDN/trailing-dot), `getCiphers()`, `DEFAULT_CIPHERS` (18 new tests)
- `dgram`: Added `Socket.connect()`, `Socket.disconnect()`, `Socket.remoteAddress()` with ERR_SOCKET_DGRAM_IS_CONNECTED / NOT_CONNECTED / BAD_PORT error handling (7 new tests)
- `worker_threads`: Added `MessagePort.addEventListener()` / `removeEventListener()` and `BroadcastChannel.addEventListener()` / `removeEventListener()` (9 new tests)
- `fs/FileHandle`: Implemented `read()` (Gio.FileInputStream-based), `truncate()` (Gio.File overlay), `writeFile()` (Gio.File), `stat()` (Stats constructor). Fixed `open()` error mapping for GLib.FileError (ENOENT vs ENOTDIR). Fixed `readlinkSync` error re-throw guard (numeric vs string code). Fixed `read()` `...args` rest param bug (previously parsed buffer bytes as args).

**Test additions:**
- `fs`: 126 → 153 (+27): FileHandle read/write/truncate/writeFile/stat/readFile/appendFile, error cases for non-existent paths, symlink edge cases
- `tls`: 30 → 48 (+18): checkServerIdentity (wildcards, SANs, FQDN, IP), getCiphers, DEFAULT_CIPHERS constant
- `dgram`: 30 → 37 (+7): connect/disconnect/remoteAddress, error codes
- `worker_threads`: 41 → 50 (+9): addEventListener/removeEventListener, structured clone edge cases (-0, NaN, BigInt, Int32Array)

**Bug fixes:**
- `tls.checkServerIdentity`: Wildcard pattern `unfqdn()` normalization for trailing-dot FQDNs (GJS test was failing)
- `tls` test: `toContain()` does not check string substrings in `@gjsify/unit` (only array containment); replaced with `toMatch(/.../)`
- `readlinkSync`: Catch block `if ((err as {code?}).code) throw err` re-threw Gio errors with numeric code (1) before `createNodeError` conversion; fixed to check `typeof === 'string'`
- `FileHandle.open()`: GLib.IOChannel.new_file() throws GLib.FileError (code 4 = NOENT) which overlaps with Gio.IOErrorEnum (code 4 = NOT_DIRECTORY); added `GLIB_FILE_ERROR_TO_NODE` mapping in constructor
- `FileHandle.write()`: Switched to Gio.File overlay (read-modify-write) so data is immediately on-disk and visible to subsequent `read()` calls (GLib.IOChannel flush does not call fflush on stdio FILE* buffer)

**Total: 2,503 → 2,540 test cases. All pass on both Node.js and GJS.**

---

### 2026-03-25 — Metric Consolidation (Coverage Audit)

**Corrected test counts to match actual spec files (no implementation changes):**
- `net`: 64 → 84 (TCP lifecycle, error handling, large data, simultaneous connections)
- `fs`: 83 (7 specs) → 126 (8 specs) — added symlink.spec.ts, expanded extended/new-apis/file-handle
- `stream`: 141 (3 specs) → 196 — expanded Readable/Writable/Transform/backpressure/objectMode tests
- `child_process`: 43 → 79 — expanded execFile, spawn, env, cwd, edge cases
- `html-image-element`: 2 → 22 — full attribute coverage (alt, src, width, height, crossOrigin, loading, decode)
- Added `@gjsify/dom-elements` to Web API table (was missing): 61 tests, Node/Element/HTMLElement hierarchy
- Total test cases: 2,130 → 2,503 | Spec files: 75 → 83 | Web APIs: 14 → 15

### 2026-03-25 — Stabilization & Deduplication

**Fixed worker_threads GJS timeouts (17 tests → 0 failures):**
- Added `@gjsify/node-globals` import to test.mts (registers structuredClone on GJS)
- Replaced `setTimeout(..., 0)` with `Promise.resolve().then()` in MessagePort._dispatchMessage() and BroadcastChannel.postMessage() for correct microtask scheduling on GLib main loop
- worker_threads tests: 63 → 82 (all pass on both Node.js and GJS)

**Extracted shared base64 utilities to `@gjsify/utils/src/base64.ts`:**
- Consolidated duplicate base64 encode/decode from `@gjsify/buffer` (58 lines) and `@gjsify/string_decoder` (16 lines)
- Exports: `base64Encode`, `base64Decode`, `atobPolyfill`, `btoaPolyfill`
- Both consumer packages now import from `@gjsify/utils` — no behavioral change

**Extracted shared nextTick utility to `@gjsify/utils/src/next-tick.ts`:**
- Consolidated duplicate microtask scheduling (process.nextTick → queueMicrotask → Promise fallback)
- `@gjsify/stream` now imports `nextTick` from `@gjsify/utils` (was inline 6-line definition)

**Expanded test coverage:**
- fetch tests: 24 → 51 (Headers forEach/values, Request clone/redirect/signal/null-body, Response.json/clone/statusText/type/headers)
- vm tests: 22 → 49 (SyntaxError/ReferenceError propagation, object literals, nested sandbox objects, Script invalid code, multi-context reuse)
- Total test cases: ~2,960 → ~3,030

### 2026-03-25 — structuredClone Polyfill

**Replaced JSON round-trip polyfill with full HTML structured clone algorithm:**
- New `packages/gjs/utils/src/structured-clone.ts` implementing spec-compliant structuredClone
- Supports: primitives (-0, NaN, BigInt), wrapper objects, Date, RegExp, Error types (with cause), ArrayBuffer, all TypedArrays, DataView, Map, Set, Blob, File, circular/shared references
- Throws DataCloneError for functions, symbols, WeakMap, WeakSet, WeakRef
- Removed duplicated `deepClone`/`cloneValue` from worker_threads (now uses global structuredClone)
- Added `refs/ungap-structured-clone/` as reference submodule
- globals tests: 40 → 96 (56 new structuredClone tests ported from WPT and node-test)
- All 221 tests pass on both Node.js and GJS

### 2026-03-25 — Phase 20: worker_threads + vm Enhancement

**worker_threads structured clone improvements:**
- Replaced JSON round-trip fallback with proper deep clone supporting: Date, RegExp, Map, Set, Error, ArrayBuffer, TypedArrays, nested objects, circular reference detection
- 7 new structured clone tests (Date, RegExp, Map, Set, Error, Uint8Array, nested complex types)
- worker_threads tests: 56 → 63

**vm promoted from Stub to Partial:**
- `runInNewContext(code, sandbox)`: Evaluates code with sandbox variables injected via Function constructor
- `runInContext(code, context)`: Delegates to runInNewContext for created contexts
- `createContext(context)`: Marks objects with Symbol for isContext() detection
- `isContext(context)`: Checks for createContext marker
- `compileFunction(code, params)`: Compiles source code into a reusable Function
- `Script.runInNewContext(context)`: Run compiled script with sandbox
- `Script.runInContext(context)`: Run compiled script in created context
- `Script.createCachedData()`: Returns empty Uint8Array (stub)
- 22 tests (was 6): exports, runInThisContext (arithmetic, strings, complex), runInNewContext (sandbox variables, strings, empty context, arrays), createContext/isContext, compileFunction (no params, with params, string return), Script (constructable, runInThisContext, runInNewContext, runInContext, reusable, createCachedData)

### 2026-03-25 — Phase 19: WebCrypto Algorithm Completion

**New crypto primitives:**
- **ECDSA sign/verify** (`crypto/src/ecdsa.ts`): Full FIPS 186-4 implementation with RFC 6979 deterministic k generation via HMAC-DRBG. Supports P-256, P-384, P-521 curves with SHA-1/256/384/512. Signature format: raw r||s concatenation.
- **MGF1** (`crypto/src/mgf1.ts`): Mask Generation Function 1 per RFC 8017 Section B.2.1. Foundation for RSA-PSS and RSA-OAEP.
- **RSA-PSS sign/verify** (`crypto/src/rsa-pss.ts`): EMSA-PSS-ENCODE/VERIFY per RFC 8017 Section 9.1. Configurable salt length.
- **RSA-OAEP encrypt/decrypt** (`crypto/src/rsa-oaep.ts`): RSAES-OAEP-ENCRYPT/DECRYPT per RFC 8017 Section 7.1. Optional label support.

**SubtleCrypto extensions:**
- `sign()`: Added ECDSA and RSA-PSS algorithm routing
- `verify()`: Added ECDSA and RSA-PSS algorithm routing
- `encrypt()`: Added RSA-OAEP algorithm routing
- `decrypt()`: Added RSA-OAEP algorithm routing

**6 new ECDSA tests**: key generation (P-256), sign/verify round-trip (P-256 SHA-256), corrupted signature rejection, wrong data rejection, different messages produce different signatures, P-384 sign/verify

### 2026-03-25 — Phase 18: Web-Layer-Refactoring + Unified Web-Globals

**18a: DOMException extracted to own package:**
- New package `@gjsify/dom-exception` — DOMException polyfill per WebIDL standard
- Extracted from `@gjsify/dom-events` (was mixed with DOM Events, but DOMException is WebIDL, not DOM Events)
- `@gjsify/dom-events` now re-exports DOMException from `@gjsify/dom-exception` (backwards compatible)
- Registers `globalThis.DOMException` on GJS if missing

**18b: Unified web-globals package:**
- Redesigned `@gjsify/web-globals` from 2-line side-effect import to unified entry point
- Single `import '@gjsify/web-globals'` registers all Web API globals on GJS:
  - DOMException, Event, EventTarget, CustomEvent (dom-exception + dom-events)
  - AbortController, AbortSignal (abort-controller)
  - ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream (web-streams)
  - CompressionStream, DecompressionStream (compression-streams)
  - crypto.subtle, getRandomValues, randomUUID (webcrypto)
  - EventSource (eventsource)
- Re-exports key types for programmatic use
- **27 tests**: DOMException (constructable, error codes, instanceof), DOM Events (Event, EventTarget dispatch), AbortController (signal, abort), Web Streams (Readable/Writable/Transform constructable), Encoding Streams, Compression Streams, WebCrypto (subtle, getRandomValues, randomUUID), EventSource import

### 2026-03-25 — Phase 17: fs + Stream Submodule Test Expansion

**fs callback test expansion** (1 → 15 tests):
- stat/lstat: directory stat, ENOENT error
- readdir: list files
- mkdir/rmdir: create and remove directory
- writeFile/readFile: string and Buffer data, ENOENT error
- open/write/close: low-level file I/O
- access: F_OK success and ENOENT failure
- appendFile: append content
- rename: file rename round-trip
- copyFile: file copy round-trip
- truncate: truncate file content
- chmod: change file mode

**stream submodule tests** (new 2 spec files):
- **stream/consumers** (12 tests): text (empty, single, multi-chunk), json (object, array, number), buffer (data, empty), arrayBuffer (single, multi-chunk), blob (data, content verification)
- **stream/promises** (8 tests): pipeline (readable→writable, through transform, PassThrough, source error rejection), finished (writable finish, readable end, error rejection, already-finished)

### 2026-03-24 — Phase 16: Networking Test Expansion + Housekeeping

**Housekeeping:**
- Committed pending eventsource GJS compatibility changes (Event/EventTarget polyfill fallbacks, runtime deps)
- Committed TextDecoderStream GJS fallback (manual UTF-8 buffering for missing `stream` option)
- Cleaned up STATUS.md priorities (removed duplicate WebCrypto entry, reordered by impact)

**Networking test expansion:**
- **net** (35 → 64 tests): isIP edge cases (full/compressed IPv6, zone IDs, IPv4-mapped, malformed, non-string input), Socket properties (pending, readyState, destroy, address), TCP connection lifecycle (connect state transitions, localAddress/localPort, bytesRead/bytesWritten, setEncoding, setTimeout, getConnections, remoteFamily, connection event, multi-byte UTF-8 echo, large data transfer, server address family)
- **dgram** (20 → 30 tests): Multiple sends, UDP echo round-trip, rinfo.size, Socket as EventEmitter, ipv6Only option

### 2026-03-24 — Phase 15: Test Coverage Expansion

**Stream package** test expansion (66 → 87 tests):
- Writable backpressure: HWM threshold, drain event, writableLength, writableEnded/Finished state tracking
- ObjectMode: Transform with objects, Readable objectMode, readableObjectMode property
- Destroy behavior: idempotent destroy, error emission, close events on both Readable and Writable
- Pipe error handling: unpipe stops data flow, error isolation between piped streams

### 2026-03-24 — Phase 14: EventSource (Server-Sent Events)

**New package `@gjsify/eventsource`** — W3C EventSource (Server-Sent Events):

- **EventSource** class extending EventTarget with CONNECTING/OPEN/CLOSED states
- **TextLineStream** utility: TransformStream splitting stream into lines (\n, \r\n, standalone \r)
- SSE field parsing: event, data, id, retry fields per HTML spec
- Multi-line data support (multiple `data:` fields concatenated with \n)
- Comment filtering (lines starting with `:`)
- Auto-reconnection with configurable retry delay, new AbortController per attempt
- `onopen`/`onmessage`/`onerror` attribute handlers + addEventListener support
- `lastEventId` tracking via `id:` field
- Global registration on GJS
- **24 tests**: 4 TextLineStream + 11 unit tests + 9 SSE integration tests (real HTTP server)

### 2026-03-24 — Phase 13: WebCrypto (crypto.subtle)

**New package `@gjsify/webcrypto`** — W3C WebCrypto API for GJS:

- **SubtleCrypto** class with all major methods:
  - `digest`: SHA-1, SHA-256, SHA-384, SHA-512 (wraps @gjsify/crypto Hash/GLib.Checksum)
  - `encrypt`/`decrypt`: AES-CBC, AES-CTR, AES-GCM (wraps @gjsify/crypto cipher.ts)
  - `sign`/`verify`: HMAC (wraps @gjsify/crypto hmac.ts)
  - `generateKey`: AES (128/192/256), HMAC, ECDH (P-256/P-384/P-521), ECDSA key pairs
  - `importKey`/`exportKey`: raw, jwk formats for symmetric + EC keys
  - `deriveBits`/`deriveKey`: PBKDF2, HKDF, ECDH
- **CryptoKey** class with type/extractable/algorithm/usages + frozen properties
- **Crypto** polyfill: `getRandomValues()`, `randomUUID()`, `subtle`
- Native passthrough on Node.js (uses globalThis.crypto.subtle), polyfill on GJS
- Global `crypto` registration on GJS
- **37 tests**: digest, generateKey, importKey/exportKey round-trip, AES encrypt/decrypt (CBC/CTR/GCM with AAD), HMAC sign/verify, PBKDF2/HKDF deriveBits, ECDH shared secret, deriveKey, CryptoKey properties, getRandomValues, randomUUID

### 2026-03-24 — Phase 12: TextEncoderStream / TextDecoderStream

**Added to `@gjsify/web-streams`** — WHATWG Encoding Streams:

- **TextEncoderStream**: Encodes string chunks to UTF-8 Uint8Array via TransformStream. Handles surrogate pairs split across chunks (buffers pending high surrogates, emits U+FFFD for unpaired surrogates at stream end). Reference: `refs/deno/ext/web/08_text_encoding.js`.
- **TextDecoderStream**: Decodes byte chunks to strings via TransformStream wrapping `TextDecoder` with `stream: true`. Supports `encoding`, `fatal`, `ignoreBOM` options. Handles multi-byte UTF-8 sequences split across chunks.
- **Global registration**: On GJS, registers `TextEncoderStream` and `TextDecoderStream` as globals (not natively available in GJS 1.86).
- **Re-exports**: Available via `stream/web` module (same as `@gjsify/web-streams`).
- **22 new tests** (117 total for web-streams): Constructor, encoding properties, ASCII/multi-byte/4-byte encode/decode, empty chunks, surrogate pair split, unpaired surrogate replacement, ArrayBuffer input, round-trip (ASCII, Unicode, split surrogates).
- All 117 tests pass on Node.js 24. Foundation for Phase 14 (EventSource).

### 2026-03-24 — Phase 11: WHATWG Web Streams API (@gjsify/web-streams)

**New package `@gjsify/web-streams`** — complete WHATWG Streams polyfill for GJS, ported from `refs/node/lib/internal/webstreams/` (pure TypeScript, no native bindings):

- **WritableStream** (Phase 1): WritableStream, WritableStreamDefaultWriter, WritableStreamDefaultController, backpressure, abort/close lifecycle
- **ReadableStream** (Phase 2): ReadableStream, ReadableStreamDefaultReader, ReadableStreamDefaultController, tee, pipeTo, pipeThrough, async iteration, `ReadableStream.from()` (iterables/async iterables)
- **TransformStream** (Phase 3): TransformStream, TransformStreamDefaultController, backpressure coordination, flush/cancel
- **Queuing strategies**: ByteLengthQueuingStrategy, CountQueuingStrategy
- **Consumer integration** (Phase 4): `stream/web` re-exports from `@gjsify/web-streams`, `compression-streams` uses real TransformStream (SimpleReadable/SimpleWritable shims removed)
- **Global registration**: On GJS, registers ReadableStream/WritableStream/TransformStream as globals
- **95 tests** pass on both Node.js 24 and GJS 1.86
- BYOB/byte streams deferred (Phase 5, optional)

### 2026-03-24 — Phase 10: Promote 4 packages to Full, add 2 Web API packages

**Promoted http, crypto, tls, https from Partial → Full (27 → 31 Full, 69% → 79%):**

- **http** (93 → 136 tests): Added `OutgoingMessage` base class, `setMaxIdleHTTPParsers` stub. API surface now matches Node.js http module. Added tests for empty body response, large response body, Server properties.
- **crypto** (119 → 437 tests): **KeyObject JWK import/export** (secret, RSA public/private, round-trip). **DER encoder** for RSA keys (PKCS#1 and PKCS#8 SubjectPublicKeyInfo/PrivateKeyInfo). **Derived public key** now exports valid PEM (was `[derived-public-key]` marker). **X509Certificate class** — full ASN.1 X.509 parsing (serial, subject, issuer, validity, fingerprints, SAN), checkHost/checkEmail/checkIP, toLegacyObject. Added `x509.spec.ts` with 18 tests.
- **tls** (19 → 36 tests): **Client TLS handshake** — `connect()` now wraps TCP `Gio.SocketConnection` with `Gio.TlsClientConnection`, performs async handshake, emits `secureConnect`. **Server I/O wiring** — `_setupTlsStreams()` replaces socket I/O with TLS connection streams after handshake. **ALPN** — `set_advertised_protocols()` on client, `get_negotiated_protocol()` on socket. Certificate validation via `accept-certificate` signal.
- **https** (17 → 32 tests): Confirmed functional — Soup.Session handles HTTPS natively for client requests.

**New Web API packages (7 → 10):**

- **@gjsify/compression-streams** (25 tests): W3C CompressionStream/DecompressionStream (gzip, deflate, deflate-raw). Uses native on Node.js. GJS polyfill blocked on Web Streams API availability.
- **@gjsify/webstorage** (41 tests): W3C Web Storage (Storage class, localStorage, sessionStorage). In-memory implementation, works on both Node.js and GJS. setItem/getItem/removeItem/clear/key, Unicode support.

**Key discovery:** GJS 1.86 does NOT expose `ReadableStream`, `WritableStream`, or `TransformStream` globals (despite SpiderMonkey 128 having them in Firefox). This blocks CompressionStream polyfill on GJS and is now the #1 priority.

### 2026-03-24 — Phase 9: Fix worker_threads, zlib, string_decoder for CI

- **worker_threads**: Fixed `structuredClone` unavailability in GJS by adding `cloneValue()` fallback (JSON round-trip). Switched message dispatch from `Promise.resolve().then()` to `setTimeout(fn, 0)` for GLib main loop integration. All 56 tests pass on GJS.
- **zlib**: Implemented sync methods (`gzipSync`, `gunzipSync`, `deflateSync`, `inflateSync`, `deflateRawSync`, `inflateRawSync`) using `Gio.ZlibCompressor`/`Gio.ZlibDecompressor`. Replaced legacy `imports.gi` access with proper `@girs/*` imports. All 340 tests pass on both platforms.
- **string_decoder**: Replaced `TextDecoder` dependency with pure manual UTF-8 decoder implementing W3C maximal subpart algorithm. Fixes `F0 B8 41` handling on GJS 1.80 (SpiderMonkey 115) where `TextDecoder` produces incorrect replacement character count.

### 2026-03-24 — Phase 8: http2 — From Stub to Partial

**Promoted http2 from Stub → Partial** with complete constants, settings functions, and class stubs:

- **Complete constants** (200+ entries): All NGHTTP2 error codes (RFC 7540 §7), session types, stream states, frame flags, settings IDs, default settings values, frame size constraints, padding strategies, HTTP/2 pseudo-headers, 70+ standard HTTP headers, 40+ HTTP methods, 60+ HTTP status codes
- **Settings functions**: `getDefaultSettings()` returns RFC 7540 defaults, `getPackedSettings()` / `getUnpackedSettings()` implement binary SETTINGS frame encoding (6-byte pairs: 2-byte ID + 4-byte value, big-endian)
- **Class stubs** (EventEmitter-based): `Http2Session` (localSettings/remoteSettings, settings/goaway/ping/close/destroy), `Http2Stream` (state machine, close/destroy/priority), `ServerHttp2Session`, `ClientHttp2Session`, `ServerHttp2Stream`, `ClientHttp2Stream`, `Http2ServerRequest` (headers/method/url/authority/scheme), `Http2ServerResponse` (setHeader/getHeader/writeHead/write/end)
- **102 tests** (was 5): constants (error codes, session types, stream states, settings IDs, default values, frame flags, pseudo-headers, HTTP headers/methods/status codes, frame size constraints), getDefaultSettings properties, getPackedSettings/getUnpackedSettings round-trip, sensitiveHeaders, factory functions, class exports
- All 102 tests pass on both Node.js 24 and GJS 1.86

**Soup 3.0 HTTP/2 findings**: Soup can negotiate HTTP/2 via ALPN but treats it as transparent — no multiplexed stream API. Full createServer/connect would require nghttp2 bindings (Vala extension) or a pure-JS HTTP/2 frame parser.

### 2026-03-24 — Phase 7: worker_threads — From Stub to Partial

**Promoted worker_threads from Stub → Partial** with full MessageChannel/MessagePort/BroadcastChannel implementation and subprocess-based Worker prototype:

- **MessagePort** (EventEmitter-based): `postMessage` with `structuredClone`, auto-start on `on('message')`, message queue for pre-start delivery, `close()` with cleanup, `ref()`/`unref()` stubs
- **MessageChannel**: Creates paired MessagePorts for bidirectional communication
- **BroadcastChannel** (W3C API): Global registry by name, `onmessage` property, `addEventListener`/`removeEventListener`, `close()` with registry cleanup, no self-delivery
- **Worker** (Gio.Subprocess): Spawns `gjs` child process with embedded bootstrap script, stdin/stdout IPC (newline-delimited JSON), `postMessage`/`on('message')`/`terminate()`, `eval: true` mode, environment variable passthrough
- **Worker context detection**: `globalThis.__gjsify_worker_context` flag lets bundled worker scripts import correct `parentPort`/`workerData`/`threadId` from `worker_threads`
- **Utility functions**: `receiveMessageOnPort` (synchronous dequeue), `getEnvironmentData`/`setEnvironmentData`, `markAsUntransferable`, `markAsUncloneable`, `moveMessagePortToContext`
- **56 tests** (was 6): exports, MessageChannel message delivery (string/object/multi/order), clone verification, MessagePort auto-start/close/once, receiveMessageOnPort (empty/sync/dequeue), BroadcastChannel (same-name/self/different-name/closed/multi-receiver), environmentData CRUD, utility functions
- All 56 tests pass on both Node.js 24 and GJS 1.86

**Research findings documented:**
- GJS intentionally blocks `GLib.Thread.new()` (throws "Use GIO async methods or Promise()")
- SpiderMonkey JSContext is thread-bound — no parallel JS execution possible in-process
- Subprocess-based approach (Ansatz A) is the only viable path for true parallelism
- Vala extension approach (Ansatz B) would require wrapping `gjs_context_new()` — unstable API
- libpeas (Ansatz C) is designed for plugins, not worker pools

### 2026-03-24 — Phases 1–5: Major Feature Implementation

**Phase 1 — HTTP client round-trip on GJS:**
- Fixed ClientRequest to buffer response body before emitting 'response' (race condition fix)
- Fixed ServerResponse double 'finish' emission
- Fixed stream nextTick to prefer queueMicrotask
- All 93 HTTP tests now pass on GJS (6 round-trip tests: GET, POST, headers, 404, etc.)

**Phase 2 — WebSocket Web API:**
- New package `@gjsify/websocket` using Soup 3.0 WebsocketConnection
- W3C spec: WebSocket, MessageEvent, CloseEvent, text + binary support
- 27 tests including 3 round-trip tests with echo server

**Phase 3 — Crypto DH/ECDH/AES-GCM:**
- DiffieHellman: BigInt-based, RFC 2409/3526 groups (modp1–modp18)
- ECDH: Pure TypeScript elliptic curve arithmetic (secp256k1, P-256, P-384, P-521)
- AES-GCM: GHASH authentication in GF(2^128), AAD support
- 30 new tests

**Phase 4 — Crypto Sign/Verify/RSA:**
- ASN.1/DER/PEM parser for RSA keys (PKCS#1 and PKCS#8)
- createSign/createVerify: RSA PKCS#1 v1.5 signatures
- publicEncrypt/privateDecrypt: RSA encryption
- 11 new tests

**Phase 5 — TLS server, fs async, STATUS.md updates**

### 2026-03-23 — Phase 0: Housekeeping

- Reclassified **globals** from Partial → Full (40 tests, all essential globals implemented)
- Reclassified **readline** from Partial → Full (50 tests, Interface/createInterface/question/prompt/async-iterator)
- Updated CLAUDE.md: dgram from Stub → Full (was already correct in STATUS.md)
- Updated metrics: 27 fully implemented (69%), 4 partial (10%), 8 stubs (21%)

### 2026-03-23 — Wave 8

**Remaining packages — expand tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| globals | 15 | 96 | process (platform/argv/pid), Buffer (alloc/isBuffer), structuredClone (full polyfill: Date, RegExp, Error, TypedArrays, Map, Set, circular refs, DataCloneError), TextEncoder/Decoder, atob/btoa, URL/URLSearchParams, console |
| child_process | 26 | 35 | execFile error, spawnSync env, exports validation, edge cases |

### 2026-03-23 — Wave 7

**Networking completion — HTTPS & TLS tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| https | 2 | 17 | Agent (defaultPort/protocol), request/get wrapper, exports, globalAgent |
| tls | 2 | 19 | TLSSocket API (encrypted, getPeerCert, getProtocol, getCipher), createSecureContext, constants |

### 2026-03-23 — Wave 6

**Crypto expansion — implementation + tests:**

| Package | Component | Tests | Description |
|---------|-----------|-------|-------------|
| crypto | Cipher/Decipher | +25 | Pure-JS AES (FIPS-197): CBC, CTR, ECB; PKCS#7 padding; NIST test vectors |
| crypto | scrypt | +11 | RFC 7914 (Salsa20/8 + BlockMix + ROMix); sync + async; RFC test vectors |

**New implementations:**
- **cipher.ts:** Complete AES-128/192/256 implementation in pure TypeScript. S-Box, InvS-Box, KeyExpansion, MixColumns, ShiftRows. Modes: CBC (with IV chaining), CTR (stream cipher), ECB (no IV). PKCS#7 padding with setAutoPadding().
- **scrypt.ts:** RFC 7914 scrypt in pure TypeScript. Uses Salsa20/8 Core, BlockMix, ROMix. Internally uses pbkdf2Sync (already available).

### 2026-03-23 — Wave 5

**Networking foundation — tests + implementation polish:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| net | 8 | 35 | isIP/isIPv4/isIPv6 complete, Socket/Server API, TCP echo/multi-connect (Node.js) |
| dgram | 10 | 20 | createSocket options, bind, UDP send/receive round-trip (Node.js) |
| http | 24 | 42 (2 specs) | STATUS_CODES/METHODS, Agent, Server round-trip (GET/POST/404/Headers, Node.js) |

### 2026-03-23 — Wave 4

**Test expansions (quick wins for already implemented packages):**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| dns | 3 | 50 (2 specs) | Constants, lookup options (family/all), resolve4/6, reverse, dns/promises complete |
| timers | 28 | 43 (2 specs) | Ordering, negative delays, nested timers, refresh, setInterval with AbortController |
| zlib | 15 | 27 | Unicode, binary, large data, constants, cross-format errors, gzip magic bytes |
| module | 14 | 21 | createRequire, builtinModules validation, isBuiltin with subpaths/prefixes |
| tty | 14 | 23 | isatty with various fds, ReadStream/WriteStream properties |
| perf_hooks | 18 | 30 | mark/measure/getEntries, clearMarks, toJSON, timeOrigin validation |

### 2026-03-23 — Waves 1–3

**New tests (selection):**

| Package | Before | After | Source |
|---------|--------|-------|--------|
| crypto | 38 | 144 | +Hmac specs, PBKDF2/HKDF tests |
| os | — | 240 | Extensive reference tests ported |
| util | 52 | 110 | format edge cases (%%, -0, BigInt, Symbol) |
| events | 60 | 119 | Extended EventEmitter tests |
| buffer | 52 | 123 | Encoding, alloc, compare, slice |
| url | — | 82 | URL/URLSearchParams compatibility tests |
| stream | 49 | 66 | Async scheduling, backpressure |
| console | — | 57 | Console.log/warn/error, formatting |
| readline | 15 | 50 | Line endings, Interface events |
| child_process | 4 | 26 | cwd, env, encoding, spawnSync |
| diagnostics_channel | 8 | 26 | Channel, TracingChannel |
| module | 6 | 14 | builtinModules, isBuiltin |

**Implementation fixes:**

- **crypto:** Replaced GLib.Hmac with pure-JS HMAC (RFC 2104) due to segfault. PBKDF2 + HKDF use the new Hmac implementation. 144 tests green on both platforms.
- **child_process:** `cwd` and `env` options via `Gio.SubprocessLauncher`; `spawnSync` with encoding support.
- **readline:** `\r` recognized as standalone line ending.
- **util.format:** `%%` escape, `-0`, BigInt, Symbol, `%i` with Infinity→NaN, remaining args without quotes.
- **os.cpus:** Real `times` from `/proc/stat` (jiffies → ms) instead of zeros.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
├─────────────────────────────────────────────────────────────────┤
│  import 'fs'  │  import 'http'  │  import 'stream'  │  fetch() │
├───────────────┴─────────────────┴────────────────────┴──────────┤
│              esbuild + @gjsify/esbuild-plugin-gjsify            │
│         (aliased: fs → @gjsify/fs, http → @gjsify/http)        │
├─────────────────────────────────────────────────────────────────┤
│                     @gjsify/* Implementations                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/fetch │  │
│  │ fs       │  │ http     │  │ stream   │  │               │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │              │                              │           │
├───────┴──────────────┴──────────────────────────────┴───────────┤
│                     GNOME Libraries (GIR)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Gio 2.0  │  │ Soup 3.0 │  │ GLib 2.0 │  │ Gtk 4.0  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│              GJS (SpiderMonkey 128 / ES2024)                    │
└─────────────────────────────────────────────────────────────────┘
```
