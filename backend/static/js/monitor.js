// monitor.js - Estado compartido de la aplicación.
// Consulta al backend cada pocos segundos y avisa a las pantallas suscritas.
// También detecta los cambios importantes (fuera de rango, recuperación, conexión) para mostrar avisos.
import { api, ID_VITRINA } from "./api.js";
import { aviso } from "./ui.js";
import { segundosDelDia } from "./util.js";

const PERIODO_MS = 3000;

export class Monitor {
  constructor() {
    this.estado = null;       // respuesta de /estado
    this.lecturas = [];       // lecturas de hoy: {id, timestamp, temperatura, estado, ventilador, x}
    this.alertas = [];        // últimas alertas
    this.resumen = null;      // {alertas_hoy, pendientes, segundos_fuera_rango}
    this.servidorOk = true;
    this.cargado = false;
    this._suscriptores = new Set();
    this._fecha = null;
    this._ocupado = false;
  }

  suscribir(fn) {
    this._suscriptores.add(fn);
    if (this.cargado || !this.servidorOk) fn(this);
    return () => this._suscriptores.delete(fn);
  }

  _notificar() { this._suscriptores.forEach((fn) => fn(this)); }

  iniciar() {
    this.actualizar();
    setInterval(() => { if (!document.hidden) this.actualizar(); }, PERIODO_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.actualizar(); });
  }

  /** Se llama después de borrar el historial para no seguir mostrando lecturas viejas. */
  reiniciarLecturas() { this.lecturas = []; }

  async actualizar() {
    if (this._ocupado) return;
    this._ocupado = true;
    try {
      const previo = this.estado;
      const estado = await api.get(`/estado?id_vitrina=${ID_VITRINA}`);

      // Cambio de día o historial borrado: se empieza de cero
      if (this._fecha !== estado.fecha_hoy || (!estado.ultima_lectura && this.lecturas.length)) {
        this.lecturas = [];
        this._fecha = estado.fecha_hoy;
      }
      const ultimoId = this.lecturas.length ? this.lecturas[this.lecturas.length - 1].id : 0;
      const [nuevas, alertas, resumen] = await Promise.all([
        api.get(`/lecturas?id_vitrina=${ID_VITRINA}&fecha=${estado.fecha_hoy}&despues_de=${ultimoId}`),
        api.get(`/alertas?id_vitrina=${ID_VITRINA}&limite=15`),
        api.get(`/alertas/resumen?id_vitrina=${ID_VITRINA}`),
      ]);
      nuevas.forEach((l) => { l.x = segundosDelDia(l.timestamp); });
      this.lecturas.push(...nuevas);
      this.estado = estado;
      this.alertas = alertas;
      this.resumen = resumen;
      this.servidorOk = true;
      this.cargado = true;
      this._detectarCambios(previo, estado);
    } catch (e) {
      this.servidorOk = false;
    } finally {
      this._ocupado = false;
      this._notificar();
    }
  }

  _detectarCambios(previo, nuevo) {
    if (!previo || !nuevo.configurada) return;
    const ult = nuevo.ultima_lectura;
    const fueraAntes = previo.ultima_lectura && previo.ultima_lectura.estado !== "NORMAL";
    const fueraAhora = ult && ult.estado !== "NORMAL";

    if (fueraAhora && !fueraAntes) {
      const alto = ult.estado === "FUERA_RANGO_ALTO";
      aviso({
        tipo: "ambar",
        titulo: alto ? "Temperatura sobre el máximo" : "Temperatura bajo el mínimo",
        texto: ult.ventilador ? "Ventilador encendido" : "Revisa el equipo de refrigeración",
      });
    }
    if (previo.alerta_abierta && !nuevo.alerta_abierta && !fueraAhora) {
      aviso({
        titulo: "Temperatura estabilizada",
        texto: ult && ult.ventilador ? "Ventilador encendido" : "Ventilador apagado",
      });
    }
    if (!previo.conectado && nuevo.conectado && previo.ultimo_contacto) {
      aviso({ titulo: "Conexión recuperada", texto: "El ESP32 volvió a enviar datos" });
    }
    if (nuevo.sensor_error && !previo.sensor_error) {
      aviso({ tipo: "ambar", titulo: "Sensor desconectado o lectura inválida", texto: "Revisa el cable del sensor DS18B20" });
    }
  }
}
