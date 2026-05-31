# Plan: Session Detection Replay

## Group 1: Backend — DB + Schema

1. Crear `back/alembic/versions/017_session_recording_uuid.py`:
   - Agrega columna `recording_uuid TEXT NULLABLE` a la tabla `sessions`.
   - Patron idempotente SQLite (check `PRAGMA table_info`) + PostgreSQL (`information_schema.columns`), igual que `016_recording_camellon.py`.

2. Agregar campo al modelo `Session` en `back/models.py`:
   ```python
   recording_uuid: Mapped[str | None] = mapped_column(Text, nullable=True)
   ```

3. Agregar campo al schema `SessionOut` en `back/schemas.py`:
   ```python
   recording_uuid: str | None = None
   ```

4. En `back/routes/counting.py`, funcion `save_session`, despues de `_link_recording_camellon`:
   ```python
   rec_uuid = counter.get_last_recording_uuid()
   if rec_uuid:
       sess.recording_uuid = rec_uuid
   ```
   El `get_db` dependency hace commit al final del request, por lo que no se necesita commit explicito.

---

## Group 2: Backend — Endpoint de detecciones

5. Agregar endpoint en `back/routes/recordings.py`:
   ```python
   @router.get("/{uuid}/detections")
   async def get_recording_detections(uuid: str, db: AsyncSession = Depends(get_db)):
   ```
   - Busca `Recording` por uuid; 404 si no existe.
   - Construye path del JSONL: `os.path.join(os.path.dirname(row.file_path), f"{uuid}.jsonl")`.
   - Si el archivo no existe: retorna `{"fps": row.fps, "frames": []}`.
   - Si existe: lee y parsea cada linea como JSON (`json.loads`), retorna `{"fps": row.fps, "frames": [...]}`.
   - Sin restriccion de modo (disponible en robot y server para visualizacion desde el servidor).

---

## Group 3: Frontend — Tipos + API

6. Agregar campo en `front/src/types/index.ts`, tipo `Session`:
   ```typescript
   recording_uuid: string | null
   ```

7. Definir tipo para la respuesta de detecciones en `front/src/types/index.ts`:
   ```typescript
   export type DetectionFrame = {
     frame: number
     t: number
     dets: { cls: string; conf: number; bbox: [number, number, number, number]; track_id: number | null }[]
   }
   export type RecordingDetections = {
     fps: number | null
     frames: DetectionFrame[]
   }
   ```

8. Agregar funcion en `front/src/api/recordings.ts`:
   ```typescript
   export function getRecordingDetections(uuid: string): Promise<RecordingDetections> {
     return apiFetch(`/api/recordings/${uuid}/detections`)
   }
   ```

---

## Group 4: Frontend — Icono en SessionsTable

9. En `front/src/modules/map/components/SessionsTable.tsx`:
   - Importar `Video` de `lucide-react` y `DetectionReplayDialog` (nuevo).
   - Agregar estado `replaySession: Session | null`.
   - Agregar columna de encabezado (ancho `w-8`) despues de la columna de conteo.
   - En cada fila, si `s.recording_uuid != null`, mostrar un `Button` con `<Video className="size-3.5" />` que setea `replaySession = s` al hacer clic (con `e.stopPropagation()`).
   - Renderizar `<DetectionReplayDialog>` al final del componente, controlado por `replaySession`.

---

## Group 5: Frontend — DetectionReplayDialog

10. Crear `front/src/modules/map/components/DetectionReplayDialog.tsx`:
    - Props: `session: Session`, `open: boolean`, `onOpenChange: (open: boolean) => void`.
    - Estado: `detData: RecordingDetections | null`, `currentDets: Detection[]`.
    - En `useEffect` al abrir: llama `getRecordingDetections(session.recording_uuid!)` y guarda en `detData`.
    - `videoRef = useRef<HTMLVideoElement>(null)`.
    - Handler `onTimeUpdate`: `frameIdx = Math.floor(video.currentTime * (detData.fps ?? 0))`, busca `detData.frames[frameIdx]`, mapea `dets` a `Detection[]` (renombra `cls->class_name`, `conf->confidence`), setea `currentDets`.
    - Estructura del Dialog:
      ```tsx
      <div className="relative">
        <video ref={videoRef} src={getRecordingFileUrl(session.recording_uuid!)}
               controls className="w-full" onTimeUpdate={onTimeUpdate} />
        <DetectionOverlay mediaRef={videoRef as MediaRef} detections={currentDets} visible={true} />
      </div>
      ```
    - Patron de Dialog: igual que `SessionEditDialog.tsx` (usa `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` de shadcn/ui).
    - Patron de overlay: reutiliza `DetectionOverlay` de `front/src/modules/vision/components/DetectionOverlay.tsx` sin modificarlo.
