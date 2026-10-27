// graficas.js - Gráfica de temperatura con Chart.js (líneas de mínimo y máximo, marcadores y etiquetas)
import { fmtTemp, fmtUmbral, fmtHoraSeg } from "./util.js";

const COLOR_LINEA = "#14283d";
const COLOR_MAX = "#d64545";
const COLOR_MIN = "#2f7fc1";
const COLOR_AZUL = "#1f6fb2";

/** Dibuja las etiquetas "máx X °C" / "mín X °C" y los marcadores (puntos con texto). */
const plugin = {
  id: "anotaciones",
  afterDatasetsDraw(chart, _args, opciones) {
    const { ctx, chartArea, scales } = chart;
    if (!opciones || !scales.x || !scales.y) return;
    ctx.save();
    ctx.font = '500 12px "Inter", "Segoe UI", sans-serif';

    if (opciones.umbralMax !== undefined) {
      // Etiquetas con un fondo del color de la tarjeta para que no se mezclen con la línea de datos
      const etiqueta = (texto, color, y) => {
        const x = chartArea.left + 6, ancho = ctx.measureText(texto).width;
        ctx.fillStyle = "rgba(255,255,255,.88)";
        ctx.fillRect(x - 2, y - 12, ancho + 6, 16);
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.fillText(texto, x, y);
      };
      etiqueta(`máx ${fmtUmbral(opciones.umbralMax)} °C`, "#bf3030", scales.y.getPixelForValue(opciones.umbralMax) - 7);
      etiqueta(`mín ${fmtUmbral(opciones.umbralMin)} °C`, "#1f6fb2", scales.y.getPixelForValue(opciones.umbralMin) + 17);
    }

    (opciones.marcadores || []).forEach((m) => {
      const px = scales.x.getPixelForValue(m.x), py = scales.y.getPixelForValue(m.y);
      if (px < chartArea.left - 1 || px > chartArea.right + 1) return;
      ctx.beginPath();
      ctx.arc(px, py, m.radio || 6, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      if (m.texto) {
        ctx.font = '700 12.5px "Inter", "Segoe UI", sans-serif';
        ctx.fillStyle = m.color;
        ctx.textAlign = "left";
        const ancho = ctx.measureText(m.texto).width;
        const alinear = m.alinear || "right";
        let izq = alinear === "right" ? px - 12 - ancho : alinear === "left" ? px + 12 : px - ancho / 2;
        izq = Math.max(chartArea.left + 4, Math.min(izq, chart.width - ancho - 6));   // el texto nunca se sale de la gráfica
        ctx.fillText(m.texto, izq, py - 16);
      }
    });
    ctx.restore();
  },
};

/** Paso de las marcas del eje X según la duración que se muestra. */
function pasoEjeX(duracion) {
  if (duracion <= 3600) return 120;
  const pasos = [300, 600, 900, 1800, 3600, 7200, 10800, 21600];
  return pasos.find((p) => duracion / p <= 7) || 21600;
}

export const COLORES_MARCADOR = { ventilador: COLOR_AZUL, fuera: COLOR_MAX };

export class GraficaTemperatura {
  constructor(canvas) {
    this.canvas = canvas;
    this.chart = null;
  }

  /**
   * lecturas: [{x (segundos del día), temperatura}]
   * opciones: {umbralMin, umbralMax, marcadores, huecoS, xMin, xMax}
   */
  actualizar(lecturas, opciones) {
    const { umbralMin, umbralMax, marcadores = [], huecoS = 90 } = opciones;
    const datos = [];
    lecturas.forEach((l, i) => {
      // Un hueco largo (ESP32 sin conexión) corta la línea en vez de unir puntos lejanos
      if (i > 0 && l.x - lecturas[i - 1].x > huecoS) datos.push({ x: lecturas[i - 1].x + 1, y: null });
      datos.push({ x: l.x, y: l.temperatura, ts: l.timestamp });
    });

    const primero = lecturas.length ? lecturas[0].x : 0;
    const ultimo = lecturas.length ? lecturas[lecturas.length - 1].x : 3600;
    const xMin = opciones.xMin ?? Math.floor(primero / 3600) * 3600;
    const xMax = opciones.xMax ?? Math.max(ultimo, xMin + 1800);
    const paso = pasoEjeX(xMax - xMin);

    const dsLinea = {
      data: datos, borderColor: COLOR_LINEA, borderWidth: 2.5, tension: 0.25, spanGaps: false,
      pointRadius: lecturas.length === 1 ? 4 : 0, pointHoverRadius: 5, pointBackgroundColor: COLOR_LINEA, order: 1,
    };
    const dsMax = { data: [{ x: xMin, y: umbralMax }, { x: xMax, y: umbralMax }], borderColor: COLOR_MAX, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, order: 2 };
    const dsMin = { data: [{ x: xMin, y: umbralMin }, { x: xMax, y: umbralMin }], borderColor: COLOR_MIN, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, order: 3 };

    if (!this.chart) {
      this.chart = new Chart(this.canvas, {
        type: "line",
        data: { datasets: [dsLinea, dsMax, dsMin] },
        plugins: [plugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          parsing: false,
          normalized: true,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          layout: { padding: { top: 26, right: 14 } },
          scales: {
            x: {
              type: "linear",
              grid: { display: false },
              border: { color: "#b9c4d0" },
              ticks: { color: "#5b6b7e", maxRotation: 0, autoSkip: false, callback: (v) => fmtHoraSeg(v) },
            },
            y: {
              min: 0, suggestedMax: 8,  
              grid: { color: "#e8edf2" },
              border: { display: false },
              ticks: { color: "#5b6b7e", stepSize: 2, callback: (v) => v },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (item) => item.datasetIndex === 0,
              displayColors: false,
              callbacks: {
                title: (items) => (items[0].raw.ts ? items[0].raw.ts.slice(11, 19) : fmtHoraSeg(items[0].parsed.x, true)),
                label: (item) => `${fmtTemp(item.parsed.y)} °C`,
              },
            },
            anotaciones: {},
          },
        },
      });
    }

    const c = this.chart;
    c.data.datasets[0].data = dsLinea.data;
    c.data.datasets[0].pointRadius = dsLinea.pointRadius;
    c.data.datasets[1].data = dsMax.data;
    c.data.datasets[2].data = dsMin.data;
    c.options.scales.x.min = xMin;
    c.options.scales.x.max = xMax;
    c.options.scales.x.afterBuildTicks = (escala) => {
      const marcas = [];
      for (let v = Math.ceil(xMin / paso) * paso; v <= xMax; v += paso) marcas.push({ value: v });
      escala.ticks = marcas;
    };
    c.options.plugins.anotaciones = { umbralMin, umbralMax, marcadores };
    c.update();
  }

  destruir() {
    if (this.chart) this.chart.destroy();
    this.chart = null;
  }
}
