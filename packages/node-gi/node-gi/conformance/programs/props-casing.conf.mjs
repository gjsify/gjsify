// SPDX-License-Identifier: MIT
// Property-access casing parity — camelCase and snake_case reads must resolve
// the same GObject property, and all three write paths (setter method,
// camelCase property write, snake_case property write) must agree. GJS accepts
// camelCase/snake_case for PROPERTY accessors and construct keys; METHODS stay
// snake_case (GJS does not alias methods — the gold standard rules here).
//
// GVariantType-typed property reads (Gio.SimpleAction.parameterType) are covered
// by the sibling program variant-type-prop.conf.mjs — node-gi now surfaces them as
// null (unset) / a GLib.VariantType (set) instead of throwing.
import Gio from 'gi://Gio?version=2.0';

const action = new Gio.SimpleAction({ name: 'demo', enabled: false });
print('name read:', action.name);
print('name typeof:', typeof action.name);
print('enabled initial:', action.enabled);
print('enabled via method:', action.get_enabled());

action.set_enabled(true);
print('after set_enabled(true):', action.enabled);
action.enabled = false;
print('after property write:', action.enabled, action.get_enabled());

// Multi-word property (SimpleAction's multi-word props are GVariantType-typed,
// see above — Gio.Application carries fundamental-typed ones): application-id
// (string) + inactivity-timeout (uint), constructed with a camelCase key.
const app = new Gio.Application({ applicationId: 'org.gjsify.NodeGiConformance' });
print('id camel read:', app.applicationId);
print('id snake read:', app.application_id);
print('timeout initial:', app.inactivityTimeout, app.inactivity_timeout);
app.inactivityTimeout = 5;
print('after camel write:', app.inactivity_timeout);
app.inactivity_timeout = 7;
print('after snake write:', app.inactivityTimeout);
app.set_inactivity_timeout(9);
print('after setter method:', app.inactivityTimeout);
