# GObject Introspection inside a pixiewood APK — 2026-10-10

Stage 1 of [ADR 0104](../adr/0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md):
can a pixiewood-built APK load typelibs for GLib, Gio, GTK and Libadwaita, and does a call made
through `girepository` + libffi reach the right library? This is the native half of tracks B
(GI through node-gi) and C (GTK rendering). No JavaScript runs here — the probe is C, so a
failure can only be the GI stack, not a binding.

The [first probe](2026-10-09-gtk-android-probe.md) found `libgirepository-2.0.so` and libffi
already inside Tuba's APK but no typelibs. This report builds them.

## Result

All 11 checks pass on x86_64 (`Tablet_API_36`, Android 16, no ARM translation):

| Check | Result |
|---|---|
| typelib dir | `/data/user/0/dev.gjsify.giprobe/files/share/girepository-1.0` (the GDK runtime extracts `assets/share` to the first XDG data dir) |
| `require` GLib-2.0, GObject-2.0, Gio-2.0, Gtk-4.0, Adw-1 | each 18–140 µs |
| `GLib.ascii_strup("gjsify")` via `gi_function_info_invoke` | `GJSIFY` |
| `Gtk.get_major_version`, `Adw.get_major_version` | 4 and 1, equal to the linked library |
| `find_by_gtype(GTK_TYPE_LABEL)` | `Gtk.Label` |
| `Gtk.Label.new` via libffi | a real `GtkLabel` |
| cold start (`am start -W`) | 546 ms |
| PSS after start | 70 MB |
| APK | 60 MB after `llvm-strip --strip-debug` on the jniLibs, of which 24 typelibs ≈ 2 MB |

On arm64 all 11 pass as well — see [below](#arm64).

## What it took

pixiewood builds the whole stack as meson subprojects, cross-compiled with the NDK. Introspection
on a cross build needs three things it does not ship today:

1. **Introspection is off by default.** `prepare/android.cross` disables it for harfbuzz, gtk and
   libadwaita, and with no exe wrapper meson resolves `auto` to *disabled* for the rest. The
   manifest has to force `-D<pkg>:introspection=enabled` for glib, harfbuzz, pango, gdk-pixbuf,
   graphene, gtk and libadwaita. harfbuzz is not optional: with its introspection off,
   `harfbuzz-gobject` pulls C++ into gtk and setup fails with
   `No host machine compiler for 'subprojects/harfbuzz/src/hb-gobject-structs.cc'`.
2. **A way to run target binaries.** g-ir-scanner compiles a dumper against the library and
   *runs* it. `adb-run` is meson's `exe_wrapper` and g-ir-scanner's `GI_CROSS_LAUNCHER`: it pushes
   the binary and its DT_NEEDED closure to the device, rewrites `--introspect-dump=IN,OUT` to
   device paths and pulls OUT back. Once meson can run target binaries, glib replaces its build
   tools (`glib-compile-resources`, `-schemas`, `gi-compile-repository`, `gio-querymodules`) with
   the cross-built ones; `adb-run` sends those to the host copies, since their output is
   platform-independent.
3. **Typelibs in the APK.** pixiewood installs only `--tags runtime` and leaves `lib/` out of the
   assets. `stage-typelibs` installs `--tags typelib` into a staging root and copies the result to
   `assets/share/girepository-1.0`.

Three traps on the way:

- **The NDK sysroot is link-time stubs.** Its `libc.so` lacks `__register_atfork`; pushing it
  breaks every binary. `elfdeps.py` resolves only build-tree libraries and `libc++_shared.so`,
  everything else is the device's.
- **Meson's zlib brings in API 21.** It resolves zlib to the NDK's API 21 `libz.so` and passes
  its directory as `-L` to the scanner, ahead of clang's own API directory. The dumper then links
  API 21 libc and libjnigraphics, which lack `__register_atfork` and `AImageDecoder`. The
  `g-ir-scanner` wrapper drops `-L…/sysroot/usr/lib/<triple>/<api>`.
- **Three namespaces are never built**: `cairo-1.0`, `fontconfig-2.0` and `freetype2-2.0` GIRs
  ship with gobject-introspection, not with the libraries. `stage-typelibs` compiles them from the
  build host's GIRs with the soname versions stripped (`libcairo.so.2` → `libcairo.so`, the way
  the Android build names its libraries). They are the only host-derived typelibs; every other
  GIR's `shared-library` exists in jniLibs.

gobject-introspection itself is NOT built as a subproject: it would recurse into glib. A
host-side `pkg-config` that only knows a fake `gobject-introspection-1.0.pc` points glib and gtk
at the host's scanner and compiler (1.86.0), which match glib main.

## ARM64

Same emulator, the `arm64-v8a` split installed with `adb install --abi arm64-v8a`, so it runs
under the image's ARM translation (`libndk_translation`). All 11 checks pass:

| | arm64 (translated) | x86_64 (native) |
|---|---|---|
| `require` per namespace | 70–2,667 µs (GLib first: 2.7 ms) | 18–140 µs |
| libffi calls (`ascii_strup`, versions, `Gtk.Label.new`) | pass | pass |
| cold start (`am start -W`) | 1,195 ms | 546 ms |
| PSS after start | 141 MB | 70 MB |
| APK split, jniLibs stripped | 61 MB | 60 MB |

Translation roughly doubles time and memory, as expected; real arm64 numbers are stage 2's job.

- **The typelibs are one set for both ABIs, almost.** 23 of 24 are byte-identical between the
  aarch64 and x86_64 builds. `GLib-2.0` differs by one constant: x86_64 has
  `G_VA_COPY_AS_ARRAY = 1` (its `va_list` is an array), aarch64 does not. Both are LP64, so
  struct layouts agree; an APK carries ONE `assets/` tree for every ABI, and the arm64 set is the
  right one to ship.
- **The first frame does not appear until input.** The window stays blank until a tap, then
  renders the report correctly. The log has the same `GdkAndroidDisplay.init_egl failed` and
  `AChoreographer_getInstance() failed` as the [first probe](2026-10-09-gtk-android-probe.md)'s
  finding 4; without a choreographer the frame clock has nothing to tick it. Whether a real
  device shows it is part of stage 2.

Running arm64 *build* tools on the emulator needed two more fixes in `adb-run`, both from the
translation: its arm64 linker ignores `LD_LIBRARY_PATH` and honours only `DT_RUNPATH`, so every
pushed binary and library is a patched copy with a runpath (bionic does not inherit one); and
`LD_LIBRARY_PATH` must be unset altogether, because the translator's own x86_64 runner reads it
and fails on the arm64 copies (`libxml2.so is for EM_AARCH64 (183) instead of EM_X86_64 (62)`).
Each ABI gets its own library directory, since both configure in parallel.

## Reproducing

Everything lives outside the repo, in `~/.cache/gjsify-android/` (`gi-probe/` for the app,
`tools/` for the helpers). Absolute paths in `gi.cross` and the `.pc` file must point at that
`tools/` directory; meson cross files do not expand `~`. Host: Fedora, glib 2.88, g-ir-scanner
1.86.0, patchelf (`pip install --target tools/pyvendor patchelf`), NDK 27.1.12297006, pixiewood from `refs/gtk-android-builder`.

```sh
cd ~/.cache/gjsify-android/gi-probe
pixiewood prepare --sdk ~/Android/Sdk pixiewood.xml
pixiewood -v build --skip-gradle
../tools/stage-typelibs aarch64
find -L .pixiewood/android/app/src/main/jniLibs -name '*.so' -exec "$NDK_BIN/llvm-strip" --strip-debug {} +
cd .pixiewood/android && ANDROID_HOME=~/Android/Sdk ./gradlew clean assembleDebug
```

- `jniLibs` is a symlink to `.pixiewood/root/lib`; `find` without `-L` strips nothing.
- `clean` matters: after stripping, gradle does not repack the APK otherwise.
- Adding an architecture to an existing checkout: `meson setup` the new `bin-<arch>` with
  pixiewood's arguments (rerunning `prepare` fails on the existing build dir), then
  `pixiewood generate`, which rewrites gradle's `abiFilters`.
- `adb-run` uses whatever `adb` picks; with more than one device attached, set `ANDROID_SERIAL`.

### `gi-probe/meson.build`

```meson
project('gi-probe', 'c', version: '0.1.0', meson_version: '>= 1.9')

gtk = dependency('gtk4')
adw = dependency('libadwaita-1')
girepository = dependency('girepository-2.0')

executable('gi-probe', 'main.c',
  dependencies: [gtk, adw, girepository],
  android_exe_type: 'application',
  install: true,
)
```

### `gi-probe/pixiewood.xml`

`data/` holds a minimal metainfo and an adaptive-icon vector drawable.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<app xmlns="https://sp1rit.arpa/pixiewood/" xmlns:xi="http://www.w3.org/2001/XInclude">
  <metainfo vercalc="count">
    <xi:include href="src://data/dev.gjsify.GiProbe.metainfo.xml" parse="xml"/>
  </metainfo>
  <style>
    <theme name="adw"/>
    <icon type="generate">
      <drawable target="foreground" type="avd" path="src://data/icon.xml"/>
      <color target="background">#FFFFFF</color>
    </icon>
  </style>
  <dependencies>
    <glib>
      <patch>hack</patch>
      <patch>pthread-restrictions</patch>
    </glib>
    <fontconfig/>
    <gtk/>
    <libadwaita/>
  </dependencies>
  <build target="gi-probe">
    <architectures>
      <arch>x86_64</arch>
      <arch>aarch64</arch>
    </architectures>
    <configure-options>
      <option>-Dgtk:buildtype=debugoptimized</option>
      <option>-Dgtk:print-cups=disabled</option>
      <option>-Dlibadwaita:tests=false</option>
      <option>-Dlibadwaita:examples=false</option>
      <option>-Dgobject-introspection:tests=false</option>
      <option>--cross-file=<tools>/gi.cross</option>
      <option>-Dglib:introspection=enabled</option>
      <option>-Dharfbuzz:introspection=enabled</option>
      <option>-Dpango:introspection=enabled</option>
      <option>-Dgdk-pixbuf:introspection=enabled</option>
      <option>-Dgraphene:introspection=enabled</option>
      <option>-Dgtk:introspection=enabled</option>
      <option>-Dlibadwaita:introspection=enabled</option>
    </configure-options>
  </build>
</app>
```

### `gi-probe/main.c`

```c
/* Stage 1 of gjsify ADR 0104: do typelibs load, and does a call through
 * libffi reach the right library, inside a pixiewood APK? Every result is
 * logged as "GIPROBE ..." (logcat) and shown in the window. */

#include <adwaita.h>
#include <girepository/girepository.h>

static GIRepository *repo;
static GString *report;

static void
note (gboolean ok, const char *format, ...)
{
  va_list args;
  va_start (args, format);
  g_autofree char *line = g_strdup_vprintf (format, args);
  va_end (args);
  g_message ("GIPROBE %s %s", ok ? "PASS" : "FAIL", line);
  g_string_append_printf (report, "%s  %s\n", ok ? "✔" : "✘", line);
}

static void
require_all (void)
{
  static const char *const namespaces[][2] = {
    { "GLib", "2.0" }, { "GObject", "2.0" }, { "Gio", "2.0" },
    { "Gtk", "4.0" },  { "Adw", "1" },
  };
  const char *const *data_dirs = g_get_system_data_dirs ();
  g_autofree char *typelib_dir = g_build_filename (data_dirs[0], "girepository-1.0", NULL);

  note (g_file_test (typelib_dir, G_FILE_TEST_IS_DIR), "typelib dir %s", typelib_dir);
  gi_repository_prepend_search_path (repo, typelib_dir);

  for (gsize i = 0; i < G_N_ELEMENTS (namespaces); i++)
    {
      g_autoptr (GError) error = NULL;
      gint64 start = g_get_monotonic_time ();
      GITypelib *typelib = gi_repository_require (repo, namespaces[i][0], namespaces[i][1], 0, &error);
      gint64 took = g_get_monotonic_time () - start;
      note (typelib != NULL, "require %s-%s in %" G_GINT64_FORMAT " µs%s%s",
            namespaces[i][0], namespaces[i][1], took,
            error ? ": " : "", error ? error->message : "");
    }
}

static GIFunctionInfo *
find_function (const char *namespace_, const char *name)
{
  GIBaseInfo *info = gi_repository_find_by_name (repo, namespace_, name);
  if (info == NULL || !GI_IS_FUNCTION_INFO (info))
    {
      note (FALSE, "find %s.%s", namespace_, name);
      g_clear_pointer (&info, gi_base_info_unref);
      return NULL;
    }
  return GI_FUNCTION_INFO (info);
}

static void
invoke_glib (void)
{
  g_autoptr (GIFunctionInfo) fn = find_function ("GLib", "ascii_strup");
  if (fn == NULL)
    return;

  GIArgument in[2] = { { .v_string = (char *) "gjsify" }, { .v_ssize = -1 } };
  GIArgument ret = { 0 };
  g_autoptr (GError) error = NULL;
  gboolean ok = gi_function_info_invoke (fn, in, 2, NULL, 0, &ret, &error);
  note (ok && g_strcmp0 (ret.v_string, "GJSIFY") == 0, "invoke GLib.ascii_strup -> %s%s",
        ok ? ret.v_string : "(none)", error ? error->message : "");
  if (ok)
    g_free (ret.v_string);
}

static void
invoke_version (const char *namespace_, guint expected)
{
  g_autoptr (GIFunctionInfo) fn = find_function (namespace_, "get_major_version");
  if (fn == NULL)
    return;

  GIArgument ret = { 0 };
  g_autoptr (GError) error = NULL;
  gboolean ok = gi_function_info_invoke (fn, NULL, 0, NULL, 0, &ret, &error);
  note (ok && ret.v_uint32 == expected, "invoke %s.get_major_version -> %u (linked %u)%s",
        namespace_, ok ? ret.v_uint32 : 0, expected, error ? error->message : "");
}

static void
invoke_constructor (void)
{
  GIBaseInfo *info = gi_repository_find_by_gtype (repo, GTK_TYPE_LABEL);
  if (info == NULL || !GI_IS_OBJECT_INFO (info))
    {
      note (FALSE, "find_by_gtype GtkLabel");
      g_clear_pointer (&info, gi_base_info_unref);
      return;
    }
  note (TRUE, "find_by_gtype GtkLabel -> %s.%s", gi_base_info_get_namespace (info),
        gi_base_info_get_name (info));

  g_autoptr (GIFunctionInfo) ctor = gi_object_info_find_method (GI_OBJECT_INFO (info), "new");
  gi_base_info_unref (info);
  if (ctor == NULL)
    {
      note (FALSE, "find Gtk.Label.new");
      return;
    }

  GIArgument in = { .v_string = (char *) "made through libffi" };
  GIArgument ret = { 0 };
  g_autoptr (GError) error = NULL;
  gboolean ok = gi_function_info_invoke (ctor, &in, 1, NULL, 0, &ret, &error);
  GtkWidget *label = ok ? ret.v_pointer : NULL;
  gboolean is_label = label != NULL && GTK_IS_LABEL (label);
  note (is_label, "invoke Gtk.Label.new -> %s%s", is_label ? gtk_label_get_text (GTK_LABEL (label)) : "(none)",
        error ? error->message : "");
  if (label != NULL)
    g_object_unref (g_object_ref_sink (label));
}

static void
on_activate (GtkApplication *app)
{
  invoke_glib ();
  invoke_version ("Gtk", gtk_get_major_version ());
  invoke_version ("Adw", adw_get_major_version ());
  invoke_constructor ();

  GtkWidget *label = gtk_label_new (report->str);
  gtk_label_set_wrap (GTK_LABEL (label), TRUE);
  gtk_label_set_xalign (GTK_LABEL (label), 0);
  gtk_widget_set_margin_start (label, 12);
  gtk_widget_set_margin_end (label, 12);
  gtk_widget_set_margin_top (label, 12);

  GtkWidget *scrolled = gtk_scrolled_window_new ();
  gtk_scrolled_window_set_child (GTK_SCROLLED_WINDOW (scrolled), label);

  GtkWidget *view = adw_toolbar_view_new ();
  adw_toolbar_view_add_top_bar (ADW_TOOLBAR_VIEW (view), adw_header_bar_new ());
  adw_toolbar_view_set_content (ADW_TOOLBAR_VIEW (view), scrolled);

  GtkWidget *window = adw_application_window_new (app);
  gtk_window_set_title (GTK_WINDOW (window), "GI probe");
  adw_application_window_set_content (ADW_APPLICATION_WINDOW (window), view);
  gtk_window_present (GTK_WINDOW (window));
}

int
main (int argc, char **argv)
{
  report = g_string_new (NULL);
  repo = gi_repository_new ();
  require_all ();

  g_autoptr (AdwApplication) app = adw_application_new ("dev.gjsify.GiProbe", G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect (app, "activate", G_CALLBACK (on_activate), NULL);
  return g_application_run (G_APPLICATION (app), argc, argv);
}
```

### `tools/gi.cross`

```ini
[binaries]
pkg-config = '<tools>/pkg-config'
g-ir-scanner = '<tools>/g-ir-scanner'
g-ir-compiler = '/usr/bin/g-ir-compiler'
exe_wrapper = '<tools>/adb-run'
```

### `tools/pkg-config` and `tools/pkgconfig/gobject-introspection-1.0.pc`

```sh
#!/bin/sh
# Host-machine pkg-config for the Android cross build. Besides meson's
# uninstalled .pc files (PKG_CONFIG_PATH) it only knows
# gobject-introspection-1.0, so glib and gtk see a g-i without building the
# gobject-introspection subproject, which would recurse into glib.
tools=$(dirname "$(readlink -f "$0")")
PKG_CONFIG_LIBDIR="$tools/pkgconfig" exec /usr/bin/pkg-config "$@"
```

```ini
tools=<tools>
datadir=/usr/share
girdir=${datadir}/gir-1.0
typelibdir=/usr/lib64/girepository-1.0
g_ir_scanner=${tools}/g-ir-scanner
g_ir_compiler=/usr/bin/g-ir-compiler
g_ir_generate=/usr/bin/g-ir-generate

Name: gobject-introspection
Description: GObject Introspection, as seen by the Android cross build
Version: 1.86.0
Cflags:
Libs:
```

### `tools/g-ir-scanner`

```python
#!/usr/bin/env python3
"""g-ir-scanner for an Android cross build: the dump binary runs on the device
through adb-run, and its libraries are resolved with gi-ldd instead of ldd.

Meson resolves zlib to the NDK's API 21 libz.so and hands its directory to the
scanner as -L. Searched before clang's own API-level directory, it links the
dumper against API 21 libc and libjnigraphics, which lack __register_atfork
and AImageDecoder. clang finds the right directory itself, so drop those."""

import os
import re
import shlex
import sys

TOOLS = os.path.dirname(os.path.realpath(__file__))
API_LIB_DIR = re.compile(r"^-L.*/sysroot/usr/lib/[a-z0-9_]+-linux-android/\d+/?$")


def expand(args):
    for arg in args:
        if arg.startswith("@") and os.path.isfile(arg[1:]):
            with open(arg[1:]) as f:
                yield from expand(shlex.split(f.read()))
        else:
            yield arg


args = [a for a in expand(sys.argv[1:]) if not API_LIB_DIR.match(a)]
os.environ["GI_CROSS_LAUNCHER"] = os.path.join(TOOLS, "adb-run")
os.execv("/usr/bin/g-ir-scanner",
         ["/usr/bin/g-ir-scanner", f"--use-ldd-wrapper={TOOLS}/gi-ldd", *args])
```

### `tools/gi-ldd`

```python
#!/usr/bin/env python3
"""ldd for g-ir-scanner when cross-compiling: prints the target sonames, which
end up as the shared-library attribute of the GIR."""

import sys

from elfdeps import resolve_needed

for name, path in resolve_needed(sys.argv[1]).items():
    print(f"\t{name} => {path or 'system'} (0x0)")
```

### `tools/elfdeps.py`

```python
"""DT_NEEDED closure of an Android ELF, resolved against the build tree."""

import glob
import os
import re
import subprocess

NDK = sorted(glob.glob(os.path.expanduser("~/Android/Sdk/ndk/*")))[-1]
PREBUILT = f"{NDK}/toolchains/llvm/prebuilt/linux-x86_64"
READELF = f"{PREBUILT}/bin/llvm-readelf"
ABI_TRIPLE = {"x86_64": "x86_64-linux-android", "aarch64": "aarch64-linux-android"}


def dynamic(path):
    out = subprocess.run([READELF, "-d", "-h", path], check=True, capture_output=True, text=True).stdout
    needed = re.findall(r"\(NEEDED\)\s+Shared library: \[(.+?)\]", out)
    runpath = re.findall(r"\((?:RUNPATH|RPATH)\)\s+Library (?:runpath|rpath): \[(.+?)\]", out)
    machine = "aarch64" if "AArch64" in out else "x86_64"
    return needed, [p for entry in runpath for p in entry.split(":")], machine


def build_root(path):
    directory = os.path.dirname(os.path.abspath(path))
    while directory != "/":
        if os.path.exists(os.path.join(directory, "build.ninja")):
            return directory
        directory = os.path.dirname(directory)
    return None


def index_libraries(root):
    found = {}
    for dirpath, _, files in os.walk(root):
        for name in files:
            if ".so" in name and name not in found:
                found[name] = os.path.join(dirpath, name)
    return found


def resolve_needed(binary):
    """Map every soname in the closure to a host path, or None for system libraries."""
    _, _, machine = dynamic(binary)
    root = build_root(binary)
    index = index_libraries(root) if root else {}
    sysroot = f"{PREBUILT}/sysroot/usr/lib/{ABI_TRIPLE[machine]}"
    resolved = {}
    queue = [binary]
    while queue:
        needed, runpath, _ = dynamic(queue.pop())
        for name in needed:
            if name in resolved:
                continue
            # The NDK sysroot holds link-time stubs of the system libraries
            # (libc.so lacks __register_atfork); the device has the real ones.
            runpath = [d for d in runpath if root and os.path.abspath(d).startswith(root)]
            path = next((os.path.join(d, name) for d in runpath if os.path.isfile(os.path.join(d, name))), None)
            path = path or index.get(name)
            if path is None and name == "libc++_shared.so":
                path = os.path.join(sysroot, name)
            resolved[name] = path
            if path is not None:
                queue.append(path)
    return resolved
```

### `tools/adb-run`

```python
#!/usr/bin/env python3
"""Run an Android binary built on this host on the attached device, as if it
ran here: meson's exe_wrapper and g-ir-scanner's GI_CROSS_LAUNCHER.

Pushes the binary plus every DT_NEEDED library found in the build tree or the
NDK sysroot (everything else is assumed to be a system library), rewrites the
host paths in --introspect-dump=IN,OUT, and copies OUT back afterwards.
"""

import fcntl
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

from elfdeps import dynamic, resolve_needed

DEVICE_ROOT = "/data/local/tmp/gi-run"
LOCK_DIR = os.path.expanduser("~/.cache/gjsify-android/adb-locks")
STAGE_DIR = os.path.expanduser("~/.cache/gjsify-android/adb-stage")
PATCHELF = os.path.join(os.path.dirname(os.path.realpath(__file__)), "pyvendor/bin/patchelf")
HOST_TOOLS = {
    name: f"/usr/bin/{name}"
    for name in ("glib-compile-resources", "glib-compile-schemas", "gi-compile-repository")
} | {"gio-querymodules": "/usr/bin/gio-querymodules-64"}


def adb(*args, **kwargs):
    return subprocess.run(["adb", *args], check=True, **kwargs)


def with_runpath(path, dest, lib_dir):
    """Copy path to dest with DT_RUNPATH=lib_dir. Under libndk_translation the
    arm64 linker ignores LD_LIBRARY_PATH and only honours a runpath, which
    bionic does not inherit, so every pushed object carries its own."""
    if os.path.exists(dest) and os.path.getmtime(dest) >= os.path.getmtime(path):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = f"{dest}.{os.getpid()}"
    shutil.copy2(path, tmp)
    os.chmod(tmp, 0o755)
    subprocess.run([PATCHELF, "--set-rpath", lib_dir, tmp], check=True)
    os.replace(tmp, dest)
    return dest


def push_lib(path, lib_dir):
    os.makedirs(LOCK_DIR, exist_ok=True)
    abi = os.path.basename(lib_dir)
    name = os.path.basename(path)
    with open(os.path.join(LOCK_DIR, f"{abi}-{name}"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        staged = with_runpath(path, os.path.join(STAGE_DIR, abi, name), lib_dir)
        adb("push", "--sync", staged, f"{lib_dir}/{name}", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    binary, *args = sys.argv[1:]
    # glib overrides its build tools with the cross-built ones once meson can
    # run host binaries. They take host paths and emit platform-independent
    # output, so the build host's copy does the job.
    host_tool = HOST_TOOLS.get(os.path.basename(binary))
    if host_tool:
        os.execv(host_tool, [host_tool, *args])
    binary = os.path.abspath(binary)
    # One library directory per ABI: the x86_64 and aarch64 builds configure
    # in parallel and both need their own libc++_shared.so.
    lib_dir = f"{DEVICE_ROOT}/lib-{dynamic(binary)[2]}"
    for lib in resolve_needed(binary).values():
        if lib is not None:
            push_lib(lib, lib_dir)

    run_id = hashlib.sha1(f"{binary}:{os.getpid()}".encode()).hexdigest()[:12]
    run_dir = f"{DEVICE_ROOT}/run/{run_id}"
    adb("shell", "mkdir", "-p", run_dir)
    with tempfile.TemporaryDirectory() as tmp:
        staged = with_runpath(binary, os.path.join(tmp, os.path.basename(binary)), lib_dir)
        adb("push", staged, f"{run_dir}/{os.path.basename(binary)}", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    pull = None
    device_args = []
    for arg in args:
        if arg.startswith("--introspect-dump="):
            host_in, host_out = arg.split("=", 1)[1].split(",")
            adb("push", host_in, f"{run_dir}/in.txt", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            pull = (f"{run_dir}/out.xml", host_out)
            arg = f"--introspect-dump={run_dir}/in.txt,{run_dir}/out.xml"
        device_args.append(arg)

    command = (
        # No LD_LIBRARY_PATH: the ARM translation's own x86_64 runner would
        # load the arm64 copies from it (libxml2.so is for EM_AARCH64).
        f"cd {run_dir} && ./{os.path.basename(binary)} " + " ".join(f"'{a}'" for a in device_args)
    )
    status = subprocess.run(["adb", "shell", command]).returncode
    if status == 0 and pull is not None:
        adb("pull", *pull, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["adb", "shell", "rm", "-rf", run_dir])
    sys.exit(status)


if __name__ == "__main__":
    main()
```

### `tools/stage-typelibs`

```sh
#!/bin/sh
# Runs between `pixiewood build --skip-gradle` and gradle: pixiewood installs
# only --tags runtime and leaves lib/ out of the assets, so typelibs never
# reach the APK. Puts them under assets/share/girepository-1.0, which the GDK
# Android runtime extracts to the first XDG data dir.
#
# Namespaces the stack includes but does not build (harfbuzz introspection is
# off, cairo/freetype2/fontconfig GIRs ship with gobject-introspection) are
# compiled from the build host's GIRs, with the soname versions stripped the
# way the Android build names its libraries.
set -eu
arch=${1:-x86_64}
pw=.pixiewood
stage=$pw/typelib-root
assets=$pw/android/app/src/main/assets/share/girepository-1.0

rm -rf "$stage" "$assets"
meson install -C "$pw/bin-$arch" --destdir "$(realpath "$pw")/typelib-root" --tags typelib >/dev/null
mkdir -p "$assets"
find "$stage" -name '*.typelib' -exec cp {} "$assets" \;

built=$(cd "$assets" && ls | sed 's/\.typelib$//')
needed=$(find "$pw/bin-$arch" -name '*.gir' -exec grep -ho '<include name="[^"]*" version="[^"]*"' {} + |
  sed 's/<include name="\([^"]*\)" version="\([^"]*\)"/\1-\2/' | sort -u)
for ns in $needed; do
  echo "$built" | grep -qx "$ns" && continue
  sed -E 's/(\.so)\.[0-9.]+/\1/g' "/usr/share/gir-1.0/$ns.gir" > "$stage/$ns.gir"
  g-ir-compiler --includedir=/usr/share/gir-1.0 -o "$assets/$ns.typelib" "$stage/$ns.gir"
  echo "host-derived: $ns"
done
ls "$assets"
```
