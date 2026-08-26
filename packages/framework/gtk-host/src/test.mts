import { run } from '@gjsify/unit';

import reactSuite from './adapters/react.spec.js';
import buildableSuite from './buildable.spec.js';
import solidSuite from './adapters/solid.spec.js';
import vueSuite from './adapters/vue.spec.js';
import conformanceSuite from './conformance.spec.js';
import generatedSuite from './generated.spec.js';
import generatorSuite from './generator.spec.js';
import hostSuite from './host.spec.js';
import propsSuite from './props.spec.js';
import gtkCssSuite from './style/gtk-css.spec.js';
import paintSuite from './style/paint.spec.js';

run({
    paintSuite,
    gtkCssSuite,
    buildableSuite,
    propsSuite,
    hostSuite,
    conformanceSuite,
    generatorSuite,
    generatedSuite,
    solidSuite,
    vueSuite,
    reactSuite,
});
