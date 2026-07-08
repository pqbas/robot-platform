#!/usr/bin/env python3
"""Instala un clasificador de madurez y lo asigna a una categoría — en un paso.

Mientras no exista el endpoint/UI para subir clasificadores, esto hace todo el
wiring que hoy es manual:

  1. copia el .npz a MODELS_DIR (data/robot/models) sin renombrar,
  2. inserta (idempotente por file_hash) la fila en `classification_models`,
  3. apunta `categories.<categoria>.classification_model_uuid` al modelo.

Idempotente: re-ejecutar no duplica filas ni rompe nada. Lee la metadata
(class_names/latent_dim/imgsz) del propio .npz — no hay que pasarla a mano.

Uso (robot, SQLite):
    python3 scripts/seed_classifier.py                       # defaults: arándano
    python3 scripts/seed_classifier.py --category arandano \
        --npz deploy/classifiers/blueberry_ripeness.<hash>.npz

Ámbito: robot (SQLite en data/robot/robot.db). El server recibe los
clasificadores por sync desde el robot, no por este script.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import shutil
import sqlite3
import uuid as uuidlib
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_NPZ_GLOB = os.path.join(REPO, "deploy", "classifiers", "*.npz")
DEFAULT_DB = os.path.join(REPO, "data", "robot", "robot.db")
DEFAULT_MODELS_DIR = os.getenv("MODELS_DIR", os.path.join(REPO, "data", "robot", "models"))


def _resolve_default_npz() -> str:
    hits = sorted(glob.glob(DEFAULT_NPZ_GLOB))
    if not hits:
        raise SystemExit(f"[x] no encontré ningún .npz en {DEFAULT_NPZ_GLOB}; pasá --npz")
    if len(hits) > 1:
        raise SystemExit(
            "[x] hay varios .npz en deploy/classifiers/; especificá cuál con --npz:\n  "
            + "\n  ".join(hits)
        )
    return hits[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--npz", help="ruta al classifier.npz (default: el de deploy/classifiers/)")
    ap.add_argument("--category", default="arandano", help="categoría destino (default: arandano)")
    ap.add_argument("--version", default=None, help="etiqueta de versión (default: nombre de la carpeta/archivo)")
    ap.add_argument("--db", default=DEFAULT_DB, help=f"SQLite del robot (default: {DEFAULT_DB})")
    ap.add_argument("--models-dir", default=DEFAULT_MODELS_DIR, help=f"MODELS_DIR (default: {DEFAULT_MODELS_DIR})")
    args = ap.parse_args()

    npz = args.npz or _resolve_default_npz()
    if not os.path.isfile(npz):
        raise SystemExit(f"[x] no existe el .npz: {npz}")
    if not os.path.isfile(args.db):
        raise SystemExit(f"[x] no existe la DB: {args.db}")

    # --- metadata del .npz ---
    import numpy as np  # noqa: E402 (system numpy alcanza; el backend no importa numpy)

    z = np.load(npz, allow_pickle=True)
    for k in ("class_names", "latent_dim", "imgsz"):
        if k not in z:
            raise SystemExit(f"[x] el .npz no tiene la clave '{k}' — ¿es un classifier.npz válido?")
    class_names = [str(x) for x in z["class_names"].tolist()]
    latent_dim = int(z["latent_dim"])
    imgsz = int(z["imgsz"])
    version = args.version or os.path.basename(os.path.dirname(npz)) or os.path.splitext(os.path.basename(npz))[0]

    # --- hash + copia a MODELS_DIR (nombre {stem}.{sha256}.npz para caer directo) ---
    file_hash = hashlib.sha256(open(npz, "rb").read()).hexdigest()
    filename = os.path.basename(npz)
    # si el nombre no lleva el hash, se lo agregamos para respetar la convención
    if file_hash not in filename:
        stem = os.path.splitext(filename)[0]
        filename = f"{stem}.{file_hash}.npz"
    os.makedirs(args.models_dir, exist_ok=True)
    dst = os.path.join(args.models_dir, filename)
    if os.path.abspath(dst) != os.path.abspath(npz):
        if os.path.isfile(dst) and hashlib.sha256(open(dst, "rb").read()).hexdigest() == file_hash:
            print(f"[=] ya estaba en {dst}")
        else:
            shutil.copyfile(npz, dst)
            print(f"[+] copiado -> {dst}")

    # --- upsert DB (idempotente por file_hash) + asignación de categoría ---
    db = sqlite3.connect(args.db, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        row = db.execute(
            "SELECT uuid, filename FROM classification_models WHERE file_hash=?", (file_hash,)
        ).fetchone()
        if row:
            model_uuid = row["uuid"]
            print(f"[=] classification_models ya tenía este modelo: {model_uuid}")
        else:
            model_uuid = str(uuidlib.uuid4())
            now = datetime.now(timezone.utc).isoformat()
            db.execute(
                """INSERT INTO classification_models
                   (uuid, version, filename, file_hash, source, class_names,
                    num_classes, latent_dim, imgsz, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (model_uuid, version, filename, file_hash, "uploaded",
                 json.dumps(class_names), len(class_names), latent_dim, imgsz, now),
            )
            print(f"[+] insertado classification_models {model_uuid} (v={version})")

        cat = db.execute(
            "SELECT classification_model_uuid FROM categories WHERE name=?", (args.category,)
        ).fetchone()
        if cat is None:
            raise SystemExit(
                f"[x] no existe la categoría '{args.category}'. Categorías: "
                + ", ".join(r["name"] for r in db.execute("SELECT name FROM categories"))
            )
        if cat["classification_model_uuid"] == model_uuid:
            print(f"[=] la categoría '{args.category}' ya apuntaba a este modelo")
        else:
            db.execute(
                "UPDATE categories SET classification_model_uuid=?, updated_at=? WHERE name=?",
                (model_uuid, datetime.now(timezone.utc).isoformat(), args.category),
            )
            print(f"[+] categoría '{args.category}' -> {model_uuid}")
        db.commit()
    finally:
        db.close()

    print(f"\n[ok] listo. clases: {class_names}")
    print("     re-contá una grabación de esa categoría para disparar la clasificación.")


if __name__ == "__main__":
    main()
