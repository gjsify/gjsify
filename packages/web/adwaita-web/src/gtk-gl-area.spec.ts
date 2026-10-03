// DOM-level tests for <gtk-gl-area>. What is worth pinning here is the ORDER the C's
// snapshot runs in and the two flags it clears — a GL application that gets `::render`
// before the first `::resize` draws into a viewport nobody told it about, and a flag
// cleared too early loses the frame `queue_render()` asked for from inside `::render`.
//
// Every signal the C emits needs a context (`gtkglarea.c:781-782` returns before
// `::resize` without one), so these tests bring their own through `::create-context`.
// Whether the BROWSER can hand out WebGL is a property of the machine — headless
// Firefox says no — and a test that rests on it reports the machine, not the element.
// See `stubContext`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkGLArea } from './elements/gtk-gl-area.js';

/**
 * A context that remembers what was switched on, because that is the whole surface the
 * element touches (`attachBuffers` and the snapshot call `enable`/`disable`; `isEnabled`
 * is how a test reads the result back) plus the two capability names it passes them.
 *
 * WHY A STUB AND NOT THE BROWSER'S OWN: `gtk_gl_area_render` returns at
 * `if (priv->context == NULL)` BEFORE it emits `::resize` (gtkglarea.c:781-782), so
 * every signal below depends on a context existing. Chromium hands one out from
 * software GL on a headless runner; Firefox does not, and then every test that waits
 * for a signal waits forever and reports an empty list. That is a fact about the
 * machine, not about the element — so a test may not rest on it. `::create-context`
 * is the documented way in (gtkglarea.c:1086-1109; the element reads `detail.context`
 * and asks the canvas only when nobody supplied one), which is what this uses.
 */
function stubContext(): WebGLRenderingContext {
    const enabled = new Set<number>();
    return {
        DEPTH_TEST: 0x0b71,
        STENCIL_TEST: 0x0b90,
        enable: (capability: number) => void enabled.add(capability),
        disable: (capability: number) => void enabled.delete(capability),
        isEnabled: (capability: number) => enabled.has(capability),
    } as unknown as WebGLRenderingContext;
}

/**
 * `context: 'stub'` (the default) gives the element a context of its own, so a test
 * measures the element. `'canvas'` leaves the browser to answer — only the test that is
 * ABOUT the canvas path uses it, and it asks through a recording stub. `'none'` is for
 * the tests that bring their own `create-context` handler.
 */
function mount(
    attrs: Record<string, string> = {},
    context: 'stub' | 'canvas' | 'none' = 'stub',
): { el: GtkGLArea; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-gl-area') as GtkGLArea;
    el.style.width = '120px';
    el.style.height = '90px';
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    // Before the element is in the tree: the handler is read on the first draw, and the
    // first draw needs an observer record, so it must not be attached after insertion.
    if (context === 'stub') {
        el.addEventListener('create-context', (event) => {
            (event as CustomEvent).detail['context'] = stubContext();
        });
    }
    host.appendChild(el);
    return { el, host };
}

/**
 * Three frames, and the order is the reason: the element draws in an animation frame
 * that a `ResizeObserver` record schedules, and the platform delivers that record
 * AFTER the animation-frame callbacks of the frame it belongs to — so the draw lands in
 * the frame after the one that observed. Two is what Chromium happens to need, and the
 * count is not a property of the element.
 */
function settled(): Promise<void> {
    return new Promise((resolve) => {
        let frames = 0;
        const tick = (): void => {
            frames += 1;
            if (frames >= 3) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

export const GtkGLAreaTest = async () => {
    await describe('<gtk-gl-area> defaults', async () => {
        await it('starts with the GIR defaults and needs_render already set', () => {
            // gtkglarea.c:1101-1105 — auto_render TRUE, needs_render TRUE, allowed APIs
            // `GDK_GL_API_GL | GDK_GL_API_GLES`.
            const { el, host } = mount();
            expect(el.autoRender).toBe(true);
            expect(el.hasDepthBuffer).toBe(false);
            expect(el.hasStencilBuffer).toBe(false);
            expect(el.allowedApis).toStrictEqual(['gl', 'gles']);
            expect(el.context).toBe(null);
            expect(el.error).toBe(null);
            // `get_api` reads 0 — GDK_GL_API_GL — until a context exists.
            expect(el.api).toBe('gl');
            host.remove();
        });

        await it('reads allowed-apis as a SET of nicks', () => {
            // g_param_spec_flags ("allowed-apis", …) at :983.
            const { el, host } = mount({ 'allowed-apis': 'gles' });
            expect(el.allowedApis).toStrictEqual(['gles']);
            el.allowedApis = ['gl'];
            expect(el.allowedApis).toStrictEqual(['gl']);
            el.allowedApis = ['gl', 'gles'];
            expect(el.allowedApis).toStrictEqual(['gl', 'gles']);
            host.remove();
        });

        await it('notifies only on a real change', () => {
            const { el, host } = mount();
            const seen: unknown[] = [];
            el.addEventListener('notify::auto-render', (event) =>
                seen.push((event as CustomEvent).detail['auto-render']),
            );
            el.autoRender = true;
            expect(seen).toStrictEqual([]);
            el.autoRender = false;
            expect(seen).toStrictEqual([false]);
            host.remove();
        });
    });

    await describe('<gtk-gl-area> the snapshot order', async () => {
        await it('emits resize before the first render', async () => {
            // gtkglarea.c:797-807 — the order is the whole point of `needs_resize`.
            const { el, host } = mount();
            const order: string[] = [];
            el.addEventListener('resize', () => order.push('resize'));
            el.addEventListener('render', () => order.push('render'));
            await settled();
            expect(order).toStrictEqual(['resize', 'render']);
            host.remove();
        });

        await it('hands the resize signal the DEVICE-pixel viewport', async () => {
            // gtkglarea.c:761-763 — `w = gtk_widget_get_width (widget) * scale`.
            const { el, host } = mount();
            const seen: { width: number; height: number }[] = [];
            el.addEventListener('resize', (event) =>
                seen.push((event as unknown as CustomEvent<{ width: number; height: number }>).detail),
            );
            await settled();
            const scale = el.pixelScale;
            expect(seen[0].width).toBe(Math.round(120 * scale));
            expect(seen[0].height).toBe(Math.round(90 * scale));
            expect(el.viewport).toStrictEqual({ width: Math.round(120 * scale), height: Math.round(90 * scale) });
            host.remove();
        });

        await it('emits resize again only when the allocation changed', async () => {
            const { el, host } = mount();
            let resizes = 0;
            el.addEventListener('resize', () => {
                resizes += 1;
            });
            await settled();
            const first = resizes;
            el.queueRender();
            expect(resizes).toBe(first);
            el.style.width = '160px';
            await settled();
            expect(resizes).toBe(first + 1);
            host.remove();
        });

        await it('clears needs_render AFTER the signal, so a queue inside it stacks nothing', async () => {
            // gtkglarea.c:800-811 — `priv->needs_render = FALSE` comes AFTER the emit, so
            // a `queue_render()` from a handler has its flag overwritten: the frame is
            // queued, the flag is not. With auto-render off that is ONE render and no
            // runaway — which is also why a GL animation asks per tick rather than from
            // inside `::render`.
            const { el, host } = mount({ 'auto-render': 'false' });
            let renders = 0;
            const onRender = () => {
                renders += 1;
                el.queueRender();
            };
            el.addEventListener('render', onRender);
            await settled();
            expect(renders).toBe(1);
            el.removeEventListener('render', onRender);
            host.remove();
        });

        await it('emits no render with auto_render off, until something queues one', async () => {
            // gtkglarea.c:800 — `if (priv->needs_render || priv->auto_render)`.
            const { el, host } = mount({ 'auto-render': 'false' });
            let renders = 0;
            el.addEventListener('render', () => {
                renders += 1;
            });
            await settled();
            const first = renders;
            el.queueRender();
            await settled();
            expect(renders).toBe(first + 1);
            host.remove();
        });

        await it('draws nothing at an empty allocation', async () => {
            // gtkglarea.c:767-768 — `if (w == 0 || h == 0) return;`.
            const { el, host } = mount();
            let renders = 0;
            el.addEventListener('render', () => {
                renders += 1;
            });
            await settled();
            const seen = renders;
            el.style.width = '0px';
            el.queueRender();
            expect(renders).toBe(seen);
            host.remove();
        });
    });

    await describe('<gtk-gl-area> the context', async () => {
        await it('is created from the canvas, newest API first, and never desktop GL', async () => {
            // The subject is WHERE the context comes from and in what order the element
            // asks for it. It is not whether this browser implements GL: a real
            // `getContext('webgl2')` on the headless Firefox runner returns null, which
            // would say nothing about the element. So the canvas answers through a
            // recording stub, and the two facts the old assertion could not check — the
            // order, and that `gl` is never asked for — come out with it.
            const { el, host } = mount({}, 'canvas');
            const asked: string[] = [];
            const canvas = el.querySelector('canvas') as HTMLCanvasElement;
            canvas.getContext = ((name: string) => {
                asked.push(name);
                return { enable() {}, disable() {} };
            }) as HTMLCanvasElement['getContext'];
            await settled();
            expect(asked).toStrictEqual(['webgl2', 'webgl']);
            expect(el.api).toBe('gles');
            host.remove();
        });

        await it('is not created when allowed-apis names neither API', async () => {
            // The no-context branch of the snapshot (:776-777) — nothing is drawn.
            const { el, host } = mount({ 'allowed-apis': '' });
            let renders = 0;
            el.addEventListener('render', () => {
                renders += 1;
            });
            await settled();
            expect(el.context).toBe(null);
            expect(renders).toBe(0);
            host.remove();
        });

        await it('takes the context a create-context handler supplied', async () => {
            // gtkglarea.c:1086-1109 — a handler RETURNS the context; a browser event has
            // no return channel, so the detail object carries it (see the header).
            const { el, host } = mount({}, 'none');
            const spare = {
                DEPTH_TEST: 1,
                STENCIL_TEST: 2,
                enable() {},
                disable() {},
            } as unknown as WebGLRenderingContext;
            let detail: { context: unknown } | null = null;
            el.addEventListener('create-context', (event) => {
                detail = (event as CustomEvent).detail as { context: unknown };
                detail.context = spare;
            });
            await settled();
            expect(detail).not.toBe(null);
            // A stub is what the handler put there; the element uses it as given, which is
            // what the C does with a handler's context. It carries the two calls every draw
            // makes, because an object without them throws out of the next frame.
            expect(el.context).toBe(spare);
            host.remove();
        });

        await it('refuses a changed allowed-apis once the area is realized', async () => {
            // gtkglarea.c:1242 — `g_return_if_fail (!gtk_widget_get_realized (…))`. The
            // context is built from the set once, so a later write is undone: the attribute
            // goes back to the set in force and nothing notifies (the C only warns).
            const { el, host } = mount();
            await settled();
            expect(el.context).not.toBe(null);
            const notified: string[] = [];
            el.addEventListener('notify::allowed-apis', () => notified.push('notify'));
            el.allowedApis = ['gl'];
            expect(el.allowedApis).toStrictEqual(['gl', 'gles']);
            expect(el.getAttribute('allowed-apis')).toBe('gl gles');
            expect(notified).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-gl-area> buffers and errors', async () => {
        await it('enables the depth test only when the depth buffer is asked for', async () => {
            // gtkglarea.c:782-785 — `glEnable`/`glDisable (GL_DEPTH_TEST)`, in the SNAPSHOT,
            // not in `attach_buffers`. Neither buffer setter queues a redraw (:1391-1396), so
            // the application asks for the frame that applies it — exactly as it would in GTK.
            const { el, host } = mount();
            await settled();
            const context = el.context;
            expect(context).not.toBe(null);
            expect(context?.isEnabled((context as WebGLRenderingContext).DEPTH_TEST)).toBe(false);
            el.hasDepthBuffer = true;
            el.queueRender();
            await settled();
            expect(context?.isEnabled((context as WebGLRenderingContext).DEPTH_TEST)).toBe(true);
            host.remove();
        });

        await it('attaches the stencil buffer when asked for, through attach_buffers', async () => {
            // gtkglarea.c:583-618 — the renderbuffer the two setters drop `have_buffers` for.
            const { el, host } = mount();
            await settled();
            const context = el.context as WebGLRenderingContext;
            el.hasStencilBuffer = true;
            el.attachBuffers(context);
            expect(context.isEnabled(context.STENCIL_TEST)).toBe(true);
            el.hasStencilBuffer = false;
            el.attachBuffers(context);
            expect(context.isEnabled(context.STENCIL_TEST)).toBe(false);
            host.remove();
        });

        await it('shows the error message over the widget and draws nothing', async () => {
            // gtkglarea.c:769-775 and `gtk_gl_area_draw_error_screen` at :701-723.
            const { el, host } = mount();
            let renders = 0;
            el.addEventListener('render', () => {
                renders += 1;
            });
            await settled();
            const seen = renders;
            el.setError('could not create GL context');
            await settled();
            expect(el.error).toBe('could not create GL context');
            expect(el.querySelector('.adw-gl-area-error')?.textContent).toBe('could not create GL context');
            expect(renders).toBe(seen);
            // The canvas is still there: GTK replaces a frame's contents, not the node.
            expect(el.querySelector('canvas')).not.toBe(null);
            host.remove();
        });

        await it('takes an Error as readily as its message, and clears on null', () => {
            const { el, host } = mount();
            el.setError(new Error('GL error'));
            expect(el.error).toBe('GL error');
            el.setError(null);
            expect(el.error).toBe(null);
            expect(el.querySelector('.adw-gl-area-error')).toBe(null);
            host.remove();
        });
    });
};
