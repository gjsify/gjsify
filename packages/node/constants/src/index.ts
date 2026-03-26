// constants — deprecated Node.js module
// Reference: Node.js lib/constants.js
// Merges os.constants (flattened), fs.constants, and crypto.constants

import { constants as osConstants } from 'node:os';
import { constants as fsConstants } from 'node:fs';
import { constants as cryptoConstants } from 'node:crypto';

// Flatten os.constants (errno, signals, priority, dlopen) into top-level
const flattened: Record<string, unknown> = {};

for (const group of Object.values(osConstants) as Array<Record<string, unknown>>) {
  if (typeof group === 'object' && group !== null) {
    Object.assign(flattened, group);
  }
}

// Merge fs.constants and crypto.constants
Object.assign(flattened, fsConstants);
Object.assign(flattened, cryptoConstants);

export default flattened;

// Also export all known constants as named exports for destructuring
export const {
  // Errno constants (from os.constants.errno)
  E2BIG, EACCES, EADDRINUSE, EADDRNOTAVAIL, EAFNOSUPPORT, EAGAIN, EALREADY,
  EBADF, EBADMSG, EBUSY, ECANCELED, ECHILD, ECONNABORTED, ECONNREFUSED,
  ECONNRESET, EDEADLK, EDESTADDRREQ, EDOM, EDQUOT, EEXIST, EFAULT, EFBIG,
  EHOSTUNREACH, EIDRM, EILSEQ, EINPROGRESS, EINTR, EINVAL, EIO, EISCONN,
  EISDIR, ELOOP, EMFILE, EMLINK, EMSGSIZE, ENAMETOOLONG, ENETDOWN, ENETRESET,
  ENETUNREACH, ENFILE, ENOBUFS, ENODATA, ENODEV, ENOENT, ENOEXEC, ENOLCK,
  ENOLINK, ENOMEM, ENOMSG, ENOPROTOOPT, ENOSPC, ENOSR, ENOSTR, ENOSYS,
  ENOTCONN, ENOTDIR, ENOTEMPTY, ENOTSOCK, ENOTSUP, ENOTTY, ENXIO, EOPNOTSUPP,
  EOVERFLOW, EPERM, EPIPE, EPROTO, EPROTONOSUPPORT, EPROTOTYPE, ERANGE,
  EROFS, ESPIPE, ESRCH, ESTALE, ETIME, ETIMEDOUT, ETXTBSY, EWOULDBLOCK, EXDEV,
  // Signal constants (from os.constants.signals)
  SIGHUP, SIGINT, SIGQUIT, SIGILL, SIGTRAP, SIGABRT, SIGBUS, SIGFPE, SIGKILL,
  SIGUSR1, SIGUSR2, SIGSEGV, SIGPIPE, SIGALRM, SIGTERM, SIGCHLD, SIGCONT,
  SIGSTOP, SIGTSTP, SIGTTIN, SIGTTOU, SIGURG, SIGXCPU, SIGXFSZ, SIGVTALRM,
  SIGPROF, SIGWINCH, SIGIO, SIGPWR, SIGSYS,
} = flattened as any;
