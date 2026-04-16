import webrtcSpec from './webrtc.spec.js';
import registerSpec from './register.spec.js';

const results = {
    webrtc: await webrtcSpec(),
    register: await registerSpec(),
};
