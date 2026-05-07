# Requirements: Informe técnico unificado #4 a PROCIENCIA

## Scope

Producir el INFORME TÉCNICO #4 a PROCIENCIA, un único documento `.docx` formal que consolida los entregables previos #2 (IA) y #3 (Plataforma) más el avance interno actual. Cubre plataforma (workers, TensorRT, fan-out, despliegue) e IA (modelos evaluados y métricas) en un solo informe con estructura formal: portada institucional, Resumen, I. Introducción, II. Objetivo general, III. Plataforma, IV. Evaluación de modelos de IA, V. Conclusiones, VI. Referencias.

Plataforma e IA son dos líneas de trabajo distintas y se presentan como capítulos autocontenidos de primera clase en lugar de forzarlas dentro de Materiales/Metodología/Resultados.

La fuente editable es markdown (`docs/informes/26_05_05_informe_4_unificado.md`); el `.docx` se genera con el compilador existente.

## Inputs / Data

Fuentes de las que se extrae contenido:

| Fuente | Qué se toma | Cómo se incorpora |
|--------|-------------|-------------------|
| `docs/informes/26_05_05_avance_de_desarrollo_v2.md` | Arquitectura, workers, TensorRT, fan-out, despliegue, incidencias, pendientes | Punto de partida del nuevo .md (ya copiado) |
| `docs/informes/25_01_01_informa_ia.docx` (extraído a `/tmp/informa_ia.md`) | Tabla 1/2/3 de métricas YoloV9/V10/V11, conclusiones del informe | Capítulo resumen de IA dentro de IV. Materiales y V. Resultados |
| `docs/diagrams/arquitectura_actual.png` | Diagrama vigente del sistema | Figura ya referenciada en el .md base |

## Behavior

Documento `.docx` legible para PROCIENCIA con:

- Portada institucional (banner UPAO, logo, código `PE5010-86701-2024-PROCIENCIA`, autores, fecha, "INFORME TECNICO #4").
- Resumen de una página que sintetiza qué se hizo en plataforma + IA y qué propone el informe.
- Capítulos numerados I–VI en romano: I. Introducción, II. Objetivo general, III. Plataforma, IV. Evaluación de modelos de IA, V. Conclusiones, VI. Referencias.
- Capítulo IV (IA) en versión resumen: solo modelos evaluados (V9/V10/V11), métricas obtenidas (mAP@0.5, mAP@0.5:0.95, F1, precisión, recall) con sus tablas, y la elección final con justificación. Sin teoría de arquitecturas (RepNCSPELAN, ADown, C2F, etc).
- Compila sin error con `node docs/informes/generate.js docs/informes/26_05_05_informe_4_unificado.md`.

## Decisions

- **Audiencia: PROCIENCIA formal.** El estilo institucional cambia el TOC respecto al avance v2 (que es técnico interno). El avance v2 sirve como insumo de contenido, no como esqueleto del documento.
- **IA en versión resumen, no en profundidad.** Existe un documento entero (informe #2) sobre la teoría de arquitecturas YOLO. Aquí solo van los modelos evaluados, sus métricas y la elección. El lector que quiera más profundidad consulta el informe #2.
- **Capítulos autocontenidos, no TOC PROCIENCIA estricto.** Plataforma e IA son dos líneas de trabajo distintas y se presentan como capítulos III y IV de primera clase. Forzarlas dentro de Materiales/Metodología/Resultados parte el contenido IA artificialmente. Se sale del TOC romano canónico de PROCIENCIA y se asume que la convocatoria acepta estructura formal de informe técnico sin exigir esos headings literales.
- **Compilador reutilizado.** Se usa `docs/informes/generate.js` actual, que ya soporta frontmatter, imágenes con aspect ratio nativo, y portada institucional. No requiere cambios.
- **El conflicto V9-vs-V11 se reconoce.** El informe #2 reportó mAP@0.5 máximo 0.8407 con YoloV9-Compact-200 épocas, pero el sistema actual usa YoloV11. La sección de elección final debe explicar el porqué (convergencia, soporte de tracker, mejoras de inferencia) en vez de reportar solo la métrica ganadora.
- **Fase del roadmap es Phase 17.** No es código — es producción de un entregable. El plan refleja extracción + reorganización + compilación, no implementación de software.

## Context

- See `spec/roadmap.md` Phase 17 — los 4 sub-bullets que esta fase expande.
- See `docs/informes/26_05_05_avance_de_desarrollo_v2.md` — estructura y tono del avance v2 (informativo, no PROCIENCIA).
- See `docs/informes/25_01_01_informa_ia.docx` — el informe #2 cuya información se resume aquí.
- Existing patterns to follow: el frontmatter YAML del avance v2 (`title`, `subtitle`, `version`, `author`, `date`, `location`, `month`, `project_quote`, `project_code`) — el compilador ya lo soporta y la portada se arma desde ahí.
