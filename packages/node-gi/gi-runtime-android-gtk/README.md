# @gjsify/gi-runtime-android-gtk

Add-on to [`@gjsify/gi-runtime-android`](../gi-runtime-android): GTK 4, libadwaita, Pango,
HarfBuzz, Graphene and their typelibs for an Android NativeScript app (`arm64-v8a`, `x86_64`).
Part of [ADR 0117](../../../docs/adr/0117-android-gi-namespaces-are-selected-at-build-time.md).

Install it only when the app imports `gi://Gtk` or `gi://Adw`. An app without it gets the
same APK as with the core alone.

```jsonc
"dependencies": {
    "@gjsify/gi-runtime-android": "^0.64.16",
    "@gjsify/gi-runtime-android-gtk": "^0.64.16"
}
```

The core is NOT an `optionalDependency` of this edge in reverse: the core does not list the
add-on, because npm would install it by default and every APK would grow. This package
depends on the core at the exact same version.

## Pin identity

Both packages are built against the same sysroot (`gjsify/android-sysroot`, pin in the core's
`build-inputs.json`). Each AAR carries a runtime manifest at
`assets/app/gi-runtime/<package>.json`; at startup `host.nativescript.js` compares them and
refuses a mixed sysroot tag or sha, naming both packages.

## Building

`yarn build:bundle` (needs the sysroot and NativeScript inputs the core's build uses, see its
README). The AAR holds only what the core's closure lacks; `libnode_gi.so` stays in the core.
The AAR is gitignored and published by `release.yml`'s `publish-gi-runtime-android` job,
together with the core, in one job (Trusted Publishing is bound to that workflow file).
