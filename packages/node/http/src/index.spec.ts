import { describe, it, expect } from '@gjsify/unit';

import * as http from 'http';
import type { validateHeaderName as gjsifyValidateHeaderName, validateHeaderValue as gjsifyValidateHeaderValue } from './index.js';

// TODO: Add types to @types/node
const validateHeaderName: typeof gjsifyValidateHeaderName = (http as any).validateHeaderName;
const validateHeaderValue: typeof gjsifyValidateHeaderValue = (http as any).validateHeaderValue;

export default async () => {

	await describe('http.validateHeaderName', async () => {
		await it('should be a function', async () => {
			expect(typeof validateHeaderName).toBe("function");
		});
	});

	await describe('http.validateHeaderValue', async () => {
		await it('should be a function', async () => {
			expect(typeof validateHeaderValue).toBe("function");
		});
	});

}
