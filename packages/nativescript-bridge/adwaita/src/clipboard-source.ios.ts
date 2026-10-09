// Publishing text on iOS: `UIPasteboard.generalPasteboard.string`. Unverified on a device (ADR 0096
// Amendment 2); the API is the documented one.

declare const UIPasteboard: any;

export function writePlatformText(text: string): void {
    UIPasteboard.generalPasteboard.string = text;
}
