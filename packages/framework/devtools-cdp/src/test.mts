import { run } from '@gjsify/unit';

import inspectorProtocolClientSuite from './inspector-protocol-client.spec.js';
import inspectorProtocolExtensionSuite from './inspector-protocol-extension.spec.js';
import targetDiscoverySuite from './target-discovery.spec.js';
import toolGeneratorSuite from './tool-generator.spec.js';

run({
    inspectorProtocolClientSuite,
    inspectorProtocolExtensionSuite,
    targetDiscoverySuite,
    toolGeneratorSuite,
});
