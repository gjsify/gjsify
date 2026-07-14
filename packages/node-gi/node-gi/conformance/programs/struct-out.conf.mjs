// SPDX-License-Identifier: MIT
// Struct / boxed OUT via headless GLib (no test typelib needed). Exercises phase-2.4
// compound OUT: a boxed struct returned as a handle and assembled into the return
// tuple, void-return + multiple int OUT params on a boxed instance, and the boxed
// handle round-tripping back into a method as an IN arg. The golden is the gjs
// output; node/bun/deno must match it byte-for-byte.
import GLib from 'gi://GLib?version=2.0';

// Boxed struct RETURN (GLib.TimeZone is a boxed type) → a method-routing handle.
const utc = GLib.TimeZone.new_utc();
print('tz id:', utc.get_identifier());

// Boxed struct RETURN (GLib.DateTime is boxed). 1136214245 = 2006-01-02 15:04:05 UTC.
const dt = GLib.DateTime.new_from_unix_utc(1136214245);
print('year:', dt.get_year());
print('month:', dt.get_month());
print('day:', dt.get_day_of_month());
print('hour:', dt.get_hour());

// void return + three int OUT params on the boxed instance → [y, m, d]. This is the
// compound OUT tuple: no return value, three OUT ints surfaced as an array.
print('ymd:', JSON.stringify(dt.get_ymd()));

// Boxed method returning a NEW boxed (chained struct OUT) + a boxed IN round-trip:
// add an hour, then diff the two boxed DateTimes (the older one passed back IN).
const dtPlus = dt.add_hours(1);
print('plus hour:', dtPlus.get_hour());
print('diff us:', dtPlus.difference(dt));

// Boxed RETURN that can be NULL is surfaced as null (not a dangling handle):
// an out-of-range unix time still yields a valid boxed handle here, so format it.
print('format:', dt.format('%Y-%m-%d %H:%M:%S'));
