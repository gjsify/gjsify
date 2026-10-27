# @gjsify/speech-synthesis

The W3C Web Speech synthesis API for GJS: `speechSynthesis`, `SpeechSynthesis`, `SpeechSynthesisUtterance`, `SpeechSynthesisVoice`, `SpeechSynthesisEvent`, `SpeechSynthesisErrorEvent`. The backend is [libspiel](https://project-spiel.org) (`gi://Spiel?version=1.0`) and its speech providers. Linux only. See [ADR 0121](../../../docs/adr/0121-speech-synthesis-on-gjs-via-libspiel.md).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/speech-synthesis
```

## Usage

```typescript
import '@gjsify/speech-synthesis/register';

speechSynthesis.addEventListener('voiceschanged', () => {
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
    const utterance = new SpeechSynthesisUtterance('Hallo Welt');
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
});
speechSynthesis.getVoices(); // starts the probe; [] until `voiceschanged`
```

## Without a speech stack

The W3C API cannot tell "no voices" from "no libspiel". Without the typelib or a provider, `getVoices()` returns `[]` and `speak()` fires an `error` event with `error: 'synthesis-unavailable'`. Ask why with the non-standard pair:

```typescript
import { hasSpeechSynthesisBackend, describeSpeechSynthesisBackend } from '@gjsify/speech-synthesis';

if (!hasSpeechSynthesisBackend()) console.log(describeSpeechSynthesisBackend());
```

Install voices with the Spiel Installer flatpak `org.project_spiel.SpielInstaller`.

## Notes

- `voiceURI` is `<provider>#<voice>`; the first voice is `default`.
- `rate` 0.1–10, `pitch` 0–2, `volume` 0–1 are clamped by this package.
- `cancel()` fires `error` with `canceled`; Spiel `word-started` becomes a `boundary` event.
- No cloud voices; apps bring their own.
- `src/backend.ts` asks `probeSpiel()` from `@gjsify/spiel-native`: the host's libspiel wins, the bundled prebuild is the fallback, and `describeSpeechSynthesisBackend()` says which one answered.

## License

MIT
