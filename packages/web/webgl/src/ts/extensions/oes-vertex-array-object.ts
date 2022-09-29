import { Linkable } from '../linkable.js'
import { gl } from '../native-gl.js'
import { checkObject } from '../utils.js'
import { WebGLVertexArrayObjectState } from '../webgl-vertex-attribute.js';

import type { GjsifyWebGLRenderingContext } from '../webgl-rendering-context.js';

export class WebGLVertexArrayObjectOES extends Linkable {
  _ctx: GjsifyWebGLRenderingContext;
  _ext: OESVertexArrayObject;
  _vertexState?: WebGLVertexArrayObjectState;
  constructor (_: number, ctx: GjsifyWebGLRenderingContext, ext: OESVertexArrayObject) {
    super(_)
    this._ctx = ctx
    this._ext = ext
    this._vertexState = new WebGLVertexArrayObjectState(ctx)
  }

  _performDelete () {
    // Clean up the vertex state to release references to buffers.
    this._vertexState?.cleanUp()

    delete this._vertexState;
    delete this._ext._vaos[this._]
    gl.deleteVertexArrayOES.call(this._ctx, this._ | 0)
  }
}

export class OESVertexArrayObject {
  VERTEX_ARRAY_BINDING_OES = 0x85B5;
  _ctx: GjsifyWebGLRenderingContext;
  _vaos: Record<number, WebGLVertexArrayObjectOES> = {}
  _activeVertexArrayObject: WebGLVertexArrayObjectOES | null = null

  constructor (ctx: GjsifyWebGLRenderingContext) {
    this.VERTEX_ARRAY_BINDING_OES = 0x85B5

    this._ctx = ctx
  }

  createVertexArrayOES () {
    const { _ctx: ctx } = this
    const arrayId = gl.createVertexArrayOES.call(ctx)
    if (arrayId <= 0) return null
    const array = new WebGLVertexArrayObjectOES(arrayId, ctx, this)
    this._vaos[arrayId] = array
    return array
  }

  deleteVertexArrayOES (array: WebGLVertexArrayObjectOES | null) {
    const { _ctx: ctx } = this
    if (!checkObject(array)) {
      throw new TypeError('deleteVertexArrayOES(WebGLVertexArrayObjectOES)')
    }

    if (!(array instanceof WebGLVertexArrayObjectOES &&
      ctx._checkOwns(array))) {
      ctx.setError(gl.INVALID_OPERATION)
      return
    }

    if (array._pendingDelete) {
      return
    }

    if (this._activeVertexArrayObject === array) {
      this.bindVertexArrayOES(null)
    }

    array._pendingDelete = true
    array._checkDelete()
  }

  bindVertexArrayOES (array: WebGLVertexArrayObjectOES | null) {
    const { _ctx: ctx, _activeVertexArrayObject: activeVertexArrayObject } = this
    if (!checkObject(array)) {
      throw new TypeError('bindVertexArrayOES(WebGLVertexArrayObjectOES)')
    }

    if (!array) {
      array = null
      gl.bindVertexArrayOES.call(ctx, null)
    } else if (array instanceof WebGLVertexArrayObjectOES &&
      array._pendingDelete) {
      ctx.setError(gl.INVALID_OPERATION)
      return
    } else if (ctx._checkWrapper(array, WebGLVertexArrayObjectOES)) {
      gl.bindVertexArrayOES.call(ctx, array._)
    } else {
      return
    }

    if (activeVertexArrayObject !== array) {
      if (activeVertexArrayObject) {
        activeVertexArrayObject._refCount -= 1
        activeVertexArrayObject._checkDelete()
      }
      if (array) {
        array._refCount += 1
      }
    }

    if (array === null) {
      ctx._vertexObjectState = ctx._defaultVertexObjectState
    } else if(array._vertexState) {
      ctx._vertexObjectState = array._vertexState
    }

    // Update the active vertex array object.
    this._activeVertexArrayObject = array
  }

  isVertexArrayOES (object: WebGLVertexArrayObjectOES) {
    const { _ctx: ctx } = this
    if (!ctx._isObject(object, 'isVertexArrayOES', WebGLVertexArrayObjectOES)) return false
    return gl.isVertexArrayOES.call(ctx, object._ | 0)
  }
}

export function getOESVertexArrayObject (ctx: GjsifyWebGLRenderingContext) {
  const exts = ctx.getSupportedExtensions()

  if (exts && exts.indexOf('OES_vertex_array_object') >= 0) {
    return new OESVertexArrayObject(ctx)
  } else {
    return null
  }
}
