/* SPDX-License-Identifier: MIT
 *
 * Stub vapi: mozjs-140 is a C++-only dependency of the shim's .cc TUs.
 * Meson forwards every dependency() to valac as --pkg; this empty vapi
 * satisfies that lookup — no JSAPI is (or must ever be) reachable from Vala.
 */
