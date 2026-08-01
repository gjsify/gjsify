/*
 * dlopen every library named on the command line with RTLD_NOW, and say which
 * one failed and why.
 *
 * WHY THIS EXISTS AT ALL, given `gjs -c 'imports.gi.<Ns>.<Class>'` already
 * loads a prebuild. Two things that check cannot do:
 *
 *   1. **RTLD_NOW.** GI opens a typelib's shared library through
 *      `g_module_open(..., G_MODULE_BIND_LAZY)`, i.e. RTLD_LAZY: only the
 *      symbols a call actually reaches are bound. An artifact referencing a
 *      symbol the host libc does not have therefore resolves its class, prints
 *      "loaded" and dies later, at the call site, on a user's machine. RTLD_NOW
 *      binds every relocation up front, which is exactly the failure mode this
 *      repo's musl leg is about: the measurements that put a package into that
 *      leg are `fcntl64` (sab-native x64), `__cmsg_nxthdr` (sab-native arm64)
 *      and `gnu_get_libc_version` (lightningcss-native arm64) — glibc-only
 *      symbols that a lazy load reports as success.
 *   2. **No environment.** The caller runs this with the loader's search
 *      variable UNSET and an absolute path, so the only way a Vala bridge can
 *      find the Rust cdylib staged beside it is its own `$ORIGIN` RUNPATH. That
 *      is the invariant `scripts/check-prebuild-loader-path.mjs` asserts
 *      structurally; this asserts it dynamically, on the real loader. The macOS
 *      legs get the same coverage from `/usr/bin/python3` + `ctypes.CDLL`,
 *      which is not available here: Alpine ships no python3 in the base image,
 *      and ctypes' default mode is RTLD_LOCAL *without* RTLD_NOW, so it would
 *      quietly give up point 1.
 *
 * A C driver needs nothing an Alpine build container does not already have
 * (`build-base`), which is why it is 20 lines of C rather than a dependency.
 * No `-ldl`: musl has no separate libdl, and glibc merged dlopen into libc in
 * 2.34 — plain `cc -o dlopen-rtld-now dlopen-rtld-now.c` links on both.
 *
 * Reproduce by hand (the same way the CI leg does):
 *   cc -o /tmp/dlopen-rtld-now .github/prebuild-toolchain/dlopen-rtld-now.c
 *   env -u LD_LIBRARY_PATH /tmp/dlopen-rtld-now "$PWD/packages/<pkg>/prebuilds/<target>/lib<name>.so"
 *
 * Exit status: 0 when every library loaded, 1 when any did not. Handles are
 * deliberately never dlclose()d — the process exits, and closing one could
 * unload a dependency the next library in the list is about to need.
 */

#include <dlfcn.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <library> [<library> ...]\n", argv[0]);
        return 2;
    }
    int rc = 0;
    for (int i = 1; i < argc; i++) {
        void *handle = dlopen(argv[i], RTLD_NOW | RTLD_LOCAL);
        if (handle == NULL) {
            /* musl's message names the unresolved symbol
             * ("Error relocating <lib>: <sym>: symbol not found"), which is the
             * whole diagnostic value of running this on a musl host. */
            fprintf(stderr, "dlopen(RTLD_NOW) FAILED %s: %s\n", argv[i], dlerror());
            rc = 1;
            continue;
        }
        printf("dlopen(RTLD_NOW) OK %s\n", argv[i]);
    }
    return rc;
}
