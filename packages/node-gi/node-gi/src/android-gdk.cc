// SPDX-License-Identifier: MIT
// Android only: bring GDK's Android backend up without GTK's RuntimeApplication.
//
// GDK's Android backend is initialized by gdk_android_initialize(env, classloader,
// context) — the only exported entry point into it; everything else it needs
// (gdk_android_set_latest_activity in particular) is hidden. GTK ships one caller:
// JNI_OnLoad in libgtk-4.so, which runs when something calls
// System.loadLibrary("gtk-4") and which passes NULL for the context, plus
// RuntimeApplication.startRuntime(), which passes the android.app.Application — and
// also spawns GTK's own thread and dlopens an application library with a main().
//
// A JS host cannot use either. It is not the Application (NativeScript is), so
// startRuntime is out; and the NULL context from JNI_OnLoad is not enough: gtk_init
// calls Context.getSystemService() on it and the process dies with
// "JNI DETECTED ERROR IN APPLICATION: can't call ... getSystemService ... on null
// object". GIRepository's own dlopen of libgtk-4.so does not run JNI_OnLoad at all.
//
// So node-gi calls gdk_android_initialize itself, with the context the host names:
// the same (Application, app classloader) pair startRuntime uses, and nothing else of
// it. GTK's comment on that call — "This is *really* questionable, as thiz isn't
// actually an activity. I've updated the code to handle this case" — is the upstream
// licence for an Application here: it carries gtk_init over until a real
// ToplevelActivity reports itself through GdkContext._set_latest_activity().
//
// Opt-in, never automatic: dlopening libgtk-4.so pulls in the whole GTK stack, and a
// host that only wants GLib must not pay for it. See __NODE_GI_ANDROID_GDK in
// host.nativescript.js.

#include "common.h"

#ifdef __ANDROID__

#include <dlfcn.h>
#include <jni.h>

#include <string>

// Both set by JNI_OnLoad at the bottom of this file; file-static so both ends see them.
// The bootstrap class name is the only thing that travels the other way: JNI_OnLoad needs
// it to find the app's classloader, and only the host knows what the app called it.
static JavaVM* g_vm = nullptr;
static jobject g_app_loader = nullptr;
static std::string g_bootstrap_class;

namespace nodegi {

namespace {

// Describe-and-clear: the exception text is the whole diagnosis, and leaving it pending
// turns the next JNI call into an abort.
bool Failed(JNIEnv* env) {
  if (env->ExceptionCheck() == JNI_FALSE) return false;
  env->ExceptionDescribe();
  env->ExceptionClear();
  return true;
}

// App classes are invisible to FindClass from here: with no Java frame below the Node-API
// call, ART resolves against the system classloader, which does not know com.tns.* — the
// same reason a one-argument Class.forName() fails on this thread. Hence the loader
// JNI_OnLoad cached, with the thread's context loader and plain FindClass behind it for a
// host whose classes the system loader does have.
jclass LoadAppClass(JNIEnv* env, const std::string& jni_name) {
  std::string dotted = jni_name;
  for (char& c : dotted)
    if (c == '/') c = '.';

  jobject loader = g_app_loader;
  if (loader == nullptr) {
    jclass thread_class = env->FindClass("java/lang/Thread");
    jmethodID current =
        env->GetStaticMethodID(thread_class, "currentThread", "()Ljava/lang/Thread;");
    jobject thread = env->CallStaticObjectMethod(thread_class, current);
    if (Failed(env) || thread == nullptr) return nullptr;
    jmethodID get_loader = env->GetMethodID(thread_class, "getContextClassLoader",
                                            "()Ljava/lang/ClassLoader;");
    loader = env->CallObjectMethod(thread, get_loader);
    if (Failed(env) || loader == nullptr)
      return static_cast<jclass>(env->FindClass(jni_name.c_str()));
  }

  jclass loader_class = env->FindClass("java/lang/ClassLoader");
  jmethodID load_class = env->GetMethodID(loader_class, "loadClass",
                                          "(Ljava/lang/String;)Ljava/lang/Class;");
  jstring name = env->NewStringUTF(dotted.c_str());
  auto found = static_cast<jclass>(env->CallObjectMethod(loader, load_class, name));
  if (Failed(env) || found == nullptr) {
    Failed(env);
    return static_cast<jclass>(env->FindClass(jni_name.c_str()));
  }
  return found;
}

// androidHasJavaVm() -> boolean
//
// Whether JNI_OnLoad has run, i.e. whether the addon has a JavaVM and the app's
// classloader. Both arrive together and neither can be obtained any other way, so this
// one answer covers both — the host asks before and after the bootstrap load.
Napi::Value AndroidHasJavaVm(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_vm != nullptr);
}

// androidRegisterJniBootstrap(jniClassName) -> undefined
//
// Names the class the host is about to initialize to trigger JNI_OnLoad, in JNI form
// ('dev/example/JniBootstrap'). JNI_OnLoad looks it up to reach the app's classloader:
// during a load that ART performs, FindClass resolves against the classloader of the
// class that called System.loadLibrary, which is the one moment app classes are visible
// to this library. Must therefore be called BEFORE that load.
Napi::Value AndroidRegisterJniBootstrap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "androidRegisterJniBootstrap(jniClassName): a string is required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  g_bootstrap_class = info[0].As<Napi::String>().Utf8Value();
  return env.Undefined();
}

bool g_initialized = false;

// androidInitGdk(contextClass, contextMethod, contextSignature) -> boolean
//
// contextClass/contextMethod name a static method returning the android.content.Context
// to hand GDK, in JNI form — e.g. ('com/tns/NativeScriptApplication', 'getInstance',
// '()Landroid/app/Application;'). The host names it because only the host knows how to
// reach its Application without @hide APIs (android.app.ActivityThread is one).
// Idempotent: gdk_android_initialize has no guard of its own and would leak a second
// set of global refs and re-register every native.
Napi::Value AndroidInitGdk(const Napi::CallbackInfo& info) {
  Napi::Env napi_env = info.Env();
  if (g_initialized) return Napi::Boolean::New(napi_env, true);

  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString()) {
    Napi::TypeError::New(napi_env,
                         "androidInitGdk(contextClass, contextMethod, contextSignature): "
                         "three strings in JNI form are required")
        .ThrowAsJavaScriptException();
    return napi_env.Undefined();
  }
  std::string class_name = info[0].As<Napi::String>().Utf8Value();
  std::string method_name = info[1].As<Napi::String>().Utf8Value();
  std::string signature = info[2].As<Napi::String>().Utf8Value();

  if (g_vm == nullptr) {
    Napi::Error::New(napi_env,
                     "androidInitGdk: no JavaVM — this addon's JNI_OnLoad never ran. "
                     "Initialize an app class that calls System.loadLibrary(\"node_gi\") "
                     "first; a dlopen of the library does not run it.")
        .ThrowAsJavaScriptException();
    return napi_env.Undefined();
  }

  JNIEnv* env = nullptr;
  if (g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_EDETACHED)
    g_vm->AttachCurrentThread(&env, nullptr);
  if (env == nullptr) {
    Napi::Error::New(napi_env, "androidInitGdk: could not attach this thread to the JavaVM")
        .ThrowAsJavaScriptException();
    return napi_env.Undefined();
  }

  // gdk_android_initialize keeps global refs to both arguments, so a local frame is
  // enough and nothing here outlives it.
  env->PushLocalFrame(16);
  std::string error;
  do {
    jclass provider = LoadAppClass(env, class_name);
    if (Failed(env) || provider == nullptr) {
      error = "androidInitGdk: no class " + class_name + " on this thread's classloader";
      break;
    }
    jmethodID getter = env->GetStaticMethodID(provider, method_name.c_str(), signature.c_str());
    if (Failed(env) || getter == nullptr) {
      error = "androidInitGdk: " + class_name + " has no static " + method_name + signature;
      break;
    }
    jobject context = env->CallStaticObjectMethod(provider, getter);
    if (Failed(env) || context == nullptr) {
      error = "androidInitGdk: " + class_name + "." + method_name + "() returned no Context";
      break;
    }

    // The classloader GDK resolves org.gtk.android.* with has to be the one that holds
    // them: the loader of the app's own classes, which is the context's.
    jclass class_class = env->FindClass("java/lang/Class");
    jmethodID get_loader = env->GetMethodID(class_class, "getClassLoader",
                                            "()Ljava/lang/ClassLoader;");
    jobject loader = env->CallObjectMethod(env->GetObjectClass(context), get_loader);
    if (Failed(env) || loader == nullptr) {
      error = "androidInitGdk: the Context's class has no classloader";
      break;
    }

    // RTLD_GLOBAL: the backend resolves GDK symbols out of this handle later, and
    // GIRepository may have loaded libgtk-4.so locally already.
    void* gtk = dlopen("libgtk-4.so", RTLD_NOW | RTLD_GLOBAL);
    if (gtk == nullptr) {
      error = std::string("androidInitGdk: dlopen(libgtk-4.so) failed: ") + dlerror();
      break;
    }
    using InitFn = int (*)(JNIEnv*, jobject, jobject);
    auto initialize = reinterpret_cast<InitFn>(dlsym(gtk, "gdk_android_initialize"));
    if (initialize == nullptr) {
      error = "androidInitGdk: libgtk-4.so exports no gdk_android_initialize "
              "(GTK built without the Android backend?)";
      break;
    }
    if (initialize(env, loader, context) == 0) {
      error = "androidInitGdk: gdk_android_initialize() refused — see the GTK log";
      break;
    }
    g_initialized = true;
  } while (false);
  env->PopLocalFrame(nullptr);

  if (!g_initialized) {
    Napi::Error::New(napi_env, error).ThrowAsJavaScriptException();
    return napi_env.Undefined();
  }
  return Napi::Boolean::New(napi_env, true);
}

}  // namespace

void InitAndroidGdk(Napi::Env env, Napi::Object exports) {
  exports.Set("androidHasJavaVm", Napi::Function::New(env, AndroidHasJavaVm));
  exports.Set("androidRegisterJniBootstrap",
              Napi::Function::New(env, AndroidRegisterJniBootstrap));
  exports.Set("androidInitGdk", Napi::Function::New(env, AndroidInitGdk));
}

}  // namespace nodegi

// Runs when ART loads this library on behalf of a class — not on the dlopen that the JS
// runtime does. Two things are available here and nowhere else: the JavaVM, and a
// FindClass that resolves against the app's classloader rather than the system one.
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  g_vm = vm;
  if (g_bootstrap_class.empty()) return JNI_VERSION_1_6;

  JNIEnv* env = nullptr;
  if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK || env == nullptr)
    return JNI_VERSION_1_6;

  env->PushLocalFrame(4);
  jclass bootstrap = env->FindClass(g_bootstrap_class.c_str());
  if (!nodegi::Failed(env) && bootstrap != nullptr) {
    jmethodID get_loader = env->GetMethodID(env->GetObjectClass(bootstrap), "getClassLoader",
                                            "()Ljava/lang/ClassLoader;");
    jobject loader = env->CallObjectMethod(bootstrap, get_loader);
    if (!nodegi::Failed(env) && loader != nullptr) g_app_loader = env->NewGlobalRef(loader);
  }
  env->PopLocalFrame(nullptr);
  return JNI_VERSION_1_6;
}

#else

namespace nodegi {

// Off Android there is no JavaVM and no Android GDK backend to initialize; the exports
// stay so a host can ask without branching on the platform first.
static Napi::Value AndroidFalse(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), false);
}

void InitAndroidGdk(Napi::Env env, Napi::Object exports) {
  exports.Set("androidHasJavaVm", Napi::Function::New(env, AndroidFalse));
  exports.Set("androidRegisterJniBootstrap", Napi::Function::New(env, AndroidFalse));
  exports.Set("androidInitGdk", Napi::Function::New(env, AndroidFalse));
}

}  // namespace nodegi

#endif
