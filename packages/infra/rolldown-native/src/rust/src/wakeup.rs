//! Wakeup — the portable "something is queued for you" channel between
//! the tokio worker threads and the GLib main loop.
//!
//! ONE implementation for every platform: an anonymous pipe. The
//! previous implementation used `eventfd(2)`, which is Linux-only (the
//! `libc` crate does not even expose it on Apple targets), so the crate
//! could not be compiled for macOS at all. A pipe is POSIX, is what the
//! Vala side already treats the descriptor as (`GLib.IOChannel.unix_new`
//! + `add_watch`, which only ever needs *a pollable fd*), and therefore
//! removes the platform split instead of doubling it — a second,
//! platform-gated wakeup path would only ever be exercised on the
//! platform nobody develops on.
//!
//! ## eventfd counter vs pipe byte stream
//!
//! An eventfd is a 64-bit counter: N writes coalesce into one readable
//! event and a single 8-byte read resets it. A pipe is a byte stream
//! with a finite buffer (64 KiB on Linux, 16 KiB on macOS). Swapping one
//! for the other naively introduces two bugs; both are handled
//! explicitly here and in `rolldown.vala`:
//!
//! 1. **Lost wakeup / blocked writer when the buffer is full.** Both
//!    ends are `O_NONBLOCK`, so a full buffer surfaces as `EAGAIN`
//!    (`ErrorKind::WouldBlock`) instead of parking a tokio worker
//!    thread forever. `EAGAIN` is *safe to drop*: a full buffer means
//!    the reader has not consumed the bytes already in it, so a wakeup
//!    is already pending. The reader always drains the pipe *before* it
//!    drains the request queue, and the queue push happens before the
//!    write attempt, so the item is guaranteed to be observed by the
//!    drain cycle that consumes those pending bytes. In other words the
//!    pipe recovers eventfd's coalescing property from its buffer
//!    instead of from a counter.
//!
//! 2. **A partial read leaves the fd readable.** The reader must
//!    consume *everything* available, not one fixed-size chunk. GLib's
//!    watch is level-triggered, so leftover bytes re-dispatch the
//!    callback — which re-drains the queue for nothing — once per chunk
//!    until the pipe empties: a burst of N wakes costs N/chunk no-op
//!    main-loop iterations instead of one. `rolldown.vala` reads to
//!    `G_IO_STATUS_AGAIN` so a burst collapses back into a single
//!    wake-up cycle, recovering the coalescing the counter gave for
//!    free.
//!
//! ## Ownership
//!
//! Both ends live in the same struct, which the session hands out as
//! `Arc<Wakeup>` to every holder (the proxies, the bundle task,
//! `SessionShared`, the session itself). Consequences:
//!
//! * The fd numbers stay reserved until the LAST holder — including a
//!   task leaked past the runtime shutdown timeout — drops its clone,
//!   so a deferred stale wake can never land in an fd number the kernel
//!   recycled into something else (issue #501's hazard, previously
//!   documented on the `Arc<OwnedFd>` eventfds).
//! * The read end cannot outlive the write end or vice versa, so
//!   `wake()` can never hit `EPIPE`/`SIGPIPE` — that would require the
//!   read end to be closed while a writer still holds a reference,
//!   which the shared ownership makes unrepresentable. (The Vala watch
//!   borrows the read fd with `set_close_on_unref(false)`, so it never
//!   closes it either.)
//!
//! Both ends are close-on-exec: `std::io::pipe()` sets `FD_CLOEXEC`
//! atomically where the platform supports it (`pipe2`), matching the
//! `EFD_CLOEXEC` the eventfds were created with. A wakeup fd leaking
//! into a subprocess spawned by a plugin hook would be a real fd leak.

use std::io::{ErrorKind, PipeReader, PipeWriter, Write};
use std::os::fd::{AsRawFd, RawFd};

/// A one-way "wake the main loop" channel.
#[derive(Debug)]
pub struct Wakeup {
    reader: PipeReader,
    writer: PipeWriter,
}

impl Wakeup {
    /// Create a non-blocking, close-on-exec wakeup pipe.
    pub fn new() -> std::io::Result<Self> {
        let (reader, writer) = std::io::pipe()?;
        // Non-blocking on BOTH ends: the writer must never park a tokio
        // worker on a full buffer, and the reader must be able to drain
        // to EAGAIN from the GLib main loop without blocking it.
        set_nonblocking(reader.as_raw_fd())?;
        set_nonblocking(writer.as_raw_fd())?;
        Ok(Self { reader, writer })
    }

    /// Raw read fd for the GLib watch. Borrowed — the `Wakeup` keeps
    /// ownership, so the watch must not close it.
    pub fn read_fd(&self) -> RawFd {
        self.reader.as_raw_fd()
    }

    /// Signal the main loop. Call AFTER pushing onto the queue the
    /// reader will drain.
    ///
    /// Never blocks and never fails the build: a full buffer
    /// (`WouldBlock`) means a wakeup is already pending and unread, so
    /// dropping this one loses nothing (see the module docs).
    ///
    /// Safe to call concurrently from every tokio worker: a write of
    /// `≤ PIPE_BUF` bytes is atomic per POSIX, so 1-byte wakes from
    /// different threads never interleave or tear.
    pub fn wake(&self) {
        loop {
            match (&self.writer).write(&[1u8]) {
                // A ≤PIPE_BUF write is atomic: either the byte is in or
                // we got EAGAIN, never a short write.
                Ok(_) => return,
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                // Buffer full — the reader still owes us a drain cycle,
                // and that cycle re-checks the queue. Coalesced.
                Err(e) if e.kind() == ErrorKind::WouldBlock => return,
                // Nothing actionable during teardown; the build result
                // is delivered through the queue + result slot, not here.
                Err(_) => return,
            }
        }
    }
}

fn set_nonblocking(fd: RawFd) -> std::io::Result<()> {
    // SAFETY: `fd` is owned by the `PipeReader`/`PipeWriter` the caller
    // holds for the duration of the call, so it is a valid open fd.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn cloexec_and_nonblocking_on_both_ends() {
        let w = Wakeup::new().expect("wakeup");
        for fd in [w.reader.as_raw_fd(), w.writer.as_raw_fd()] {
            let fdflags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
            assert!(fdflags >= 0);
            assert_ne!(fdflags & libc::FD_CLOEXEC, 0, "fd must be close-on-exec");
            let flflags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            assert!(flflags >= 0);
            assert_ne!(flflags & libc::O_NONBLOCK, 0, "fd must be non-blocking");
        }
    }

    #[test]
    fn wake_never_blocks_when_the_buffer_is_full() {
        let w = Wakeup::new().expect("wakeup");
        // Far more wakes than any pipe buffer can hold. If `wake()`
        // blocked or panicked on EAGAIN this would hang / fail.
        for _ in 0..200_000 {
            w.wake();
        }
        // A full drain (what the Vala watch does) makes the pipe
        // writable again — i.e. the wakeup channel is self-healing.
        let mut buf = [0u8; 4096];
        loop {
            match (&w.reader).read(&mut buf) {
                Ok(0) => break,
                Ok(_) => continue,
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) => panic!("unexpected drain error: {e}"),
            }
        }
        let mut probe = [0u8; 1];
        assert!(
            (&w.writer).write(&probe[..]).is_ok(),
            "a drained wakeup pipe must accept writes again"
        );
        assert_eq!((&w.reader).read(&mut probe).expect("read back"), 1);
    }
}
