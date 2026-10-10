# node-gi inside a NativeScript Android app — 2026-10-10

Stage 3 of [ADR 0104](../adr/0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md):
which Node-API host can carry node-gi on Android? The ADR assumed there was none in NativeScript
and planned to measure a patched NativeScript runtime against QuickJS + napi and Hermes. That
premise is out of date, and the measurement below answers the question for NativeScript directly.

## The premise changed: NativeScript Android ships Node-API

NativeScript Android implements Node-API since **9.1.0** (2026-08-27; PR NativeScript/android#2004,
merged 2026-08-14). The runtime's `docs/node-api.md` says the implementation is Node v26.7.0's own
`js_native_api` sources, vendored unmodified, with only the libuv- and loader-dependent parts of
`node_api.h` reimplemented on the runtime's per-thread Android looper. `libNativeScript.so` in
`@nativescript/android` 9.1.1 exports 145 `napi_*` symbols, and the AAR carries the headers as a
prefab module (`prefab/modules/NativeScript/include/{node_api,js_native_api}*.h`).

Our `refs/nativescript-android` is pinned at `v9.0.5` (V8 10.3), before the Node-API work; 9.1.x
runs V8 14. The ADR's context line "`refs/nativescript-android` contains no `node_api.h`" was true
of the ref, not of the released runtime.

The divergences that matter for node-gi, quoted from that table:

| API | Behaviour on NativeScript Android |
|---|---|
| `napi_get_uv_event_loop` | Always `napi_generic_failure` — "There is no `uv_loop_t`. The runtime drives an Android Looper" |
| `napi_create_buffer*` | Produce a plain `Uint8Array`; `napi_is_buffer` is exactly "is this a `Uint8Array`" |
| `napi_ref/unref_threadsafe_function` | Track the flag, affect nothing |
| finalizers (`napi_wrap`, `napi_add_finalizer`, …) | Never run during GC; drained on a later looper turn |

The alternatives the ADR listed are no longer needed for track B:

- **wasmerio/napi** (MIT, the `napi` submodule of `refs/edgejs`) is a standalone Node-API-on-V8
  layer without libuv. Against NativeScript 9.0.5's V8 10.3 headers its `js_native_api_v8.cc` fails
  with 27 errors, all V8 API drift (`ArrayBuffer::Data`, `SetPrototypeV2`, `WasDetached`,
  `Float16Array`, `ScriptOrigin`); its internal wrappers compile clean. It would have been the
  base for a patched runtime. 9.1 made it moot.
- **QuickJS + napi, Hermes**: not measured. NativeScript is the host gjsify already targets
  (the fourth runtime slot), and it works.

## Result

node-gi's unchanged C++ sources, cross-compiled with the NDK, load in a stock NativeScript 9.1.1
app (`ns create`, `@nativescript/core` 9.1) through `require('system_lib://libnode_gi.so')`.
No fork of the runtime, no patched `node-gi` source. Emulator `Tablet_API_36` (Android 16),
debug build:

| Check | x86_64 | arm64 (translated on the x86_64 emulator) |
|---|---|---|
| stock `NAPI_MODULE` hello addon, `add(2, 40)` | 42, `require` 0.6 ms | 42, 19.6 ms |
| `require` `libnode_gi.so` | 3.6 ms, 73 exports | 46.9 ms |
| `requireNamespace` GLib / GObject / Gio / cairo | 0.09 / 0.04 / 0.06 / 0.03 ms | 13.1 / 0.46 / 2.9 / 0.28 ms |
| `GLib.get_user_name()` | `u0_a223` | `u0_a224` |
| `GLib.compute_checksum_for_string(SHA256, "abc")` | `ba7816bf…f20015ad` (correct) | same |
| `Gio.file_new_for_path(…)` → `get_basename()`, type | `GLib-2.0.typelib`, `GLocalFile` | same |
| `startMainLoop()` (the libuv bridge) | fails as designed: `failed to obtain the libuv event loop` | same |
| `Gio.File.load_contents_async` + `_finish`, pumped by `iterateMainContext` from a 4 ms `setInterval` | 230 588 bytes, callback after 333 ms | 230 588 bytes, after 877 ms |
| cold start (`am start -W`) | 1008 ms | 4450 ms |
| PSS after start | 122 MB | 279 MB |
| APK, one ABI | 57 MB | 55 MB |

The arm64 column runs under the emulator's ARM translation; its times are an upper bound, not an
arm64 device figure. The async latency includes the UI start — `Application.run` occupies the JS
thread while the callback waits — so it does not measure the pump. No PSS baseline without
node-gi was taken.

The headless GI closure of `libnode_gi.so` is 14 libraries, 17–18 MB per ABI after
`llvm-strip --strip-debug`: `libgirepository-2.0 libgobject-2.0 libglib-2.0 libgio-2.0
libgmodule-2.0 libcairo libcairo-gobject libffi libintl libpng16 libfontconfig libfreetype
libpixman-1 libxml2`. cairo pulls in five of them (pixman alone is 4.4 MB on x86_64). Seven
typelibs (GLib, GLibUnix, GObject, GModule, Gio, GioUnix, cairo) are 696 KB.

## What node-gi needs for NativeScript

Nothing in the spike patched node-gi's C++. Each item below is a change for node-gi itself, made
there with a test (stage 4), not a consumer workaround.

**Update:** items 1–4 are done (commits "pump GLib via ALooper on Android", "load under NativeScript
Android", "make NativeScript hook discoverable", "add Android build script"); item 1 became a
compile-time guard, not `dlsym`. Items 5 and 6 are open. See the
[stage 4 report](2026-10-10-node-gi-android-stage-4.md).

1. **The libuv symbols must not be link-time imports.** node-gi's bridge in `src/loop.cc`
   references 20 `uv_*` functions. On Linux they bind lazily, so Deno — which exports no libuv —
   only fails if `startMainLoop` is called. Bionic binds every symbol at `dlopen`, so on Android
   the library would not load at all. The spike linked abort stubs (below). The fix is to resolve
   them at run time (`dlsym`) once `napi_get_uv_event_loop` succeeds, or compile the bridge out on
   Android.
2. **A looper pump instead of a timer.** On NativeScript node-gi takes the path Bun and Deno use:
   `iterateMainContext` from a JS timer. That works, but polls. The runtime drives an Android
   looper, so the natural integration adds GLib's poll fds to it (`g_main_context_query` →
   `ALooper_addFd`), the inverse of the libuv bridge.
3. **The JS layer.** `index.js` and `gi.js` detect Node, Bun, Deno and GJS; NativeScript is none of
   them, and the loader reads `node:fs`/`node:path` to find a prebuild. The spike called the
   native exports directly. A NativeScript runtime branch is needed, with
   `system_lib://libnode_gi.so` as the load path.
4. **`HOME` and `XDG_*`.** Unset in an app process, so `GLib.get_user_data_dir()` returns
   `/data/.local/share`, which is not writable. They must point into the app's files dir before
   GLib's first call — the GDK Android runtime does this for pixiewood apps; a NativeScript host
   has to do it itself.
5. **Buffers are `Uint8Array`.** node-gi creates buffers in `marshal.cc`, `object.cc`,
   `variant.cc` and `class.cc`. On NativeScript they arrive as plain `Uint8Array`; byte content is
   the same, but code that checks `Buffer.isBuffer` sees false. Not exercised by this probe.
6. **Packaging.** The `.so` closure and the typelibs as a NativeScript plugin (AAR + typelibs
   under `app/`), built from the pixiewood tree. NativeScript's `build.gradle` replaces
   `jniLibs.srcDirs`, so an app's own `src/main/jniLibs` is dropped unless it is re-added (below).

Two linking pitfalls cost a rebuild each:

- **Link against the AAR flavor the APK ships.** The `regular` AAR's `libNativeScript.so` exports
  `__gxx_personality_v0`; the `optimized` one the debug APK packs does not. Linked against
  `regular`, `libnode_gi.so` failed at run time with
  `dlopen failed: cannot locate symbol "__gxx_personality_v0"`. Against `optimized`,
  `-static-libstdc++` pulls libc++abi in and only libc, GLib, cairo, libffi and Node-API symbols
  stay undefined.
- **`-Pabis` and `abiFilters` do not combine.** An `ndk { abiFilters … }` in `app.gradle`
  overrides the `-Pabis=…` property NativeScript's `build.gradle` reads. Use only `-Pabis`.

## For the ADR

Stage 3's question — which Node-API host — is answered: NativeScript's own, from 9.1.0. Track B
does not need a pixiewood process; it runs inside the NativeScript port's own apps, beside the
native widgets, which is where a headless GLib/Gio is useful. Track C still needs a host inside a
pixiewood process, where NativeScript is not the Activity owner; that question moves to stage 5.

## Reproducing

Everything lives in `~/.cache/gjsify-android/ns/`, outside the repo. The GI stack is the stage-1
pixiewood tree (`~/.cache/gjsify-android/gi-probe/.pixiewood`, see the
[stage 1 report](2026-10-10-gi-in-a-pixiewood-apk.md)). NDK 27.1.12297006, `nativescript` CLI
via `npx`, `@nativescript/android` 9.1.1.

```sh
cd ~/.cache/gjsify-android/ns
npx nativescript create napiprobe --template @nativescript/template-blank --appid dev.gjsify.napiprobe
(cd napiprobe && npx nativescript platform add android)
mkdir aar && (cd aar && unzip -q ../napiprobe/node_modules/@nativescript/android/framework/app/libs/runtime-libs/nativescript-optimized.aar)

# hello addon, both ABIs
for abi in x86_64:x86_64 arm64-v8a:aarch64; do a=${abi%%:*}; t=${abi##*:}
  mkdir -p napiprobe/App_Resources/Android/src/main/jniLibs/$a
  $NDK/${t}-linux-android24-clang -shared -fPIC -O2 -DNODE_GYP_MODULE_NAME=napihello \
    -Iaar/prefab/modules/NativeScript/include hello/hello.c aar/jni/$a/libNativeScript.so \
    -Wl,--no-undefined -o napiprobe/App_Resources/Android/src/main/jniLibs/$a/libnapihello.so
done

# libuv stubs from the Linux build's undefined symbols, then node-gi
nm -D --undefined-only $NODE_GI/build/Release/node_gi.node | awk '/ uv_/{print $2}' > uv-syms.txt
# uvstub.c: one `void <sym>(void) { abort(); }` per line of uv-syms.txt
./build-node-gi.sh x86_64 && ./build-node-gi.sh aarch64

# copy libnode_gi.so + its closure (closure.py) into App_Resources/…/jniLibs/<abi>,
# seven typelibs into napiprobe/app/girepository-1.0, then:
(cd napiprobe && npx nativescript prepare android)
(cd napiprobe/platforms/android && ./gradlew assembleDebug -Pabis=x86_64)
adb install napiprobe/platforms/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n dev.gjsify.napiprobe/com.tns.NativeScriptActivity
adb logcat -d | grep NAPIPROBE
```

### `hello/hello.c`

```c
#include <node_api.h>

static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  double a = 0, b = 0;
  napi_value result = NULL;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);
  napi_create_double(env, a + b, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"add", NULL, Add, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 1, props);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

### `build-node-gi.sh`

```sh
#!/bin/sh
# Spike: cross-compile node-gi for one Android ABI against the gi-probe
# pixiewood build tree and NativeScript's Node-API surface.
# Usage: build-node-gi.sh <x86_64|aarch64>
set -eu
arch=$1
case $arch in x86_64) abi=x86_64 ;; aarch64) abi=arm64-v8a ;; esac
here=$(dirname "$(readlink -f "$0")")
G=$HOME/Projekte/werkstatt/gjsify/gjsify
NG=$G/packages/node-gi/node-gi
PW=$HOME/.cache/gjsify-android/gi-probe/.pixiewood
NDK=$HOME/Android/Sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin
CXX=$NDK/${arch}-linux-android24-clang++
CC=$NDK/${arch}-linux-android24-clang
out=$here/out-$abi
mkdir -p "$out"

pc() { PKG_CONFIG_LIBDIR=$PW/bin-$arch/meson-uninstalled pkg-config "$@" girepository-2.0 cairo cairo-gobject; }

cflags="-fPIC -O2 -DNAPI_VERSION=8 -DNAPI_DISABLE_CPP_EXCEPTIONS -DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS
  -I$here/aar/prefab/modules/NativeScript/include -I$NG/node_modules/node-addon-api
  -I$G/refs/node/deps/uv/include $(pc --cflags)"

for f in addon opengl-win32 cairo calls class loop marshal object private repo signals template toggle variant; do
  $CXX -std=c++17 $cflags -c "$NG/src/$f.cc" -o "$out/$f.o" &
done
$CC -fPIC -O2 -c "$here/uvstub.c" -o "$out/uvstub.o" &
wait

$CXX -shared -o "$out/libnode_gi.so" "$out"/*.o \
  -L"$PW/root/lib/$abi" -lgirepository-2.0 -lgobject-2.0 -lglib-2.0 -lgio-2.0 -lgmodule-2.0 \
  -lcairo -lcairo-gobject -lffi -lintl \
  "$here/aar/jni/$abi/libNativeScript.so" -static-libstdc++ -Wl,--no-undefined
echo "built $out/libnode_gi.so"
```

### `closure.py`

```python
import os, re, subprocess, sys
RE = os.path.expanduser("~/Android/Sdk/ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf")
root, start = sys.argv[1], sys.argv[2]
seen, todo = [], [start]
while todo:
    f = todo.pop()
    out = subprocess.run([RE, "-d", f], capture_output=True, text=True).stdout
    for n in re.findall(r"NEEDED.*\[(.*)\]", out):
        p = os.path.join(root, n)
        if os.path.exists(p) and n not in seen:
            seen.append(n); todo.append(p)
print(" ".join(seen))
```

### `napiprobe/App_Resources/Android/app.gradle` (the added block)

```groovy
  sourceSets {
    main {
      jniLibs.srcDirs += ["$projectDir/src/main/jniLibs"]
    }
  }
```

### `napiprobe/webpack.config.js` (the added line)

```js
	webpack.Utils.addCopyRule('girepository-1.0/**');
```

### `napiprobe/app/app.js`

```js
import { Application, knownFolders } from '@nativescript/core'

function probe(name, fn) {
  try {
    console.log(`NAPIPROBE ${name} OK ${JSON.stringify(fn())}`)
  } catch (e) {
    console.log(`NAPIPROBE ${name} FAIL ${e && e.stack ? e.stack : e}`)
  }
}

const ms = (t0) => +(performance.now() - t0).toFixed(3)

probe('hello.add', () => {
  const t0 = performance.now()
  const hello = __non_webpack_require__('system_lib://libnapihello.so')
  return { sum: hello.add(2, 40), requireMs: ms(t0) }
})

let gi
probe('gi.load', () => {
  const t0 = performance.now()
  gi = __non_webpack_require__('system_lib://libnode_gi.so')
  return { requireMs: ms(t0), exports: Object.keys(gi).length }
})

probe('gi.searchPath', () => {
  const dir = knownFolders.currentApp().path + '/girepository-1.0'
  gi.prependSearchPath(dir)
  return dir
})

for (const [ns, v] of [['GLib', '2.0'], ['GObject', '2.0'], ['Gio', '2.0'], ['cairo', '1.0']]) {
  probe(`gi.require.${ns}`, () => {
    const t0 = performance.now()
    gi.requireNamespace(ns, v)
    return { ms: ms(t0) }
  })
}

probe('GLib.get_user_name', () => gi.callFunction('GLib', 'get_user_name', []))
probe('GLib.uuid_string_random', () => gi.callFunction('GLib', 'uuid_string_random', []))
probe('GLib.compute_checksum_for_string', () =>
  gi.callFunction('GLib', 'compute_checksum_for_string', [2, 'abc', -1]))
probe('GLib.get_user_data_dir', () => gi.callFunction('GLib', 'get_user_data_dir', []))

let file
probe('Gio.File', () => {
  file = gi.callFunction('Gio', 'file_new_for_path', [knownFolders.currentApp().path + '/girepository-1.0/GLib-2.0.typelib'])
  return { basename: gi.callMethod(file, 'get_basename', []), type: gi.getTypeName(file) }
})

probe('gi.startMainLoop (expected to fail: no libuv)', () => gi.startMainLoop())

// Async Gio call, completed by pumping the GLib default context from a JS timer —
// the same portable pump node-gi uses on Bun/Deno.
probe('Gio.load_contents_async (start)', () => {
  const t0 = performance.now()
  gi.callMethod(file, 'load_contents_async', [null, (src, res) => {
    try {
      const r = gi.callMethod(src, 'load_contents_finish', [res])
      console.log(`NAPIPROBE Gio.load_contents_async OK ${JSON.stringify({ ms: ms(t0), result: typeof r, len: r && r[1] && r[1].length })}`)
    } catch (e) {
      console.log(`NAPIPROBE Gio.load_contents_async FAIL ${e && e.stack ? e.stack : e}`)
    }
  }])
  const timer = setInterval(() => {
    while (gi.iterateMainContext(false)) {}
  }, 4)
  setTimeout(() => clearInterval(timer), 5000)
  return 'started'
})

Application.run({ moduleName: 'app-root' })
```
