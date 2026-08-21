### WebGL known issues

Issues discovered while porting Three.js demos. Non-fatal but should be addressed for full compatibility.

| Issue | Severity | Details | Affected Demos |
|-------|----------|---------|----------------|
| WebGL1 `setError` calls too strict for WebGL2 | Low | Base class validation (texImage2D, renderbufferStorage, etc.) uses WebGL1 format/type rules. WebGL2 allows more combinations (R8, RG8, RGBA16F, DEPTH_COMPONENT24, etc.). Non-fatal — native GL still executes the calls. | All WebGL2 demos |
| WebGL1 framebuffer color attachment validation too strict | Low | Base `_preCheckFramebufferStatus` only accepts RGBA/UNSIGNED_BYTE or RGBA/FLOAT. WebGL2 override delegates to the native driver. WebGL1 with extensions (OES_texture_half_float) still rejects valid formats. | Post-processing with WebGL1 |
