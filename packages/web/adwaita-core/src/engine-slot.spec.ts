// The engine slot (`engine.ts` § "The slot") — the one piece of GLOBAL state in this package.
//
// Every assertion here is about an ERROR or a default, because that is all the slot is: it does
// not transform anything, it decides which engine a port's namespace ends up on and it refuses
// the two orderings under which that decision would be silently wrong. The engine BEHAVIOUR it
// selects between is held elsewhere — `gobject.spec.ts` on the pure-JS one,
// `@gjsify/adwaita-gobject-native`'s `engine.node-gi.spec.ts` on the real one, both over the same
// `GOBJECT_VECTORS`.
//
// `resetRegisteredEngine()` exists FOR this file. Module state survives between tests in one
// process, so a slot that could not be cleared would let the first test fix the answer for all
// the others and make the suite order-dependent.

import { describe, expect, it } from '@gjsify/unit';

import { registerGObjectEngine, registeredEngine, resetRegisteredEngine } from './engine.js';
import { createGObject, gobjectEngineName, PURE_JS_ENGINE, type GObjectDoor } from './gobject.js';
import type { GObjectEngine } from './engine.js';

/** A door that is never reached: nothing here registers a class or builds a tree. */
const door: GObjectDoor = {
    name: 'slot test door',
    dispatch() {
        throw new Error('slot test door: not reached');
    },
    listen() {
        throw new Error('slot test door: not reached');
    },
    createFromTree() {
        throw new Error('slot test door: not reached');
    },
    attach() {},
    register() {},
};

/** An engine that is only its name — the slot never calls a member. */
function namedEngine(name: string): GObjectEngine {
    return { ...PURE_JS_ENGINE, name };
}

export default async () => {
    await describe('GObject engine slot', async () => {
        await it('is empty by default, and an empty slot means the pure-JS engine', () => {
            resetRegisteredEngine();
            expect(registeredEngine()).toBe(undefined);
            resetRegisteredEngine();
            expect(gobjectEngineName()).toBe('pure-js');
            resetRegisteredEngine();
            expect(createGObject(door, registeredEngine()).engineName).toBe('pure-js');
        });

        await it('hands a registered engine to the next namespace', () => {
            resetRegisteredEngine();
            const engine = namedEngine('fake-real');
            registerGObjectEngine(engine);
            expect(registeredEngine()).toBe(engine);
            expect(createGObject(door, registeredEngine()).engineName).toBe('fake-real');
        });

        await it('answers gobjectEngineName with the registered name', () => {
            resetRegisteredEngine();
            registerGObjectEngine(namedEngine('real-gio'));
            expect(gobjectEngineName()).toBe('real-gio');
        });

        await it('reports the engine of THE namespace, not of the slot at query time', () => {
            // A namespace is built once and keeps its engine; a later `resetRegisteredEngine` is a
            // test fixture, not something an app can do, and must not change an existing answer.
            resetRegisteredEngine();
            registerGObjectEngine(namedEngine('fake-real'));
            const namespace = createGObject(door, registeredEngine());
            resetRegisteredEngine();
            expect(namespace.engineName).toBe('fake-real');
            expect(gobjectEngineName()).toBe('pure-js');
        });

        await it('is idempotent for the same engine object', () => {
            resetRegisteredEngine();
            const engine = namedEngine('fake-real');
            registerGObjectEngine(engine);
            registerGObjectEngine(engine);
            expect(registeredEngine()).toBe(engine);
        });

        await it('refuses a second, different engine by name', () => {
            resetRegisteredEngine();
            registerGObjectEngine(namedEngine('real-gio'));
            let message = '';
            try {
                registerGObjectEngine(namedEngine('something-else'));
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes("'real-gio'")).toBe(true);
            expect(message.includes("'something-else'")).toBe(true);
        });

        await it('refuses a registration AFTER the slot was read, and names the fix', () => {
            // The whole point of the slot: an app that opts in too late would otherwise get a
            // pure-JS namespace while believing it had a real GObject.
            resetRegisteredEngine();
            registeredEngine();
            let message = '';
            try {
                registerGObjectEngine(namedEngine('real-gio'));
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('too late')).toBe(true);
            expect(message.includes('imported BEFORE')).toBe(true);
        });

        await it('counts a gobjectEngineName query as a read', () => {
            resetRegisteredEngine();
            expect(gobjectEngineName()).toBe('pure-js');
            let threw = false;
            try {
                registerGObjectEngine(namedEngine('real-gio'));
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
            resetRegisteredEngine();
        });
    });
};
