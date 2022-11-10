
export namespace messagePort {
  export type Transferable = {
    kind: "messagePort";
    data: number;
  } | {
    kind: "arrayBuffer";
    data: number;
  };

  export interface MessageData {
    data: Uint8Array;
    transferables: Transferable[];
  }
}