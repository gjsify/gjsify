// The slice of UIKit/Foundation `native-editor.ios.ts` calls, typed structurally.
//
// `UI*` / `NS*` / `CG*` are globals the NativeScript iOS runtime injects (the ObjC bridge).
// `@nativescript/types-ios` describes all of it but is not installed here — nothing in this
// workspace depends on it, and every `*.ios.ts` already in the bridge (`icons.ios.ts`,
// `screenshot.ios.ts`, `window-insets-source.ios.ts`) declares the members it uses instead.
// This file is that answer for the editor, and the sibling of `android-types.ts`: naming the
// used members also gives one list to keep in step when UIKit's shape changes under us.

export interface CGPoint {
    x: number;
    y: number;
}

export interface CGSize {
    width: number;
    height: number;
}

export interface CGRect {
    origin: CGPoint;
    size: CGSize;
}

/** `NSRange`. UTF-16 code units, so a `location` IS a JS string index. */
export interface NSRangeValue {
    location: number;
    length: number;
}

export interface UIEdgeInsetsValue {
    top: number;
    left: number;
    bottom: number;
    right: number;
}

/** An ObjC class as the bridge exposes it: `new` is `+new`, `extend` makes a subclass. */
export interface ObjCClass<T> {
    new: () => T;
    extend(implementation: object, options?: { name?: string; protocols?: readonly unknown[] }): ObjCClass<T>;
}

export interface UIColorInstance {
    /** Makes this the fill colour of the current graphics context, for `UIRectFill`. */
    setFill(): void;
}

export interface UIFontDescriptorInstance {
    /** `null` when the family has no face for the traits — a monospace family with no italic. */
    fontDescriptorWithSymbolicTraits(traits: number): UIFontDescriptorInstance | null;
}

export interface UIFontInstance {
    readonly pointSize: number;
    readonly fontDescriptor: UIFontDescriptorInstance;
}

/** The attribute bag an attributed string takes; the keys are the `NS*AttributeName` globals. */
export type TextAttributes = Record<string, unknown>;

export interface NSTextStorageInstance {
    readonly length: number;
    readonly string: string;
    beginEditing(): void;
    endEditing(): void;
    setAttributesRange(attributes: TextAttributes, range: NSRangeValue): void;
    addAttributesRange(attributes: TextAttributes, range: NSRangeValue): void;
    /** The programmatic edit. It does NOT call the text view's delegate, which is why `applying` guards nothing here. */
    replaceCharactersInRangeWithString(range: NSRangeValue, string: string): void;
}

export interface NSTextContainerInstance {
    size: CGSize;
    widthTracksTextView: boolean;
    lineFragmentPadding: number;
}

export interface NSLayoutManagerInstance {
    readonly numberOfGlyphs: number;
    /** The rect of the trailing empty line; only meaningful when the text ends in a newline. */
    readonly extraLineFragmentRect: CGRect;
    glyphIndexForCharacterAtIndex(index: number): number;
    /** `null` for the out-parameter: this driver never wants the effective glyph range back. */
    lineFragmentRectForGlyphAtIndexEffectiveRange(index: number, effective: null): CGRect;
    locationForGlyphAtIndex(index: number): CGPoint;
    ensureLayoutForTextContainer(container: NSTextContainerInstance): void;
}

export interface UIViewNative {
    frame: CGRect;
    bounds: CGRect;
    backgroundColor: UIColorInstance | null;
    opaque: boolean;
    clipsToBounds: boolean;
    /** Set on the views this driver creates, as the Android driver sets it on its `EditText`. */
    driver?: object;
    addSubview(view: UIViewNative): void;
    removeFromSuperview(): void;
    setNeedsDisplay(): void;
}

export interface UITextViewNative extends UIViewNative {
    text: string;
    font: UIFontInstance | null;
    textColor: UIColorInstance | null;
    tintColor: UIColorInstance | null;
    editable: boolean;
    selectable: boolean;
    selectedRange: NSRangeValue;
    contentOffset: CGPoint;
    contentSize: CGSize;
    textContainerInset: UIEdgeInsetsValue;
    alwaysBounceHorizontal: boolean;
    showsHorizontalScrollIndicator: boolean;
    readonly textStorage: NSTextStorageInstance;
    readonly textContainer: NSTextContainerInstance;
    /** Reading it pins the view to TextKit 1 — the reason `native-editor.ios.ts` reads it early. */
    readonly layoutManager: NSLayoutManagerInstance;
    delegate: unknown;
    /** `UIScrollViewKeyboardDismissMode`: a `UITextView` IS a `UIScrollView`. */
    keyboardDismissMode: number;
    /** The bar shown above the keyboard; this is how a `UITextView` gets a "Done" button. */
    inputAccessoryView: UIViewNative | null;
    resignFirstResponder(): boolean;
}

/** Opaque: this driver only ever puts these into a `UIToolbar.items` array. */
export interface UIBarButtonItemInstance {}

export interface UIButtonInstance extends UIViewNative {
    setTitleForState(title: string, state: number): void;
    addActionForControlEvents(action: unknown, events: number): void;
}

export interface UIToolbarInstance extends UIViewNative {
    items: UIBarButtonItemInstance[] | null;
    sizeToFit(): void;
    setItemsAnimated(items: UIBarButtonItemInstance[], animated: boolean): void;
}

export interface NSStringInstance {
    drawAtPointWithAttributes(point: CGPoint, attributes: TextAttributes): void;
    sizeWithAttributes(attributes: TextAttributes): CGSize;
}
