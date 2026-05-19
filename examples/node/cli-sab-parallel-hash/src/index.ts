// 4-worker parallel SHA-256 over a @gjsify/sab-native SharedBuffer.
//
// Demonstrates:
// - SharedBuffer.create(size)         — memfd_create + mmap(MAP_SHARED)
// - sb.setUint8 / sb.readBytes        — typed accessors, GLib.Bytes zero-copy reads
// - atomics.store32 / atomics.load32  — SEQ_CST cross-process atomics (Linux futex)
// - Worker.postMessage(value, [sb])   — transferList carries the memfd over
//                                       SCM_RIGHTS via the inherited fd 3
//                                       side-channel
//
// Workload: split a deterministic 4 MiB payload into 4 slices, spawn 4
// cross-process workers via node:worker_threads, each computes SHA-256 over
// its slice with GLib.Checksum and writes the 32-byte digest back into the
// shared region. The parent polls a per-worker barrier (atomics.load32) on
// a 2 ms timer to stay responsive, then XOR-folds the four digests and
// verifies the result against a single-threaded reference computed in-process.
//
// On Node the example exits with a friendly note — @gjsify/sab-native is a
// GJS-only Vala bridge (memfd_create / SCM_RIGHTS / futex are Linux-libc
// primitives, exposed through GObject introspection).

import { runtimeName } from '@gjsify/runtime';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';

const PAYLOAD_BYTES = 4 * 1024 * 1024;   // 4 MiB
const WORKER_COUNT  = 4;
const SLICE_BYTES   = PAYLOAD_BYTES / WORKER_COUNT;
const BARRIER_OFF   = PAYLOAD_BYTES;                       // 4 × u32 barrier slots
const DIGEST_OFF    = PAYLOAD_BYTES + WORKER_COUNT * 4;    // 4 × 32-byte digests
const REGION_BYTES  = DIGEST_OFF + WORKER_COUNT * 32;
const POLL_MS       = 2;
const TIMEOUT_MS    = 30_000;

// The worker source runs under GJS (Gio.Subprocess child). Hash a slice with
// GLib.Checksum.SHA256, write the digest into the SharedBuffer, then bump the
// barrier slot to signal completion. Times the actual hash work and posts
// the per-worker duration back to the parent.
const WORKER_SRC = `
  const GLib_ = imports.gi.GLib;
  const sb = workerData.sb;
  const slot = workerData.slot;
  const start = workerData.start;
  const len = workerData.len;
  const digestOff = workerData.digestOff;
  const barrierOff = workerData.barrierOff;

  const t0 = Date.now();
  const bytes = sb.readBytes(start, len);
  const cs = GLib_.Checksum.new(GLib_.ChecksumType.SHA256);
  cs.update(bytes);
  const out = new Uint8Array(32);
  try {
    cs.get_digest(out, 32);
  } catch (_) {
    const hex = cs.get_string();
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i*2, 2), 16);
  }
  sb.writeBytes(digestOff + slot * 32, out);
  // Bump the barrier slot last — memory ordering guarantees the digest write
  // is visible to the parent before it observes the non-zero slot.
  sb._nativeHandle.atomic_store_i32(barrierOff + slot * 4, slot + 1);
  parentPort.postMessage({ slot, ms: Date.now() - t0 });
`;

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

async function main(): Promise<void> {
  console.log(`${BOLD}${CYAN}gjsify · cli-sab-parallel-hash${RESET}`);
  console.log(`${DIM}Runtime: ${runtimeName} | Workers: ${WORKER_COUNT} | Payload: ${(PAYLOAD_BYTES / 1024 / 1024).toFixed(0)} MiB${RESET}`);
  console.log('');

  if (runtimeName !== 'GJS') {
    console.log(`${YELLOW}This example showcases @gjsify/sab-native, which is a GJS-only Vala`);
    console.log(`bridge over Linux memfd_create / SCM_RIGHTS / futex.${RESET}`);
    console.log('');
    console.log(`Run with: ${BOLD}gjsify run dist/index.gjs.js${RESET}`);
    return;
  }

  // Static import would pull @girs/gjs into the Node bundle; lazy-load
  // inside the GJS-only branch so `--app node` ships without it.
  const sabMod = await import('@gjsify/sab-native');
  if (!sabMod.hasNativeSab()) {
    console.log(`${RED}@gjsify/sab-native prebuild missing.${RESET}`);
    console.log(`${DIM}Install the package to provide GjsifySabNative.so + .typelib.${RESET}`);
    process.exit(1);
  }
  const { SharedBuffer, atomics } = sabMod;

  // Allocate the shared region and seed it with a deterministic byte pattern
  // so successive runs produce the same digest.
  const sb = SharedBuffer.create(REGION_BYTES);
  // Non-periodic deterministic seed: mix high-order bytes of `i` so successive
  // slices differ. (A plain `(i * 31 + 7) & 0xff` cycles every 256 bytes and
  // gives every 1 MiB slice the same content — XOR-folded digest would
  // collapse to zero.)
  for (let i = 0; i < PAYLOAD_BYTES; i++) {
    const mixed = (i ^ (i >>> 8) ^ (i >>> 16)) * 31 + 7;
    sb.setUint8(i, mixed & 0xff);
  }
  for (let i = 0; i < WORKER_COUNT; i++) atomics.store32(sb, BARRIER_OFF + i * 4, 0);

  console.log(`${YELLOW}Spawning ${WORKER_COUNT} workers ...${RESET}`);
  const t0 = Date.now();

  const workers: Worker[] = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    workers.push(new Worker(WORKER_SRC, {
      eval: true,
      workerData: {
        sb,
        slot: i,
        start: i * SLICE_BYTES,
        len: SLICE_BYTES,
        digestOff: DIGEST_OFF,
        barrierOff: BARRIER_OFF,
      },
    }));
  }

  // Collect per-worker timings (purely for the report — barrier is the real
  // completion signal).
  const timings = new Array<number>(WORKER_COUNT).fill(0);
  workers.forEach((w, i) => w.once('message', (msg: { slot: number; ms: number }) => {
    timings[msg.slot ?? i] = msg.ms;
  }));

  // Barrier poll. setTimeout keeps the GJS main loop responsive (no blocking
  // futex_wait on the parent's single-threaded event loop).
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let done = 0;
      for (let i = 0; i < WORKER_COUNT; i++) {
        if (atomics.load32(sb, BARRIER_OFF + i * 4) > 0) done++;
      }
      if (done === WORKER_COUNT) return resolve();
      if (Date.now() - start > TIMEOUT_MS) {
        return reject(new Error(`barrier timeout: ${done}/${WORKER_COUNT} done after ${TIMEOUT_MS}ms`));
      }
      setTimeout(tick, POLL_MS);
    };
    tick();
  });

  const wallMs = Date.now() - t0;

  // Read each worker's digest out of the region and XOR-fold.
  const folded = new Uint8Array(32);
  for (let i = 0; i < WORKER_COUNT; i++) {
    const d = sb.readBytes(DIGEST_OFF + i * 32, 32);
    for (let j = 0; j < 32; j++) folded[j] ^= d[j]!;
  }

  // Reference: compute the same XOR-fold single-threaded in the parent.
  const reference = new Uint8Array(32);
  for (let i = 0; i < WORKER_COUNT; i++) {
    const slice = sb.readBytes(i * SLICE_BYTES, SLICE_BYTES);
    const d = createHash('sha256').update(slice).digest();
    for (let j = 0; j < 32; j++) reference[j] ^= d[j]!;
  }

  // Report ───────────────────────────────────────────────────────────
  console.log('');
  for (let i = 0; i < WORKER_COUNT; i++) {
    const sliceMiB = SLICE_BYTES / 1024 / 1024;
    const ms = timings[i] || 0;
    const mibPerSec = ms > 0 ? (sliceMiB * 1000 / ms).toFixed(1) : '∞';
    const d = sb.readBytes(DIGEST_OFF + i * 32, 32);
    console.log(`  ${CYAN}Worker ${i}${RESET}: ${sliceMiB.toFixed(2)} MiB in ${ms.toString().padStart(4, ' ')} ms ` +
                `(${mibPerSec.padStart(5, ' ')} MiB/s) ${DIM}→ ${toHex(d).slice(0, 16)}…${RESET}`);
  }
  console.log('');
  console.log(`  ${BOLD}XOR-folded:${RESET}      ${toHex(folded)}`);
  console.log(`  ${DIM}reference:       ${toHex(reference)}${RESET}`);

  const match = folded.every((b, i) => b === reference[i]);
  console.log('');
  if (match) {
    console.log(`${GREEN}✓ digest matches in-process reference${RESET}  ${DIM}(wall: ${wallMs} ms)${RESET}`);
  } else {
    console.log(`${RED}✗ digest mismatch — cross-process write was not visible${RESET}`);
    process.exit(1);
  }

  await Promise.all(workers.map(w => w.terminate()));
}

await main();
