// Centralised Gio._promisify of the WebKit.WebView async methods used across
// @gjsify/iframe — original implementation.
//
// Importing this module once installs the Promise-returning overloads on the
// prototype. ES modules are singletons, so the patch runs exactly once no
// matter how many sibling modules import it — which is why both
// `message-bridge.ts` (postMessage delivery) and `iframe-bridge.ts`
// (evaluateJavaScript / takeScreenshot) import it instead of patching
// independently (a double `_promisify` of the same method is avoided).

import Gio from 'gi://Gio?version=2.0';
import WebKit from 'gi://WebKit?version=6.0';

Gio._promisify(WebKit.WebView.prototype, 'evaluate_javascript', 'evaluate_javascript_finish');
Gio._promisify(WebKit.WebView.prototype, 'get_snapshot', 'get_snapshot_finish');
