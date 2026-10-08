// A GI namespace no widget renderer stands behind (Soup is HTTP, so no arm will ever answer it).
// Under the arm this is a BUILD-time refusal; without it, the specifier becomes an empty module
// and `Soup.Session` is `undefined`.
import Soup from 'gi://Soup?version=3.0';

export const kind = typeof Soup.Session;
