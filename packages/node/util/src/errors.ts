// System error name mapping (Linux errno codes)

const linuxErrors: Record<number, string> = {
  [-1]: 'EPERM', [-2]: 'ENOENT', [-3]: 'ESRCH', [-4]: 'EINTR',
  [-5]: 'EIO', [-6]: 'ENXIO', [-7]: 'E2BIG', [-8]: 'ENOEXEC',
  [-9]: 'EBADF', [-10]: 'ECHILD', [-11]: 'EAGAIN', [-12]: 'ENOMEM',
  [-13]: 'EACCES', [-14]: 'EFAULT', [-15]: 'ENOTBLK', [-16]: 'EBUSY',
  [-17]: 'EEXIST', [-18]: 'EXDEV', [-19]: 'ENODEV', [-20]: 'ENOTDIR',
  [-21]: 'EISDIR', [-22]: 'EINVAL', [-23]: 'ENFILE', [-24]: 'EMFILE',
  [-25]: 'ENOTTY', [-26]: 'ETXTBSY', [-27]: 'EFBIG', [-28]: 'ENOSPC',
  [-29]: 'ESPIPE', [-30]: 'EROFS', [-31]: 'EMLINK', [-32]: 'EPIPE',
  [-33]: 'EDOM', [-34]: 'ERANGE', [-35]: 'EDEADLK', [-36]: 'ENAMETOOLONG',
  [-37]: 'ENOLCK', [-38]: 'ENOSYS', [-39]: 'ENOTEMPTY', [-40]: 'ELOOP',
  [-42]: 'ENOMSG', [-43]: 'EIDRM', [-44]: 'ECHRNG', [-45]: 'EL2NSYNC',
  [-46]: 'EL3HLT', [-47]: 'EL3RST', [-48]: 'ELNRNG', [-49]: 'EUNATCH',
  [-50]: 'ENOCSI', [-51]: 'EL2HLT', [-52]: 'EBADE', [-53]: 'EBADR',
  [-54]: 'EXFULL', [-55]: 'ENOANO', [-56]: 'EBADRQC', [-57]: 'EBADSLT',
  [-59]: 'EBFONT', [-60]: 'ENOSTR', [-61]: 'ENODATA', [-62]: 'ETIME',
  [-63]: 'ENOSR', [-64]: 'ENONET', [-65]: 'ENOPKG', [-66]: 'EREMOTE',
  [-67]: 'ENOLINK', [-68]: 'EADV', [-69]: 'ESRMNT', [-70]: 'ECOMM',
  [-71]: 'EPROTO', [-72]: 'EMULTIHOP', [-73]: 'EDOTDOT', [-74]: 'EBADMSG',
  [-75]: 'EOVERFLOW', [-76]: 'ENOTUNIQ', [-77]: 'EBADFD', [-78]: 'EREMCHG',
  [-79]: 'ELIBACC', [-80]: 'ELIBBAD', [-81]: 'ELIBSCN', [-82]: 'ELIBMAX',
  [-83]: 'ELIBEXEC', [-84]: 'EILSEQ', [-85]: 'ERESTART', [-86]: 'ESTRPIPE',
  [-87]: 'EUSERS', [-88]: 'ENOTSOCK', [-89]: 'EDESTADDRREQ', [-90]: 'EMSGSIZE',
  [-91]: 'EPROTOTYPE', [-92]: 'ENOPROTOOPT', [-93]: 'EPROTONOSUPPORT',
  [-94]: 'ESOCKTNOSUPPORT', [-95]: 'ENOTSUP', [-96]: 'EPFNOSUPPORT',
  [-97]: 'EAFNOSUPPORT', [-98]: 'EADDRINUSE', [-99]: 'EADDRNOTAVAIL',
  [-100]: 'ENETDOWN', [-101]: 'ENETUNREACH', [-102]: 'ENETRESET',
  [-103]: 'ECONNABORTED', [-104]: 'ECONNRESET', [-105]: 'ENOBUFS',
  [-106]: 'EISCONN', [-107]: 'ENOTCONN', [-108]: 'ESHUTDOWN',
  [-109]: 'ETOOMANYREFS', [-110]: 'ETIMEDOUT', [-111]: 'ECONNREFUSED',
  [-112]: 'EHOSTDOWN', [-113]: 'EHOSTUNREACH', [-114]: 'EALREADY',
  [-115]: 'EINPROGRESS', [-116]: 'ESTALE', [-117]: 'EUCLEAN',
  [-118]: 'ENOTNAM', [-119]: 'ENAVAIL', [-120]: 'EISNAM',
  [-121]: 'EREMOTEIO', [-122]: 'EDQUOT', [-123]: 'ENOMEDIUM',
  [-124]: 'EMEDIUMTYPE', [-125]: 'ECANCELED', [-126]: 'ENOKEY',
  [-127]: 'EKEYEXPIRED', [-128]: 'EKEYREVOKED', [-129]: 'EKEYREJECTED',
};

const darwinErrors: Record<number, string> = {
  [-1]: 'EPERM', [-2]: 'ENOENT', [-3]: 'ESRCH', [-4]: 'EINTR',
  [-5]: 'EIO', [-6]: 'ENXIO', [-7]: 'E2BIG', [-8]: 'ENOEXEC',
  [-9]: 'EBADF', [-10]: 'ECHILD', [-11]: 'EDEADLK', [-12]: 'ENOMEM',
  [-13]: 'EACCES', [-14]: 'EFAULT', [-15]: 'ENOTBLK', [-16]: 'EBUSY',
  [-17]: 'EEXIST', [-18]: 'EXDEV', [-19]: 'ENODEV', [-20]: 'ENOTDIR',
  [-21]: 'EISDIR', [-22]: 'EINVAL', [-23]: 'ENFILE', [-24]: 'EMFILE',
  [-25]: 'ENOTTY', [-26]: 'ETXTBSY', [-27]: 'EFBIG', [-28]: 'ENOSPC',
  [-29]: 'ESPIPE', [-30]: 'EROFS', [-31]: 'EMLINK', [-32]: 'EPIPE',
  [-33]: 'EDOM', [-34]: 'ERANGE', [-35]: 'EAGAIN', [-36]: 'EINPROGRESS',
  [-37]: 'EALREADY', [-38]: 'ENOTSOCK', [-39]: 'EDESTADDRREQ',
  [-40]: 'EMSGSIZE', [-41]: 'EPROTOTYPE', [-42]: 'ENOPROTOOPT',
  [-43]: 'EPROTONOSUPPORT', [-44]: 'ESOCKTNOSUPPORT', [-45]: 'ENOTSUP',
  [-46]: 'EPFNOSUPPORT', [-47]: 'EAFNOSUPPORT', [-48]: 'EADDRINUSE',
  [-49]: 'EADDRNOTAVAIL', [-50]: 'ENETDOWN', [-51]: 'ENETUNREACH',
  [-52]: 'ENETRESET', [-53]: 'ECONNABORTED', [-54]: 'ECONNRESET',
  [-55]: 'ENOBUFS', [-56]: 'EISCONN', [-57]: 'ENOTCONN',
  [-58]: 'ESHUTDOWN', [-59]: 'ETOOMANYREFS', [-60]: 'ETIMEDOUT',
  [-61]: 'ECONNREFUSED', [-62]: 'ELOOP', [-63]: 'ENAMETOOLONG',
  [-64]: 'EHOSTDOWN', [-65]: 'EHOSTUNREACH', [-66]: 'ENOTEMPTY',
  [-67]: 'EPROCLIM', [-68]: 'EUSERS', [-69]: 'EDQUOT', [-70]: 'ESTALE',
  [-71]: 'EREMOTE', [-72]: 'EBADRPC', [-73]: 'ERPCMISMATCH',
  [-74]: 'EPROGUNAVAIL', [-75]: 'EPROGMISMATCH', [-76]: 'EPROCUNAVAIL',
  [-77]: 'ENOLCK', [-78]: 'ENOSYS', [-79]: 'EFTYPE', [-80]: 'EAUTH',
  [-81]: 'ENEEDAUTH', [-82]: 'EPWROFF', [-83]: 'EDEVERR',
  [-84]: 'EOVERFLOW', [-85]: 'EBADEXEC', [-86]: 'EBADARCH',
  [-87]: 'ESHLIBVERS', [-88]: 'EBADMACHO', [-89]: 'ECANCELED',
  [-90]: 'EIDRM', [-91]: 'ENOMSG', [-92]: 'EILSEQ', [-93]: 'ENOATTR',
  [-94]: 'EBADMSG', [-95]: 'EMULTIHOP', [-96]: 'ENODATA',
  [-97]: 'ENOLINK', [-98]: 'ENOSR', [-99]: 'ENOSTR', [-100]: 'EPROTO',
  [-101]: 'ETIME', [-102]: 'EOPNOTSUPP',
};

function getPlatform(): string {
  if (typeof globalThis.process?.platform === 'string') return globalThis.process.platform;
  return 'linux';
}

export function getSystemErrorName(err: number): string {
  if (typeof err !== 'number') {
    throw new TypeError('The "err" argument must be of type number. Received type ' + typeof err);
  }
  if (err >= 0) {
    throw new RangeError(`The value of "err" is out of range. It must be a negative integer. Received ${err}`);
  }

  const platform = getPlatform();
  const map = platform === 'darwin' ? darwinErrors : linuxErrors;
  return map[err] || `Unknown system error ${err}`;
}

export function getSystemErrorMap(): Map<number, [string, string]> {
  const platform = getPlatform();
  const map = platform === 'darwin' ? darwinErrors : linuxErrors;
  const result = new Map<number, [string, string]>();
  for (const [key, name] of Object.entries(map)) {
    result.set(Number(key), [name, '']);
  }
  return result;
}
