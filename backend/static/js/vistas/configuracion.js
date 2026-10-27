// configuracion.js - Formulario para definir la vitrina, el rango seguro y el modo del ventilador
import { api, ErrorApi, ID_VITRINA } from "../api.js";
import { aviso, confirmar, spinnerBoton } from "../ui.js";
import { esc, fmtUmbral } from "../util.js";

const MAXIMO_ALTO = 8;   // sobre este valor se pide confirmación antes de guardar

export class VistaConfiguracion {
  constructor(monitor) {
    this.monitor = monitor;
    this.tipos = [];
    this.tocados = new Set();
    this.guardando = false;
  }

  async montar(raiz) {
    this.raiz = raiz;
    raiz.innerHTML = `<div class="contenido"><div class="tarjeta"><div class="esqueleto linea"></div><div class="esqueleto valor"></div></div></div>`;
    try {
      const [estado, tipos] = await Promise.all([api.get(`/estado?id_vitrina=${ID_VITRINA}`), api.get("/tipos")]);
      this.tipos = tipos;
      this.guardado = this.valoresDe(estado);
      this.construir();
      this.cargarValores(this.guardado);
    } catch (e) {
      raiz.innerHTML = `<div class="contenido"><div class="banner" role="alert"><div><span>No se pudo cargar la configuración</span>
        <span class="detalle">Revisa la conexión con el servidor e intenta de nuevo.</span></div></div></div>`;
    }
  }

  destruir() {}

  valoresDe(e) {
    return { nombre: e.configurada ? e.nombre : "", tipo: e.tipo, umbral_minimo: fmtNum(e.umbral_minimo), umbral_maximo: fmtNum(e.umbral_maximo), modo: e.modo, intervalo_s: String(e.intervalo_s) };
  }

  construir() {
    const opcionesTipo = this.tipos.map((t) => `<option value="${esc(t.id)}">${esc(t.nombre)}</option>`).join("");
    this.raiz.innerHTML = `
      <div class="contenido contenido-config">
        <section class="tarjeta" aria-labelledby="t-config">
          <h2 id="t-config" style="font-size:19px;margin-bottom:20px">Configuración de la vitrina</h2>
          <div class="formulario" id="c-form" role="group" aria-labelledby="t-config">
            <div class="campo" data-campo="nombre">
              <label for="c-nombre">Nombre de la vitrina</label>
              <input type="text" id="c-nombre" maxlength="30" autocomplete="off" aria-describedby="e-nombre">
              <div class="error-campo" id="e-nombre"></div>
            </div>
            <div class="campo" data-campo="umbral_minimo">
              <label for="c-min">Umbral mínimo (°C)</label>
              <input type="text" id="c-min" inputmode="decimal" autocomplete="off" aria-describedby="e-min">
              <div class="error-campo" id="e-min"></div>
            </div>
            <div class="campo" data-campo="tipo">
              <label for="c-tipo">Tipo de producto</label>
              <select id="c-tipo" aria-describedby="e-tipo"><option value="" disabled>Selecciona un tipo</option>${opcionesTipo}</select>
              <div class="error-campo" id="e-tipo"></div>
            </div>
            <div class="campo" data-campo="umbral_maximo">
              <label for="c-max">Umbral máximo (°C)</label>
              <input type="text" id="c-max" inputmode="decimal" autocomplete="off" aria-describedby="e-max">
              <div class="error-campo" id="e-max"></div>
            </div>
            <div class="campo" data-campo="intervalo_s">
              <label for="c-intervalo">Intervalo de lectura</label>
              <select id="c-intervalo">
                <option value="10">10 segundos</option><option value="30">30 segundos</option><option value="60">1 minuto</option>
              </select>
            </div>
            <div class="campo" data-campo="modo">
              <span class="rotulo" id="r-modo">Modo del ventilador</span>
              <div class="opciones horizontal" role="radiogroup" aria-labelledby="r-modo">
                <label class="opcion"><input type="radio" name="c-modo" value="auto"> Auto</label>
                <label class="opcion"><input type="radio" name="c-modo" value="manual"> Manual</label>
                <label class="opcion"><input type="radio" name="c-modo" value="apagado"> Apagado</label>
              </div>
            </div>
            <div class="aviso-guardar" id="c-error-guardar" role="alert" hidden>
              <span>No se pudo guardar. Intenta de nuevo.</span>
              <button type="button" class="boton peligro-borde" id="c-reintentar">Reintentar</button>
            </div>
            <div class="acciones">
              <button type="button" class="boton primario" id="c-guardar">Guardar configuración</button>
              <button type="button" class="boton secundario" id="c-restablecer">Restablecer valores</button>
            </div>
          </div>
        </section>
        <aside class="tarjeta ayuda" aria-labelledby="t-ayuda">
          <h2 id="t-ayuda">Ayuda</h2>
          <p id="c-ayuda-rango"></p>
          <p>El ventilador se enciende al superar el máximo y se apaga cuando la temperatura baja 1 °C por debajo de él.</p>
          <p>El botón Guardar se activa solo cuando todos los campos son válidos.</p>
        </aside>
      </div>`;

    const q = (s) => this.raiz.querySelector(s);
    this.campos = {
      nombre: q("#c-nombre"), tipo: q("#c-tipo"), umbral_minimo: q("#c-min"), umbral_maximo: q("#c-max"), intervalo_s: q("#c-intervalo"),
    };
    this.errores = { nombre: q("#e-nombre"), tipo: q("#e-tipo"), umbral_minimo: q("#e-min"), umbral_maximo: q("#e-max") };
    this.btnGuardar = q("#c-guardar");
    this.avisoError = q("#c-error-guardar");

    // Validación en el momento: al salir del campo se marca; mientras se escribe se actualiza el botón
    Object.entries(this.campos).forEach(([nombre, el]) => {
      el.addEventListener("blur", () => { this.tocados.add(nombre); this.refrescar(); });
      el.addEventListener("input", () => this.refrescar());
      el.addEventListener("change", () => { this.tocados.add(nombre); this.refrescar(); });
    });
    this.campos.tipo.addEventListener("change", () => this.sugerirRango());
    this.raiz.querySelectorAll('input[name="c-modo"]').forEach((r) => r.addEventListener("change", () => this.refrescar()));
    this.btnGuardar.addEventListener("click", () => this.guardar());
    q("#c-reintentar").addEventListener("click", () => this.guardar());
    q("#c-restablecer").addEventListener("click", () => { this.cargarValores(this.guardado); });
  }

  cargarValores(v) {
    this.campos.nombre.value = v.nombre;
    this.campos.tipo.value = this.tipos.some((t) => t.id === v.tipo) ? v.tipo : "";
    this.campos.umbral_minimo.value = v.umbral_minimo;
    this.campos.umbral_maximo.value = v.umbral_maximo;
    this.campos.intervalo_s.value = v.intervalo_s;
    this.raiz.querySelectorAll('input[name="c-modo"]').forEach((r) => { r.checked = r.value === v.modo; });
    this.tocados.clear();
    this.avisoError.hidden = true;
    this.refrescar();
  }

  leer() {
    const modo = this.raiz.querySelector('input[name="c-modo"]:checked');
    return {
      id_vitrina: ID_VITRINA,
      nombre: this.campos.nombre.value.trim(),
      tipo: this.campos.tipo.value,
      umbral_minimo: this.campos.umbral_minimo.value.trim(),
      umbral_maximo: this.campos.umbral_maximo.value.trim(),
      modo: modo ? modo.value : "",
      intervalo_s: Number(this.campos.intervalo_s.value),
    };
  }

  /** Al elegir el tipo de producto se sugiere su rango seguro. */
  sugerirRango() {
    const t = this.tipos.find((x) => x.id === this.campos.tipo.value);
    if (!t) return;
    this.campos.umbral_minimo.value = fmtNum(t.minimo);
    this.campos.umbral_maximo.value = fmtNum(t.maximo);
    this.tocados.add("umbral_minimo");
    this.tocados.add("umbral_maximo");
    this.refrescar();
  }

  /** Reglas de la sección 3.3 del documento de diseño. Devuelve {campo: mensaje}. */
  validar(v) {
    const err = {};
    if (!v.nombre) err.nombre = "Ingresa un nombre para la vitrina.";
    if (!v.tipo) err.tipo = "Selecciona un tipo de producto.";

    const num = (txt) => (txt === "" || !/^-?\d+([.,]\d+)?$/.test(txt) ? NaN : Number(txt.replace(",", ".")));
    const min = num(v.umbral_minimo), max = num(v.umbral_maximo);
    if (Number.isNaN(min)) err.umbral_minimo = "Ingresa solo números.";
    else if (min < 0 || min > 10) err.umbral_minimo = "El valor debe estar entre 0 y 10 °C.";
    if (Number.isNaN(max)) err.umbral_maximo = "Ingresa solo números.";
    else if (max < 2 || max > 12) err.umbral_maximo = "El valor debe estar entre 2 y 12 °C.";
    if (!err.umbral_minimo && !err.umbral_maximo && min >= max) err.umbral_minimo = "El mínimo debe ser menor que el máximo.";
    return { err, min, max };
  }

  refrescar() {
    const v = this.leer();
    const { err, max } = this.validar(v);
    Object.keys(this.errores).forEach((c) => {
      // el error cruzado (mínimo >= máximo) se muestra si se tocó cualquiera de los dos umbrales
      const tocado = this.tocados.has(c) || (c === "umbral_minimo" && this.tocados.has("umbral_maximo"));
      const msg = tocado ? err[c] || "" : "";
      this.errores[c].textContent = msg;
      this.campos[c].closest(".campo").classList.toggle("invalido", Boolean(msg));
      this.campos[c].setAttribute("aria-invalid", msg ? "true" : "false");
    });
    this.btnGuardar.disabled = this.guardando || Object.keys(err).length > 0;

    const t = this.tipos.find((x) => x.id === v.tipo);
    this.raiz.querySelector("#c-ayuda-rango").textContent = t
      ? `Rango sugerido para ${t.nombre.toLowerCase()}: ${fmtUmbral(t.minimo)} – ${fmtUmbral(t.maximo)} °C.`
      : "Elige el tipo de producto para ver el rango seguro sugerido.";
    return { err, max };
  }

  async guardar() {
    if (this.guardando) return;
    Object.keys(this.campos).forEach((c) => this.tocados.add(c));
    const { err, max } = this.refrescar();
    if (Object.keys(err).length) return;

    // Un máximo muy alto puede poner en riesgo el producto: se pide confirmación
    if (max > MAXIMO_ALTO) {
      const sigue = await confirmar({
        titulo: "Máximo muy alto",
        texto: "Un máximo tan alto puede poner en riesgo el producto. ¿Deseas continuar?",
        aceptar: "Continuar", peligro: false,
      });
      if (!sigue) return;
    }

    this.guardando = true;
    this.avisoError.hidden = true;
    this.btnGuardar.disabled = true;
    this.btnGuardar.classList.add("cargando");
    this.btnGuardar.innerHTML = `${spinnerBoton} Guardando...`;
    try {
      await api.put("/vitrina", this.leer());
      aviso({ titulo: "Configuración guardada con éxito", texto: "Los cambios ya están en uso." });
      await this.monitor.actualizar();
      location.hash = "#/dashboard";
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 400 && e.datos && e.datos.errores) {
        // El servidor rechazó algún campo: se marca igual que la validación local
        Object.keys(e.datos.errores).forEach((c) => this.tocados.add(c));
        Object.entries(e.datos.errores).forEach(([c, msg]) => { if (this.errores[c]) this.errores[c].textContent = msg; });
      }
      this.avisoError.hidden = false;      // los datos del formulario se conservan
    } finally {
      this.guardando = false;
      this.btnGuardar.classList.remove("cargando");
      this.btnGuardar.textContent = "Guardar configuración";
      this.refrescar();
    }
  }
}

/** 6 -> "6", 2.5 -> "2,5" (como se escribe en Colombia) */
function fmtNum(n) {
  return String(n).replace(".", ",");
}
