// SPDX-License-Identifier: MIT
//
// `effect/Path` over GLib against `effect/Path` over `node:path`, operation by
// operation, over one corpus.
//
// WHY THIS EXISTS RATHER THAN MORE HAND-WRITTEN EXPECTATIONS. The FileSystem side
// of this package has upstream's own layer-parameterised conformance suite, so the
// Gio layer is measured against questions nobody here chose. `effect/Path` has no
// such suite — upstream's own Path test is three cases about file URLs — so the GLib
// layer was held only by expectations written by the same person who wrote the
// implementation. That is exactly the arrangement where both sides can be wrong
// together, and they were: `normalize('../x')` returned `/x`, an ABSOLUTE path
// somewhere else entirely, because the implementation canonicalized against a marker
// directory and `..` climbed out of it. Every hand-written case stayed under the
// marker, so every one of them passed.
//
// `node:path` is the oracle because `effect/Path` is specified as it: each method's
// documented meaning IS Node's, and `NodePath.layer` is what a consumer swapping
// layers was relying on. Where the two disagree the GLib side is wrong by
// definition, which is what makes a differential run a decision rather than a
// discussion.
//
// The corpus is deliberately unkind: it is the shapes a hand-written case does not
// think of — `..` above the root, `..` above a relative path, trailing separators,
// repeated separators, empty segments, a bare dot, a dotfile, a name that is only an
// extension.

import * as NodePath from '@effect/platform-node-shared/NodePath';
import { pathLayer } from '@gjsify/effect-platform';
import { describe, expect, it } from '@gjsify/unit';
import { Effect, type Layer } from 'effect';
import * as Path from 'effect/Path';

const PATHS: ReadonlyArray<string> = [
    '',
    '.',
    '..',
    '/',
    '//',
    'a',
    'a/b',
    'a/b/',
    '/a/b',
    '/a/b/',
    '/a//b',
    '/a/./b',
    '/a/../b',
    '/../a',
    '/../../a',
    '../a',
    '../../a',
    'a/../..',
    'a/../../b',
    './a',
    'a/.',
    'notes.md',
    '.bashrc',
    'archive.tar.gz',
    '/tmp/a b/c+d.txt',
    '/tmp/x.',
];

const PAIRS: ReadonlyArray<readonly [string, string]> = [
    ['/a/b', '/a/c'],
    ['/a', '/a/b'],
    ['/a', '/a'],
    ['/a/b/c', '/a'],
    ['a/b', 'a/c'],
    ['/', '/a'],
];

const JOINS: ReadonlyArray<ReadonlyArray<string>> = [
    [],
    ['a'],
    ['a', 'b'],
    ['a', '', 'b'],
    ['/a/', '/b/'],
    ['a', '..'],
    ['a', '..', 'b'],
    ['..', 'a'],
    ['.', 'a'],
    ['/', 'a'],
];

/** Every answer one layer gives about the corpus, as comparable JSON. */
const answers = (layer: Layer.Layer<Path.Path>): Promise<Record<string, string>> =>
    Effect.runPromise(
        Effect.provide(
            Effect.gen(function* () {
                const path = yield* Path.Path;
                const out: Record<string, string> = { sep: path.sep };
                for (const input of PATHS) {
                    const key = JSON.stringify(input);
                    out[`normalize ${key}`] = path.normalize(input);
                    out[`basename ${key}`] = path.basename(input);
                    out[`dirname ${key}`] = path.dirname(input);
                    out[`extname ${key}`] = path.extname(input);
                    out[`isAbsolute ${key}`] = String(path.isAbsolute(input));
                    out[`parse ${key}`] = JSON.stringify(path.parse(input));
                    out[`format(parse) ${key}`] = path.format(path.parse(input));
                    // `resolve` of one segment is absolute and therefore
                    // cwd-dependent; comparing the two layers against each other is
                    // still meaningful because both run in the same process.
                    out[`resolve ${key}`] = path.resolve(input);
                }
                for (const [from, to] of PAIRS) out[`relative ${from} ${to}`] = path.relative(from, to);
                for (const parts of JOINS) out[`join ${JSON.stringify(parts)}`] = path.join(...parts);
                return out;
            }),
            layer,
        ),
    );

export default async () => {
    await describe('effect/Path — GLib against node:path, differentially', async () => {
        const glib = await answers(pathLayer);
        const node = await answers(NodePath.layerPosix);

        // One case per OPERATION rather than one for the whole record: a single
        // deep-equal would report the first disagreement and hide the rest, and the
        // failure message would be two 200-entry objects.
        const operations = [...new Set(Object.keys(node).map((key) => key.split(' ')[0]))].sort();

        for (const operation of operations) {
            await it(`${operation} agrees with node:path`, async () => {
                const keys = Object.keys(node).filter((key) => key.split(' ')[0] === operation);
                const differing = keys.filter((key) => glib[key] !== node[key]);
                expect(
                    differing.map(
                        (key) => `${key}: GLib ${JSON.stringify(glib[key])} vs node ${JSON.stringify(node[key])}`,
                    ),
                ).toStrictEqual([]);
            });
        }
    });
};
