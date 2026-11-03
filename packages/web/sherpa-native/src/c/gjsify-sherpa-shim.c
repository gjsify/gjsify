/*
 * gjsify-sherpa-shim.c — the only file in this package that knows what
 * sherpa-onnx's structs look like. See gjsify-sherpa-shim.h for why.
 *
 * Every config is `memset` to zero before a field is set, which is what makes
 * the rest of it forward-compatible: a field upstream adds is zero, and zero is
 * the documented "not configured" value for every pointer and every count in
 * these structs. It is also why no field is set from a parameter that is NULL —
 * an empty string and a NULL mean different things to sherpa-onnx in a few
 * places, and zero is the one that reads as absent everywhere.
 */

#include "gjsify-sherpa-shim.h"

#include <glib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

/* ------------------------------------------------------------------------- */

const char *
gjsify_sherpa_shim_version (void)
{
  return SherpaOnnxGetVersionStr ();
}

const char *
gjsify_sherpa_shim_onnxruntime_version (void)
{
  return SherpaOnnxGetOnnxruntimeVersionStr ();
}

int32_t
gjsify_sherpa_shim_file_exists (const char *filename)
{
  if (filename == NULL)
    return 0;
  return SherpaOnnxFileExists (filename);
}

/* ------------------------------------------------------------------------- */
/* VAD                                                                       */
/* ------------------------------------------------------------------------- */

struct _GjsifySherpaShimVad
{
  const SherpaOnnxVoiceActivityDetector *vad;
  /* The segment `_peek` fetched and `_read` copies from, owned until `_pop`. */
  const SherpaOnnxSpeechSegment *segment;
};

GjsifySherpaShimVad *
gjsify_sherpa_shim_vad_open (const char *model,
                             float threshold,
                             float min_silence_duration,
                             float min_speech_duration,
                             float max_speech_duration,
                             int32_t window_size,
                             int32_t sample_rate,
                             int32_t num_threads,
                             float buffer_size_in_seconds,
                             int32_t debug)
{
  SherpaOnnxVadModelConfig config;
  const SherpaOnnxVoiceActivityDetector *vad;
  GjsifySherpaShimVad *self;

  if (model == NULL || !SherpaOnnxFileExists (model))
    return NULL;

  memset (&config, 0, sizeof (config));
  config.silero_vad.model = model;
  config.silero_vad.threshold = threshold;
  config.silero_vad.min_silence_duration = min_silence_duration;
  config.silero_vad.min_speech_duration = min_speech_duration;
  config.silero_vad.max_speech_duration = max_speech_duration;
  config.silero_vad.window_size = window_size;
  config.sample_rate = sample_rate;
  config.num_threads = num_threads;
  config.provider = "cpu";
  config.debug = debug;

  vad = SherpaOnnxCreateVoiceActivityDetector (&config, buffer_size_in_seconds);
  if (vad == NULL)
    return NULL;

  self = g_new0 (GjsifySherpaShimVad, 1);
  self->vad = vad;
  return self;
}

void
gjsify_sherpa_shim_vad_close (GjsifySherpaShimVad *vad)
{
  if (vad == NULL)
    return;
  if (vad->segment != NULL)
    SherpaOnnxDestroySpeechSegment (vad->segment);
  SherpaOnnxDestroyVoiceActivityDetector (vad->vad);
  g_free (vad);
}

void
gjsify_sherpa_shim_vad_accept (GjsifySherpaShimVad *vad, const float *samples, int32_t n)
{
  if (vad == NULL || samples == NULL || n <= 0)
    return;
  SherpaOnnxVoiceActivityDetectorAcceptWaveform (vad->vad, samples, n);
}

int32_t
gjsify_sherpa_shim_vad_is_speech (GjsifySherpaShimVad *vad)
{
  return vad == NULL ? 0 : SherpaOnnxVoiceActivityDetectorDetected (vad->vad);
}

int32_t
gjsify_sherpa_shim_vad_is_empty (GjsifySherpaShimVad *vad)
{
  return vad == NULL ? 1 : SherpaOnnxVoiceActivityDetectorEmpty (vad->vad);
}

void
gjsify_sherpa_shim_vad_flush (GjsifySherpaShimVad *vad)
{
  if (vad != NULL)
    SherpaOnnxVoiceActivityDetectorFlush (vad->vad);
}

void
gjsify_sherpa_shim_vad_clear (GjsifySherpaShimVad *vad)
{
  if (vad == NULL)
    return;
  if (vad->segment != NULL)
    {
      SherpaOnnxDestroySpeechSegment (vad->segment);
      vad->segment = NULL;
    }
  SherpaOnnxVoiceActivityDetectorClear (vad->vad);
}

void
gjsify_sherpa_shim_vad_reset (GjsifySherpaShimVad *vad)
{
  if (vad == NULL)
    return;
  if (vad->segment != NULL)
    {
      SherpaOnnxDestroySpeechSegment (vad->segment);
      vad->segment = NULL;
    }
  SherpaOnnxVoiceActivityDetectorReset (vad->vad);
}

int32_t
gjsify_sherpa_shim_vad_peek (GjsifySherpaShimVad *vad, int64_t *start)
{
  if (start != NULL)
    *start = -1;

  if (vad == NULL)
    return -1;

  /* An un-popped segment from a previous peek would leak; the queue head is the
   * only thing this answers about, so re-peeking means re-reading the head. */
  if (vad->segment != NULL)
    {
      SherpaOnnxDestroySpeechSegment (vad->segment);
      vad->segment = NULL;
    }

  if (SherpaOnnxVoiceActivityDetectorEmpty (vad->vad))
    return -1;

  vad->segment = SherpaOnnxVoiceActivityDetectorFront (vad->vad);
  if (vad->segment == NULL)
    return -1;

  if (start != NULL)
    *start = vad->segment->start;

  return vad->segment->n;
}

void
gjsify_sherpa_shim_vad_read (GjsifySherpaShimVad *vad, float *dest, int32_t n)
{
  if (vad == NULL || vad->segment == NULL || dest == NULL || n <= 0)
    return;
  if (n > vad->segment->n)
    n = vad->segment->n;
  memcpy (dest, vad->segment->samples, (size_t) n * sizeof (float));
}

void
gjsify_sherpa_shim_vad_pop (GjsifySherpaShimVad *vad)
{
  if (vad == NULL)
    return;
  if (vad->segment != NULL)
    {
      SherpaOnnxDestroySpeechSegment (vad->segment);
      vad->segment = NULL;
    }
  SherpaOnnxVoiceActivityDetectorPop (vad->vad);
}

/* ------------------------------------------------------------------------- */
/* Online recognizer                                                         */
/* ------------------------------------------------------------------------- */

struct _GjsifySherpaShimOnline
{
  const SherpaOnnxOnlineRecognizer *recognizer;
};

struct _GjsifySherpaShimOnlineStream
{
  const SherpaOnnxOnlineRecognizer *recognizer; /* borrowed from the owner */
  const SherpaOnnxOnlineStream *stream;
};

/** Every transducer leg needs all four files; name the first one missing. */
static gboolean
transducer_files_present (const char *encoder,
                          const char *decoder,
                          const char *joiner,
                          const char *tokens)
{
  return SherpaOnnxFileExists (encoder) && SherpaOnnxFileExists (decoder) &&
         SherpaOnnxFileExists (joiner) && SherpaOnnxFileExists (tokens);
}

GjsifySherpaShimOnline *
gjsify_sherpa_shim_online_open (const char *encoder,
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
                                int32_t debug)
{
  SherpaOnnxOnlineRecognizerConfig config;
  const SherpaOnnxOnlineRecognizer *recognizer;
  GjsifySherpaShimOnline *self;

  if (encoder == NULL || decoder == NULL || joiner == NULL || tokens == NULL)
    return NULL;
  if (!transducer_files_present (encoder, decoder, joiner, tokens))
    return NULL;

  memset (&config, 0, sizeof (config));
  config.feat_config.sample_rate = sample_rate;
  config.feat_config.feature_dim = feature_dim;
  config.model_config.transducer.encoder = encoder;
  config.model_config.transducer.decoder = decoder;
  config.model_config.transducer.joiner = joiner;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = num_threads;
  config.model_config.provider = provider;
  config.model_config.model_type = model_type;
  config.model_config.debug = debug;
  config.decoding_method = decoding_method;
  config.max_active_paths = max_active_paths;
  config.enable_endpoint = enable_endpoint;
  config.rule1_min_trailing_silence = rule1_min_trailing_silence;
  config.rule2_min_trailing_silence = rule2_min_trailing_silence;
  config.rule3_min_utterance_length = rule3_min_utterance_length;
  config.hotwords_score = hotwords_score;
  config.blank_penalty = blank_penalty;

  recognizer = SherpaOnnxCreateOnlineRecognizer (&config);
  if (recognizer == NULL)
    return NULL;

  self = g_new0 (GjsifySherpaShimOnline, 1);
  self->recognizer = recognizer;
  return self;
}

void
gjsify_sherpa_shim_online_close (GjsifySherpaShimOnline *recognizer)
{
  if (recognizer == NULL)
    return;
  SherpaOnnxDestroyOnlineRecognizer (recognizer->recognizer);
  g_free (recognizer);
}

GjsifySherpaShimOnlineStream *
gjsify_sherpa_shim_online_stream_open (GjsifySherpaShimOnline *recognizer,
                                       const char *hotwords)
{
  const SherpaOnnxOnlineStream *stream;
  GjsifySherpaShimOnlineStream *self;

  if (recognizer == NULL)
    return NULL;

  stream = hotwords != NULL
             ? SherpaOnnxCreateOnlineStreamWithHotwords (recognizer->recognizer, hotwords)
             : SherpaOnnxCreateOnlineStream (recognizer->recognizer);
  if (stream == NULL)
    return NULL;

  self = g_new0 (GjsifySherpaShimOnlineStream, 1);
  self->recognizer = recognizer->recognizer;
  self->stream = stream;
  return self;
}

void
gjsify_sherpa_shim_online_stream_close (GjsifySherpaShimOnlineStream *stream)
{
  if (stream == NULL)
    return;
  SherpaOnnxDestroyOnlineStream (stream->stream);
  g_free (stream);
}

void
gjsify_sherpa_shim_online_stream_accept (GjsifySherpaShimOnlineStream *stream,
                                         int32_t sample_rate,
                                         const float *samples,
                                         int32_t n)
{
  if (stream == NULL || samples == NULL || n <= 0)
    return;
  SherpaOnnxOnlineStreamAcceptWaveform (stream->stream, sample_rate, samples, n);
}

void
gjsify_sherpa_shim_online_stream_input_finished (GjsifySherpaShimOnlineStream *stream)
{
  if (stream != NULL)
    SherpaOnnxOnlineStreamInputFinished (stream->stream);
}

int32_t
gjsify_sherpa_shim_online_stream_is_ready (GjsifySherpaShimOnlineStream *stream)
{
  if (stream == NULL)
    return 0;
  return SherpaOnnxIsOnlineStreamReady (stream->recognizer, stream->stream);
}

int32_t
gjsify_sherpa_shim_online_stream_is_endpoint (GjsifySherpaShimOnlineStream *stream)
{
  if (stream == NULL)
    return 0;
  return SherpaOnnxOnlineStreamIsEndpoint (stream->recognizer, stream->stream);
}

void
gjsify_sherpa_shim_online_stream_decode (GjsifySherpaShimOnlineStream *stream)
{
  if (stream != NULL)
    SherpaOnnxDecodeOnlineStream (stream->recognizer, stream->stream);
}

void
gjsify_sherpa_shim_online_stream_reset (GjsifySherpaShimOnlineStream *stream)
{
  if (stream != NULL)
    SherpaOnnxOnlineStreamReset (stream->recognizer, stream->stream);
}

char *
gjsify_sherpa_shim_online_stream_text (GjsifySherpaShimOnlineStream *stream)
{
  const SherpaOnnxOnlineRecognizerResult *result;
  char *text;

  if (stream == NULL)
    return NULL;

  result = SherpaOnnxGetOnlineStreamResult (stream->recognizer, stream->stream);
  if (result == NULL)
    return NULL;

  text = g_strdup (result->text != NULL ? result->text : "");
  SherpaOnnxDestroyOnlineRecognizerResult (result);
  return text;
}

char *
gjsify_sherpa_shim_online_stream_json (GjsifySherpaShimOnlineStream *stream)
{
  const char *json;
  char *copy;

  if (stream == NULL)
    return NULL;

  json = SherpaOnnxGetOnlineStreamResultAsJson (stream->recognizer, stream->stream);
  if (json == NULL)
    return NULL;

  copy = g_strdup (json);
  SherpaOnnxDestroyOnlineStreamResultJson (json);
  return copy;
}

/* ------------------------------------------------------------------------- */
/* Offline recognizer                                                        */
/* ------------------------------------------------------------------------- */

struct _GjsifySherpaShimOffline
{
  const SherpaOnnxOfflineRecognizer *recognizer;
};

struct _GjsifySherpaShimOfflineStream
{
  const SherpaOnnxOfflineRecognizer *recognizer; /* borrowed from the owner */
  const SherpaOnnxOfflineStream *stream;
};

GjsifySherpaShimOffline *
gjsify_sherpa_shim_offline_open (const char *encoder,
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
                                 int32_t debug)
{
  SherpaOnnxOfflineRecognizerConfig config;
  const SherpaOnnxOfflineRecognizer *recognizer;
  GjsifySherpaShimOffline *self;

  if (encoder == NULL || decoder == NULL || joiner == NULL || tokens == NULL)
    return NULL;
  if (!transducer_files_present (encoder, decoder, joiner, tokens))
    return NULL;

  memset (&config, 0, sizeof (config));
  config.feat_config.sample_rate = sample_rate;
  config.feat_config.feature_dim = feature_dim;
  config.model_config.transducer.encoder = encoder;
  config.model_config.transducer.decoder = decoder;
  config.model_config.transducer.joiner = joiner;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = num_threads;
  config.model_config.provider = provider;
  config.model_config.model_type = model_type;
  config.model_config.debug = debug;
  config.decoding_method = decoding_method;
  config.max_active_paths = max_active_paths;
  config.hotwords_score = hotwords_score;
  config.blank_penalty = blank_penalty;

  recognizer = SherpaOnnxCreateOfflineRecognizer (&config);
  if (recognizer == NULL)
    return NULL;

  self = g_new0 (GjsifySherpaShimOffline, 1);
  self->recognizer = recognizer;
  return self;
}

void
gjsify_sherpa_shim_offline_close (GjsifySherpaShimOffline *recognizer)
{
  if (recognizer == NULL)
    return;
  SherpaOnnxDestroyOfflineRecognizer (recognizer->recognizer);
  g_free (recognizer);
}

GjsifySherpaShimOfflineStream *
gjsify_sherpa_shim_offline_stream_open (GjsifySherpaShimOffline *recognizer,
                                        const char *hotwords)
{
  const SherpaOnnxOfflineStream *stream;
  GjsifySherpaShimOfflineStream *self;

  if (recognizer == NULL)
    return NULL;

  stream = hotwords != NULL
             ? SherpaOnnxCreateOfflineStreamWithHotwords (recognizer->recognizer, hotwords)
             : SherpaOnnxCreateOfflineStream (recognizer->recognizer);
  if (stream == NULL)
    return NULL;

  self = g_new0 (GjsifySherpaShimOfflineStream, 1);
  self->recognizer = recognizer->recognizer;
  self->stream = stream;
  return self;
}

void
gjsify_sherpa_shim_offline_stream_close (GjsifySherpaShimOfflineStream *stream)
{
  if (stream == NULL)
    return;
  SherpaOnnxDestroyOfflineStream (stream->stream);
  g_free (stream);
}

void
gjsify_sherpa_shim_offline_stream_accept (GjsifySherpaShimOfflineStream *stream,
                                          int32_t sample_rate,
                                          const float *samples,
                                          int32_t n)
{
  if (stream == NULL || samples == NULL || n <= 0)
    return;
  SherpaOnnxAcceptWaveformOffline (stream->stream, sample_rate, samples, n);
}

void
gjsify_sherpa_shim_offline_stream_decode (GjsifySherpaShimOfflineStream *stream)
{
  if (stream != NULL)
    SherpaOnnxDecodeOfflineStream (stream->recognizer, stream->stream);
}

char *
gjsify_sherpa_shim_offline_stream_text (GjsifySherpaShimOfflineStream *stream)
{
  const SherpaOnnxOfflineRecognizerResult *result;
  char *text;

  if (stream == NULL)
    return NULL;

  result = SherpaOnnxGetOfflineStreamResult (stream->stream);
  if (result == NULL)
    return NULL;

  text = g_strdup (result->text != NULL ? result->text : "");
  SherpaOnnxDestroyOfflineRecognizerResult (result);
  return text;
}

char *
gjsify_sherpa_shim_offline_stream_json (GjsifySherpaShimOfflineStream *stream)
{
  const char *json;
  char *copy;

  if (stream == NULL)
    return NULL;

  json = SherpaOnnxGetOfflineStreamResultAsJson (stream->stream);
  if (json == NULL)
    return NULL;

  copy = g_strdup (json);
  SherpaOnnxDestroyOfflineStreamResultJson (json);
  return copy;
}
