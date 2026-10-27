// historial.js - Consulta de lecturas pasadas por fecha y hora
import { api, getConProgreso, ID_VITRINA } from "../api.js";
import { GraficaTemperatura, COLORES_MARCADOR } from "../graficas.js";
import { aviso, confirmar, estadoCentral } from "../ui.js";
import { esperar, fmtFecha, fmtTemp, horaDe, segundosDelDia } from "../util.js";

const FILAS_POR_PAGINA = 50;
const ICONO_GRAFICA = '<svg viewBox="0 0 160 130" width="150" height="120" fill="none" stroke="#b5c0cd" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 10v100h110"/><path d="M45 85l30-30 25 22 30-42" stroke-dasharray="12 10"/></svg>';

export class VistaHistorial {
  constructor(monitor) {
    this.monitor = monitor;
    this.grafica = null;
    this.lecturas = [];
    this.pagina = 0;
    this.fechaHoy = null;
  }

  async montar(raiz) {
    this.raiz = raiz;
    raiz.innerHTML = `
      <div class="contenido">
        <section class="tarjeta" aria-labelledby="t-hist">
          <h2 id="t-hist" style="font-size:19px">Consultar historial</h2>
          <div class="filtros">
            <div class="campo"><label for="h-fecha">Fecha</label><input type="date" id="h-fecha" aria-describedby="e-fecha"><div class="error-campo" id="e-fecha"></div></div>
            <div class="campo"><label for="h-desde">Desde</label><input type="time" id="h-desde" value="00:00" aria-describedby="e-hora"></div>
            <div class="campo"><label for="h-hasta">Hasta</label><input type="time" id="h-hasta" value="23:59" aria-describedby="e-hora"><div class="error-campo" id="e-hora"></div></div>
            <div class="botones">
              <button type="button" class="boton primario" id="h-consultar">Consultar</button>
              <button type="button" class="boton peligro-borde" id="h-eliminar">Eliminar historial</button>
            </div>
          </div>
        </section>
        <div id="h-resultado" class="bloque" aria-live="polite"></div>
      </div>`;
    this.q = (s) => raiz.querySelector(s);

    // La fecha de hoy la define el servidor, para que coincida con las lecturas guardadas
    try {
      const est = await api.get(`/estado?id_vitrina=${ID_VITRINA}`);
      this.fechaHoy = est.fecha_hoy;
    } catch (e) {
      const d = new Date();
      this.fechaHoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    const f = this.q("#h-fecha");
    f.max = this.fechaHoy;          // no permite elegir fechas futuras
    f.value = this.fechaHoy;

    this.q("#h-consultar").addEventListener("click", () => this.consultar());
    this.q("#h-eliminar").addEventListener("click", () => this.eliminar());
    ["#h-fecha", "#h-desde", "#h-hasta"].forEach((s) => {
      this.q(s).addEventListener("change", () => this.validar());
      this.q(s).addEventListener("keydown", (e) => { if (e.key === "Enter") this.consultar(); });
    });
    this.consultar();
  }

  destruir() { if (this.grafica) this.grafica.destruir(); }

  validar() {
    const fecha = this.q("#h-fecha").value, desde = this.q("#h-desde").value, hasta = this.q("#h-hasta").value;
    let errFecha = "", errHora = "";
    if (!fecha) errFecha = "Elige una fecha.";
    else if (fecha > this.fechaHoy) errFecha = "No puedes consultar fechas futuras.";
    if (!desde || !hasta) errHora = "Elige la hora inicial y la final.";
    else if (desde >= hasta) errHora = "La hora inicial debe ser menor que la final.";
    this.q("#e-fecha").textContent = errFecha;
    this.q("#e-hora").textContent = errHora;
    this.q("#h-fecha").closest(".campo").classList.toggle("invalido", Boolean(errFecha));
    ["#h-desde", "#h-hasta"].forEach((s) => this.q(s).closest(".campo").classList.toggle("invalido", Boolean(errHora)));
    return !errFecha && !errHora;
  }

  async consultar() {
    if (!this.validar()) return;
    const fecha = this.q("#h-fecha").value, desde = this.q("#h-desde").value, hasta = this.q("#h-hasta").value;
    const res = this.q("#h-resultado");
    const boton = this.q("#h-consultar");
    boton.disabled = true;
    if (this.grafica) { this.grafica.destruir(); this.grafica = null; }

    // Barra de progreso mientras se consulta (D en el documento de diseño)
    res.innerHTML = `<section class="tarjeta" style="text-align:center;padding:36px 22px">
      <p class="etiqueta" style="font-size:15px">Consultando historial del ${fmtFecha(fecha)}...</p>
      <div class="progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div style="width:4%"></div></div>
      <p class="etiqueta" id="h-pct">0 %</p></section>`;
    const barra = res.querySelector(".progreso"), relleno = barra.firstElementChild, pct = res.querySelector("#h-pct");
    const progreso = (p) => {
      const n = p === null ? 50 : Math.round(p * 100);
      relleno.style.width = `${Math.max(n, 4)}%`;
      barra.setAttribute("aria-valuenow", n);
      pct.textContent = `${n} %`;
    };

    try {
      const url = `/lecturas?id_vitrina=${ID_VITRINA}&fecha=${fecha}&desde=${desde}&hasta=${hasta}`;
      const [datos] = await Promise.all([getConProgreso(url, progreso), esperar(450)]);   // 450 ms mínimo para que se alcance a ver el avance
      datos.forEach((l) => { l.x = segundosDelDia(l.timestamp); });
      this.lecturas = datos;
      this.pagina = 0;
      const est = await api.get(`/estado?id_vitrina=${ID_VITRINA}`);
      this.umbrales = { min: est.umbral_minimo, max: est.umbral_maximo, hueco: est.intervalo_s * 3 };
      this.mostrar(fecha);
    } catch (e) {
      res.innerHTML = "";
      const tarjeta = document.createElement("section");
      tarjeta.className = "tarjeta";
      const central = estadoCentral({ icono: "!", color: "rojo", titulo: "No se pudo cargar el historial", texto: "Error del servidor. Intenta de nuevo.", boton: "Reintentar" });
      central.querySelector("button").addEventListener("click", () => this.consultar());
      tarjeta.append(central);
      res.append(tarjeta);
    } finally {
      boton.disabled = false;
    }
  }

  mostrar(fecha) {
    const res = this.q("#h-resultado");
    if (!this.lecturas.length) {
      res.innerHTML = "";
      const tarjeta = document.createElement("section");
      tarjeta.className = "tarjeta";
      const central = estadoCentral({ icono: ICONO_GRAFICA, titulo: "Aún no hay lecturas para esta fecha", boton: fecha === this.fechaHoy ? null : "Ver hoy" });
      const ic = central.querySelector(".icono-circulo");
      if (ic) ic.style.cssText = "background:none;width:auto;height:auto";
      const b = central.querySelector("button");
      if (b) b.addEventListener("click", () => { this.q("#h-fecha").value = this.fechaHoy; this.consultar(); });
      tarjeta.append(central);
      res.append(tarjeta);
      return;
    }

    res.innerHTML = `
      <section class="tarjeta" aria-labelledby="t-hg">
        <div class="encabezado-tarjeta"><h2 id="t-hg">Temperatura registrada (°C)</h2><span>${this.lecturas.length} lecturas</span></div>
        <div class="caja-grafica corta"><canvas id="h-canvas" role="img" aria-label="Gráfica de la temperatura registrada en el rango elegido"></canvas></div>
      </section>
      <section class="tarjeta bloque" aria-labelledby="t-ht">
        <h2 id="t-ht" class="sr-only">Tabla de lecturas</h2>
        <div class="tabla-envoltorio"><table>
          <thead><tr><th>Hora</th><th>Temperatura</th><th>Estado</th><th>Ventilador</th></tr></thead>
          <tbody id="h-cuerpo"></tbody></table></div>
        <div class="paginacion" id="h-pag"></div>
      </section>`;

    // Marcador del pico, si superó el máximo
    const pico = this.lecturas.reduce((a, b) => (b.temperatura > a.temperatura ? b : a));
    const marcadores = [];
    if (pico.temperatura > this.umbrales.max) {
      marcadores.push({
        x: pico.x, y: pico.temperatura, color: COLORES_MARCADOR.ventilador, radio: 5, alinear: "center",
        texto: `Pico ${fmtTemp(pico.temperatura)} °C${pico.ventilador ? ": ventilador ON" : ""}`,
      });
    }
    this.grafica = new GraficaTemperatura(this.q("#h-canvas"));
    this.grafica.actualizar(this.lecturas, { umbralMin: this.umbrales.min, umbralMax: this.umbrales.max, marcadores, huecoS: this.umbrales.hueco });
    this.dibujarTabla();
  }

  dibujarTabla() {
    const total = this.lecturas.length;
    const paginas = Math.ceil(total / FILAS_POR_PAGINA);
    const ini = this.pagina * FILAS_POR_PAGINA;
    const filas = this.lecturas.slice(ini, ini + FILAS_POR_PAGINA);
    this.q("#h-cuerpo").innerHTML = filas.map((l) => {
      const fuera = l.estado !== "NORMAL";
      return `<tr><td>${horaDe(l.timestamp, true)}</td><td>${fmtTemp(l.temperatura)} °C</td>
        <td><span class="estado-celda ${fuera ? "rojo" : "verde"}"><span class="punto-estado ${fuera ? "rojo" : "verde"}"></span>${fuera ? "Fuera de rango" : "Normal"}</span></td>
        <td>${l.ventilador ? "Encendido" : "Apagado"}</td></tr>`;
    }).join("");

    const pag = this.q("#h-pag");
    if (paginas <= 1) { pag.hidden = true; return; }
    pag.hidden = false;
    pag.innerHTML = `<span>Mostrando ${ini + 1}–${Math.min(ini + FILAS_POR_PAGINA, total)} de ${total}</span>
      <div class="botones"><button type="button" class="boton secundario pequeno" id="h-ant" ${this.pagina === 0 ? "disabled" : ""}>Anterior</button>
      <button type="button" class="boton secundario pequeno" id="h-sig" ${this.pagina >= paginas - 1 ? "disabled" : ""}>Siguiente</button></div>`;
    pag.querySelector("#h-ant").addEventListener("click", () => { this.pagina--; this.dibujarTabla(); });
    pag.querySelector("#h-sig").addEventListener("click", () => { this.pagina++; this.dibujarTabla(); });
  }

  async eliminar() {
    const si = await confirmar({
      titulo: "¿Eliminar historial?",
      texto: "Esta acción no se puede deshacer.",
      detalle: "Se borrarán todas las lecturas guardadas de la vitrina.",
      aceptar: "Eliminar",
    });
    if (!si) return;
    try {
      await api.eliminar(`/lecturas?id_vitrina=${ID_VITRINA}`);
      this.monitor.reiniciarLecturas();
      aviso({ titulo: "Historial eliminado", texto: "Se borraron las lecturas guardadas." });
      this.monitor.actualizar();
      await this.consultar();
    } catch (e) {
      aviso({ tipo: "rojo", titulo: "No se pudo eliminar el historial", texto: "Intenta de nuevo." });
    }
  }
}
