/*
 * gjsify-sherpa-shim.h — a flat C façade over sherpa-onnx's C API, for Vala.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Vala reaches a C library through a VAPI, and a VAPI that declares a struct
 * RESTATES its memory layout: field order, field types, and the layout of every
 * nested struct. sherpa-onnx's configuration structs are not candidates for
 * that. `SherpaOnnxOfflineModelConfig` alone nests TWENTY-TWO sub-structs
 * (transducer, paraformer, nemo_ctc, whisper, tdnn, sense_voice, moonshine,
 * fire_red_asr, dolphin, zipformer_ctc, canary, wenet_ctc, omnilingual, medasr,
 * funasr_nano, fire_red_asr_ctc, qwen3_asr, cohere_transcribe, …) and upstream
 * appends to them every release — v2.0.1 added two. A VAPI copy of that is a
 * second truth that drifts, and the way it fails is silent: a struct whose
 * layout is one field stale is not a compile error, it is a model path read out
 * of the middle of another field.
 *
 * So the layout stays in C, where the real header supplies it, and this file
 * exposes only scalars and strings — which a VAPI can state without knowing any
 * layout at all. The functions here `memset` each config to zero and set the
 * fields by name, exactly as every upstream example does.
 *
 * WHAT IS AND IS NOT HERE
 * ───────────────────────
 * Both recognizers are TRANSDUCER-ONLY: `encoder`/`decoder`/`joiner` + `tokens`.
 * That is what the two engines ADR 0127 measured need — the streaming
 * `zipformer-de-kroko` (online) and `parakeet-tdt-0.6b-v3` (offline) — and a
 * model family nobody has run is a claim, not a binding. Adding one is a
 * `..._open` parameter and a field assignment in the .c file, with no VAPI
 * change at all; the whisper family in particular belongs in
 * `@gjsify/whisper-native` (ADR 0127 decision 7), not here.
 *
 * Every string this returns is `g_strdup`ed and every array `g_malloc`ed, so
 * Vala's ordinary ownership transfer (which frees with `g_free`) is correct.
 * The `gjsify_sherpa_shim_` prefix keeps these out of the way of the
 * `gjsify_sherpa_*` symbols valac generates for the GjsifySherpa namespace.
 */

#ifndef GJSIFY_SHERPA_SHIM_H
#define GJSIFY_SHERPA_SHIM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------- */
/* Build information — what this prebuild actually contains.                 */
/* ------------------------------------------------------------------------- */

/** sherpa-onnx's own version string, e.g. `2.0.1`. Statically linked in. */
const char *gjsify_sherpa_shim_version (void);

/** The onnxruntime version sherpa-onnx was built against, e.g. `1.28.2`. */
const char *gjsify_sherpa_shim_onnxruntime_version (void);

/**
 * Non-zero when @filename is readable.
 *
 * sherpa-onnx's `..._open` functions below answer only NULL on failure, so the
 * model paths are checked here first and the missing one is named. Uses
 * sherpa-onnx's own `SherpaOnnxFileExists` so the answer is the one the engine
 * would get, not a second opinion from GLib.
 */
int32_t gjsify_sherpa_shim_file_exists (const char *filename);

/* ------------------------------------------------------------------------- */
/* Voice activity detection — Silero.                                        */
/* ------------------------------------------------------------------------- */

/** An open Silero VAD, plus the one speech segment `..._peek` last fetched. */
typedef struct _GjsifySherpaShimVad GjsifySherpaShimVad;

/**
 * Open a Silero VAD over @model (`silero_vad.onnx`).
 *
 * Returns NULL when @model is unreadable or sherpa-onnx refuses the
 * configuration; sherpa-onnx writes its own reason to stderr.
 */
GjsifySherpaShimVad *gjsify_sherpa_shim_vad_open (const char *model,
                                                  float threshold,
                                                  float min_silence_duration,
                                                  float min_speech_duration,
                                                  float max_speech_duration,
                                                  int32_t window_size,
                                                  int32_t sample_rate,
                                                  int32_t num_threads,
                                                  float buffer_size_in_seconds,
                                                  int32_t debug);

void gjsify_sherpa_shim_vad_close (GjsifySherpaShimVad *vad);

/**
 * Feed @n mono float samples in [-1, 1].
 *
 * @n is free: the detector buffers what does not fill a window
 * (`voice-activity-detector.cc`, `last_`), so a caller may hand it whatever a
 * capture source produced.
 */
void gjsify_sherpa_shim_vad_accept (GjsifySherpaShimVad *vad,
                                    const float *samples,
                                    int32_t n);

/** Non-zero while the detector is INSIDE speech — the speech-start edge. */
int32_t gjsify_sherpa_shim_vad_is_speech (GjsifySherpaShimVad *vad);

/** Non-zero when no COMPLETED segment is queued. */
int32_t gjsify_sherpa_shim_vad_is_empty (GjsifySherpaShimVad *vad);

/** Close an in-progress segment and queue it — end of input. */
void gjsify_sherpa_shim_vad_flush (GjsifySherpaShimVad *vad);

/** Drop every queued segment, keeping the model state. */
void gjsify_sherpa_shim_vad_clear (GjsifySherpaShimVad *vad);

/** Drop every queued segment AND the model state. */
void gjsify_sherpa_shim_vad_reset (GjsifySherpaShimVad *vad);

/**
 * Fetch the front segment into @vad and report its length, or -1 if none.
 *
 * Two calls rather than one returning an array: the length is not known before
 * the fetch, and a Vala out-array with a separate out-length is the one binding
 * form whose parameter ordering the VAPI would have to get right by hand. The
 * segment is held by @vad until `..._pop`, so `..._read` needs no second fetch.
 *
 * @start receives the segment's absolute offset in input samples.
 */
int32_t gjsify_sherpa_shim_vad_peek (GjsifySherpaShimVad *vad, int64_t *start);

/** Copy @n samples of the segment `..._peek` fetched into @dest. */
void gjsify_sherpa_shim_vad_read (GjsifySherpaShimVad *vad, float *dest, int32_t n);

/** Release the fetched segment and remove it from the queue. */
void gjsify_sherpa_shim_vad_pop (GjsifySherpaShimVad *vad);

/* ------------------------------------------------------------------------- */
/* Online (streaming) transducer recognizer.                                 */
/* ------------------------------------------------------------------------- */

typedef struct _GjsifySherpaShimOnline GjsifySherpaShimOnline;

/** A stream, carrying the recognizer every per-stream call needs anyway. */
typedef struct _GjsifySherpaShimOnlineStream GjsifySherpaShimOnlineStream;

/**
 * Open a streaming transducer recognizer.
 *
 * @provider, @model_type and @decoding_method may be NULL, in which case
 * sherpa-onnx's own defaults (`cpu`, autodetect, `greedy_search`) apply.
 * @hotwords is the contextual-biasing list as a newline-separated string, the
 * form `SherpaOnnxCreateOnlineStreamWithHotwords` takes per stream; it only
 * applies with `decoding_method = "modified_beam_search"`.
 */
GjsifySherpaShimOnline *gjsify_sherpa_shim_online_open (const char *encoder,
                                                        const char *decoder,
                                                        const char *joiner,
                                                        const char *tokens,
                                                        const char *model_type,
                                                        const char *provider,
                                                        int32_t num_threads,
                                                        const char *decoding_method,
                                                        int32_t max_active_paths,
                                                        float hotwords_score,
                                                        float blank_penalty,
                                                        int32_t enable_endpoint,
                                                        float rule1_min_trailing_silence,
                                                        float rule2_min_trailing_silence,
                                                        float rule3_min_utterance_length,
                                                        int32_t sample_rate,
                                                        int32_t feature_dim,
                                                        int32_t debug);

void gjsify_sherpa_shim_online_close (GjsifySherpaShimOnline *recognizer);

/** A new stream; @hotwords may be NULL for the recognizer's own list. */
GjsifySherpaShimOnlineStream *
gjsify_sherpa_shim_online_stream_open (GjsifySherpaShimOnline *recognizer,
                                       const char *hotwords);

void gjsify_sherpa_shim_online_stream_close (GjsifySherpaShimOnlineStream *stream);

/** Feed @n mono float samples recorded at @sample_rate. */
void gjsify_sherpa_shim_online_stream_accept (GjsifySherpaShimOnlineStream *stream,
                                              int32_t sample_rate,
                                              const float *samples,
                                              int32_t n);

/** Tell the stream no more samples follow, so the tail is padded and decoded. */
void gjsify_sherpa_shim_online_stream_input_finished (GjsifySherpaShimOnlineStream *stream);

/** Non-zero while enough frames are buffered for another `..._decode`. */
int32_t gjsify_sherpa_shim_online_stream_is_ready (GjsifySherpaShimOnlineStream *stream);

/** Non-zero when the endpointing rules say this utterance has ended. */
int32_t gjsify_sherpa_shim_online_stream_is_endpoint (GjsifySherpaShimOnlineStream *stream);

void gjsify_sherpa_shim_online_stream_decode (GjsifySherpaShimOnlineStream *stream);

/** Clear the decoder state after an endpoint, keeping the stream. */
void gjsify_sherpa_shim_online_stream_reset (GjsifySherpaShimOnlineStream *stream);

/** The text decoded so far — the interim result. Caller frees. */
char *gjsify_sherpa_shim_online_stream_text (GjsifySherpaShimOnlineStream *stream);

/** The full result as JSON (tokens, timestamps, …). Caller frees. */
char *gjsify_sherpa_shim_online_stream_json (GjsifySherpaShimOnlineStream *stream);

/* ------------------------------------------------------------------------- */
/* Offline (whole-utterance) transducer recognizer.                           */
/* ------------------------------------------------------------------------- */

typedef struct _GjsifySherpaShimOffline GjsifySherpaShimOffline;
typedef struct _GjsifySherpaShimOfflineStream GjsifySherpaShimOfflineStream;

/** Open a non-streaming transducer recognizer. NULLs as in `..._online_open`. */
GjsifySherpaShimOffline *gjsify_sherpa_shim_offline_open (const char *encoder,
                                                          const char *decoder,
                                                          const char *joiner,
                                                          const char *tokens,
                                                          const char *model_type,
                                                          const char *provider,
                                                          int32_t num_threads,
                                                          const char *decoding_method,
                                                          int32_t max_active_paths,
                                                          float hotwords_score,
                                                          float blank_penalty,
                                                          int32_t sample_rate,
                                                          int32_t feature_dim,
                                                          int32_t debug);

void gjsify_sherpa_shim_offline_close (GjsifySherpaShimOffline *recognizer);

GjsifySherpaShimOfflineStream *
gjsify_sherpa_shim_offline_stream_open (GjsifySherpaShimOffline *recognizer,
                                        const char *hotwords);

void gjsify_sherpa_shim_offline_stream_close (GjsifySherpaShimOfflineStream *stream);

void gjsify_sherpa_shim_offline_stream_accept (GjsifySherpaShimOfflineStream *stream,
                                               int32_t sample_rate,
                                               const float *samples,
                                               int32_t n);

/** Decode everything accepted so far. One stream decodes once. */
void gjsify_sherpa_shim_offline_stream_decode (GjsifySherpaShimOfflineStream *stream);

/** The decoded text. Caller frees. */
char *gjsify_sherpa_shim_offline_stream_text (GjsifySherpaShimOfflineStream *stream);

/** The full result as JSON. Caller frees. */
char *gjsify_sherpa_shim_offline_stream_json (GjsifySherpaShimOfflineStream *stream);

#ifdef __cplusplus
}
#endif

#endif /* GJSIFY_SHERPA_SHIM_H */
