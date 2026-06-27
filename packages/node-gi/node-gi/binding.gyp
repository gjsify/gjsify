{
  "targets": [
    {
      "target_name": "node_gi",
      "sources": [
        "src/addon.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags": [
        "<!@(pkg-config --cflags girepository-2.0)"
      ],
      "cflags_cc": [
        "<!@(pkg-config --cflags girepository-2.0)",
        "-std=c++17"
      ],
      "libraries": [
        "<!@(pkg-config --libs girepository-2.0)"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "<!@(pkg-config --cflags girepository-2.0)"
        ],
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "NO"
      }
    }
  ]
}
