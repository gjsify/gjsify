// @gjsify/devtools — the interface XML and the implementation must agree on ARGUMENTS.
//
// The class this exists for, found the hard way: `Screenshot` declared
// `<arg type="s" direction="in" name="scope"/>` in the XML, the MCP `screenshot` tool
// exposed `scope` as a user-facing parameter and even defaulted it to `'window'`, and
// the service took the whole tuple as `_params` and captured the active window
// whatever it said. Asking for a child widget returned the whole window — SUCCESSFULLY,
// with a valid PNG — for the entire life of the method.
//
// Nothing could see it. The XML parses, `wrapJSObject` exports the method, every caller
// type-checks, and the reply has the declared signature. A declared-but-unread argument
// is invisible from every angle EXCEPT this one: comparing what the wire promises to
// what the function is able to receive.

import { describe, expect, it } from '@gjsify/unit';
import { buildDevtoolsIfaceXml } from './devtools-iface.js';
import { DevtoolsService } from './devtools-service.js';

/**
 * Every method the GENERIC interface declares, with its in-arg count.
 *
 * Extensions are excluded (`[]` rather than a live service's list): they contribute
 * their own XML and their own handlers, so their agreement is theirs to assert — and
 * an extension list here would make this suite depend on which app is loaded.
 */
function declaredMethods(): Array<{ name: string; inArgs: number }> {
    const xml = buildDevtoolsIfaceXml([]);
    const found: Array<{ name: string; inArgs: number }> = [];
    // Both shapes occur in the XML: `<method name="PresentWindow"/>` with no args, and
    // an open/close pair wrapping `<arg …/>` lines.
    const method = /<method name="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/method>)/g;
    for (let m = method.exec(xml); m !== null; m = method.exec(xml)) {
        found.push({ name: m[1], inArgs: (m[2] ?? '').match(/direction="in"/g)?.length ?? 0 });
    }
    return found;
}

/** The implementation `wrapJSObject` would bind, following the `<Name>Async` fallback. */
function implementationOf(name: string): { fn: (...args: unknown[]) => unknown; manualReply: boolean } | null {
    const proto = DevtoolsService.prototype as unknown as Record<string, unknown>;
    const plain = proto[name];
    if (typeof plain === 'function') return { fn: plain as (...args: unknown[]) => unknown, manualReply: false };
    const async_ = proto[`${name}Async`];
    if (typeof async_ === 'function') return { fn: async_ as (...args: unknown[]) => unknown, manualReply: true };
    return null;
}

export default async () => {
    await describe('devtools interface — XML and implementation agree', async () => {
        await it('declares methods, and every one of them is implemented', () => {
            const methods = declaredMethods();
            // A floor, not a count: the list grows, and a suite that has to be edited on
            // every added method gets edited without being read. What must never happen is
            // this parser silently matching NOTHING and the loops below passing vacuously.
            expect(methods.length).toBeGreaterThan(10);
            for (const { name } of methods) {
                expect(implementationOf(name) === null).toBe(false);
            }
        });

        await it('every declared in-arg is a parameter the implementation ACCEPTS', () => {
            // `Function.length` is the check: it counts declared parameters before the
            // first default or rest one, so a method that drops an argument from its
            // signature fails here even though the XML, the export and every caller stay
            // valid. This is the mechanical half — it covers every method that replies
            // synchronously, which is all of them but one.
            const gaps: string[] = [];
            for (const { name, inArgs } of declaredMethods()) {
                const impl = implementationOf(name);
                if (!impl || impl.manualReply) continue;
                if (impl.fn.length < inArgs) {
                    gaps.push(`${name}: XML declares ${inArgs} in-arg(s), the implementation takes ${impl.fn.length}`);
                }
            }
            expect(gaps).toStrictEqual([]);
        });

        await it('states the limit: arity cannot see a manual-reply method', () => {
            // THE HONEST BOUNDARY, asserted rather than written in a comment nobody reads.
            // A `<Name>Async` method takes `(params, invocation)` whatever the XML says, so
            // its arity is 2 for zero declared args and for five — the check above is blind
            // to exactly the method the bug was in.
            //
            // So this pins WHICH methods that blindness covers. `Screenshot` is the only
            // one today, and its arguments are proven the only way they can be: by calling
            // it over a real connection and observing that the value changes the answer
            // (`peer-transport.spec.ts` → "READS the Screenshot `scope` argument"). A
            // second manual-reply method appearing without that treatment fails here, with
            // the reason attached, instead of quietly inheriting the blind spot.
            const manualReply = declaredMethods()
                .filter(({ name }) => implementationOf(name)?.manualReply)
                .map(({ name }) => name);
            expect(manualReply).toStrictEqual(['Screenshot']);
            expect(implementationOf('Screenshot')?.fn.length).toBe(2);
        });
    });
};
