import webrtcSpec from './webrtc.spec.js';
import wptSpec from './wpt.spec.js';
import wptMediaSpec from './wpt-media.spec.js';
import registerSpec from './register.spec.js';

const results = {
    webrtc: await webrtcSpec(),
    wpt: await wptSpec(),
    wptMedia: await wptMediaSpec(),
    register: await registerSpec(),
};
