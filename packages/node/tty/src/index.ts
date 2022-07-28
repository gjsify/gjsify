export const isatty = (fd: number) => { return false; };

export const ReadStream = () => {
  throw new Error('tty.ReadStream is not implemented');
}

export const WriteStream = () => {
  throw new Error('tty.WriteStream is not implemented');
}