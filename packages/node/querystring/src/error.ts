// TODO create module for node errors?

/**
 * All error instances in Node have additional methods and properties
 * This export class is meant to be extended by these instances abstracting native JS error instances
 */
 export class NodeErrorAbstraction extends Error {
    code: string;
  
    constructor(name: string, code: string, message: string) {
      super(message);
      this.code = code;
      this.name = name;
      //This number changes depending on the name of this class
      //20 characters as of now
      this.stack = this.stack && `${name} [${this.code}]${this.stack.slice(20)}`;
    }
  
    override toString() {
      return `${this.name} [${this.code}]: ${this.message}`;
    }
}

export class NodeURIError extends NodeErrorAbstraction implements URIError {
    constructor(code: string, message: string) {
      super(URIError.prototype.name, code, message);
      Object.setPrototypeOf(this, URIError.prototype);
      this.toString = function () {
        return `${this.name} [${this.code}]: ${this.message}`;
      };
    }
}
