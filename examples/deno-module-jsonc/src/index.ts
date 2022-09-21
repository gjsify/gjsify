import { parse } from 'https://deno.land/x/jsonc@1/main.ts';

const log = globalThis.print || console.log;

const json = parse(`
    {
        // This is a comment
        "foo": "bar"
    }
`)

log("parsed json:", JSON.stringify(json, null, 2));