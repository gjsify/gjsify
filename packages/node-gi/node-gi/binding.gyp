{
  "targets": [
    {
      "target_name": "node_gi",
      "sources": [
        "src/addon.cc",
        "src/cairo.cc",
        "src/calls.cc",
        "src/class.cc",
        "src/loop.cc",
        "src/marshal.cc",
        "src/object.cc",
        "src/repo.cc",
        "src/signals.cc",
        "src/template.cc",
        "src/toggle.cc",
        "src/variant.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags": [
        "<!@(pkg-config --cflags girepository-2.0 cairo)"
      ],
      "cflags_cc": [
        "<!@(pkg-config --cflags girepository-2.0 cairo)",
        "-std=c++17"
      ],
      "libraries": [
        "<!@(pkg-config --libs girepository-2.0 cairo)"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "<!@(pkg-config --cflags girepository-2.0 cairo)"
        ],
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "NO"
      }
    }
  ]
}
