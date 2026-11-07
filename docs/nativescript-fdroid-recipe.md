# F-Droid recipe draft — `org.gjsify.NsGiTest`

> Status: draft, not filed. This doc prepares the evidence and a metadata recipe for the
> smallest gjsify NativeScript Android sample so the upstream question can be filed by hand.
> Do not open issues or PRs at F-Droid or NativeScript from an agent.

## What this is for

The gjsify NativeScript bridge can produce an Android APK that runs real GJS-style
GObject-Introspection code on the device. Before any real store submission, we need to know
whether F-Droid will accept the prebuilt V8 runtime that NativeScript ships inside
`@nativescript/android`. The Jitsi Meet recipe already accepts equivalent Hermes and JSC
prebuilts via `scanignore`; the question is whether NativeScript V8 can be treated the same way.

This draft targets the smallest app that exercises the full stack:

| Field | Value | Source |
|---|---|---|
| Application ID | `org.gjsify.NsGiTest` | [`tests/integration/nativescript-gi/nativescript.config.ts`](../tests/integration/nativescript-gi/nativescript.config.ts) |
| Version code / name | `1` / `1.0.0` | [`tests/integration/nativescript-gi/App_Resources/Android/app.gradle`](../tests/integration/nativescript-gi/App_Resources/Android/app.gradle) |
| NativeScript Android runtime | `@nativescript/android@9.1.1` | [`tests/integration/nativescript-gi/package.json`](../tests/integration/nativescript-gi/package.json) |
| GI runtime plugin | `@gjsify/gi-runtime-android` (local `file:` dep) | same `package.json` |
| Monorepo version | `0.64.6` | [`package.json`](../package.json) |

## The upstream question to file by hand

**Title:** `Upstream (F-Droid / NativeScript, file by hand): treat NativeScript V8 like Hermes`

**Repo:** `gjsify/gjsify`

NativeScript's Android runtime is Apache-2.0 and its full source is available, but the release
AAR contains a prebuilt V8 monolith. At `NativeScript/android@9.1.1` the V8 libraries are not
built in-tree; they are downloaded from `NativeScript/v8-buildscripts` releases by
[`download_v8.sh`](https://github.com/NativeScript/android/blob/9.1.1/download_v8.sh). The
F-Droid inclusion policy tolerates prebuilt SDKs and Node.js npm prebuilts where no Debian
package exists, and `org.jitsi.meet.yml` already uses `scanignore` for `node_modules/hermes-engine`
and `node_modules/jsc-android` (see precedent below). We need a reviewer ruling on whether the
same tolerance applies to `node_modules/@nativescript/android`.

## Binary inventory in the build tree

The following binaries end up in the APK. The ones marked **prebuilt** are the reason the
upstream question matters.

| Binary | Ships in | Built by this repo? | Source |
|---|---|---|---|
| `libNativeScript.so` (arm64-v8a, x86_64) | `@nativescript/android` optimized AAR | **No** — prebuilt V8 + NS runtime | [`NativeScript/android@9.1.1` `nativescript-optimized.aar`](https://www.npmjs.com/package/@nativescript/android/v/9.1.1) |
| `widgets-release.aar` | `@nativescript/core` | **No** — prebuilt UI widgets, no native code | [`@nativescript/core@9.1.3`](../tests/integration/nativescript-gi/package.json) |
| `libnode_gi.so` + GI closure (`libglib-2.0.so`, `libgobject-2.0.so`, …) | `@gjsify/gi-runtime-android` AAR | **Yes** — cross-compiled from source | [`packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs`](../packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs) |
| Typelibs (`GLib-2.0.typelib`, `Gio-2.0.typelib`, …) | same AAR | **Yes** — generated from same GI prefix | same build script |

`@gjsify/gi-runtime-android` does download two pinned prebuilt inputs, but neither is bundled
as-is:

- the `@nativescript/android` optimized AAR is used only as the Node-API link target;
- the `gjsify/android-sysroot` release is a hand-built GLib/GObject/Gio prefix used as the
  cross-compile sysroot.

Both are pinned by SHA-256 in
[`packages/node-gi/gi-runtime-android/build-inputs.json`](../packages/node-gi/gi-runtime-android/build-inputs.json)
and verified by
[`packages/node-gi/gi-runtime-android/scripts/fetch-build-inputs.mjs`](../packages/node-gi/gi-runtime-android/scripts/fetch-build-inputs.mjs).

## Proposed F-Droid metadata YAML

This is a **draft**. Fields like `License`, `Categories`, `AuthorName`, `AuthorEmail`, and the
`commit:` value should be replaced with the real publishing values before any submission.

```yaml
Categories:
  - Development
License: MIT
AuthorName: <FIXME>
AuthorEmail: <FIXME>
SourceCode: https://github.com/gjsify/gjsify
IssueTracker: https://github.com/gjsify/gjsify/issues

RepoType: git
Repo: https://github.com/gjsify/gjsify.git

Builds:
  - versionName: 1.0.0
    versionCode: 1
    commit: v0.64.6
    subdir: tests/integration/nativescript-gi
    sudo:
      - apt-get update
      - apt-get install -y curl unzip
      - mkdir -p /usr/local/lib/nodejs
      - curl -Lo node.tar.xz https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz
      - echo "454367ab5b1de7c4ba41b0742835f49e6f6e501b3fd3c7d1d65e8b4b41e83124  node.tar.xz"
        | sha256sum -c -
      - tar -xf node.tar.xz -C /usr/local/lib/nodejs
      - ln -sf /usr/local/lib/nodejs/node-v20.18.0-linux-x64/bin/* /usr/local/bin/
      - corepack enable
    init:
      - $$SDK$$/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" > /dev/null
      - cd ../../.. && yarn install --immutable
      - cd ../../.. && yarn build
    output: platforms/android/app/build/outputs/apk/debug/app-debug.apk
    build:
      - npm install --no-audit --no-fund
      - node scripts/compile-schemas.mjs
      - npx nativescript prepare android --no-hmr --disable-npm-install
      - |
        distOut=".ns-vite-build/android"
        assetsApp="platforms/android/app/src/main/assets/app"
        mkdir -p "$assetsApp"
        rm -f "$assetsApp"/*.mjs "$assetsApp"/*.map
        cp "$distOut"/*.mjs "$distOut"/*.map "$assetsApp/"
      - cd platforms/android && ./gradlew assembleDebug -q
    scandelete:
      - node_modules
      - ../../node_modules
    scanignore:
      - node_modules/@nativescript/android
      - node_modules/@nativescript/core

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: 1.0.0
CurrentVersionCode: 1
```

### Why these build steps

1. `npm install` in the sample directory installs the NativeScript CLI, the `@nativescript/*`
   runtimes, and the local `file:` dependencies into `node_modules`. The local deps are already
   built by the root `yarn build` in `init`.
2. `nativescript prepare android --no-hmr --disable-npm-install` runs the Vite bundle. The sample
   is excluded from the root Yarn workspace, so `--disable-npm-install` prevents the CLI from
   re-running a workspace install.
3. NativeScript's non-watch Vite build does not copy the bundle into the Android assets directory
   (measured in [`tests/integration/nativescript-gi/scripts/run-on-device.mjs`](../tests/integration/nativescript-gi/scripts/run-on-device.mjs)),
   so the recipe copies `.ns-vite-build/android/*.mjs` and `*.map` into
   `platforms/android/app/src/main/assets/app/` before invoking Gradle.
4. `assembleDebug` produces an unsigned APK that F-Droid can sign. The debug runtime is fine for
   this draft; a release build would need the same `scanignore` ruling.

## Hermes / JSC precedent

`org.jitsi.meet.yml` in F-Droid's `fdroiddata` repository carries:

```yaml
scanignore:
  - node_modules/hermes-engine
  - node_modules/jsc-android
```

That is the direct precedent for tolerating a JS engine prebuilt shipped as an npm package.
NativeScript's V8 is in the same category: a runtime engine distributed as a pinned npm
prebuilt. The difference is that NativeScript also exposes native extension APIs, but the
binary itself is still a downloaded prebuilt rather than something built from source during the
F-Droid build.

## Evidence file index

Every claim above is backed by a file in this checkout:

- App identity and version: [`tests/integration/nativescript-gi/nativescript.config.ts`](../tests/integration/nativescript-gi/nativescript.config.ts),
  [`tests/integration/nativescript-gi/App_Resources/Android/app.gradle`](../tests/integration/nativescript-gi/App_Resources/Android/app.gradle)
- Dependency versions: [`tests/integration/nativescript-gi/package.json`](../tests/integration/nativescript-gi/package.json)
- Workspace build / exclusion: [`package.json`](../package.json)
- GI runtime build from source: [`packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs`](../packages/node-gi/gi-runtime-android/scripts/build-gi-runtime-android.mjs)
- Pinned build inputs: [`packages/node-gi/gi-runtime-android/build-inputs.json`](../packages/node-gi/gi-runtime-android/build-inputs.json)
- Input fetch + digest verification: [`packages/node-gi/gi-runtime-android/scripts/fetch-build-inputs.mjs`](../packages/node-gi/gi-runtime-android/scripts/fetch-build-inputs.mjs)
- NativeScript V8 download script (upstream): [`NativeScript/android@9.1.1` `download_v8.sh`](https://github.com/NativeScript/android/blob/9.1.1/download_v8.sh)
- On-device runner that validates the prepare/copy/gradle flow: [`tests/integration/nativescript-gi/scripts/run-on-device.mjs`](../tests/integration/nativescript-gi/scripts/run-on-device.mjs)
- Vite config / defines: [`tests/integration/nativescript-gi/vite.config.ts`](../tests/integration/nativescript-gi/vite.config.ts)

## Validation

The YAML block in this doc was extracted and checked with:

```bash
fdroid readmeta
fdroid lint
```

Only warnings/errors related to the placeholder metadata (license, author e-mail, missing
screenshots, etc.) are expected; no structural YAML or required-field errors.

## Open questions before filing

1. Confirm the real license and author metadata for the sample app (`package.json` says MIT,
   but a shipping app may switch to AGPL).
2. Decide whether to build a debug APK (simplest, unsigned) or a release APK with signing
   disabled for F-Droid.
3. Verify that F-Droid's build server has a Yarn/Corepack setup compatible with the gjsify
   monorepo, or replace the root `yarn install --immutable && yarn build` with the gjsify
   bootstrap (`gjs -m install.mjs && gjsify install --immutable && gjsify run build:infra`).
4. Get the reviewer ruling on `scanignore` for `@nativescript/android` before expanding this
   draft into a real `metadata/org.gjsify.NsGiTest.yml`.
