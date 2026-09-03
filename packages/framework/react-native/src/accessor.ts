/**
 * `max-length` → `maxLength`: the spelling GJS installs the JS accessor under.
 *
 * Its own module because THREE things need it and two of them may not import the
 * third: the React components read an event's `read` property off a widget,
 * `announce.ts` reads a live region's message off one, and neither may pull the
 * other's dependencies — `announce.ts` must stay free of React so the Solid binding
 * can use it, and `components.ts` is React by definition.
 */
export const accessor = (name: string): string => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
