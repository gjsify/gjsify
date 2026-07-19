// Registers XMLHttpRequest / XMLHttpRequestUpload on globalThis.
//
// The Blob → file:// URL chain required by Excalibur's ImageSource / FontFace
// is split across two packages:
//   - `@gjsify/fetch` XHR (this package): when responseType='blob', materialise
//     the response to a GLib temp file and attach `_tmpPath` to the returned
//     Blob.
//   - `@gjsify/url` URL class: `URL.createObjectURL(blob)` reads `_tmpPath`
//     and returns a `file://` URL that HTMLImageElement etc. can load.
//
// There is no URL monkey-patching here — URL owns createObjectURL natively.

import GLib from 'gi://GLib?version=2.0';
import { XMLHttpRequest, XMLHttpRequestUpload } from '../xhr.js';

if (typeof globalThis.XMLHttpRequest === 'undefined') {
    globalThis.XMLHttpRequest = XMLHttpRequest as unknown as typeof globalThis.XMLHttpRequest;
}
if (typeof globalThis.XMLHttpRequestUpload === 'undefined') {
    globalThis.XMLHttpRequestUpload = XMLHttpRequestUpload as unknown as typeof globalThis.XMLHttpRequestUpload;
}

// Pair the `_tmpPath`-blob producer (this XHR writes `responseType:'blob'`
// responses to a GLib temp file and tags the Blob with `_tmpPath`; the same
// `_tmpPath` tag is set by `HTMLCanvasElement.toBlob`) with the `_tmpPath`-blob
// consumer (`URL.createObjectURL` → `file://<_tmpPath>`), which
// `HTMLImageElement`/`FontFace`/`Audio` load through GdkPixbuf/Pango/Gst.
//
// The logic is INLINED (not imported from `@gjsify/url`) on purpose: `@gjsify/url`
// declares `runtimes.node = "native"`, so on the `--app node` reverse bridge
// `@gjsify/url` re-exports the runtime-NATIVE `URL`, whose `createObjectURL`
// returns a `blob:nodedata:` URL the GJS DOM element loaders cannot open
// (`No such file or directory`). We patch the native `URL`'s object-URL methods
// to the `_tmpPath`→`file://` mapping directly. Patching a genuinely-external
// (native) global's method is the sanctioned exception to the "put it on the
// class" rule. On GJS this re-installs equivalent behaviour over `@gjsify/url`'s
// own static — idempotent via the `__gjsify_objecturl` marker.
interface _ObjectURLCapable {
    createObjectURL?: (blob: unknown) => string;
    revokeObjectURL?: (url: string) => void;
    __gjsify_objecturl?: boolean;
}
const urlCtor = globalThis.URL as unknown as _ObjectURLCapable;
if (urlCtor && urlCtor.__gjsify_objecturl !== true) {
    const objectUrlPaths = new Map<string, string>();
    const nativeCreate = urlCtor.createObjectURL?.bind(urlCtor);
    const nativeRevoke = urlCtor.revokeObjectURL?.bind(urlCtor);

    urlCtor.createObjectURL = (blob: unknown): string => {
        const tmp = (blob as { _tmpPath?: string } | null)?._tmpPath;
        if (typeof tmp === 'string' && tmp.length > 0) {
            const url = `file://${tmp}`;
            objectUrlPaths.set(url, tmp);
            return url;
        }
        // No temp-file backing — defer to the runtime-native impl if one exists
        // (a real blob: URL is at least valid), else a fail-fast sentinel.
        return nativeCreate ? nativeCreate(blob) : 'file:///dev/null';
    };

    urlCtor.revokeObjectURL = (url: string): void => {
        const path = objectUrlPaths.get(url);
        if (path) {
            try {
                GLib.unlink(path);
            } catch {
                // best-effort temp-file cleanup
            }
            objectUrlPaths.delete(url);
        } else if (nativeRevoke) {
            nativeRevoke(url);
        }
    };

    urlCtor.__gjsify_objecturl = true;
}
