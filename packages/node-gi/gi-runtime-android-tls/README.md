# @gjsify/gi-runtime-android-tls

Add-on to [`@gjsify/gi-runtime-android`](../gi-runtime-android): a Gio TLS backend for an
Android NativeScript app (`arm64-v8a`, `x86_64`). It carries glib-networking's OpenSSL module
(`libgioopenssl.so`) and OpenSSL 3.5 (`libssl.so`, `libcrypto.so`). It adds no typelib, because
Gio is in the core. Part of
[ADR 0117](../../../docs/adr/0117-android-gi-namespaces-are-selected-at-build-time.md) stage 2.

Install it when the app talks https or TLS through Gio (`@gjsify/fetch`, `tls`, `ws`, libsoup).
Without it, `Gio.TlsBackend.get_default().supports_tls()` is `false` and every TLS connection
fails with "TLS support is not available". An app without the add-on gets the same APK as with
the core alone.

```jsonc
"dependencies": {
    "@gjsify/gi-runtime-android": "0.64.48",
    "@gjsify/gi-runtime-android-tls": "0.64.48"
}
```

## What happens at startup

`@gjsify/node-gi` reads the add-on's runtime manifest (`assets/app/gi-runtime/gi-runtime-android-tls.json`),
which lists the module under `gioModules`. Once the addon is loaded it does two things:

1. **Loads the module by soname.** Android keeps native libraries inside the APK
   (`extractNativeLibs=false`), so there is no directory for GIO to scan. `GIO_MODULE_DIR` points
   at an empty app-private directory, and `Gio.IOModule.new('libgioopenssl.so')` loads the module.
2. **Installs Android's trust store** as Gio's default database
   ([ADR 0134](../../../docs/adr/0134-https-trusts-the-os-store-through-one-package.md) § 3). It
   takes `/system/etc/security/cacerts` minus the roots the user disabled, merges them into
   `<cache>/gjsify-tls/system-ca.pem` and calls `set_default_database`. User-added CAs are not
   trusted. No CA bundle ships in this package.

The result is on `globalThis.__NODE_GI_ANDROID_TLS` for device harnesses.

## Building

`yarn build:bundle` needs a sysroot built with glib-networking (`lib/<abi>/gio/modules`), and
the same inputs as the core's build (see its README). The builder fails if that directory is
empty. The AAR holds only what the core's closure lacks and is gitignored.
