# app.py - Backend (Flask + SQLite) + interfaz web
# Recibe las lecturas del ESP32, las guarda, las evalúa según el tipo de vitrina,
# genera alertas, le responde al ESP32 si debe encender el ventilador y sirve la
# interfaz web (carpeta static/).
#
# Ejecutar:  python app.py      (queda escuchando en el puerto 5000)
# Interfaz:  http://127.0.0.1:5000/

import os
import sqlite3
from datetime import datetime

from flask import Flask, g, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "vitrina.db")

HISTERESIS = 1.0                 # °C por debajo del máximo para apagar el ventilador
MARGEN_AMARILLO = 0.5            # °C al límite para mostrar el semáforo en amarillo
TIEMPO_MAX_RECUPERACION_MIN = 15  # minutos fuera de rango antes de pedir revisión manual (por definir)
MODOS = ("auto", "manual", "apagado")
INTERVALOS_VALIDOS = (10, 30, 60)
LECTURAS_INVALIDAS = (-127.0, 85.0)   # valores que entrega el DS18B20 cuando falla o se reinicia

app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")


# ======================= Clases (POO) =======================
class Vitrina:
    """Clase base. Cada tipo de producto define su propio rango seguro (polimorfismo).
    Los umbrales guardados desde la interfaz tienen prioridad sobre el rango por defecto."""
    clave = "general"
    tipo_producto = "General"

    def __init__(self, id_vitrina, nombre, umbral_minimo=None, umbral_maximo=None,
                 modo="auto", ventilador_manual=False, intervalo_s=30, configurada=False):
        self.id_vitrina = id_vitrina
        self.nombre = nombre
        minimo, maximo = self.definir_rango_seguro()
        self.umbral_minimo = minimo if umbral_minimo is None else umbral_minimo
        self.umbral_maximo = maximo if umbral_maximo is None else umbral_maximo
        self.modo = modo
        self.ventilador_manual = ventilador_manual
        self.intervalo_s = intervalo_s
        self.configurada = configurada

    def definir_rango_seguro(self):
        return (2.0, 8.0)

    def evaluar_estado(self, temperatura):
        if temperatura > self.umbral_maximo:
            return "FUERA_RANGO_ALTO"
        if temperatura < self.umbral_minimo:
            return "FUERA_RANGO_BAJO"
        return "NORMAL"

    def decidir_ventilador(self, temperatura, ventilador_actual):
        """Histéresis: enciende sobre el máximo y apaga 1 °C por debajo de él."""
        if temperatura > self.umbral_maximo:
            return True
        if temperatura <= self.umbral_maximo - HISTERESIS:
            return False
        return ventilador_actual

    def orden_ventilador(self, temperatura, ventilador_actual):
        """Orden final para el ESP32 según el modo elegido en la interfaz."""
        if self.modo == "apagado":
            return False
        if self.modo == "manual":
            return self.ventilador_manual
        return self.decidir_ventilador(temperatura, ventilador_actual)


class VitrinaTortasCrema(Vitrina):
    clave = "tortas"
    tipo_producto = "Tortas con crema"

    def definir_rango_seguro(self):
        return (2.0, 6.0)


class VitrinaMousses(Vitrina):
    clave = "mousses"
    tipo_producto = "Mousses"

    def definir_rango_seguro(self):
        return (2.0, 5.0)


TIPOS = {"tortas": VitrinaTortasCrema, "mousses": VitrinaMousses, "general": Vitrina}


class RegistroLectura:
    def __init__(self, id_vitrina, temperatura, estado, ventilador):
        self.id_vitrina = id_vitrina
        self.temperatura = temperatura
        self.estado = estado
        self.ventilador = ventilador
        self.timestamp = ahora()

    def guardar(self, db):
        db.execute(
            "INSERT INTO lecturas (id_vitrina, temperatura, estado, ventilador, timestamp) VALUES (?,?,?,?,?)",
            (self.id_vitrina, self.temperatura, self.estado, int(self.ventilador), self.timestamp),
        )

    @staticmethod
    def mostrar_historial(db, id_vitrina, fecha, desde=None, hasta=None, despues_de=None):
        sql = ("SELECT id, timestamp, temperatura, estado, ventilador FROM lecturas "
               "WHERE id_vitrina=? AND substr(timestamp,1,10)=?")
        params = [id_vitrina, fecha]
        if desde:
            sql += " AND substr(timestamp,12,5)>=?"
            params.append(desde)
        if hasta:
            sql += " AND substr(timestamp,12,5)<=?"
            params.append(hasta)
        if despues_de is not None:
            sql += " AND id>?"
            params.append(despues_de)
        sql += " ORDER BY id"
        return [dict(f) for f in db.execute(sql, params).fetchall()]


class Alerta:
    def __init__(self, id_vitrina, tipo_alerta, nivel_urgencia, mensaje, temperatura, accion):
        self.id_vitrina = id_vitrina
        self.tipo_alerta = tipo_alerta
        self.nivel_urgencia = nivel_urgencia
        self.mensaje = mensaje
        self.temperatura = temperatura
        self.accion = accion
        self.timestamp = ahora()

    @classmethod
    def generar_alerta(cls, vitrina, estado, temperatura, ventilador_encendido):
        accion = "Ventilador encendido" if ventilador_encendido else "Aviso al personal"
        if estado == "FUERA_RANGO_ALTO":
            msg = f"Temperatura sobre el máximo ({vitrina.umbral_maximo} °C): {temperatura} °C"
            return cls(vitrina.id_vitrina, "SOBRE_MAXIMO", "ALTA", msg, temperatura, accion)
        if estado == "FUERA_RANGO_BAJO":
            msg = f"Temperatura bajo el mínimo ({vitrina.umbral_minimo} °C): {temperatura} °C"
            return cls(vitrina.id_vitrina, "BAJO_MINIMO", "MEDIA", msg, temperatura, "Aviso al personal")
        msg = f"Temperatura estabilizada: {temperatura} °C"
        accion = "Ventilador apagado" if not ventilador_encendido else "Ventilador encendido"
        return cls(vitrina.id_vitrina, "RECUPERACION", "INFO", msg, temperatura, accion)

    @classmethod
    def sensor_sin_lectura(cls, vitrina):
        return cls(vitrina.id_vitrina, "SENSOR_SIN_LECTURA", "ALTA",
                   "El sensor no entrega una lectura válida. Revisar el cable del DS18B20.",
                   None, "Aviso al personal")

    def notificar_usuario(self):
        # Además de la consola, la interfaz consulta /alertas
        print(f"[ALERTA {self.nivel_urgencia}] {self.mensaje}")

    def guardar(self, db):
        # Las alertas informativas (recuperación) no requieren que el personal las reconozca
        reconocida = 1 if self.nivel_urgencia == "INFO" else 0
        db.execute(
            "INSERT INTO alertas (id_vitrina, tipo_alerta, nivel_urgencia, mensaje, temperatura, "
            "timestamp, reconocida, accion) VALUES (?,?,?,?,?,?,?,?)",
            (self.id_vitrina, self.tipo_alerta, self.nivel_urgencia, self.mensaje, self.temperatura,
             self.timestamp, reconocida, self.accion),
        )


# ======================= Utilidades =======================
def ahora():
    return datetime.now().isoformat(timespec="seconds")


def hoy():
    return datetime.now().strftime("%Y-%m-%d")


def a_datetime(texto):
    return datetime.fromisoformat(texto) if texto else None


# ======================= Base de datos =======================
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def cerrar_db(_):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _agregar_columna(con, tabla, columna, definicion):
    columnas = [f[1] for f in con.execute(f"PRAGMA table_info({tabla})")]
    if columna not in columnas:
        con.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {definicion}")


def init_db():
    con = sqlite3.connect(DB)
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS vitrinas (
            id_vitrina INTEGER PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lecturas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, id_vitrina INTEGER NOT NULL,
            temperatura REAL NOT NULL, estado TEXT NOT NULL, ventilador INTEGER NOT NULL,
            timestamp TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS alertas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, id_vitrina INTEGER NOT NULL,
            tipo_alerta TEXT NOT NULL, nivel_urgencia TEXT NOT NULL, mensaje TEXT NOT NULL,
            temperatura REAL, timestamp TEXT NOT NULL, reconocida INTEGER NOT NULL DEFAULT 0);
        """
    )
    # Columnas nuevas (si la base de datos ya existía, se agregan sin perder datos)
    _agregar_columna(con, "vitrinas", "umbral_minimo", "REAL")
    _agregar_columna(con, "vitrinas", "umbral_maximo", "REAL")
    _agregar_columna(con, "vitrinas", "modo", "TEXT NOT NULL DEFAULT 'auto'")
    _agregar_columna(con, "vitrinas", "ventilador_manual", "INTEGER NOT NULL DEFAULT 0")
    _agregar_columna(con, "vitrinas", "intervalo_s", "INTEGER NOT NULL DEFAULT 30")
    _agregar_columna(con, "vitrinas", "configurada", "INTEGER NOT NULL DEFAULT 0")
    _agregar_columna(con, "vitrinas", "ultimo_contacto", "TEXT")
    _agregar_columna(con, "vitrinas", "error_sensor_desde", "TEXT")
    _agregar_columna(con, "alertas", "accion", "TEXT")
    con.execute("UPDATE alertas SET reconocida=1 WHERE tipo_alerta='RECUPERACION'")
    con.execute("CREATE INDEX IF NOT EXISTS idx_lecturas_vitrina_ts ON lecturas (id_vitrina, timestamp)")
    con.execute("INSERT OR IGNORE INTO vitrinas (id_vitrina, nombre, tipo) VALUES (1, 'Vitrina Tortas 1', 'tortas')")
    con.commit()
    con.close()


def cargar_vitrina(id_vitrina):
    fila = get_db().execute("SELECT * FROM vitrinas WHERE id_vitrina=?", (id_vitrina,)).fetchone()
    if fila is None:
        return None
    clase = TIPOS.get(fila["tipo"], Vitrina)
    return clase(
        fila["id_vitrina"], fila["nombre"], fila["umbral_minimo"], fila["umbral_maximo"],
        fila["modo"], bool(fila["ventilador_manual"]), fila["intervalo_s"], bool(fila["configurada"]),
    )


# ======================= Interfaz web =======================
@app.get("/")
def interfaz():
    return send_from_directory(app.static_folder, "index.html")


# ======================= Endpoints del ESP32 =======================
def _alerta_abierta(db, id_vitrina):
    """True si la última alerta de temperatura sigue abierta (no hubo recuperación)."""
    ultima = db.execute(
        "SELECT tipo_alerta FROM alertas WHERE id_vitrina=? "
        "AND tipo_alerta IN ('SOBRE_MAXIMO','BAJO_MINIMO','RECUPERACION') ORDER BY id DESC LIMIT 1",
        (id_vitrina,),
    ).fetchone()
    tipo = ultima["tipo_alerta"] if ultima else "RECUPERACION"
    return tipo, tipo in ("SOBRE_MAXIMO", "BAJO_MINIMO")


@app.post("/lecturas")
def recibir_lectura():
    datos = request.get_json(silent=True) or {}
    try:
        id_vitrina = int(datos["id_vitrina"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Se requiere id_vitrina numérico"), 400

    vitrina = cargar_vitrina(id_vitrina)
    if vitrina is None:
        return jsonify(error="Vitrina no encontrada"), 404
    db = get_db()
    ventilador_actual = bool(datos.get("ventilador", False))

    # El ESP32 avisa que el sensor falló con {"id_vitrina": 1, "error": "sensor"}
    temperatura = None
    if not datos.get("error"):
        try:
            temperatura = float(datos["temperatura"])
        except (KeyError, TypeError, ValueError):
            return jsonify(error="Se requieren id_vitrina y temperatura numéricos"), 400
        if not -55 <= temperatura <= 125:          # rango de medición del DS18B20
            return jsonify(error="Temperatura fuera del rango del sensor"), 400
        if temperatura in LECTURAS_INVALIDAS:
            temperatura = None                      # -127 / 85 °C: lectura inválida del sensor

    fila = db.execute("SELECT error_sensor_desde FROM vitrinas WHERE id_vitrina=?", (id_vitrina,)).fetchone()

    if temperatura is None:
        # Sensor desconectado o lectura inválida: se abre UNA alerta hasta que vuelva a leer bien
        if fila["error_sensor_desde"] is None:
            alerta = Alerta.sensor_sin_lectura(vitrina)
            alerta.guardar(db)
            alerta.notificar_usuario()
            db.execute("UPDATE vitrinas SET error_sensor_desde=? WHERE id_vitrina=?", (ahora(), id_vitrina))
        db.execute("UPDATE vitrinas SET ultimo_contacto=? WHERE id_vitrina=?", (ahora(), id_vitrina))
        db.commit()
        orden = {"apagado": False, "manual": vitrina.ventilador_manual}.get(vitrina.modo, ventilador_actual)
        return jsonify(estado="SENSOR_ERROR", ventilador=orden, intervalo=vitrina.intervalo_s, modo=vitrina.modo)

    estado = vitrina.evaluar_estado(temperatura)
    orden_ventilador = vitrina.orden_ventilador(temperatura, ventilador_actual)
    RegistroLectura(id_vitrina, temperatura, estado, orden_ventilador).guardar(db)
    db.execute("UPDATE vitrinas SET ultimo_contacto=?, error_sensor_desde=NULL WHERE id_vitrina=?",
               (ahora(), id_vitrina))

    # Una alerta se abre al salir del rango y se cierra (RECUPERACION) cuando la
    # temperatura baja del máximo menos la histéresis; así no se repiten alertas
    # mientras la temperatura oscila cerca del límite.
    tipo_ultima, abierta = _alerta_abierta(db, id_vitrina)

    alerta = None
    if estado == "FUERA_RANGO_ALTO" and tipo_ultima != "SOBRE_MAXIMO":
        alerta = Alerta.generar_alerta(vitrina, estado, temperatura, orden_ventilador)
    elif estado == "FUERA_RANGO_BAJO" and tipo_ultima != "BAJO_MINIMO":
        alerta = Alerta.generar_alerta(vitrina, estado, temperatura, orden_ventilador)
    elif estado == "NORMAL" and abierta and temperatura <= vitrina.umbral_maximo - HISTERESIS:
        alerta = Alerta.generar_alerta(vitrina, estado, temperatura, orden_ventilador)
    if alerta is not None:
        alerta.guardar(db)
        alerta.notificar_usuario()

    db.commit()
    return jsonify(estado=estado, ventilador=orden_ventilador, intervalo=vitrina.intervalo_s, modo=vitrina.modo)


# ======================= Endpoints de la interfaz =======================
@app.get("/lecturas")
def listar_lecturas():
    id_vitrina = request.args.get("id_vitrina", 1, type=int)
    fecha = request.args.get("fecha", hoy())
    return jsonify(RegistroLectura.mostrar_historial(
        get_db(), id_vitrina, fecha,
        desde=request.args.get("desde"), hasta=request.args.get("hasta"),
        despues_de=request.args.get("despues_de", type=int),
    ))


@app.delete("/lecturas")
def eliminar_historial():
    id_vitrina = request.args.get("id_vitrina", 1, type=int)
    db = get_db()
    cur = db.execute("DELETE FROM lecturas WHERE id_vitrina=?", (id_vitrina,))
    db.commit()
    return jsonify(ok=True, eliminadas=cur.rowcount)


@app.get("/tipos")
def listar_tipos():
    tipos = []
    for clave, clase in TIPOS.items():
        minimo, maximo = clase(0, "").definir_rango_seguro()
        tipos.append(dict(id=clave, nombre=clase.tipo_producto, minimo=minimo, maximo=maximo))
    return jsonify(tipos)


@app.get("/estado")
def estado_actual():
    id_vitrina = request.args.get("id_vitrina", 1, type=int)
    vitrina = cargar_vitrina(id_vitrina)
    if vitrina is None:
        return jsonify(error="Vitrina no encontrada"), 404
    db = get_db()
    ultima = db.execute(
        "SELECT id, timestamp, temperatura, estado, ventilador FROM lecturas WHERE id_vitrina=? ORDER BY id DESC LIMIT 1",
        (id_vitrina,),
    ).fetchone()
    fila = db.execute("SELECT ultimo_contacto, error_sensor_desde FROM vitrinas WHERE id_vitrina=?",
                      (id_vitrina,)).fetchone()
    ahora_dt = datetime.now()

    # ¿El ESP32 sigue enviando datos? (tolera 3 intervalos de lectura)
    contacto = a_datetime(fila["ultimo_contacto"])
    segundos_sin_datos = int((ahora_dt - contacto).total_seconds()) if contacto else None
    conectado = segundos_sin_datos is not None and segundos_sin_datos <= vitrina.intervalo_s * 3 + 5

    _, alerta_abierta = _alerta_abierta(db, id_vitrina)
    ultima_d = dict(ultima) if ultima else None

    # Semáforo: rojo fuera de rango (o mientras la alerta siga abierta), amarillo cerca del límite
    semaforo = None
    if ultima_d:
        t = ultima_d["temperatura"]
        if ultima_d["estado"] != "NORMAL" or alerta_abierta:
            semaforo = "rojo"
        elif t >= vitrina.umbral_maximo - MARGEN_AMARILLO or t <= vitrina.umbral_minimo + MARGEN_AMARILLO:
            semaforo = "amarillo"
        else:
            semaforo = "verde"

    # Desde cuándo está fuera de rango (racha continua de lecturas no normales)
    fuera_desde = None
    minutos_fuera = 0
    if ultima_d and ultima_d["estado"] != "NORMAL":
        ult_normal = db.execute(
            "SELECT COALESCE(MAX(id),0) FROM lecturas WHERE id_vitrina=? AND estado='NORMAL'", (id_vitrina,)
        ).fetchone()[0]
        primera = db.execute(
            "SELECT timestamp FROM lecturas WHERE id_vitrina=? AND id>? ORDER BY id LIMIT 1",
            (id_vitrina, ult_normal),
        ).fetchone()
        if primera:
            fuera_desde = primera["timestamp"]
            minutos_fuera = int((ahora_dt - a_datetime(fuera_desde)).total_seconds() // 60)

    # Orden pendiente: el ESP32 aún no recibió la orden que corresponde al modo actual
    orden_pendiente = False
    if ultima_d and conectado:
        if vitrina.modo == "apagado":
            orden_pendiente = bool(ultima_d["ventilador"])
        elif vitrina.modo == "manual":
            orden_pendiente = bool(ultima_d["ventilador"]) != vitrina.ventilador_manual

    return jsonify(
        id_vitrina=vitrina.id_vitrina,
        vitrina=vitrina.nombre, nombre=vitrina.nombre,
        tipo=vitrina.clave, tipo_producto=vitrina.tipo_producto,
        umbral_minimo=vitrina.umbral_minimo, umbral_maximo=vitrina.umbral_maximo,
        modo=vitrina.modo, ventilador_manual=vitrina.ventilador_manual,
        intervalo_s=vitrina.intervalo_s, configurada=vitrina.configurada,
        ultima_lectura=ultima_d,
        conectado=conectado, segundos_sin_datos=segundos_sin_datos,
        ultimo_contacto=fila["ultimo_contacto"],
        sensor_error=fila["error_sensor_desde"] is not None and conectado,
        semaforo=semaforo, alerta_abierta=alerta_abierta,
        fuera_desde=fuera_desde, minutos_fuera=minutos_fuera,
        requiere_revision=minutos_fuera >= TIEMPO_MAX_RECUPERACION_MIN,
        tiempo_revision_min=TIEMPO_MAX_RECUPERACION_MIN,
        orden_pendiente=orden_pendiente,
        fecha_hoy=hoy(), hora_servidor=ahora_dt.strftime("%H:%M:%S"),
    )


def _validar_configuracion(datos):
    """Devuelve (valores, errores). Las reglas son las mismas del formulario (Parte 2, sección 3.3)."""
    errores = {}
    nombre = str(datos.get("nombre", "")).strip()
    if not nombre:
        errores["nombre"] = "Ingresa un nombre para la vitrina."
    elif len(nombre) > 30:
        errores["nombre"] = "El nombre puede tener máximo 30 caracteres."

    tipo = datos.get("tipo")
    if tipo not in TIPOS:
        errores["tipo"] = "Selecciona un tipo de producto."

    def numero(campo):
        try:
            return float(str(datos.get(campo)).replace(",", "."))
        except (TypeError, ValueError):
            errores[campo] = "Ingresa solo números."
            return None

    minimo, maximo = numero("umbral_minimo"), numero("umbral_maximo")
    if minimo is not None and not 0 <= minimo <= 10:
        errores["umbral_minimo"] = "El valor debe estar entre 0 y 10 °C (mínimo)."
    if maximo is not None and not 2 <= maximo <= 12:
        errores["umbral_maximo"] = "El valor debe estar entre 2 y 12 °C (máximo)."
    if minimo is not None and maximo is not None and "umbral_minimo" not in errores and minimo >= maximo:
        errores["umbral_minimo"] = "El mínimo debe ser menor que el máximo."

    modo = datos.get("modo")
    if modo not in MODOS:
        errores["modo"] = "Elige un modo de ventilador válido."
    try:
        intervalo = int(datos.get("intervalo_s"))
    except (TypeError, ValueError):
        intervalo = None
    if intervalo not in INTERVALOS_VALIDOS:
        errores["intervalo_s"] = "Elige 10 s, 30 s o 1 min."

    return dict(nombre=nombre, tipo=tipo, umbral_minimo=minimo, umbral_maximo=maximo,
                modo=modo, intervalo_s=intervalo), errores


@app.put("/vitrina")
def guardar_configuracion():
    datos = request.get_json(silent=True) or {}
    id_vitrina = int(datos.get("id_vitrina", 1))
    if cargar_vitrina(id_vitrina) is None:
        return jsonify(error="Vitrina no encontrada"), 404
    valores, errores = _validar_configuracion(datos)
    if errores:
        return jsonify(error="Datos de configuración inválidos", errores=errores), 400
    db = get_db()
    db.execute(
        "UPDATE vitrinas SET nombre=?, tipo=?, umbral_minimo=?, umbral_maximo=?, modo=?, intervalo_s=?, "
        "configurada=1 WHERE id_vitrina=?",
        (valores["nombre"], valores["tipo"], valores["umbral_minimo"], valores["umbral_maximo"],
         valores["modo"], valores["intervalo_s"], id_vitrina),
    )
    db.commit()
    return jsonify(ok=True)


@app.post("/ventilador")
def ordenar_ventilador():
    """Cambia el modo (auto/manual/apagado) y/o enciende o apaga el ventilador en modo manual.
    El ESP32 recibe la orden en su próxima lectura (campo 'ventilador' de la respuesta)."""
    datos = request.get_json(silent=True) or {}
    id_vitrina = int(datos.get("id_vitrina", 1))
    vitrina = cargar_vitrina(id_vitrina)
    if vitrina is None:
        return jsonify(error="Vitrina no encontrada"), 404
    modo = datos.get("modo", vitrina.modo)
    if modo not in MODOS:
        return jsonify(error="Modo inválido"), 400
    manual = vitrina.ventilador_manual
    if "encendido" in datos:
        if modo != "manual":
            return jsonify(error="El control manual solo está disponible en modo Manual"), 409
        manual = bool(datos["encendido"])
    if modo != "manual":
        manual = False          # al salir de Manual se descarta la orden manual anterior
    db = get_db()
    db.execute("UPDATE vitrinas SET modo=?, ventilador_manual=? WHERE id_vitrina=?",
               (modo, int(manual), id_vitrina))
    db.commit()
    return jsonify(ok=True, modo=modo, ventilador_manual=manual)


def _fila_alerta(f):
    d = dict(f)
    if not d.get("accion"):       # alertas guardadas antes de existir la columna 'accion'
        d["accion"] = {"SOBRE_MAXIMO": "Ventilador encendido", "RECUPERACION": "Ventilador apagado"}.get(
            d["tipo_alerta"], "Aviso al personal")
    return d


@app.get("/alertas")
def listar_alertas():
    id_vitrina = request.args.get("id_vitrina", 1, type=int)
    filtro = request.args.get("estado", "todas")
    limite = min(request.args.get("limite", 50, type=int), 200)
    sql = "SELECT * FROM alertas WHERE id_vitrina=?"
    if filtro == "pendientes":
        sql += " AND reconocida=0"
    elif filtro == "reconocidas":
        sql += " AND reconocida=1"
    sql += " ORDER BY id DESC LIMIT ?"
    filas = get_db().execute(sql, (id_vitrina, limite)).fetchall()
    return jsonify([_fila_alerta(f) for f in filas])


@app.get("/alertas/resumen")
def resumen_alertas():
    id_vitrina = request.args.get("id_vitrina", 1, type=int)
    db = get_db()
    fecha = hoy()
    # Las recuperaciones son informativas: no cuentan como alertas del día
    hoy_n = db.execute(
        "SELECT COUNT(*) FROM alertas WHERE id_vitrina=? AND substr(timestamp,1,10)=? AND nivel_urgencia!='INFO'",
        (id_vitrina, fecha)).fetchone()[0]
    pendientes = db.execute(
        "SELECT COUNT(*) FROM alertas WHERE id_vitrina=? AND reconocida=0", (id_vitrina,)).fetchone()[0]

    # Tiempo fuera de rango hoy: suma de los intervalos entre lecturas no normales.
    # Un hueco mayor a 3 intervalos (ESP32 sin conexión) no se cuenta como tiempo fuera de rango.
    vitrina = cargar_vitrina(id_vitrina)
    tope = (vitrina.intervalo_s if vitrina else 30) * 3
    lecturas = db.execute(
        "SELECT timestamp, estado FROM lecturas WHERE id_vitrina=? AND substr(timestamp,1,10)=? ORDER BY id",
        (id_vitrina, fecha)).fetchall()
    segundos = 0.0
    ahora_dt = datetime.now()
    for i, f in enumerate(lecturas):
        if f["estado"] == "NORMAL":
            continue
        inicio = a_datetime(f["timestamp"])
        fin = a_datetime(lecturas[i + 1]["timestamp"]) if i + 1 < len(lecturas) else ahora_dt
        segundos += min((fin - inicio).total_seconds(), tope)
    return jsonify(alertas_hoy=hoy_n, pendientes=pendientes, segundos_fuera_rango=int(segundos))


@app.post("/alertas/<int:id_alerta>/reconocer")
def reconocer_alerta(id_alerta):
    db = get_db()
    cur = db.execute("UPDATE alertas SET reconocida=1 WHERE id=?", (id_alerta,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Alerta no encontrada"), 404
    return jsonify(ok=True)


init_db()

if __name__ == "__main__":
    # host 0.0.0.0 permite que el ESP32 (en la misma red WiFi) llegue al servidor
    app.run(host="0.0.0.0", port=5000, debug=False)
