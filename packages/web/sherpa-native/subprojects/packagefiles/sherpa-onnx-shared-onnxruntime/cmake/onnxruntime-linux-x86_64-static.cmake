# OVERLAY — NOT upstream's file. Applied to the sherpa-onnx wrap checkout by
# `patch_directory = sherpa-onnx-shared-onnxruntime` in ../../sherpa-onnx.wrap,
# which is where the measurement behind it is written down.
#
# In one line: sherpa-onnx is built STATIC and this file makes the one library it
# must not link statically — onnxruntime — a SHARED imported target instead.
#
# Upstream's cmake/onnxruntime.cmake picks the file to include by
# `BUILD_SHARED_LIBS` alone, so a static sherpa-onnx always lands on
# `onnxruntime-linux-x86_64-static.cmake` and gets `libonnxruntime.a`. That
# archive is built by an OLD GCC and defines 54 weak vague-linkage symbols that
# the host GCC's own `libsherpa_onnx_core.a` also defines, under identical
# mangled names: `std::__detail::_Scanner<char>`'s nine members,
# `_State<char>::~_State` and `std::__throw_regex_error` among them. libstdc++
# puts `regex_traits` in the inline namespace `std::__cxx11` but `_Scanner` in
# plain `std::__detail` — so for those the NAME is stable across GCC versions
# while the LAYOUT is not. The static linker dedupes them, onnxruntime's
# `DeviceDiscovery::GetPciBusId` then builds an old-layout `_Scanner` through a
# new-layout constructor, and the result is not a link error but
# `free(): invalid pointer` on the first inference session — i.e. inside
# `Vad.open()`, with a correct model, every time.
#
# Hence: the SHARED engine, whose own `.so` exports exactly two dynamic symbols
# (`OrtGetApiBase` and one more) and no `std::` anything, so there is nothing
# left to dedupe. The contents below are upstream's own
# `cmake/onnxruntime-linux-x86_64.cmake` — the shared x86_64 file — under the
# static file's name, with its `if(NOT BUILD_SHARED_LIBS) FATAL_ERROR` guard
# dropped (that guard is the whole reason this cannot be done by options) and
# the directory-scoped `include_directories()` of the static file kept. Both
# include paths are needed: the imported target's
# INTERFACE_INCLUDE_DIRECTORIES is what meson's CMake translator carries into
# the targets it regenerates, and the directory-scoped one is what sherpa-onnx's
# own sources compile against.
#
# BUMPING sherpa-onnx: diff upstream's two x86_64 files against this one. Only
# the URL and the hash should differ from the shared file; if the shared file has
# grown anything else, copy that too.
# ---------------------------------------------------------------------------
# Copyright (c)  2022-2023  Xiaomi Corporation
message(STATUS "CMAKE_SYSTEM_NAME: ${CMAKE_SYSTEM_NAME}")
message(STATUS "CMAKE_SYSTEM_PROCESSOR: ${CMAKE_SYSTEM_PROCESSOR}")
message(STATUS "gjsify: SHARED onnxruntime overlay in use (static libonnxruntime.a is unusable here)")

if(NOT CMAKE_SYSTEM_NAME STREQUAL Linux)
  message(FATAL_ERROR "This file is for Linux only. Given: ${CMAKE_SYSTEM_NAME}")
endif()

if(NOT CMAKE_SYSTEM_PROCESSOR STREQUAL x86_64)
  message(FATAL_ERROR "This file is for x86_64 only. Given: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

set(onnxruntime_URL  "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip")
set(onnxruntime_HASH "SHA256=c4f8994d56191d9d2c92a961b39fe790459f2c5d155f912b239506ea31359534")

# If you don't have access to the Internet,
# please download onnxruntime to one of the following locations.
# You can add more if you want.
set(possible_file_locations
  $ENV{HOME}/Downloads/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip
  ${CMAKE_SOURCE_DIR}/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip
  ${CMAKE_BINARY_DIR}/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip
  /tmp/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip
  /star-fj/fangjun/download/github/onnxruntime-linux-x64-glibc2_17-Release-1.28.2.zip
)

foreach(f IN LISTS possible_file_locations)
  if(EXISTS ${f})
    set(onnxruntime_URL  "${f}")
    file(TO_CMAKE_PATH "${onnxruntime_URL}" onnxruntime_URL)
    message(STATUS "Found local downloaded onnxruntime: ${onnxruntime_URL}")
    break()
  endif()
endforeach()

FetchContent_Declare(onnxruntime
  URL
    ${onnxruntime_URL}
  URL_HASH          ${onnxruntime_HASH}
)

FetchContent_GetProperties(onnxruntime)
if(NOT onnxruntime_POPULATED)
  message(STATUS "Downloading onnxruntime from ${onnxruntime_URL}")
  FetchContent_Populate(onnxruntime)
endif()
message(STATUS "onnxruntime is downloaded to ${onnxruntime_SOURCE_DIR}")

find_library(location_onnxruntime onnxruntime
  PATHS
  "${onnxruntime_SOURCE_DIR}/lib"
  NO_CMAKE_SYSTEM_PATH
)

message(STATUS "location_onnxruntime: ${location_onnxruntime}")

# Directory-scoped, as in the static file this replaces: sherpa-onnx's own
# translation units include <onnxruntime_cxx_api.h> and do not all go through a
# target that links the imported one below.
include_directories(${onnxruntime_SOURCE_DIR}/include)

add_library(onnxruntime SHARED IMPORTED)

set_target_properties(onnxruntime PROPERTIES
  IMPORTED_LOCATION ${location_onnxruntime}
  INTERFACE_INCLUDE_DIRECTORIES "${onnxruntime_SOURCE_DIR}/include"
)

# Deliberately NOT `PARENT_SCOPE`: sherpa-onnx/csrc/CMakeLists.txt prefers the
# `onnxruntime` TARGET when it exists and only falls back to a file list.
file(GLOB onnxruntime_lib_files "${onnxruntime_SOURCE_DIR}/lib/libonnxruntime*")
message(STATUS "onnxruntime lib files: ${onnxruntime_lib_files}")
install(FILES ${onnxruntime_lib_files} DESTINATION lib)
