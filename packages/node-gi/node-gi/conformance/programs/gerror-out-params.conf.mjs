// SPDX-License-Identifier: MIT
// GError-typed OUT / INOUT / IN parameters (`GI_TYPE_TAG_ERROR`, #1495) — the
// direction half of the GError contract; error-matches.conf.mjs covers the
// implicit `throws=1` one. GLib only, so it runs on every runtime.
//
// The numeric GQuark is deliberately NOT printed: it depends on how many quarks
// the process interned first, so it is a value, not a fact. matches() carries the
// domain instead — and carries it as a DISCRIMINATOR (a wrong code and a wrong
// domain must both be false), because a stub answering true would satisfy the
// positive case alone.
import GLib from 'gi://GLib?version=2.0';

const DOMAIN = GLib.quark_from_string('node-gi-conf-gerror');
const OTHER = GLib.quark_from_string('node-gi-conf-gerror-other');

// void return + one (transfer full) GError OUT → the error, bare.
const err = GLib.set_error_literal(DOMAIN, 7, 'boom');
print('OUT is null:', err === null);
print('message:', err.message);
print('code:', err.code);
print('matches(domain, 7):', err.matches(DOMAIN, 7));
print('matches(domain, 8):', err.matches(DOMAIN, 8));
print('matches(other, 7):', err.matches(OTHER, 7));

// (transfer full) GError IN — g_propagate_error adopts `src`, so the binding owes
// the callee an independent copy and the source stays readable here.
const propagated = GLib.propagate_error(err);
print('propagated message:', propagated.message);
print('propagated code:', propagated.code);
print('propagated matches(domain, 7):', propagated.matches(DOMAIN, 7));
print('source still readable:', err.message);

// INOUT — the callee reads the slot it was handed and writes the rewritten error back.
const prefixed = GLib.prefix_error_literal(propagated, 'context: ');
print('prefixed message:', prefixed.message);
print('prefixed code:', prefixed.code);
print('inout source untouched:', propagated.message);

// A GError an application BUILT, handed back into an IN arg. On gjs there is one
// GLib.Error object and this is the same path as above; node-gi has two shapes
// (the L1 JS class here, a boxed handle above) and this is the one an application
// actually holds after a `catch`. `instanceof` is deliberately not printed — that
// IS the divergence still open (status/open-todos.md), and a golden asserting it
// would freeze the wrong side.
const built = new GLib.Error(DOMAIN, 9, 'constructed');
const rebuilt = GLib.propagate_error(built);
print('constructed message:', rebuilt.message);
print('constructed code:', rebuilt.code);
print('constructed matches(domain, 9):', rebuilt.matches(DOMAIN, 9));
print('constructed matches(other, 9):', rebuilt.matches(OTHER, 9));
