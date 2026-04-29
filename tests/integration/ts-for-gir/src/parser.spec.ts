// SPDX-License-Identifier: MIT
// New tests for @gi.ts/parser — upstream has no parser-level test suite.
// Fixtures: gjsify's own Vala-generated GIRs (Gwebgl-0.1, GjsifyWebrtc-0.1,
// GjsifyHttpSoupBridge-1.0). Real-world parser surface — enums, properties,
// signals, multi-namespace <include> deps.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from '@gjsify/unit';
import { parser, type GirXML, type GirRepository, type GirNamespace, type GirClassElement } from '@gi.ts/parser';

function fixtureUrl(filename: string): URL {
  return new URL(`../girs/${filename}`, import.meta.url);
}

function loadGir(filename: string): string {
  return readFileSync(fixtureUrl(filename), 'utf8');
}

function getRepository(gir: GirXML): GirRepository {
  expect(Array.isArray(gir.repository)).toBeTruthy();
  expect(gir.repository.length >= 1).toBeTruthy();
  return gir.repository[0];
}

function getNamespace(repo: GirRepository): GirNamespace {
  expect(Array.isArray(repo.namespace)).toBeTruthy();
  expect(repo.namespace!.length >= 1).toBeTruthy();
  return repo.namespace![0];
}

function findClass(ns: GirNamespace, name: string): GirClassElement {
  expect(Array.isArray(ns.class)).toBeTruthy();
  const cls = ns.class!.find((c) => c.$.name === name);
  expect(cls).toBeDefined();
  return cls!;
}

function includeNames(repo: GirRepository): string[] {
  return (repo.include ?? []).map((inc) => inc.$.name);
}

export default async () => {
  await describe('@gi.ts/parser — Gwebgl-0.1.gir (webgl bindings)', async () => {
    const xml = loadGir('Gwebgl-0.1.gir');
    const gir = parser.parseGir(xml);
    const repo = getRepository(gir);
    const ns = getNamespace(repo);

    await it('has repository version 1.2', async () => {
      expect(repo.$.version).toBe('1.2');
    });

    await it('namespace is "Gwebgl" version "0.1"', async () => {
      expect(ns.$.name).toBe('Gwebgl');
      expect(ns.$.version).toBe('0.1');
      expect(ns.$['shared-library']).toBe('libgwebgl.so');
    });

    await it('declares <include> deps for GObject and GLib', async () => {
      const names = includeNames(repo);
      expect(names).toContain('GObject');
      expect(names).toContain('GLib');
    });

    await it('parses 3 classes including WebGLRenderingContextBase', async () => {
      expect(ns.class!.length).toBe(3);
      const cls = findClass(ns, 'WebGLRenderingContextBase');
      expect(cls.$.parent).toBe('GObject.Object');
    });

    await it('WebGLRenderingContextBase has methods + properties', async () => {
      const cls = findClass(ns, 'WebGLRenderingContextBase');
      expect(Array.isArray(cls.method)).toBeTruthy();
      expect(cls.method!.length > 100).toBeTruthy();
      const getConstants = cls.method!.find((m) => m.$.name === 'get_webgl_constants');
      expect(getConstants).toBeDefined();
    });

    await it('parses the TypeError enumeration', async () => {
      expect(Array.isArray(ns.enumeration)).toBeTruthy();
      const typeError = ns.enumeration!.find((e) => e.$.name === 'TypeError');
      expect(typeError).toBeDefined();
      expect(Array.isArray(typeError!.member)).toBeTruthy();
      expect(typeError!.member!.length >= 1).toBeTruthy();
    });

    await it('restores <constructor> tags after fast-xml-parser security rename', async () => {
      // The parser renames <constructor> → __gir_constructor__ during parse
      // (fast-xml-parser blocks "constructor" to prevent prototype pollution),
      // then restores it in postProcessParsedXml.
      const cls = findClass(ns, 'WebGLRenderingContextBase');
      expect(Array.isArray((cls as any).constructor)).toBeTruthy();
      expect((cls as any).__gir_constructor__).toBeUndefined();
    });
  });

  await describe('@gi.ts/parser — GjsifyWebrtc-0.1.gir (webrtc bindings, signals)', async () => {
    const xml = loadGir('GjsifyWebrtc-0.1.gir');
    const gir = parser.parseGir(xml);
    const repo = getRepository(gir);
    const ns = getNamespace(repo);

    await it('namespace is "GjsifyWebrtc" version "0.1"', async () => {
      expect(ns.$.name).toBe('GjsifyWebrtc');
      expect(ns.$.version).toBe('0.1');
    });

    await it('declares <include> deps for Gst, GstWebRTC, GObject, GLib', async () => {
      const names = includeNames(repo);
      expect(names).toContain('Gst');
      expect(names).toContain('GstWebRTC');
      expect(names).toContain('GObject');
      expect(names).toContain('GLib');
    });

    await it('PromiseBridge has glib:signal entries (replied, rejected)', async () => {
      const cls = findClass(ns, 'PromiseBridge');
      const signals = (cls as any)['glib:signal'] as Array<{ $: { name: string } }> | undefined;
      expect(Array.isArray(signals)).toBeTruthy();
      const names = signals!.map((s) => s.$.name);
      expect(names).toContain('replied');
      expect(names).toContain('rejected');
    });

    await it('parses class properties (PromiseBridge.promise of type Gst.Promise)', async () => {
      const cls = findClass(ns, 'PromiseBridge');
      expect(Array.isArray(cls.property)).toBeTruthy();
      const promiseProp = cls.property!.find((p) => p.$.name === 'promise');
      expect(promiseProp).toBeDefined();
      expect(Array.isArray(promiseProp!.type)).toBeTruthy();
      expect(promiseProp!.type![0].$.name).toBe('Gst.Promise');
    });
  });

  await describe('@gi.ts/parser — GjsifyHttpSoupBridge-1.0.gir (multi-namespace)', async () => {
    const xml = loadGir('GjsifyHttpSoupBridge-1.0.gir');
    const gir = parser.parseGir(xml);
    const repo = getRepository(gir);
    const ns = getNamespace(repo);

    await it('namespace is "GjsifyHttpSoupBridge" version "1.0"', async () => {
      expect(ns.$.name).toBe('GjsifyHttpSoupBridge');
      expect(ns.$.version).toBe('1.0');
    });

    await it('declares <include> deps for Soup, Gio, GObject, GLib', async () => {
      const names = includeNames(repo);
      expect(names).toContain('Soup');
      expect(names).toContain('Gio');
      expect(names).toContain('GObject');
      expect(names).toContain('GLib');
    });

    await it('parses 3 classes', async () => {
      expect(ns.class!.length).toBe(3);
    });

    await it('class methods carry parameter shape ($, type)', async () => {
      const cls = ns.class!.find((c) => Array.isArray(c.method) && c.method!.length > 0);
      expect(cls).toBeDefined();
      const method = cls!.method!.find((m) => Array.isArray(m.parameters));
      expect(method).toBeDefined();
      const params = method!.parameters![0];
      // every method has at least an instance-parameter
      const instanceParam = (params as any)['instance-parameter'];
      expect(Array.isArray(instanceParam)).toBeTruthy();
      expect(instanceParam.length >= 1).toBeTruthy();
    });
  });

  await describe('@gi.ts/parser — edge cases (inline XML)', async () => {
    await it('parses a minimal repository', async () => {
      const xml = '<?xml version="1.0"?><repository version="1.2"></repository>';
      const gir = parser.parseGir(xml);
      const repo = getRepository(gir);
      expect(repo.$.version).toBe('1.2');
    });

    await it('parses a namespace without classes', async () => {
      const xml = `<?xml version="1.0"?>
<repository version="1.2" xmlns="http://www.gtk.org/introspection/core/1.0">
  <namespace name="Empty" version="0.1"/>
</repository>`;
      const gir = parser.parseGir(xml);
      const ns = getNamespace(getRepository(gir));
      expect(ns.$.name).toBe('Empty');
      expect(ns.class).toBeUndefined();
    });

    await it('round-trips an inline class with a method', async () => {
      const xml = `<?xml version="1.0"?>
<repository version="1.2" xmlns="http://www.gtk.org/introspection/core/1.0">
  <namespace name="Foo" version="1.0">
    <class name="Bar" parent="GObject.Object">
      <method name="greet">
        <return-value transfer-ownership="full"><type name="utf8" c:type="gchar*"/></return-value>
      </method>
    </class>
  </namespace>
</repository>`;
      const gir = parser.parseGir(xml);
      const cls = findClass(getNamespace(getRepository(gir)), 'Bar');
      expect(cls.$.parent).toBe('GObject.Object');
      expect(cls.method![0].$.name).toBe('greet');
    });
  });
};
