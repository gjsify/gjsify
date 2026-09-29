// SPDX-License-Identifier: MIT
// win32 only: which OpenGL implementation this process will get, and the one lever that
// changes it (#1097).
//
// gtk-4-1.dll imports OPENGL32.dll statically and libepoxy loads it with a bare
// `LoadLibraryA("OPENGL32")`. Windows answers both from the modules ALREADY LOADED first,
// then the application directory (node.exe's), then System32 — never from PATH, the only
// search the bundle loader controls. So a bundled GL implementation (Mesa's opengl32.dll)
// is reachable only by loading it by absolute path BEFORE gtk-4-1.dll loads; after that
// every bare-name request resolves to it. Measured on the win11-gjsify VM: the same DLL on
// PATH or preloaded from JS through `process.dlopen` (which unloads a DLL that fails to
// self-register) left GDK with "No GL implementation is available"; beside node.exe it gave
// GL 4.6.
//
// Preloading replaces the host's OpenGL for the whole process, so the loader asks first
// whether the host HAS one. Windows' own opengl32 finds a hardware ICD in two places — the
// display driver's user-mode OpenGL ICD (WDDM, what every vendor driver installs) and the
// legacy `OpenGLDrivers` registry key (what mesa-dist-win's system-wide deploy writes) —
// and this reads both WITHOUT loading opengl32, which would pin the host's copy for good.
// With neither, the host has only the GDI generic OpenGL 1.1, which GTK 4 rejects.

#include "common.h"

#ifdef _WIN32
#include <windows.h>

#include <memory>
#include <string>

// Windows 8+ (and 7 with KB2533623); older SDK headers guard them behind _WIN32_WINNT.
#ifndef LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR
#define LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR 0x00000100
#endif
#ifndef LOAD_LIBRARY_SEARCH_SYSTEM32
#define LOAD_LIBRARY_SEARCH_SYSTEM32 0x00000800
#endif

namespace {

// The D3DKMT thunks gdi32 exports, declared by hand: <d3dkmthk.h> needs the WDK's
// NTSTATUS plumbing, and resolving them at run time keeps a missing thunk a "no answer"
// rather than a load failure. Layouts are d3dkmthk.h's (Windows 8+ for EnumAdapters2).
using KmtHandle = UINT;
struct KmtAdapterInfo {
  KmtHandle hAdapter;
  LUID AdapterLuid;
  ULONG NumOfSources;
  BOOL bPrecisePresentRegionsPreferred;
};
struct KmtEnumAdapters2 {
  ULONG NumAdapters;
  KmtAdapterInfo* pAdapters;
};
struct KmtQueryAdapterInfo {
  KmtHandle hAdapter;
  UINT Type;
  void* pPrivateDriverData;
  UINT PrivateDriverDataSize;
};
struct KmtOpenGLInfo {
  WCHAR UmdOpenGlIcdFileName[MAX_PATH];
  ULONG Version;
  ULONG Flags;
};
struct KmtCloseAdapter {
  KmtHandle hAdapter;
};
constexpr UINT kKmtQaiUmOpenGLInfo = 2;  // KMTQAITYPE_UMOPENGLINFO

using EnumAdapters2Fn = LONG(APIENTRY*)(KmtEnumAdapters2*);
using QueryAdapterInfoFn = LONG(APIENTRY*)(const KmtQueryAdapterInfo*);
using CloseAdapterFn = LONG(APIENTRY*)(const KmtCloseAdapter*);

std::string Utf8(const wchar_t* w) {
  if (w == nullptr || *w == L'\0') return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (n <= 1) return {};
  std::string out(static_cast<size_t>(n - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, out.data(), n, nullptr, nullptr);
  return out;
}

std::wstring Wide(const std::string& s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  if (n <= 1) return {};
  std::wstring out(static_cast<size_t>(n - 1), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, out.data(), n);
  return out;
}

// The user-mode OpenGL ICD of the first adapter that names one, or "".
std::string WddmOpenGLIcd() {
  HMODULE gdi = GetModuleHandleW(L"gdi32.dll");
  if (gdi == nullptr) gdi = LoadLibraryW(L"gdi32.dll");
  if (gdi == nullptr) return {};
  auto enumAdapters = reinterpret_cast<EnumAdapters2Fn>(GetProcAddress(gdi, "D3DKMTEnumAdapters2"));
  auto queryInfo = reinterpret_cast<QueryAdapterInfoFn>(GetProcAddress(gdi, "D3DKMTQueryAdapterInfo"));
  auto closeAdapter = reinterpret_cast<CloseAdapterFn>(GetProcAddress(gdi, "D3DKMTCloseAdapter"));
  if (enumAdapters == nullptr || queryInfo == nullptr || closeAdapter == nullptr) return {};

  KmtEnumAdapters2 e{};
  if (enumAdapters(&e) != 0 || e.NumAdapters == 0) return {};
  std::unique_ptr<KmtAdapterInfo[]> adapters(new KmtAdapterInfo[e.NumAdapters]());
  e.pAdapters = adapters.get();
  if (enumAdapters(&e) != 0) return {};

  std::string icd;
  for (ULONG i = 0; i < e.NumAdapters; ++i) {
    KmtOpenGLInfo gl{};
    KmtQueryAdapterInfo q{adapters[i].hAdapter, kKmtQaiUmOpenGLInfo, &gl, sizeof(gl)};
    // A non-zero NTSTATUS is how the Basic Render Driver and the QXL/Hyper-V adapters say
    // they carry no OpenGL ICD, so it is an answer here, not an error.
    if (icd.empty() && queryInfo(&q) == 0) icd = Utf8(gl.UmdOpenGlIcdFileName);
    KmtCloseAdapter c{adapters[i].hAdapter};
    closeAdapter(&c);
  }
  return icd;
}

// The first ICD registered under the legacy key (a subkey or a value), or "".
std::string RegistryOpenGLIcd() {
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\OpenGLDrivers", 0,
                    KEY_READ | KEY_WOW64_64KEY, &key) != ERROR_SUCCESS)
    return {};
  wchar_t name[256];
  DWORD len = 256;
  std::string icd;
  if (RegEnumKeyExW(key, 0, name, &len, nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS) {
    icd = Utf8(name);
  } else {
    len = 256;
    if (RegEnumValueW(key, 0, name, &len, nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS) icd = Utf8(name);
  }
  RegCloseKey(key);
  return icd;
}

std::string LoadedOpenGL32Path() {
  HMODULE mod = GetModuleHandleW(L"opengl32.dll");
  if (mod == nullptr) return {};
  wchar_t path[MAX_PATH * 2];
  DWORD n = GetModuleFileNameW(mod, path, MAX_PATH * 2);
  if (n == 0) return {};
  return Utf8(path);
}

std::string LastErrorText(DWORD code) {
  wchar_t* buf = nullptr;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                 nullptr, code, 0, reinterpret_cast<LPWSTR>(&buf), 0, nullptr);
  std::string text = Utf8(buf);
  if (buf != nullptr) LocalFree(buf);
  while (!text.empty() && (text.back() == '\n' || text.back() == '\r' || text.back() == ' ')) text.pop_back();
  return text;
}

}  // namespace

namespace nodegi {

// probeHostOpenGL() → { wddmIcd, registryIcd, loadedFrom } — strings, "" for none.
Napi::Value ProbeHostOpenGL(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  out.Set("wddmIcd", WddmOpenGLIcd());
  out.Set("registryIcd", RegistryOpenGLIcd());
  out.Set("loadedFrom", LoadedOpenGL32Path());
  return out;
}

// preloadOpenGL(absPath) → the path the loaded opengl32 module reports. Its own imports
// (Mesa's libgallium_wgl.dll, then system DLLs) resolve from ITS directory and System32 only:
// LOAD_WITH_ALTERED_SEARCH_PATH would fall through to the working directory and PATH when
// libgallium_wgl.dll is missing, so a planted copy there would be loaded instead. The
// DLL_LOAD_DIR flag also refuses a relative path. The module is never freed: gtk and epoxy
// hold function pointers into it for the process's life.
Napi::Value PreloadOpenGL(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "preloadOpenGL(path): path must be a string").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  HMODULE mod = LoadLibraryExW(Wide(path).c_str(), nullptr,
                               LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (mod == nullptr) {
    DWORD code = GetLastError();
    Napi::Error::New(env, "preloadOpenGL: LoadLibraryExW(" + path + ") failed: " + LastErrorText(code) + " (" +
                              std::to_string(code) + ")")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, LoadedOpenGL32Path());
}

// currentGLStrings() → { vendor, renderer, version } of the context current on this
// thread, or null. glGetString is an opengl32 export, so this asks whichever
// implementation GDK actually got — the discriminating half of the proof.
Napi::Value CurrentGLStrings(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HMODULE mod = GetModuleHandleW(L"opengl32.dll");
  if (mod == nullptr) return env.Null();
  using GetStringFn = const unsigned char*(APIENTRY*)(unsigned int);
  auto getString = reinterpret_cast<GetStringFn>(GetProcAddress(mod, "glGetString"));
  if (getString == nullptr) return env.Null();
  constexpr unsigned int kVendor = 0x1F00, kRenderer = 0x1F01, kVersion = 0x1F02;
  const unsigned char* renderer = getString(kRenderer);
  if (renderer == nullptr) return env.Null();  // no current context
  auto str = [](const unsigned char* s) { return std::string(s != nullptr ? reinterpret_cast<const char*>(s) : ""); };
  Napi::Object out = Napi::Object::New(env);
  out.Set("vendor", str(getString(kVendor)));
  out.Set("renderer", str(renderer));
  out.Set("version", str(getString(kVersion)));
  return out;
}

void InitOpenGLWin32(Napi::Env env, Napi::Object exports) {
  exports.Set("probeHostOpenGL", Napi::Function::New(env, ProbeHostOpenGL));
  exports.Set("preloadOpenGL", Napi::Function::New(env, PreloadOpenGL));
  exports.Set("currentGLStrings", Napi::Function::New(env, CurrentGLStrings));
}

}  // namespace nodegi

#else

namespace nodegi {
// Off win32 the host's GL is the system's own business (Mesa/vendor on Linux, CGL on
// darwin) and there is nothing to preload, so the surface is simply absent.
void InitOpenGLWin32(Napi::Env, Napi::Object) {}
}  // namespace nodegi

#endif
