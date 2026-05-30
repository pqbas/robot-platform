# Grabaciones asociadas a un lugar (Empresa→Fundo→Camellón)

## Problema
Hoy las grabaciones (`recordings`) no están asociadas a ningún lugar: no tienen
`camellon_id` ni `fundo_uuid`, y el `session_uuid` está siempre vacío (la sesión
de conteo vive en memoria y no tiene uuid al momento de grabar). Con muchos
videos de distintos fundos/camellones no hay forma de saber **dónde se grabó
cada uno** — se pierde la trazabilidad.

## Objetivo
Que una grabación pueda asociarse a un **camellón** (que da fundo y empresa por
transitividad, igual que las sesiones), que el operador lo elija al terminar de
grabar, y que el historial de grabaciones se pueda **filtrar por empresa/fundo**
como ya se hace en Sesiones.

## Decisiones confirmadas con el usuario
1. **Nivel de asociación:** camellón (mismo modelo que sesiones: `camellon_id` →
   fundo → empresa). En `recordings` es **nullable** (no rompe las existentes ni
   obliga a grabar siempre con lugar).
2. **Etiquetado al terminar de grabar:** **opcional**. Al detener aparece un
   diálogo con la cascada Empresa→Fundo→Camellón preseleccionada con el
   **contexto activo** actual. El operador confirma u **omite**; si omite, la
   grabación queda sin lugar.
3. **Editar después:** **sí**. Desde la lista de Grabaciones se puede asignar o
   corregir el lugar de cualquier grabación (incluidas las ~10 existentes sin
   lugar), al estilo del `SessionEditDialog`.
4. **Filtrado:** análogo a Sesiones — backend acepta params de filtrado;
   frontend hace la cascada Empresa→Fundo en cliente (mismo patrón que
   `SessionsPage`).

## Alcance
- Modelo + migración `016` (campo `camellon_id` nullable en `recordings`).
- Sync robot↔server del nuevo campo (por `camellon_uuid`, como sesiones).
- Endpoints: setear/editar lugar; listar con filtros.
- Frontend: diálogo post-grabación (cascada reutilizada), columna "Lugar" +
  filtros Empresa/Fundo + editar lugar en `RecordingsPage`.

## Fuera de alcance
- Auto-enlace grabación↔sesión por timestamps solapados (la "fase futura" del
  comentario en `recordings.py`). No se hace ahora.
- Cambiar el modelo de sesiones.
- Normalizar clases inconsistentes (`Persona` vs `persona`) — tema aparte.

## Criterio de éxito
- Al detener una grabación puedo elegir empresa/fundo/camellón (preseleccionado
  con el contexto activo) u omitir.
- En Grabaciones veo la columna Lugar, puedo filtrar por empresa/fundo, y puedo
  editar el lugar de cualquier fila (incluidas las viejas).
- El lugar viaja en el sync robot→server (y server→robot) sin perderse.
