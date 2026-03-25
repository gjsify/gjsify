// Ported from refs/deno/tests/unit/dom_exception_test.ts
// Original: Copyright (c) 2018-2026 the Deno authors. MIT license.
// Additional tests based on WebIDL Living Standard (https://webidl.spec.whatwg.org/#idl-DOMException)

import { describe, it, expect } from '@gjsify/unit';

import { DOMException } from 'dom-exception';

export default async () => {

	await describe('DOMException', async () => {

		await describe('constructor', async () => {

			await it('should be constructable with no arguments', async () => {
				const e = new DOMException();
				expect(e.message).toBe('');
				expect(e.name).toBe('Error');
				expect(e.code).toBe(0);
			});

			await it('should be constructable with a message', async () => {
				const e = new DOMException('test message');
				expect(e.message).toBe('test message');
				expect(e.name).toBe('Error');
				expect(e.code).toBe(0);
			});

			await it('should be constructable with message and name', async () => {
				const e = new DOMException('test message', 'NotFoundError');
				expect(e.message).toBe('test message');
				expect(e.name).toBe('NotFoundError');
				expect(e.code).toBe(8);
			});

			await it('should have an empty string message when constructed with undefined', async () => {
				const e = new DOMException(undefined);
				expect(e.message).toBe('');
			});

			await it('should have name "Error" when constructed with undefined name', async () => {
				const e = new DOMException('msg', undefined);
				expect(e.name).toBe('Error');
				expect(e.code).toBe(0);
			});
		});

		await describe('instanceof', async () => {

			await it('should be an instance of DOMException', async () => {
				const e = new DOMException('test');
				expect(e instanceof DOMException).toBeTruthy();
			});

			await it('should be an instance of Error', async () => {
				const e = new DOMException('test');
				expect(e instanceof Error).toBeTruthy();
			});
		});

		await describe('properties', async () => {

			await it('should have a message property', async () => {
				const e = new DOMException('hello');
				expect(e.message).toBe('hello');
			});

			await it('should have a name property', async () => {
				const e = new DOMException('hello', 'AbortError');
				expect(e.name).toBe('AbortError');
			});

			await it('should have a code property', async () => {
				const e = new DOMException('hello', 'AbortError');
				expect(e.code).toBe(20);
			});

			await it('should have a stack property', async () => {
				const e = new DOMException('test');
				expect(typeof e.stack).toBe('string');
			});
		});

		await describe('error code mapping', async () => {

			await it('IndexSizeError should have code 1', async () => {
				const e = new DOMException('', 'IndexSizeError');
				expect(e.code).toBe(1);
				expect(e.name).toBe('IndexSizeError');
			});

			await it('HierarchyRequestError should have code 3', async () => {
				const e = new DOMException('', 'HierarchyRequestError');
				expect(e.code).toBe(3);
				expect(e.name).toBe('HierarchyRequestError');
			});

			await it('WrongDocumentError should have code 4', async () => {
				const e = new DOMException('', 'WrongDocumentError');
				expect(e.code).toBe(4);
				expect(e.name).toBe('WrongDocumentError');
			});

			await it('InvalidCharacterError should have code 5', async () => {
				const e = new DOMException('', 'InvalidCharacterError');
				expect(e.code).toBe(5);
				expect(e.name).toBe('InvalidCharacterError');
			});

			await it('NoModificationAllowedError should have code 7', async () => {
				const e = new DOMException('', 'NoModificationAllowedError');
				expect(e.code).toBe(7);
				expect(e.name).toBe('NoModificationAllowedError');
			});

			await it('NotFoundError should have code 8', async () => {
				const e = new DOMException('', 'NotFoundError');
				expect(e.code).toBe(8);
				expect(e.name).toBe('NotFoundError');
			});

			await it('NotSupportedError should have code 9', async () => {
				const e = new DOMException('', 'NotSupportedError');
				expect(e.code).toBe(9);
				expect(e.name).toBe('NotSupportedError');
			});

			await it('InvalidStateError should have code 11', async () => {
				const e = new DOMException('', 'InvalidStateError');
				expect(e.code).toBe(11);
				expect(e.name).toBe('InvalidStateError');
			});

			await it('SyntaxError should have code 12', async () => {
				const e = new DOMException('', 'SyntaxError');
				expect(e.code).toBe(12);
				expect(e.name).toBe('SyntaxError');
			});

			await it('InvalidModificationError should have code 13', async () => {
				const e = new DOMException('', 'InvalidModificationError');
				expect(e.code).toBe(13);
				expect(e.name).toBe('InvalidModificationError');
			});

			await it('NamespaceError should have code 14', async () => {
				const e = new DOMException('', 'NamespaceError');
				expect(e.code).toBe(14);
				expect(e.name).toBe('NamespaceError');
			});

			await it('InvalidAccessError should have code 15', async () => {
				const e = new DOMException('', 'InvalidAccessError');
				expect(e.code).toBe(15);
				expect(e.name).toBe('InvalidAccessError');
			});

			await it('SecurityError should have code 18', async () => {
				const e = new DOMException('', 'SecurityError');
				expect(e.code).toBe(18);
				expect(e.name).toBe('SecurityError');
			});

			await it('NetworkError should have code 19', async () => {
				const e = new DOMException('', 'NetworkError');
				expect(e.code).toBe(19);
				expect(e.name).toBe('NetworkError');
			});

			await it('AbortError should have code 20', async () => {
				const e = new DOMException('', 'AbortError');
				expect(e.code).toBe(20);
				expect(e.name).toBe('AbortError');
			});

			await it('URLMismatchError should have code 21', async () => {
				const e = new DOMException('', 'URLMismatchError');
				expect(e.code).toBe(21);
				expect(e.name).toBe('URLMismatchError');
			});

			await it('QuotaExceededError should have code 22', async () => {
				const e = new DOMException('', 'QuotaExceededError');
				expect(e.code).toBe(22);
				expect(e.name).toBe('QuotaExceededError');
			});

			await it('TimeoutError should have code 23', async () => {
				const e = new DOMException('', 'TimeoutError');
				expect(e.code).toBe(23);
				expect(e.name).toBe('TimeoutError');
			});

			await it('DataCloneError should have code 25', async () => {
				const e = new DOMException('', 'DataCloneError');
				expect(e.code).toBe(25);
				expect(e.name).toBe('DataCloneError');
			});
		});

		await describe('unknown error names', async () => {

			await it('should have code 0 for unknown name', async () => {
				const e = new DOMException('test', 'CustomError');
				expect(e.code).toBe(0);
				expect(e.name).toBe('CustomError');
			});

			await it('should have code 0 for OperationError', async () => {
				const e = new DOMException('test', 'OperationError');
				expect(e.code).toBe(0);
				expect(e.name).toBe('OperationError');
			});

			await it('should have code 0 for EncodingError', async () => {
				const e = new DOMException('test', 'EncodingError');
				expect(e.code).toBe(0);
				expect(e.name).toBe('EncodingError');
			});

			await it('should not be affected by Object.prototype pollution', async () => {
				const newCode = 100;
				const objectPrototype = Object.prototype as unknown as {
					pollution: number;
				};
				objectPrototype.pollution = newCode;
				try {
					const e = new DOMException('test', 'pollution');
					expect(e.code).not.toBe(newCode);
					expect(e.code).toBe(0);
				} finally {
					Reflect.deleteProperty(objectPrototype, 'pollution');
				}
			});
		});
	});
};
