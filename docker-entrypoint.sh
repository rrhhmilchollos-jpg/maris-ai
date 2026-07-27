#!/bin/sh
# Arranca el demonio D-Bus del sistema antes de lanzar el proceso principal.
# Chromium/Puppeteer intenta conectar a /run/dbus/system_bus_socket al
# arrancar; sin un demonio D-Bus corriendo en el contenedor, ese socket no
# existe y el navegador headless falla al lanzarse (error visto en
# producción: "Failed to connect to the bus: Failed to connect to socket
# /run/dbus/system_bus_socket: No such file or directory").
set -e

mkdir -p /run/dbus
rm -f /run/dbus/pid

# --fork lanza el demonio en segundo plano y devuelve el control enseguida;
# si ya hay un demonio corriendo (reinicio del proceso sin reiniciar el
# contenedor), no lo tratamos como error fatal.
dbus-daemon --system --fork || echo "aviso: dbus-daemon ya estaba corriendo o no pudo arrancar — Puppeteer podría fallar igualmente"

# exec sustituye este script por el proceso real (node ...), preservando
# señales (SIGTERM de Coolify/Docker al reiniciar/parar) y el PID 1 correcto.
exec "$@"
