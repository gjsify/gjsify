// Lifecycle helper for one in-flight Soup.ServerMessage.
//
// Consolidates four concerns that previously lived in two different files:
//   1. GC guard — keep the GObject alive until Soup is done with it; otherwise
//      SpiderMonkey can collect the JS wrapper and Soup's IO touches a freed
//      object → SIGSEGV.
//   2. Soup signal handling — translate 'finished' / 'disconnected' into Node-
//      style 'close' / 'aborted' on req/res.
//   3. Re-unpause tracking — Soup HTTP1 IO calls soup_server_message_pause()
//      after each chunk it writes; we need a matching unpause() on the next
//      append. The 'wrote-chunk' signal fires synchronously inside Soup's IO
//      just before that auto-pause, so by the time JS resumes pause_count is
//      back to 1 and unpause() is both safe and necessary.
//   4. GC-guard scoping — long-poll/SSE messages (typically GET requests that
//      never write) are deliberately *not* held in the GC guard. libsoup
//      stops polling the input stream while a message is paused
//      (refs/libsoup/libsoup/server/http1/soup-server-message-io-http1.c:32,
//      80–84, 1005–1010), so the 'disconnected' signal never fires for clients
//      that hang up mid-stream. Pinning those messages would leak Soup-
//      internal state and crash the server after a handful of aborted long-
//      polls. There is currently no public libsoup API to detect peer-close
//      on a paused message; tracked in STATUS.md as a known limitation.
//
// References:
//   * libsoup polling-on-pause behaviour:
//     refs/libsoup/libsoup/server/http1/soup-server-message-io-http1.c:32,80-84,1005-1010
//   * Node's equivalent socket.on('close') -> nextTick(emitCloseNT):
//     refs/node/lib/_http_server.js:272-294

import Soup from '@girs/soup-3.0';
import type { IncomingMessage } from './incoming-message.js';
import type { ServerResponse } from './server.js';

// Module-private GC guard. Holding the GObject in a JS-side Set pins the JS
// wrapper and therefore the underlying GObject until we explicitly release it.
const _activeMessages = new Set<Soup.ServerMessage>();

export class SoupMessageLifecycle {
  private readonly _soupMsg: Soup.ServerMessage;
  private readonly _req: IncomingMessage;
  private readonly _res: ServerResponse;
  private readonly _gcGuarded: boolean;

  private _destroyed = false;
  private _needsUnpause = false;

  // Signal handler IDs returned by Soup.ServerMessage.connect(). 0 = not connected.
  private _finishedId = 0;
  private _disconnectedId = 0;
  private _wroteChunkId = 0;

  constructor(soupMsg: Soup.ServerMessage, req: IncomingMessage, res: ServerResponse) {
    this._soupMsg = soupMsg;
    this._req = req;
    this._res = res;

    // Pinning a paused long-poll message in our GC guard would prevent the JS
    // wrapper from ever being collected, leaking Soup-internal IO state. For
    // GET (the canonical long-poll shape — SSE notifications, server-pushed
    // events) we let SpiderMonkey GC the wrapper naturally; the 'disconnected'
    // signal still fires correctly while Soup is actively reading the
    // request line + headers, just not after the server-side handler pauses.
    this._gcGuarded = req.method !== 'GET';
    if (this._gcGuarded) _activeMessages.add(soupMsg);

    // 'wrote-chunk' fires synchronously inside Soup's HTTP1 IO loop right
    // before the auto-pause. Setting the flag here means the next JS-level
    // _write/_final knows it's safe to call unpause() without going negative.
    this._wroteChunkId = soupMsg.connect('wrote-chunk', () => {
      this._needsUnpause = true;
    });

    // Client TCP-close detected by Soup. Reliable while Soup is actively
    // reading; not raised on paused/long-poll messages (libsoup limitation).
    this._disconnectedId = soupMsg.connect('disconnected', () => {
      this._handleDisconnected();
    });

    // Response complete. Release everything.
    this._finishedId = soupMsg.connect('finished', () => {
      const wasAborted = this._req.aborted;
      this.destroy();
      if (!wasAborted) this._req.emit('close');
    });
  }

  /**
   * Returns true at most once per Soup auto-pause cycle. Callers that hold the
   * "ticket" must follow up with `soupMsg.unpause()`. This is how `_write` /
   * `_final` know whether a wake-up call is needed without risking an extra
   * unpause that would corrupt Soup's pause_count.
   */
  consumeUnpauseTicket(): boolean {
    if (!this._needsUnpause) return false;
    this._needsUnpause = false;
    return true;
  }

  /**
   * Tear down: disconnect signal handlers, drop the GC guard. Idempotent —
   * called from the 'finished' handler and as a safety net from elsewhere.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    if (this._wroteChunkId !== 0) {
      this._soupMsg.disconnect(this._wroteChunkId);
      this._wroteChunkId = 0;
    }
    if (this._disconnectedId !== 0) {
      this._soupMsg.disconnect(this._disconnectedId);
      this._disconnectedId = 0;
    }
    if (this._finishedId !== 0) {
      this._soupMsg.disconnect(this._finishedId);
      this._finishedId = 0;
    }
    if (this._gcGuarded) _activeMessages.delete(this._soupMsg);
  }

  /**
   * Shared logic for "client gave up": emit aborted+close on req, close on
   * res if it's still writable. Soup will follow up with 'finished'; that
   * handler runs destroy().
   */
  private _handleDisconnected(): void {
    if (!this._req.aborted) {
      this._req.aborted = true;
      this._req.emit('aborted');
      this._req.emit('close');
    }
    if (!this._res.writableEnded && !this._res.finished) {
      this._res.emit('close');
    }
  }
}

/** @internal Test-only accessor for the GC guard count. */
export function _activeMessageCountForTests(): number {
  return _activeMessages.size;
}
