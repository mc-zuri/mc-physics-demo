// java.lang.Math.sin and cos through JNI, in a JVM embedded in the Node process. The JVM library is loaded at run time
// (initialize), so the addon links against neither jvm.lib nor libjvm and builds with the JDK's headers alone.
#include <node_api.h>
#include <jni.h>
#include <atomic>
#include <mutex>
#include <string>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

JavaVM* vm = nullptr;
jclass mathClass = nullptr;
jmethodID sinMethod = nullptr;
jmethodID cosMethod = nullptr;
std::mutex initMutex;
std::atomic<bool> ready{false};
std::string runtimeVersion;
std::string loadedPath;

using CreateJavaVM = jint(JNICALL*)(JavaVM**, void**, void*);

napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

// A JNIEnv belongs to its thread: Node worker threads attach to the JVM for the call and detach after it.
struct JavaThread {
  JNIEnv* env = nullptr;
  bool attached = false;
  JavaThread() {
    jint status = vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_8);
    if (status == JNI_EDETACHED) {
      attached = vm->AttachCurrentThreadAsDaemon(reinterpret_cast<void**>(&env), nullptr) == JNI_OK;
      if (!attached) env = nullptr;
    } else if (status != JNI_OK) {
      env = nullptr;
    }
  }
  ~JavaThread() {
    if (attached) vm->DetachCurrentThread();
  }
};

CreateJavaVM loadCreateJavaVM(const std::string& path) {
#ifdef _WIN32
  int length = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), static_cast<int>(path.size()), nullptr, 0);
  std::wstring wide(length, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, path.c_str(), static_cast<int>(path.size()), &wide[0], length);
  // jvm.dll loads its sibling DLLs from its own directory
  HMODULE library = LoadLibraryExW(wide.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  return library ? reinterpret_cast<CreateJavaVM>(GetProcAddress(library, "JNI_CreateJavaVM")) : nullptr;
#else
  void* library = dlopen(path.c_str(), RTLD_NOW | RTLD_GLOBAL);
  return library ? reinterpret_cast<CreateJavaVM>(dlsym(library, "JNI_CreateJavaVM")) : nullptr;
#endif
}

std::string javaProperty(JNIEnv* java, const char* name) {
  std::string result;
  jclass system = java->FindClass("java/lang/System");
  jmethodID getProperty = system ? java->GetStaticMethodID(system, "getProperty", "(Ljava/lang/String;)Ljava/lang/String;") : nullptr;
  if (!getProperty) {
    java->ExceptionClear();
    return result;
  }
  jstring key = java->NewStringUTF(name);
  jstring value = static_cast<jstring>(java->CallStaticObjectMethod(system, getProperty, key));
  if (java->ExceptionCheck()) java->ExceptionClear();
  if (value) {
    const char* chars = java->GetStringUTFChars(value, nullptr);
    result = chars;
    java->ReleaseStringUTFChars(value, chars);
    java->DeleteLocalRef(value);
  }
  java->DeleteLocalRef(key);
  java->DeleteLocalRef(system);
  return result;
}

// initialize(jvmLibraryPath): starts the JVM once per process and returns its java.runtime.version.
napi_value initialize(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  size_t size = 0;
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &size) != napi_ok)
    return fail(env, "initialize requires the path of the JVM library (jvm.dll, libjvm.so or libjvm.dylib)");
  std::string path(size + 1, '\0');
  napi_get_value_string_utf8(env, args[0], &path[0], path.size(), &size);
  path.resize(size);

  std::lock_guard<std::mutex> lock(initMutex);
  if (vm && path != loadedPath) return fail(env, "a different JVM is already running in this process");
  if (vm && !ready.load()) return fail(env, "an earlier JVM start failed in this process");
  if (!vm) {
    CreateJavaVM create = loadCreateJavaVM(path);
    if (!create) return fail(env, "cannot load JNI_CreateJavaVM from the JVM library");
    JavaVMOption options[4];
    options[0].optionString = const_cast<char*>("-Xrs");  // leave signals (Ctrl+C) to Node
    options[1].optionString = const_cast<char*>("-Xms16m");
    options[2].optionString = const_cast<char*>("-Xmx64m");
    options[3].optionString = const_cast<char*>("-XX:+UseSerialGC");
    JavaVMInitArgs init{};
    init.version = JNI_VERSION_1_8;
    init.nOptions = 4;
    init.options = options;
    init.ignoreUnrecognized = JNI_FALSE;
    JNIEnv* java = nullptr;
    if (create(&vm, reinterpret_cast<void**>(&java), &init) != JNI_OK) {
      vm = nullptr;
      return fail(env, "cannot start the JVM");
    }
    loadedPath = path;
    jclass local = java->FindClass("java/lang/Math");
    if (local) {
      mathClass = static_cast<jclass>(java->NewGlobalRef(local));
      sinMethod = java->GetStaticMethodID(mathClass, "sin", "(D)D");
      cosMethod = java->GetStaticMethodID(mathClass, "cos", "(D)D");
      java->DeleteLocalRef(local);
    }
    if (java->ExceptionCheck() || !sinMethod || !cosMethod) {
      java->ExceptionClear();
      return fail(env, "cannot resolve java.lang.Math.sin and cos");
    }
    runtimeVersion = javaProperty(java, "java.runtime.version");
    ready.store(true);
  }
  napi_value result;
  napi_create_string_utf8(env, runtimeVersion.c_str(), runtimeVersion.size(), &result);
  return result;
}

template <bool isSin>
napi_value call(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  double input;
  if (argc != 1 || napi_get_value_double(env, args[0], &input) != napi_ok)
    return fail(env, "sin and cos take one number");
  if (!ready.load()) return fail(env, "call initialize before sin and cos");
  JavaThread java;
  if (!java.env) return fail(env, "cannot attach this thread to the JVM");
  double output = java.env->CallStaticDoubleMethod(mathClass, isSin ? sinMethod : cosMethod, input);
  if (java.env->ExceptionCheck()) {
    java.env->ExceptionClear();
    return fail(env, "java.lang.Math call failed");
  }
  napi_value result;
  napi_create_double(env, output, &result);
  return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor functions[] = {
    {"initialize", nullptr, initialize, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"sin", nullptr, call<true>, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cos", nullptr, call<false>, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, functions);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
