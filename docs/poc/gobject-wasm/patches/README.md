# GLib patches

Three layers of source go into the wasm GLib. Keeping them apart is the point of
this directory, because the middle layer is somebody else's work and the bottom
layer is the actual finding of the prototype.

| Layer | What | Where it comes from |
|---|---|---|
| 1 | glib 2.90.1, pristine | `download.gnome.org` |
| 2 | wasm-vips' Emscripten series, patches 04–10 of 10 | fetched by SHA from [`kleisauke/glib`](https://github.com/kleisauke/glib) branch `wasm-vips-2.90.1`, tip `9dc7b94` |
| 3 | **this directory** | written for this prototype |

`scripts/20-glib.sh` applies them in that order.

## Layer 2 — what we take and what we leave

wasm-vips carries ten patches. We apply 04–10 and skip 01–03:

- **01 Do not build tools** — we need the tool sources to build (girepository
  links against them); we handle the 13 that fail to link with `ninja -k 0`.
- **02 Remove GRegex pre-emptively** — girepository uses GRegex.
- **03 Disable NLS** — the same effect comes from `-Dnls=disabled`, without
  patching.

The seven we do take are portability work (missing POSIX defines, musl printf,
absent network libs, the WebAssembly platform block) and are not specific to
wasm-vips' product.

## Layer 3 — our delta

111 insertions, 11 deletions, 6 files. This is the honest cost of getting
**girepository** onto wasm, over and above what an existing Emscripten GLib
consumer had already paid.

### 0001 — `g_array_sort` / `g_list_sort` / `g_slist_sort` signatures

wasm's indirect calls are type-checked by the runtime: calling a
`GCompareDataFunc` through a `GCompareFunc` slot traps instead of quietly
working. wasm-vips' patch 10 fixed this class of cast in gobject/gio; the same
casts exist in glib's own containers, which wasm-vips never exercised. Adds
`g_compare_func_wasm_adapter` under `#ifdef __EMSCRIPTEN__` and routes
`g_array_sort`, `g_ptr_array_sort`, `g_list_sort`, `g_list_insert_sorted`,
`g_slist_sort` and `g_slist_insert_sorted` through it.

### 0002 — `gi_base_info_class_init` / `gi_base_info_init` signatures

Same class of bug, in girepository: both were declared `(gpointer)` and cast into
`GClassInitFunc` / `GInstanceInitFunc` slots. Fixed by giving them the real
signatures. **Unconditional** — this is a portability improvement that is correct
everywhere, not a wasm workaround, and is the one patch here worth sending
upstream as-is.

### 0003 — `gi_typelib_do_dlopen()` resolves against the main module

Four lines. A typelib names the shared library its namespace lives in; there are
no shared libraries in a static wasm build, everything is in the one module.
Forces `shlib_str = NULL` under `__EMSCRIPTEN__`, which means "resolve in the
main module". This is what makes the link need `-sMAIN_MODULE=2` — and therefore
what rules out `-sWASM_ASYNC_COMPILATION=0`.

### 0004 — single-threaded GWakeup

wasm-vips replaces `gwakeup.c` with `g_error()` stubs, because it never runs a
main context. We do (M4 pumps one per tick), so the stubs abort. Replaced with a
real single-threaded implementation: a signalled flag, no eventfd, no pipe.
Correct precisely because there is no second thread to wake.

## Regenerating

These were produced against *layer 1 + layer 2*, so the base to diff from is
pristine 2.90.1 with the seven wasm-vips patches applied, not pristine 2.90.1.
