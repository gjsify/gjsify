/*
 * Tiny C shim around libnghttp2's HPACK encoder + frame helpers + session API.
 * See nghttp2-helpers.h for the rationale + per-function docs.
 */

#include "nghttp2-helpers.h"

#include <string.h>
#include <stdlib.h>

/* ────────────────────────────────────────────────────────────────────── *
 * HPACK + standalone frame builders                                      *
 * ────────────────────────────────────────────────────────────────────── */

GBytes *
gjsify_http2_hpack_encode (char **names,
                           char **values,
                           gsize  n_pairs)
{
    if (n_pairs == 0) {
        return g_bytes_new (NULL, 0);
    }
    if (names == NULL || values == NULL) {
        return NULL;
    }

    nghttp2_nv *nva = g_new0 (nghttp2_nv, n_pairs);
    for (gsize i = 0; i < n_pairs; i++) {
        const char *n = names[i] ? names[i] : "";
        const char *v = values[i] ? values[i] : "";
        nva[i].name     = (uint8_t *) n;
        nva[i].value    = (uint8_t *) v;
        nva[i].namelen  = strlen (n);
        nva[i].valuelen = strlen (v);
        nva[i].flags    = NGHTTP2_NV_FLAG_NONE;
    }

    nghttp2_hd_deflater *def = NULL;
    int rv = nghttp2_hd_deflate_new (&def, 4096);
    if (rv != 0 || def == NULL) {
        g_free (nva);
        return NULL;
    }

    size_t bound = nghttp2_hd_deflate_bound (def, nva, n_pairs);
    guint8 *buf = g_malloc (bound);
    ssize_t produced = nghttp2_hd_deflate_hd (def, buf, bound, nva, n_pairs);

    nghttp2_hd_deflate_del (def);
    g_free (nva);

    if (produced < 0) {
        g_free (buf);
        return NULL;
    }

    /* GBytes takes ownership of buf via g_free destroy notify. */
    return g_bytes_new_with_free_func (buf, (gsize) produced, g_free, buf);
}

GBytes *
gjsify_http2_pack_frame (guint8   type,
                         guint8   flags,
                         guint32  stream_id,
                         GBytes  *payload)
{
    gsize plen = 0;
    const guint8 *pdata = payload ? g_bytes_get_data (payload, &plen) : NULL;

    /* Frame header is 9 bytes:
     *   length    : 24-bit big-endian
     *   type      : 8-bit
     *   flags     : 8-bit
     *   stream_id : 31-bit big-endian (high bit reserved, must be 0)
     */
    gsize total = 9 + plen;
    guint8 *buf = g_malloc (total);

    buf[0] = (guint8) ((plen >> 16) & 0xff);
    buf[1] = (guint8) ((plen >>  8) & 0xff);
    buf[2] = (guint8) ((plen      ) & 0xff);
    buf[3] = type;
    buf[4] = flags;

    guint32 sid = stream_id & 0x7fffffffu;
    buf[5] = (guint8) ((sid >> 24) & 0xff);
    buf[6] = (guint8) ((sid >> 16) & 0xff);
    buf[7] = (guint8) ((sid >>  8) & 0xff);
    buf[8] = (guint8) ((sid      ) & 0xff);

    if (plen > 0 && pdata != NULL) {
        memcpy (buf + 9, pdata, plen);
    }

    return g_bytes_new_with_free_func (buf, total, g_free, buf);
}

GBytes *
gjsify_http2_pack_push_promise (guint32  associated_stream_id,
                                guint32  promised_stream_id,
                                GBytes  *header_block)
{
    gsize hlen = 0;
    const guint8 *hdata = header_block ? g_bytes_get_data (header_block, &hlen) : NULL;

    /* PUSH_PROMISE payload = 4-byte promised-stream-id (R + 31-bit id)
     *                        || HPACK header block. */
    gsize plen = 4 + hlen;
    guint8 *payload = g_malloc (plen);

    guint32 pid = promised_stream_id & 0x7fffffffu;
    payload[0] = (guint8) ((pid >> 24) & 0xff);
    payload[1] = (guint8) ((pid >> 16) & 0xff);
    payload[2] = (guint8) ((pid >>  8) & 0xff);
    payload[3] = (guint8) ((pid      ) & 0xff);

    if (hlen > 0 && hdata != NULL) {
        memcpy (payload + 4, hdata, hlen);
    }

    GBytes *payload_bytes = g_bytes_new_with_free_func (payload, plen, g_free, payload);
    GBytes *frame = gjsify_http2_pack_frame (
        NGHTTP2_PUSH_PROMISE,
        NGHTTP2_FLAG_END_HEADERS,
        associated_stream_id,
        payload_bytes
    );
    g_bytes_unref (payload_bytes);
    return frame;
}

const char *
gjsify_http2_nghttp2_version (void)
{
    nghttp2_info *info = nghttp2_version (0);
    return info ? info->version_str : "unknown";
}

/* ────────────────────────────────────────────────────────────────────── *
 * Session API                                                            *
 * ────────────────────────────────────────────────────────────────────── */

/* Full struct layout for the opaque GjsifyHttp2Event (forward-declared
 * in nghttp2-helpers.h). Vala emits its own forward declaration with
 * the matching tag (`struct _GjsifyHttp2Event`) and never tries to
 * inspect the fields — every access goes through the getter functions
 * below. */
struct _GjsifyHttp2Event {
    GjsifyHttp2EventKind kind;
    guint32              stream_id;
    guint32              error_code;
    guint32              last_stream_id;
    gboolean             end_stream;
    char               **headers_names;
    char               **headers_values;
    gsize                headers_count;
    GBytes              *data;
    guint32              promised_stream_id;
};

/* Per-stream HEADERS accumulator. We hold names/values in two GPtrArrays
 * (auto-NULL-terminated, plain `char*` ownership) until the HEADERS frame
 * finishes (on_frame_recv with type==HEADERS) — only then do we emit the
 * EVENT_HEADERS event so JS sees the complete pseudo-header set in one
 * call. Without this, partial header arrival could leak through on_header
 * if nghttp2 ever spreads HEADERS+CONTINUATION across multiple recv()s. */
typedef struct {
    GPtrArray *names;   /* owns each entry via g_free */
    GPtrArray *values;  /* owns each entry via g_free */
} StreamHeaderAccum;

static StreamHeaderAccum *
stream_header_accum_new (void)
{
    StreamHeaderAccum *a = g_new0 (StreamHeaderAccum, 1);
    a->names  = g_ptr_array_new_with_free_func (g_free);
    a->values = g_ptr_array_new_with_free_func (g_free);
    return a;
}

static void
stream_header_accum_free (gpointer p)
{
    StreamHeaderAccum *a = p;
    if (!a) return;
    g_ptr_array_unref (a->names);
    g_ptr_array_unref (a->values);
    g_free (a);
}

/* Outgoing-DATA carrier — backs nghttp2_data_provider.
 * We hold a GBytes per pending DATA submit and feed it through the
 * data_source_read_callback. The carrier is destroyed once nghttp2
 * signals the frame's full transmission via on_frame_send. */
typedef struct {
    GBytes  *bytes;
    gsize    offset;
    gboolean end_stream;
} DataSourceCarrier;

static DataSourceCarrier *
data_source_carrier_new (GBytes *bytes, gboolean end_stream)
{
    DataSourceCarrier *c = g_new0 (DataSourceCarrier, 1);
    c->bytes      = bytes ? g_bytes_ref (bytes) : g_bytes_new (NULL, 0);
    c->offset     = 0;
    c->end_stream = end_stream;
    return c;
}

static void
data_source_carrier_free (gpointer p)
{
    DataSourceCarrier *c = p;
    if (!c) return;
    if (c->bytes) g_bytes_unref (c->bytes);
    g_free (c);
}

struct _GjsifyHttp2Session {
    nghttp2_session *session;
    GjsifyHttp2SessionMode mode;

    /* stream_id (gpointer key) -> StreamHeaderAccum */
    GHashTable *header_accumulators;

    /* stream_id (gpointer key) -> DataSourceCarrier (only while a DATA
     * provider is active for that stream). */
    GHashTable *data_carriers;

    /* GQueue<GjsifyHttp2Event*> — drained on demand. */
    GQueue *events;
};

/* ── helpers ─────────────────────────────────────────────────────────── */

static void
push_event (GjsifyHttp2Session *self, GjsifyHttp2Event *ev)
{
    g_queue_push_tail (self->events, ev);
}

static StreamHeaderAccum *
accum_get_or_create (GjsifyHttp2Session *self, guint32 stream_id)
{
    StreamHeaderAccum *a = g_hash_table_lookup (self->header_accumulators,
                                                GUINT_TO_POINTER (stream_id));
    if (!a) {
        a = stream_header_accum_new ();
        g_hash_table_insert (self->header_accumulators,
                             GUINT_TO_POINTER (stream_id), a);
    }
    return a;
}

/* Move accumulated headers into a freshly-allocated NULL-terminated
 * C-string array. Caller owns the returned array AND each string
 * (g_strfreev frees both correctly). */
static void
accum_take_headers (StreamHeaderAccum *a,
                    char            ***out_names,
                    char            ***out_values,
                    gsize             *out_n)
{
    gsize n = a->names->len;
    char **names  = g_new0 (char *, n + 1);
    char **values = g_new0 (char *, n + 1);
    for (gsize i = 0; i < n; i++) {
        names[i]  = g_strdup ((const char *) g_ptr_array_index (a->names,  i));
        values[i] = g_strdup ((const char *) g_ptr_array_index (a->values, i));
    }
    *out_names  = names;
    *out_values = values;
    *out_n      = n;
}

/* ── nghttp2 callbacks ───────────────────────────────────────────────── */

/* For HEADERS, the headers belong to frame->hd.stream_id. For PUSH_PROMISE,
 * they describe the resource on the PROMISED stream id (the parent stream
 * id is the request the push is associated with). Keep one accumulator per
 * logical stream so PUSH_PROMISE-on-the-client surfaces a complete header
 * set keyed by the promised id. */
static guint32
accum_key_for_frame (const nghttp2_frame *frame)
{
    if (frame->hd.type == NGHTTP2_PUSH_PROMISE) {
        return (guint32) frame->push_promise.promised_stream_id;
    }
    return (guint32) frame->hd.stream_id;
}

static int
on_begin_headers_cb (nghttp2_session *session,
                     const nghttp2_frame *frame,
                     void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;
    guint32 key = accum_key_for_frame (frame);
    /* Reset/create accumulator for the logical stream. Closing+reopening
     * the same id is illegal in HTTP/2, so destroy-then-create is safe. */
    g_hash_table_remove (self->header_accumulators, GUINT_TO_POINTER (key));
    accum_get_or_create (self, key);
    return 0;
}

static int
on_header_cb (nghttp2_session *session,
              const nghttp2_frame *frame,
              const uint8_t *name, size_t namelen,
              const uint8_t *value, size_t valuelen,
              uint8_t flags,
              void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;
    (void) flags;
    guint32 key = accum_key_for_frame (frame);
    StreamHeaderAccum *a = accum_get_or_create (self, key);
    /* g_ptr_array owns via g_free — store NUL-terminated copies. */
    g_ptr_array_add (a->names,  g_strndup ((const char *) name,  namelen));
    g_ptr_array_add (a->values, g_strndup ((const char *) value, valuelen));
    return 0;
}

static int
on_frame_recv_cb (nghttp2_session *session,
                  const nghttp2_frame *frame,
                  void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;

    switch (frame->hd.type) {
    case NGHTTP2_HEADERS: {
        StreamHeaderAccum *a = g_hash_table_lookup (self->header_accumulators,
                                                    GUINT_TO_POINTER (frame->hd.stream_id));
        if (!a) return 0;
        GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
        ev->kind       = GJSIFY_HTTP2_EVENT_HEADERS;
        ev->stream_id  = frame->hd.stream_id;
        ev->end_stream = (frame->hd.flags & NGHTTP2_FLAG_END_STREAM) != 0;
        accum_take_headers (a, &ev->headers_names, &ev->headers_values, &ev->headers_count);
        /* Once consumed, drop the accumulator. */
        g_hash_table_remove (self->header_accumulators,
                             GUINT_TO_POINTER (frame->hd.stream_id));
        push_event (self, ev);
        break;
    }

    case NGHTTP2_DATA: {
        /* DATA chunks are surfaced via on_data_chunk_recv; here we only
         * need to notice END_STREAM on a frame carrying no chunks. */
        if (frame->hd.flags & NGHTTP2_FLAG_END_STREAM) {
            GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
            ev->kind       = GJSIFY_HTTP2_EVENT_DATA;
            ev->stream_id  = frame->hd.stream_id;
            ev->end_stream = TRUE;
            ev->data       = g_bytes_new (NULL, 0);
            push_event (self, ev);
        }
        break;
    }

    case NGHTTP2_SETTINGS: {
        if (!(frame->hd.flags & NGHTTP2_FLAG_ACK)) {
            GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
            ev->kind = GJSIFY_HTTP2_EVENT_SETTINGS;
            push_event (self, ev);
        }
        break;
    }

    case NGHTTP2_GOAWAY: {
        GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
        ev->kind           = GJSIFY_HTTP2_EVENT_GOAWAY;
        ev->error_code     = frame->goaway.error_code;
        ev->last_stream_id = frame->goaway.last_stream_id;
        push_event (self, ev);
        break;
    }

    case NGHTTP2_PUSH_PROMISE: {
        /* Client-side: a push promise arrived. Headers were already
         * accumulated by the begin/on_header callbacks for the PROMISED
         * stream id (frame->push_promise.promised_stream_id). */
        guint32 promised = frame->push_promise.promised_stream_id;
        StreamHeaderAccum *a = g_hash_table_lookup (self->header_accumulators,
                                                    GUINT_TO_POINTER (promised));
        if (a) {
            GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
            ev->kind               = GJSIFY_HTTP2_EVENT_PUSH_PROMISE;
            ev->stream_id          = frame->hd.stream_id;
            ev->promised_stream_id = promised;
            accum_take_headers (a, &ev->headers_names, &ev->headers_values, &ev->headers_count);
            g_hash_table_remove (self->header_accumulators,
                                 GUINT_TO_POINTER (promised));
            push_event (self, ev);
        }
        break;
    }

    default:
        break;
    }

    return 0;
}

static int
on_data_chunk_recv_cb (nghttp2_session *session,
                       uint8_t flags,
                       int32_t stream_id,
                       const uint8_t *data, size_t len,
                       void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;
    (void) flags;

    GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
    ev->kind       = GJSIFY_HTTP2_EVENT_DATA;
    ev->stream_id  = (guint32) stream_id;
    ev->end_stream = FALSE;   /* END_STREAM is reported via on_frame_recv */
    ev->data       = g_bytes_new (data, len);
    push_event (self, ev);
    return 0;
}

static int
on_stream_close_cb (nghttp2_session *session,
                    int32_t stream_id,
                    uint32_t error_code,
                    void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;

    GjsifyHttp2Event *ev = g_new0 (GjsifyHttp2Event, 1);
    ev->kind       = GJSIFY_HTTP2_EVENT_STREAM_CLOSED;
    ev->stream_id  = (guint32) stream_id;
    ev->error_code = error_code;
    push_event (self, ev);

    /* Drop any leftover state for this stream. */
    g_hash_table_remove (self->header_accumulators,
                         GUINT_TO_POINTER ((guint32) stream_id));
    g_hash_table_remove (self->data_carriers,
                         GUINT_TO_POINTER ((guint32) stream_id));
    return 0;
}

/* DATA provider — feeds bytes from the carrier we attached for this
 * stream id. We look the carrier up by stream_id in self->data_carriers
 * (not via source.ptr) so submit_data() can replace the carrier mid-
 * stream without touching nghttp2's data_provider struct. */
static ssize_t
data_source_read_cb (nghttp2_session *session,
                     int32_t stream_id,
                     uint8_t *buf, size_t length,
                     uint32_t *data_flags,
                     nghttp2_data_source *source,
                     void *user_data)
{
    (void) session;
    (void) source;
    GjsifyHttp2Session *self = user_data;

    DataSourceCarrier *c = g_hash_table_lookup (self->data_carriers,
                                                GUINT_TO_POINTER ((guint32) stream_id));
    if (!c || !c->bytes) {
        /* No data queued yet — defer. nghttp2 will pause this stream's
         * DATA emission and resume on nghttp2_session_resume_data(). */
        return NGHTTP2_ERR_DEFERRED;
    }

    gsize total = 0;
    const guint8 *base = g_bytes_get_data (c->bytes, &total);
    gsize remaining = total - c->offset;
    gsize chunk = remaining < length ? remaining : length;
    if (chunk > 0) memcpy (buf, base + c->offset, chunk);
    c->offset += chunk;

    if (c->offset >= total) {
        if (c->end_stream) {
            *data_flags |= NGHTTP2_DATA_FLAG_EOF;
        } else {
            /* Buffer drained but not the last chunk — defer until the
             * next submit_data() replaces the carrier. */
            return chunk > 0 ? (ssize_t) chunk : NGHTTP2_ERR_DEFERRED;
        }
    }
    return (ssize_t) chunk;
}

/* When nghttp2 finishes transmitting a DATA frame whose source is one of
 * our carriers AND it was the last (EOF reached), drop the carrier. */
static int
on_frame_send_cb (nghttp2_session *session,
                  const nghttp2_frame *frame,
                  void *user_data)
{
    GjsifyHttp2Session *self = user_data;
    (void) session;
    if (frame->hd.type != NGHTTP2_DATA) return 0;
    DataSourceCarrier *c = g_hash_table_lookup (self->data_carriers,
                                                GUINT_TO_POINTER (frame->hd.stream_id));
    if (!c) return 0;
    gsize total = 0;
    g_bytes_get_data (c->bytes, &total);
    if (c->offset >= total) {
        g_hash_table_remove (self->data_carriers,
                             GUINT_TO_POINTER (frame->hd.stream_id));
    }
    return 0;
}

/* ── construction / destruction ──────────────────────────────────────── */

static int
configure_callbacks (nghttp2_session_callbacks *cb)
{
    nghttp2_session_callbacks_set_on_frame_recv_callback     (cb, on_frame_recv_cb);
    nghttp2_session_callbacks_set_on_data_chunk_recv_callback (cb, on_data_chunk_recv_cb);
    nghttp2_session_callbacks_set_on_stream_close_callback    (cb, on_stream_close_cb);
    nghttp2_session_callbacks_set_on_header_callback          (cb, on_header_cb);
    nghttp2_session_callbacks_set_on_begin_headers_callback   (cb, on_begin_headers_cb);
    nghttp2_session_callbacks_set_on_frame_send_callback      (cb, on_frame_send_cb);
    return 0;
}

GjsifyHttp2Session *
gjsify_http2_session_new (GjsifyHttp2SessionMode mode)
{
    GjsifyHttp2Session *self = g_new0 (GjsifyHttp2Session, 1);
    self->mode = mode;
    self->header_accumulators = g_hash_table_new_full (
        g_direct_hash, g_direct_equal, NULL, stream_header_accum_free);
    self->data_carriers = g_hash_table_new_full (
        g_direct_hash, g_direct_equal, NULL, data_source_carrier_free);
    self->events = g_queue_new ();

    nghttp2_session_callbacks *cb = NULL;
    if (nghttp2_session_callbacks_new (&cb) != 0 || cb == NULL) {
        gjsify_http2_session_free (self);
        return NULL;
    }
    configure_callbacks (cb);

    int rv;
    if (mode == GJSIFY_HTTP2_SESSION_MODE_SERVER) {
        rv = nghttp2_session_server_new (&self->session, cb, self);
    } else {
        rv = nghttp2_session_client_new (&self->session, cb, self);
    }
    nghttp2_session_callbacks_del (cb);

    if (rv != 0 || self->session == NULL) {
        gjsify_http2_session_free (self);
        return NULL;
    }
    return self;
}

void
gjsify_http2_session_free (GjsifyHttp2Session *self)
{
    if (!self) return;
    if (self->session) nghttp2_session_del (self->session);
    if (self->header_accumulators) g_hash_table_destroy (self->header_accumulators);
    if (self->data_carriers)       g_hash_table_destroy (self->data_carriers);
    if (self->events) {
        GjsifyHttp2Event *ev;
        while ((ev = g_queue_pop_head (self->events)) != NULL) {
            gjsify_http2_event_free (ev);
        }
        g_queue_free (self->events);
    }
    g_free (self);
}

void
gjsify_http2_event_free (GjsifyHttp2Event *event)
{
    if (!event) return;
    if (event->headers_names)  g_strfreev (event->headers_names);
    if (event->headers_values) g_strfreev (event->headers_values);
    if (event->data)           g_bytes_unref (event->data);
    g_free (event);
}

/* ── Event getters (see header for ownership rules) ─────────────────── */

guint32      gjsify_http2_event_get_kind               (GjsifyHttp2Event *e) { return e ? (guint32) e->kind : 0; }
guint32      gjsify_http2_event_get_stream_id          (GjsifyHttp2Event *e) { return e ? e->stream_id : 0; }
guint32      gjsify_http2_event_get_error_code         (GjsifyHttp2Event *e) { return e ? e->error_code : 0; }
guint32      gjsify_http2_event_get_last_stream_id     (GjsifyHttp2Event *e) { return e ? e->last_stream_id : 0; }
gboolean     gjsify_http2_event_get_end_stream         (GjsifyHttp2Event *e) { return e ? e->end_stream : FALSE; }
guint32      gjsify_http2_event_get_promised_stream_id (GjsifyHttp2Event *e) { return e ? e->promised_stream_id : 0; }
gsize        gjsify_http2_event_get_header_count       (GjsifyHttp2Event *e) { return e ? e->headers_count : 0; }

const char *
gjsify_http2_event_get_header_name (GjsifyHttp2Event *e, gsize index)
{
    if (!e || !e->headers_names || index >= e->headers_count) return NULL;
    return e->headers_names[index];
}

const char *
gjsify_http2_event_get_header_value (GjsifyHttp2Event *e, gsize index)
{
    if (!e || !e->headers_values || index >= e->headers_count) return NULL;
    return e->headers_values[index];
}

GBytes *
gjsify_http2_event_get_data (GjsifyHttp2Event *e)
{
    return e ? e->data : NULL;
}

/* ── I/O ─────────────────────────────────────────────────────────────── */

gssize
gjsify_http2_session_feed (GjsifyHttp2Session *self, GBytes *input)
{
    if (!self || !self->session) return -1;
    gsize len = 0;
    const guint8 *data = input ? g_bytes_get_data (input, &len) : NULL;
    if (len == 0) return 0;
    ssize_t rv = nghttp2_session_mem_recv (self->session, data, len);
    return (gssize) rv;
}

GBytes *
gjsify_http2_session_drain_output (GjsifyHttp2Session *self)
{
    if (!self || !self->session) return g_bytes_new (NULL, 0);

    GByteArray *accum = g_byte_array_new ();
    const uint8_t *chunk = NULL;
    ssize_t rv;
    while ((rv = nghttp2_session_mem_send (self->session, &chunk)) > 0) {
        g_byte_array_append (accum, chunk, (guint) rv);
    }
    /* rv < 0 indicates an error; we still return whatever we collected
     * so the caller can flush before tearing down. */

    return g_byte_array_free_to_bytes (accum);
}

GjsifyHttp2Event **
gjsify_http2_session_drain_events (GjsifyHttp2Session *self, gsize *out_n)
{
    if (!self) {
        if (out_n) *out_n = 0;
        return NULL;
    }
    gsize n = g_queue_get_length (self->events);
    if (out_n) *out_n = n;
    if (n == 0) return NULL;

    GjsifyHttp2Event **arr = g_new0 (GjsifyHttp2Event *, n + 1);
    for (gsize i = 0; i < n; i++) {
        arr[i] = g_queue_pop_head (self->events);
    }
    arr[n] = NULL;
    return arr;
}

/* ── submits ─────────────────────────────────────────────────────────── */

int
gjsify_http2_session_submit_settings (GjsifyHttp2Session *self)
{
    if (!self || !self->session) return -1;
    /* Default-shaped SETTINGS: no entries. nghttp2 sends the empty frame
     * which the peer ACKs; that's sufficient for handshake completion. */
    return nghttp2_submit_settings (self->session, NGHTTP2_FLAG_NONE, NULL, 0);
}

static void
fill_nva (nghttp2_nv *nva,
          char      **names,
          char      **values,
          gsize       n_pairs)
{
    for (gsize i = 0; i < n_pairs; i++) {
        const char *n = names[i] ? names[i] : "";
        const char *v = values[i] ? values[i] : "";
        nva[i].name     = (uint8_t *) n;
        nva[i].value    = (uint8_t *) v;
        nva[i].namelen  = strlen (n);
        nva[i].valuelen = strlen (v);
        nva[i].flags    = NGHTTP2_NV_FLAG_NONE;
    }
}

int
gjsify_http2_session_submit_response (GjsifyHttp2Session *self,
                                      guint32             stream_id,
                                      char              **names,
                                      char              **values,
                                      gsize               n_pairs,
                                      gboolean            end_stream)
{
    if (!self || !self->session) return -1;
    if (!names || !values) return -1;

    nghttp2_nv *nva = g_new0 (nghttp2_nv, n_pairs);
    fill_nva (nva, names, values, n_pairs);

    nghttp2_data_provider *prdp = NULL;
    nghttp2_data_provider  prd;
    if (!end_stream) {
        /* Caller will follow up with submit_data(). We do NOT pre-create
         * a carrier — the data_source_read_cb returns NGHTTP2_ERR_DEFERRED
         * until submit_data() replaces the entry, at which point
         * nghttp2_session_resume_data() unblocks the stream. */
        memset (&prd, 0, sizeof (prd));
        prd.source.ptr   = NULL;
        prd.read_callback = data_source_read_cb;
        prdp = &prd;
    }

    int rv = nghttp2_submit_response (self->session, (int32_t) stream_id,
                                      nva, n_pairs, prdp);
    g_free (nva);
    return rv;
}

guint32
gjsify_http2_session_submit_request (GjsifyHttp2Session *self,
                                     char              **names,
                                     char              **values,
                                     gsize               n_pairs,
                                     gboolean            end_stream)
{
    if (!self || !self->session) return 0;
    if (!names || !values) return 0;

    nghttp2_nv *nva = g_new0 (nghttp2_nv, n_pairs);
    fill_nva (nva, names, values, n_pairs);

    nghttp2_data_provider *prdp = NULL;
    nghttp2_data_provider  prd;
    if (!end_stream) {
        memset (&prd, 0, sizeof (prd));
        prd.source.ptr = NULL;
        prd.read_callback = data_source_read_cb;
        prdp = &prd;
    }

    int32_t sid = nghttp2_submit_request (self->session, NULL,
                                          nva, n_pairs, prdp, NULL);
    g_free (nva);
    if (sid < 0) return 0;
    /* No pre-created carrier — submit_data() will lazily attach. */
    return (guint32) sid;
}

int
gjsify_http2_session_submit_data (GjsifyHttp2Session *self,
                                  guint32             stream_id,
                                  GBytes             *data,
                                  gboolean            end_stream)
{
    if (!self || !self->session) return -1;

    DataSourceCarrier *c = data_source_carrier_new (data, end_stream);
    /* Replace any existing (empty) carrier from submit_response. */
    g_hash_table_replace (self->data_carriers,
                          GUINT_TO_POINTER (stream_id), c);

    /* Resume sending after replacing the data source. nghttp2 supports
     * resume_data only AFTER a previous submit_response set a deferred
     * provider; calling it on a stream with no provider is harmless. */
    nghttp2_session_resume_data (self->session, (int32_t) stream_id);
    return 0;
}

guint32
gjsify_http2_session_submit_push_promise (GjsifyHttp2Session *self,
                                          guint32             parent_id,
                                          char              **names,
                                          char              **values,
                                          gsize               n_pairs)
{
    if (!self || !self->session) return 0;
    if (!names || !values) return 0;

    nghttp2_nv *nva = g_new0 (nghttp2_nv, n_pairs);
    fill_nva (nva, names, values, n_pairs);

    int rv = nghttp2_submit_push_promise (self->session,
                                          NGHTTP2_FLAG_NONE,
                                          (int32_t) parent_id,
                                          nva, n_pairs,
                                          NULL);
    g_free (nva);
    if (rv < 0) return 0;
    return (guint32) rv;
}

int
gjsify_http2_session_submit_goaway (GjsifyHttp2Session *self,
                                    guint32             last_stream_id,
                                    guint32             error_code)
{
    if (!self || !self->session) return -1;
    return nghttp2_submit_goaway (self->session,
                                  NGHTTP2_FLAG_NONE,
                                  (int32_t) last_stream_id,
                                  error_code,
                                  NULL, 0);
}

int
gjsify_http2_session_submit_rst_stream (GjsifyHttp2Session *self,
                                        guint32             stream_id,
                                        guint32             error_code)
{
    if (!self || !self->session) return -1;
    return nghttp2_submit_rst_stream (self->session,
                                      NGHTTP2_FLAG_NONE,
                                      (int32_t) stream_id,
                                      error_code);
}

gboolean
gjsify_http2_session_want_read (GjsifyHttp2Session *self)
{
    if (!self || !self->session) return FALSE;
    return nghttp2_session_want_read (self->session) != 0;
}

gboolean
gjsify_http2_session_want_write (GjsifyHttp2Session *self)
{
    if (!self || !self->session) return FALSE;
    return nghttp2_session_want_write (self->session) != 0;
}
