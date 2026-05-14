# Requirements: TLS local en nginx del robot — secure context sin flag por device

## Scope

Servir `https://192.168.0.10` con un cert válido para los devices del operador, firmado por una CA local generada con `mkcert` en el propio Jetson. Después de esta fase, el operador instala el CA root **una vez** por device (descargándolo desde `https://192.168.0.10/ca.crt` o equivalente) y luego usa la app sin warnings, sin tocar `chrome://flags`, y con WebCodecs funcionando out-of-the-box.

Fuera de scope:
- mDNS / `robot.local` — solo SAN IP.
- TLS en el server público (`server` mode) — ese ya está cubierto por Tailscale Funnel.
- Rotación automática de certs (mkcert los emite con validez ~825 días; renovación es manual cuando expire).

## Inputs / Data

| Archivo | Generador | Destino | Notas |
|---------|-----------|---------|-------|
| `rootCA.pem` | `mkcert -CAROOT` | `data/robot/certs/rootCA.pem` | CA root local. Lo que el operador instala en su device. |
| `rootCA-key.pem` | `mkcert -CAROOT` | `data/robot/certs/rootCA-key.pem` | Clave de la CA. **Nunca sale del robot.** |
| `robot.crt` | `mkcert 192.168.0.10` | `data/robot/certs/robot.crt` | Cert del servidor (SAN IP). |
| `robot.key` | `mkcert 192.168.0.10` | `data/robot/certs/robot.key` | Clave del cert. |

Ninguno se commitea — `data/robot/certs/` se agrega a `.gitignore`.

`install.sh` (modo robot) copia `robot.crt`/`robot.key` a `/etc/nginx/certs/` con permisos `0600` propiedad de root, y `rootCA.pem` queda accesible vía el endpoint público `/ca.crt`.

## Behavior

- **Acceso HTTPS:** `https://192.168.0.10/vision` carga sin warnings en cualquier device que tenga el CA root instalado. WebCodecs y cualquier otra API que requiera secure context funcionan sin flags.
- **Acceso HTTP:** `http://192.168.0.10/...` responde con `301 → https://192.168.0.10/...` (mismo path). Compatibilidad con bookmarks viejos.
- **Onboarding de un device nuevo:** operador abre `http://192.168.0.10/ca.crt` (redirigido a HTTPS pero con warning, o servido desde un fallback HTTP en el mismo endpoint), descarga el archivo, lo instala como "trusted root CA" siguiendo instrucciones por OS. Una sola vez por device.
- **Sin CA instalado:** browser muestra `NET::ERR_CERT_AUTHORITY_INVALID`. El operador puede "Continue anyway" en desktop Chrome (rompe en Android Chrome moderno donde no hay bypass para certs de CA desconocida). Recomendar instalar el CA antes de usar el feature.
- **Frontend:** `useStream.ts` ya detecta `window.location.protocol === "https:"` y arma `wss://`. Validar que el resto de endpoints (sync, API) también use scheme-relative o respete el protocolo de origen.

## Decisions

- **SAN IP única `192.168.0.10`, sin mDNS.** Por qué: la red del fundo es `192.168.0.0/24` operator-side estable (ver `reference_network_config` memory). mDNS agrega dependencia de `avahi-daemon` y de routers que no bloqueen multicast — fricción que no compensa cuando un bookmark con IP cruda funciona. Si el robot se muda a otro fundo, hay que regenerar el cert; esa operación se documenta en el script.
- **mkcert corre en el Jetson, certs viven en `data/robot/certs/`.** Por qué: simplifica el flujo de regeneración (un solo lugar, un solo comando) y no requiere que el admin tenga la máquina a mano. Trade-off: la `rootCA-key.pem` vive en el robot, así que un atacante con root acceso al Jetson puede emitir certs para cualquier dominio que confíen los devices con ese CA instalado. Mitigación: la CA solo se instala en devices del operador (no son devices personales), y el alcance del CA está limitado a los 3-5 devices del equipo.
- **CA root distribuido vía endpoint público `/ca.crt`.** Por qué: cero fricción operativa — el operador abre la URL, descarga, instala. Alternativa rechazada: pasarlo por USB/WhatsApp (más seguro pero introduce un paso manual cada vez que llega un device nuevo). Endpoint sirve el archivo `Content-Type: application/x-x509-ca-cert` para que el browser ofrezca instalarlo directamente.
- **Redirect 80→443.** Por qué: compatibilidad con bookmarks viejos sin sacrificar la garantía de que el tráfico real va por TLS. Alternativa rechazada: apagar 80 (rompe links legacy sin beneficio real). Las cookies `Secure` solo se setean cuando la conexión es HTTPS, así que el redirect es la primera línea de defensa.
- **Sin cert pinning / HSTS por ahora.** Por qué: HSTS atrapa al operador si más adelante decidimos rotar la CA o cambiar el hostname. En LAN local con CA self-managed, el costo es mayor que el beneficio. Reconsiderar si alguna vez se profesionaliza el deploy.
- **`mkcert -install` *no* se corre en el robot.** Por qué: ese comando agregaría la CA a los stores del Jetson, lo cual no nos interesa (el robot no consume sus propios endpoints). La CA solo se distribuye a los devices del operador.

## Context

- See `spec/mission.md` — el robot trabaja en LAN del fundo; cualquier hardening de transporte aplica solo a esa LAN.
- See `spec/tech-stack.md` — nginx ya está en el stack para servir `front/dist/` + proxy al backend uvicorn.
- See `spec/roadmap.md` — Phase 29 ladders up; resuelve el caveat de Phase 28 (workaround manual de `chrome://flags` por device).
- See `spec/12-05-26-webcodecs-websocket/` — la fase que introduce el requirement de secure context.
- Existing patterns to follow:
  - `deploy/nginx.robot.conf.template` — plantilla actual con `envsubst`; agregar bloque `server` para 443 sin tocar el de 80 más que para el redirect.
  - `deploy/install.sh` paso "--- 7. Nginx ---" — donde se hace `envsubst` y `nginx -t`. El cert copy debe ir antes del `nginx -t`.
  - Frontend ya detecta protocolo: `front/src/hooks/useMjpegStream.ts:69` y `useWebCodecsStream.ts` usan `window.location.protocol === "https:" ? "wss:" : "ws:"`.
- Memory: `reference_network_config` confirma que `eth1` es `192.168.0.10/24` y los clientes están en `192.168.0.0/24`.
