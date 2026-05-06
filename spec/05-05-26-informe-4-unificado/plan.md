# Plan: Informe técnico unificado #4 a PROCIENCIA

## Group 1: Reestructurar el esqueleto

1. Editar el frontmatter de `docs/informes/26_05_05_informe_4_unificado.md`:
   - `title`: `"DOCUMENTACIÓN TÉCNICA Y EVALUACIÓN DE ALGORITMOS DE IA"` (o el que defina el equipo)
   - `subtitle`: `"SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS"`
   - `version`: `"INFORME TECNICO 4"`
   - `author`, `date`, `location`, `month`, `project_quote`, `project_code` ya están en el v2; conservar valores.

2. Reemplazar el cuerpo del .md por el TOC nuevo. Capítulos autocontenidos:
   - `# I. INTRODUCCIÓN` (nuevo — redactar desde `## Visión general` del v2 + contexto del proyecto)
   - `# II. OBJETIVO GENERAL` (nuevo — un párrafo)
   - `# III. PLATAFORMA` (absorbe el contenido técnico del avance v2: arquitectura por procesos, workers, TensorRT, fan-out de cámara, despliegue, incidencias resueltas, optimizaciones)
   - `# IV. EVALUACIÓN DE MODELOS DE IA` (capítulo nuevo, ver Group 2)
   - `# V. CONCLUSIONES` (nuevo — síntesis plataforma + IA + recomendaciones)
   - `# VI. REFERENCIAS` (nuevo — citas del texto)
   - Anexos (Stack tecnológico, Modelo de datos) van al final si conviene.

3. Confirmar que los headings del avance v2 (`# I. DESCRIPCIÓN DEL SISTEMA`, `# VII. DESPLIEGUE`, `# VIII. INCIDENCIAS`, etc.) fueron absorbidos dentro de `# III. PLATAFORMA` como subsecciones (`## Arquitectura por procesos`, `## Workers`, `## TensorRT`, `## Despliegue`, `## Incidencias resueltas`) o eliminados explícitamente. No deben quedar headings huérfanos de nivel 1.

---

## Group 2: Capítulo IV. Evaluación de modelos de IA (versión resumen)

4. Crear `## 4.1 Algoritmos evaluados`:
   - Listar los tres modelos: YoloV9, YoloV10, YoloV11.
   - Una línea por cada uno: año/equipo, contribución técnica clave en una oración.
   - Mencionar el dataset (800 imágenes de arándanos del fundo Danper, etiquetado manual) y los hiperparámetros barridos (backbone Nano/Small/Medium/Large; épocas 50/100/150/200).

5. Crear `## 4.2 Métricas de evaluación`:
   - Tabla con la definición en una línea de cada métrica: mAP@0.5, mAP@0.5:0.95, F1-score, precisión, recall.

6. Crear `## 4.3 Resultados por modelo`:
   - Reproducir las tres tablas del informe #2 (Tabla 1 YoloV9, Tabla 2 YoloV10, Tabla 3 YoloV11) en formato markdown. Si el extracto pandoc en `/tmp/informa_ia.md` no recuperó los valores numéricos (vienen como imágenes embebidas en el .docx original), abrir `docs/informes/25_01_01_informa_ia.docx` con LibreOffice o `pandoc --extract-media` y transcribir manualmente los valores de las imágenes `image30.png`, `image18.png`, `image11.png`.
   - Bajo cada tabla, una oración con el patrón observado (ej: V9 muestra sobreajuste en backbones Tiny/Small/Medium después de 100 épocas; V11 muestra convergencia zigzagueante).

7. Crear `## 4.4 Modelo seleccionado`:
   - Reportar mAP@0.5 máximo de cada modelo y su configuración.
   - Justificar la elección de YoloV11 a pesar de que YoloV9 obtuvo el mAP máximo. Razones: estabilidad del entrenamiento, soporte del tracker (BoT-SORT), facilidad de exportación a TensorRT (ver capítulo III), comunidad y mantenimiento del repo Ultralytics.

---

## Group 3: Conclusiones, referencias y portada

8. Redactar `# V. CONCLUSIONES` con tres bullets:
   - Hallazgo principal de plataforma (arquitectura por procesos sostiene live + recording + inferencia sin regresión, TensorRT FP16 entrega 1.3× speedup actual).
   - Hallazgo principal de IA (modelos evaluados, modelo seleccionado y mAP obtenido en producción).
   - Recomendación / próximos pasos (Phase 16 reduce overhead de wrapper, Phase 13 despliega servidor central).

9. Llenar `# VI. REFERENCIAS` con las citas que aparezcan en el texto (formato `Autor. (Año). Título. Fuente.`). Como mínimo: papers de YoloV9, V10, V11 y BoT-SORT — extraer del informe #2 si ya estaban citados ahí.

10. Verificar que la portada institucional renderiza con `version: "INFORME TECNICO 4"`. El compilador toma `version` del frontmatter; si la plantilla de portada tiene "Avance N" hardcodeado, ajustarlo en `docs/informes/generate.js` (buscar el bloque que arma la portada).

---

## Group 4: Compilar y validar

11. Compilar: `cd docs/informes && node generate.js 26_05_05_informe_4_unificado.md`. Confirma que genera `26_05_05_informe_4_unificado.docx` sin errores.

12. Abrir el `.docx` en LibreOffice y verificar:
    - Portada con título correcto y "INFORME TECNICO 4".
    - TOC con secciones I–VI más anexos.
    - Tablas de métricas legibles, no cortadas.
    - Imágenes (diagrama de arquitectura, figuras de detección) respetan ratio.

13. Commitear `docs/informes/26_05_05_informe_4_unificado.md` y el `.docx` generado. Mensaje: `docs(informe-4): unificar plataforma + IA en informe formal a PROCIENCIA`.
