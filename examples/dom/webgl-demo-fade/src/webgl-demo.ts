// Colour-fading WebGL demo — shared rendering logic
// Draws a square that smoothly fades between colours.

interface ProgramInfo {
    program: WebGLProgram;
    attribLocations: {
        vertexPosition: number;
    };
    uniformLocations: {
        colour: WebGLUniformLocation | null;
    };
}

interface Buffers {
    position: WebGLBuffer;
}

class ColourChanger {
    red = 0;
    green = 0;
    blue = 0;

    private _targetChannel: 'red' | 'green' | 'blue';
    private _targetValue: number;

    constructor() {
        this._getNewTarget();
    }

    get rgba() {
        return [this.red / 255.0, this.green / 255.0, this.blue / 255.0, 1.0];
    }

    update() {
        let v = this[this._targetChannel];
        if (v === this._targetValue) {
            this._getNewTarget();
            this.update();
            return;
        } else if (v > this._targetValue) {
            --v;
        } else {
            ++v;
        }
        this[this._targetChannel] = v;
    }

    private _getNewTarget() {
        const r = Math.random();
        const c: 'red' | 'green' | 'blue' = r < 0.333 ? 'red' : r < 0.666 ? 'green' : 'blue';
        this._targetChannel = c;
        this._targetValue = this[c] < 128 ? 255 - Math.floor(Math.random() * 63) : Math.floor(Math.random() * 63);
    }
}

function initShaderProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader!);
    gl.attachShader(program, fragmentShader!);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('Unable to initialize the shader program: ' + info);
    }
    return program;
}

function loadShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('An error occurred compiling the shaders: ' + info);
    }
    return shader;
}

function initBuffers(gl: WebGLRenderingContext): Buffers {
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.8,  0.8,
       -0.8,  0.8,
        0.8, -0.8,
       -0.8, -0.8,
    ]), gl.STATIC_DRAW);
    return { position: positionBuffer };
}

function drawScene(gl: WebGLRenderingContext, programInfo: ProgramInfo, buffers: Buffers, colourChanger: ColourChanger) {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.useProgram(programInfo.program);

    colourChanger.update();
    const rgba = colourChanger.rgba;
    gl.uniform4f(programInfo.uniformLocations.colour, rgba[0], rgba[1], rgba[2], rgba[3]);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function start(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl');
    if (!gl) {
        console.error('Unable to initialize WebGL.');
        return;
    }

    const vsSource = `
        attribute vec2 aVertexPosition;
        void main() {
            gl_Position = vec4(aVertexPosition.x, aVertexPosition.y, 0.0, 1.0);
        }
    `;

    const fsSource = `
        uniform highp vec4 uColour;
        void main() {
            gl_FragColor = uColour;
        }
    `;

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
    const programInfo: ProgramInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
        },
        uniformLocations: {
            colour: gl.getUniformLocation(shaderProgram, 'uColour'),
        },
    };
    const buffers = initBuffers(gl);
    const colourChanger = new ColourChanger();

    function animate() {
        drawScene(gl!, programInfo, buffers, colourChanger);
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}
