// SPDX-License-Identifier: MIT
//
// ADR 0035 spike, questions 1, 3 and 5: can WebView2 back `gi://WebKit` 6.0 on
// win32, and what does the loop bridge cost?
//
// This is the win32 counterpart of `webkit-runloop-darwin.m`, and it asks the
// question that one answered the hard way. There, `WKWebView`'s callbacks are
// CFRunLoop sources, a `GMainContext` never looks at them, and a bare
// `g_main_loop_run()` did not reach `didFinishNavigation` at all — case [1] did
// not run slowly, it did not run. Every API row in that ADR was unreachable
// until a drain source existed.
//
// WHY THIS PROBE LINKS NO GLIB. The tempting shape is "run a real GMainLoop and
// see". It is the wrong shape twice over: `@gjsify/gtk-runtime-win32-x64` ships
// DLLs and typelibs, not headers, so a C++ translation unit cannot include
// glib.h from the bundle a shipped app actually carries — and pulling a second
// GLib from MSYS2 or gvsbuild would measure a different library than the one
// that ships. What matters about `g_main_loop_run()` here is one property:
// **it does not dispatch Win32 window messages.** A loop of `Sleep()` has
// exactly that property, links nothing, and cannot drift from the bundle. So
// the probe compares "no pump" against "pump" and reports which operations
// need which — which is the fact the binding has to be designed around.
//
// It is also written to RETIRE itself. If the no-pump case succeeds, the loop
// bridge is dead weight and the probe says so in as many words instead of
// printing a green line; if the pump case fails, WebView2 is not reachable
// from a console process at all and stage 1 of the ADR needs rethinking. Both
// outcomes exit non-zero, because both invalidate something written down.
//
// BUILD + RUN: docs/poc/webview2-win32-probe.ps1

#include <windows.h>

#include <wrl.h>
#include <objbase.h>
#include <shlwapi.h>

#include <WebView2.h>

#include <cstdio>
#include <cwchar>

using namespace Microsoft::WRL;

namespace {

constexpr int kCaptureWidth = 1024;
constexpr int kCaptureHeight = 768;
constexpr DWORD kWaitMs = 8000;   // the darwin probe's timeout, kept identical
constexpr int kCaptureRuns = 10;

// The page is handed over with NavigateToString rather than a data: URL on
// purpose: Chromium blocks a TOP-LEVEL navigation to data:, so a probe built on
// one would measure that block and report it as "navigation never completed".
const wchar_t* kPage =
    L"<!doctype html><html><head><meta charset='utf-8'><title>probe</title>"
    L"<style>body{margin:0;background:#1c71d8;color:#fff;font:16px sans-serif}"
    L"h1{margin:0;padding:24px}</style></head>"
    L"<body><h1>gjsify webview2 probe</h1></body></html>";

struct Probe {
    HWND hwnd = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;

    bool environmentReady = false;
    bool controllerReady = false;
    bool navigationCompleted = false;
    HRESULT navigationStatus = S_OK;
    HRESULT lastError = S_OK;
};

Probe g_probe;

// Two ways to wait, and the whole probe is the difference between them.
//
// `WaitPumping` is what an ordinary Win32 app's message loop does.
// `WaitWithoutPumping` has the one property of `g_main_loop_run()` that matters
// here: the thread is alive, it is not blocked on a WebView2 handle, and it
// never calls DispatchMessage.

bool WaitPumping(bool* flag, DWORD timeoutMs) {
    const ULONGLONG deadline = GetTickCount64() + timeoutMs;
    MSG msg;
    while (!*flag && GetTickCount64() < deadline) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        Sleep(1);
    }
    return *flag;
}

bool WaitWithoutPumping(bool* flag, DWORD timeoutMs) {
    const ULONGLONG deadline = GetTickCount64() + timeoutMs;
    while (!*flag && GetTickCount64() < deadline) {
        Sleep(10);
    }
    return *flag;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

HWND CreateHostWindow() {
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"GjsifyWebView2Probe";
    RegisterClassExW(&wc);

    // A real top-level window, not HWND_MESSAGE: WebView2's windowed hosting
    // mode parents a child HWND, and a message-only window has no client area
    // for it to occupy. This is the stage-1 shape from the ADR — the window a
    // GTK toplevel would be on win32 (`gdk_win32_surface_get_handle`).
    return CreateWindowExW(0, wc.lpszClassName, L"gjsify webview2 probe",
                           WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                           kCaptureWidth, kCaptureHeight, nullptr, nullptr,
                           wc.hInstance, nullptr);
}

void ReportHr(const char* what, HRESULT hr) {
    std::printf("  [--] %s -> HRESULT 0x%08lX\n", what, static_cast<unsigned long>(hr));
}

}  // namespace

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    HRESULT hrInit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hrInit)) {
        ReportHr("CoInitializeEx", hrInit);
        return 2;
    }

    std::printf("ADR 0035 spike — WebView2 in a NON-PUMPING console process\n");
    std::printf("(the process shape a gjs/node host is: no WinMain, no app message loop)\n\n");

    // ---------------------------------------------------------------- Q5
    // Is the Evergreen runtime present, and what answers when it is not?
    std::printf("Q5 — the Evergreen runtime\n");
    LPWSTR version = nullptr;
    HRESULT hrVersion = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    if (SUCCEEDED(hrVersion) && version != nullptr) {
        std::printf("  [ok] runtime present: %ls\n", version);
        CoTaskMemFree(version);
    } else {
        // This is the answer a stranger's machine may give, and ADR 0035
        // decision 5 turns it into a declared dependency of the .msi rather
        // than an assumption. HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) is the
        // documented "not installed".
        ReportHr("GetAvailableCoreWebView2BrowserVersionString (NOT INSTALLED)", hrVersion);
        std::printf("\nverdict: no WebView2 runtime on this host — nothing below is measurable.\n");
        CoUninitialize();
        return 3;
    }

    g_probe.hwnd = CreateHostWindow();
    if (g_probe.hwnd == nullptr) {
        std::printf("  [--] CreateWindowExW failed, GetLastError=%lu\n", GetLastError());
        CoUninitialize();
        return 2;
    }
    ShowWindow(g_probe.hwnd, SW_SHOW);

    // ---------------------------------------------------------------- Q1, setup half
    // Environment and controller creation are themselves completion-handler
    // APIs, so "does creation need the queue pumped" is as load-bearing as the
    // navigation question and has to be asked first.
    std::printf("\nQ1a — does CreateCoreWebView2Environment complete with NO pump?\n");
    HRESULT hrEnv = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                g_probe.lastError = result;
                if (SUCCEEDED(result) && env != nullptr) {
                    HRESULT hr = env->CreateCoreWebView2Controller(
                        g_probe.hwnd,
                        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                            [](HRESULT r, ICoreWebView2Controller* c) -> HRESULT {
                                g_probe.lastError = r;
                                if (SUCCEEDED(r) && c != nullptr) {
                                    g_probe.controller = c;
                                    g_probe.controller->get_CoreWebView2(&g_probe.webview);
                                }
                                g_probe.controllerReady = true;
                                return S_OK;
                            })
                            .Get());
                    if (FAILED(hr)) {
                        g_probe.lastError = hr;
                        g_probe.controllerReady = true;
                    }
                }
                g_probe.environmentReady = true;
                return S_OK;
            })
            .Get());
    if (FAILED(hrEnv)) {
        ReportHr("CreateCoreWebView2EnvironmentWithOptions returned", hrEnv);
        CoUninitialize();
        return 2;
    }

    const bool envNoPump = WaitWithoutPumping(&g_probe.environmentReady, kWaitMs);
    std::printf(envNoPump ? "  [ok] environment callback arrived with NO pump\n"
                          : "  [!!] TIMED OUT after %lu ms with no pump — the callback needs the queue\n",
                static_cast<unsigned long>(kWaitMs));

    if (!envNoPump) {
        std::printf("\nQ1b — the same wait, pumping the Win32 message queue\n");
        if (!WaitPumping(&g_probe.environmentReady, kWaitMs)) {
            std::printf("  [--] TIMED OUT pumping as well — WebView2 is not reachable here at all\n");
            CoUninitialize();
            return 4;
        }
        std::printf("  [ok] environment callback arrived while pumping\n");
    }

    if (!WaitPumping(&g_probe.controllerReady, kWaitMs)) {
        std::printf("  [--] controller creation never completed\n");
        CoUninitialize();
        return 4;
    }
    if (g_probe.webview == nullptr) {
        ReportHr("controller/CoreWebView2 unavailable", g_probe.lastError);
        CoUninitialize();
        return 4;
    }
    std::printf("  [ok] controller + CoreWebView2 obtained\n");

    RECT bounds = {0, 0, kCaptureWidth, kCaptureHeight};
    g_probe.controller->put_Bounds(bounds);
    g_probe.controller->put_IsVisible(TRUE);

    // ---------------------------------------------------------------- Q1, navigation half
    EventRegistrationToken token = {};
    g_probe.webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
                BOOL ok = FALSE;
                if (args != nullptr) {
                    args->get_IsSuccess(&ok);
                }
                g_probe.navigationStatus = ok ? S_OK : E_FAIL;
                g_probe.navigationCompleted = true;
                return S_OK;
            })
            .Get(),
        &token);

    std::printf("\nQ1c — does NavigationCompleted fire with NO pump?\n");
    HRESULT hrNav = g_probe.webview->NavigateToString(kPage);
    if (FAILED(hrNav)) {
        ReportHr("NavigateToString", hrNav);
        CoUninitialize();
        return 4;
    }
    const bool navNoPump = WaitWithoutPumping(&g_probe.navigationCompleted, kWaitMs);
    bool navPumped = navNoPump;
    if (navNoPump) {
        std::printf("  [ok] NavigationCompleted arrived with NO pump\n");
    } else {
        std::printf("  [!!] TIMED OUT after %lu ms with no pump\n", static_cast<unsigned long>(kWaitMs));
        std::printf("\nQ1d — the same navigation, pumping\n");
        navPumped = WaitPumping(&g_probe.navigationCompleted, kWaitMs);
        std::printf(navPumped ? "  [ok] NavigationCompleted arrived while pumping\n"
                              : "  [--] TIMED OUT pumping as well\n");
    }
    if (!navPumped) {
        std::printf("\nverdict: navigation never completes in this process shape.\n");
        CoUninitialize();
        return 4;
    }

    // ---------------------------------------------------------------- Q3
    // The number ADR 0035 needs beside darwin's 15.8 ms per takeSnapshot at
    // 1024x768. CapturePreview is a PNG/JPEG encoder, so this is expected to be
    // far worse — the point is to know by how much before stage 2 is scheduled.
    std::printf("\nQ3 — CapturePreviewAsync at %dx%d, %d runs\n", kCaptureWidth, kCaptureHeight,
                kCaptureRuns);
    LARGE_INTEGER freq;
    QueryPerformanceFrequency(&freq);
    double totalMs = 0.0;
    int captured = 0;
    for (int i = 0; i < kCaptureRuns; ++i) {
        ComPtr<IStream> stream;
        if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) {
            continue;
        }
        bool done = false;
        HRESULT captureResult = S_OK;
        LARGE_INTEGER start;
        QueryPerformanceCounter(&start);
        HRESULT hrCap = g_probe.webview->CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.Get(),
            Callback<ICoreWebView2CapturePreviewCompletedHandler>(
                [&done, &captureResult](HRESULT result) -> HRESULT {
                    captureResult = result;
                    done = true;
                    return S_OK;
                })
                .Get());
        if (FAILED(hrCap)) {
            ReportHr("CapturePreview returned", hrCap);
            break;
        }
        if (!WaitPumping(&done, kWaitMs)) {
            std::printf("  [--] capture %d never completed\n", i);
            break;
        }
        LARGE_INTEGER end;
        QueryPerformanceCounter(&end);
        if (FAILED(captureResult)) {
            ReportHr("capture completed with", captureResult);
            break;
        }
        STATSTG stat = {};
        stream->Stat(&stat, STATFLAG_NONAME);
        const double ms =
            static_cast<double>(end.QuadPart - start.QuadPart) * 1000.0 / static_cast<double>(freq.QuadPart);
        totalMs += ms;
        ++captured;
        if (i == 0) {
            std::printf("  [ok] first capture: %.1f ms, %llu bytes of PNG\n", ms,
                        static_cast<unsigned long long>(stat.cbSize.QuadPart));
        }
    }
    if (captured > 0) {
        std::printf("  [ok] %d captures, mean %.1f ms  (darwin takeSnapshot: 15.8 ms at the same size)\n",
                    captured, totalMs / captured);
    }

    // ---------------------------------------------------------------- verdict
    std::printf("\n---- verdict ----\n");
    std::printf("evergreen runtime : present\n");
    std::printf("env callback      : %s\n", envNoPump ? "NO pump needed" : "needs the queue pumped");
    std::printf("navigation        : %s\n", navNoPump ? "NO pump needed" : "needs the queue pumped");
    std::printf("capture           : %s\n", captured > 0 ? "works" : "FAILED");

    // The self-retiring half. Each branch invalidates something that is
    // currently written down, so each one exits non-zero and says which.
    int rc = 0;
    if (navNoPump && envNoPump) {
        std::printf("\nFINDING: no loop bridge is needed on win32. ADR 0035's premise that the\n");
        std::printf("darwin drain source has a win32 counterpart is WRONG and the ADR must say so.\n");
        rc = 10;
    } else {
        std::printf("\nFINDING: WebView2 needs the Win32 message queue dispatched, so the win32\n");
        std::printf("backend owes the same kind of loop bridge ADR 0022 built for CFRunLoop —\n");
        std::printf("a GSource that pumps the queue while at least one view is alive.\n");
    }
    if (captured == 0) {
        std::printf("\nFINDING: CapturePreview did not produce a frame in this process shape.\n");
        std::printf("Stage 2's frame transport cannot be budgeted from this host.\n");
        rc = rc == 0 ? 11 : rc;
    }

    if (g_probe.controller) {
        g_probe.controller->Close();
    }
    DestroyWindow(g_probe.hwnd);
    CoUninitialize();
    return rc;
}
