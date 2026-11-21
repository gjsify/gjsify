// The refusal path of the subset (ADR 0144, rule for every stage): a member outside the subset
// throws, naming itself. A driver for a platform without libportal wraps its object in
// `subsetOf`, so reaching for `open_file` or `session_start` fails loudly instead of returning
// `undefined` into the app.

export interface RefusalError extends Error {
    code: string;
    gjsifyModule: string;
    gjsifyMember: string;
}

export function refusal(member: string, platform: string): RefusalError {
    const error = new Error(
        `[@gjsify/xdp] ${member} is outside the Background subset of libportal that @gjsify/xdp serves on ${platform}`,
    ) as RefusalError;
    error.code = 'ENOTSUP';
    error.gjsifyModule = 'xdp';
    error.gjsifyMember = member;
    return error;
}

/** `target` restricted to `members`; any other property read throws {@link refusal}. */
export function subsetOf<T extends object>(target: T, members: ReadonlySet<string | symbol>, platform: string): T {
    return new Proxy(target, {
        get(object, property, receiver) {
            if (typeof property === 'symbol' || members.has(property) || property === 'then') {
                return Reflect.get(object, property, receiver);
            }
            throw refusal(`Portal.${property}`, platform);
        },
    });
}
