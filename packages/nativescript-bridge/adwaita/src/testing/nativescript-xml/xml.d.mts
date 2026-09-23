// Types for the verbatim copy of `@nativescript/core/xml` beside this file — the slice
// `../../blueprint-markup.spec.ts` uses, as `@nativescript/core`'s own `xml/index.d.ts` declares it.

/** One parser event, as `XmlParser`'s `onEvent` callback receives it. */
export interface ParserEvent {
    /** One of {@link ParserEventType}'s members. */
    readonly eventType: string;
    /** Set on `StartElement`/`EndElement`. */
    readonly elementName?: string;
    /** Namespace URI resolved for the element (namespace processing on). */
    readonly namespace?: string;
    /** Namespace prefix: `adw` in `<adw:Clamp>` (namespace processing on). */
    readonly prefix?: string;
    /** Attribute map of a `StartElement` event. */
    readonly attributes?: Record<string, string>;
}

/** The `ParserEvent.eventType` values. */
export declare class ParserEventType {
    static readonly StartElement: string;
    static readonly EndElement: string;
}

/** The non-validating SAX parser `Builder.parse` runs. */
export declare class XmlParser {
    constructor(onEvent: (event: ParserEvent) => void, onError?: (error: Error) => void, processNamespaces?: boolean);
    parse(xmlString: string): void;
}
