# Plan: selección de organización + camellón al guardar (modo robot)

## Contexto

Hoy el robot está atado a una sola empresa/fundo vía el "device context" sincronizado desde el server (`device_context.json`). El equipo de pruebas a menudo olvida pre-configurar el robot antes de una visita de campo y suele estar **offline**, así que esa rigidez los bloquea. Queremos que, al **guardar una sesión de conteo**, puedan **elegir Empresa → Fundo → Camellón** (y crear cualquiera de los tres en el momento), con la selección **sticky** (queda como contexto actual, se ve en el badge y viene preseleccionada la próxima vez). Esto reemplaza el contexto fijo por uno seleccionable en runtime.

Decisiones ya confirmadas con el usuario: catálogo pre-sincronizado de **todas** las empresas/fundos disponible offline + crear nueva en el momento; jerarquía completa Empresa→Fundo→Camellón; selección **sticky**.

**Punto de partida / git:** el working tree tiene cambios sin commitear de esta sesión: (a) el fix del marco de video 16:9 (`VideoStream.tsx`, `streamMedia.ts`, overlays) — feature independiente y ya terminada; (b) el scoping parcial de camellones (`camellones.py`, `storage.py`) — que este plan **adapta**. Se trabajará en una rama nueva `feat/save-time-org-selection`; el fix de video se commitea aparte primero para no entrelazarlo.

---

## Step 0 — Reconciliar historial de migraciones (BLOCKER, pre-existente)

`alembic history` falla: *"Requested revision 013 overlaps with other requested revisions 012"*. Causa: dos archivos declaran `revision="012"` (colisión de IDs, no rama). Entró con el pull de master. Bloquea cualquier migración nueva y los deploys.

1. **Mantener** `back/alembic/versions/012_selected_label.py` como `revision="012"` (su columna ya existe en el robot; su guard `if "selected_label" not in cols` lo hace no-op al re-correr).
2. **Renumerar** `012_fix_detection_models_fruit_type_nullable.py` → `revision="013"`, `down_revision="012"` (renombrar archivo a `013_...`).
3. **Renumerar** `013_fix_detection_models_file_hash_nullable.py` → `revision="014"`, `down_revision="013"` (renombrar a `014_...`).
4. **Añadir guards idempotentes** (patrón de `009`, vía `sa.inspect(conn).get_columns`) a ambos archivos renumerados — sin esto el upgrade del robot CRASHEA (hace `alter_column("fruit_type_uuid")` sobre una columna que el robot no tiene):
   - Nuevo 013: `if "fruit_type_uuid" in cols and not nullable → alter nullable=True`; + seguro `if "selected_label" not in cols → add_column`.
   - Nuevo 014: `if "file_hash" in cols and not nullable → alter nullable=True`. Conservar el `reflect_args` que ya trae.
5. **Sin `alembic stamp`** en el robot (está en `012`; 013/014 corren forward como no-ops). En Postgres (server) sí flipean de verdad.

**Verificar:** `uv run alembic -c back/alembic.ini history` muestra cadena lineal `011→012→013→014` sin error.

## Step 1 — Unicidad compuesta de camellones (migración nueva `015`)

- **Modelo** (`back/models.py`, `Camellon`): quitar `unique=True` de `nombre`; añadir
  `__table_args__ = (UniqueConstraint("fundo_uuid", "nombre", name="uq_camellones_fundo_nombre"),)` (importar `UniqueConstraint`).
- **Migración** `back/alembic/versions/015_camellon_fundo_nombre_unique.py` (`down_revision="014"`), dialecto-agnóstica. Dropear por **nombre inspeccionado** (SQLite: `sqlite_autoindex_camellones_1` / inline `UNIQUE(nombre)`; Postgres: `camellones_nombre_key`):
  ```python
  insp = sa.inspect(op.get_bind())
  # localizar el unique sobre ['nombre'] en get_unique_constraints / get_indexes
  with op.batch_alter_table("camellones", naming_convention={...}) as b:
      b.drop_constraint(<nombre_encontrado>, type_="unique")
      b.create_unique_constraint("uq_camellones_fundo_nombre", ["fundo_uuid", "nombre"])
  ```
  `naming_convention` **local al batch op** (no global en `Base.metadata`, para no perturbar autogenerate). Sin limpieza de datos (global-unique ⇒ compuesto ya es único).

## Step 2 — Contexto activo "sticky" (backend)

- **Config** (`back/config.py`, `StorageConfig`): `active_context_path` (default `data/robot/active_context.json`).
- **`back/services/sync_pull_context.py`**:
  - `read_active_context() -> dict | None` (lee el archivo; `None` si falta/ inválido).
  - `write_active_context(ctx)` (mkdir -p + write).
  - `read_effective_context() -> dict`: activo si existe, si no `read_cached_context()`. **Única fuente de verdad** para el resto de la app.
  - Extraer `_upsert_empresa_fundo(session, empresa, fundo)` reutilizable (de `_upsert_context`), para que la selección activa exista como FK local de camellones.
  - `pull_device_context()` sigue tocando **solo** `device_context.json` → nunca pisa `active_context.json` (esto resuelve el clobber).
- **`back/routes/device_context.py`**:
  - `GET /api/device-context/` → `read_effective_context()`.
  - `POST /api/device-context/active` (robot-only): `{empresa, fundo}` → `write_active_context` + `_upsert_empresa_fundo`; devuelve contexto efectivo. Schema `ActiveContextSet` en `back/schemas.py`.

## Step 3 — Pull del catálogo (todas las empresas/fundos, offline)

- **Server** (`back/routes/sync.py`): `GET /api/sync/catalog` con `dependencies=_device_dep` → `{"empresas": [...], "fundos": [...]}` (mismo auth por device-key que `device-context`).
- **Robot** (`back/services/sync_pull_context.py`): `pull_catalog()` → GET catálogo + **upsert-only** en `empresas`/`fundos` (reusa `_upsert_empresa_fundo`). **No** borrar huérfanos (a diferencia de `_upsert_models`): un robot puede haber creado empresa/fundo offline aún sin push.
- **Wiring**: `pull_catalog()` en `sync_loop._sync_cycle` (junto a `pull_device_context`) y en `force_pull` (`POST /sync/pull`).
- *(El push de empresas/fundos robot→server ya existe en `sync_push.py` → "crear nueva" sube solo, sin wiring extra.)*

## Step 4 — Endpoints empresas/fundos en robot + scoping de camellón

- **Montar los routers CRUD existentes en ambos modos** con dep condicional por modo (idiom de `_device_dep`): en `back/routes/empresas.py` y `fundos.py`, `admin_dep = [Depends(require_role("admin"))] if config.mode==SERVER else []`. Robot: list/create sin gate; server: mantiene admin. En `back/main.py`, mover `empresas_router`/`fundos_router` fuera del bloque `if SERVER` a montaje siempre.
- **Camellones** (`back/routes/camellones.py` + `back/services/storage.py`):
  - `_fundo_scope()` debe leer `read_effective_context()` (no `read_cached_context()`).
  - `GET /api/camellones?fundo_uuid=<uuid>`: param opcional; si viene, scope a él; si no, default al fundo del contexto efectivo. (`list_camellones` ya soporta `scope_fundo`/`fundo_uuid`.)
  - `create_camellon`: aceptar `fundo_uuid` explícito (extender `CamellonCreate` con `fundo_uuid: str|None`); el chequeo de unicidad (`get_camellon_by_nombre`) scopeado **al mismo `fundo_uuid` que se escribe**.
  - `rename_camellon`: unicidad scopeada al `fundo_uuid` propio de la fila.
  - `POST /api/sessions/save` (`counting.py`): sin cambios (recibe `camellon_id`; el camellón ya se resolvió/creó con su fundo antes).

## Step 5 — Frontend: SaveDialog en cascada + persistencia sticky

- **Reusar** `front/src/api/admin.ts` (`getEmpresas/createEmpresa/getFundos/createFundo`, ya pegan a `/api/empresas/`,`/api/fundos/` — alcanzables en robot tras Step 4). Tipos `Empresa`/`Fundo` ya existen. **No** crear API nueva de empresas/fundos.
- **`front/src/api/camellones.ts`**: `getCamellones(fundoUuid?)` (append `?fundo_uuid=`); `createCamellon(nombre, fundoUuid?)`. **Fix `findOrCreateCamellon`**: su fallback 409 busca por nombre global → ahora debe scopear por `fundoUuid` (bajo unicidad compuesta, un match global resuelve el fundo equivocado).
- **`front/src/api/device-context.ts`**: `setActiveContext(empresa, fundo)` → `POST /api/device-context/active`.
- **`front/src/modules/vision/components/SaveDialog.tsx`** → cascada Empresa→Fundo→Camellón:
  - Cargar empresas al abrir; al elegir empresa → cargar sus fundos; al elegir fundo → `getCamellones(fundoUuid)`.
  - Default a los 3 niveles según el **contexto efectivo** actual (pasar `deviceContext` como prop desde VisionPage).
  - "+ Nuevo" en cada nivel (empresa/fundo/camellón), reusando el patrón inline de create/rename actual.
  - Al guardar: `setActiveContext(empresa, fundo)` (sticky) + `onSave`.
- **`front/src/hooks/useCounting.ts`** `save()`: pasar `fundoUuid` a `findOrCreateCamellon`.
- **`front/src/modules/vision/VisionPage.tsx`**: tras guardar, refetch del device-context para que el badge se actualice ya (el hook solo refresca cada ~60s) — añadir `refetch` a `useDeviceContext`.

---

## Verificación

**Migraciones (ambas DBs):**
- Robot SQLite: `uv run alembic -c back/alembic.ini history` (lineal, sin "overlaps"); `upgrade head` sobre copia de `data/robot/robot.db` → 013/014 no-ops, 015 sin error "Constraint must have a name". `PRAGMA index_list(camellones)` muestra el compuesto y ya no `sqlite_autoindex_camellones_1`.
- Server Postgres: `ENV_FILE=.env.server uv run alembic -c back/alembic.ini upgrade head` (Makefile:47) → 013 flipea `fruit_type_uuid` nullable; 015 dropea `camellones_nombre_key` y crea el compuesto.

**Funcional (cascada + offline + sticky):**
1. Sync online → `pull_catalog` pobló `empresas`/`fundos` locales.
2. Offline: abrir SaveDialog → cascada completa desde catálogo local; crear empresa/fundo/camellón en el momento.
3. Guardar → sesión persiste, `active_context.json` escrito, badge se actualiza al instante.
4. **Test regresión clave**: forzar sync (que llama `pull_device_context`, el path que pisaba) → `GET /api/device-context/` SIGUE devolviendo la selección sticky (precedencia activa). Esto prueba el diseño.
5. Reconectar → empresa/fundo/camellón creados offline suben (en `sync_log`, aceptados por receive del server).
6. Mismo nombre de camellón en dos fundos distintos → ambos OK; mismo nombre dos veces en un fundo → 409.

## Riesgos / notas
- **NULL-bucket**: SQLite y Postgres tratan NULL como distinto en unique → camellones legacy con `fundo_uuid IS NULL` pueden colisionar por nombre entre sí. Aceptable (los nuevos siempre llevan fundo).
- **Crear empresa/fundo sin admin gate en robot** es intencional (decisión de producto) — esas filas suben al server multi-tenant vía sync.
- Confirmar en server que `detection_models.fruit_type_uuid` sigue NOT NULL (de migración 002) antes de confiar en el alter guardado del nuevo 013.
