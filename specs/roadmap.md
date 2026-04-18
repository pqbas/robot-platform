# Roadmap — Robot Platform

## Calendario

| Semana | Enfoque |
|--------|---------|
| Semana 1 | Completar funcionalidades |
| Semana 2 | Pruebas en laboratorio |
| Semana 3 | Visita a fundo |

---

## Semana 1 — Funcionalidades

### Día 1: Bugs conocidos
- Bug 1: cámara no se libera al desconectarse físicamente — requiere `make restart`
- Bug 2: sesión de conteo queda activa al caer la cámara — bloquea nueva sesión hasta reiniciar

### Día 2: Grabación de video
- Nuevo modo "grabación" — guardar stream como MP4
- UI: selector de modo (conteo / grabación)

### Día 3: Nuevo método de conteo por similitud
- Integrar el método de similitud entre frames consecutivos al pipeline del worker
- Mantener ambos métodos disponibles (similitud + cruce de línea)

### Día 4: Deploy servidor central
- Instalar en PC del laboratorio
- Configurar PostgreSQL y acceso remoto
- Verificar sincronización robot → servidor

### Días 5-6: Validación end-to-end + UX modelo activo
- El robot muestra claramente qué modelo está corriendo
- Flujo completo: asignar modelo en servidor → robot descarga → worker carga → UI lo refleja
- Recorrer todos los flujos como operador y eliminar fricciones

---

## Semana 2 — Pruebas en laboratorio
- Pruebas end-to-end en condiciones controladas
- Validar conteo (ambos métodos)
- Validar grabación de video
- Validar sincronización robot → servidor
- Documentar resultados y ajustes

---

## Semana 3 — Visita a fundo
- Operación real en campo

---

## Pendiente (sin fecha)
- Asignación de modelos por dispositivo (Fase 8)
- Clasificación offline de frutos
- Mapa offline
- Cámara por red WiFi
- Evaluación y finetuning del modelo YOLO
- Agregar nuevos tipos de frutas al metodo de conteo/clasificacion


