import { run } from '@gjsify/unit';

import bufferTestSuite from './buffer.spec.js';
import highlighterTestSuite from './highlighter.spec.js';
import managersTestSuite from './managers.spec.js';
import sessionTestSuite from './editor-session.spec.js';
import gutterTestSuite from './gutter.spec.js';

run({ bufferTestSuite, highlighterTestSuite, managersTestSuite, sessionTestSuite, gutterTestSuite });
