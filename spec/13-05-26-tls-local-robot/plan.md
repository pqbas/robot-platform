# Plan: TLS local en nginx del robot — secure context sin flag por device

## Group 1: Generación de certs

1. Agregar `data/robot/certs/` a `.gitignore` (root del repo). Confirmar que `data/` ya está ignorado o agregar la línea específica.

2. Crear `deploy/setup-tls.sh` ejecutable. Responsabilidades:
   - Verificar que `mkcert` está instalado en el Jetson; si no, `sudo apt-get install -y libnss3-tools` + descargar el binario de `https://github.com/FiloSottile/mkcert/releases` apropiado para `aarch64`.
   - Crear `data/robot/certs/` si no existe (permisos `0750`, owner usuario actual).
   - Ejecutar `mkcert -CAROOT` para localizar la CA, copiar `rootCA.pem` a `data/robot/certs/rootCA.pem`. Si no hay CA aún, correr `mkcert -install` *parcial* (solo generación, sin instalar en el system store — usar `CAROOT=$(pwd)/data/robot/certs mkcert -install` o redirigir).
   - Generar el cert: `CAROOT=$(pwd)/data/robot/certs mkcert -cert-file data/robot/certs/robot.crt -key-file data/robot/certs/robot.key 192.168.0.10`.
   - Imprimir un resumen: paths de los 4 archivos, validez del cert (`openssl x509 -in robot.crt -noout -dates`).
   - Documentar en el script (header comment) que regenerar = volver a correr este mismo comando.

3. Probar el script localmente en el Jetson antes de seguir:
   - `./deploy/setup-tls.sh`
   - `openssl x509 -in data/robot/certs/robot.crt -noout -text | grep -A1 "Subject Alternative Name"` debe mostrar `IP Address:192.168.0.10`.

---

## Group 2: Nginx — bloque 443 + redirect

4. Modificar `deploy/nginx.robot.conf.template`. Estructura final del archivo:

   ```nginx
   upstream backend {
       server 127.0.0.1:${BACKEND_PORT};
   }

   # HTTP redirect → HTTPS, plus /ca.crt fallback (so a device WITHOUT the CA
   # installed can still bootstrap by downloading it over plain HTTP).
   server {
       listen 80 default_server;
       server_name _;

       location = /ca.crt {
           alias /etc/nginx/certs/rootCA.pem;
           default_type application/x-x509-ca-cert;
           add_header Content-Disposition 'attachment; filename="robot-ca.crt"';
       }

       location / {
           return 301 https://$host$request_uri;
       }
   }

   # HTTPS: same content as the previous HTTP server.
   server {
       listen 443 ssl default_server;
       server_name _;

       ssl_certificate     /etc/nginx/certs/robot.crt;
       ssl_certificate_key /etc/nginx/certs/robot.key;
       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers HIGH:!aNULL:!MD5;

       root /opt/robot-platform/front/dist;
       index index.html;

       location = /ca.crt {
           alias /etc/nginx/certs/rootCA.pem;
           default_type application/x-x509-ca-cert;
           add_header Content-Disposition 'attachment; filename="robot-ca.crt"';
       }

       location / { try_files $uri $uri/ /index.html; }

       location = /offer { <bloque actual sin cambios> }
       location = /toggle_processing { <bloque actual sin cambios> }
       location /api/ { <bloque actual sin cambios> }
       location /ws/ { <bloque actual sin cambios — incluyendo Upgrade/Connection> }
   }
   ```

   Mover los `location` actuales del bloque HTTP al bloque HTTPS sin tocarlos.

5. Validar la plantilla rendereada manualmente antes de hookear al deploy:
   - `BACKEND_PORT=8080 envsubst '${BACKEND_PORT}' < deploy/nginx.robot.conf.template > /tmp/test.conf`
   - `sudo nginx -t -c /tmp/test.conf` con los certs ya copiados a `/etc/nginx/certs/` debe dar `syntax is ok` y `test is successful`.

---

## Group 3: Wiring en install.sh

6. En `deploy/install.sh`, insertar un nuevo paso **"--- 7a. TLS certificates (robot only) ---"** entre el paso 6 (Environment file) y el 7 (Nginx). Lógica:
   - Solo si `MODE == robot`.
   - Si `data/robot/certs/robot.crt` no existe, llamar a `./deploy/setup-tls.sh` automáticamente. Si falla, `error` con instrucciones para correrlo manualmente.
   - `sudo mkdir -p /etc/nginx/certs`.
   - `sudo install -m 0600 -o root -g root data/robot/certs/robot.crt /etc/nginx/certs/robot.crt`.
   - `sudo install -m 0600 -o root -g root data/robot/certs/robot.key /etc/nginx/certs/robot.key`.
   - `sudo install -m 0644 -o root -g root data/robot/certs/rootCA.pem /etc/nginx/certs/rootCA.pem`.

7. En el paso 7 existente de `install.sh`, después de `sudo nginx -t && sudo systemctl reload nginx`, agregar (solo modo robot) un `info "TLS habilitado. CA root disponible en http://<robot-ip>/ca.crt"` para que el operador sepa dónde descargar.

8. Al final del script, en el bloque robot (líneas ~371-374), cambiar el mensaje de acceso de `http://${IP}` a `https://${IP}` y agregar una línea sobre descargar la CA: `echo "  CA root:  http://${IP}/ca.crt (install once per device)"`.

---

## Group 4: Frontend — auditar uso de scheme

9. Audit pass — buscar usos hard-codeados de `http://` o `ws://` que no deriven del `window.location.protocol`:
   - `grep -rn '"http://\|"ws://\|`http://\|`ws://' front/src/ | grep -v node_modules` → enumerar resultados.
   - Para cada hit que sea una llamada del frontend al backend del robot (no a un server externo), confirmar que respeta el scheme de la página (preferir paths relativos `/api/...` o `${window.location.protocol}//${window.location.host}/...`).
   - Casos conocidos OK: `useMjpegStream.ts:69`, `useWebCodecsStream.ts` (ambos ya leen `window.location.protocol`).

10. Ajustar el `<base href>` si aplica (probablemente no necesario — Vite genera assets relativos), y verificar que `front/vite.config.ts` no force HTTP en algún proxy de dev (los devs lo siguen usando contra `localhost:8080` HTTP — ese path no cambia).

---

## Group 5: Documentación operativa

11. Agregar sección **"TLS local"** a `deploy/ROBOT_SETUP.md`:
    - Cómo instalar la CA en Android Chrome (Settings → Security → Encryption & credentials → Install a certificate → CA certificate).
    - Cómo instalar la CA en Chrome desktop (Linux/Mac/Windows — un párrafo por OS).
    - Qué hacer cuando el cert expira (~2 años): rerun `./deploy/setup-tls.sh` + `make deploy-robot`.
    - Qué hacer al mover el robot a otra LAN con IP distinta: editar el script para usar la nueva IP y rerun.

12. Mencionar en `CLAUDE.md` (sección Deploy) que nginx ahora sirve HTTPS con cert local y dónde viven los certs (`data/robot/certs/` + `/etc/nginx/certs/`).
