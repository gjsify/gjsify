// Shared catalog entries for speech models (Silero VAD).
//
// These entries hold only the measured file facts and metadata that belong in
// the shared catalog. Capability-specific runtime behaviour (sampleRate,
// windowSize) is composed on top in the VAD package.

import type { CatalogEntry } from './index.js';

const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

export const SPEECH_MODELS: readonly CatalogEntry[] = [
    {
        id: 'silero-v5',
        capability: 'speech',
        files: [
            {
                file: 'silero_vad_v5.onnx',
                url: `${RELEASE}/silero_vad_v5.onnx`,
                bytes: 2313101,
                sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
            },
        ],
        license: 'MIT',
        redistributable: true,
        description: 'Silero VAD v5 (2.2 MiB) — the default. Takes input/state/sr; 16 kHz, 512-sample windows.',
    },
    {
        id: 'silero-v4',
        capability: 'speech',
        files: [
            {
                file: 'silero_vad.onnx',
                url: `${RELEASE}/silero_vad.onnx`,
                bytes: 643854,
                sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
            },
        ],
        license: 'MIT',
        redistributable: true,
        description: 'Silero VAD v4 (0.6 MiB) — smaller and older. Only its 16 kHz branch is covered here.',
    },
];
