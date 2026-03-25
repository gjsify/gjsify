// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/PropertySymbol.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Minimal subset for gjsify — only symbols needed by Node/Element/HTMLElement

// Node
export const nodeType = Symbol('nodeType');
export const parentNode = Symbol('parentNode');
export const childNodesList = Symbol('childNodesList');
export const elementChildren = Symbol('elementChildren');
export const isConnected = Symbol('isConnected');

// Element
export const tagName = Symbol('tagName');
export const localName = Symbol('localName');
export const namespaceURI = Symbol('namespaceURI');
export const prefix = Symbol('prefix');
export const attributes = Symbol('attributes');
export const propertyEventListeners = Symbol('propertyEventListeners');

// Attr
export const name = Symbol('name');
export const value = Symbol('value');
export const ownerElement = Symbol('ownerElement');
