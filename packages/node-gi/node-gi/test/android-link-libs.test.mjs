// SPDX-License-Identifier: MIT
// The library list of the Android link command — `scripts/build-android.mjs`.
//
// Runs on ANY host: `androidLinkArgs` takes the toolchain paths as arguments, so the list is
// checkable without an NDK, a GI stack for Android or a NativeScript AAR. That is the point —
// nothing else in the suite can reach this code path, and the bug below shipped because of it.
//
// The incident: `-llog` was absent, so `android-log.cc`'s `__android_log_print` and
// `__android_log_write` were undefined and `-Wl,--no-undefined` failed the link on BOTH ABIs.
// libNativeScript.so carries those two names, which is why the omission looked harmless, but it
// carries them as UND — it imports liblog itself — so the AAR satisfies nothing for a sibling
// .so. The only working Android builds had come from a spike script that passed `-llog`.
//
// `-Wl,--no-undefined` is asserted along with them: it is what turns a missing library into a
// build failure instead of a `dlopen` failure on the device, hours later.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { androidLinkArgs } from '../scripts/build-android.mjs';

const spec = {
    clang: '/ndk/bin/aarch64-linux-android24-clang++',
    out: '/out',
    objects: ['/out/addon.o', '/out/android-log.o'],
    libDir: '/sysroot/lib/arm64-v8a',
    napiLib: '/aar/jni/arm64-v8a/libNativeScript.so',
};

describe('androidLinkArgs: every library android-log.cc needs', () => {
    it('links liblog, which the NativeScript AAR only imports', () => {
        assert.ok(androidLinkArgs(spec).includes('-llog'));
    });

    it('links libandroid for the ALooper pump', () => {
        assert.ok(androidLinkArgs(spec).includes('-landroid'));
    });

    it('keeps --no-undefined, so a missing library fails the build and not the device', () => {
        assert.ok(androidLinkArgs(spec).includes('-Wl,--no-undefined'));
    });

    it('puts the objects and the AAR in the command', () => {
        const argv = androidLinkArgs(spec);
        assert.equal(argv[0], spec.clang);
        assert.deepEqual(argv.slice(1, 4), ['-shared', '-o', '/out/libnode_gi.so']);
        for (const object of spec.objects) assert.ok(argv.includes(object));
        assert.ok(argv.includes(spec.napiLib));
    });
});
