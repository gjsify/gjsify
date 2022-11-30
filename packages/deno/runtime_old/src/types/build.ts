export interface Build {
    build: {
        target: string;
        arch: string;
        os: string;
        vendor: string;
        env?: string | undefined;
    }
    setBuildInfo(target: string): void;
}