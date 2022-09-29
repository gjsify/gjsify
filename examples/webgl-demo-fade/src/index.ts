import '@gjsify/types/index';
import Gtk from '@gjsify/types/Gtk-4.0';
import GLib from '@gjsify/types/GLib-2.0';
// import GObject from ''@gjsify/types/GObject';
import Gio from '@gjsify/types/Gio-2.0';
//import Gwebgl from 'gi://Gwebgl';
//const WebGLRenderingContext = Gwebgl.WebGLRenderingContext;
import { HTMLCanvasElement, WebGLRenderingContext } from '@gjsify/webgl';


let rendered = false;
let programInfo, buffers;
let app: Gtk.Application;

class ColourChanger {

    red = 0;
    green = 0;
    blue = 0;

    _targetChannel: "red" | "green" | "blue";
    _targetValue: number

    constructor() {
        this._getNewTarget();
    }

    get rgba() { return [this.red / 255.0,
        this.green / 255.0, this.blue / 255.0, 1.0] };

    update() {
        let v = this[this._targetChannel];
        if (v == this._targetValue) {
            this._getNewTarget();
            this.update();
            return;
        } else if (v > this._targetValue) {
            --v;
        } else if (v < this._targetValue) {
            ++v;
        }
        this[this._targetChannel] = v;
    }

    _getNewTarget() {
        const r = Math.random();
        let c: "red" | "green" | "blue";
        if (r < 0.333333333333) {
            c = "red";
        } else if (r < 0.666666666666) {
            c = "green";
        } else {
            c = "blue";
        }
        this._targetChannel = c;
        this._targetValue = this._getTargetValue(this[c]);
    }

    _getTargetValue(current) {
        const r = Math.floor(Math.random() * 63);
        if (current < 128) {
            return 255 - r;
        } else {
            return r;
        }
    }
}

let colourChanger = new ColourChanger();

function render(glarea: Gtk.GLArea, gl: WebGLRenderingContext) {
    print("render");
    if (!rendered) {
        rendered = true;
        const ctx = glarea.get_context();
        printerr('Context: ' +
            `${ctx.get_required_version()} ES ${ctx.get_use_es()}`);
        [programInfo, buffers] = mozSetup(gl);
    }

    // Draw the scene
    drawScene(gl, programInfo, buffers);
}

function tick(glarea: Gtk.GLArea) {
    glarea.queue_render();
    return true;
}

function activate(app: Gtk.Application) {
    print("activate");
    const win = Gtk.ApplicationWindow.new(app);
    win.set_default_size(800, 600);
    const glarea = Gtk.GLArea.new();
    // glarea.set_required_version(2, 0);
    // glarea.set_use_es(true);
    const canvas = new HTMLCanvasElement(glarea);
    const gl = new WebGLRenderingContext(canvas);
    glarea.connect('render', () => {
        render(glarea, gl);
        return true;
    });
    glarea.connect('create-context', () => {
        try {
            const surface = glarea.get_native().get_surface();
            const ctx = surface.create_gl_context();
            ctx.set_debug_enabled(true);
            ctx.set_use_es(1);
            ctx.set_required_version(2, 0);
            return ctx;
        } catch (e) {
            logError(e);
            return null;
        }
    });
    win.set_child(glarea);
    win.present();
    // GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 1000, () => tick(glarea));
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => tick(glarea));
}

function main() {
    print("main");
    app = Gtk.Application.new('uk.co.realh.gwebgl.demo.js', Gio.ApplicationFlags.FLAGS_NONE);
    app.connect('activate', activate);
    app.run([]);
}

function mozSetup(gl: WebGLRenderingContext) {
  if (!gl) {
    alert('Unable to initialize WebGL. Your browser or machine may not support it.');
    return;
  }

  // Vertex shader program

  const vsSource = `
    attribute vec2 aVertexPosition;
    void main() {
      gl_Position = vec4(aVertexPosition.x, aVertexPosition.y, 0.0, 1.0);
    }
  `;

  // Fragment shader program

  const fsSource = `
    uniform highp vec4 uColour;
    void main() {
      gl_FragColor = uColour;
    }
  `;

  // Initialize a shader program; this is where all the lighting
  // for the vertices and so forth is established.
  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

  // Collect all the info needed to use the shader program.
  // Look up which attribute our shader program is using
  // for aVertexPosition and look up uniform locations.
  const programInfo = {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
    },
    uniformLocations: {
      colour: gl.getUniformLocation(shaderProgram, 'uColour'),
    },
  };

  // Here's where we call the routine that builds all the
  // objects we'll be drawing.
  const buffers = initBuffers(gl);

  return [programInfo, buffers];
}
 
//
// initBuffers
//
// Initialize the buffers we'll need. For this demo, we just
// have one object -- a simple two-dimensional square.
//
function initBuffers(gl: WebGLRenderingContext) {

  // Create a buffer for the square's positions.

  const positionBuffer = gl.createBuffer();

  // Select the positionBuffer as the one to apply buffer
  // operations to from here out.

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  // Now create an array of positions for the square.

  const positions = [
     0.8,  0.8,
    -0.8,  0.8,
     0.8, -0.8,
    -0.8, -0.8,
  ];

  // Now pass the list of positions into WebGL to build the
  // shape. We do this by creating a Float32Array from the
  // JavaScript array, then use it to fill the current buffer.

  gl.bufferData(gl.ARRAY_BUFFER,
                new Float32Array(positions),
                gl.STATIC_DRAW);

  return {
    position: positionBuffer,
  };
}

//
// Draw the scene.
//
function drawScene(gl: WebGLRenderingContext, programInfo, buffers) {
  gl.clearColor(0.0, 0.0, 0.0, 1.0);  // Clear to black, fully opaque
  gl.clearDepth(1.0);                 // Clear everything
  gl.enable(gl.DEPTH_TEST);           // Enable depth testing
  gl.depthFunc(gl.LEQUAL);            // Near things obscure far things

  // Clear the canvas before we start drawing on it.

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Tell WebGL how to pull out the positions from the position
  // buffer into the vertexPosition attribute.
  {
    const numComponents = 2;
    const type = gl.FLOAT;
    const normalize = false;
    const stride = 0;
    const offset = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(
        programInfo.attribLocations.vertexPosition,
        numComponents,
        type,
        normalize,
        stride,
        offset);
    gl.enableVertexAttribArray(
        programInfo.attribLocations.vertexPosition);
  }

  // Tell WebGL to use our program when drawing

  gl.useProgram(programInfo.program);

  // Set the shader uniforms
  colourChanger.update();
  const rgba = colourChanger.rgba;
  gl.uniform4f(programInfo.uniformLocations.colour, rgba[0], rgba[1], rgba[2], rgba[3]);

  {
    const offset = 0;
    const vertexCount = 4;
    gl.drawArrays(gl.TRIANGLE_STRIP, offset, vertexCount);
  }
}


function initShaderProgram(gl, vsSource, fsSource) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

  // Create the shader program

  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  // If creating the shader program failed, alert

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return null;
  }

  return shaderProgram;
}

//
// creates a shader of the given type, uploads the source and
// compiles it.
//
function loadShader(gl, type, source) {
  const shader = gl.createShader(type);

  // Send the source to the shader object

  gl.shaderSource(shader, source);

  // Compile the shader program

  gl.compileShader(shader);

  // See if it compiled successfully

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}


function alert(m) {
    printerr(m);
    app.quit();
}


main();
