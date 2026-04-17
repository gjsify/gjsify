// GstStructure → W3C RTCStatsReport parser.
//
// webrtcbin's `get-stats` action signal returns a GstStructure where each
// field is a nested GstStructure containing one stats entry. Each entry
// has a `type` field (GstWebRTCStatsType enum), an `id` field, a `timestamp`
// field, plus type-specific fields in GStreamer snake_case naming.
//
// This module iterates the top-level fields, converts each nested structure
// to a W3C-compliant stats dictionary with camelCase keys.

import type Gst from 'gi://Gst?version=1.0';

import { gstToStatsType } from './gst-enum-maps.js';
import { RTCStatsReport, type RTCStats } from './rtc-stats-report.js';

/**
 * Convert a GStreamer snake_case field name to W3C camelCase.
 * Examples: `bytes-sent` → `bytesSent`, `packets-received` → `packetsReceived`
 */
function snakeToCamel(name: string): string {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Extract all fields from a GstStructure into a plain object.
 * GJS unboxes `get_value` for boxed/simple types directly — no
 * GObject.Value wrapper is returned for primitive types.
 */
function extractFields(structure: Gst.Structure): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const n = structure.n_fields();
    for (let i = 0; i < n; i++) {
        const fieldName = structure.nth_field_name(i);
        try {
            const value = structure.get_value(fieldName);
            result[fieldName] = value;
        } catch {
            // Some fields may not be extractable — skip silently
        }
    }
    return result;
}

/**
 * Parse a single stats entry (nested GstStructure) into a W3C RTCStats object.
 */
function parseStatsEntry(structure: Gst.Structure): RTCStats | null {
    const raw = extractFields(structure);

    // The `type` field is a GstWebRTCStatsType enum value
    const gstType = raw['type'];
    if (gstType == null) return null;
    const w3cType = gstToStatsType(Number(gstType));
    if (!w3cType) return null;

    const id = String(raw['id'] ?? structure.get_name() ?? '');
    // GStreamer provides timestamp in nanoseconds (pipeline clock).
    // Convert to milliseconds for W3C (performance.now()-relative).
    const tsRaw = raw['timestamp'];
    const timestamp = tsRaw != null ? Number(tsRaw) / 1_000_000 : performance.now();

    const stats: RTCStats = { type: w3cType, id, timestamp };

    // Copy remaining fields, converting snake_case → camelCase
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'type' || key === 'id' || key === 'timestamp') continue;
        const camelKey = snakeToCamel(key);
        stats[camelKey] = value;
    }

    return stats;
}

/**
 * Parse the top-level GstStructure returned by webrtcbin's `get-stats`
 * signal into a W3C RTCStatsReport.
 *
 * The top-level structure has one field per stats entry. Each field's value
 * is a nested GstStructure (GJS unboxes boxed types automatically).
 */
export function parseGstStats(reply: Gst.Structure | null): RTCStatsReport {
    if (!reply) return new RTCStatsReport();

    const entries: Array<[string, RTCStats]> = [];
    const n = reply.n_fields();

    for (let i = 0; i < n; i++) {
        const fieldName = reply.nth_field_name(i);
        try {
            const nested = reply.get_value(fieldName);
            // GJS unboxes the nested GstStructure directly
            if (nested && typeof (nested as any).n_fields === 'function') {
                const stats = parseStatsEntry(nested as unknown as Gst.Structure);
                if (stats) {
                    entries.push([stats.id, stats]);
                }
            }
        } catch {
            // Non-structure fields (e.g. metadata) — skip
        }
    }

    return new RTCStatsReport(entries);
}

/**
 * Filter an RTCStatsReport to entries relevant to a specific track identifier.
 * Used by RTCRtpSender.getStats() and RTCRtpReceiver.getStats() to return
 * only the stats associated with their track.
 */
export function filterStatsByTrackId(report: RTCStatsReport, trackId: string): RTCStatsReport {
    const entries: Array<[string, RTCStats]> = [];
    const relatedIds = new Set<string>();

    // First pass: find stats entries that reference this track
    for (const [id, stats] of report) {
        if (stats.trackIdentifier === trackId) {
            entries.push([id, stats]);
            relatedIds.add(id);
            // Collect referenced IDs (transportId, codecId, remoteId, etc.)
            for (const value of Object.values(stats)) {
                if (typeof value === 'string' && report.has(value)) {
                    relatedIds.add(value);
                }
            }
        }
    }

    // Second pass: include referenced stats (codec, transport, candidate-pair, etc.)
    for (const [id, stats] of report) {
        if (relatedIds.has(id) && !entries.some(([entryId]) => entryId === id)) {
            entries.push([id, stats]);
        }
    }

    return new RTCStatsReport(entries);
}
