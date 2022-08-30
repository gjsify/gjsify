import { describe, it, expect } from '@gjsify/unit';

import * as http from 'http';
import type { validateHeaderName as gjsifyValidateHeaderName, validateHeaderValue as gjsifyValidateHeaderValue } from './index.js';

// TODO: Add types to @types/node
const validateHeaderName: typeof gjsifyValidateHeaderName = (http as any).validateHeaderName;
const validateHeaderValue: typeof gjsifyValidateHeaderValue = (http as any).validateHeaderValue;

export default async () => {

	const validNames = ['Content-Type', 'set-cookie', 'alfa-beta'];
	const invalidNames = ['@@wdjhgw'];
	const expectedErrorMessage = (name: any) => `Header name must be a valid HTTP token ["${name}"]`;

	await describe('http.validateHeaderName', async () => {
		await it('should be a function', async () => {
			expect(typeof validateHeaderName).toBe("function");
		});

		await it('an empty string should be not valid and throw an error', async () => {
			expect(() => {
				validateHeaderName('');
			}).toThrow();
		});

		await it('an empty string should be throw an error which is an instance of TypeError', async () => {
			try {
				validateHeaderName('');
			} catch (error) {
				expect(error instanceof TypeError).toBeTruthy();			
			}			
		});

		await it(`an empty string should be throw an error with the message of "${expectedErrorMessage('')}"`, async () => {
			try {
				validateHeaderName('');
			} catch (error) {
				expect(error.message).toBe(expectedErrorMessage(''));			
			}			
		});

		await it(`a number should be throw an error with the message of "${expectedErrorMessage(100)}"`, async () => {
			try {
				validateHeaderName(100 as any);
			} catch (error) {
				expect(error.message).toBe(expectedErrorMessage(100));			
			}			
		});

		for (const validName of validNames) {
			await it(`"${validName}" should be valid and not throw any error`, async () => {
				expect(() => {
					validateHeaderName(validName);
				}).not?.toThrow();	
			});
		}

		for (const invalidName of invalidNames) {
			await it(`"${invalidName}" should be not valid and throw an error`, async () => {
				expect(() => {
					validateHeaderName(invalidName);
				}).toThrow();				
			});
		}
	});

	await describe('http.validateHeaderValue', async () => {
		await it('should be a function', async () => {
			expect(typeof validateHeaderValue).toBe("function");
		});
	});

}
