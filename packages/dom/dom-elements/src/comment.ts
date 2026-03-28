// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/comment/Comment.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify

import { CharacterData } from './character-data.js';
import { NodeType } from './node-type.js';
import * as PS from './property-symbol.js';

/**
 * Comment node.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/Comment
 */
export class Comment extends CharacterData {
	constructor(data = '') {
		super(data);
		this[PS.nodeType] = NodeType.COMMENT_NODE;
	}

	get nodeName(): string {
		return '#comment';
	}

	cloneNode(_deep = false): Comment {
		return new Comment(this.data);
	}

	get [Symbol.toStringTag](): string {
		return 'Comment';
	}
}
