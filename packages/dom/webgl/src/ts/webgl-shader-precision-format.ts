export class WebGLShaderPrecisionFormat implements WebGLShaderPrecisionFormat {
    rangeMin: number;
    rangeMax: number;
    precision: number;
    constructor (_: WebGLShaderPrecisionFormat) {
        this.rangeMin = _.rangeMin
        this.rangeMax = _.rangeMax
        this.precision = _.precision
    }
}
