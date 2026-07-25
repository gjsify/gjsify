{
  "targets": [
    {
      "target_name": "tsfn",
      "sources": ["tsfn.c"],
      "defines": ["NAPI_VERSION=8"],
      "cflags": ["-pthread"],
      "libraries": ["-lpthread"]
    }
  ]
}
