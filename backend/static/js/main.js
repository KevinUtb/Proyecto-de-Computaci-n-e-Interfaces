// main.js - Arranque de la aplicación: menú, rutas y estado de conexión
import { Monitor } from "./monitor.js";
import { VistaDashboard } from "./vistas/dashboard.js";
import { VistaConfiguracion } from "./vistas/configuracion.js";
import { VistaHistorial } from "./vistas/historial.js";
import { VistaAlertas } from "./vistas/alertas.js";

const monitor = new Monitor();
const RUTAS = {
  dashboard: VistaDashboard,
  configuracion: VistaConfiguracion,
  historial: VistaHistorial,
  alertas: VistaAlertas,
};
let vistaActual = null;

function navegar() {
  const ruta = (location.hash.replace("#/", "") || "dashboard").split("?")[0];
  const Clase = RUTAS[ruta] || VistaDashboard;
  const nombre = RUTAS[ruta] ? ruta : "dashboard";

  if (vistaActual) vistaActual.destruir();
  const main = document.getElementById("vista");
  main.innerHTML = "";
  // Cada vista trabaja en su propio contenedor: si una tarea asíncrona termina cuando ya se cambió de
  // pantalla, solo toca su contenedor descartado y no la pantalla nueva.
  const contenedor = document.createElement("div");
  main.append(contenedor);
  vistaActual = new Clase(monitor);
  vistaActual.montar(contenedor);

  document.querySelectorAll(".menu a").forEach((a) => {
    if (a.dataset.ruta === nombre) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// Barra superior: estado del ESP32 y contador de alertas pendientes
monitor.suscribir((m) => {
  const punto = document.getElementById("conexion-punto");
  const texto = document.getElementById("conexion-texto");
  if (!m.servidorOk) {
    punto.className = "punto mal"; texto.textContent = "Servidor sin respuesta";
  } else if (m.estado && m.estado.conectado) {
    punto.className = "punto ok"; texto.textContent = "ESP32 conectado";
  } else {
    punto.className = "punto mal"; texto.textContent = "ESP32 sin conexión";
  }
  const pend = m.resumen ? m.resumen.pendientes : 0;
  const insignia = document.getElementById("insignia-alertas");
  insignia.hidden = !pend;
  insignia.textContent = pend;
  document.title = `${pend ? `(${pend}) ` : ""}Monitor de Vitrina`;
});

window.addEventListener("hashchange", navegar);
monitor.iniciar();
navegar();
