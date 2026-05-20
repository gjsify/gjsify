// WebRTC video preview — platform-agnostic shared logic.
//
// Requests webcam access via getUserMedia and renders the stream
// in a <video> element. Works identically in browser (native WebRTC)
// and GJS (@gjsify/webrtc + VideoBridge + GStreamer gtk4paintablesink).

export type LogFn = (msg: string) => void;

export async function startVideo(
    video: HTMLVideoElement,
    log: LogFn = console.log,
): Promise<MediaStream> {
    log('Requesting webcam...');

    const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
    });

    log(`Got MediaStream with ${stream.getVideoTracks().length} video track(s)`);
    video.srcObject = stream;
    log('Video playing');

    return stream;
}
