// SPDX-License-Identifier: MIT
// "Do GLib and Node name the same machine?" — one comparison, shared by the tests
// that assert `GLib.get_host_name()` against `os.hostname()`.
//
// Measured on Windows 11 ARM64: the two disagree IN CASE about the same host — GLib
// returns the NetBIOS name (`WIN11-ARM`), libuv the DNS name (`win11-arm`). Windows
// host names are case-insensitive, so the claim ("both name THIS machine") holds
// there; the x64 CI runners passed only because their name has one spelling.
// Everywhere else the two agree byte-for-byte, so the exact comparison stands and
// folding it unconditionally would throw a real divergence away.
import assert from 'node:assert/strict';
import { hostname } from 'node:os';

export function assertSameHostName(got) {
    const isWin32 = process.platform === 'win32';
    const os = hostname();
    assert.equal(isWin32 ? got.toLowerCase() : got, isWin32 ? os.toLowerCase() : os);
}
