// GJS entry — WebRTC connection states with Adwaita + VideoBridge.
//
// Adapted from refs/webrtc-samples/src/content/peerconnection/states/
// Copyright (c) 2015 The WebRTC project authors. BSD license.
// Reimplemented for GJS using @gjsify/webrtc + @gjsify/video.

import '@girs/gjs';
import '@girs/gtk-4.0';
import '@girs/adw-1';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import { VideoBridge } from '@gjsify/video';

import { runStatesDemo, type StateCallbacks } from '../states-demo.js';

declare const print: ((msg: string) => void) | undefined;

function log(tag: string, msg: string): void {
    if (typeof print === 'function') {
        print(`[${tag}] ${msg}`);
    } else {
        console.log(`[${tag}] ${msg}`);
    }
}

const app = new Adw.Application({
    application_id: 'gjsify.examples.webrtc-states',
});

app.connect('activate', () => {
    const win = new Adw.ApplicationWindow({ application: app });
    win.set_default_size(800, 600);
    win.set_title('WebRTC States — Connection State Monitor');

    const headerBar = new Adw.HeaderBar();
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(headerBar);

    // Main vertical layout
    const mainBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 8,
        margin_end: 8,
    });

    // Video area: two VideoBridges side by side
    const videoBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        homogeneous: true,
        vexpand: true,
    });

    const localBridge = new VideoBridge();
    const remoteBridge = new VideoBridge();
    videoBox.append(localBridge);
    videoBox.append(remoteBridge);
    mainBox.append(videoBox);

    // State display grid
    const stateGrid = new Gtk.Grid({
        row_spacing: 4,
        column_spacing: 16,
        margin_top: 8,
    });

    // Headers
    const headerEmpty = new Gtk.Label({ label: '' });
    const headerPc1 = new Gtk.Label({ label: 'PC1 (Local)' });
    headerPc1.add_css_class('heading');
    const headerPc2 = new Gtk.Label({ label: 'PC2 (Remote)' });
    headerPc2.add_css_class('heading');
    stateGrid.attach(headerEmpty, 0, 0, 1, 1);
    stateGrid.attach(headerPc1, 1, 0, 1, 1);
    stateGrid.attach(headerPc2, 2, 0, 1, 1);

    // State labels
    const labels = {
        signaling: new Gtk.Label({ label: 'Signaling:' }),
        ice: new Gtk.Label({ label: 'ICE:' }),
        connection: new Gtk.Label({ label: 'Connection:' }),
    };
    const pc1Labels = {
        signaling: new Gtk.Label({ label: '—', xalign: 0 }),
        ice: new Gtk.Label({ label: '—', xalign: 0 }),
        connection: new Gtk.Label({ label: '—', xalign: 0 }),
    };
    const pc2Labels = {
        signaling: new Gtk.Label({ label: '—', xalign: 0 }),
        ice: new Gtk.Label({ label: '—', xalign: 0 }),
        connection: new Gtk.Label({ label: '—', xalign: 0 }),
    };

    stateGrid.attach(labels.signaling, 0, 1, 1, 1);
    stateGrid.attach(pc1Labels.signaling, 1, 1, 1, 1);
    stateGrid.attach(pc2Labels.signaling, 2, 1, 1, 1);

    stateGrid.attach(labels.ice, 0, 2, 1, 1);
    stateGrid.attach(pc1Labels.ice, 1, 2, 1, 1);
    stateGrid.attach(pc2Labels.ice, 2, 2, 1, 1);

    stateGrid.attach(labels.connection, 0, 3, 1, 1);
    stateGrid.attach(pc1Labels.connection, 1, 3, 1, 1);
    stateGrid.attach(pc2Labels.connection, 2, 3, 1, 1);

    mainBox.append(stateGrid);
    toolbarView.set_content(mainBox);
    win.set_content(toolbarView);

    // Update label from main thread
    function setLabel(label: Gtk.Label, text: string) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            label.set_label(text);
            return GLib.SOURCE_REMOVE;
        }, null);
    }

    const callbacks: StateCallbacks = {
        onPc1Signal: (s) => setLabel(pc1Labels.signaling, s),
        onPc1Ice: (s) => setLabel(pc1Labels.ice, s),
        onPc1Conn: (s) => setLabel(pc1Labels.connection, s),
        onPc2Signal: (s) => setLabel(pc2Labels.signaling, s),
        onPc2Ice: (s) => setLabel(pc2Labels.ice, s),
        onPc2Conn: (s) => setLabel(pc2Labels.connection, s),
        onRemoteStream: (stream) => {
            remoteBridge.onReady((video) => {
                (video as any).srcObject = stream;
            });
        },
    };

    // Start demo when local video bridge is ready
    localBridge.onReady(async (localVideo) => {
        try {
            const { hangup } = await runStatesDemo(log, localVideo as any, callbacks);
            win.connect('close-request', () => {
                hangup();
                return false;
            });
        } catch (err: any) {
            log('ERROR', err?.message ?? String(err));
        }
    });

    win.present();
});

app.run([]);
