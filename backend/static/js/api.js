// api.js - Comunicación con el backend Flask (mismo origen, sin CORS)

export const ID_VITRINA = 1;

export class ErrorApi extends Error {
  constructor(mensaje, { status = 0, datos = null } = {}) {
    super(mensaje);
    this.status = status;
    this.datos = datos;
  }
}

async function pedir(metodo, url, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: metodo,
      headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    throw new ErrorApi("Sin conexión con el servidor", { status: 0 });
  }
  let datos = null;
  try { datos = await respuesta.json(); } catch (e) { /* respuesta sin cuerpo JSON */ }
  if (!respuesta.ok) {
    throw new ErrorApi((datos && datos.error) || `Error ${respuesta.status}`, { status: respuesta.status, datos });
  }
  return datos;
}

export const api = {
  get: (url) => pedir("GET", url),
  put: (url, cuerpo) => pedir("PUT", url, cuerpo),
  post: (url, cuerpo) => pedir("POST", url, cuerpo || {}),
  eliminar: (url) => pedir("DELETE", url),
};

/** GET que informa el avance de la descarga (para la barra de progreso del historial). */
export async function getConProgreso(url, alProgresar) {
  let respuesta;
  try {
    respuesta = await fetch(url, { cache: "no-store" });
  } catch (e) {
    throw new ErrorApi("Sin conexión con el servidor", { status: 0 });
  }
  if (!respuesta.ok) throw new ErrorApi(`Error ${respuesta.status}`, { status: respuesta.status });

  const total = Number(respuesta.headers.get("Content-Length")) || 0;
  if (!respuesta.body || !total) {
    alProgresar(null);
    const datos = await respuesta.json();
    alProgresar(1);
    return datos;
  }
  const lector = respuesta.body.getReader();
  const partes = [];
  let recibido = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    partes.push(value);
    recibido += value.length;
    alProgresar(Math.min(recibido / total, 1));
  }
  const texto = new TextDecoder().decode(await new Blob(partes).arrayBuffer());
  return JSON.parse(texto);
}
