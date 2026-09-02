// SPDX-License-Identifier: MIT
//
// GjsifyWebView2 — the engine half: WebView2, COM, and the Win32 message queue.
// See docs/adr/0035-web-view-on-win32.md.
//
// Everything C++ in this package is in this file, and it exports nothing but the
// pure-C seam declared in `gjsify-webview2-backend.h`. That is the same division
// ADR 0022 decision 2 draws on darwin for the same reason: the tool that reads
// the API has no front end for the language the engine is written in.
//
// THE HOSTING SHAPE, in one paragraph, because the rest of the file only makes
// sense against it. Stage 1 is WINDOWED hosting: each view owns a child `HWND`
// that the WebView2 controller fills, and that `HWND` is re-parented under the
// GTK toplevel's own `HWND` when the widget is mapped and back under a hidden
// process-wide parking window when it is not. So the web content is composited
// by the OS ABOVE the GTK surface — input, focus and accessibility arrive for
// free, and clipping, overdraw, opacity and transforms do not work at all. The
// parking window is what makes a view usable with no display and no toplevel,
// which is what the CI proof runs against.

#include <windows.h>

#include <objbase.h>
#include <wrl.h>

#include <WebView2.h>

#include "gjsify-webview2-backend.h"

#include <gdk/win32/gdkwin32.h>

#include <algorithm>
#include <cstring>
#include <functional>
#include <string>
#include <vector>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

// ---------------------------------------------------------------------------
// Strings. GLib speaks UTF-8, WebView2 speaks UTF-16, and `gunichar2` is
// `wchar_t`-shaped on Windows — so these two functions are the whole conversion
// story and nothing else in this file hand-rolls one.
// ---------------------------------------------------------------------------

std::wstring ToWide(const gchar *utf8)
{
    if (utf8 == nullptr) {
        return std::wstring();
    }
    glong written = 0;
    gunichar2 *utf16 = g_utf8_to_utf16(utf8, -1, nullptr, &written, nullptr);
    if (utf16 == nullptr) {
        return std::wstring();
    }
    std::wstring out(reinterpret_cast<const wchar_t *>(utf16), static_cast<size_t>(written));
    g_free(utf16);
    return out;
}

// (transfer full) — the caller frees with g_free().
gchar *ToUtf8(const wchar_t *wide)
{
    if (wide == nullptr) {
        return nullptr;
    }
    return g_utf16_to_utf8(
        reinterpret_cast<const gunichar2 *>(wide), -1, nullptr, nullptr, nullptr);
}

// A JS string literal built one character at a time, so a channel name
// containing a quote cannot end the literal and become page-visible code.
// Deliberately NOT `g_strescape()`, which emits OCTAL escapes for every
// non-ASCII byte — a legacy octal escape is a SyntaxError under `"use strict"`,
// the mistake ADR 0022's darwin backend records having made once.
void AppendJsString(GString *out, const char *value)
{
    g_string_append_c(out, '"');
    for (const guchar *p = reinterpret_cast<const guchar *>(value); *p != '\0'; p++) {
        switch (*p) {
            case '"': g_string_append(out, "\\\""); break;
            case '\\': g_string_append(out, "\\\\"); break;
            case '\n': g_string_append(out, "\\n"); break;
            case '\r': g_string_append(out, "\\r"); break;
            default:
                if (*p < 0x20) {
                    g_string_append_printf(out, "\\u%04x", *p);
                } else {
                    g_string_append_c(out, static_cast<gchar>(*p));
                }
        }
    }
    g_string_append_c(out, '"');
}

gchar *DescribeHresult(const char *what, HRESULT hr)
{
    if (hr == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) {
        // The one HRESULT worth naming rather than printing: it is what a machine
        // with no Evergreen runtime answers, and ADR 0035 decision 5 makes that a
        // declared dependency of the installer rather than a surprise here.
        return g_strdup_printf(
            "%s: no WebView2 runtime is installed on this machine. The Evergreen runtime ships "
            "with Windows 11 and with Edge on Windows 10; an application that must not depend "
            "on the machine embeds the Fixed Version redistributable instead. "
            "(HRESULT 0x%08lX)",
            what,
            static_cast<unsigned long>(hr));
    }
    return g_strdup_printf("%s failed (HRESULT 0x%08lX)", what, static_cast<unsigned long>(hr));
}

// ---------------------------------------------------------------------------
// The loop bridge.
//
// MEASURED, and it is the finding this whole file is arranged around
// (`docs/poc/webview2-win32-probe.cpp`, `windows-latest`, Evergreen
// 151.0.4129.101): `CreateCoreWebView2EnvironmentWithOptions` and
// `CreateCoreWebView2Controller` complete their callbacks with NO pump at all,
// while `NavigationCompleted` timed out after 8000 ms without one and arrived
// immediately with one. So the requirement is not uniform, and a backend that
// installed the source at its first need would install it after the only two
// calls that do not have one — leaving "the widget exists, the view exists, and
// nothing loads", a symptom eight seconds from its cause.
//
// Hence: the source is attached when the FIRST VIEW is constructed, and its
// absence is a named error on every content-level call rather than a timeout.
//
// A GSource and not `g_timeout_add`: `prepare`/`check` answer from
// `PeekMessage(PM_NOREMOVE)`, so a waiting message is dispatched on the next
// poll wakeup instead of on the next tick, and an idle page still costs only one
// wakeup per interval.
//
// DOUBLE-DISPATCH IS NOT A HAZARD HERE, which is worth stating because it looks
// like one: GDK's own Win32 backend pumps this same queue from its own source
// when a display is open. Both sources call `PeekMessage(PM_REMOVE)` on one
// queue, so a message is removed once and delivered once, whichever gets there
// first. What must not be assumed is the converse — that GDK's pump makes this
// one unnecessary — because a view with no display, no toplevel, or no GTK at
// all still has to reach `NavigationCompleted`.
// ---------------------------------------------------------------------------

constexpr int kPumpIntervalMs = 4;

gboolean PumpPrepare(GSource *source, gint *timeout)
{
    (void) source;
    *timeout = kPumpIntervalMs;
    MSG msg;
    return PeekMessageW(&msg, nullptr, 0, 0, PM_NOREMOVE) ? TRUE : FALSE;
}

gboolean PumpCheck(GSource *source)
{
    (void) source;
    MSG msg;
    return PeekMessageW(&msg, nullptr, 0, 0, PM_NOREMOVE) ? TRUE : FALSE;
}

gboolean PumpDispatch(GSource *source, GSourceFunc callback, gpointer user_data)
{
    (void) source;
    (void) callback;
    (void) user_data;
    MSG msg;
    // Drain everything ready, then return: a burst of WebView2 callbacks arrives
    // in one iteration rather than one per wakeup.
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return G_SOURCE_CONTINUE;
}

GSourceFuncs g_pump_funcs = { PumpPrepare, PumpCheck, PumpDispatch, nullptr, nullptr, nullptr };

gsize g_live_views = 0;
GSource *g_pump_source = nullptr;
GThread *g_pump_thread = nullptr;

// ---------------------------------------------------------------------------
// Windows: one hidden parking window per process, one host window per view.
// ---------------------------------------------------------------------------

const wchar_t *kWindowClass = L"GjsifyWebView2Host";

LRESULT CALLBACK HostWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    return DefWindowProcW(hwnd, msg, wp, lp);
}

void EnsureWindowClass()
{
    static gsize once = 0;
    if (g_once_init_enter(&once)) {
        WNDCLASSEXW wc = {};
        wc.cbSize = sizeof(wc);
        wc.lpfnWndProc = HostWndProc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.lpszClassName = kWindowClass;
        RegisterClassExW(&wc);
        g_once_init_leave(&once, 1);
    }
}

// The window a view's content lives under while it has no GTK toplevel. It is
// never shown, so its children are never on screen — which is exactly the state
// an unmapped widget, a headless process and a display-less test want.
HWND ParkingWindow()
{
    static HWND parking = nullptr;
    if (parking == nullptr) {
        EnsureWindowClass();
        parking = CreateWindowExW(WS_EX_TOOLWINDOW,
                                  kWindowClass,
                                  L"gjsify-webview2 parking",
                                  WS_POPUP,
                                  0,
                                  0,
                                  0,
                                  0,
                                  nullptr,
                                  nullptr,
                                  GetModuleHandleW(nullptr),
                                  nullptr);
    }
    return parking;
}

// ---------------------------------------------------------------------------
// The environment — ONE per process, created on demand.
//
// WebView2 keys a browser process on the user-data folder, so a second
// environment over the same folder buys nothing and costs a second lock. The
// folder is NAMED rather than left to WebView2's default (`<exe>.WebView2` beside
// the executable, which is read-only in an installed application) — this is a
// GTK application's cache directory, writable by construction.
// ---------------------------------------------------------------------------

using EnvWaiter = std::function<void(ICoreWebView2Environment *, HRESULT)>;

struct EnvironmentState {
    ComPtr<ICoreWebView2Environment> environment;
    bool requested = false;
    bool settled = false;
    HRESULT error = S_OK;
    std::vector<EnvWaiter> waiters;
};

EnvironmentState g_environment;

void SettleEnvironment(ICoreWebView2Environment *env, HRESULT hr)
{
    g_environment.settled = true;
    g_environment.error = hr;
    g_environment.environment = env;

    std::vector<EnvWaiter> waiters;
    waiters.swap(g_environment.waiters);
    for (auto &waiter : waiters) {
        waiter(env, hr);
    }
}

void WithEnvironment(EnvWaiter waiter)
{
    if (g_environment.settled) {
        waiter(g_environment.environment.Get(), g_environment.error);
        return;
    }

    g_environment.waiters.push_back(std::move(waiter));
    if (g_environment.requested) {
        return;
    }
    g_environment.requested = true;

    gchar *folder = g_build_filename(g_get_user_cache_dir(), "gjsify-webview2", nullptr);
    std::wstring wide_folder = ToWide(folder);
    g_free(folder);

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr,
        wide_folder.c_str(),
        nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [](HRESULT result, ICoreWebView2Environment *env) -> HRESULT {
                SettleEnvironment(env, result);
                return S_OK;
            })
            .Get());

    if (FAILED(hr)) {
        SettleEnvironment(nullptr, hr);
    }
}

}  // namespace

// ===========================================================================
// The pump, as the seam declares it.
// ===========================================================================

void gjsify_webview2_pump_ref(void)
{
    if (g_live_views++ > 0) {
        return;
    }

    g_pump_thread = g_thread_self();
    g_pump_source = g_source_new(&g_pump_funcs, sizeof(GSource));
    g_source_set_name(g_pump_source, "gjsify-webview2-message-pump");
    g_source_set_priority(g_pump_source, G_PRIORITY_DEFAULT);
    // The THREAD-DEFAULT context, not the global one: a view constructed inside
    // a GTask worker or a per-thread context has to be pumped there, and
    // `gjsify_webview2_pump_state()` reports the mismatch rather than pumping
    // the wrong loop.
    g_source_attach(g_pump_source, g_main_context_get_thread_default());
}

void gjsify_webview2_pump_unref(void)
{
    if (g_live_views == 0 || --g_live_views > 0) {
        return;
    }
    if (g_pump_source != nullptr) {
        g_source_destroy(g_pump_source);
        g_source_unref(g_pump_source);
        g_pump_source = nullptr;
    }
    g_pump_thread = nullptr;
}

GjsifyWebView2MessagePumpState gjsify_webview2_pump_state(void)
{
    if (g_pump_source == nullptr) {
        return GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED;
    }
    if (g_pump_thread != g_thread_self()) {
        return GJSIFY_WEBVIEW2_MESSAGE_PUMP_FOREIGN_THREAD;
    }
    return GJSIFY_WEBVIEW2_MESSAGE_PUMP_ATTACHED;
}

gboolean gjsify_webview2_pump_require(GError **error)
{
    switch (gjsify_webview2_pump_state()) {
        case GJSIFY_WEBVIEW2_MESSAGE_PUMP_ATTACHED:
            return TRUE;
        case GJSIFY_WEBVIEW2_MESSAGE_PUMP_FOREIGN_THREAD:
            g_set_error_literal(
                error,
                G_IO_ERROR,
                G_IO_ERROR_WRONG_TYPE,
                "WebKit.WebView: called from a different thread than the one it was created on. "
                "WebView2 is apartment-threaded and delivers its callbacks to the creating "
                "thread's Win32 message queue, which is where this view's pump is attached. "
                "Drive the view from that thread (WebKit.WebView.get_message_pump_state()).");
            return FALSE;
        case GJSIFY_WEBVIEW2_MESSAGE_PUMP_DETACHED:
        default:
            g_set_error_literal(
                error,
                G_IO_ERROR,
                G_IO_ERROR_NOT_INITIALIZED,
                "WebKit.WebView: no Win32 message pump is attached to this view. WebView2 "
                "delivers navigation and script callbacks through the thread's message queue, "
                "which g_main_loop_run() does not dispatch, so nothing would ever load and this "
                "call would wait forever instead of failing. The pump is installed while at "
                "least one view is alive; seeing this means the view was disposed, or was never "
                "constructed on this thread.");
            return FALSE;
    }
}

// ===========================================================================
// The engine, per view.
// ===========================================================================

struct _GjsifyWebView2Backend {
    GjsifyWebView2WebView *view = nullptr;  // UNOWNED — the view owns this
    HWND host = nullptr;

    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;

    // `settled` means the controller attempt has finished, one way or the other.
    // Until then every operation queues; after it, every operation runs and each
    // one checks `webview` for itself — a queued operation owns a GTask, and a
    // dropped GTask is a promise that never settles.
    bool settled = false;
    HRESULT error = S_OK;
    std::vector<std::function<void()>> pending;

    // Mirrored so they survive the wait for the controller.
    int x = 0, y = 0, width = 640, height = 480;
    bool visible = true;
    bool js_enabled = true;
    bool devtools_enabled = false;
    bool console_to_stdout = false;

    std::vector<std::wstring> script_ids;   // AddScriptToExecuteOnDocumentCreated ids
    std::vector<std::string> handler_names; // registered message-handler channels

    EventRegistrationToken navigation_starting = {};
    EventRegistrationToken content_loading = {};
    EventRegistrationToken navigation_completed = {};
    EventRegistrationToken source_changed = {};
    EventRegistrationToken web_message_received = {};
};

namespace {

// A backend is captured BY POINTER into COM completion handlers that outlive the
// call that registered them, and a view constructed and immediately disposed
// would otherwise hand a freed pointer to the environment callback. So a handler
// asks whether its backend is still alive before touching it. A registry rather
// than a weak reference because these are plain structs, not GObjects, and their
// lifetime is exactly the owning view's.
std::vector<GjsifyWebView2Backend *> g_live_backends;

bool IsLive(GjsifyWebView2Backend *backend)
{
    return std::find(g_live_backends.begin(), g_live_backends.end(), backend) !=
           g_live_backends.end();
}

// The separator between a channel name and its JSON payload, chosen so it cannot
// occur in the payload: `JSON.stringify` emits a control character inside a
// string as the six ASCII characters ``, never as a literal one. That is
// what lets the whole message travel as a STRING and be read back with no JSON
// parser on this side — GLib has none and json-glib is not a dependency here.
constexpr wchar_t kChannelSeparator = L'\x01';

std::wstring MessageHandlerShim(const std::string &name)
{
    GString *js = g_string_new(nullptr);
    g_string_append(js, "(function(){var w=window.webkit=window.webkit||{};");
    g_string_append(js, "var m=w.messageHandlers=w.messageHandlers||{};var n=");
    AppendJsString(js, name.c_str());
    g_string_append(js, ";m[n]={postMessage:function(b){");
    g_string_append(js, "window.chrome.webview.postMessage(n+'\\u0001'+JSON.stringify(b));");
    g_string_append(js, "}};})();");

    std::wstring wide = ToWide(js->str);
    g_string_free(js, TRUE);
    return wide;
}

// `NavigateToString` has no base-URI argument, so a caller's base URI becomes a
// `<base>` element inside the document's own `<head>`. Two refusals rather than a
// best effort: a document that already declares a base keeps its own (page markup
// outranks a default), and a document with no `<head>` is left alone and warned
// about — inserting the tag ahead of a `<!doctype>` would put the page into
// quirks mode, which is a far worse outcome than an unresolved relative URL.
gchar *ApplyBaseUri(const gchar *content, const gchar *base_uri)
{
    if (base_uri == nullptr || base_uri[0] == '\0') {
        return g_strdup(content);
    }

    gchar *lowered = g_ascii_strdown(content, -1);
    const gchar *existing = strstr(lowered, "<base ");
    const gchar *head = strstr(lowered, "<head");
    const gchar *head_end = head != nullptr ? strchr(head, '>') : nullptr;
    gsize offset = head_end != nullptr ? static_cast<gsize>(head_end - lowered) + 1 : 0;
    gboolean has_base = existing != nullptr;
    g_free(lowered);

    if (has_base) {
        return g_strdup(content);
    }
    if (offset == 0) {
        g_warning("WebKit(WebView2): load_html() was given a base URI but the document has no "
                  "<head>, so no <base> element could be inserted. WebView2's NavigateToString "
                  "has no base-URI argument; relative URLs in this document will not resolve.");
        return g_strdup(content);
    }

    gchar *escaped = g_markup_escape_text(base_uri, -1);
    gchar *out = g_strdup_printf("%.*s<base href=\"%s\">%s",
                                 static_cast<int>(offset),
                                 content,
                                 escaped,
                                 content + offset);
    g_free(escaped);
    return out;
}

void FlushPending(GjsifyWebView2Backend *backend)
{
    std::vector<std::function<void()>> pending;
    pending.swap(backend->pending);
    for (auto &op : pending) {
        op();
    }
}

// Every operation goes through this: queue while the controller is still coming,
// run once the attempt has settled — whether it SUCCEEDED or not. Running a
// failed one is the point: each operation body checks `webview` and a
// task-bearing one completes its GTask with the reason. Without the queue, the
// ordinary consumer sequence — construct a view, call `load_html()` on the next
// line — would be a race the consumer cannot see.
void WhenSettled(GjsifyWebView2Backend *backend, std::function<void()> op)
{
    if (!backend->settled) {
        backend->pending.push_back(std::move(op));
        return;
    }
    op();
}

gchar *EngineUnavailable(GjsifyWebView2Backend *backend, const char *what)
{
    if (backend->error != S_OK) {
        return DescribeHresult(what, backend->error);
    }
    return g_strdup_printf("%s: this WebKit.WebView has no engine behind it", what);
}

void ApplySettings(GjsifyWebView2Backend *backend)
{
    if (backend->webview == nullptr) {
        return;
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (FAILED(backend->webview->get_Settings(&settings)) || settings == nullptr) {
        return;
    }
    settings->put_IsScriptEnabled(backend->js_enabled ? TRUE : FALSE);
    settings->put_AreDevToolsEnabled(backend->devtools_enabled ? TRUE : FALSE);
    // Always on: it is the transport for `script-message-received`, not a
    // user-facing setting, and turning it off would silently break the bridge
    // `@gjsify/iframe` is built on.
    settings->put_IsWebMessageEnabled(TRUE);
}

void ApplyBounds(GjsifyWebView2Backend *backend)
{
    if (backend->host == nullptr) {
        return;
    }
    SetWindowPos(backend->host,
                 nullptr,
                 backend->x,
                 backend->y,
                 backend->width,
                 backend->height,
                 SWP_NOZORDER | SWP_NOACTIVATE);
    if (backend->controller != nullptr) {
        RECT rect = { 0, 0, backend->width, backend->height };
        backend->controller->put_Bounds(rect);
    }
}

void WireEvents(GjsifyWebView2Backend *backend);

}  // namespace

GjsifyWebView2Backend *gjsify_webview2_backend_new(GjsifyWebView2WebView *view, GError **error)
{
    // GTK's Win32 backend calls OleInitialize, so this is usually already an STA
    // and this call returns S_FALSE. It is made anyway because a view can be
    // constructed before any display is opened — which is exactly what the
    // headless proof does.
    HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com) && com != RPC_E_CHANGED_MODE) {
        gchar *message = DescribeHresult("CoInitializeEx", com);
        g_set_error_literal(error, G_IO_ERROR, G_IO_ERROR_FAILED, message);
        g_free(message);
        return nullptr;
    }

    EnsureWindowClass();

    GjsifyWebView2Backend *backend = new GjsifyWebView2Backend();
    backend->view = view;
    backend->host = CreateWindowExW(0,
                                    kWindowClass,
                                    nullptr,
                                    WS_CHILD | WS_CLIPCHILDREN,
                                    0,
                                    0,
                                    backend->width,
                                    backend->height,
                                    ParkingWindow(),
                                    nullptr,
                                    GetModuleHandleW(nullptr),
                                    nullptr);
    if (backend->host == nullptr) {
        DWORD last_error = GetLastError();
        delete backend;
        g_set_error(error,
                    G_IO_ERROR,
                    G_IO_ERROR_FAILED,
                    "WebKit.WebView: could not create the host window (GetLastError=%lu)",
                    static_cast<unsigned long>(last_error));
        return nullptr;
    }

    g_live_backends.push_back(backend);

    WithEnvironment([backend](ICoreWebView2Environment *env, HRESULT hr) {
        if (!IsLive(backend)) {
            return;
        }
        if (FAILED(hr) || env == nullptr) {
            backend->settled = true;
            backend->error = hr;
            gchar *message = DescribeHresult("CreateCoreWebView2Environment", hr);
            g_warning("WebKit(WebView2): %s", message);
            g_free(message);
            FlushPending(backend);
            return;
        }

        HRESULT create = env->CreateCoreWebView2Controller(
            backend->host,
            Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [backend](HRESULT result, ICoreWebView2Controller *controller) -> HRESULT {
                    if (!IsLive(backend)) {
                        if (controller != nullptr) {
                            controller->Close();
                        }
                        return S_OK;
                    }
                    backend->settled = true;
                    backend->error = result;
                    if (SUCCEEDED(result) && controller != nullptr) {
                        backend->controller = controller;
                        backend->controller->get_CoreWebView2(&backend->webview);
                    }
                    if (backend->webview != nullptr) {
                        WireEvents(backend);
                        ApplySettings(backend);
                        ApplyBounds(backend);
                        backend->controller->put_IsVisible(backend->visible ? TRUE : FALSE);
                    } else {
                        gchar *message = DescribeHresult("CreateCoreWebView2Controller", result);
                        g_warning("WebKit(WebView2): %s", message);
                        g_free(message);
                    }
                    FlushPending(backend);
                    return S_OK;
                })
                .Get());

        if (FAILED(create)) {
            backend->settled = true;
            backend->error = create;
            gchar *message = DescribeHresult("CreateCoreWebView2Controller", create);
            g_warning("WebKit(WebView2): %s", message);
            g_free(message);
            FlushPending(backend);
        }
    });

    return backend;
}

void gjsify_webview2_backend_free(GjsifyWebView2Backend *backend)
{
    if (backend == nullptr) {
        return;
    }

    // The view is going; nothing may call back into it from here on. Marking the
    // attempt settled and running the queue is what completes the GTasks still
    // in it — each sees a null `webview` and returns the reason.
    backend->view = nullptr;
    backend->settled = true;
    backend->webview.Reset();
    FlushPending(backend);

    if (backend->controller != nullptr) {
        backend->controller->Close();
        backend->controller.Reset();
    }
    if (backend->host != nullptr) {
        DestroyWindow(backend->host);
        backend->host = nullptr;
    }

    g_live_backends.erase(
        std::remove(g_live_backends.begin(), g_live_backends.end(), backend),
        g_live_backends.end());
    delete backend;
}

namespace {

void EmitLoad(GjsifyWebView2Backend *backend, GjsifyWebView2LoadEvent event)
{
    if (backend->view != nullptr) {
        gjsify_webview2_web_view_emit_load_changed(backend->view, event);
    }
}

void WireEvents(GjsifyWebView2Backend *backend)
{
    ICoreWebView2 *webview = backend->webview.Get();

    webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [backend](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *args) -> HRESULT {
                if (!IsLive(backend)) {
                    return S_OK;
                }
                BOOL redirected = FALSE;
                if (args != nullptr) {
                    args->get_IsRedirected(&redirected);
                }
                EmitLoad(backend,
                         redirected ? GJSIFY_WEBVIEW2_LOAD_REDIRECTED
                                    : GJSIFY_WEBVIEW2_LOAD_STARTED);
                return S_OK;
            })
            .Get(),
        &backend->navigation_starting);

    // COMMITTED is "the content is being loaded", which is what ContentLoading
    // means; WebKitGTK emits it at the same point in the sequence.
    webview->add_ContentLoading(
        Callback<ICoreWebView2ContentLoadingEventHandler>(
            [backend](ICoreWebView2 *, ICoreWebView2ContentLoadingEventArgs *) -> HRESULT {
                if (IsLive(backend)) {
                    EmitLoad(backend, GJSIFY_WEBVIEW2_LOAD_COMMITTED);
                }
                return S_OK;
            })
            .Get(),
        &backend->content_loading);

    webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [backend](ICoreWebView2 *sender,
                      ICoreWebView2NavigationCompletedEventArgs *args) -> HRESULT {
                if (!IsLive(backend)) {
                    return S_OK;
                }
                BOOL ok = FALSE;
                COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                if (args != nullptr) {
                    args->get_IsSuccess(&ok);
                    args->get_WebErrorStatus(&status);
                }
                if (ok) {
                    EmitLoad(backend, GJSIFY_WEBVIEW2_LOAD_FINISHED);
                } else if (backend->view != nullptr) {
                    LPWSTR source = nullptr;
                    gchar *uri = nullptr;
                    if (sender != nullptr && SUCCEEDED(sender->get_Source(&source))) {
                        uri = ToUtf8(source);
                        CoTaskMemFree(source);
                    }
                    gchar *message =
                        g_strdup_printf("navigation failed (COREWEBVIEW2_WEB_ERROR_STATUS %d)",
                                        static_cast<int>(status));
                    gjsify_webview2_web_view_emit_load_failed(
                        backend->view, GJSIFY_WEBVIEW2_LOAD_COMMITTED, uri, message);
                    g_free(message);
                    g_free(uri);
                }
                return S_OK;
            })
            .Get(),
        &backend->navigation_completed);

    webview->add_SourceChanged(
        Callback<ICoreWebView2SourceChangedEventHandler>(
            [backend](ICoreWebView2 *sender, ICoreWebView2SourceChangedEventArgs *) -> HRESULT {
                if (!IsLive(backend) || backend->view == nullptr || sender == nullptr) {
                    return S_OK;
                }
                LPWSTR source = nullptr;
                if (SUCCEEDED(sender->get_Source(&source))) {
                    gchar *uri = ToUtf8(source);
                    CoTaskMemFree(source);
                    gjsify_webview2_web_view_set_current_uri(backend->view, uri);
                    g_free(uri);
                }
                return S_OK;
            })
            .Get(),
        &backend->source_changed);

    webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [backend](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                if (!IsLive(backend) || backend->view == nullptr || args == nullptr) {
                    return S_OK;
                }
                LPWSTR raw = nullptr;
                // AsString, not AsJson: the shim posts one string whose first
                // U+0001 separates the channel from the payload, which is what
                // makes this readable with no JSON parser on this side.
                if (FAILED(args->TryGetWebMessageAsString(&raw)) || raw == nullptr) {
                    return S_OK;
                }
                std::wstring message(raw);
                CoTaskMemFree(raw);

                size_t split = message.find(kChannelSeparator);
                if (split == std::wstring::npos) {
                    // Not ours — a page is free to call
                    // `window.chrome.webview.postMessage` itself.
                    return S_OK;
                }
                gchar *channel = ToUtf8(message.substr(0, split).c_str());
                gchar *body = ToUtf8(message.substr(split + 1).c_str());
                gjsify_webview2_web_view_emit_script_message(backend->view, channel, body);
                g_free(channel);
                g_free(body);
                return S_OK;
            })
            .Get(),
        &backend->web_message_received);
}

// A completion handler that does nothing. `ExecuteScript`'s handler argument is
// not documented as optional, and passing null is the kind of thing that works
// until it does not.
ComPtr<ICoreWebView2ExecuteScriptCompletedHandler> IgnoreScriptResult()
{
    return Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
        [](HRESULT, LPCWSTR) -> HRESULT { return S_OK; });
}

}  // namespace

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

void gjsify_webview2_backend_load_uri(GjsifyWebView2Backend *backend, const gchar *uri)
{
    std::wstring wide = ToWide(uri);
    WhenSettled(backend, [backend, wide]() {
        if (backend->webview == nullptr) {
            return;
        }
        backend->webview->Navigate(wide.c_str());
    });
}

void gjsify_webview2_backend_load_html(
    GjsifyWebView2Backend *backend, const gchar *content, const gchar *base_uri)
{
    gchar *document = ApplyBaseUri(content, base_uri);
    std::wstring wide = ToWide(document);
    g_free(document);
    WhenSettled(backend, [backend, wide]() {
        if (backend->webview == nullptr) {
            return;
        }
        backend->webview->NavigateToString(wide.c_str());
    });
}

void gjsify_webview2_backend_reload(GjsifyWebView2Backend *backend)
{
    WhenSettled(backend, [backend]() {
        if (backend->webview == nullptr) {
            return;
        }
        backend->webview->Reload();
    });
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

void gjsify_webview2_backend_evaluate(
    GjsifyWebView2Backend *backend, const gchar *script, GTask *task)
{
    std::wstring wide = ToWide(script);

    WhenSettled(backend, [backend, wide, task]() {
        if (backend->webview == nullptr) {
            gchar *message = EngineUnavailable(backend, "evaluate_javascript");
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_NOT_INITIALIZED, "%s", message);
            g_free(message);
            g_object_unref(task);
            return;
        }
        HRESULT hr = backend->webview->ExecuteScript(
            wide.c_str(),
            Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                [task](HRESULT result, LPCWSTR json) -> HRESULT {
                    if (FAILED(result)) {
                        gchar *message = DescribeHresult("ExecuteScript", result);
                        g_task_return_new_error(
                            task, G_IO_ERROR, G_IO_ERROR_FAILED, "%s", message);
                        g_free(message);
                    } else {
                        gchar *utf8 = ToUtf8(json);
                        g_task_return_pointer(
                            task, gjsify_webview2_value_new_from_json(utf8), g_object_unref);
                        g_free(utf8);
                    }
                    g_object_unref(task);
                    return S_OK;
                })
                .Get());
        if (FAILED(hr)) {
            gchar *message = DescribeHresult("ExecuteScript", hr);
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_FAILED, "%s", message);
            g_free(message);
            g_object_unref(task);
        }
    });
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

void gjsify_webview2_backend_snapshot(
    GjsifyWebView2Backend *backend,
    GjsifyWebView2SnapshotRegion region,
    GjsifyWebView2SnapshotOptions options,
    GTask *task)
{
    (void) options;

    if (region == GJSIFY_WEBVIEW2_SNAPSHOT_REGION_FULL_DOCUMENT) {
        static gsize warned = 0;
        if (g_once_init_enter(&warned)) {
            g_warning("WebKit(WebView2): SnapshotRegion.FULL_DOCUMENT is not available — "
                      "WebView2's CapturePreview captures the viewport only, so this returns "
                      "the visible region.");
            g_once_init_leave(&warned, 1);
        }
    }

    WhenSettled(backend, [backend, task]() {
        if (backend->webview == nullptr) {
            gchar *message = EngineUnavailable(backend, "get_snapshot");
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_NOT_INITIALIZED, "%s", message);
            g_free(message);
            g_object_unref(task);
            return;
        }

        ComPtr<IStream> stream;
        if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) {
            g_task_return_new_error(
                task, G_IO_ERROR, G_IO_ERROR_FAILED, "could not allocate a capture stream");
            g_object_unref(task);
            return;
        }

        // The completion handler outlives this scope, so it holds its own
        // reference rather than borrowing the ComPtr's.
        IStream *raw_stream = stream.Get();
        raw_stream->AddRef();

        // PNG rather than JPEG: `gdk_texture_new_from_bytes()` decodes both, and
        // a snapshot that has to survive a comparison must not be lossy. ADR 0035
        // measured 33.4 ms at 1024x768 for the encode, which is the cost stage 2
        // exists to remove.
        HRESULT hr = backend->webview->CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            raw_stream,
            Callback<ICoreWebView2CapturePreviewCompletedHandler>(
                [task, raw_stream](HRESULT result) -> HRESULT {
                    if (FAILED(result)) {
                        gchar *message = DescribeHresult("CapturePreview", result);
                        g_task_return_new_error(
                            task, G_IO_ERROR, G_IO_ERROR_FAILED, "%s", message);
                        g_free(message);
                    } else {
                        HGLOBAL global = nullptr;
                        GdkTexture *texture = nullptr;
                        GError *error = nullptr;
                        if (SUCCEEDED(GetHGlobalFromStream(raw_stream, &global)) &&
                            global != nullptr) {
                            SIZE_T size = GlobalSize(global);
                            void *data = GlobalLock(global);
                            if (data != nullptr && size > 0) {
                                GBytes *bytes = g_bytes_new(data, size);
                                texture = gdk_texture_new_from_bytes(bytes, &error);
                                g_bytes_unref(bytes);
                            }
                            if (data != nullptr) {
                                GlobalUnlock(global);
                            }
                        }
                        if (texture != nullptr) {
                            g_task_return_pointer(task, texture, g_object_unref);
                        } else {
                            g_task_return_new_error(
                                task,
                                G_IO_ERROR,
                                G_IO_ERROR_FAILED,
                                "could not decode the captured PNG: %s",
                                error != nullptr ? error->message : "no image data");
                        }
                        g_clear_error(&error);
                    }
                    raw_stream->Release();
                    g_object_unref(task);
                    return S_OK;
                })
                .Get());

        if (FAILED(hr)) {
            gchar *message = DescribeHresult("CapturePreview", hr);
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_FAILED, "%s", message);
            g_free(message);
            raw_stream->Release();
            g_object_unref(task);
        }
    });
}

// ---------------------------------------------------------------------------
// Hosting
// ---------------------------------------------------------------------------

void gjsify_webview2_backend_set_parent(GjsifyWebView2Backend *backend, GdkSurface *surface)
{
    if (backend->host == nullptr) {
        return;
    }

    HWND parent = nullptr;
    if (surface != nullptr && GDK_IS_WIN32_SURFACE(surface)) {
        parent = gdk_win32_surface_get_handle(surface);
    }
    if (parent == nullptr) {
        parent = ParkingWindow();
    }
    if (GetParent(backend->host) != parent) {
        SetParent(backend->host, parent);
    }
}

void gjsify_webview2_backend_set_bounds(
    GjsifyWebView2Backend *backend, int x, int y, int width, int height)
{
    backend->x = x;
    backend->y = y;
    backend->width = width > 0 ? width : 1;
    backend->height = height > 0 ? height : 1;
    ApplyBounds(backend);
}

void gjsify_webview2_backend_set_visible(GjsifyWebView2Backend *backend, gboolean visible)
{
    backend->visible = visible != FALSE;
    if (backend->host != nullptr) {
        // SW_SHOWNA: show without taking activation. A web view appearing must
        // not steal focus from whatever the user was typing into.
        ShowWindow(backend->host, backend->visible ? SW_SHOWNA : SW_HIDE);
    }
    if (backend->controller != nullptr) {
        backend->controller->put_IsVisible(backend->visible ? TRUE : FALSE);
    }
}

// ---------------------------------------------------------------------------
// Settings and user content
// ---------------------------------------------------------------------------

void gjsify_webview2_backend_apply_settings(
    GjsifyWebView2Backend *backend,
    gboolean enable_javascript,
    gboolean enable_developer_extras,
    gboolean enable_write_console_messages_to_stdout)
{
    backend->js_enabled = enable_javascript != FALSE;
    backend->devtools_enabled = enable_developer_extras != FALSE;
    backend->console_to_stdout = enable_write_console_messages_to_stdout != FALSE;

    if (backend->console_to_stdout) {
        // Stored so the property reads back what was written, and WARNED because
        // it is not honoured: WebKitGTK forwards the page's console to the host
        // process's stdout, and WebView2 exposes no equivalent short of a
        // DevTools Protocol session. A silently ignored diagnostic setting is
        // worse than an absent one — the consumer would conclude the page logs
        // nothing.
        static gsize warned = 0;
        if (g_once_init_enter(&warned)) {
            g_warning("WebKit(WebView2): Settings.enable-write-console-messages-to-stdout is "
                      "not honoured — WebView2 has no console-forwarding API. Use "
                      "@gjsify/iframe's console-capture user script, which works on every "
                      "backend.");
            g_once_init_leave(&warned, 1);
        }
    }

    ApplySettings(backend);
}

void gjsify_webview2_backend_add_script(
    GjsifyWebView2Backend *backend,
    const gchar *source,
    gboolean top_frame_only,
    gboolean at_document_start)
{
    (void) top_frame_only;

    gchar *wrapped;
    if (at_document_start) {
        wrapped = g_strdup(source);
    } else {
        // WebView2 has ONE injection point and it is document-start. Deferring to
        // DOMContentLoaded is the closest honest approximation of document-end,
        // and it is named rather than silent because a script written for a built
        // DOM would otherwise see none.
        static gsize warned = 0;
        if (g_once_init_enter(&warned)) {
            g_warning("WebKit(WebView2): UserScriptInjectionTime.END is approximated by a "
                      "document-start script that defers itself to DOMContentLoaded — "
                      "WebView2 has no document-end injection point.");
            g_once_init_leave(&warned, 1);
        }
        wrapped = g_strconcat(
            "document.addEventListener('DOMContentLoaded',function(){", source, "\n});", nullptr);
    }
    std::wstring wide = ToWide(wrapped);
    g_free(wrapped);

    WhenSettled(backend, [backend, wide]() {
        if (backend->webview == nullptr) {
            return;
        }
        backend->webview->AddScriptToExecuteOnDocumentCreated(
            wide.c_str(),
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [backend](HRESULT result, LPCWSTR id) -> HRESULT {
                    if (IsLive(backend) && SUCCEEDED(result) && id != nullptr) {
                        backend->script_ids.push_back(std::wstring(id));
                    }
                    return S_OK;
                })
                .Get());
    });
}

void gjsify_webview2_backend_remove_all_scripts(GjsifyWebView2Backend *backend)
{
    WhenSettled(backend, [backend]() {
        if (backend->webview == nullptr) {
            return;
        }
        for (const auto &id : backend->script_ids) {
            backend->webview->RemoveScriptToExecuteOnDocumentCreated(id.c_str());
        }
        backend->script_ids.clear();
    });
}

void gjsify_webview2_backend_register_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name)
{
    std::string channel(name != nullptr ? name : "");
    std::wstring shim = MessageHandlerShim(channel);

    WhenSettled(backend, [backend, channel, shim]() {
        if (backend->webview == nullptr) {
            return;
        }
        backend->handler_names.push_back(channel);
        backend->webview->AddScriptToExecuteOnDocumentCreated(
            shim.c_str(),
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [backend](HRESULT result, LPCWSTR id) -> HRESULT {
                    if (IsLive(backend) && SUCCEEDED(result) && id != nullptr) {
                        backend->script_ids.push_back(std::wstring(id));
                    }
                    return S_OK;
                })
                .Get());
        // …and into the document that is already loaded, so registering a handler
        // after a page has loaded works the way WebKitGTK's does.
        backend->webview->ExecuteScript(shim.c_str(), IgnoreScriptResult().Get());
    });
}

void gjsify_webview2_backend_unregister_message_handler(
    GjsifyWebView2Backend *backend, const gchar *name)
{
    std::string channel(name != nullptr ? name : "");

    WhenSettled(backend, [backend, channel]() {
        if (backend->webview == nullptr) {
            return;
        }
        for (auto it = backend->handler_names.begin(); it != backend->handler_names.end(); ++it) {
            if (*it == channel) {
                backend->handler_names.erase(it);
                break;
            }
        }
        GString *js = g_string_new("try{delete window.webkit.messageHandlers[");
        AppendJsString(js, channel.c_str());
        g_string_append(js, "];}catch(e){}");
        std::wstring wide = ToWide(js->str);
        g_string_free(js, TRUE);
        backend->webview->ExecuteScript(wide.c_str(), IgnoreScriptResult().Get());
    });
}
