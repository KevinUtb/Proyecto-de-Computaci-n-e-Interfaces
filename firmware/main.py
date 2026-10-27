# main.py - Firmware del ESP32 (MicroPython)
# Lee el sensor DS18B20, envía cada lectura al backend por WiFi (HTTP) y
# controla el ventilador con un módulo relé.
#
# Conexiones (ajustar según su montaje):
#   DS18B20: DATA -> GPIO 4, con resistencia de 4.7 kOhm entre DATA y 3.3 V; VCC -> 3.3 V; GND -> GND
#   Relé:    IN   -> GPIO 26; VCC -> 5 V (o 3.3 V según el módulo); GND -> GND

import time
import network
import machine
import onewire
import ds18x20

try:
    import urequests as requests   # MicroPython clásico
except ImportError:
    import requests                # versiones recientes de MicroPython

# ---------------- Configuración ----------------
WIFI_SSID = "TU_RED_WIFI"
WIFI_CLAVE = "TU_CLAVE"
URL_BACKEND = "http://192.168.1.50:5000/lecturas"   # IP del computador donde corre Flask
ID_VITRINA = 1
PIN_SENSOR = 4
PIN_RELE = 26
INTERVALO_S = 30            # segundos entre lecturas

# Regla local de respaldo (se usa solo si el backend no responde)
LOCAL_MAX = 6.0
LOCAL_HISTERESIS = 1.0


# ---------------- Clases ----------------
class SensorTemperatura:
    """Un objeto por cada sensor DS18B20. Varios sensores pueden compartir el mismo pin
    (bus 1-Wire): se distinguen con el parámetro 'indice'."""

    def __init__(self, id_sensor, pin_datos, ubicacion="vitrina", indice=0):
        self.id_sensor = id_sensor
        self.ubicacion = ubicacion
        self.temperatura_actual = None
        self._ds = ds18x20.DS18X20(onewire.OneWire(machine.Pin(pin_datos)))
        roms = self._ds.scan()
        if len(roms) <= indice:
            raise OSError("No se encontró el sensor DS18B20 (revisar cableado y resistencia)")
        self._rom = roms[indice]

    def leer_temperatura(self):
        self._ds.convert_temp()
        time.sleep_ms(750)          # tiempo de conversión del DS18B20 a 12 bits
        self.temperatura_actual = round(self._ds.read_temp(self._rom), 2)
        return self.temperatura_actual


class Ventilador:
    """Actuador controlado por un módulo relé. Muchos módulos son 'activos en bajo'."""

    def __init__(self, pin, activo_en_bajo=True):
        self._rele = machine.Pin(pin, machine.Pin.OUT)
        self._activo_en_bajo = activo_en_bajo
        self.estado = False
        self.apagar()

    def encender(self):
        self._rele.value(0 if self._activo_en_bajo else 1)
        self.estado = True

    def apagar(self):
        self._rele.value(1 if self._activo_en_bajo else 0)
        self.estado = False


# ---------------- Funciones ----------------
def conectar_wifi(ssid, clave, intentos=20):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(ssid, clave)
        while not wlan.isconnected() and intentos > 0:
            time.sleep(1)
            intentos -= 1
    return wlan.isconnected()


def enviar_datos(temperatura, ventilador_encendido):
    """Envía la lectura al backend y devuelve su respuesta (dict) o None si falla.
    Si temperatura es None se avisa que el sensor falló (la interfaz muestra "Sensor desconectado")."""
    datos = {"id_vitrina": ID_VITRINA, "ventilador": ventilador_encendido}
    if temperatura is None:
        datos["error"] = "sensor"
    else:
        datos["temperatura"] = temperatura
    try:
        r = requests.post(URL_BACKEND, json=datos)
        respuesta = r.json()
        r.close()
        return respuesta
    except Exception as e:
        print("Error al enviar:", e)
        return None


def regla_local(temperatura, ventilador):
    if temperatura > LOCAL_MAX:
        ventilador.encender()
    elif temperatura <= LOCAL_MAX - LOCAL_HISTERESIS:
        ventilador.apagar()


# ---------------- Programa principal ----------------
def main():
    global INTERVALO_S
    sensor = SensorTemperatura("S1", PIN_SENSOR, "Vitrina tortas")
    ventilador = Ventilador(PIN_RELE)

    if not conectar_wifi(WIFI_SSID, WIFI_CLAVE):
        print("Sin WiFi: se trabaja con la regla local")

    while True:
        try:
            temperatura = sensor.leer_temperatura()
        except Exception as e:
            print("Error de lectura:", e)
            enviar_datos(None, ventilador.estado)     # avisa al backend para que genere la alerta
            time.sleep(5)
            continue

        if not network.WLAN(network.STA_IF).isconnected():
            conectar_wifi(WIFI_SSID, WIFI_CLAVE, intentos=5)

        respuesta = enviar_datos(temperatura, ventilador.estado)
        if respuesta is not None:
            # El backend decide con su regla (rango según el tipo de producto)
            if respuesta.get("ventilador"):
                ventilador.encender()
            else:
                ventilador.apagar()
            # El intervalo de lectura se cambia desde la pantalla de Configuración
            INTERVALO_S = respuesta.get("intervalo", INTERVALO_S)
        else:
            regla_local(temperatura, ventilador)

        print("T =", temperatura, "C | ventilador:", ventilador.estado)
        time.sleep(INTERVALO_S)


main()