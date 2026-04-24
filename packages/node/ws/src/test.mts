import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';
import websocketServerSpec from './websocket-server.spec.js';
run({ testSuite, websocketServerSpec });
