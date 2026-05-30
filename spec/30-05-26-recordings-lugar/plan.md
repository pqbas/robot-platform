# Plan de implementación

Rama sugerida: `feat/recordings-lugar`. Orden pensado para que cada paso sea
verificable por separado (DB → backend → sync → frontend).

## Step 1 — Modelo + migración 016
- `back/models.py`, `Recording`: agregar
  `camellon_id: Mapped[int | None] = mapped_column(ForeignKey("camellones.id"), nullable=True)`
  + `relationship` opcional a `Camellon` (sin `back_populates`, o agregar
  `recordings` en `Camellon` si conviene para queries).
- Migración `back/alembic/versions/016_recording_camellon.py` (`down_revision="015"`),
  dialecto-agnóstica con guard idempotente (patrón de las 013/014):
  `if "camellon_id" not in cols: op.add_column("recordings", sa.Column("camellon_id", sa.Integer(), nullable=True))`.
  Sin backfill (las existentes quedan NULL). FK explícita opcional en SQLite
  (se puede omitir el constraint nombrado y dejar solo la columna; en Postgres
  crear el FK con `op.create_foreign_key`).

**Verifica:** `alembic history` lineal `015→016`; `upgrade head` no-op sobre
columna ya existente; `PRAGMA table_info(recordings)` muestra `camellon_id`.

## Step 2 — Schemas
- `back/schemas.py`:
  - `RecordingOut`: agregar `camellon_id: int | None` y, para display/filtro sin
    segundo fetch, `camellon_nombre: str | None` y `fundo_uuid: str | None`
    (resueltos en el endpoint vía join/lookup).
  - Nuevo `RecordingPlaceUpdate { camellon_id: int | None }` (None = quitar lugar).

## Step 3 — Endpoints (`back/routes/recordings.py`)
- `PUT /api/recordings/{uuid}/place` (body `RecordingPlaceUpdate`): valida que el
  camellón exista (si no es None), setea `recording.camellon_id`, y **re-marca la
  grabación para sync** (ver Step 4). Devuelve `RecordingOut`.
- `GET /api/recordings/` (extender): aceptar query params opcionales
  `camellon_id`, `fundo_uuid`, `from`, `to`, `device_id` (mismo espíritu que
  `getSessions`). `fundo_uuid` filtra por los camellones de ese fundo. Resolver
  `camellon_nombre`/`fundo_uuid` para cada fila (join a `camellones`/`fundos`).
  - Mantener orden `started_at desc`.
- `POST /stop` (`stop_recording`): **no** se cambia el modelo de creación; el
  lugar se setea por separado vía el PUT desde el diálogo post-grabación (el row
  ya existe al detener). Confirma que `stop` devuelve el `uuid` para que el front
  llame al PUT.

## Step 4 — Sync robot↔server
- **Push** (`back/services/sync_push.py`, bloque recordings ~166): resolver
  `camellon_id → camellon_uuid` (como hace sessions en :131) y agregar
  `"camellon_uuid": <uuid|null>` al payload.
- **Receive** (`back/services/sync_receive.py`, `receive_recordings`): resolver
  `camellon_uuid → camellon_id` local (patrón de `receive_sessions` :126);
  si no existe el camellón, dejar `camellon_id=None` (no fallar — puede no haber
  sincronizado aún).
- **Re-sync tras editar lugar:** el PUT de Step 3 debe limpiar el estado
  "synced" de esa grabación en el mecanismo de `sync_log` (lo que use
  `_get_unsynced_uuids`) para que el cambio de lugar se vuelva a empujar.
  *(Verificar el mecanismo exacto al implementar — es el punto más delicado.)*
- Schemas de sync: `SyncRecording` (en `back/schemas.py`) agregar
  `camellon_uuid: str | None = None`.

## Step 5 — Frontend: API y tipos
- `front/src/types/index.ts`, `Recording`: agregar `camellon_id: number | null`,
  `camellon_nombre: string | null`, `fundo_uuid: string | null`.
- `front/src/api/recordings.ts`:
  - `getRecordings(params?)` con `from/to/device_id/camellon_id/fundo_uuid`
    (querystring, igual que `getSessions`).
  - `setRecordingPlace(uuid, camellonId | null)` → `PUT .../place`.

## Step 6 — Cascada reutilizable (Empresa→Fundo→Camellón)
- Extraer la cascada con creación inline del `SaveDialog` de sesiones a un
  componente compartido (p.ej. `front/src/modules/vision/components/OrgCascade.tsx`
  o `components/`), parametrizado por: contexto activo (defaults), y
  `onChange(camellonId)`. **Reutilizar** en (a) el `SaveDialog` actual, (b) el
  nuevo diálogo de grabación, (c) el editor de lugar en la lista.
  - Alternativa más barata si extraer resulta invasivo: duplicar la cascada en un
    `RecordingPlaceDialog` dedicado. Preferible extraer para no divergir.

## Step 7 — Diálogo post-grabación
- Nuevo `RecordingPlaceDialog` (reusa Step 6). Props: `open`, `recordingUuid`,
  `deviceContext` (para defaults), `onSaved`, `onSkip`.
- Botones: **Omitir** (cierra sin setear) y **Guardar lugar** (llama
  `setRecordingPlace`). Default = contexto activo.
- `front/src/modules/vision/VisionPage.tsx`: tras `stopRecording()` que devuelve
  el recording, abrir el diálogo con su `uuid`. (Coordinar con el flujo actual de
  `useRecording`.)

## Step 8 — RecordingsPage: columna Lugar + filtros + editar
- `front/src/modules/recordings/RecordingsPage.tsx`:
  - Cargar empresas/fundos/camellones (como `SessionsPage`) para resolver
    nombres y construir los filtros.
  - Columna **Lugar** = `camellon_nombre ?? "— (sin lugar)"` (idealmente
    `Fundo / Camellón`).
  - Filtros **Empresa** y **Fundo** en cascada **cliente** (mismo patrón que
    `SessionsPage`: opciones derivadas del set ya filtrado, reset de hijo
    obsoleto). Reusar la lógica de cascada de `SessionsPage` si conviene.
  - Botón **editar lugar** por fila → abre `RecordingPlaceDialog` con el
    `camellon_id` actual; al guardar, refresca la fila.

## Notas / riesgos
- **Re-sync tras editar** (Step 4) es el punto crítico: si no se limpia el estado
  synced, el server nunca se entera del lugar. Verificar `sync_log`.
- **NULL permitido:** grabaciones sin lugar son válidas; la UI debe mostrarlas y
  permitir filtrarlas (incluir opción "sin lugar" en el filtro es opcional).
- **Cascada compartida:** extraer del `SaveDialog` toca código de sesiones ya
  mergeado; hacerlo con cuidado para no regresionar el guardado de sesiones.
- Server multi-tenant: el filtro por fundo/empresa en server permite ver
  grabaciones de varios robots por lugar (consistente con sesiones).
