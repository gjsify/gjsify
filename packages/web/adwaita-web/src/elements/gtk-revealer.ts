// <gtk-revealer> — shows and hides its child with an animation.
//
// THREE attributes, two of them the animation's own vocabulary:
//
//   reveal-child         the direction flag. `true` animates the position to 1,
//                        `false` back to 0 (gtk_revealer_set_reveal_child).
//   transition-type      one of fourteen nicks (`slide-down` is the pspec default,
//                        gtkrevealer.c:120-128). Unknown leaves the default, the answer
//                        GtkBuilder gives an unrecognised enum nick.
//   transition-duration  milliseconds; `0` skips the animation altogether
//                        (gtk_revealer_start_animation, gtkrevealer.c:227-233).
//
// `child-revealed` is READ-ONLY and deliberately NOT the inverse of `reveal-child`:
// `gtk_revealer_get_child_revealed` (gtkrevealer.c:843-851) inverts it while an animation
// is RUNNING, so a revealer that is closing reports `true` until the position lands. That
// is the flag a caller waits on, and the one this element publishes.
//
// THE GEOMETRY IS THE C'S, AND NOT A CSS TRANSITION. `gtk_revealer_size_allocate`
// (gtkrevealer.c:449-598) does two things a `transition: transform` cannot:
//
//   1. it MEASURES the revealer at `child × scale` (gtk_revealer_measure,
//      gtkrevealer.c:620-654: `ceil (minimum * scale)`) while ALLOCATING the child at its
//      UNSCALED size, so the child renders at full size instead of ellipsizing — the
//      comment there says why, and a scaled paint would get it exactly wrong. So the clip
//      box below is sized to `ceil(natural × scale)` and the child inside it is never
//      scaled, which is what `_clipEl`'s height/width is for.
//   2. it translates the child by the OVERFLOW (`width - child_width`), not by a
//      percentage of the clip box. Both agree at the ends, and the pixel form is what the
//      C writes.
//
// `get_child_size_scale` (gtkrevealer.c:144-186) is the whole of the axis question: a
// slide scales one axis by the position, a SWING scales it by `sin (π · pos / 2)` — the
// fold, which is why a swing's box grows like a square root and not linearly — and `none`
// / `crossfade` scale neither. Opacity comes from `get_is_fading_type`
// (gtkrevealer.c:189-210) and only WHILE the animation runs: `gtk_revealer_snapshot`
// (gtkrevealer.c:657-679) reads `animation_running = target_pos != current_pos` and turns the
// fade off the moment it stops, so a settled crossfade is opaque rather than left at
// whatever opacity it landed on.
//
// `effective_transition` (gtkrevealer.c:121-141) mirrors every left/right pair in an RTL
// row, so `slide-right` slides in from the visual right there — `:dir(rtl)` decides it,
// the same way `_widget.scss` decides which side an alignment's auto margin goes to.
//
// The revealer's own allocation is `natural × scale` on each axis, because that is what
// `gtk_revealer_size_allocate` received and passes straight on to the child
// (gtkrevealer.c:451-459); the perspective depth below is computed from those numbers
// rather than measured, which is both cheaper than a per-frame read and closer to the C.
//
// A11Y: `role="group"`, GtkRevealer's own role (gtkrevealer.c:58). The child is NEVER
// marked hidden — the doc section says it "is always available in the accessibility tree,
// regardless of the state of the revealer widget" (gtkrevealer.c:61-63), which is why the
// collapse is `overflow` clipping rather than `display: none` or `visibility: hidden`:
// both of those would take it out of the tree, and clipping does not.
//
// Reference: refs/gtk/gtk/gtkrevealer.c (every property, the transition table)
// Reference: refs/gtk/gtk/gtkprogresstracker.c (ease_out_cubic, the frame clock)
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { easeOutCubic } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';

/** Every `GtkRevealerTransitionType` nick, in GIR order. */
const TRANSITION_TYPES = [
    'none',
    'crossfade',
    'slide-right',
    'slide-left',
    'slide-up',
    'slide-down',
    'swing-right',
    'swing-left',
    'swing-up',
    'swing-down',
    'fade-slide-right',
    'fade-slide-left',
    'fade-slide-up',
    'fade-slide-down',
] as const;

export type RevealerTransitionType = (typeof TRANSITION_TYPES)[number];

/** `Gtk.Revealer:transition-type`'s pspec default — `GTK_REVEALER_TRANSITION_TYPE_SLIDE_DOWN`. */
const DEFAULT_TRANSITION: RevealerTransitionType = 'slide-down';

/** `Gtk.Revealer:transition-duration`'s pspec default, in milliseconds. */
const DEFAULT_DURATION = 250;

/** `get_child_size_scale`'s two families, by the axis they scale (gtkrevealer.c:149-178). */
const HORIZONTAL_SLIDES: ReadonlySet<string> = new Set([
    'slide-right',
    'slide-left',
    'fade-slide-right',
    'fade-slide-left',
]);
const VERTICAL_SLIDES: ReadonlySet<string> = new Set(['slide-up', 'slide-down', 'fade-slide-up', 'fade-slide-down']);
const HORIZONTAL_SWINGS: ReadonlySet<string> = new Set(['swing-right', 'swing-left']);
const VERTICAL_SWINGS: ReadonlySet<string> = new Set(['swing-up', 'swing-down']);
/** `get_is_fading_type` (gtkrevealer.c:189-210). */
const FADING: ReadonlySet<string> = new Set([
    'crossfade',
    'fade-slide-right',
    'fade-slide-left',
    'fade-slide-up',
    'fade-slide-down',
]);

/** `effective_transition`'s RTL half (gtkrevealer.c:126-137). */
const RTL_FLIP: Partial<Record<RevealerTransitionType, RevealerTransitionType>> = {
    'slide-left': 'slide-right',
    'slide-right': 'slide-left',
    'swing-left': 'swing-right',
    'swing-right': 'swing-left',
    'fade-slide-left': 'fade-slide-right',
    'fade-slide-right': 'fade-slide-left',
};

export class GtkRevealer extends HTMLElement {
    private _clipEl!: HTMLDivElement;
    private _initialized = false;
    /** `current_pos` — 0 hidden, 1 shown. */
    private _position = 0;
    /** `target_pos` — where the running animation is headed. */
    private _target = 0;
    private _frame = 0;
    private _startedAt = 0;
    /** The child's own size — `child_width` / `child_height` in the C. */
    private _naturalWidth = 0;
    private _naturalHeight = 0;
    private _resize: ResizeObserver | null = null;

    static get observedAttributes() {
        return ['reveal-child', 'transition-type', 'transition-duration'];
    }

    /** `Gtk.Revealer:reveal-child` — whether the child should be revealed. */
    get revealChild(): boolean {
        return this.hasAttribute('reveal-child');
    }

    set revealChild(value: boolean) {
        this.toggleAttribute('reveal-child', !!value);
    }

    /** `Gtk.Revealer:child-revealed` — read-only; the header says why it inverts. */
    get childRevealed(): boolean {
        return this._position === this._target ? this.revealChild : !this.revealChild;
    }

    /** `Gtk.Revealer:transition-type`. An unknown nick leaves `slide-down` in place. */
    get transitionType(): RevealerTransitionType {
        const raw = this.getAttribute('transition-type');
        return (TRANSITION_TYPES as readonly unknown[]).includes(raw)
            ? (raw as RevealerTransitionType)
            : DEFAULT_TRANSITION;
    }

    set transitionType(value: RevealerTransitionType) {
        this.setAttribute('transition-type', value);
    }

    /** `Gtk.Revealer:transition-duration`, in ms. An unparseable one is the default. */
    get transitionDuration(): number {
        const raw = Number.parseFloat(this.getAttribute('transition-duration') ?? '');
        return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DURATION;
    }

    set transitionDuration(value: number) {
        this.setAttribute('transition-duration', String(value));
    }

    /** `Gtk.Revealer:child` — the light-DOM node the clip box adopted. */
    get child(): Element | null {
        return this._clipEl?.firstElementChild ?? null;
    }

    connectedCallback() {
        if (this._initialized) {
            // The teardown below dropped the frame and the observer, so a re-parent has to
            // re-arm them — see `scripts/check-adwaita-connect-rebind.mjs`.
            this._observeChild();
            this._render();
            return;
        }
        this._initialized = true;

        this.setAttribute('role', 'group');

        this._clipEl = document.createElement('div');
        this._clipEl.className = 'adw-revealer-clip';

        // `Gtk.Revealer:child` is a widget PROPERTY, so an authored `child: …` names the
        // slot by that name and the bare child is the default; both land in the clip box.
        bindSlottedChildren(this, [{ name: 'child', into: this._clipEl }, { into: this._clipEl }], () =>
            this._observeChild(),
        ).install(this._clipEl);

        this._observeChild();
        // `reveal-child` is `G_PARAM_CONSTRUCT`, so a GtkBuilder `<property
        // name="reveal-child">` reaches `gtk_revealer_set_reveal_child` at construction and
        // the animation has already started by the time `connectedCallback` returns. A
        // declared attribute therefore has to be applied here: `attributeChangedCallback` is
        // guarded until the element is initialized, because it runs first during an upgrade.
        this._animate(this.revealChild);
        this._render();
    }

    disconnectedCallback() {
        // `gtk_revealer_unmap` (gtkrevealer.c:390-405) finishes the animation and drops the
        // tick callback; a widget taken out of the tree is unmapped, so this is the same
        // event at the same point.
        this._finish();
        this._resize?.disconnect();
        this._resize = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'reveal-child') {
            // `start_animation` returns early when the TARGET is unchanged, so a rewrite of
            // the same value notifies nothing — and neither does it move anything.
            if (!this._animate(value !== null)) return;
            this.dispatchEvent(
                new CustomEvent('notify::reveal-child', {
                    bubbles: true,
                    detail: { revealChild: this.revealChild },
                }),
            );
            return;
        }
        // `gtk_revealer_set_transition_type` / `_duration` take effect on the NEXT
        // animation; a running one keeps the curve it started with, so only the geometry
        // already on screen is recomputed.
        this._render();
        const detail =
            name === 'transition-duration'
                ? { transitionDuration: this.transitionDuration }
                : { transitionType: this.transitionType };
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail }));
    }

    /**
     * Point the measurement at the CHILD, not at the clip box.
     *
     * The C asks the child for its requisition (gtkrevealer.c:140) and scales the result,
     * so the child is the subject; observing the clip box instead would report the ALREADY
     * SCALED box, and the scale would then be applied twice.
     */
    private _observeChild(): void {
        this._resize?.disconnect();
        this._resize = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const box = entry.borderBoxSize?.[0];
                this._naturalWidth = box ? box.inlineSize : entry.contentRect.width;
                this._naturalHeight = box ? box.blockSize : entry.contentRect.height;
            }
            this._render();
        });
        this._resize.observe(this._clipEl);
        const child = this._clipEl.firstElementChild;
        if (child) this._resize.observe(child);
    }

    /** `gtk_revealer_start_animation` (gtkrevealer.c:275-322). `@returns` whether it moved. */
    private _animate(reveal: boolean): boolean {
        const next = reveal ? 1 : 0;
        if (this._target === next) return false;
        this._target = next;

        const type = this.effectiveTransition;
        // `gtk-interface-reduced-motion` and `gtk-enable-animations` are the two settings
        // `start_animation` consults; a browser has the first as a media query and no
        // second, so the query is read once per animation and no listener is kept.
        const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        if (this.transitionDuration === 0 || type === 'none' || reduced || !this.isConnected) {
            this._finish();
            this._setPosition(next);
            return true;
        }

        const source = this._position;
        this._startedAt = performance.now();
        if (this._frame === 0) this._frame = requestAnimationFrame(() => this._tick(source));
        return true;
    }

    /** `gtk_revealer_animate_cb` (gtkrevealer.c:255-272). */
    private _tick(source: number): void {
        this._frame = 0;
        const duration = this.transitionDuration;
        const elapsed = performance.now() - this._startedAt;
        // `gtk_progress_tracker_get_progress` is `iteration - iteration_cycle`, so the
        // fraction runs 0…1 over the whole duration and the ease is applied to THAT.
        const progress = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
        const ease = easeOutCubic(progress);
        this._setPosition(source + ease * (this._target - source));
        if (progress < 1) this._frame = requestAnimationFrame(() => this._tick(source));
    }

    private _finish(): void {
        if (this._frame !== 0) {
            cancelAnimationFrame(this._frame);
            this._frame = 0;
        }
    }

    /** `effective_transition` (gtkrevealer.c:121-141). */
    private get effectiveTransition(): RevealerTransitionType {
        const type = this.transitionType;
        return this.matches(':dir(rtl)') ? (RTL_FLIP[type] ?? type) : type;
    }

    /** `get_child_size_scale` (gtkrevealer.c:144-186) for one axis. */
    private _scale(axis: 'horizontal' | 'vertical'): number {
        const type = this.effectiveTransition;
        const slides = axis === 'horizontal' ? HORIZONTAL_SLIDES : VERTICAL_SLIDES;
        const swings = axis === 'horizontal' ? HORIZONTAL_SWINGS : VERTICAL_SWINGS;
        if (slides.has(type)) return this._position;
        if (swings.has(type)) return Math.sin((Math.PI * this._position) / 2);
        return 1;
    }

    /** `gtk_revealer_set_position` (gtkrevealer.c:212-251). */
    private _setPosition(position: number): void {
        this._position = position;
        this._render();
        if (this._position === this._target) {
            this.dispatchEvent(
                new CustomEvent('notify::child-revealed', {
                    bubbles: true,
                    detail: { childRevealed: this.childRevealed },
                }),
            );
        }
    }

    private _render(): void {
        const child = this._clipEl.firstElementChild as HTMLElement | null;
        // The ResizeObserver delivers asynchronously, so a reveal started in the same task
        // that adopted the child would measure zero. One synchronous read, and only while
        // the recorded size is still the initial zero.
        if (child && this._naturalHeight === 0) {
            this._naturalWidth = child.offsetWidth;
            this._naturalHeight = child.offsetHeight;
        }
        const position = this._position;
        const hscale = this._scale('horizontal');
        const vscale = this._scale('vertical');
        const type = this.effectiveTransition;

        // `gtk_revealer_measure`: `ceil (minimum * scale)`. A scale of 1 leaves the box
        // `auto`, which is what makes a crossfade a pure opacity change with no layout in it.
        this._clipEl.style.width = hscale < 1 ? `${Math.ceil(this._naturalWidth * hscale)}px` : '';
        this._clipEl.style.height = vscale < 1 ? `${Math.ceil(this._naturalHeight * vscale)}px` : '';

        if (child) {
            // `gtk_widget_allocate (child, child_width, child_height, -1, transform)` — the
            // transform chain of gtkrevealer.c:520-598, in the same order, in CSS, about
            // the child's own origin because `transform-origin: 0 0` drops the reference-box
            // offset a GskTransform chain does not have.
            const childWidth = this._naturalWidth;
            const childHeight = this._naturalHeight;
            const width = childWidth * hscale;
            const height = childHeight * vscale;
            const depth = 2 * Math.max(width, height);
            const turns = 90 * (1 - position);
            let transform = '';
            switch (type) {
                case 'slide-right':
                case 'fade-slide-right':
                    transform = `translateX(${width - childWidth}px)`;
                    break;
                case 'slide-down':
                case 'fade-slide-down':
                    transform = `translateY(${height - childHeight}px)`;
                    break;
                case 'swing-right':
                    transform = `translate(0, ${height / 2}px) perspective(${depth}px) rotateY(${turns}deg) translate(0, ${-childHeight / 2}px)`;
                    break;
                case 'swing-left':
                    transform = `translate(${width}px, ${height / 2}px) perspective(${depth}px) rotateY(${-turns}deg) translate(${-childWidth}px, ${-childHeight / 2}px)`;
                    break;
                case 'swing-down':
                    transform = `translate(${width / 2}px, 0) perspective(${depth}px) rotateX(${-turns}deg) translate(${-childWidth / 2}px, 0)`;
                    break;
                case 'swing-up':
                    transform = `translate(${width / 2}px, ${height}px) perspective(${depth}px) rotateX(${turns}deg) translate(${-childWidth / 2}px, ${-childHeight}px)`;
                    break;
                default:
                    // `slide-left`, `slide-up` and everything without a transform of its own
                    // fall through the C's switch unchanged.
                    break;
            }
            child.style.transform = transform;
            // `transform-origin: 0 0` is the GskTransform composition point, and only a
            // chain that needs it (the swings) has one.
            child.style.transformOrigin = transform === '' ? '' : '0 0';
            child.style.opacity = FADING.has(type) ? String(position) : '';
        }

        this.classList.toggle('revealed', position > 0);
    }
}

customElements.define('gtk-revealer', GtkRevealer);
