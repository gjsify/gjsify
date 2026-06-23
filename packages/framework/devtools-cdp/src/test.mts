import { run } from '@gjsify/unit';

import inspectorProtocolClientSuite from './inspector-protocol-client.spec.js';
import targetDiscoverySuite from './target-discovery.spec.js';

run({
    inspectorProtocolClientSuite,
    targetDiscoverySuite,
});
