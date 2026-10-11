// Errores "esperados": se convierten en una respuesta HTTP con un código corto y un mensaje para la persona.
// Todo lo demás (errores inesperados) se responde como un 500 genérico, sin detalles.
export class ErrorHttp extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export const malPedido = (codigo: string, mensaje: string) => new ErrorHttp(400, codigo, mensaje);
export const sinSesion = () => new ErrorHttp(401, 'sin_sesion', 'Hay que iniciar sesión.');
export const prohibido = (codigo = 'prohibido', mensaje = 'No permitido.') => new ErrorHttp(403, codigo, mensaje);
export const noExiste = () => new ErrorHttp(404, 'no_existe', 'No existe.');
export const demasiados = () => new ErrorHttp(429, 'demasiados_intentos', 'Demasiados intentos. Esperá un rato.');
