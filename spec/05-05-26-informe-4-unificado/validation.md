# Validation: Informe técnico unificado #4 a PROCIENCIA

Fase lista para cerrar cuando todos los checks de abajo pasan.

## Automated Tests

- [ ] `node docs/informes/generate.js docs/informes/26_05_05_informe_4_unificado.md` exits 0 y crea el `.docx`.
- [ ] El `.docx` resultante existe en `docs/informes/26_05_05_informe_4_unificado.docx` con tamaño > 100 KB (sanity check de que no quedó vacío).

## Manual Checks

Sobre `docs/informes/26_05_05_informe_4_unificado.md`:

- [ ] Frontmatter define `version: "INFORME TECNICO 4"` y los campos `title`, `subtitle`, `author`, `date`, `location`, `month`, `project_quote`, `project_code` están presentes.
- [ ] El cuerpo del .md tiene exactamente los headings romanos: `# I. INTRODUCCIÓN`, `# II. OBJETIVO GENERAL`, `# III. PLATAFORMA`, `# IV. EVALUACIÓN DE MODELOS DE IA`, `# V. CONCLUSIONES`, `# VI. REFERENCIAS`.
- [ ] No quedan headings huérfanos de nivel 1 del avance v2 (`# I. DESCRIPCIÓN DEL SISTEMA`, `# VII. DESPLIEGUE`, `# VIII. INCIDENCIAS CONOCIDAS`, etc.) — el contenido fue absorbido como subsecciones de `# III. PLATAFORMA` o eliminado.
- [ ] Dentro de `# IV. EVALUACIÓN DE MODELOS DE IA` existe `## 4.1 Algoritmos evaluados` con YoloV9, YoloV10 y YoloV11 mencionados explícitamente.
- [ ] Dentro de `# IV.` existe `## 4.3 Resultados por modelo` con las tres tablas de métricas (V9, V10, V11) con valores numéricos transcritos del informe #2 — no como imagen embebida ni como placeholder.
- [ ] Dentro de `# IV.` existe `## 4.4 Modelo seleccionado` con la justificación de por qué YoloV11 a pesar de que V9 logró mayor mAP@0.5.
- [ ] La sección `# VI. REFERENCIAS` cita al menos los papers de YoloV9/V10/V11 y BoT-SORT en formato `Autor. (Año). Título. Fuente.`

Sobre `docs/informes/26_05_05_informe_4_unificado.docx` abierto en LibreOffice/Word:

- [ ] Portada renderiza con banner UPAO, logo, "INFORME TECNICO 4", autores y código `PE5010-86701-2024-PROCIENCIA`.
- [ ] El índice/TOC al inicio coincide con los headings I–VI del .md.
- [ ] Las tablas de métricas son legibles y no se cortan en el ancho de página.
- [ ] El diagrama de arquitectura (`docs/diagrams/arquitectura_actual.png`) aparece dentro de `# III. PLATAFORMA` y respeta su aspect ratio.

## Definition of Done

`26_05_05_informe_4_unificado.md` y su `.docx` están commiteados, el `.docx` se abre limpio en Word/LibreOffice con los seis capítulos romanos (I–VI), y el capítulo IV contiene las tres tablas de métricas con la elección de modelo justificada. Phase 17 marcada `(Complete)` en `spec/roadmap.md`.
