// XMLHttpRequest — fetch()-backed XHR for GJS.
// Covers engine.io-client (polling XHR) and Excalibur.js (ImageSource/Sound)
// use cases. For `responseType === 'blob'` the bytes are written to a GLib
// temp file and the returned Blob carries a `_tmpPath` that
// `URL.createObjectURL` turns into a `file://` URL, so that HTMLImageElement
// / Image / HTMLAudioElement can stream the asset through GdkPixbuf / Gst.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest

import GLib from 'gi://GLib?version=2.0';
import fetch from './index.js';

let _blobCounter = 0;

function guessBlobExt(url: string): string {
  const lower = url.toLowerCase().split('?')[0]!;
  const dot = lower.lastIndexOf('.');
  const ext = dot > -1 ? lower.slice(dot) : '';
  // Restrict to a small safe allow-list; unknown → .bin
  switch (ext) {
    case '.png': case '.jpg': case '.jpeg': case '.gif':
    case '.webp': case '.svg': case '.bmp':
    case '.ttf': case '.otf': case '.woff': case '.woff2':
    case '.mp3': case '.wav': case '.ogg': case '.flac': case '.m4a':
    case '.mp4': case '.webm': case '.mkv':
    case '.xml': case '.tmx': case '.json':
      return ext;
    default:
      return '.bin';
  }
}

function writeBlobToTempFile(bytes: Uint8Array, url: string): string {
  const tmpPath = GLib.build_filenamev([
    GLib.get_tmp_dir(),
    `gjsify-blob-${_blobCounter++}${guessBlobExt(url)}`,
  ]);
  GLib.file_set_contents(tmpPath, bytes);
  return tmpPath;
}

export const UNSENT = 0;
export const OPENED = 1;
export const HEADERS_RECEIVED = 2;
export const LOADING = 3;
export const DONE = 4;

type EventHandler = ((event: ProgressEvent) => void) | null;

export class XMLHttpRequest extends EventTarget {
  static UNSENT = UNSENT;
  static OPENED = OPENED;
  static HEADERS_RECEIVED = HEADERS_RECEIVED;
  static LOADING = LOADING;
  static DONE = DONE;

  readonly UNSENT = UNSENT;
  readonly OPENED = OPENED;
  readonly HEADERS_RECEIVED = HEADERS_RECEIVED;
  readonly LOADING = LOADING;
  readonly DONE = DONE;

  readyState: number = UNSENT;
  status: number = 0;
  statusText: string = '';
  responseType: string = '';
  responseText: string = '';
  response: unknown = null;
  responseURL: string = '';
  withCredentials: boolean = false;
  timeout: number = 0;
  upload: XMLHttpRequestUpload = new XMLHttpRequestUpload();

  onreadystatechange: ((event: Event) => void) | null = null;
  onload: EventHandler = null;
  onerror: EventHandler = null;
  onabort: EventHandler = null;
  ontimeout: EventHandler = null;
  onloadstart: EventHandler = null;
  onloadend: EventHandler = null;
  onprogress: EventHandler = null;

  private _method = 'GET';
  private _url = '';
  private _headers = new Map<string, string>();
  private _responseHeaders = new Map<string, string>();
  private _controller = new AbortController();
  private _aborted = false;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  open(method: string, url: string, _async = true, _user?: string | null, _password?: string | null): void {
    this._method = method.toUpperCase();
    this._url = url;
    this._headers.clear();
    this._responseHeaders.clear();
    this._aborted = false;
    this._controller = new AbortController();
    this._setReadyState(OPENED);
  }

  setRequestHeader(header: string, value: string): void {
    if (this.readyState < OPENED) throw new DOMException('Must open first', 'InvalidStateError');
    this._headers.set(header.toLowerCase(), value);
  }

  getResponseHeader(header: string): string | null {
    return this._responseHeaders.get(header.toLowerCase()) ?? null;
  }

  getAllResponseHeaders(): string {
    const lines: string[] = [];
    this._responseHeaders.forEach((v, k) => lines.push(`${k}: ${v}`));
    return lines.join('\r\n');
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (this.readyState !== OPENED) throw new DOMException('Must open first', 'InvalidStateError');
    if (this._aborted) return;

    const headersInit: Record<string, string> = {};
    this._headers.forEach((v, k) => { headersInit[k] = v; });

    const fetchOptions: RequestInit = {
      method: this._method,
      headers: headersInit,
      credentials: this.withCredentials ? 'include' : 'omit',
      signal: this._controller.signal,
    };

    if (body != null && this._method !== 'GET' && this._method !== 'HEAD') {
      fetchOptions.body = body as BodyInit;
    }

    if (this.timeout > 0) {
      this._timeoutId = setTimeout(() => {
        this._controller.abort();
        this._onTimeout();
      }, this.timeout);
    }

    this.dispatchEvent(new Event('loadstart'));
    if (this.onloadstart) this.onloadstart(new ProgressEvent('loadstart'));

    fetch(this._url, fetchOptions)
      .then(async (res) => {
        if (this._aborted) return;
        if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }

        this.status = res.status;
        this.statusText = res.statusText;
        this.responseURL = res.url;

        res.headers.forEach((v: string, k: string) => {
          this._responseHeaders.set(k.toLowerCase(), v);
        });

        this._setReadyState(HEADERS_RECEIVED);
        this._setReadyState(LOADING);

        switch (this.responseType) {
          case 'arraybuffer': {
            const ab = await res.arrayBuffer();
            this.response = ab;
            this.responseText = '';
            break;
          }
          case 'blob': {
            // Materialise the body to a GLib temp file so URL.createObjectURL
            // can hand Image / Audio / Font consumers a loadable `file://` URL.
            const ab = await res.arrayBuffer();
            const bytes = new Uint8Array(ab);
            const tmpPath = writeBlobToTempFile(bytes, this._url);
            const blob = new Blob([ab], {
              type: this._responseHeaders.get('content-type') ?? '',
            });
            (blob as unknown as { _tmpPath: string })._tmpPath = tmpPath;
            this.response = blob;
            this.responseText = '';
            break;
          }
          case 'json': {
            const text = await res.text();
            this.responseText = '';
            try {
              this.response = text.length > 0 ? JSON.parse(text) : null;
            } catch {
              this.response = null;
            }
            break;
          }
          case 'document': {
            const text = await res.text();
            this.responseText = text;
            this.response = text;
            break;
          }
          case '':
          case 'text':
          default: {
            const text = await res.text();
            this.responseText = text;
            this.response = text;
            break;
          }
        }

        this._setReadyState(DONE);
        this.dispatchEvent(new ProgressEvent('load'));
        this.dispatchEvent(new ProgressEvent('loadend'));
        if (this.onload) this.onload(new ProgressEvent('load'));
        if (this.onloadend) this.onloadend(new ProgressEvent('loadend'));
      })
      .catch((_err: Error) => {
        if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
        if (this._aborted) return;

        this._setReadyState(DONE);
        const ev = new ProgressEvent('error');
        this.dispatchEvent(ev);
        if (this.onerror) this.onerror(ev);
        if (this.onloadend) this.onloadend(new ProgressEvent('loadend'));
      });
  }

  abort(): void {
    if (this._aborted) return;
    this._aborted = true;
    if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
    this._controller.abort();
    if (this.readyState !== UNSENT && this.readyState !== DONE) {
      this._setReadyState(DONE);
      this.status = 0;
    }
    const ev = new ProgressEvent('abort');
    this.dispatchEvent(ev);
    if (this.onabort) this.onabort(ev);
    if (this.onloadend) this.onloadend(new ProgressEvent('loadend'));
  }

  overrideMimeType(_mime: string): void { /* no-op */ }

  private _onTimeout(): void {
    if (this._aborted) return;
    this._aborted = true;
    this._setReadyState(DONE);
    const ev = new ProgressEvent('timeout');
    this.dispatchEvent(ev);
    if (this.ontimeout) this.ontimeout(ev);
  }

  private _setReadyState(state: number): void {
    this.readyState = state;
    const ev = new Event('readystatechange');
    this.dispatchEvent(ev);
    if (this.onreadystatechange) this.onreadystatechange(ev);
  }
}

export class XMLHttpRequestUpload extends EventTarget {
  onprogress: EventHandler = null;
  onloadstart: EventHandler = null;
  onloadend: EventHandler = null;
  onload: EventHandler = null;
  onerror: EventHandler = null;
  onabort: EventHandler = null;
  ontimeout: EventHandler = null;
}
