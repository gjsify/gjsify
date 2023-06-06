import Gio from '@girs/gio-2.0';

export function isIP(input: string): 0 | 4 | 6 {
  const addr = Gio.InetAddress.new_from_string(input);

  if (!addr) return 0;

  const family = addr.get_family();

  switch(family) {
    case Gio.SocketFamily.INVALID:
      return 0;
    case Gio.SocketFamily.IPV4:
      return 4;
    case Gio.SocketFamily.IPV6:
      return 6;
  }
}

export function isIPv4(input: string): boolean {
  return isIP(input) === 4;
}

export function isIPv6(input: string): boolean {
  return isIP(input) === 6;
}