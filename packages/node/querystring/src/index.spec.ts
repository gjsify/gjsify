import { describe, it, expect } from '@gjsify/unit';
import qs from 'querystring';

// TODO: Port more tests from https://github.com/SpainTrain/querystring-es3/tree/master/test

export default async () => {
	await describe('querystring', async () => {
		await it('performs basic parsing', async () => {
			expect(qs.parse('id=918854443121279438895193').id).toBe('918854443121279438895193');
		});
	});

	await it('test stringifying invalid surrogate pair throws URIError', async () => {
		expect(() => {
			qs.stringify({ foo: '\udc00' });
		}).toThrow();

		try {
			qs.stringify({ foo: '\udc00' });
		} catch (error) {
			expect(error instanceof URIError).toBeTruthy();
		}		
	});


	await it('test stringifying coerce numbers to string', async () => {
		expect('foo=0').toBe(qs.stringify({ foo: 0 }));
		expect('foo=0').toBe(qs.stringify({ foo: -0 }));
		expect('foo=3').toBe(qs.stringify({ foo: 3 }));
		expect('foo=-72.42').toBe(qs.stringify({ foo: -72.42 }));
		expect('foo=').toBe(qs.stringify({ foo: NaN }));
		expect('foo=').toBe(qs.stringify({ foo: Infinity }));
	});

	await it('test stringifying nested', async () => {
		const f = qs.stringify({
			a: 'b',
			q: qs.stringify({
				x: 'y',
				y: 'z'
			})
		});
		expect(f).toBe('a=b&q=x%3Dy%26y%3Dz');
	});

	await it('test stringifying nested in colon', async () => {
		const f = qs.stringify({
			a: 'b',
			q: qs.stringify({
				x: 'y',
				y: 'z'
			}, ';', ':')
		}, ';', ':');
		expect(f).toBe('a:b;q:x%3Ay%3By%3Az');
	});

	await it('test stringifying empty string', async () => {
		expect(qs.stringify()).toBe('');
		expect(qs.stringify(0 as any)).toBe('');
		expect(qs.stringify([] as any)).toBe('');
		expect(qs.stringify(null as any)).toBe('');
		expect(qs.stringify(true as any)).toBe('');
	
		// TODO
		// expect((qs as any).parse()).toBeEmptyObject();
	});
}
