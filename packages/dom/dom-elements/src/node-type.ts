// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/node/NodeTypeEnum.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.

export const NodeType = {
	ELEMENT_NODE: 1,
	ATTRIBUTE_NODE: 2,
	TEXT_NODE: 3,
	CDATA_SECTION_NODE: 4,
	PROCESSING_INSTRUCTION_NODE: 7,
	COMMENT_NODE: 8,
	DOCUMENT_NODE: 9,
	DOCUMENT_TYPE_NODE: 10,
	DOCUMENT_FRAGMENT_NODE: 11,
} as const;
