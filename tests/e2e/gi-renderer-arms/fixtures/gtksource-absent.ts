// `GtkSource.GutterRendererText` is real GtkSourceView API that neither renderer ships yet (the
// gutter is a later slice). Reading it must be a named refusal, not `undefined`.
import GtkSource from 'gi://GtkSource?version=5';

export const kind = typeof GtkSource.View;

export function reachAbsentMember(): unknown {
    return (GtkSource as unknown as Record<string, unknown>).GutterRendererText;
}
