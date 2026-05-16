"""Helpers para derivar el class_mapping filtrado a partir del label
seleccionado por el usuario.

El worker filtra/renombra clases con el dict que recibe en
``reload_model(class_mapping=...)``. Para que el filtro persista a
través de reloads automáticos (sync_pull, conversion_poller, boot),
guardamos el label elegido en ``DetectionModel.selected_label`` y
re-derivamos la lista filtrada antes de cada reload.
"""

import json


def derive_filtered_class_mapping(class_mapping_json: str | None, label: str | None) -> list:
    """Return the single class_mapping entry whose label matches.

    ``class_mapping_json`` is the raw JSON stored on the DetectionModel
    row. ``label`` is the system_label the user selected. Returns an
    empty list when there's no match — the worker treats that as
    "no filter, pass all classes".
    """
    if not class_mapping_json or not label:
        return []
    try:
        full_mapping = json.loads(class_mapping_json)
    except (json.JSONDecodeError, TypeError):
        return []
    for entry in full_mapping:
        if isinstance(entry, str):
            if entry == label:
                return [entry]
        elif isinstance(entry, dict):
            sl = entry.get("system_label") or entry.get("model_label", "")
            if sl == label:
                return [entry]
    return []
