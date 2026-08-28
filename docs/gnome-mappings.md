# GNOME libs & API mappings

> Which GNOME library backs which Node/Web/DOM API. The lookup table for
> "I am polyfilling X — what implements it here?".
> Rules for the packages themselves: [packages/node](../packages/node/AGENTS.md) ·
> [packages/web](../packages/web/AGENTS.md) · [packages/dom](../packages/dom/AGENTS.md).

## GNOME Libs & Mappings — `node_modules/@girs/*`

`@girs/glib-2.0` `gobject-2.0` `gio-2.0` `giounix-2.0` `soup-3.0` `gda-6.0` `gst-1.0`+`gstapp`+`gstwebrtc`+`gstsdp` `manette-0.2` `webkit-6.0` `gjs`

```
Node→GNOME: fs→Gio.File{,I/O}Stream | Buffer→GLib.Bytes/ByteArray/Uint8Array | net.Socket→Gio.Socket{Connection,Client} | http→Soup.{Session,Server} | crypto→GLib.{Checksum,Hmac} | process.env→GLib.{g,s}etenv() | url.URL→GLib.Uri | sqlite→Gda.Connection | tty/rawmode/columns→GjsifyTerminal (Posix.isatty+ioctl+termios)
Web→GNOME: fetch→Soup.Session | WebSocket→Soup.WebsocketConnection | XHR→Soup.Session+GLib | Streams→Gio.{In,Out}putStream | Compression→Gio.ZlibCompressor | SubtleCrypto→GLib.Checksum+Hmac | localStorage→in-memory Map (no GNOME backing yet; `Gio.File`+`GLib.KeyFile` is the candidate, unbuilt) | ImageBitmap→GdkPixbuf.Pixbuf | EventSource→Soup(SSE) | Gamepad→Manette | WebRTC→Gst.webrtcbin+GstSDP+webrtc-native | getUserMedia→pipewiresrc/pulsesrc/v4l2src
DOM→GNOME: Canvas2D→Cairo+PangoCairo | WebGL→Gtk.GLArea+libepoxy (gwebgl) | Video→Gtk.Picture+gtk4paintablesink | IFrame→WebKit.WebView
```
