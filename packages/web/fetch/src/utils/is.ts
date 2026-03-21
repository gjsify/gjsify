import { URL } from '@gjsify/url';
import { Blob } from './blob-from.js';

/**
 * Is.js
 *
 * Object type checks.
 */

const NAME = Symbol.toStringTag;

/**
 * Check if `obj` is a URLSearchParams object
 * ref: https://github.com/node-fetch/node-fetch/issues/296#issuecomment-307598143
 * @param {*} object - Object to check for
 * @return {boolean}
 */
export const isURLSearchParameters = object => {
	return (
		typeof object === 'object' &&
		typeof object.append === 'function' &&
		typeof object.delete === 'function' &&
		typeof object.get === 'function' &&
		typeof object.getAll === 'function' &&
		typeof object.has === 'function' &&
		typeof object.set === 'function' &&
		typeof object.sort === 'function' &&
		object[NAME] === 'URLSearchParams'
	);
};

/**
 * Check if `object` is a W3C `Blob` object (which `File` inherits from)
 * @param object Object to check for
 */
export const isBlob = (value: unknown): value is Blob => {
	if (!value || typeof value !== 'object') return false;
	const obj = value as Record<string | symbol, unknown>;
	return (
		typeof obj.arrayBuffer === 'function' &&
		typeof obj.type === 'string' &&
		typeof obj.stream === 'function' &&
		typeof obj.constructor === 'function' &&
		/^(Blob|File)$/.test(obj[NAME] as string)
	);
};

/**
 * Check if `obj` is an instance of AbortSignal.
 * @param object - Object to check for
 */
export const isAbortSignal = (object: unknown): object is AbortSignal => {
	if (typeof object !== 'object' || object === null) return false;
	const obj = object as Record<string | symbol, unknown>;
	return (
		obj[NAME] === 'AbortSignal' ||
		obj[NAME] === 'EventTarget'
	);
};

/**
 * isDomainOrSubdomain reports whether sub is a subdomain (or exact match) of
 * the parent domain.
 *
 * Both domains must already be in canonical form.
 * @param {string|URL} original
 * @param {string|URL} destination
 */
export const isDomainOrSubdomain = (destination, original) => {
	const orig = new URL(original).hostname;
	const dest = new URL(destination).hostname;

	return orig === dest || orig.endsWith(`.${dest}`);
};

/**
 * isSameProtocol reports whether the two provided URLs use the same protocol.
 *
 * Both domains must already be in canonical form.
 * @param {string|URL} original
 * @param {string|URL} destination
 */
export const isSameProtocol = (destination, original) => {
	const orig = new URL(original).protocol;
	const dest = new URL(destination).protocol;

	return orig === dest;
};