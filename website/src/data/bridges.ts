// DOM↔GTK bridges shipped under `packages/framework/*`.
//
// Bridges aren't measured as a coverage percentage — there's no canonical
// "all bridges" list to compare against. They're a feature catalogue:
// "these standard DOM elements have a native GTK rendering backend".

export interface Bridge {
	domSurface: string;
	gtkBacking: string;
	package: string;
	libs: string;
}

export const bridges: readonly Bridge[] = [
	{
		domSurface: "HTMLCanvasElement (2D)",
		gtkBacking: "Gtk.DrawingArea",
		package: "@gjsify/canvas2d",
		libs: "Cairo + PangoCairo",
	},
	{
		domSurface: "HTMLCanvasElement (WebGL/WebGL2)",
		gtkBacking: "Gtk.GLArea",
		package: "@gjsify/webgl",
		libs: "Vala/gwebgl + libepoxy",
	},
	{
		domSurface: "HTMLIFrameElement",
		gtkBacking: "WebKit.WebView",
		package: "@gjsify/iframe",
		libs: "WebKit 6.0",
	},
	{
		domSurface: "HTMLVideoElement",
		gtkBacking: "Gtk.Picture",
		package: "@gjsify/video",
		libs: "GStreamer + gtk4paintablesink",
	},
];

export interface NativeBridge {
	name: string;
	pkg: string;
	purpose: string;
}

/** Native Vala bridges that ship as separate npm packages with prebuilds. */
export const nativeBridges: readonly NativeBridge[] = [
	{
		name: "Terminal",
		pkg: "@gjsify/terminal-native",
		purpose: "Posix.isatty + ioctl TIOCGWINSZ + termios for @gjsify/tty",
	},
	{
		name: "Shared ArrayBuffer",
		pkg: "@gjsify/sab-native",
		purpose: "Cross-process shared memory + futex atomics for @gjsify/worker_threads",
	},
	{
		name: "TLS",
		pkg: "@gjsify/tls-native",
		purpose: "Direct OpenSSL access for @gjsify/tls",
	},
	{
		name: "HTTP-Soup",
		pkg: "@gjsify/http-soup-bridge",
		purpose: "Native Soup integration helpers for @gjsify/http",
	},
	{
		name: "HTTP/2",
		pkg: "@gjsify/http2-native",
		purpose: "nghttp2 bridge for h2c, push streams, flow control",
	},
	{
		name: "WebRTC",
		pkg: "@gjsify/webrtc-native",
		purpose: "GLib.Idle signal marshalling for webrtcbin's streaming-thread callbacks",
	},
];
