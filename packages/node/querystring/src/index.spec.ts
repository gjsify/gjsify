import { describe, it, expect } from '@gjsify/unit';
import * as qs from 'querystring';

// Ported from refs/node/test/parallel/test-querystring.js,
// test-querystring-escape.js, test-querystring-maxKeys-non-finite.js,
// test-querystring-multichar-separator.js
// Original: MIT license, Node.js contributors

// Helper: create object with null prototype (like Node.js qs.parse results)
function createWithNoPrototype(properties: { key: string; value: string | string[] }[]) {
	const noProto: Record<string, string | string[]> = Object.create(null);
	properties.forEach((property) => {
		noProto[property.key] = property.value;
	});
	return noProto;
}

// Helper: deep check parse result (no prototype, matching keys+values)
function check(actual: Record<string, unknown>, expected: Record<string, unknown>) {
	const actualKeys = Object.keys(actual).sort();
	const expectedKeys = Object.keys(expected).sort();
	// Compare key arrays element by element since toEqual uses ==
	expect(actualKeys.length).toBe(expectedKeys.length);
	for (let i = 0; i < expectedKeys.length; i++) {
		expect(actualKeys[i]).toBe(expectedKeys[i]);
	}
	expectedKeys.forEach((key) => {
		const a = actual[key];
		const e = expected[key];
		if (Array.isArray(a) && Array.isArray(e)) {
			expect(a.length).toBe(e.length);
			for (let i = 0; i < e.length; i++) {
				expect(a[i]).toBe(e[i]);
			}
		} else {
			expect(a).toBe(e);
		}
	});
}

// [ wonkyQS, canonicalQS, obj ]
const qsTestCases: [string | null | undefined, string, Record<string, string | string[]>][] = [
	['__proto__=1', '__proto__=1',
		createWithNoPrototype([{ key: '__proto__', value: '1' }])],
	['__defineGetter__=asdf', '__defineGetter__=asdf',
		JSON.parse('{"__defineGetter__":"asdf"}')],
	['foo=918854443121279438895193', 'foo=918854443121279438895193',
		{ 'foo': '918854443121279438895193' }],
	['foo=bar', 'foo=bar', { 'foo': 'bar' }],
	['foo=bar&foo=quux', 'foo=bar&foo=quux', { 'foo': ['bar', 'quux'] }],
	['foo=1&bar=2', 'foo=1&bar=2', { 'foo': '1', 'bar': '2' }],
	['my+weird+field=q1%212%22%27w%245%267%2Fz8%29%3F',
		'my%20weird%20field=q1!2%22\'w%245%267%2Fz8)%3F',
		{ 'my weird field': 'q1!2"\'w$5&7/z8)?' }],
	['foo%3Dbaz=bar', 'foo%3Dbaz=bar', { 'foo=baz': 'bar' }],
	['foo=baz=bar', 'foo=baz%3Dbar', { 'foo': 'baz=bar' }],
	['str=foo&arr=1&arr=2&arr=3&somenull=&undef=',
		'str=foo&arr=1&arr=2&arr=3&somenull=&undef=',
		{ 'str': 'foo', 'arr': ['1', '2', '3'], 'somenull': '', 'undef': '' }],
	[' foo = bar ', '%20foo%20=%20bar%20', { ' foo ': ' bar ' }],
	['foo=%zx', 'foo=%25zx', { 'foo': '%zx' }],
	['foo=%EF%BF%BD', 'foo=%EF%BF%BD', { 'foo': '\ufffd' }],
	['hasOwnProperty=x&toString=foo&valueOf=bar&__defineGetter__=baz',
		'hasOwnProperty=x&toString=foo&valueOf=bar&__defineGetter__=baz',
		{ hasOwnProperty: 'x', toString: 'foo', valueOf: 'bar', __defineGetter__: 'baz' }],
	['foo&bar=baz', 'foo=&bar=baz', { foo: '', bar: 'baz' }],
	['a=b&c&d=e', 'a=b&c=&d=e', { a: 'b', c: '', d: 'e' }],
	['a=b&c=&d=e', 'a=b&c=&d=e', { a: 'b', c: '', d: 'e' }],
	['a=b&=c&d=e', 'a=b&=c&d=e', { 'a': 'b', '': 'c', 'd': 'e' }],
	['a=b&=&c=d', 'a=b&=&c=d', { 'a': 'b', '': '', 'c': 'd' }],
	['&&foo=bar&&', 'foo=bar', { foo: 'bar' }],
	['&', '', {}],
	['&&&&', '', {}],
	['&=&', '=', { '': '' }],
	['&=&=', '=&=', { '': ['', ''] }],
	['=', '=', { '': '' }],
	['+', '%20=', { ' ': '' }],
	['+=', '%20=', { ' ': '' }],
	['+&', '%20=', { ' ': '' }],
	['=+', '=%20', { '': ' ' }],
	['+=&', '%20=', { ' ': '' }],
	['a&&b', 'a=&b=', { 'a': '', 'b': '' }],
	['a=a&&b=b', 'a=a&b=b', { 'a': 'a', 'b': 'b' }],
	['&a', 'a=', { 'a': '' }],
	['&=', '=', { '': '' }],
	['a&a&', 'a=&a=', { a: ['', ''] }],
	['a&a&a&', 'a=&a=&a=', { a: ['', '', ''] }],
	['a&a&a&a&', 'a=&a=&a=&a=', { a: ['', '', '', ''] }],
	['a=&a=value&a=', 'a=&a=value&a=', { a: ['', 'value', ''] }],
	['foo+bar=baz+quux', 'foo%20bar=baz%20quux', { 'foo bar': 'baz quux' }],
	['+foo=+bar', '%20foo=%20bar', { ' foo': ' bar' }],
	['a+', 'a%20=', { 'a ': '' }],
	['=a+', '=a%20', { '': 'a ' }],
	['a+&', 'a%20=', { 'a ': '' }],
	['=a+&', '=a%20', { '': 'a ' }],
	['%20+', '%20%20=', { '  ': '' }],
	['=%20+', '=%20%20', { '': '  ' }],
	['%20+&', '%20%20=', { '  ': '' }],
	['=%20+&', '=%20%20', { '': '  ' }],
	[null, '', {}],
	[undefined, '', {}],
];

// [ wonkyQS, canonicalQS, obj ] with colon separator
const qsColonTestCases: [string, string, Record<string, string | string[]>][] = [
	['foo:bar', 'foo:bar', { 'foo': 'bar' }],
	['foo:bar;foo:quux', 'foo:bar;foo:quux', { 'foo': ['bar', 'quux'] }],
	['foo:1&bar:2;baz:quux', 'foo:1%26bar%3A2;baz:quux',
		{ 'foo': '1&bar:2', 'baz': 'quux' }],
	['foo%3Abaz:bar', 'foo%3Abaz:bar', { 'foo:baz': 'bar' }],
	['foo:baz:bar', 'foo:baz%3Abar', { 'foo': 'baz:bar' }],
];

// [wonkyObj, qs, canonicalObj]
function extendedFunction() { /* noop */ }
extendedFunction.prototype = { a: 'b' };

const qsWeirdObjects: [Record<string, unknown>, string, Record<string, string | string[]>][] = [
	[{ regexp: /./g }, 'regexp=', { 'regexp': '' }],
	[{ regexp: new RegExp('.', 'g') }, 'regexp=', { 'regexp': '' }],
	[{ fn: () => { /* noop */ } }, 'fn=', { 'fn': '' }],
	[{ math: Math }, 'math=', { 'math': '' }],
	[{ e: extendedFunction }, 'e=', { 'e': '' }],
	[{ d: new Date() }, 'd=', { 'd': '' }],
	[{ d: Date }, 'd=', { 'd': '' }],
	[{ f: new Boolean(false), t: new Boolean(true) }, 'f=&t=', { 'f': '', 't': '' }],
	[{ f: false, t: true }, 'f=false&t=true', { 'f': 'false', 't': 'true' }],
	[{ n: null }, 'n=', { 'n': '' }],
	[{ nan: NaN }, 'nan=', { 'nan': '' }],
	[{ inf: Infinity }, 'inf=', { 'inf': '' }],
	[{ a: [], b: [] }, '', {}],
	[{ a: 1, b: [] }, 'a=1', { 'a': '1' }],
];

const qsNoMungeTestCases: [string, Record<string, string | string[]>][] = [
	['', {}],
	['foo=bar&foo=baz', { 'foo': ['bar', 'baz'] }],
	['blah=burp', { 'blah': 'burp' }],
	['a=!-._~\'()*', { 'a': '!-._~\'()*' }],
	['a=abcdefghijklmnopqrstuvwxyz', { 'a': 'abcdefghijklmnopqrstuvwxyz' }],
	['a=ABCDEFGHIJKLMNOPQRSTUVWXYZ', { 'a': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }],
	['a=0123456789', { 'a': '0123456789' }],
	['gragh=1&gragh=3&goo=2', { 'gragh': ['1', '3'], 'goo': '2' }],
	['frappucino=muffin&goat%5B%5D=scone&pond=moose',
		{ 'frappucino': 'muffin', 'goat[]': 'scone', 'pond': 'moose' }],
	['trololol=yes&lololo=no', { 'trololol': 'yes', 'lololo': 'no' }],
];

const qsUnescapeTestCases: [string, string][] = [
	['there is nothing to unescape here', 'there is nothing to unescape here'],
	['there%20are%20several%20spaces%20that%20need%20to%20be%20unescaped',
		'there are several spaces that need to be unescaped'],
	['there%2Qare%0-fake%escaped values in%%%%this%9Hstring',
		'there%2Qare%0-fake%escaped values in%%%%this%9Hstring'],
	['%20%21%22%23%24%25%26%27%28%29%2A%2B%2C%2D%2E%2F%30%31%32%33%34%35%36%37',
		' !"#$%&\'()*+,-./01234567'],
	['%%2a', '%*'],
	['%2sf%2a', '%2sf*'],
	['%2%2af%2a', '%2*f*'],
];

export default async () => {
	// ==================== parse ====================

	await describe('querystring.parse', async () => {
		await it('should parse basic id string', async () => {
			expect(qs.parse('id=918854443121279438895193').id).toBe('918854443121279438895193');
		});

		await describe('qsTestCases', async () => {
			for (const [input, , expected] of qsTestCases) {
				const label = input === null ? 'null' : input === undefined ? 'undefined' : `"${input}"`;
				await it(`should parse ${label}`, async () => {
					check(qs.parse(input as string), expected);
				});
			}
		});

		await describe('colon separator', async () => {
			for (const [input, , expected] of qsColonTestCases) {
				await it(`should parse "${input}" with sep=; eq=:`, async () => {
					check(qs.parse(input, ';', ':'), expected);
				});
			}
		});

		await describe('weird objects round-trip', async () => {
			for (const [, input, expected] of qsWeirdObjects) {
				await it(`should parse "${input}"`, async () => {
					check(qs.parse(input), expected);
				});
			}
		});

		await it('should parse nested qs-in-qs', async () => {
			const f = qs.parse('a=b&q=x%3Dy%26y%3Dz');
			expect(f.a).toBe('b');
			expect(f.q).toBe('x=y&y=z');
		});

		await it('should parse nested qs-in-qs with colon', async () => {
			const f = qs.parse('a:b;q:x%3Ay%3By%3Az', ';', ':');
			expect(f.a).toBe('b');
			expect(f.q).toBe('x:y;y:z');
		});

		await it('should not throw on undefined input', async () => {
			const result = qs.parse(undefined as unknown as string);
			expect(Object.keys(result).length).toBe(0);
		});

		await it('should handle empty sep (array)', async () => {
			check(qs.parse('a', [] as unknown as string), { a: '' });
		});

		await it('should handle empty eq (array)', async () => {
			check(qs.parse('a', null as unknown as string, [] as unknown as string), { '': 'a' });
		});

		await it('should handle separator and equals parsing order', async () => {
			check(qs.parse('foo&bar', '&', '&'), { foo: '', bar: '' });
		});

		await it('should handle invalid encoded string', async () => {
			check(qs.parse('%\u0100=%\u0101'), { '%\u0100': '%\u0101' });
		});
	});

	// ==================== parse — maxKeys ====================

	await describe('querystring.parse maxKeys', async () => {
		await it('should limit keys with maxKeys=1', async () => {
			const result = qs.parse('a=1&b=1&c=1', undefined, undefined, { maxKeys: 1 });
			expect(Object.keys(result).length).toBe(1);
		});

		await it('should limit keys starting from &', async () => {
			const result = qs.parse('&a', undefined, undefined, { maxKeys: 1 });
			expect(Object.keys(result).length).toBe(0);
		});

		await it('should remove limit with maxKeys=0', async () => {
			const query: Record<string, number> = {};
			for (let i = 0; i < 2000; i++) query[i] = i;
			const url = qs.stringify(query as unknown as Record<string, unknown>);
			const result = qs.parse(url, undefined, undefined, { maxKeys: 0 });
			expect(Object.keys(result).length).toBe(2000);
		});

		await it('should handle maxKeys=Infinity', async () => {
			const count = 10000;
			let str = '0=0';
			for (let i = 1; i < count; i++) {
				const n = i.toString(36);
				str += `&${n}=${n}`;
			}
			const result = qs.parse(str, undefined, undefined, { maxKeys: Infinity });
			expect(Object.keys(result).length).toBe(count);
		});

		await it('should handle maxKeys=NaN', async () => {
			const count = 10000;
			let str = '0=0';
			for (let i = 1; i < count; i++) {
				const n = i.toString(36);
				str += `&${n}=${n}`;
			}
			const result = qs.parse(str, undefined, undefined, { maxKeys: NaN });
			expect(Object.keys(result).length).toBe(count);
		});

		await it('should treat string "Infinity" as default maxKeys', async () => {
			const count = 10000;
			let str = '0=0';
			for (let i = 1; i < count; i++) {
				const n = i.toString(36);
				str += `&${n}=${n}`;
			}
			const result = qs.parse(str, undefined, undefined,
				{ maxKeys: 'Infinity' as unknown as number });
			expect(Object.keys(result).length).toBe(1000);
		});

		await it('should treat string "NaN" as default maxKeys', async () => {
			const count = 10000;
			let str = '0=0';
			for (let i = 1; i < count; i++) {
				const n = i.toString(36);
				str += `&${n}=${n}`;
			}
			const result = qs.parse(str, undefined, undefined,
				{ maxKeys: 'NaN' as unknown as number });
			expect(Object.keys(result).length).toBe(1000);
		});
	});

	// ==================== parse — custom decode ====================

	await describe('querystring.parse custom decode', async () => {
		await it('should use custom decodeURIComponent', async () => {
			function demoDecode(str: string) { return str + str; }
			check(
				qs.parse('a=a&b=b&c=c', undefined, undefined, { decodeURIComponent: demoDecode }),
				{ aa: 'aa', bb: 'bb', cc: 'cc' },
			);
		});

		await it('should use custom decode with custom eq', async () => {
			check(
				qs.parse('a=a&b=b&c=c', undefined, '==', { decodeURIComponent: (str: string) => str }),
				{ 'a=a': '', 'b=b': '', 'c=c': '' },
			);
		});

		await it('should fall back when decode throws', async () => {
			function errDecode(_str: string): string {
				throw new Error('To jump to the catch scope');
			}
			check(qs.parse('a=a', undefined, undefined, { decodeURIComponent: errDecode }), { a: 'a' });
		});
	});

	// ==================== stringify ====================

	await describe('querystring.stringify', async () => {
		await describe('qsTestCases round-trip', async () => {
			for (const [, canonical, obj] of qsTestCases) {
				await it(`should stringify to "${canonical}"`, async () => {
					expect(qs.stringify(obj as unknown as Record<string, unknown>)).toBe(canonical);
				});
			}
		});

		await describe('colon separator round-trip', async () => {
			for (const [, canonical, obj] of qsColonTestCases) {
				await it(`should stringify to "${canonical}" with sep=; eq=:`, async () => {
					expect(qs.stringify(obj as unknown as Record<string, unknown>, ';', ':')).toBe(canonical);
				});
			}
		});

		await describe('weird objects', async () => {
			for (const [obj, expected] of qsWeirdObjects) {
				await it(`should stringify ${JSON.stringify(obj)} to "${expected}"`, async () => {
					expect(qs.stringify(obj as unknown as Record<string, unknown>)).toBe(expected);
				});
			}
		});

		await describe('noMunge round-trip', async () => {
			for (const [expected, obj] of qsNoMungeTestCases) {
				await it(`should stringify to "${expected}"`, async () => {
					expect(qs.stringify(obj as unknown as Record<string, unknown>, '&', '=')).toBe(expected);
				});
			}
		});

		await it('should coerce numbers to string', async () => {
			expect(qs.stringify({ foo: 0 })).toBe('foo=0');
			expect(qs.stringify({ foo: -0 })).toBe('foo=0');
			expect(qs.stringify({ foo: 3 })).toBe('foo=3');
			expect(qs.stringify({ foo: -72.42 })).toBe('foo=-72.42');
			expect(qs.stringify({ foo: NaN })).toBe('foo=');
			expect(qs.stringify({ foo: Infinity })).toBe('foo=');
		});

		await it('should escape scientific notation (1e21)', async () => {
			expect(qs.stringify({ foo: 1e21 })).toBe('foo=1e%2B21');
		});

		await it('should stringify BigInt values', async () => {
			expect(qs.stringify({ foo: 2n ** 1023n })).toBe('foo=' + (2n ** 1023n));
			expect(qs.stringify([0n, 1n, 2n] as unknown as Record<string, unknown>)).toBe('0=0&1=1&2=2');
		});

		await it('should stringify BigInt with custom encode', async () => {
			expect(qs.stringify({ foo: 2n ** 1023n }, undefined, undefined,
				{ encodeURIComponent: (c: string) => c })).toBe('foo=' + (2n ** 1023n));
		});

		await it('should throw URIError on invalid surrogate pair', async () => {
			expect(() => {
				qs.stringify({ foo: '\udc00' });
			}).toThrow();

			try {
				qs.stringify({ foo: '\udc00' });
			} catch (error) {
				expect(error instanceof URIError).toBeTruthy();
			}
		});

		await it('should stringify nested qs-in-qs', async () => {
			const f = qs.stringify({
				a: 'b',
				q: qs.stringify({ x: 'y', y: 'z' }),
			});
			expect(f).toBe('a=b&q=x%3Dy%26y%3Dz');
		});

		await it('should stringify nested in colon', async () => {
			const f = qs.stringify({
				a: 'b',
				q: qs.stringify({ x: 'y', y: 'z' }, ';', ':'),
			}, ';', ':');
			expect(f).toBe('a:b;q:x%3Ay%3By%3Az');
		});

		await it('should return empty string for non-objects', async () => {
			expect(qs.stringify()).toBe('');
			expect(qs.stringify(0 as unknown as Record<string, unknown>)).toBe('');
			expect(qs.stringify([] as unknown as Record<string, unknown>)).toBe('');
			expect(qs.stringify(null as unknown as Record<string, unknown>)).toBe('');
			expect(qs.stringify(true as unknown as Record<string, unknown>)).toBe('');
		});

		await it('should use custom encodeURIComponent', async () => {
			function demoEncode(str: string) { return str[0]; }
			const obj = { aa: 'aa', bb: 'bb', cc: 'cc' };
			expect(qs.stringify(obj, undefined, undefined, { encodeURIComponent: demoEncode }))
				.toBe('a=a&b=b&c=c');
		});

		await it('should use custom encode for different types', async () => {
			const obj = { number: 1, bigint: 2n, true: true, false: false, object: {} };
			expect(qs.stringify(obj as unknown as Record<string, unknown>, undefined, undefined,
				{ encodeURIComponent: (v: string) => v }))
				.toBe('number=1&bigint=2&true=true&false=false&object=');
		});
	});

	// ==================== escape ====================

	await describe('querystring.escape', async () => {
		await it('should escape numbers', async () => {
			expect(qs.escape(5 as unknown as string)).toBe('5');
		});

		await it('should not escape safe strings', async () => {
			expect(qs.escape('test')).toBe('test');
		});

		await it('should escape objects via toString', async () => {
			expect(qs.escape({} as unknown as string)).toBe('%5Bobject%20Object%5D');
		});

		await it('should escape arrays', async () => {
			expect(qs.escape([5, 10] as unknown as string)).toBe('5%2C10');
		});

		await it('should escape unicode strings', async () => {
			expect(qs.escape('Ŋōđĕ')).toBe('%C5%8A%C5%8D%C4%91%C4%95');
		});

		await it('should escape mixed ascii+unicode', async () => {
			expect(qs.escape('testŊōđĕ')).toBe('test%C5%8A%C5%8D%C4%91%C4%95');
		});

		await it('should escape valid surrogate pair with trailing chars', async () => {
			expect(qs.escape(`${String.fromCharCode(0xD800 + 1)}test`))
				.toBe('%F0%90%91%B4est');
		});

		await it('should throw URIError on lone surrogate', async () => {
			expect(() => qs.escape(String.fromCharCode(0xD800 + 1))).toThrow();
		});

		await it('should prefer toString over valueOf for objects', async () => {
			expect(qs.escape({ test: 5, toString: () => 'test', valueOf: () => 10 } as unknown as string))
				.toBe('test');
		});

		await it('should throw TypeError when toString is not callable', async () => {
			expect(() => qs.escape({ toString: 5 } as unknown as string)).toThrow();
		});

		await it('should use valueOf when toString is not callable', async () => {
			expect(qs.escape({ toString: 5, valueOf: () => 'test' } as unknown as string)).toBe('test');
		});

		await it('should throw TypeError on Symbol', async () => {
			expect(() => qs.escape(Symbol('test') as unknown as string)).toThrow();
		});
	});

	// ==================== unescape / unescapeBuffer ====================

	await describe('querystring.unescape', async () => {
		for (const [input, expected] of qsUnescapeTestCases) {
			await it(`should unescape "${input.substring(0, 40)}..."`, async () => {
				expect(qs.unescape(input)).toBe(expected);
			});
		}
	});

	await describe('querystring.unescapeBuffer', async () => {
		for (const [input, expected] of qsUnescapeTestCases) {
			await it(`should unescapeBuffer "${input.substring(0, 40)}..."`, async () => {
				expect(qs.unescapeBuffer(input).toString()).toBe(expected);
			});
		}

		await it('should decode + as space when decodeSpaces=true', async () => {
			expect(qs.unescapeBuffer('a+b', true).toString()).toBe('a b');
		});

		await it('should not decode + without decodeSpaces', async () => {
			expect(qs.unescapeBuffer('a+b').toString()).toBe('a+b');
		});

		await it('should handle trailing %', async () => {
			expect(qs.unescapeBuffer('a%').toString()).toBe('a%');
		});

		await it('should handle incomplete hex %2', async () => {
			expect(qs.unescapeBuffer('a%2').toString()).toBe('a%2');
		});

		await it('should decode %20 as space', async () => {
			expect(qs.unescapeBuffer('a%20').toString()).toBe('a ');
		});

		await it('should not decode invalid hex %2g', async () => {
			expect(qs.unescapeBuffer('a%2g').toString()).toBe('a%2g');
		});

		await it('should handle double %', async () => {
			expect(qs.unescapeBuffer('a%%').toString()).toBe('a%%');
		});

		await it('should decode hex bytes correctly', async () => {
			const b = qs.unescapeBuffer('%d3%f2Ug%1f6v%24%5e%98%cb%0d%ac%a2%2f%9d%eb%d8%a2%e6');
			expect(b[0]).toBe(0xd3);
			expect(b[1]).toBe(0xf2);
			expect(b[2]).toBe(0x55); // 'U'
			expect(b[3]).toBe(0x67); // 'g'
			expect(b[4]).toBe(0x1f);
			expect(b[5]).toBe(0x36); // '6'
			expect(b[6]).toBe(0x76); // 'v'
			expect(b[7]).toBe(0x24);
			expect(b[8]).toBe(0x5e);
			expect(b[9]).toBe(0x98);
			expect(b[10]).toBe(0xcb);
			expect(b[11]).toBe(0x0d);
			expect(b[12]).toBe(0xac);
			expect(b[13]).toBe(0xa2);
			expect(b[14]).toBe(0x2f);
			expect(b[15]).toBe(0x9d);
			expect(b[16]).toBe(0xeb);
			expect(b[17]).toBe(0xd8);
			expect(b[18]).toBe(0xa2);
			expect(b[19]).toBe(0xe6);
		});
	});

	// ==================== multichar separator ====================

	await describe('querystring multichar separator', async () => {
		await it('should parse with && and =>', async () => {
			check(qs.parse('foo=>bar&&bar=>baz', '&&', '=>'), { foo: 'bar', bar: 'baz' });
		});

		await it('should stringify with && and =>', async () => {
			expect(qs.stringify({ foo: 'bar', bar: 'baz' }, '&&', '=>')).toBe('foo=>bar&&bar=>baz');
		});

		await it('should parse with ", " and "==>"', async () => {
			check(qs.parse('foo==>bar, bar==>baz', ', ', '==>'), { foo: 'bar', bar: 'baz' });
		});

		await it('should stringify with ", " and "==>"', async () => {
			expect(qs.stringify({ foo: 'bar', bar: 'baz' }, ', ', '==>'))
				.toBe('foo==>bar, bar==>baz');
		});
	});

	// ==================== decode / encode aliases ====================

	await describe('querystring aliases', async () => {
		await it('decode should be an alias for parse', async () => {
			expect(qs.decode).toBe(qs.parse);
		});

		await it('encode should be an alias for stringify', async () => {
			expect(qs.encode).toBe(qs.stringify);
		});
	});
};
