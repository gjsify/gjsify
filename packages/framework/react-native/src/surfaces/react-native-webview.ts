// `react-native-webview` — a real widget, on the webkit track (ADR 0036 § 5 (b)).
//
// WebKitGTK's `WebKit.WebView` is the counterpart and it is a genuine one. What keeps
// it off this surface is not the mapping: it is that WebKit's availability differs per
// OS (ADR 0022) and it would be the heaviest dependency any of these surfaces adds. So
// this is a row and a pointer, and the gate refuses the import with that sentence
// rather than the bundler failing on module resolution.

import { unsupported } from '../unsupported.js';

/** The default export is `WebView`; `export * from` never carries a default. */
export default unsupported('default', 'react-native-webview');

export * from '../generated/unsupported-react-native-webview.js';
