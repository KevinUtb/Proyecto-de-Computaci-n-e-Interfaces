# Monitor de Vitrina — Computación e Interfaces (UTB)

Sistema de monitoreo y control de temperatura de vitrinas: ESP32 + DS18B20 → backend Flask/SQLite → interfaz web.

## Estructura
```
backend/app.py          Backend (API + sirve la interfaz). Antes: "Firmaware del ESP32 micropython.py"
backend/static/         Interfaz web (index.html, css/, js/, vendor/chart.umd.js, fonts/) — funciona sin internet
backend/sembrar_demo.py Carga un día de lecturas de ejemplo (para probar o presentar)
firmware/main.py        Firmware del ESP32 (MicroPython)
simulador.py            "ESP32 falso" para probar sin hardware
```

## Cómo ejecutarlo
```
pip install -r backend/requirements.txt
cd backend
python app.py                      # abre http://127.0.0.1:5000/
python ../simulador.py 1           # (otra terminal) lecturas simuladas cada 1 s
python sembrar_demo.py             # opcional: historial de ejemplo (BORRA lecturas y alertas actuales)
```
Para el ESP32 real: en `firmware/main.py` configura `WIFI_SSID`, `WIFI_CLAVE` y `URL_BACKEND` (IP del computador).
La interfaz también se abre desde otro equipo de la red: `http://IP_DEL_PC:5000/`.

## API (las rutas del primer avance se mantienen)
| Método y ruta | Uso |
|---|---|
| POST /lecturas | ESP32 envía `{id_vitrina, temperatura, ventilador}` o `{id_vitrina, error:"sensor"}`; responde `{estado, ventilador, intervalo, modo}` |
| GET /lecturas?fecha&desde&hasta&despues_de | Historial por fecha y hora |
| DELETE /lecturas | Eliminar historial |
| GET /estado | Estado completo: lectura, semáforo, conexión, configuración |
| PUT /vitrina | Guardar configuración (valida igual que el formulario) |
| POST /ventilador | `{modo}` y/o `{encendido}` (solo en modo manual) |
| GET /tipos | Tipos de producto y rango sugerido |
| GET /alertas?estado=todas/pendientes/reconocidas | Lista de alertas |
| GET /alertas/resumen | Alertas hoy, pendientes, tiempo fuera de rango |
| POST /alertas/<id>/reconocer | Reconocer alerta |

## Decisiones por confirmar con el equipo
- Tiempo máximo antes de pedir revisión manual: `TIEMPO_MAX_RECUPERACION_MIN = 15` en `app.py` (el documento lo deja "por definir").
- "Cerca del límite" (amarillo): a menos de `MARGEN_AMARILLO = 0.5` °C del mínimo o máximo.
- Eliminar historial borra las lecturas, no las alertas.
- Lecturas de -127 °C o 85 °C (valores de falla del DS18B20) se tratan como sensor desconectado.
- Un mínimo/máximo válido es 0–10 / 2–12 °C; máximos > 8 °C piden confirmación.
