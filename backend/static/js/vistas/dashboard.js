// dashboard.js - Pantalla principal: estado de la vitrina en tiempo real
import { api, ID_VITRINA } from "../api.js";
import { GraficaTemperatura, COLORES_MARCADOR } from "../graficas.js";
import { aviso, estadoCentral } from "../ui.js";
import { esc, fmtTemp, fmtUmbral, horaDe, NOMBRE_MODO, TIPO_ALERTA, ICONO_CHECK } from "../util.js";

export class VistaDashboard {
  constructor(monitor) {
    this.monitor = monitor;
    this.grafica = null;
    this.enviando = false;
  }

  montar(raiz) {
    this.raiz = raiz;
    raiz.innerHTML = `
      <div class="subbarra" id="d-subbarra" hidden></div>
      <div class="contenido">
        <div id="d-banner"></div>
        <div id="d-vacio" hidden></div>
        <div id="d-principal">
          <div id="d-tarjetas" class="fila-tarjetas"></div>
          <div class="rejilla-inferior">
            <section class="tarjeta" aria-labelledby="t-grafica">
              <h2 id="t-grafica">Temperatura del día (°C)</h2>
              <div class="caja-grafica">
                <canvas id="d-canvas" role="img" aria-label="Gráfica de la temperatura de hoy con las líneas de mínimo y máximo"></canvas>
                <div class="cargando-centro" id="d-cargando"><div class="giro grande"></div><span>Cargando lecturas...</span></div>
                <div class="cargando-centro" id="d-sin-lecturas" hidden><span>Aún no hay lecturas hoy</span></div>
              </div>
            </section>
            <div class="columna-derecha">
              <section class="tarjeta" aria-labelledby="t-control">
                <h2 id="t-control">Control del ventilador</h2>
                <div class="opciones" role="radiogroup" aria-labelledby="t-control">
                  <label class="opcion"><input type="radio" name="modo" value="auto"> Automático</label>
                  <label class="opcion"><input type="radio" name="modo" value="manual"> Manual</label>
                  <label class="opcion"><input type="radio" name="modo" value="apagado"> Apagado</label>
                </div>
                <p class="nota" id="d-nota-manual">Botón manual: solo en modo Manual</p>
                <button type="button" class="boton primario ancho" id="d-boton-manual" hidden style="margin-top:14px"></button>
              </section>
              <section class="tarjeta" aria-labelledby="t-alertas">
                <h2 id="t-alertas">Últimas alertas</h2>
                <div id="d-alertas"></div>
              </section>
            </div>
          </div>
        </div>
      </div>`;

    this.q = (s) => raiz.querySelector(s);
    this.grafica = new GraficaTemperatura(this.q("#d-canvas"));

    raiz.querySelectorAll('input[name="modo"]').forEach((r) =>
      r.addEventListener("change", () => this.cambiarModo(r.value)));
    this.q("#d-boton-manual").addEventListener("click", () => this.alternarManual());

    this.dibujarEsqueleto();
    this.baja = this.monitor.suscribir((m) => this.dibujar(m));
  }

  destruir() {
    if (this.baja) this.baja();
    if (this.grafica) this.grafica.destruir();
  }

  // ---------- Acciones de la persona (Humano -> Máquina) ----------
  async cambiarModo(modo) {
    if (this.enviando) return;
    this.enviando = true;
    try {
      await api.post("/ventilador", { id_vitrina: ID_VITRINA, modo });
    } catch (e) {
      aviso({ tipo: "rojo", titulo: "No se pudo cambiar el modo", texto: "Intenta de nuevo." });
    } finally {
      this.enviando = false;
      await this.monitor.actualizar();
    }
  }

  async alternarManual() {
    if (this.enviando) return;
    this.enviando = true;
    this.q("#d-boton-manual").disabled = true;
    try {
      await api.post("/ventilador", { id_vitrina: ID_VITRINA, modo: "manual", encendido: !this.monitor.estado.ventilador_manual });
    } catch (e) {
      aviso({ tipo: "rojo", titulo: "No se pudo enviar la orden", texto: "Intenta de nuevo." });
    } finally {
      this.enviando = false;
      await this.monitor.actualizar();
    }
  }

  // ---------- Respuestas (Máquina -> Humano) ----------
  dibujarEsqueleto() {
    const tarjeta = '<div class="tarjeta"><div class="esqueleto linea"></div><div class="esqueleto valor"></div></div>';
    this.q("#d-tarjetas").innerHTML = tarjeta.repeat(3);
    this.q("#d-alertas").innerHTML = '<div class="esqueleto linea" style="width:70%"></div>';
  }

  dibujar(m) {
    // Servidor caído (no es lo mismo que "ESP32 sin conexión")
    if (!m.servidorOk && !m.cargado) {
      this.q("#d-principal").hidden = true;
      this.q("#d-banner").innerHTML = this.banner("No se pudo conectar con el servidor", "Revisa que el backend esté en ejecución (python app.py). La pantalla se reconecta sola.");
      return;
    }
    if (!m.cargado) return;
    const e = m.estado;

    // Primera vez: aún no hay una vitrina configurada
    const vacio = this.q("#d-vacio");
    this.q("#d-principal").hidden = !e.configurada;
    vacio.hidden = e.configurada;
    this.q("#d-subbarra").hidden = !e.configurada;
    if (!e.configurada) {
      if (!vacio.firstChild) {
        const caja = document.createElement("div");
        caja.className = "tarjeta";
        const centro = estadoCentral({
          icono: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="#b5c0cd" stroke-width="3.5" stroke-linecap="round"><rect x="6" y="14" width="52" height="34" rx="6"/><path d="M20 31h24"/></svg>',
          titulo: "Aún no has configurado una vitrina",
          boton: "Configurar mi primera vitrina",
        });
        centro.querySelector(".icono-circulo").style.cssText = "background:none;width:auto;height:auto";
        centro.querySelector("button").addEventListener("click", () => { location.hash = "#/configuracion"; });
        caja.append(centro);
        vacio.append(caja);
      }
      this.q("#d-banner").innerHTML = "";
      return;
    }

    this.dibujarSubbarra(e);
    this.dibujarBanner(m);
    this.dibujarTarjetas(m);
    this.dibujarControl(m);
    this.dibujarAlertas(m);
    this.dibujarGrafica(m);
  }

  dibujarSubbarra(e) {
    const ult = e.ultima_lectura;
    const sb = this.q("#d-subbarra");
    sb.innerHTML = `<span>Vitrina: <b>${esc(e.nombre)}</b> (${esc(e.tipo_producto)})</span><span class="sep"></span>
      <span>Rango seguro: <b>${fmtUmbral(e.umbral_minimo)} – ${fmtUmbral(e.umbral_maximo)} °C</b></span><span class="sep"></span>
      <span>Última lectura: <b>${ult ? horaDe(ult.timestamp, true) : "--:--:--"}</b></span>`;
  }

  banner(titulo, detalle = "", clase = "") {
    return `<div class="banner ${clase}" role="alert"><div><span>${esc(titulo)}</span>${detalle ? `<span class="detalle">${esc(detalle)}</span>` : ""}</div></div>`;
  }

  dibujarBanner(m) {
    const e = m.estado, ult = e.ultima_lectura;
    let html = "";
    if (!m.servidorOk) {
      html = this.banner("Sin conexión con el servidor", "Se muestran los últimos datos recibidos. La pantalla se reconecta sola.");
    } else if (!e.conectado) {
      const desde = e.ultimo_contacto ? `El ESP32 no responde desde las ${horaDe(e.ultimo_contacto)}` : "El ESP32 todavía no ha enviado datos";
      html = this.banner("Sin conexión con la vitrina", desde);
    } else if (!e.sensor_error && ult && (ult.estado !== "NORMAL")) {
      const alto = ult.estado === "FUERA_RANGO_ALTO";
      let msg = alto ? `Temperatura sobre el máximo (${fmtUmbral(e.umbral_maximo)} °C).` : `Temperatura bajo el mínimo (${fmtUmbral(e.umbral_minimo)} °C).`;
      if (ult.ventilador) msg += e.modo === "auto" ? " Ventilador encendido automáticamente." : " Ventilador encendido.";
      else if (e.modo === "apagado") msg += " El ventilador está en modo Apagado: revisa el equipo.";
      else if (e.modo === "manual") msg += " El ventilador está apagado (modo Manual).";
      else msg += " Revisa el equipo de refrigeración.";
      const detalle = e.requiere_revision
        ? `Lleva ${e.minutos_fuera} min fuera de rango (límite ${e.tiempo_revision_min} min). Revisa el equipo de refrigeración.` : "";
      html = this.banner(msg, detalle);
    }
    this.q("#d-banner").innerHTML = html;
  }

  dibujarTarjetas(m) {
    const e = m.estado, ult = e.ultima_lectura;
    const caja = this.q("#d-tarjetas");

    if (e.sensor_error) {
      caja.style.display = "block";
      caja.innerHTML = `<div class="tarjeta"></div>`;
      caja.firstChild.append(estadoCentral({
        icono: "!", color: "ambar",
        titulo: "Sensor desconectado o lectura inválida",
        texto: "Revisa el cable del sensor DS18B20",
      }));
      return;
    }
    caja.style.display = "";

    const sinDatos = !e.conectado || !ult;
    const color = sinDatos ? "gris" : e.semaforo === "rojo" ? "rojo" : e.semaforo === "amarillo" ? "amarillo" : "verde";
    const etiqueta = sinDatos ? "SIN DATOS"
      : color === "rojo" ? (ult.estado !== "NORMAL" ? "FUERA DE RANGO" : "RECUPERANDO")
      : color === "amarillo" ? "CERCA DEL LÍMITE" : "NORMAL";
    const claseTemp = sinDatos ? "gris" : color === "rojo" ? "rojo" : color === "amarillo" ? "ambar" : "";

    // Ventilador
    let ventTexto, ventClase = "", ventSub;
    if (sinDatos) {
      ventTexto = "SIN RESPUESTA"; ventSub = "No se pueden enviar órdenes";
    } else {
      ventTexto = ult.ventilador ? "ENCENDIDO" : "APAGADO";
      ventClase = ult.ventilador ? "on" : "";
      ventSub = `Modo: ${NOMBRE_MODO[e.modo]}` + (e.orden_pendiente ? " · enviando orden al ESP32..." : "");
    }

    caja.innerHTML = `
      <div class="tarjeta"><span class="etiqueta">Temperatura actual</span>
        <div><div class="valor-grande ${claseTemp}">${fmtTemp(sinDatos ? null : ult.temperatura)} °C</div>
        <div class="sub-valor">${ult && sinDatos ? `Último dato: ${horaDe(ult.timestamp)}` : ult ? "&nbsp;" : "Aún no hay lecturas"}</div></div></div>
      <div class="tarjeta"><span class="etiqueta">Estado de la vitrina</span>
        <div class="semaforo"><span class="luz ${color}" aria-hidden="true"></span><span class="texto ${color}">${etiqueta}</span></div><span></span></div>
      <div class="tarjeta"><span class="etiqueta">Ventilador</span>
        <div><div class="ventilador-estado ${ventClase}">${ventTexto}</div><div class="sub-valor">${esc(ventSub)}</div></div></div>`;
  }

  dibujarControl(m) {
    const e = m.estado;
    const sin = !e.conectado;
    this.raiz.querySelectorAll('input[name="modo"]').forEach((r) => {
      r.checked = r.value === e.modo;
      r.disabled = sin || this.enviando;
    });
    const manual = e.modo === "manual";
    const btn = this.q("#d-boton-manual");
    btn.hidden = !manual;
    this.q("#d-nota-manual").textContent = sin
      ? "Sin conexión con el ESP32: no es posible enviar órdenes."
      : manual ? (e.orden_pendiente ? "Orden enviada: esperando que el ESP32 la confirme." : "Modo Manual activo.")
      : "Botón manual: solo en modo Manual";
    if (manual) {
      btn.textContent = e.ventilador_manual ? "Apagar ventilador" : "Encender ventilador";
      btn.disabled = sin || this.enviando || e.orden_pendiente;
    }
  }

  dibujarAlertas(m) {
    const hoy = m.estado.fecha_hoy;
    const lista = m.alertas.filter((a) => a.nivel_urgencia !== "INFO" && a.timestamp.startsWith(hoy)).slice(0, 3);
    const caja = this.q("#d-alertas");
    if (!lista.length) {
      caja.innerHTML = `<div class="alerta-mini"><span class="icono-circulo verde" style="width:40px;height:40px;font-size:0" aria-hidden="true">${ICONO_CHECK.replace("<svg", '<svg style="width:24px;height:24px"')}</span>
        <div><div class="linea">Sin alertas hoy</div><div class="etiqueta" style="font-size:13px">La vitrina está estable</div></div></div>`;
      return;
    }
    caja.innerHTML = `<div class="lista-alertas">${lista.map((a) => `
      <a class="alerta-mini" href="#/alertas">
        <span class="punto-estado ${a.reconocida ? "gris" : "rojo"}"></span>
        <div><div class="linea"><span class="hora">${horaDe(a.timestamp)}</span>${esc(TIPO_ALERTA[a.tipo_alerta] || a.tipo_alerta)}</div>
        ${a.reconocida ? "" : '<div class="pendiente">Pendiente de reconocer</div>'}</div>
      </a>`).join("")}</div><a class="enlace-ver" href="#/alertas">Ver todas las alertas</a>`;
  }

  dibujarGrafica(m) {
    const e = m.estado;
    const lect = m.lecturas;
    this.q("#d-cargando").hidden = true;
    this.q("#d-sin-lecturas").hidden = lect.length > 0;

    const marcadores = [];
    let ultimoOn = -1;
    for (let i = 1; i < lect.length; i++) {
      if (lect[i].ventilador && !lect[i - 1].ventilador) {
        ultimoOn = i;
        marcadores.push({ x: lect[i].x, y: lect[i].temperatura, color: COLORES_MARCADOR.ventilador, radio: 6 });
      }
    }
    if (ultimoOn >= 0) marcadores[marcadores.length - 1].texto = "Ventilador ON";
    const ult = lect[lect.length - 1];
    if (ult && ult.estado !== "NORMAL") {
      marcadores.push({ x: ult.x, y: ult.temperatura, color: COLORES_MARCADOR.fuera, radio: 6 });
    }
    const VENTANA_S = 600;                       // segundos visibles (600 = 10 min)
    const xMax = ult ? ult.x + 30 : undefined;   // un poquito de margen a la derecha
    const xMin = ult ? xMax - VENTANA_S : undefined;
    this.grafica.actualizar(lect, {
      umbralMin: e.umbral_minimo, umbralMax: e.umbral_maximo, marcadores, huecoS: e.intervalo_s * 3,
      xMin, xMax,
    });
  }
}
