export interface Version {
    version: {
        deno: string;
        v8: string;
        typescript: string;
    };
    setVersions: (denoVersion: string, v8Version: string, tsVersion: string) => void;
}