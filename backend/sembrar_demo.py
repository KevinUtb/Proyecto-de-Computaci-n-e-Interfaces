# sembrar_demo.py - Llena la base de datos con un día de lecturas de ejemplo para probar o presentar la interfaz.
#
#   python sembrar_demo.py            -> últimas 7 horas, con una falla ya resuelta y otra en curso
#   python sembrar_demo.py --horas 3  -> cambia cuántas horas hacia atrás se generan
#
# ATENCIÓN: borra las lecturas y alertas actuales de la vitrina 1 y deja la vitrina como "configurada".
# Las lecturas terminan en el momento actual, así que el ESP32 aparece como conectado unos segundos;
# para ver el dashboard "vivo" ejecuta después simulador.py.

import argparse
import math
import random
import sqlite3
from datetime import datetime, timedelta

import app as backend

INTERVALO_S = 30


def sembrar(horas):
    backend.init_db()
    con = sqlite3.connect(backend.DB)
    con.execute("DELETE FROM lecturas WHERE id_vitrina=1")
    con.execute("DELETE FROM alertas WHERE id_vitrina=1")
    vitrina = backend.VitrinaTortasCrema(1, "Vitrina Tortas 1", 2.0, 6.0, "auto", False, INTERVALO_S, True)
    pasos = int(horas * 3600 / INTERVALO_S)
    fin = datetime.now().replace(microsecond=0)
    inicio = fin - timedelta(seconds=pasos * INTERVALO_S)
    random.seed(7)

    temperatura, ventilador, tipo_ultima = 4.0, False, "RECUPERACION"
    pendiente_idx = None
    for i in range(pasos):
        ts = inicio + timedelta(seconds=i * INTERVALO_S)
        f = i / pasos
        # Falla 1 (se resuelve con el ventilador) y falla 2 (sigue en curso al final)
        tendencia = 0.16 if 0.50 < f < 0.56 else 0.10 if f > 0.92 else 0.0
        temperatura += random.uniform(-0.05, 0.05) + tendencia + (4.0 - temperatura) * 0.015
        if ventilador:
            temperatura -= 0.12 if f < 0.9 else 0.015
        temperatura = round(temperatura, 2)

        if 0.12 < f < 0.125:      # el sensor no entrega lectura durante unos 2 minutos
            if f < 0.1206:
                con.execute("INSERT INTO alertas (id_vitrina,tipo_alerta,nivel_urgencia,mensaje,temperatura,timestamp,reconocida,accion) "
                            "VALUES (1,'SENSOR_SIN_LECTURA','ALTA','El sensor no entrega una lectura válida. Revisar el cable del DS18B20.',NULL,?,1,'Aviso al personal')",
                            (ts.isoformat(timespec="seconds"),))
            continue

        estado = vitrina.evaluar_estado(temperatura)
        ventilador = vitrina.orden_ventilador(temperatura, ventilador)
        con.execute("INSERT INTO lecturas (id_vitrina,temperatura,estado,ventilador,timestamp) VALUES (1,?,?,?,?)",
                    (temperatura, estado, int(ventilador), ts.isoformat(timespec="seconds")))

        alerta = None
        if estado == "FUERA_RANGO_ALTO" and tipo_ultima != "SOBRE_MAXIMO":
            alerta = backend.Alerta.generar_alerta(vitrina, estado, temperatura, ventilador)
        elif estado == "NORMAL" and tipo_ultima == "SOBRE_MAXIMO" and temperatura <= vitrina.umbral_maximo - backend.HISTERESIS:
            alerta = backend.Alerta.generar_alerta(vitrina, estado, temperatura, ventilador)
        if alerta:
            alerta.timestamp = ts.isoformat(timespec="seconds")
            alerta.guardar(con)       # guardar() sólo usa execute(), igual que con la conexión de Flask
            tipo_ultima = alerta.tipo_alerta

    # Las alertas viejas ya fueron reconocidas; la última (si sigue abierta) queda pendiente
    con.execute("UPDATE alertas SET reconocida=1 WHERE tipo_alerta!='SOBRE_MAXIMO' OR id < (SELECT MAX(id) FROM alertas WHERE tipo_alerta='SOBRE_MAXIMO')")
    con.execute("UPDATE vitrinas SET nombre='Vitrina Tortas 1', tipo='tortas', umbral_minimo=2.0, umbral_maximo=6.0, modo='auto', "
                "ventilador_manual=0, intervalo_s=?, configurada=1, ultimo_contacto=?, error_sensor_desde=NULL WHERE id_vitrina=1",
                (INTERVALO_S, fin.isoformat(timespec="seconds")))
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM lecturas").fetchone()[0]
    a = con.execute("SELECT COUNT(*) FROM alertas").fetchone()[0]
    con.close()
    print(f"Listo: {n} lecturas y {a} alertas de ejemplo. Última temperatura: {temperatura} °C")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--horas", type=float, default=7)
    sembrar(p.parse_args().horas)
