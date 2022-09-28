class GjsifyWebGLActiveInfo implements WebGLActiveInfo {
  size: GLsizei;
  type: GLenum;
  name: string;

  constructor (_: WebGLActiveInfo) {
    this.size = _.size
    this.type = _.type
    this.name = _.name
  }
}

export { GjsifyWebGLActiveInfo as WebGLActiveInfo }