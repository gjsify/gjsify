// `gi://Graphene` answered by the renderer: `Point.zero()`, the `{ x, y }` constructor, and an
// absent member refused by name.
import Graphene from 'gi://Graphene?version=1.0';

export const kind = typeof Graphene.Point.zero;

export async function exercise(): Promise<Record<string, unknown>> {
    const zero = Graphene.Point.zero();
    const made = new Graphene.Point({ x: 3, y: -4 });
    let refusal = '';
    try {
        void (Graphene as unknown as Record<string, unknown>).Rect;
    } catch (error) {
        refusal = (error as Error).message;
    }
    return { zero: [zero.x, zero.y], made: [made.x, made.y], refusesRect: refusal.includes('Rect') };
}
