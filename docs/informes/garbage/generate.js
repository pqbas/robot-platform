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

function cell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, size: 20 })],
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

// --- Document ---
const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
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
    // ===================== COVER PAGE =====================
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: [
        // Banner
        ...(bannerImg ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "jpg", data: bannerImg,
            transformation: { width: 555, height: 36 },
            altText: { title: "Banner", description: "Banner UPAO", name: "banner" },
          })],
        })] : []),
        emptyLine(),
        // Logo
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
          children: [new TextRun({ text: "INFORME TECNICO", font: FONT, size: 36, bold: true, color: COLOR_PRIMARY })],
        }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({
            text: "\"Plataforma de software para la visualización, detección y conteo de frutos en tiempo real mediante streaming WebRTC\"",
            font: FONT, size: 26, bold: true,
          })],
        }),
        emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Nombre del autor:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Percy Brayam Cubas Muñoz", font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Trujillo - Perú", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MARZO - 2025", font: FONT, size: 22, bold: true })] }),
      ],
    },

    // ===================== TOC + BODY =====================
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
            children: [new TextRun({ text: "Informe Técnico / Plataforma de Software", font: FONT, size: 18, color: COLOR_GRAY })],
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

        // --- RESUMEN ---
        heading1("RESUMEN"),
        paraRuns(["El presente informe describe la arquitectura y las tecnologías empleadas en el desarrollo de la plataforma de software del Laboratorio de Investigación y Robótica LABINM para el sistema robótico de conteo de frutos en entornos agrícolas. Se desarrolló un ", { text: "backend", italics: true }, " basado en FastAPI que gestiona la transmisión de video mediante WebRTC, la inferencia de detección de objetos con YOLO, el conteo mediante cruce de línea y la persistencia de sesiones en base de datos SQLite. De forma complementaria, se desarrolló un ", { text: "frontend", italics: true }, " web con React 19, TypeScript y Tailwind CSS, y un sistema de codificación de video por hardware (NVENC) que emplea PyAV/FFmpeg en escritorio y GStreamer en Jetson Xavier."]),
        para("Las secciones siguientes detallan la arquitectura, los componentes técnicos, las tecnologías empleadas y los resultados obtenidos durante las pruebas de validación en entorno de desarrollo."),
        new Paragraph({ children: [new PageBreak()] }),

        // --- I. INTRODUCCIÓN ---
        heading1("I. INTRODUCCIÓN"),
        paraRuns(["En el contexto del desarrollo de un sistema robótico para el conteo automatizado de frutos en fundos agrícolas, se requiere una plataforma de software capaz de coordinar múltiples subsistemas: captura de video, transmisión en tiempo real, detección de objetos, seguimiento, conteo, almacenamiento de datos y visualización. Cada uno de estos subsistemas debe operar de manera coordinada y con la menor latencia posible para permitir la operación en campo. En concreto, la latencia de codificación de video por software puede alcanzar 20 a 50 ms por ", { text: "frame", italics: true }, ", lo que afecta la fluidez de la transmisión."]),
        paraRuns(["En sistemas robóticos convencionales, la gestión de sensores y la transmisión de imágenes se delega al ", { text: "framework", italics: true }, " ROS (", { text: "Robot Operating System", italics: true }, "), que actúa como intermediario entre la cámara y los módulos de procesamiento. Esta dependencia introduce latencia adicional en el flujo de video, debido a la serialización de mensajes, la gestión de colas internas y las capas de abstracción propias de ROS. Ante esta situación, se optó por desarrollar una plataforma independiente que accede directamente al dispositivo de captura y transmite el video sin intermediarios, reduciendo así la latencia del sistema."]),
        paraRuns(["El Informe Técnico #2 estableció que el modelo YOLOv9 Medium con 50 épocas de entrenamiento y un ", { text: "confidence threshold", italics: true }, " en el rango [0.3, 0.4] presenta el mejor desempeño para el conteo de frutos (Cubas Muñoz, 2025). A partir de dicho resultado, el presente informe aborda el desarrollo de la plataforma de software diseñada para incorporar este modelo. Las actividades comprenden la transmisión de video en tiempo real desde la cámara ZED 2i mediante WebRTC, la detección y conteo en cada ", { text: "frame", italics: true }, " utilizando YOLO y BotSort, la gestión de sesiones con persistencia en base de datos, la codificación por hardware H.264 NVENC, y el desarrollo de la interfaz web para operadores."]),
        para("La plataforma está diseñada para ejecutarse sobre la computadora Jetson Xavier del robot móvil. No obstante, durante la fase de desarrollo las pruebas se han realizado en un equipo de escritorio con GPU NVIDIA, siendo accesible desde cualquier dispositivo conectado a la misma red local."),

        // --- II. OBJETIVO GENERAL ---
        heading1("II. OBJETIVO GENERAL"),
        paraRuns(["Desarrollar una plataforma de software que permita la visualización, detección y conteo de frutos en tiempo real, mediante ", { text: "streaming", italics: true }, " WebRTC, inferencia con modelos YOLO y codificación de video por hardware, accesible desde una interfaz web."]),

        // --- III. MARCO TEÓRICO ---
        heading1("III. MARCO TEÓRICO"),
        heading2("1. WebRTC"),
        paraRuns(["WebRTC (", { text: "Web Real-Time Communication", italics: true }, ") es un estándar abierto que permite la transmisión de video, audio y datos entre navegadores y servidores sin necesidad de ", { text: "plugins", italics: true }, " adicionales. La conexión se establece mediante un intercambio de descriptores SDP (", { text: "Session Description Protocol", italics: true }, ") y una negociación ICE (", { text: "Interactive Connectivity Establishment", italics: true }, ") que determina la ruta de red óptima entre los pares."]),

        heading2("2. Codificación H.264 y NVENC"),
        paraRuns(["H.264 es un estándar de compresión de video que reduce el ancho de banda necesario para la transmisión. La codificación por software (libx264) utiliza la CPU, mientras que NVENC (", { text: "NVIDIA Video Encoder", italics: true }, ") emplea el hardware dedicado de las GPUs NVIDIA para realizar la misma tarea con menor latencia y menor consumo de CPU (NVIDIA Corporation, 2024)."]),

        heading2("3. Detección y Seguimiento de Objetos"),
        paraRuns(["YOLO (", { text: "You Only Look Once", italics: true }, ") es una familia de modelos de detección de objetos que procesa la imagen completa en una sola pasada, lo que permite operar en tiempo real (Ultralytics, 2024). BotSort es un algoritmo de seguimiento multi-objeto que combina la Transformada de Kalman con características visuales aprendidas para asignar identificadores persistentes a los objetos detectados a lo largo de ", { text: "frames", italics: true }, " consecutivos (Aharon et al., 2022)."]),

        // --- IV. METODOLOGÍA ---
        heading1("IV. METODOLOGÍA"),
        para("Para lograr el objetivo general se realizaron las siguientes actividades."),
        paraRuns(["Se diseñó la arquitectura cliente-servidor con separación de responsabilidades entre ", { text: "backend", italics: true }, " (FastAPI) y ", { text: "frontend", italics: true }, " web (React). Se implementó el ", { text: "pipeline", italics: true }, " de transmisión de video mediante WebRTC, con captura desde la cámara ZED 2i, codificación H.264 y transmisión con baja latencia. Se incorporó la detección de objetos (YOLO) y seguimiento (BotSort) dentro del ", { text: "pipeline", italics: true }, " de transmisión, con envío de metadatos a través de canales de datos WebRTC."]),
        para("Se desarrolló un sistema de codificación por hardware con auto-detección de plataforma: PyAV para escritorio NVIDIA y GStreamer para Jetson Xavier. Se implementó la gestión de sesiones de conteo con persistencia en SQLite, incluyendo la agrupación por camellones y la exportación en formato CSV."),
        paraRuns(["Se desarrolló el ", { text: "frontend", italics: true }, " web con módulos de visión, mapa interactivo con Google Maps y panel de estadísticas."]),

        // --- V. MATERIALES ---
        heading1("V. MATERIALES"),

        // 1. Arquitectura General
        heading2("1. Arquitectura General"),
        para("La plataforma se estructura en dos capas principales que se comunican a través de protocolos HTTP y WebRTC sobre la red local del robot. La Tabla 1 resume las tecnologías empleadas en cada componente."),
        paraRuns(["El ", { text: "backend", italics: true }, " se desarrolló con FastAPI (Python 3.13) y se ejecuta como servidor asíncrono en el puerto 8080. Gestiona la captura de video, el procesamiento de inferencia, la transmisión WebRTC, la lógica de conteo y la API REST."]),
        paraRuns(["El ", { text: "frontend", italics: true }, " web es una aplicación de página única desarrollada con React 19 y TypeScript. En desarrollo se sirve mediante Vite con un proxy hacia el ", { text: "backend", italics: true }, ". Consume la API REST y establece conexiones WebRTC para recibir el video."]),
        para("La Figura 1 muestra la arquitectura general de la plataforma, incluyendo el flujo de datos desde la cámara hasta los clientes."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/diagrams/arquitectura.png"),
            transformation: { width: 580, height: 287 },
            altText: { title: "Arquitectura general", description: "Diagrama de arquitectura de la plataforma", name: "arquitectura" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 1. Arquitectura general de la plataforma de software.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        // Table: Technology stack
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2800, 3200, 3360],
          rows: [
            new TableRow({ children: [headerCell("Componente", 2800), headerCell("Tecnología", 3200), headerCell("Descripción", 3360)] }),
            new TableRow({ children: [cell("Backend", 2800), cell("FastAPI + Python 3.13", 3200), cell("Servidor asíncrono con uvicorn", 3360)] }),
            new TableRow({ children: [cell("Streaming", 2800), cell("aiortc (WebRTC)", 3200), cell("Transmisión peer-to-peer de video y datos", 3360)] }),
            new TableRow({ children: [cell("Detección", 2800), cell("Ultralytics YOLO", 3200), cell("Inferencia de objetos en tiempo real", 3360)] }),
            new TableRow({ children: [cell("Seguimiento", 2800), cell("BotSort", 3200), cell("Seguimiento multi-objeto con IDs persistentes", 3360)] }),
            new TableRow({ children: [cell("Base de datos", 2800), cell("SQLite + SQLAlchemy", 3200), cell("Almacenamiento asíncrono de sesiones", 3360)] }),
            new TableRow({ children: [cell("Frontend Web", 2800), cell("React 19 + TypeScript", 3200), cell("Aplicación de página única con Vite y Tailwind CSS v4", 3360)] }),
            new TableRow({ children: [cell("Codificación HW", 2800), cell("PyAV / GStreamer NVENC", 3200), cell("H.264 por hardware en GPU NVIDIA", 3360)] }),
            new TableRow({ children: [cell("Cámara", 2800), cell("ZED 2i (Stereolabs)", 3200), cell("Captura estéreo 2560×720 a 30 FPS", 3360)] }),
          ],
        }),
        tableCaption("TABLA 1. Tecnologías empleadas en la plataforma de software."),

        // 2. API REST
        heading2("2. API REST"),
        paraRuns(["El ", { text: "backend", italics: true }, " expone una API REST que permite a los clientes gestionar sesiones de conteo, consultar datos históricos, administrar camellones y ubicaciones, y modificar la configuración del sistema. La Tabla 2 resume los principales grupos de operaciones disponibles."]),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2400, 3200, 3760],
          rows: [
            new TableRow({ children: [headerCell("Recurso", 2400), headerCell("Operaciones", 3200), headerCell("Descripción", 3760)] }),
            new TableRow({ children: [cell("Streaming", 2400), cell("POST /offer", 3200), cell("Negociación SDP para establecer conexión WebRTC", 3760)] }),
            new TableRow({ children: [cell("Conteo", 2400), cell("POST start, POST stop", 3200), cell("Iniciar y detener sesiones de conteo en tiempo real", 3760)] }),
            new TableRow({ children: [cell("Sesiones", 2400), cell("GET, POST save, GET export", 3200), cell("Consultar, guardar y exportar sesiones a CSV", 3760)] }),
            new TableRow({ children: [cell("Camellones", 2400), cell("GET, POST, PUT location", 3200), cell("Crear camellones, asignar coordenadas GPS", 3760)] }),
            new TableRow({ children: [cell("Ubicaciones", 2400), cell("GET, POST, PUT, DELETE", 3200), cell("Gestionar ubicaciones y polígonos en el mapa", 3760)] }),
            new TableRow({ children: [cell("Dashboard", 2400), cell("GET stats", 3200), cell("Indicadores agregados con filtros por fecha, clase y camellón", 3760)] }),
            new TableRow({ children: [cell("Configuración", 2400), cell("GET, PUT counting", 3200), cell("Consultar y modificar parámetros de conteo en ejecución", 3760)] }),
          ],
        }),
        tableCaption("TABLA 2. Operaciones de la API REST agrupadas por recurso."),

        para("La interfaz web accede a la API mediante rutas relativas a través del proxy de Vite en desarrollo."),

        // 3. Entidades de Datos
        heading2("3. Entidades de Datos"),
        para("Los recursos expuestos por la API operan sobre cuatro entidades principales que representan el dominio del conteo de frutos en campo. La Figura 2 muestra las relaciones entre ellas."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/diagrams/entidades.png"),
            transformation: { width: 580, height: 876 },
            altText: { title: "Entidades de datos", description: "Diagrama entidad-relación de la base de datos", name: "entidades" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 2. Diagrama entidad-relación de la base de datos.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        heading3("3.1. Sesión de Conteo"),
        paraRuns(["Una sesión representa un periodo de conteo sobre un camellón. Registra la marca de tiempo de inicio y fin, la clase de fruto objetivo (configurable por el operador), el conteo total acumulado y la referencia al camellón asociado. Durante la sesión, el conteo se mantiene en memoria. Al finalizar, el operador decide si persiste el resultado en la base de datos o lo descarta."]),

        heading3("3.2. Evento de Cruce"),
        para("Cada vez que un objeto rastreado cruza la línea virtual de conteo, se genera un evento individual que registra la marca de tiempo, la clase del objeto y el identificador de seguimiento asignado por BotSort. Estos eventos permiten reconstruir el conteo y analizar la distribución temporal de los cruces."),

        heading3("3.3. Camellón"),
        para("Representa una hilera de cultivo dentro del fundo agrícola. Cada camellón tiene un nombre único y puede tener coordenadas GPS asociadas. Las sesiones de conteo se agrupan por camellón, lo que permite consultar el rendimiento acumulado por zona."),

        heading3("3.4. Ubicación"),
        para("Representa un punto de interés en el mapa con una etiqueta, coordenadas geográficas, nivel de zoom y un polígono GeoJSON opcional que delimita el área. El centroide del polígono se calcula automáticamente en el servidor al crear o editar la ubicación."),

        heading3("3.5. Flujo de una Sesión de Conteo"),
        para("El sistema de persistencia emplea SQLite con SQLAlchemy en modo asíncrono. La Figura 3 muestra los estados por los que transita una sesión de conteo. El operador inicia una sesión desde la interfaz (web), seleccionando la clase de fruto objetivo. Durante la sesión, el conteo se mantiene en memoria. Al detener la sesión, el resultado se presenta al operador, quien puede guardarlo asociado a un camellón específico o descartarlo. Las sesiones guardadas son consultables desde el módulo de mapa y el panel de estadísticas."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/diagrams/sesion_flujo.png"),
            transformation: { width: 580, height: 233 },
            altText: { title: "Flujo de sesión", description: "Diagrama de estados de una sesión de conteo", name: "sesion_flujo" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 3. Diagrama de estados de una sesión de conteo.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        // 4. Transmisión de Video mediante WebRTC
        heading2("4. Transmisión de Video mediante WebRTC"),

        paraRuns(["La transmisión de video se implementó mediante el protocolo WebRTC utilizando la biblioteca ", { text: "aiortc", italics: true }, " en Python. La Figura 4 muestra la secuencia de negociación. El cliente (web) envía una oferta SDP al servidor, que crea una conexión ", { text: "peer-to-peer", italics: true }, ", agrega un ", { text: "track", italics: true }, " de video capturado desde la cámara ZED 2i y retorna una respuesta SDP."]),
        paraRuns(["La cámara se abre mediante OpenCV con resolución estéreo 2560×720 y se recorta el canal izquierdo (1280×720) para transmisión. Cada ", { text: "frame", italics: true }, " se codifica en H.264 mediante el ", { text: "encoder", italics: true }, " configurado (NVENC por hardware o libx264 por software) y se transmite como paquetes RTP. Se establece un canal de datos WebRTC para el envío de metadatos de detección (clase, confianza, ", { text: "bounding box", italics: true }, ", identificador de seguimiento, conteo) en formato JSON."]),
        para("Solo se permite una conexión WebRTC activa a la vez, dado que la cámara es un recurso compartido. Cada nueva solicitud cierra la conexión anterior antes de establecer una nueva."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/diagrams/webrtc_secuencia.png"),
            transformation: { width: 450, height: 793 },
            altText: { title: "Secuencia WebRTC", description: "Diagrama de secuencia de la negociación WebRTC", name: "webrtc_secuencia" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 4. Diagrama de secuencia de la negociación WebRTC.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),
        paraRuns(["Se implementaron dos optimizaciones para reducir la latencia de inicio. Se configuró el tamaño del ", { text: "buffer", italics: true }, " interno de OpenCV a 1 ", { text: "frame", italics: true }, ". Al recibir el primer ", { text: "frame", italics: true }, " tras la negociación ICE, se descartan 4 ", { text: "frames", italics: true }, " acumulados durante la negociación antes de leer el ", { text: "frame", italics: true }, " actual, eliminando así la latencia causada por imágenes obsoletas."]),

        // 5. Detección y Conteo de Frutos
        heading2("5. Detección y Conteo de Frutos"),
        paraRuns(["El subsistema de percepción se compone de tres módulos que operan de forma secuencial sobre cada ", { text: "frame", italics: true }, " del video. La Figura 5 muestra el flujo completo desde la captura hasta la entrega al cliente."]),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/diagrams/pipeline.png"),
            transformation: { width: 580, height: 377 },

            altText: { title: "Pipeline de procesamiento", description: "Flujo de procesamiento de video desde la cámara hasta el cliente", name: "pipeline" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 5. Pipeline de procesamiento de video.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        heading3("5.1. Detección de Objetos (YOLO)"),
        paraRuns(["Se utiliza el modelo YOLO (Ultralytics) en modo ", { text: "tracking", italics: true }, ", que mantiene identificadores únicos para cada objeto a lo largo del video. La inferencia se ejecuta únicamente cuando existe una sesión de conteo activa, lo que evita el consumo de GPU durante la visualización pasiva. El módulo de detección procesa cada ", { text: "frame", italics: true }, " y retorna el ", { text: "frame", italics: true }, " anotado con cuadros delimitadores, la lista de detecciones con sus metadatos (clase, confianza, coordenadas, identificador de seguimiento) y el conteo de objetos de la clase objetivo."]),

        heading3("5.2. Seguimiento de Objetos (BotSort)"),
        paraRuns(["El algoritmo BotSort (Aharon et al., 2022), disponible en Ultralytics, realiza el seguimiento multi-objeto asignando identificadores persistentes a cada fruto detectado a lo largo de los ", { text: "frames", italics: true }, " consecutivos. Este algoritmo emplea la Transformada de Kalman para la predicción de trayectorias y la distancia de Mahalanobis para la asociación de detecciones."]),

        heading3("5.3. Conteo por Cruce de Línea"),
        para("Se implementó un algoritmo de conteo basado en el cruce de una línea virtual configurable. Para cada objeto rastreado, se calcula el centro del cuadro delimitador y se verifica si la coordenada relevante (Y para modo vertical, X para modo horizontal) cruza el umbral configurado en píxeles."),
        para("El conteo se realiza de forma bidireccional: se incrementa cuando un objeto cruza en la dirección configurada y se decrementa en caso contrario. Se emplean dos conjuntos internos para distinguir entre objetos que han cruzado parcialmente la línea y objetos cuyo cruce ha sido registrado."),
        paraRuns(["La configuración del conteo (modo vertical u horizontal, posición de la línea, dirección y ", { text: "confidence threshold", italics: true }, ") es modificable en tiempo de ejecución a través de la API REST."]),

        // 4. Codificación de Video por Hardware (NVENC)
        heading2("6. Codificación de Video por Hardware (NVENC)"),
        paraRuns(["La codificación de video H.264 por software (libx264) introduce una latencia de 20 a 50 ms por ", { text: "frame", italics: true }, ". Para reducir esta latencia, se implementó un sistema de codificación por hardware que utiliza el ", { text: "encoder", italics: true }, " NVENC presente en las GPUs NVIDIA. El sistema realiza una detección automática de la plataforma al inicio del servidor y selecciona la opción óptima según la prioridad indicada en la Tabla 3."]),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [1800, 2500, 2200, 2860],
          rows: [
            new TableRow({ children: [headerCell("Prioridad", 1800), headerCell("Encoder", 2500), headerCell("Plataforma", 2200), headerCell("Requisito", 2860)] }),
            new TableRow({ children: [cell("1", 1800), cell("h264_nvenc (PyAV)", 2500), cell("Desktop NVIDIA", 2200), cell("Driver NVIDIA ≥ 570", 2860)] }),
            new TableRow({ children: [cell("2", 1800), cell("nvv4l2h264enc (GStreamer)", 2500), cell("Jetson Xavier", 2200), cell("JetPack SDK (preinstalado)", 2860)] }),
            new TableRow({ children: [cell("3", 1800), cell("nvh264enc (GStreamer)", 2500), cell("Desktop + GStreamer 1.18+", 2200), cell("gstreamer1.0-plugins-bad", 2860)] }),
            new TableRow({ children: [cell("Fallback", 1800), cell("libx264 (software)", 2500), cell("Cualquiera", 2200), cell("Ninguno adicional", 2860)] }),
          ],
        }),
        tableCaption("TABLA 3. Orden de prioridad para la selección del encoder H.264."),

        paraRuns(["La implementación se realiza mediante sustitución dinámica (", { text: "monkey-patching", italics: true }, ") del ", { text: "encoder", italics: true }, " H.264 de la biblioteca ", { text: "aiortc", italics: true }, ". Al inicio del servidor, la función de inicialización reemplaza la clase original con la clase correspondiente al ", { text: "encoder", italics: true }, " detectado. De forma complementaria, se elimina el codec VP8 de la lista de negociación para forzar el uso exclusivo de H.264."]),
        paraRuns(["Para escritorio, el ", { text: "encoder", italics: true }, " personalizado hereda de la clase original y reemplaza únicamente el método de codificación de ", { text: "frames", italics: true }, ", manteniendo toda la lógica de paquetización RTP. Para Jetson, se construye un ", { text: "pipeline", italics: true }, " de GStreamer que recibe los ", { text: "frames", italics: true }, " en bruto y produce el flujo H.264 codificado."]),

        // 7. Interfaz Web
        heading2("7. Interfaz Web"),
        paraRuns(["El ", { text: "frontend", italics: true }, " web se desarrolló con React 19, TypeScript, Vite 7 como empaquetador, Tailwind CSS v4 para estilos y shadcn/ui como biblioteca de componentes. La aplicación se organiza en tres módulos principales."]),

        heading3("7.1. Módulo de Visión"),
        paraRuns(["Permite la visualización del video en tiempo real desde la cámara del robot (véase Figura 6). Establece la conexión ", { text: "peer-to-peer", italics: true }, " mediante WebRTC y gestiona el ciclo de vida de las sesiones de conteo. Durante una sesión activa, se superpone la información de conteo en tiempo real y los metadatos de detección recibidos por el canal de datos."]),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/assets/robot-platform-vision.png"),
            transformation: { width: 580, height: 319 },
            altText: { title: "Módulo de Visión", description: "Captura del módulo de visión de la interfaz web", name: "vision" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 6. Módulo de Visión de la interfaz web.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        heading3("7.2. Módulo de Mapa"),
        para("Utiliza la API de Google Maps para mostrar un mapa satélite con las ubicaciones de los camellones (véase Figura 7). Permite dibujar y editar polígonos sobre el mapa para delimitar zonas de interés. Incluye un panel lateral con la lista de sesiones de conteo, filtros por fecha y ubicación, y la funcionalidad de exportación a CSV."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/assets/robot-platform-mapa.png"),
            transformation: { width: 580, height: 316 },
            altText: { title: "Módulo de Mapa", description: "Captura del módulo de mapa de la interfaz web", name: "mapa" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 7. Módulo de Mapa con polígonos y sesiones de conteo.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        heading3("7.3. Módulo de Estadísticas"),
        para("Presenta indicadores agregados de las sesiones de conteo: conteo total, número de sesiones, promedio por sesión, tendencia diaria, distribución por camellón y distribución por clase de objeto (véase Figura 8). Los datos son filtrables por rango de fechas, clase objetivo y camellón."),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: "png",
            data: fs.readFileSync("/home/pqbas/labinm/robot-platform/docs/assets/robot-platform-dashboard.png"),
            transformation: { width: 580, height: 316 },
            altText: { title: "Módulo de Estadísticas", description: "Captura del módulo de estadísticas de la interfaz web", name: "dashboard" },
          })],
        }),
        new Paragraph({
          spacing: { before: 80, after: 200 },
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "FIGURA 8. Módulo de Estadísticas con indicadores y gráficos.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
        }),

        // --- VI. RESULTADOS ---
        heading1("VI. RESULTADOS"),
        para("A continuación se detallan los resultados obtenidos durante el desarrollo y validación de la plataforma en entorno de escritorio."),

        heading2("1. Conexión WebRTC establecida en 1 a 2 segundos con latencia de inicio eliminada"),
        paraRuns(["Se logró establecer ", { text: "streaming", italics: true }, " de video en tiempo real desde la cámara ZED 2i hacia clientes web mediante WebRTC. La negociación SDP y la conexión ICE se completan en un tiempo promedio de 1 a 2 segundos. La implementación del drenado de ", { text: "buffer", italics: true }, " en la captura de video eliminó la latencia de inicio observada previamente, donde los primeros ", { text: "frames", italics: true }, " correspondían a imágenes capturadas durante la negociación."]),

        heading2("2. Reducción de latencia de codificación mediante forzado de H.264"),
        paraRuns(["La eliminación del codec VP8 de la negociación de ", { text: "aiortc", italics: true }, " y el forzado de H.264 resultó en una mejora de rendimiento en la codificación por software, dado que H.264 ", { text: "Baseline", italics: true }, " con ", { text: "tune=zerolatency", italics: true }, " presenta menor latencia que VP8 en el mismo hardware. De forma complementaria, los navegadores decodifican H.264 mediante aceleración por hardware, lo que reduce el consumo de CPU en el cliente."]),

        heading2("3. Auto-detección de plataforma validada en tres escenarios"),
        para("El sistema de auto-detección de plataforma funciona correctamente en los tres escenarios evaluados (véase Tabla 3). En la Jetson Xavier, se detecta automáticamente el encoder nvv4l2h264enc mediante GStreamer, que se encuentra preinstalado en el JetPack SDK. En escritorios con GPU NVIDIA y driver versión 570 o superior, se utiliza h264_nvenc mediante PyAV/FFmpeg sin requerir GStreamer. En sistemas sin GPU compatible o con drivers de versión inferior, el sistema retorna al encoder libx264 por software sin generar errores."),
        paraRuns(["El ", { text: "pipeline", italics: true }, " de GStreamer fue validado con el ", { text: "encoder", italics: true }, " x264enc como sustituto en equipos sin hardware NVENC disponible, confirmando la integridad del flujo de codificación."]),

        heading2("4. Inferencia YOLO condicional sin consumo de GPU en visualización pasiva"),
        para("La inferencia YOLO se ejecuta únicamente durante sesiones de conteo activas, lo que evita el consumo de GPU durante la visualización pasiva. Los metadatos de detección se transmiten en tiempo real al cliente mediante el canal de datos WebRTC, lo que permite la visualización del conteo acumulado sin latencia adicional."),

        heading2("5. Persistencia de sesiones con exportación a CSV"),
        para("Las sesiones de conteo se almacenan correctamente en la base de datos SQLite (véase Figura 2), con la posibilidad de agrupar por camellón y filtrar por rango de fechas. La exportación en formato CSV permite el análisis posterior de los datos en herramientas externas."),

        // --- VII. CONCLUSIONES ---
        heading1("VII. CONCLUSIONES"),
        para("Se desarrolló una plataforma de software que comprende los subsistemas de captura, transmisión, detección, conteo y visualización para el robot móvil de conteo de frutos. La plataforma ha sido validada en entorno de escritorio y se encuentra lista para su despliegue en la Jetson Xavier del robot."),
        para("La arquitectura cliente-servidor basada en FastAPI y WebRTC permite la transmisión de video en tiempo real con baja latencia, accesible desde cualquier navegador web sin requerir software adicional en el cliente."),
        para("El forzado del codec H.264 sobre VP8 mejora el rendimiento tanto en la codificación (menor latencia por software) como en la decodificación (aceleración por hardware en el navegador)."),
        paraRuns(["El sistema de codificación por hardware con auto-detección de plataforma permite la utilización del ", { text: "encoder", italics: true }, " óptimo en cada entorno, con ", { text: "fallback", italics: true }, " transparente a software en caso de ausencia de GPU compatible."]),
        paraRuns(["La optimización del ", { text: "buffer", italics: true }, " de cámara y el drenado inicial de ", { text: "frames", italics: true }, " elimina la latencia de inicio de la transmisión causada por la acumulación de imágenes durante la negociación ICE."]),
        para("La inferencia YOLO condicional (solo durante sesiones activas) permite reservar los recursos de GPU para las operaciones de conteo, sin afectar la visualización pasiva del video."),

        // --- VIII. REFERENCIAS ---
        heading1("VIII. REFERENCIAS"),
        paraRuns([
          "Cubas Muñoz, P. B. (2025). ",
          { text: "Comparación de algoritmos de IA para la detección y conteo de arándanos en entornos Agroindustriales", italics: true },
          ". Informe Técnico #2, PE5010-86701-2024-PROCIENCIA.",
        ]),
        paraRuns([
          "Aharon, N., Orfaig, R. y Bobrovsky, B. Z. (2022). ",
          { text: "BoT-SORT: Robust Associations Multi-Pedestrian Tracking", italics: true },
          ". arXiv preprint arXiv:2206.14651.",
        ]),
        paraRuns([
          "Ultralytics. (2024). ",
          { text: "YOLO11 Documentation", italics: true },
          ". Recuperado de docs.ultralytics.com",
        ]),
        paraRuns([
          "NVIDIA Corporation. (2024). ",
          { text: "Video Codec SDK Documentation", italics: true },
          ". Recuperado de developer.nvidia.com/video-codec-sdk",
        ]),
        paraRuns([
          "GStreamer Project. (2024). ",
          { text: "GStreamer Plugin Documentation: NVENC", italics: true },
          ". Recuperado de gstreamer.freedesktop.org",
        ]),
        paraRuns([
          "Stereolabs. (2024). ",
          { text: "ZED 2i Camera Documentation", italics: true },
          ". Recuperado de stereolabs.com",
        ]),
        paraRuns([
          "Sapkota, R. et al. (2024). ",
          { text: "Improved Detection Performance in YOLO Series", italics: true },
          ". Proceedings of CVPR 2024, 45(1), 98-110.",
        ]),
      ],
    },
  ],
});

// --- Generate ---
Packer.toBuffer(doc).then(buffer => {
  const out = "/home/pqbas/labinm/robot-platform/docs/INFORME_#3_PLATAFORMA_SOFTWARE_2025_CUBAS_MUÑOZ.docx";
  fs.writeFileSync(out, buffer);
  console.log("Created: " + out);
});
