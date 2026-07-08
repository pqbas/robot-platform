# Clasificadores de madurez (artefactos versionados)

Modelos `classifier.npz` de clasificación de madurez, guardados aquí **a
propósito** para no perderlos ni depender de una copia externa. Es una excepción
consciente a la convención del repo (`data/` y `*.pt` están en `.gitignore`: los
modelos normalmente viven fuera de git). Son chicos (~2.5 MB) y autocontenidos.

Todavía **no existe** el endpoint/UI para subir un clasificador ni asignarlo a
una categoría, así que instalarlo es un paso manual (copiar + sembrar DB).

## Artefactos

| Archivo | Origen | Clases | imgsz | latent |
| ------- | ------ | ------ | ----- | ------ |
| `blueberry_ripeness.b52fe867…ef0d.npz` | `mlops-classification-blueberry/runs/sup_aug_full/0` | AZUL, CREMOSO, GUINDA, PINTON1, PINTON2, ROSADO, VERDE (7) | 128 | 64 |

El nombre es `{modelo}.{sha256}.npz` (mismo esquema que los engines de detección),
así que el archivo cae directo en `data/robot/models/` sin renombrar.

## Formato (autocontenido)

- `enc__<param>` — state_dict del Encoder CNN congelado (numpy).
- `mean`, `scale`, `coef`, `intercept`, `classes` — sonda lineal.
- `class_names`, `latent_dim`, `imgsz` — metadata.

Inferencia: `emb = Encoder.embed(crop)` → `z = (emb-mean)/scale` →
`logits = z @ coef.T + intercept` → softmax → argmax. Ver
`src/classification_worker/README.md`.

## Instalar en un robot — un solo comando

`scripts/seed_classifier.py` hace todo el wiring (copia a `MODELS_DIR` + fila en
`classification_models` + asignación a la categoría), idempotente y leyendo la
metadata del propio `.npz`:

```bash
python3 scripts/seed_classifier.py                 # default: el .npz de aquí → categoría 'arandano'
python3 scripts/seed_classifier.py --category arandano --npz deploy/classifiers/otro.npz
```

Re-ejecutarlo no duplica nada (empareja por `file_hash`). Luego, con
`make run-classification` (o el servicio) arriba, **re-contar** una grabación de
esa categoría dispara la clasificación automáticamente — el conteo genera el
`{uuid}.crossings.jsonl` que la clasificación consume.

Ámbito: robot (SQLite). El server recibe los clasificadores por sync desde el
robot, no con este script.
