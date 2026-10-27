// util.js - Funciones de formato compartidas

const nf1 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 4.2 -> "4,2" */
export const fmtTemp = (v) => (v === null || v === undefined ? "--" : nf1.format(v));

/** 6 -> "6", 2.5 -> "2,5" (umbrales: sin decimales cuando son enteros) */
export const fmtUmbral = (v) => (Number.isInteger(v) ? String(v) : nf1.format(v));

/** "2026-10-06T14:52:10" -> "14:52:10" (o "14:52" sin segundos) */
export const horaDe = (ts, conSegundos = false) => (ts ? ts.slice(11, conSegundos ? 19 : 16) : "--:--");

/** "2026-10-06T14:52:10" -> segundos desde la medianoche */
export function segundosDelDia(ts) {
  const h = Number(ts.slice(11, 13)), m = Number(ts.slice(14, 16)), s = Number(ts.slice(17, 19)) || 0;
  return h * 3600 + m * 60 + s;
}

/** segundos del día -> "HH:MM" */
export function fmtHoraSeg(seg, conSegundos = false) {
  const h = Math.floor(seg / 3600) % 24, m = Math.floor((seg % 3600) / 60), s = Math.floor(seg % 60);
  const dos = (n) => String(n).padStart(2, "0");
  return conSegundos ? `${dos(h)}:${dos(m)}:${dos(s)}` : `${dos(h)}:${dos(m)}`;
}

/** "2026-10-06" -> "06/10/2026" */
export const fmtFecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/** segundos -> "0 min", "16 min", "1 h 05 min" */
export function fmtDuracion(seg) {
  if (seg > 0 && seg < 60) return "< 1 min";
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const NOMBRE_MODO = { auto: "automático", manual: "manual", apagado: "apagado" };

export const TIPO_ALERTA = {
  SOBRE_MAXIMO: "Sobre el máximo",
  BAJO_MINIMO: "Bajo el mínimo",
  RECUPERACION: "Recuperación",
  SENSOR_SIN_LECTURA: "Sensor sin lectura",
};

export const ICONO_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
