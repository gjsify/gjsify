// @gjsify/sab-native — SharedBuffer + atomics + fd-passing spec (GJS-only).
// Validates the Vala/C bridge end-to-end including cross-process via
// Gio.SubprocessLauncher.take_fd(parent_fd, 3) fd-inheritance.

import { describe, it, expect, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { SharedBuffer, atomics, hasNativeSab, fdChannel } from './index.js';

export default async () => {

  await on('Gjs', async () => {

    await describe('SharedBuffer — module load', async () => {
      await it('hasNativeSab() returns true when prebuild is loaded', async () => {
        expect(hasNativeSab()).toBe(true);
      });
    });

    await describe('SharedBuffer.create()', async () => {
      await it('allocates a region with positive byteLength and a real fd', async () => {
        const sb = SharedBuffer.create(4096);
        expect(sb.byteLength).toBe(4096);
        expect(sb.fd).toBeGreaterThan(2);
        expect(sb.closed).toBe(false);
      });

      await it('rejects size <= 0', async () => {
        let threw = false;
        try { SharedBuffer.create(0); } catch { threw = true; }
        expect(threw).toBe(true);
        threw = false;
        try { SharedBuffer.create(-1); } catch { threw = true; }
        expect(threw).toBe(true);
      });

      await it('rejects non-integer size', async () => {
        let threw = false;
        try { SharedBuffer.create(1.5 as any); } catch { threw = true; }
        expect(threw).toBe(true);
      });

      await it('close() marks the buffer as closed and rejects further use', async () => {
        const sb = SharedBuffer.create(64);
        sb.close();
        expect(sb.closed).toBe(true);
        let threw = false;
        try { sb.getUint8(0); } catch { threw = true; }
        expect(threw).toBe(true);
      });
    });

    await describe('SharedBuffer — typed accessors', async () => {
      await it('u8 read/write round-trip', async () => {
        const sb = SharedBuffer.create(64);
        sb.setUint8(0, 0xAB);
        sb.setUint8(63, 0x5C);
        expect(sb.getUint8(0)).toBe(0xAB);
        expect(sb.getUint8(63)).toBe(0x5C);
      });

      await it('i32 LE round-trip preserving sign', async () => {
        const sb = SharedBuffer.create(64);
        sb.setInt32LE(0, -42);
        sb.setInt32LE(4, 0x7FFFFFFF);
        sb.setInt32LE(8, -2147483648);
        expect(sb.getInt32LE(0)).toBe(-42);
        expect(sb.getInt32LE(4)).toBe(0x7FFFFFFF);
        expect(sb.getInt32LE(8)).toBe(-2147483648);
      });

      await it('u32 LE wraps signed-overflow values correctly', async () => {
        const sb = SharedBuffer.create(64);
        sb.setUint32LE(0, 0xFFFFFFFF);
        expect(sb.getUint32LE(0)).toBe(0xFFFFFFFF);
      });

      await it('LE byte-ordering — manual verification', async () => {
        const sb = SharedBuffer.create(64);
        sb.setInt32LE(0, 0x01020304);
        // Lowest byte first regardless of host endianness.
        expect(sb.getUint8(0)).toBe(0x04);
        expect(sb.getUint8(1)).toBe(0x03);
        expect(sb.getUint8(2)).toBe(0x02);
        expect(sb.getUint8(3)).toBe(0x01);
      });
    });

    await describe('SharedBuffer — readBytes / writeBytes', async () => {
      await it('round-trip over a small byte range', async () => {
        const sb = SharedBuffer.create(64);
        sb.writeBytes(0, new Uint8Array([1, 2, 3, 4, 5]));
        const out = sb.readBytes(0, 5);
        expect(out.length).toBe(5);
        expect(out[0]).toBe(1);
        expect(out[4]).toBe(5);
      });

      await it('writeBytes leaves untouched suffix intact', async () => {
        const sb = SharedBuffer.create(16);
        sb.setUint8(15, 0xEE);
        sb.writeBytes(0, new Uint8Array([0x10, 0x20]));
        expect(sb.getUint8(15)).toBe(0xEE);
      });
    });

    await describe('atomics namespace', async () => {
      await it('load/store/add round-trip', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 100);
        expect(atomics.load32(sb, 0)).toBe(100);

        const prev = atomics.add32(sb, 0, 7);
        expect(prev).toBe(100);                // fetch_add returns prior
        expect(atomics.load32(sb, 0)).toBe(107);
      });

      await it('exchange32 returns previous, writes new', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 42);
        const prev = atomics.exchange32(sb, 0, 99);
        expect(prev).toBe(42);
        expect(atomics.load32(sb, 0)).toBe(99);
      });

      await it('compareExchange32 — success path returns expected', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 50);
        const actual = atomics.compareExchange32(sb, 0, 50, 60);
        expect(actual).toBe(50);                // CAS succeeded
        expect(atomics.load32(sb, 0)).toBe(60);
      });

      await it('compareExchange32 — failure path returns actual, leaves value alone', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 50);
        const actual = atomics.compareExchange32(sb, 0, 999, 0);
        expect(actual).toBe(50);                // CAS failed, actual returned
        expect(atomics.load32(sb, 0)).toBe(50); // unchanged
      });
    });

    await describe('atomics.wait32 / notify32 (non-blocking probes)', async () => {
      await it('wait32 with mismatched expected returns "not-equal"', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 5);
        const r = atomics.wait32(sb, 0, 999, 1000);
        expect(r).toBe('not-equal');
      });

      await it('wait32 with matching expected + 0ms timeout returns "timed-out"', async () => {
        const sb = SharedBuffer.create(16);
        atomics.store32(sb, 0, 5);
        const r = atomics.wait32(sb, 0, 5, 0);
        expect(r).toBe('timed-out');
      });

      await it('notify32 returns count of woken (0 when no waiters)', async () => {
        const sb = SharedBuffer.create(16);
        const woken = atomics.notify32(sb, 0, 1);
        expect(woken).toBe(0);
      });
    });

    await describe('Cross-process fd inheritance (via Gio.SubprocessLauncher.take_fd)', async () => {
      await it('parent + child see the same backing store', async () => {
        const sb = SharedBuffer.create(64);

        // Parent writes initial marker.
        sb.setUint8(0, 0xAA);
        atomics.store32(sb, 8, 0);            // child will store 999 here

        // Child opens fd 3, mmaps the same region, mutates, exits.
        const childPath = `/tmp/sab-spec-child-${Date.now()}.mjs`;
        const childCode =
          `const SabNative = imports.gi.GjsifySabNative;\n` +
          `const sb = SabNative.SharedBuffer.from_fd(3, 64);\n` +
          `sb.set_u8(0, 0xCE);\n` +
          `sb.set_i32_le(4, 1234567);\n` +
          `sb.atomic_store_i32(8, 999);\n`;
        GLib.file_set_contents(childPath, childCode);

        try {
          const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
          launcher.take_fd(sb.fd, 3);
          const child = launcher.spawnv(['gjs', '-m', childPath]);
          // Wait for child synchronously.
          await new Promise<void>((resolve) => {
            child.wait_async(null, () => resolve());
          });

          // Parent observes child's writes (same mmap = same backing store).
          expect(sb.getUint8(0)).toBe(0xCE);
          expect(sb.getInt32LE(4)).toBe(1234567);
          expect(atomics.load32(sb, 8)).toBe(999);
        } finally {
          GLib.unlink(childPath);
        }
      });
    });

    await describe('FdChannel — socketpair + SCM_RIGHTS round-trip', async () => {
      await it('parent sends fd, child receives the same backing store', async () => {
        if (!fdChannel) throw new Error('fdChannel unavailable — prebuild missing');

        const { parentFd, childFd } = fdChannel.makePair();
        const sb = SharedBuffer.create(64);

        // Spawn child that reads one fd from socket and mutates the region.
        const childPath = `/tmp/sab-spec-fdpair-${Date.now()}.mjs`;
        const childCode =
          `const SabNative = imports.gi.GjsifySabNative;\n` +
          // recv_fd blocks until parent sends one; returns [fd, tag].
          `const [fd, tag] = SabNative.FdChannel.recv_fd(3);\n` +
          `const sb = SabNative.SharedBuffer.from_fd(fd, 64);\n` +
          `sb.set_u8(0, 0x55);\n` +
          `sb.atomic_store_i32(4, tag);\n`;
        GLib.file_set_contents(childPath, childCode);

        try {
          const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
          launcher.take_fd(childFd, 3);
          const child = launcher.spawnv(['gjs', '-m', childPath]);

          // Send the SharedBuffer's fd to the child over the side-channel.
          fdChannel.sendFd(parentFd, sb.fd, 0xDEADBEEF);

          await new Promise<void>((resolve) => {
            child.wait_async(null, () => resolve());
          });

          expect(sb.getUint8(0)).toBe(0x55);
          expect(atomics.load32(sb, 4) >>> 0).toBe(0xDEADBEEF);
        } finally {
          GLib.unlink(childPath);
          try { fdChannel?.closeFd(parentFd); } catch { /* ignore */ }
        }
      });
    });

  });
};
