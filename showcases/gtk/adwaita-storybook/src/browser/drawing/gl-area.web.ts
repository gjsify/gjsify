// Browser port of the GL Area story. Shares metadata with gl-area.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Gtk } from '@gjsify/adwaita-web';
import { glAreaMeta } from '../../drawing/gl-area.meta.js';

const VERTEX_SHADER = `
attribute vec2 position;
uniform float angle;
void main () {
    float c = cos (angle);
    float s = sin (angle);
    gl_Position = vec4 ((position.x * c - position.y * s) * 0.7,
                        (position.x * s + position.y * c) * 0.7,
                        0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
void main () { gl_FragColor = vec4 (0.25, 0.55, 0.9, 1.0); }`;

export class GLAreaWebStory extends StoryElement {
    private _area: Gtk.GLArea | null = null;
    private _readout: HTMLElement | null = null;
    private _frame = 0;
    private _program: WebGLProgram | null = null;
    private _buffer: WebGLBuffer | null = null;
    private _angle = 0;
    private _renders = 0;
    private _viewport = '—';

    constructor() {
        super(GLAreaWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return glAreaMeta;
    }

    initialize(): void {
        this._area = document.createElement('gtk-gl-area') as Gtk.GLArea;
        this._area.style.width = '240px';
        this._area.style.height = '160px';
        this._readout = document.createElement('div');
        this._readout.className = 'adw-gl-area-story-readout';

        // The SAME two signals the GTK story connects, in the SAME order: `resize` arrives
        // before the first `render` and on every later allocation, and its numbers are
        // device pixels (gtkglarea.c:761-763, :797-807).
        this._area.addEventListener('resize', (event: Event) => {
            const { width, height } = (event as CustomEvent).detail as { width: number; height: number };
            this._viewport = `${width} × ${height}`;
            this._refresh();
        });
        this._area.addEventListener('render', (event: Event) => {
            const { context } = (event as CustomEvent).detail as {
                context: WebGLRenderingContext | WebGL2RenderingContext | null;
            };
            if (context) this._draw(context);
            this._renders += 1;
            this._refresh();
        });

        this._apply();
        this._start();
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.gap = '6px';
        box.style.alignItems = 'center';
        box.append(this._area, this._readout);
        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        this._stop();
        this._apply();
        this._start();
    }

    private _apply(): void {
        if (!this._area) return;
        this._area.setAttribute('auto-render', String(this.args.autoRender as boolean));
        this._area.setAttribute('has-depth-buffer', String(this.args.hasDepthBuffer as boolean));
        // `allowed-apis` is refused once the area is realized (gtkglarea.c:1242), so it is
        // set before the first render — which is also what the GTK story does.
        this._area.setAttribute('allowed-apis', this.args.allowedApis as string);
    }

    /**
     * `queue_render()` is how a GL application asks for the next frame (gtkglarea.c:1465).
     * The browser's frame clock is `requestAnimationFrame`, and the element coalesces
     * through it, so this is a scheduler rather than a synchronous draw.
     */
    private _start(): void {
        if (!this.args.spinning) return;
        const step = () => {
            this._angle += 0.05;
            this._area?.queueRender();
            this._frame = requestAnimationFrame(step);
        };
        this._frame = requestAnimationFrame(step);
    }

    private _stop(): void {
        if (this._frame !== 0) cancelAnimationFrame(this._frame);
        this._frame = 0;
    }

    /** The triangle the GTK story cannot draw here: a program, a buffer and a draw call. */
    private _draw(context: WebGLRenderingContext | WebGL2RenderingContext): void {
        // WebGL2 extends WebGL, so one `instanceof` covers both.
        if (!(context instanceof WebGLRenderingContext)) return;
        if (!this._program) this._build(context);
        const program = this._program;
        // `_build` compiles and links; a driver that refuses either leaves nothing to draw,
        // which is the end of this frame rather than an error thrown out of the handler.
        if (program === null) return;
        context.clearColor(0.15, 0.16, 0.18, 1);
        context.clear(context.COLOR_BUFFER_BIT);
        context.useProgram(program);
        context.uniform1f(context.getUniformLocation(program, 'angle'), this._angle);
        context.bindBuffer(context.ARRAY_BUFFER, this._buffer);
        context.enableVertexAttribArray(0);
        context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
        context.drawArrays(context.TRIANGLES, 0, 3);
    }

    /** Compiled once, with the context current — the C's own advice. */
    private _build(context: WebGLRenderingContext | WebGL2RenderingContext): void {
        const compile = (type: number, source: string): WebGLShader | null => {
            const shader = context.createShader(type);
            if (!shader) return null;
            context.shaderSource(shader, source);
            context.compileShader(shader);
            return shader;
        };
        const program = context.createProgram();
        const vertex = compile(context.VERTEX_SHADER, VERTEX_SHADER);
        const fragment = compile(context.FRAGMENT_SHADER, FRAGMENT_SHADER);
        if (!program || !vertex || !fragment) return;
        context.attachShader(program, vertex);
        context.attachShader(program, fragment);
        context.linkProgram(program);
        this._program = program;
        const buffer = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, buffer);
        context.bufferData(
            context.ARRAY_BUFFER,
            new Float32Array([-0.6, -0.6, 0.6, -0.6, 0.0, 0.6]),
            context.STATIC_DRAW,
        );
        this._buffer = buffer;
    }

    private _refresh(): void {
        if (!this._readout) return;
        this._readout.textContent = `viewport ${this._viewport} device px · ${this._renders} renders`;
    }
}

export const GLAreaWebStories: WebStoryModule = { stories: [GLAreaWebStory] };
