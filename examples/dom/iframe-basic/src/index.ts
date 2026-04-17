// IFrame basic example — demonstrates HTMLIFrameElement with bidirectional postMessage
//
// This GTK app creates an IFrameBridge (WebKit.WebView) and communicates with
// its content using the standard postMessage API, just like a browser iframe.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import { IFrameBridge } from '@gjsify/iframe';

// HTML content loaded into the iframe via srcdoc
const IFRAME_CONTENT = `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: system-ui, sans-serif;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        h2 { margin-top: 0; color: #1a73e8; }
        #messages {
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 12px;
            min-height: 100px;
            max-height: 300px;
            overflow-y: auto;
        }
        .msg {
            padding: 4px 8px;
            margin: 4px 0;
            border-radius: 4px;
            background: #e8f0fe;
        }
        button {
            margin-top: 12px;
            padding: 8px 16px;
            background: #1a73e8;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover { background: #1557b0; }
        #counter { font-weight: bold; color: #1a73e8; }
    </style>
</head>
<body>
    <h2>Inside IFrame (WebView)</h2>
    <p>Messages received from GJS parent: <span id="counter">0</span></p>
    <div id="messages"></div>
    <button onclick="sendToParent()">Send message to GJS</button>

    <script>
        var count = 0;

        // Listen for messages from the GJS parent
        window.addEventListener('message', function(event) {
            count++;
            document.getElementById('counter').textContent = count;
            var div = document.createElement('div');
            div.className = 'msg';
            div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + JSON.stringify(event.data);
            document.getElementById('messages').appendChild(div);
            document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
        });

        // Send a message back to the GJS parent
        function sendToParent() {
            window.parent.postMessage({
                type: 'greeting',
                text: 'Hello from WebView!',
                timestamp: Date.now()
            }, '*');
        }
    </script>
</body>
</html>`;

function activate(app: Gtk.Application) {
    const win = new Gtk.ApplicationWindow({
        application: app,
        default_width: 800,
        default_height: 600,
        title: 'IFrame Basic Example',
    });

    // Main layout
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
    });

    // Header with send button
    const headerBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        margin_top: 8,
        margin_bottom: 8,
        margin_start: 12,
        margin_end: 12,
    });
    const infoLabel = new Gtk.Label({
        label: 'Bidirectional postMessage between GJS and WebView iframe',
        hexpand: true,
        xalign: 0,
    });
    const sendButton = new Gtk.Button({ label: 'Send to IFrame' });
    headerBox.append(infoLabel);
    headerBox.append(sendButton);
    box.append(headerBox);

    // Create the IFrameBridge
    const iframeWidget = new IFrameBridge();

    // Listen for messages from the iframe content
    iframeWidget.onReady((iframe) => {
        const contentWindow = iframe.contentWindow;
        if (contentWindow) {
            contentWindow.addEventListener('message', (event: Event) => {
                const msgEvent = event as MessageEvent;
                console.log('[GJS] Received from iframe:', JSON.stringify(msgEvent.data));
            });
        }
        console.log('[GJS] IFrame is ready');
    });

    // Send button handler
    let messageCount = 0;
    sendButton.connect('clicked', () => {
        messageCount++;
        iframeWidget.postMessage({
            type: 'greeting',
            text: `Hello from GJS! (message #${messageCount})`,
            timestamp: Date.now(),
        });
        console.log(`[GJS] Sent message #${messageCount} to iframe`);
    });

    // Load content
    iframeWidget.iframeElement.srcdoc = IFRAME_CONTENT;

    // Make the iframe expand to fill available space
    iframeWidget.vexpand = true;
    iframeWidget.hexpand = true;
    box.append(iframeWidget);

    win.set_child(box);
    win.present();
}

function main() {
    const app = Gtk.Application.new(
        'gjsify.examples.iframe-basic',
        Gio.ApplicationFlags.FLAGS_NONE,
    );
    app.connect('activate', () => activate(app));
    app.run([]);
}

main();
