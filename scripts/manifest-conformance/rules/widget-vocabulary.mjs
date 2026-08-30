/**
 * Rule `widget-vocabulary` — REPO-SCOPED. Every package that declares itself a widget
 * surface is one the widget-vocabulary gate can actually READ.
 *
 * WHY THE FIELD NEEDS A RULE AT ALL. `field-coverage` fails on any `gjsify.*` key no rule
 * claims, so `gjsify.widgetVocabulary` is only admissible with this file beside it. That
 * is the mechanism working rather than a formality: the declaration promises that
 * `check-vocabulary-alignment.mjs` holds this package's widget names against the
 * GIR-derived table, and a promise nobody verifies is exactly the shape ADR 0034 § 5 was
 * written about — the NativeScript port named widgets by hand, outside every check, for
 * its entire life.
 *
 * WHAT IT CHECKS is the join, in both directions: a declared surface with no reader
 * fails, and a reader whose package no longer declares itself fails. Plus the shape rules
 * on `role` — exactly one `reference`, at least one `renderer`. The rules themselves live
 * in `scripts/widget-surfaces.mjs` as one pure function so that this rule and the gate
 * cannot answer differently; the failing vectors for it are in
 * `check-vocabulary-alignment.mjs`, which runs in the same job.
 *
 * REPO-SCOPED because the readers it joins against are this repository's own scripts. In
 * a consumer's tree the key would be unclaimed through no fault of the consumer, which is
 * precisely the case `field-coverage`'s report-vs-enforce split exists for.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';
import {
    WIDGET_SURFACE_FIELD,
    WIDGET_SURFACE_READERS,
    declaredWidgetSurfaces,
    enrolmentProblems,
} from '../../widget-surfaces.mjs';

export const widgetVocabularyRule = defineRule({
    id: 'widget-vocabulary',
    scope: 'repo',
    fields: [`gjsify.${WIDGET_SURFACE_FIELD}`],
    description: 'every package declaring itself a widget surface is read by the widget-vocabulary gate',
    run(ctx) {
        const declared = declaredWidgetSurfaces(ctx.root);
        const failures = enrolmentProblems({ declared, readers: WIDGET_SURFACE_READERS });
        const renderers = declared.filter((entry) => entry.declaration?.role === 'renderer').length;
        return {
            failures,
            stats: { declared: declared.length, renderers },
            summary:
                declared.length === 0
                    ? `widget-vocabulary: no package declares \`gjsify.${WIDGET_SURFACE_FIELD}\``
                    : `widget-vocabulary: ${declared.length} declared surface(s), ${renderers} renderer(s), ` +
                      'every one of them read',
        };
    },
});
