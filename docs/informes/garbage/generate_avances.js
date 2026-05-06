const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents,
  ImageRun,
} = require("docx");

// --- Cover images ---
const BANNER_PATH = "/home/pqbas/labinm/.assets/banner_upao.jpg";
const LOGO_PATH = "/home/pqbas/labinm/.assets/logo_upao.jpg";
const bannerImg = fs.existsSync(BANNER_PATH) ? fs.readFileSync(BANNER_PATH) : null;
const logoImg = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;

// --- Constants ---
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 9360

const FONT = "Arial";
const COLOR_PRIMARY = "1F4E79";
const COLOR_HEADER_BG = "D5E8F0";
const COLOR_GRAY = "666666";
const COLOR_GREEN = "2E7D32";
const COLOR_ORANGE = "E65100";

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// --- Helpers ---
function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 28, color: COLOR_PRIMARY })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 24 })],
  });
}

function heading3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 22, italics: true })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, font: FONT, size: 22, ...opts })],
  });
}

function paraRuns(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    children: runs.map(r =>
      typeof r === "string"
        ? new TextRun({ text: r, font: FONT, size: 22 })
        : new TextRun({ font: FONT, size: 22, ...r })
    ),
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

function bulletRuns(runs) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: runs.map(r =>
      typeof r === "string"
        ? new TextRun({ text: r, font: FONT, size: 22 })
        : new TextRun({ font: FONT, size: 22, ...r })
    ),
  });
}

let _numListCounter = 0;
const _numListConfigs = [];

function newNumberedList() {
  const ref = `numbers_${_numListCounter++}`;
  _numListConfigs.push({
    reference: ref,
    levels: [{
      level: 0, format: LevelFormat.DECIMAL, text: "%1.",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } },
    }],
  });
  return ref;
}

function numberedItem(ref, text) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

function numberedItemRuns(ref, runs) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: runs.map(r =>
      typeof r === "string"
        ? new TextRun({ text: r, font: FONT, size: 22 })
        : new TextRun({ font: FONT, size: 22, ...r })
    ),
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, font: FONT, size: 20 })],
    })],
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, size: 20, ...opts })],
    })],
  });
}

function tableCaption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}

// --- Pre-create numbered lists ---
const nResumen = newNumberedList();
const nFase1 = newNumberedList();
const nFase2 = newNumberedList();
const nFase3 = newNumberedList();
const nFase4 = newNumberedList();
const nFase5 = newNumberedList();
const nFase6 = newNumberedList();
const nFase7 = newNumberedList();
const nDesafios = newNumberedList();
const nPendiente = newNumberedList();
const nProximos = newNumberedList();

// --- Document ---
const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      ..._numListConfigs,
    ],
  },
  styles: {
    default: { document: { run: { font: FONT, size: 22, language: { value: "es-PE" } } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: COLOR_PRIMARY },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: FONT, italics: true },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  sections: [
    // ===================== PORTADA =====================
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: [
        ...(bannerImg ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "jpg", data: bannerImg,
            transformation: { width: 555, height: 36 },
            altText: { title: "Banner", description: "Banner UPAO", name: "banner" },
          })],
        })] : []),
        emptyLine(),
        ...(logoImg ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "jpg", data: logoImg,
            transformation: { width: 200, height: 85 },
            altText: { title: "Logo UPAO", description: "Logo Universidad", name: "logo" },
          })],
        })] : []),
        emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({
            text: "\"Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú\"",
            font: FONT, size: 22, italics: true, color: COLOR_GRAY,
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "PE5010-86701-2024-PROCIENCIA", font: FONT, size: 22, color: COLOR_GRAY })],
        }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "INFORME DE AVANCES DE DESARROLLO", font: FONT, size: 32, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "PLATAFORMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS", font: FONT, size: 26, bold: true, color: COLOR_PRIMARY })],
        }),
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Nombre del autor:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Percy Brayam Cubas Muñoz", font: FONT, size: 22 })] }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Fecha:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "7 de abril de 2026", font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Trujillo - Perú", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ABRIL - 2026", font: FONT, size: 22, bold: true })] }),
      ],
    },

    // ===================== ÍNDICE + CUERPO =====================
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_PRIMARY, space: 4 } },
            children: [new TextRun({ text: "Informe de Avances / Robot Platform", font: FONT, size: 18, color: COLOR_GRAY })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Página ", font: FONT, size: 18, color: COLOR_GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: COLOR_GRAY }),
            ],
          })],
        }),
      },
      children: [
        // --- ÍNDICE ---
        heading1("ÍNDICE"),
        new TableOfContents("Tabla de contenidos", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),

        // ============================================================
        // I. RESUMEN EJECUTIVO
        // ============================================================
        heading1("I. RESUMEN EJECUTIVO"),
        para("El presente informe documenta los avances realizados en el desarrollo de la plataforma de software para detección, conteo y clasificación de frutos en el robot móvil. El periodo abarca desde el 9 de febrero hasta el 7 de abril de 2026."),
        para("Durante este periodo se completaron siete de las nueve fases planificadas en el roadmap de desarrollo, logrando un sistema funcional e integrado que opera de manera autónoma en la computadora embebida (Jetson Xavier) del robot móvil. Los principales logros incluyen:"),
        numberedItem(nResumen, "Transmisión de video en tiempo real desde el robot hacia dispositivos móviles mediante WebRTC."),
        numberedItem(nResumen, "Detección y conteo automático de objetos utilizando modelos YOLO con tracking y cruce de línea."),
        numberedItem(nResumen, "Arquitectura de dos procesos (backend + inference worker) que resuelve incompatibilidades de PyTorch en la Jetson Xavier."),
        numberedItem(nResumen, "Sincronización bidireccional entre el robot y un servidor central para distribución de modelos y recolección de datos."),
        numberedItem(nResumen, "Sistema de autenticación con JWT para el servidor y API keys para los robots."),
        numberedItem(nResumen, "Frontend web responsive accesible desde celular, tablet o laptop."),
        numberedItem(nResumen, "Despliegue automatizado con nginx y systemd, con arranque automático al encender el robot."),
        emptyLine(),
        paraRuns([{ text: "Estado general: ", bold: true }, "el sistema se encuentra adelantado con respecto a la planificación original. Las fases 1 a 7 están completadas e integradas en el robot móvil."]),

        // ============================================================
        // II. ESTADO DE FASES
        // ============================================================
        heading1("II. ESTADO DE FASES"),
        para("La Tabla 1 presenta el estado actual de cada fase del cronograma de desarrollo, comparando lo planificado con lo ejecutado."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [600, 2800, 1600, 1600, 2760],
          rows: [
            new TableRow({ children: [
              headerCell("#", 600),
              headerCell("Fase", 2800),
              headerCell("Planificado", 1600),
              headerCell("Ejecutado", 1600),
              headerCell("Estado", 2760),
            ]}),
            new TableRow({ children: [
              cell("1", 600), cell("Desacoplamiento del pipeline", 2800),
              cell("Semana 1", 1600), cell("24 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("2", 600), cell("Base de datos e identidad", 2800),
              cell("Semana 2", 1600), cell("24 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("3", 600), cell("Sincronización", 2800),
              cell("Semana 3", 1600), cell("25 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("4", 600), cell("Autenticación", 2800),
              cell("Semana 4", 1600), cell("25 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("5", 600), cell("Frontend del servidor", 2800),
              cell("Semana 5", 1600), cell("26 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("6", 600), cell("Despliegue (nginx + systemd)", 2800),
              cell("Semana 7*", 1600), cell("28 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("7", 600), cell("Inference worker (nueva)", 2800),
              cell("No planificada", 1600), cell("28-31 mar", 1600),
              cell("Completado", 2760, { color: COLOR_GREEN, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("8", 600), cell("Asignación de modelos por dispositivo", 2800),
              cell("Semana 8", 1600), cell("—", 1600),
              cell("Pendiente", 2760, { color: COLOR_ORANGE, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("9", 600), cell("Clasificación offline", 2800),
              cell("Semana 6*", 1600), cell("—", 1600),
              cell("Pendiente", 2760, { color: COLOR_ORANGE, bold: true }),
            ]}),
            new TableRow({ children: [
              cell("—", 600), cell("Evaluación y finetuning YOLO", 2800),
              cell("Semana 9", 1600), cell("—", 1600),
              cell("Pendiente", 2760, { color: COLOR_ORANGE, bold: true }),
            ]}),
          ],
        }),
        tableCaption("TABLA 1. Estado de fases del cronograma de desarrollo. (*) El orden de ejecución fue reordenado por prioridad operativa."),

        paraRuns(["La ", { text: "Fase 7 (Inference Worker)", bold: true }, " no estaba planificada originalmente. Surgió como necesidad técnica al descubrir que PyTorch de NVIDIA para la Jetson Xavier solo es compatible con Python 3.8/3.10, mientras que el backend utiliza Python 3.13. La solución fue separar la inferencia en un proceso independiente que se comunica con el backend mediante un socket Unix."]),
        paraRuns(["La ", { text: "Fase 6 (Despliegue)", bold: true }, " se adelantó respecto al plan original (era Fase 7) porque resultó prioritario tener el sistema instalado y operativo en el robot antes de continuar con funcionalidades adicionales."]),

        // ============================================================
        // III. DETALLE DE AVANCES POR FASE
        // ============================================================
        heading1("III. DETALLE DE AVANCES POR FASE"),

        // --- Trabajo previo ---
        heading2("Trabajo previo al roadmap (9 - 27 de febrero)"),
        para("Antes de iniciar el cronograma formal, se desarrolló la base funcional de la plataforma:"),
        bullet("Backend FastAPI con API REST para sesiones de conteo, configuración y ubicaciones."),
        bullet("Frontend React con TypeScript, Tailwind CSS y componentes shadcn/ui."),
        bullet("Detección de objetos con YOLO y tracking mediante BotSort, con conteo por cruce de línea."),
        bullet("Transmisión de video en tiempo real mediante WebRTC con codificación H.264 por hardware (NVENC)."),
        bullet("Módulos de dashboard, mapa con Google Maps y visión con controles de conteo."),
        bullet("Interfaz responsive para dispositivos móviles."),
        emptyLine(),
        para("Este trabajo constituyó el punto de partida sobre el cual se ejecutó el roadmap."),

        // --- Fase 1 ---
        heading2("Fase 1: Desacoplamiento del pipeline"),
        paraRuns([{ text: "Fecha: ", bold: true }, "24 de marzo de 2026 — ", { text: "PR #1", color: COLOR_PRIMARY }]),
        para("Se separó la inferencia YOLO del pipeline de video en hilos independientes, de modo que la falla o lentitud de YOLO no interrumpe la transmisión de video."),
        heading3("Resultados"),
        numberedItem(nFase1, "El streaming de video funciona de manera independiente a YOLO."),
        numberedItem(nFase1, "Si YOLO presenta lentitud, el stream continúa sin interrupciones."),
        numberedItem(nFase1, "Se agregaron contadores de FPS en tiempo real para stream e inferencia."),

        // --- Fase 2 ---
        heading2("Fase 2: Base de datos e identidad"),
        paraRuns([{ text: "Fecha: ", bold: true }, "24 de marzo de 2026 — ", { text: "PRs #2, #3, #4, #5, #6", color: COLOR_PRIMARY }]),
        para("Se incorporaron UUIDs, identificación de dispositivos y los modelos de dominio necesarios para operación multi-robot y sincronización."),
        heading3("Cambios implementados"),
        numberedItem(nFase2, "Campos uuid y device_id en todos los modelos de datos existentes."),
        numberedItem(nFase2, "Modelos de dominio: Empresa, Fundo, FruitType, DetectionModel, Device y User."),
        numberedItem(nFase2, "Modelos de captura: CaptureBurst, CaptureFrame, FrameDetection con track_id para identidad de frutos entre frames."),
        numberedItem(nFase2, "Configuración por modo (robot/server) mediante variables de entorno."),
        numberedItem(nFase2, "Soporte dual de base de datos: SQLite para el robot y PostgreSQL para el servidor."),

        // --- Fase 3 ---
        heading2("Fase 3: Protocolo de sincronización"),
        paraRuns([{ text: "Fecha: ", bold: true }, "25 de marzo de 2026 — ", { text: "PRs #7, #8, #9", color: COLOR_PRIMARY }]),
        para("Se implementó la sincronización bidireccional que permite al robot enviar datos al servidor y descargar modelos actualizados de manera automática."),
        heading3("Componentes implementados"),
        numberedItem(nFase3, "Infraestructura de sincronización: SyncLog para trazabilidad, modelo de comandos remotos, endpoint de health y loop de sincronización en background."),
        numberedItem(nFase3, "Sync push: el robot envía sesiones, eventos, camellones y ubicaciones al servidor con deduplicación por UUID."),
        numberedItem(nFase3, "Sync pull: el robot descarga modelos YOLO activos desde el servidor y los almacena localmente."),
        numberedItem(nFase3, "Ciclo de sincronización automático cada 30 segundos cuando el robot tiene conectividad."),

        // --- Fase 4 ---
        heading2("Fase 4: Sistema de autenticación"),
        paraRuns([{ text: "Fecha: ", bold: true }, "25 de marzo de 2026 — ", { text: "PRs #10, #11, #12, #13", color: COLOR_PRIMARY }]),
        para("Se implementó autenticación completa para proteger los endpoints del servidor y la sincronización."),
        heading3("Componentes implementados"),
        numberedItem(nFase4, "Servicio de autenticación con hash de contraseñas (bcrypt), generación de JWT y verificación de API keys."),
        numberedItem(nFase4, "Endpoints de login, perfil de usuario y seed de administrador en el primer arranque."),
        numberedItem(nFase4, "Rutas CRUD administrativas para gestión de usuarios, empresas, fundos, tipos de fruta y modelos de detección."),
        numberedItem(nFase4, "Protección de endpoints de sincronización mediante API key de dispositivo."),
        numberedItem(nFase4, "Dos roles de usuario: administrador (acceso total) y viewer (filtrado por empresa)."),

        // --- Fase 5 ---
        heading2("Fase 5: Frontend del servidor"),
        paraRuns([{ text: "Fecha: ", bold: true }, "26 de marzo de 2026 — ", { text: "PRs #14, #15, #16, #17", color: COLOR_PRIMARY }]),
        para("Se desarrolló la interfaz web del servidor con autenticación, rutas protegidas y páginas de administración diferenciadas por rol."),
        heading3("Componentes implementados"),
        numberedItem(nFase5, "Detección automática de modo (robot/server) e infraestructura de autenticación en el frontend."),
        numberedItem(nFase5, "Página de login con persistencia de sesión y manejo de expiración de token."),
        numberedItem(nFase5, "Páginas CRUD de administración: Usuarios, Empresas, Fundos (con asociación de empresa y ubicación en mapa)."),
        numberedItem(nFase5, "Páginas CRUD de administración: Dispositivos (con generación de API key) y Modelos de Detección (con carga de archivos .pt)."),
        numberedItem(nFase5, "Sidebar adaptativo según el modo y rol del usuario."),

        // --- Fase 6 ---
        heading2("Fase 6: Despliegue en producción"),
        paraRuns([{ text: "Fecha: ", bold: true }, "28 de marzo de 2026 — ", { text: "PRs #18, #19", color: COLOR_PRIMARY }]),
        para("Se implementó la infraestructura de despliegue para instalar el sistema en el robot y en el servidor del laboratorio, utilizando nginx como proxy inverso y systemd para gestión de servicios."),
        heading3("Infraestructura implementada"),
        numberedItem(nFase6, "Script de instalación (install.sh) que configura automáticamente el entorno para modo robot o servidor."),
        numberedItem(nFase6, "Configuración de nginx: proxy inverso hacia el backend, servicio de archivos estáticos del frontend, soporte para WebRTC y límite de carga de 200 MB."),
        numberedItem(nFase6, "Servicio systemd con arranque automático y reinicio ante fallos."),
        numberedItem(nFase6, "Makefile con targets de producción: deploy-robot, deploy-server, restart, status, logs y update."),
        numberedItem(nFase6, "Página de configuración inicial para el robot (Server URL, Device ID, API Key)."),
        numberedItem(nFase6, "Target make update para actualizar el sistema desde el repositorio sin reinstalar."),
        heading3("Resultado"),
        para("El robot arranca automáticamente al encender la Jetson. El operador se conecta al WiFi del robot, abre el navegador y accede a la interfaz web sin necesidad de configuración adicional."),

        // --- Fase 7 ---
        heading2("Fase 7: Inference worker (fase nueva)"),
        paraRuns([{ text: "Fecha: ", bold: true }, "28 - 31 de marzo de 2026 — ", { text: "PRs #20 a #30", color: COLOR_PRIMARY }]),
        para("Esta fase no estaba planificada originalmente. Surgió al descubrir que PyTorch de NVIDIA para la Jetson Xavier (JetPack 5.1) solo proporciona wheels para Python 3.8 y 3.10, mientras que el backend utiliza Python 3.13. La solución fue separar la inferencia YOLO en un proceso independiente."),
        heading3("Arquitectura de dos procesos"),
        para("El sistema ahora opera con dos procesos independientes en el robot:"),
        bulletRuns([{ text: "Backend (Python 3.13): ", bold: true }, "FastAPI, WebRTC, API REST, sincronización. No importa PyTorch ni ultralytics."]),
        bulletRuns([{ text: "Inference Worker (Python 3.10): ", bold: true }, "YOLO con ultralytics y PyTorch CUDA. Se comunica con el backend mediante socket Unix."]),
        heading3("Protocolo de comunicación"),
        para("Se implementó un protocolo length-prefixed sobre socket Unix (/tmp/inference.sock):"),
        bulletRuns([{ text: "Detección: ", bold: true }, "el backend envía un frame JPEG con metadatos (línea de conteo, ID de modelo) y recibe un JSON con las detecciones y datos de tracking."]),
        bulletRuns([{ text: "Comandos: ", bold: true }, "el backend puede enviar comandos de control al worker, como reload_model para cambiar el modelo sin reiniciar el proceso, o status para consultar el modelo activo."]),
        heading3("Cambios adicionales"),
        numberedItem(nFase7, "ObjectCounter refactorizado para usar diccionarios simples en lugar de tensores de PyTorch."),
        numberedItem(nFase7, "Eliminación de dependencias problemáticas (pyzed para ARM, lap no declarado)."),
        numberedItem(nFase7, "Soporte para PyTorch de NVIDIA en la Jetson usando --system-site-packages."),
        numberedItem(nFase7, "Servicio systemd para el inference worker (inference-worker.service)."),
        numberedItem(nFase7, "Simplificación del esquema de modelos: se eliminó FruitType y se reemplazó por class_mapping JSON en DetectionModel."),
        numberedItem(nFase7, "Comando reload_model para actualizar el modelo YOLO sin reiniciar el worker."),
        numberedItem(nFase7, "Corrección de la sincronización para usar rutas absolutas al recargar modelos."),

        // ============================================================
        // IV. ARQUITECTURA ACTUAL
        // ============================================================
        heading1("IV. ARQUITECTURA ACTUAL DEL SISTEMA"),
        para("El sistema opera con un único codebase cuyo comportamiento se diferencia mediante la variable de entorno ROBOT_MODE. La Tabla 2 resume los componentes de cada modo."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Robot (Jetson Xavier)", 4680), headerCell("Servidor (PC del Lab)", 4680)] }),
            new TableRow({ children: [cell("ROBOT_MODE=robot", 4680), cell("ROBOT_MODE=server", 4680)] }),
            new TableRow({ children: [cell("SQLite", 4680), cell("PostgreSQL", 4680)] }),
            new TableRow({ children: [cell("Inference Worker (Python 3.10 + CUDA)", 4680), cell("Autenticación JWT + roles", 4680)] }),
            new TableRow({ children: [cell("WebRTC streaming", 4680), cell("Administración de modelos", 4680)] }),
            new TableRow({ children: [cell("Backend (Python 3.13) via Unix socket", 4680), cell("Recepción de sincronización", 4680)] }),
            new TableRow({ children: [cell("Sync push/pull automático", 4680), cell("Distribución de modelos YOLO", 4680)] }),
            new TableRow({ children: [cell("nginx + systemd", 4680), cell("nginx + systemd", 4680)] }),
          ],
        }),
        tableCaption("TABLA 2. Componentes actuales por modo de operación."),

        heading2("Stack tecnológico"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2800, 6560],
          rows: [
            new TableRow({ children: [headerCell("Componente", 2800), headerCell("Tecnología", 6560)] }),
            new TableRow({ children: [cell("Backend", 2800), cell("FastAPI, Python 3.13, SQLAlchemy, Alembic", 6560)] }),
            new TableRow({ children: [cell("Inference", 2800), cell("Python 3.10, ultralytics (YOLO), PyTorch CUDA, BotSort", 6560)] }),
            new TableRow({ children: [cell("Frontend", 2800), cell("React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui", 6560)] }),
            new TableRow({ children: [cell("Streaming", 2800), cell("WebRTC con aiortc, H.264 NVENC (hardware)", 6560)] }),
            new TableRow({ children: [cell("Base de datos", 2800), cell("SQLite (robot), PostgreSQL (servidor)", 6560)] }),
            new TableRow({ children: [cell("Deploy", 2800), cell("nginx, systemd, uv (gestión de dependencias Python)", 6560)] }),
            new TableRow({ children: [cell("Comunicación interna", 2800), cell("Socket Unix con protocolo length-prefixed", 6560)] }),
          ],
        }),
        tableCaption("TABLA 3. Stack tecnológico de la plataforma."),

        // ============================================================
        // V. MÉTRICAS DE DESARROLLO
        // ============================================================
        heading1("V. MÉTRICAS DE DESARROLLO"),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Métrica", 4680), headerCell("Valor", 4680)] }),
            new TableRow({ children: [cell("Pull requests creados y mergeados", 4680), cell("30", 4680)] }),
            new TableRow({ children: [cell("Periodo de desarrollo (roadmap)", 4680), cell("24 mar - 31 mar (8 días)", 4680)] }),
            new TableRow({ children: [cell("Fases completadas", 4680), cell("7 de 9 planificadas + 1 no planificada", 4680)] }),
            new TableRow({ children: [cell("Sistema desplegado en robot", 4680), cell("Sí (Jetson Xavier)", 4680)] }),
            new TableRow({ children: [cell("Sistema desplegado en servidor", 4680), cell("Sí (PC laboratorio)", 4680)] }),
          ],
        }),
        tableCaption("TABLA 4. Métricas de desarrollo del periodo."),

        // ============================================================
        // VI. DESAFÍOS TÉCNICOS
        // ============================================================
        heading1("VI. DESAFÍOS TÉCNICOS Y SOLUCIONES"),

        heading2("Incompatibilidad de PyTorch en Jetson Xavier"),
        paraRuns([{ text: "Problema: ", bold: true }, "PyTorch de NVIDIA (con soporte CUDA) para la Jetson Xavier solo está disponible para Python 3.8 y 3.10. El backend de la plataforma utiliza Python 3.13 para aprovechar las últimas versiones de FastAPI y sus dependencias."]),
        paraRuns([{ text: "Solución: ", bold: true }, "Se separó la inferencia en un proceso independiente (inference worker) con su propio entorno virtual en Python 3.10, utilizando --system-site-packages para acceder al PyTorch preinstalado por NVIDIA. La comunicación entre procesos se realiza mediante socket Unix con un protocolo binario length-prefixed."]),
        paraRuns([{ text: "Impacto: ", bold: true }, "esta decisión arquitectónica, aunque no planificada, resultó ser la solución adoptada por empresas del sector para escenarios similares de compatibilidad entre frameworks de ML y aplicaciones web."]),

        heading2("Recarga de modelos sin reinicio"),
        paraRuns([{ text: "Problema: ", bold: true }, "al sincronizar un nuevo modelo YOLO desde el servidor, era necesario reiniciar el inference worker manualmente para que utilice el nuevo modelo."]),
        paraRuns([{ text: "Solución: ", bold: true }, "se implementó un comando reload_model en el protocolo de socket Unix que permite al backend indicar al worker que cargue un nuevo modelo sin reiniciar el proceso. El worker responde con confirmación o error."]),

        heading2("Rutas de archivos entre procesos"),
        paraRuns([{ text: "Problema: ", bold: true }, "el backend enviaba rutas relativas al worker para recargar modelos, pero el worker ejecuta desde un directorio diferente (/opt/robot-platform/inference/), causando errores de archivo no encontrado."]),
        paraRuns([{ text: "Solución: ", bold: true }, "se utilizó Path.resolve() para convertir las rutas a absolutas antes de enviarlas al worker."]),

        // ============================================================
        // VII. FUNCIONALIDADES PENDIENTES
        // ============================================================
        heading1("VII. FUNCIONALIDADES PENDIENTES"),

        heading2("Fase 8: Asignación de modelos por dispositivo"),
        para("Actualmente todos los robots descargan el mismo modelo activo del servidor. Esta fase permitirá asignar modelos específicos a cada robot según el tipo de fruta del fundo donde operará."),
        bullet("Modelo de asignación: relación Device-DetectionModel con fecha de asignación."),
        bullet("Interfaz de administración para asignar modelos a dispositivos."),
        bullet("Modificación del protocolo de sincronización para descargar solo el modelo asignado."),

        heading2("Fase 9: Clasificación offline"),
        para("Pipeline post-sesión para clasificar frutos individuales detectados durante el conteo. Incluye extracción de crops por fruto único (mejor frame por track_id), modelo de clasificación independiente de YOLO (madurez, calidad, variedad) y galería de resultados en el frontend."),

        heading2("Evaluación y finetuning YOLO"),
        para("Validación del modelo en sesiones de conteo reales, documentación de métricas de precisión y reentrenamiento si es necesario."),

        heading2("Soporte de mapa offline"),
        para("Actualmente el módulo de mapa depende de conexión a internet para cargar los tiles de Google Maps. Para la operación en campo sin conectividad, se requiere implementar la descarga previa de tiles al robot y la visualización offline del mapa."),

        heading2("Transmisión de video por red local"),
        para("Actualmente la cámara se conecta al robot por USB y el backend captura frames directamente del dispositivo de video. Por restricciones futuras de hardware, se requiere soportar la recepción de frames por red local (no internet), donde la cámara transmite las imágenes al robot a través de la red WiFi interna."),

        // ============================================================
        // VIII. INCIDENCIAS DETECTADAS EN INTEGRACIÓN
        // ============================================================
        heading1("VIII. INCIDENCIAS DETECTADAS EN INTEGRACIÓN"),
        para("Durante las pruebas de integración en el robot móvil se identificaron las siguientes incidencias que requieren corrección."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [600, 2600, 3200, 2960],
          rows: [
            new TableRow({ children: [
              headerCell("#", 600),
              headerCell("Incidencia", 2600),
              headerCell("Descripción", 3200),
              headerCell("Impacto", 2960),
            ]}),
            new TableRow({ children: [
              cell("1", 600),
              cell("Cámara no se libera al desconectarse", 2600),
              cell("Si la cámara se desconecta físicamente durante la operación, el proceso del backend mantiene el recurso de video ocupado. Es necesario reiniciar manualmente el servicio para poder volver a utilizar la cámara.", 3200),
              cell("El operador debe ejecutar make restart para recuperar el acceso a la cámara, interrumpiendo la operación.", 2960),
            ]}),
            new TableRow({ children: [
              cell("2", 600),
              cell("Sesión de conteo no se cierra correctamente", 2600),
              cell("Al desconectar la cámara desde el frontend, la sesión de conteo parece cerrarse visualmente pero permanece activa internamente. Al reconectar e intentar iniciar una nueva sesión, el sistema indica que la sesión anterior no ha finalizado.", 3200),
              cell("El operador no puede iniciar una nueva sesión de conteo sin intervención manual en el backend.", 2960),
            ]}),
          ],
        }),
        tableCaption("TABLA 6. Incidencias detectadas durante la integración en el robot."),

        para("Estas incidencias son características de la etapa de integración en hardware real, donde las condiciones de operación (desconexiones físicas, interrupciones de red) no se presentan en el entorno de desarrollo. Su corrección se abordará de manera prioritaria en las próximas iteraciones."),

        // ============================================================
        // IX. ESTADO ACTUAL Y DEMOSTRACIÓN
        // ============================================================
        heading1("IX. ESTADO ACTUAL Y DEMOSTRACIÓN"),
        para("El sistema se encuentra instalado y operativo en el robot móvil (Jetson Xavier). Para verificar el funcionamiento, se requieren los siguientes pasos:"),
        numberedItem(nProximos, "Encender el robot. Los servicios (backend e inference worker) arrancan automáticamente."),
        numberedItem(nProximos, "Conectarse a la red WiFi del robot desde un celular, tablet o laptop."),
        numberedItem(nProximos, "Abrir un navegador web y acceder a la dirección IP del robot en el puerto 8080 (http://<IP>:8080)."),
        numberedItem(nProximos, "Seleccionar un fundo y camellón desde la interfaz."),
        numberedItem(nProximos, "Iniciar una sesión de conteo para visualizar las detecciones en tiempo real."),
        emptyLine(),
        para("El sistema también permite gestión remota desde el servidor del laboratorio, donde el administrador puede subir modelos, gestionar empresas y fundos, y visualizar los datos sincronizados desde los robots."),
        emptyLine(),
        heading3("Comandos de operación del robot"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3200, 6160],
          rows: [
            new TableRow({ children: [headerCell("Comando", 3200), headerCell("Descripción", 6160)] }),
            new TableRow({ children: [cell("make status", 3200), cell("Ver estado de los servicios", 6160)] }),
            new TableRow({ children: [cell("make restart", 3200), cell("Reiniciar backend e inference worker", 6160)] }),
            new TableRow({ children: [cell("make logs", 3200), cell("Ver logs del backend en tiempo real", 6160)] }),
            new TableRow({ children: [cell("make logs-inference", 3200), cell("Ver logs del inference worker", 6160)] }),
            new TableRow({ children: [cell("make update", 3200), cell("Actualizar desde repositorio, compilar y reiniciar", 6160)] }),
          ],
        }),
        tableCaption("TABLA 7. Comandos de operación del robot en producción."),
      ],
    },
  ],
});

// --- Generate ---
const OUTPUT = "/home/pqbas/labinm/robot-platform/docs/roadmap/informe_avances.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Generated: ${OUTPUT}`);
});
