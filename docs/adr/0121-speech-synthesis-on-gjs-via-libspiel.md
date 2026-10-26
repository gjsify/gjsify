# 121. `speechSynthesis` on GJS runs on libspiel, with the system library first and no cloud voices

- Status: **Accepted** (2026-10-27)
- Date: 2026-10-27
- Deciders: Pascal Garber
- Related: [ADR 0075](0075-gamepad-sources.md) (the gamepad backend and its bundled native
  fallback are the template); `packages/web/speech-synthesis`, `packages/web/gamepad`

## Context

Browsers expose `speechSynthesis`, `SpeechSynthesisUtterance` and `SpeechSynthesisVoice`. GJS
has none of them. On GNOME the speech stack is [libspiel](https://project-spiel.org): a client
library (`gi://Spiel?version=1.0`) that talks over D-Bus to speech providers (Piper, eSpeak NG,
…) and plays through GStreamer.

## Decision

1. `@gjsify/speech-synthesis` implements the W3C Web Speech synthesis API on GJS, backed by
   `Spiel.Speaker`. It registers the six globals through the usual `globals-map` entries.
2. **The system library has precedence.** The package imports `gi://Spiel` from the host's
   typelib. A bundled `@gjsify/spiel-native` (like `gamepad-native`) is only a fallback for hosts
   without it; it is an integration point in `backend.ts`, not a dependency of this package yet,
   because the native package lands separately.
3. **Linux only.** On other systems `getVoices()` answers `[]` and `speak()` fires an `error`
   event with code `synthesis-unavailable`.
4. **No cloud voices in gjsify.** The package speaks what the host's providers offer. An app that
   wants a cloud voice adds its own provider or its own `SpeechSynthesis` implementation.
5. **The W3C surface cannot say why it is silent**, so the package adds a non-standard pair:
   `hasSpeechSynthesisBackend()` (quiet) and `describeSpeechSynthesisBackend()` (a reason, with a
   pointer to the Spiel Installer flatpak `org.project_spiel.SpielInstaller`). The one
   diagnostic is printed from `speak()`, once.
6. Spiel is fed one utterance at a time; the queue lives in `SpeechSynthesis`.

## Consequences

- Tests run against a fake speaker; one test uses real Spiel and skips without typelib or
  provider. Audio is never played in tests (`fakesink`).
- `rate`, `pitch` and `volume` are clamped by the package (0.1–10, 0–2, 0–1); Spiel itself
  accepts any value, and its real range is unverified.
- D-Bus and Flatpak sandbox access is measured in the `spiel-native` PR, not here.
