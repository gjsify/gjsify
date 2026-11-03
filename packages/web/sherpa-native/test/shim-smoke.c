/*
 * shim-smoke.c — the engines are linked in and they answer.
 *
 * This is deliberately a MODEL-LESS test, because that is the only kind a CI
 * runner can have: the models are hundreds of megabytes under licences this
 * repo may not redistribute (ADR 0127 decision 14). What is still worth
 * asserting without one is most of what goes wrong in a build like this:
 *
 *   • the static onnxruntime is actually in the image and initialises — a
 *     version string proves the library linked rather than merely compiled;
 *   • a missing model is REFUSED BY PATH, not by segfault, which is the failure
 *     every user of this package will hit first;
 *   • repeating that refusal leaks nothing (valgrind, when it is present);
 *   • the VAD lifecycle is reachable, including the empty-queue answers that a
 *     caller's loop depends on before any audio arrives.
 *
 * Linked against the shim's OBJECTS rather than the shared library, so the
 * version script (which exists to hide exactly these engines) does not stand
 * between the test and what it measures.
 */

#include <glib.h>
#include <string.h>

#include "gjsify-sherpa-shim.h"

static void
test_versions (void)
{
    const char *sherpa = gjsify_sherpa_shim_version ();
    const char *ort = gjsify_sherpa_shim_onnxruntime_version ();

    /* Not an equality check against a hardcoded "2.0.1": the wrap file is the
     * statement of which revision this is, and duplicating it here would make
     * every bump touch two places. That it is non-empty is what proves the
     * library linked. */
    g_assert_nonnull (sherpa);
    g_assert_cmpuint (strlen (sherpa), >, 0);

    g_assert_nonnull (ort);
    g_assert_cmpuint (strlen (ort), >, 0);

    g_test_message ("sherpa-onnx %s, onnxruntime %s", sherpa, ort);
}

static void
test_file_exists (void)
{
    g_assert_cmpint (gjsify_sherpa_shim_file_exists ("/nonexistent/silero_vad.onnx"), ==, 0);

    /* Something that certainly exists, to show the function is not simply
     * answering 0 to everything — which is how a broken check would look. */
    g_assert_cmpint (gjsify_sherpa_shim_file_exists ("/proc/self/exe"), !=, 0);
}

static void
test_vad_missing_model (void)
{
    /* Twenty times, because the interesting part is that the refusal path frees
     * what it allocated: under valgrind (meson.build) a leak per attempt shows
     * up here, and a caller retrying a download is exactly this loop. */
    for (int i = 0; i < 20; i++) {
        GjsifySherpaShimVad *vad = gjsify_sherpa_shim_vad_open (
            "/nonexistent/silero_vad.onnx",
            0.5f, 0.3f, 0.25f, 20.0f, 512, 16000, 1, 30.0f, 0);
        g_assert_null (vad);
    }
}

static void
test_recognizer_missing_model (void)
{
    GjsifySherpaShimOnline *online = gjsify_sherpa_shim_online_open (
        "/nonexistent/encoder.onnx", "/nonexistent/decoder.onnx",
        "/nonexistent/joiner.onnx", "/nonexistent/tokens.txt",
        NULL, "cpu", 1, "greedy_search", 4, 1.5f, 0.0f,
        1, 2.4f, 1.2f, 20.0f, 16000, 80, 0);
    g_assert_null (online);

    GjsifySherpaShimOffline *offline = gjsify_sherpa_shim_offline_open (
        "/nonexistent/encoder.onnx", "/nonexistent/decoder.onnx",
        "/nonexistent/joiner.onnx", "/nonexistent/tokens.txt",
        NULL, "cpu", 1, "greedy_search", 4, 1.5f, 0.0f, 16000, 80, 0);
    g_assert_null (offline);
}

/*
 * The real VAD, when a model is available.
 *
 * Skipped rather than omitted: a leg that is simply not registered is a gap
 * nobody can see in a test report. GJSIFY_SHERPA_VAD_MODEL is how a developer
 * with `silero_vad.onnx` on disk — or the scheduled job that fetches one — runs
 * the part that needs weights.
 */
static void
test_vad_with_model (void)
{
    const char *model = g_getenv ("GJSIFY_SHERPA_VAD_MODEL");

    if (model == NULL || gjsify_sherpa_shim_file_exists (model) == 0) {
        g_test_skip ("set GJSIFY_SHERPA_VAD_MODEL to a silero_vad.onnx to run this");
        return;
    }

    GjsifySherpaShimVad *vad = gjsify_sherpa_shim_vad_open (
        model, 0.5f, 0.3f, 0.25f, 20.0f, 512, 16000, 1, 30.0f, 0);
    g_assert_nonnull (vad);

    /* Nothing fed yet: not in speech, and no completed segment queued. Both are
     * what a caller's loop asks before the first buffer arrives. */
    g_assert_cmpint (gjsify_sherpa_shim_vad_is_speech (vad), ==, 0);
    g_assert_cmpint (gjsify_sherpa_shim_vad_is_empty (vad), !=, 0);

    gint64 start = -1;
    g_assert_cmpint (gjsify_sherpa_shim_vad_peek (vad, &start), ==, -1);

    /* Two seconds of silence, handed over in a length that is NOT a multiple of
     * the 512-sample window — the detector buffers the remainder, and a capture
     * source's buffers do not line up with it either. */
    float *silence = g_new0 (float, 700);
    for (int i = 0; i < 46; i++) {
        gjsify_sherpa_shim_vad_accept (vad, silence, 700);
    }
    g_free (silence);

    /* Silence is not speech, and silence produces no segment. */
    g_assert_cmpint (gjsify_sherpa_shim_vad_is_speech (vad), ==, 0);
    g_assert_cmpint (gjsify_sherpa_shim_vad_is_empty (vad), !=, 0);

    gjsify_sherpa_shim_vad_reset (vad);
    gjsify_sherpa_shim_vad_close (vad);
}

int
main (int argc, char **argv)
{
    g_test_init (&argc, &argv, NULL);

    g_test_add_func ("/sherpa/versions", test_versions);
    g_test_add_func ("/sherpa/file-exists", test_file_exists);
    g_test_add_func ("/sherpa/vad/missing-model", test_vad_missing_model);
    g_test_add_func ("/sherpa/recognizer/missing-model", test_recognizer_missing_model);
    g_test_add_func ("/sherpa/vad/with-model", test_vad_with_model);

    return g_test_run ();
}
