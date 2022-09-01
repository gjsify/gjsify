import { platform, arch } from "process";

export const build = {
    os: platform || 'linux', // TODO
    arch,
}
