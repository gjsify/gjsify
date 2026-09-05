// SPDX-License-Identifier: MIT
//
// The upstream FileSystem conformance suite over `node:fs`, i.e. over @gjsify/fs
// on the GJS leg and over real Node on the control leg.
//
// The Gio leg of the same suite is `filesystem-gio.spec.ts`, which the Node entry
// deliberately does not import.

import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem';

import { conformance } from './filesystem-conformance.js';

export default conformance({ label: 'node:fs', layer: NodeFileSystem.layer });
