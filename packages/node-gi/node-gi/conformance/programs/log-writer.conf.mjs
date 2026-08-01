// SPDX-License-Identifier: MIT
// GLib.log_set_writer_func parity — a JS GLogWriterFunc installed as the
// process structured-log writer receives real logs: the level flags plus the
// GLogField array as a plain object whose values are Uint8Arrays of the field
// bytes (gjs packs each field as a maybe-bytestring and hands the writer
// `{...stringFields.recursiveUnpack()}` — refs/gjs/libgjs-private/gjs-util.c
// gjs_log_writer_func_wrapper). HANDLED stops the default writer;
// log_set_writer_default() detaches the JS writer so later logs fall back.
// gjs is the gold standard — node / bun / deno must print byte-identical output.
//
// Determinism notes: the writer only records logs from its own domain (anything
// else is UNHANDLED → default writer → stderr, which the runner ignores), the
// key list is printed sorted, and the post-detach probe logs at LEVEL_MESSAGE
// (the default writer sends non-info/debug levels to stderr unconditionally, so
// stdout stays clean regardless of G_MESSAGES_DEBUG).
import GLib from 'gi://GLib?version=2.0';

const DOMAIN = 'node-gi-conf-writer';
const dec = new TextDecoder();
const records = [];

GLib.log_set_writer_func((level, fields) => {
    const domain = fields.GLIB_DOMAIN ? dec.decode(fields.GLIB_DOMAIN) : '';
    if (domain !== DOMAIN) return GLib.LogWriterOutput.UNHANDLED;
    records.push({ level, fields });
    return GLib.LogWriterOutput.HANDLED;
});

GLib.log_structured(DOMAIN, GLib.LogLevelFlags.LEVEL_MESSAGE, {
    MESSAGE: 'hello writer',
    MY_FIELD: 'custom-value',
});

print('records:', records.length);
const rec = records[0];
print('level is MESSAGE:', rec.level === GLib.LogLevelFlags.LEVEL_MESSAGE);
print('keys:', Object.keys(rec.fields).sort().join(','));
print(
    'all bytes:',
    Object.values(rec.fields).every((v) => v instanceof Uint8Array),
);
print('MESSAGE:', dec.decode(rec.fields.MESSAGE));
print('MY_FIELD:', dec.decode(rec.fields.MY_FIELD));
print('PRIORITY:', dec.decode(rec.fields.PRIORITY));

// Field packing flavours: a Uint8Array field and a GLib.Variant field also
// round-trip through log_structured → the writer.
GLib.log_structured(DOMAIN, GLib.LogLevelFlags.LEVEL_INFO, {
    MESSAGE: 'second',
    RAW: new TextEncoder().encode('raw-bytes'),
    WRAPPED: new GLib.Variant('s', 'variant-string'),
});
const rec2 = records[1];
print('second level is INFO:', rec2.level === GLib.LogLevelFlags.LEVEL_INFO);
print('RAW:', dec.decode(rec2.fields.RAW));
print('WRAPPED:', dec.decode(rec2.fields.WRAPPED));

// log_set_writer_default(): the JS writer is detached — the record count must
// not grow (the probe log goes to the default writer's stderr instead).
GLib.log_set_writer_default();
GLib.log_structured(DOMAIN, GLib.LogLevelFlags.LEVEL_MESSAGE, { MESSAGE: 'unseen' });
print('after default:', records.length);
