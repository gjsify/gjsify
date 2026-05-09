/*
 * Tiny C shim around libnghttp2's HPACK encoder + frame helpers.
 * See nghttp2-helpers.h for the rationale + per-function docs.
 */

#include "nghttp2-helpers.h"

#include <string.h>
#include <stdlib.h>

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
