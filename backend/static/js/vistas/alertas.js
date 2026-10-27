// alertas.js - Revisar y reconocer las alertas generadas
import { api, ID_VITRINA } from "../api.js";
import { aviso, estadoCentral } from "../ui.js";
import { esc, fmtDuracion, fmtTemp, horaDe, TIPO_ALERTA, ICONO_CHECK } from "../util.js";

const FILTROS = [["todas", "Todas"], ["pendientes", "Pendientes"], ["reconocidas", "Reconocidas"]];

export class VistaAlertas {
  constructor(monitor) {
    this.monitor = monitor;
    this.filtro = "todas";
    this.firma = "";
  }

  montar(raiz) {
    this.raiz = raiz;
    raiz.innerHTML = `
      <div class="contenido">
        <div class="pildoras" role="group" aria-label="Filtrar alertas">
          ${FILTROS.map(([id, texto]) => `<button type="button" class="pildora" data-filtro="${id}" aria-pressed="${id === this.filtro}">${texto}</button>`).join("")}
        </div>
        <section class="tarjeta" style="padding:8px 16px" aria-label="Lista de alertas"><div id="a-lista" aria-live="polite"></div></section>
        <div class="tarjetas-resumen" id="a-resumen"></div>
      </div>`;
    this.q = (s) => raiz.querySelector(s);
    raiz.querySelectorAll(".pildora").forEach((b) => b.addEventListener("click", () => {
      this.filtro = b.dataset.filtro;
      raiz.querySelectorAll(".pildora").forEach((x) => x.setAttribute("aria-pressed", x === b));
      this.firma = "";
      this.cargar();
    }));
    this.q("#a-lista").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) this.reconocer(Number(b.dataset.id), b);
    });
    this.cargar();
    this.baja = this.monitor.suscribir(() => this.cargar());   // se refresca con cada consulta del monitor
  }

  destruir() { if (this.baja) this.baja(); }

  async cargar() {
    try {
      const [alertas, resumen] = await Promise.all([
        api.get(`/alertas?id_vitrina=${ID_VITRINA}&estado=${this.filtro}&limite=100`),
        api.get(`/alertas/resumen?id_vitrina=${ID_VITRINA}`),
      ]);
      const firma = JSON.stringify([alertas, resumen]);
      if (firma === this.firma) return;      // nada cambió: no se vuelve a dibujar
      this.firma = firma;
      this.dibujarLista(alertas);
      this.dibujarResumen(resumen);
    } catch (e) {
      if (!this.firma) {
        this.q("#a-lista").innerHTML = "";
        const c = estadoCentral({ icono: "!", color: "rojo", titulo: "No se pudieron cargar las alertas", texto: "Revisa la conexión con el servidor.", boton: "Reintentar" });
        c.querySelector("button").addEventListener("click", () => this.cargar());
        this.q("#a-lista").append(c);
      }
    }
  }

  dibujarLista(alertas) {
    const lista = this.q("#a-lista");
    if (!alertas.length) {
      lista.innerHTML = "";
      const textos = {
        todas: ["Sin alertas hoy", "La vitrina se ha mantenido estable"],
        pendientes: ["No hay alertas pendientes", "Todas las alertas ya fueron reconocidas"],
        reconocidas: ["Aún no hay alertas reconocidas", ""],
      }[this.filtro];
      lista.append(estadoCentral({ icono: ICONO_CHECK, color: "verde", titulo: textos[0], texto: textos[1] }));
      return;
    }
    const hoy = this.monitor.estado ? this.monitor.estado.fecha_hoy : "";
    lista.innerHTML = `<div class="tabla-envoltorio"><table class="tabla-alertas">
      <thead><tr><th>Hora</th><th>Tipo</th><th>Temp.</th><th>Acción automática</th><th>Estado</th><th></th></tr></thead>
      <tbody>${alertas.map((a) => {
        const pendiente = !a.reconocida;
        const color = pendiente ? "rojo" : a.tipo_alerta === "RECUPERACION" ? "verde" : "gris";
        const dia = a.timestamp.startsWith(hoy) ? "" : `<span class="sub">${a.timestamp.slice(8, 10)}/${a.timestamp.slice(5, 7)}</span>`;
        return `<tr>
          <td>${horaDe(a.timestamp)}${dia}</td>
          <td>${esc(TIPO_ALERTA[a.tipo_alerta] || a.tipo_alerta)}</td>
          <td>${a.temperatura === null ? "--" : `${fmtTemp(a.temperatura)} °C`}</td>
          <td>${esc(a.accion)}</td>
          <td><span class="estado-celda ${color}"><span class="punto-estado ${color}"></span>${pendiente ? "Pendiente" : "Reconocida"}</span></td>
          <td class="accion">${pendiente ? `<button type="button" class="boton primario pequeno" data-id="${a.id}">Reconocer</button>` : ""}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  dibujarResumen(r) {
    this.q("#a-resumen").innerHTML = `
      <div class="tarjeta"><span class="etiqueta">Alertas hoy</span><div class="valor-grande">${r.alertas_hoy}</div></div>
      <div class="tarjeta"><span class="etiqueta">Pendientes</span><div class="valor-grande ${r.pendientes ? "rojo" : ""}">${r.pendientes}</div></div>
      <div class="tarjeta"><span class="etiqueta">Tiempo fuera de rango</span><div class="valor-grande ${r.segundos_fuera_rango ? "ambar" : ""}">${fmtDuracion(r.segundos_fuera_rango)}</div></div>`;
  }

  async reconocer(id, boton) {
    boton.disabled = true;
    try {
      await api.post(`/alertas/${id}/reconocer`);
      aviso({ titulo: "Alerta reconocida", texto: "Se actualizó el contador de pendientes." });
      this.firma = "";
      await this.cargar();
      this.monitor.actualizar();
    } catch (e) {
      boton.disabled = false;
      aviso({ tipo: "rojo", titulo: "No se pudo reconocer la alerta", texto: "Intenta de nuevo." });
    }
  }
}
