// ui.js - Avisos (toasts), ventana de confirmación y piezas de interfaz reutilizables
import { esc } from "./util.js";

const contenedorAvisos = () => document.getElementById("avisos");

/** Aviso temporal. tipo: "verde" (éxito), "ambar" (advertencia) o "rojo" (error). */
export function aviso({ tipo = "verde", titulo, texto = "", ms = 5500 }) {
  const caja = document.createElement("div");
  caja.className = `aviso ${tipo === "verde" ? "" : tipo}`;
  caja.setAttribute("role", tipo === "rojo" ? "alert" : "status");
  caja.innerHTML = `<div><strong>${esc(titulo)}</strong>${texto ? `<span>${esc(texto)}</span>` : ""}</div>
    <button type="button" aria-label="Cerrar aviso">×</button>`;
  const cerrar = () => caja.remove();
  caja.querySelector("button").addEventListener("click", cerrar);
  contenedorAvisos().append(caja);
  if (ms) setTimeout(cerrar, ms);
  return cerrar;
}

/** Ventana de confirmación. Devuelve una promesa con true (aceptó) o false (canceló). */
export function confirmar({ titulo, texto = "", detalle = "", aceptar = "Aceptar", peligro = true }) {
  const dlg = document.getElementById("dialogo");
  dlg.querySelector("#dialogo-titulo").textContent = titulo;
  dlg.querySelector("#dialogo-texto").textContent = texto;
  dlg.querySelector("#dialogo-detalle").textContent = detalle;
  const bAceptar = dlg.querySelector("#dialogo-aceptar");
  const bCancelar = dlg.querySelector("#dialogo-cancelar");
  bAceptar.textContent = aceptar;
  bAceptar.className = `boton ${peligro ? "peligro" : "primario"}`;

  return new Promise((resolver) => {
    const terminar = (valor) => {
      bAceptar.removeEventListener("click", alAceptar);
      bCancelar.removeEventListener("click", alCancelar);
      dlg.removeEventListener("cancel", alCancelar);
      dlg.close();
      resolver(valor);
    };
    const alAceptar = () => terminar(true);
    const alCancelar = (e) => { if (e) e.preventDefault(); terminar(false); };
    bAceptar.addEventListener("click", alAceptar);
    bCancelar.addEventListener("click", alCancelar);
    dlg.addEventListener("cancel", alCancelar);   // tecla Escape
    dlg.showModal();
    bCancelar.focus();   // la opción segura queda enfocada por defecto
  });
}

export const spinnerBoton = '<span class="giro" aria-hidden="true"></span>';

/** Estado central con icono (errores, vacíos). */
export function estadoCentral({ icono, color, titulo, texto = "", boton = null, claseBoton = "primario" }) {
  const cont = document.createElement("div");
  cont.className = "estado-central";
  cont.innerHTML = `
    ${icono ? `<div class="icono-circulo ${color || ""}" aria-hidden="true">${icono}</div>` : ""}
    <h2>${esc(titulo)}</h2>
    ${texto ? `<p>${esc(texto)}</p>` : ""}
    ${boton ? `<button type="button" class="boton ${claseBoton}">${esc(boton)}</button>` : ""}`;
  return cont;
}
