// SPDX-License-Identifier: MIT
// Browser-target conformance spec for @gjsify/domain.
//
// Imports the package's OWN entry directly (`./index.js`) — `domain` is a
// pure-TS deprecated no-op shim over EventEmitter, so the same file the bundler
// picks under `gjsify build --app browser` is portable. It must NOT re-export
// `./test.mjs` (that drags in `@gjsify/node-globals` register side-effects with
// no browser equivalent) and must NOT import `@gjsify/domain`.
//
// Asserts the deprecated no-op API surface: create() / createDomain() build a
// Domain, domain.run(fn) executes fn and returns its value, and
// add/remove/bind/intercept/enter/exit/dispose exist and do not throw.

import { describe, it, expect } from '@gjsify/unit';
import { create, createDomain, Domain } from './index.js';

export default async () => {
    await describe('domain (browser)', async () => {
        // ==================== factory surface ====================
        await describe('factory surface', async () => {
            await it('should export create and createDomain as functions', async () => {
                expect(typeof create).toBe('function');
                expect(typeof createDomain).toBe('function');
                expect(createDomain).toBe(create);
            });

            await it('should export the Domain class', async () => {
                expect(typeof Domain).toBe('function');
            });

            await it('create() and createDomain() should build a Domain', async () => {
                expect(create() instanceof Domain).toBe(true);
                expect(createDomain() instanceof Domain).toBe(true);
            });

            await it('a fresh domain should start with empty members', async () => {
                const d = create();
                expect(Array.isArray(d.members)).toBe(true);
                expect(d.members.length).toBe(0);
            });
        });

        // ==================== run executes its callback ====================
        await describe('run', async () => {
            await it('should execute the function and return its value', async () => {
                const d = create();
                expect(d.run(() => 42)).toBe(42);
                expect(d.run(() => 'ok')).toBe('ok');
            });

            await it('should propagate the callback return reference', async () => {
                const d = create();
                const obj = { a: 1 };
                expect(d.run(() => obj)).toBe(obj);
            });
        });

        // ==================== add / remove ====================
        await describe('add / remove', async () => {
            await it('should track and untrack members without throwing', async () => {
                const d = create();
                const emitter = create(); // Domain extends EventEmitter
                expect(() => d.add(emitter)).not.toThrow();
                expect(d.members.length).toBe(1);
                expect(() => d.remove(emitter)).not.toThrow();
                expect(d.members.length).toBe(0);
            });
        });

        // ==================== bind / intercept (no-op pass-through) ====================
        await describe('bind / intercept', async () => {
            await it('bind should return a callable that runs the wrapped fn', async () => {
                const d = create();
                const bound = d.bind((x: number) => x * 2);
                expect(typeof bound).toBe('function');
                expect((bound as (x: number) => number)(21)).toBe(42);
            });

            await it('intercept should return a callable that runs the wrapped fn', async () => {
                const d = create();
                const wrapped = d.intercept((x: number) => x + 1);
                expect(typeof wrapped).toBe('function');
                expect((wrapped as (x: number) => number)(1)).toBe(2);
            });
        });

        // ==================== lifecycle no-ops ====================
        await describe('lifecycle no-ops', async () => {
            await it('enter / exit should exist and not throw', async () => {
                const d = create();
                expect(typeof d.enter).toBe('function');
                expect(typeof d.exit).toBe('function');
                expect(() => d.enter()).not.toThrow();
                expect(() => d.exit()).not.toThrow();
            });

            await it('dispose should emit a dispose event', async () => {
                const d = create();
                let disposed = false;
                d.on('dispose', () => {
                    disposed = true;
                });
                d.dispose();
                expect(disposed).toBe(true);
            });
        });
    });
};
