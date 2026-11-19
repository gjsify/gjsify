// The one NativeScript core member this bridge touches. @nativescript/core is an optional
// peer: it is present in every app that can reach android.ts, and absent where only the
// pure-TS parts are specced (Node, GJS).
declare module '@nativescript/core' {
    export const Utils: { android: { getApplicationContext(): any } };
}
