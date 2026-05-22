// Loro × Adwaita collaborative-editor example.
//
// Demonstrates a two-pane GTK4/Adwaita window where each pane edits its
// own `LoroDoc` (a CRDT — Conflict-free Replicated Data Type — backed by
// the loro-crdt npm package). Every edit is dispatched into the local
// doc, then snapshot bytes are exchanged with the remote doc and merged
// — both panes converge on the same text without a central server.
//
// What it proves:
//   - loro-crdt loads under GJS via the base64 entry (no fs / fetch /
//     bundler magic — the WASM is decoded from an inlined string at
//     module-init time).
//   - @gjsify/webassembly's `WebAssembly.compile` / `instantiate` Promise
//     APIs sit underneath the wasm-bindgen glue without modification.
//   - The standard Web globals (TextEncoder, TextDecoder, crypto.
//     getRandomValues, performance.now, …) the WASM module reaches for
//     are provided by gjsify's polyfills — `--globals auto,Text*,
//     performance,crypto` injection during the gjsify build handles the
//     dependency chain.
//   - A real Adwaita app can drive a CRDT runtime without any DOM
//     machinery — `Gtk.TextView.buffer.text` IS the text-source and we
//     mirror it into `LoroText`'s value-source.
//
// What you do with it:
//   - Type into the left pane → text appears in the right pane after a
//     debounced sync (50 ms idle). Same the other way around.
//   - Edit both panes simultaneously → CRDT merges keep both eventually
//     consistent; no character is lost.
//   - The status bar prints peer-ids + snapshot byte-counts so you can
//     watch the sync envelope shrink/grow with each edit.

import '@girs/gjs';
import '@girs/adw-1';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Adw from 'gi://Adw?version=1';
import { LoroDoc } from 'loro-crdt/base64/index.js';

// Single shared container key. Both docs hold a `LoroText` under this
// key; the contents are what we sync.
const TEXT_KEY = 'shared-text';

// Idle-sync debounce — after a TextBuffer change we wait N ms before
// flushing the LoroDoc to the peer. Keeps the merge cost off the
// keystroke hot path; for a real app you'd batch over a tick or a
// requestAnimationFrame frame.
const SYNC_DEBOUNCE_MS = 50;

/** One pane = one Gtk.TextView paired with its own LoroDoc. */
class Peer {
    readonly doc: InstanceType<typeof LoroDoc>;
    readonly buffer: Gtk.TextBuffer;
    readonly view: Gtk.TextView;

    /** Suppress re-entering the change handler while applying a remote sync. */
    private applyingRemote = false;
    private syncTimer: number | null = null;

    constructor(label: string, peerId: string) {
        this.doc = new LoroDoc();
        this.doc.setPeerId(peerId);
        // Seed the doc with an empty LoroText so the container exists
        // on both sides before the first sync.
        this.doc.getText(TEXT_KEY);

        this.buffer = new Gtk.TextBuffer();
        this.view = new Gtk.TextView({
            buffer: this.buffer,
            wrapMode: Gtk.WrapMode.WORD_CHAR,
            monospace: true,
            topMargin: 12,
            bottomMargin: 12,
            leftMargin: 12,
            rightMargin: 12,
        });
        this.view.add_css_class('card');
        // Stash the label on the instance for status-bar text.
        this._label = label;
    }

    _label: string;
    get label(): string {
        return this._label;
    }

    /**
     * Wire a change listener that mirrors the TextBuffer into LoroText.
     * The callback fires N ms after the last edit; remote syncs go
     * through `applyRemoteSnapshot` which suppresses this handler.
     */
    onLocalChange(after: () => void): void {
        this.buffer.connect('changed', () => {
            if (this.applyingRemote) return;
            if (this.syncTimer !== null) {
                GLib.source_remove(this.syncTimer);
            }
            this.syncTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SYNC_DEBOUNCE_MS, () => {
                this.syncTimer = null;
                this.flushBufferToDoc();
                after();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    /**
     * Project the TextBuffer's text into the LoroDoc's LoroText.
     * Simple full-replace strategy — good enough for a demo (CRDTs
     * handle the diff internally). A real editor would diff-and-patch
     * for finer-grained ops.
     */
    flushBufferToDoc(): void {
        const text = this.doc.getText(TEXT_KEY);
        const current = text.toString();
        const next = this.buffer.text;
        if (current === next) return;
        // Replace via delete-then-insert — Loro's text container has
        // insert/delete primitives; a sophisticated app would do
        // character-level diffs, this demo lifts the whole buffer.
        if (current.length > 0) {
            text.delete(0, current.length);
        }
        if (next.length > 0) {
            text.insert(0, next);
        }
        this.doc.commit();
    }

    /**
     * Apply a remote snapshot, then mirror the merged LoroText back into
     * the TextBuffer. The buffer-write fires the `changed` signal, so we
     * gate the change handler against this re-entry via `applyingRemote`.
     */
    applyRemoteSnapshot(bytes: Uint8Array): void {
        this.doc.import(bytes);
        const merged = this.doc.getText(TEXT_KEY).toString();
        if (this.buffer.text === merged) return;
        this.applyingRemote = true;
        try {
            // Preserve cursor position by remembering its character offset
            // and restoring after the replace.
            const cursorIter = this.buffer.get_iter_at_mark(this.buffer.get_insert());
            const cursorOffset = cursorIter.get_offset();
            this.buffer.set_text(merged, -1);
            // Clamp restored offset to merged length (text might be shorter
            // after concurrent deletes).
            const restored = this.buffer.get_iter_at_offset(Math.min(cursorOffset, merged.length));
            this.buffer.place_cursor(restored);
        } finally {
            this.applyingRemote = false;
        }
    }
}

function buildWindow(app: Adw.Application): Gtk.Window {
    const leftPeer = new Peer('A', '1');
    const rightPeer = new Peer('B', '2');

    // Seed both panes with a friendly hello so the sync mechanism is
    // visible on first launch.
    leftPeer.buffer.text = 'Welcome to Loro × Adwaita!\n\nEdit this pane on the left…';
    rightPeer.buffer.text = '';

    const win = new Adw.ApplicationWindow({
        application: app,
        title: 'Loro × Adwaita — Collaborative Editor',
        defaultWidth: 1000,
        defaultHeight: 640,
    });

    // Status bar at the bottom: peer-ids + last-sync byte counts.
    const statusLabel = new Gtk.Label({
        label: '',
        xalign: 0,
        marginStart: 12,
        marginEnd: 12,
        marginTop: 6,
        marginBottom: 6,
    });
    statusLabel.add_css_class('caption');

    const updateStatus = (lastSyncBytes: number, direction: 'A → B' | 'B → A' | 'idle') => {
        const aLen = leftPeer.doc.getText(TEXT_KEY).length;
        const bLen = rightPeer.doc.getText(TEXT_KEY).length;
        statusLabel.label =
            `Peer A: ${leftPeer.doc.peerIdStr}  |  ` +
            `Peer B: ${rightPeer.doc.peerIdStr}  |  ` +
            `A len: ${aLen}  B len: ${bLen}  |  ` +
            `last sync: ${direction === 'idle' ? 'idle' : `${direction}, ${lastSyncBytes} bytes`}`;
    };

    // The sync handler — flush local doc, export snapshot, apply to
    // remote peer, then mirror merged text back into the receiver's
    // buffer.
    const syncFromTo = (source: Peer, target: Peer, dir: 'A → B' | 'B → A') => {
        const snap = source.doc.export({ mode: 'snapshot' });
        target.applyRemoteSnapshot(snap);
        updateStatus(snap.length, dir);
    };

    leftPeer.onLocalChange(() => syncFromTo(leftPeer, rightPeer, 'A → B'));
    rightPeer.onLocalChange(() => syncFromTo(rightPeer, leftPeer, 'B → A'));

    // Initial sync: push A's seed text into B.
    leftPeer.flushBufferToDoc();
    syncFromTo(leftPeer, rightPeer, 'A → B');

    // Pane scaffolding — two scrolled TextViews side by side.
    const paneFor = (peer: Peer): Gtk.Widget => {
        const header = new Gtk.Label({
            label: `Peer ${peer.label}`,
            xalign: 0,
            marginStart: 12,
            marginEnd: 12,
            marginTop: 8,
            marginBottom: 4,
        });
        header.add_css_class('heading');

        const scroll = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            child: peer.view,
        });
        scroll.add_css_class('frame');

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            marginStart: 6,
            marginEnd: 6,
            marginTop: 6,
            marginBottom: 6,
        });
        box.append(header);
        box.append(scroll);
        return box;
    };

    const paned = new Gtk.Paned({
        orientation: Gtk.Orientation.HORIZONTAL,
        startChild: paneFor(leftPeer),
        endChild: paneFor(rightPeer),
        position: 500,
    });

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    const headerBar = new Adw.HeaderBar();
    content.append(headerBar);
    content.append(paned);

    const separator = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL });
    content.append(separator);
    content.append(statusLabel);

    win.set_content(content);

    updateStatus(0, 'idle');
    return win;
}

const app = new Adw.Application({
    applicationId: 'io.github.gjsify.LoroCollab',
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    const win = buildWindow(app);
    win.present();
});

await app.runAsync([]);
