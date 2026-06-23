// @gjsify/devtools-cdp — tool-generator — original implementation.
// Pure: a fixture protocol domain drives the generator; a few asserts also run
// against the embedded spec to confirm it loaded + integrates.

import { describe, expect, it } from '@gjsify/unit';

import { PROTOCOL_SPEC, type ProtocolDomain } from './protocol-spec.js';
import { cdpToolName, generateCdpTools, snakeCase } from './tool-generator.js';

const FIXTURE: ProtocolDomain[] = [
    {
        domain: 'DOM',
        types: [
            { id: 'NodeId', type: 'integer' },
            { id: 'Node', type: 'object', properties: [{ name: 'nodeId', $ref: 'NodeId' }] },
        ],
        commands: [
            {
                name: 'querySelector',
                description: 'Query a node.',
                parameters: [
                    { name: 'nodeId', $ref: 'NodeId' },
                    { name: 'selector', type: 'string', description: 'CSS selector.' },
                    { name: 'includeUserAgent', type: 'boolean', optional: true },
                ],
            },
            {
                name: 'getOuterHTML',
                parameters: [{ name: 'node', $ref: 'Node' }],
            },
        ],
    },
    {
        domain: 'Runtime',
        commands: [{ name: 'enable' }],
    },
];

export default async () => {
    await describe('snakeCase / cdpToolName', async () => {
        await it('snake-cases camel + acronym names', async () => {
            expect(snakeCase('querySelector')).toBe('query_selector');
            expect(snakeCase('getOuterHTML')).toBe('get_outer_html');
            expect(snakeCase('DOM')).toBe('dom');
            expect(snakeCase('enable')).toBe('enable');
        });

        await it('builds the prefixed tool name', async () => {
            expect(cdpToolName('DOM', 'querySelector')).toBe('cdp_dom_query_selector');
            expect(cdpToolName('Runtime', 'evaluate', 'x')).toBe('x_runtime_evaluate');
        });
    });

    await describe('generateCdpTools (fixture)', async () => {
        await it('emits one descriptor per command with name + wire method', async () => {
            const tools = generateCdpTools(FIXTURE);
            expect(tools.length).toBe(3);
            const qs = tools.find((t) => t.command === 'querySelector')!;
            expect(qs.name).toBe('cdp_dom_query_selector');
            expect(qs.method).toBe('DOM.querySelector');
            expect(qs.description).toBe('Query a node.');
        });

        await it('flattens parameters with simplified JS types', async () => {
            const qs = generateCdpTools(FIXTURE).find((t) => t.command === 'querySelector')!;
            const byName = Object.fromEntries(qs.parameters.map((p) => [p.name, p]));
            expect(byName.selector.jsType).toBe('string');
            expect(byName.nodeId.jsType).toBe('number'); // $ref NodeId → integer → number
            expect(byName.includeUserAgent.jsType).toBe('boolean');
        });

        await it('marks optional parameters', async () => {
            const qs = generateCdpTools(FIXTURE).find((t) => t.command === 'querySelector')!;
            const byName = Object.fromEntries(qs.parameters.map((p) => [p.name, p]));
            expect(byName.selector.optional).toBeFalsy();
            expect(byName.includeUserAgent.optional).toBeTruthy();
        });

        await it('resolves an object-typed $ref to object', async () => {
            const html = generateCdpTools(FIXTURE).find((t) => t.command === 'getOuterHTML')!;
            expect(html.parameters[0].jsType).toBe('object'); // $ref Node (object)
        });

        await it('honours the include filter', async () => {
            const tools = generateCdpTools(FIXTURE, { include: (d) => d === 'Runtime' });
            expect(tools.length).toBe(1);
            expect(tools[0].name).toBe('cdp_runtime_enable');
        });
    });

    await describe('generateCdpTools (embedded spec)', async () => {
        await it('loaded the embedded protocol spec', async () => {
            expect(PROTOCOL_SPEC.length).toBeGreaterThan(20);
        });

        await it('generates the well-known Runtime.evaluate tool', async () => {
            const tools = generateCdpTools(PROTOCOL_SPEC);
            const evaluate = tools.find((t) => t.method === 'Runtime.evaluate');
            expect(evaluate).toBeDefined();
            expect(evaluate!.name).toBe('cdp_runtime_evaluate');
            const expr = evaluate!.parameters.find((p) => p.name === 'expression');
            expect(expr!.jsType).toBe('string');
            expect(expr!.optional).toBeFalsy();
        });

        await it('generates a couple hundred tools total', async () => {
            expect(generateCdpTools(PROTOCOL_SPEC).length).toBeGreaterThan(100);
        });
    });
};
