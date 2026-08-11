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
        "src/private.cc",
        "src/repo.cc",
        "src/signals.cc",
        "src/template.cc",
        "src/toggle.cc",
        "src/variant.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS"
      ],
      "conditions": [
        [ "OS!='win'", {
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
          "xcode_settings": {
            "OTHER_CFLAGS": [
              "<!@(pkg-config --cflags girepository-2.0 cairo)"
            ],
            # scripts/stage-prebuild.mjs rewrites this addon's Homebrew-absolute
            # dependencies to @rpath and gives it a four-entry LC_RPATH list (#1120).
            # A Mach-O's load commands live in a header pad fixed at LINK time, and
            # the default pad is too small for that: install_name_tool then refuses
            # with "larger updated load commands do not fit (the program must be
            # relinked)". Not repairable after the fact, which is why it is a link
            # flag and not a staging step.
            "OTHER_LDFLAGS": [
              "-Wl,-headerpad_max_install_names"
            ],
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "NO"
          }
        } ],
        [ "OS=='win'", {
          # gvsbuild GTK4 (GLib >= 2.80, girepository-2.0) is MSVC-ABI, so the addon
          # builds with node-gyp's default MSVC toolchain and loads into stock
          # (MSVC-ABI) Node/Bun/Deno. gyp's msvs generator ignores `cflags`/
          # `xcode_settings`, so the flags come from pkg-config via a helper that
          # emits BARE include dirs + FULL .lib paths (scripts/win-gi-gyp-flags.mjs) —
          # the exact shapes gyp forwards to cl.exe / link.exe.
          "include_dirs": [
            "<!@(node scripts/win-gi-gyp-flags.mjs --includes)"
          ],
          "libraries": [
            "<!@(node scripts/win-gi-gyp-flags.mjs --libs)"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/std:c++17" ]
            }
          }
        } ]
      ]
    }
  ]
}
