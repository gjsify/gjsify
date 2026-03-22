import { EventEmitter } from 'events';

export class Socket extends EventEmitter {
  address() {
    return { address: '0.0.0.0', family: 'IPv4', port: 0 };
  }

  bind(_port?: number, _address?: string, _callback?: () => void): this {
    return this;
  }

  close(_callback?: () => void): void {}

  send(
    _msg: any,
    _offset?: number,
    _length?: number,
    _port?: number,
    _address?: string,
    _callback?: (err: Error | null, bytes: number) => void,
  ): void {}

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function createSocket(type: string): Socket {
  return new Socket();
}

export default { Socket, createSocket };
