# Validation: Camera Disconnect

La fase está lista para mergear cuando el check manual de desconexión pasa
y el build de TypeScript es limpio.

## Automated Tests

- [ ] `cd front && npm run build` termina sin errores

## Manual Checks

**Desconexión física de la cámara:**
- [ ] Con el stream activo en el browser, desconectar el cable USB de la cámara
- [ ] El backend imprime en logs:
  `WARNING:webrtc:Camera read exception: ... — stopping track`
  (o `Camera returned empty frame — stopping track`)
- [ ] El frontend sale del estado "cargando" en menos de 3 segundos y muestra
  el botón "Conectar" (sin necesidad de recargar la página)
- [ ] El backend sigue corriendo — `make run-robot` no necesita reiniciarse

**Reconexión:**
- [ ] Reconectar la cámara USB y pulsar "Conectar" en el frontend → el stream
  se restablece normalmente

**Caída durante sesión de conteo:**
- [ ] Iniciar una sesión de conteo, luego desconectar la cámara
- [ ] La sesión se detiene y el frontend muestra "Conectar"
- [ ] Tras reconectar, se puede iniciar una nueva sesión sin reiniciar el backend

## Definition of Done

Build limpio y los tres checks manuales pasan: el frontend sale del estado
colgado al desconectar la cámara, el backend sigue vivo, y el operador puede
reconectar sin reiniciar nada.
