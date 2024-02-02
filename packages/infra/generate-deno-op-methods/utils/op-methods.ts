import type { OpMethod } from "../types.ts";

/**
 * Filter method names by a glob prefix
 * @param {string[]} methods - Array of method names
 * @param {string} prefix - The glob prefix to filter by
 * @returns {string[]} - The filtered method names
 */
export function filterMethodsByPrefix(
  methods: OpMethod[],
  prefix: string,
): OpMethod[] {
  // Create a regular expression from the prefix
  const glob = new RegExp(`^${prefix}`);
  return methods.filter((method) => glob.test(method.functionName));
}
