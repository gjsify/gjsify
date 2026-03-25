// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/config/NamespaceURI.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — only commonly used namespaces

export const NamespaceURI = {
	html: 'http://www.w3.org/1999/xhtml',
	svg: 'http://www.w3.org/2000/svg',
	mathML: 'http://www.w3.org/1998/Math/MathML',
	xml: 'http://www.w3.org/XML/1998/namespace',
	xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;
