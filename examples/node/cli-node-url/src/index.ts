import '@gjsify/node-globals';
import { URL, URLSearchParams, parse, format, fileURLToPath, pathToFileURL } from 'url';

console.log('=== @gjsify/url example ===\n');

// URL class
console.log('--- URL class ---');
const myUrl = new URL('https://example.com:8080/path/to/page?name=ferret&color=purple#section');
console.log('href:', myUrl.href);
console.log('protocol:', myUrl.protocol);
console.log('hostname:', myUrl.hostname);
console.log('port:', myUrl.port);
console.log('pathname:', myUrl.pathname);
console.log('search:', myUrl.search);
console.log('hash:', myUrl.hash);
console.log('origin:', myUrl.origin);

// URL with base
console.log('\n--- URL with base ---');
const relative = new URL('/api/data', 'https://example.com');
console.log('URL("/api/data", "https://example.com"):', relative.href);

// URLSearchParams
console.log('\n--- URLSearchParams ---');
const params = new URLSearchParams('foo=bar&baz=qux&foo=quux');
console.log('get("foo"):', params.get('foo'));
console.log('getAll("foo"):', params.getAll('foo'));
console.log('has("baz"):', params.has('baz'));
console.log('toString():', params.toString());

params.set('newkey', 'newvalue');
params.delete('baz');
console.log('After set/delete:', params.toString());

// Iteration
console.log('\n--- URLSearchParams iteration ---');
const iterParams = new URLSearchParams('a=1&b=2&c=3');
for (const [key, value] of iterParams) {
  console.log(`  ${key} = ${value}`);
}

// Legacy parse
console.log('\n--- Legacy parse ---');
const parsed = parse('https://user:pass@sub.host.com:8080/p/a/t/h?query=string#hash');
console.log('protocol:', parsed.protocol);
console.log('auth:', parsed.auth);
console.log('hostname:', parsed.hostname);
console.log('port:', parsed.port);
console.log('pathname:', parsed.pathname);

// fileURLToPath / pathToFileURL
console.log('\n--- File URL helpers ---');
console.log('fileURLToPath("file:///home/user/test.txt"):', fileURLToPath('file:///home/user/test.txt'));
console.log('pathToFileURL("/home/user/test.txt").href:', pathToFileURL('/home/user/test.txt').href);

console.log('\n=== url example complete ===');
