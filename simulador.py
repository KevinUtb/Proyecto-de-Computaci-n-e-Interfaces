# simulador.py - Hace de "ESP32 falso" para probar el backend sin hardware.
# Primero iniciar el backend (python app.py) y luego:  python simulador.py
# La temperatura sube sola; cuando el backend ordena encender el ventilador, baja.

import random
import sys
import time

import requests

URL = "http://127.0.0.1:5000/lecturas"
INTERVALO_S = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0

temperatura = 4.0
ventilador = False

for i in range(120):
    # Sin ventilador la temperatura sube (falla simulada); con ventilador baja
    temperatura += random.uniform(-0.1, 0.1) + (-0.35 if ventilador else 0.25)
    temperatura = round(temperatura, 2)
    try:
        r = requests.post(URL, json={"id_vitrina": 1, "temperatura": temperatura, "ventilador": ventilador}, timeout=5)
        resp = r.json()
        ventilador = bool(resp.get("ventilador", False))
        print(f"{i:02d} | T={temperatura:5.2f} °C | estado={resp.get('estado')} | ventilador={ventilador}")
    except requests.RequestException as e:
        print("No se pudo conectar con el backend:", e)
    time.sleep(INTERVALO_S)