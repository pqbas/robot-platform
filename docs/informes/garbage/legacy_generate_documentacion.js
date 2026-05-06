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
const DEMO_PATH = "/home/pqbas/labinm/robot-platform/docs/assets/detection-demo-robot-movil.jpeg";
const ARCH_PATH = "/home/pqbas/labinm/robot-platform/docs/diagrams/arquitectura_actual.png";
const bannerImg = fs.existsSync(BANNER_PATH) ? fs.readFileSync(BANNER_PATH) : null;
const logoImg = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
const demoImg = fs.existsSync(DEMO_PATH) ? fs.readFileSync(DEMO_PATH) : null;
const archImg = fs.existsSync(ARCH_PATH) ? fs.readFileSync(ARCH_PATH) : null;

// --- Constants ---
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

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

function cellParagraphs(paragraphs, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: paragraphs,
  });
}

function tableCaption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}

function code(text) {
  return new TextRun({ text, font: "Courier New", size: 20 });
}

function codePara(text) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Courier New", size: 20 })],
  });
}

// --- Pre-create numbered lists ---
const nOperacion = newNumberedList();
const nConteo = newNumberedList();
const nSync = newNumberedList();
const nModelo = newNumberedList();
const nInstall = newNumberedList();
const nConectar = newNumberedList();
const nProtocolo = newNumberedList();

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
          children: [new TextRun({ text: "DOCUMENTACIÓN TÉCNICA DE LA PLATAFORMA", font: FONT, size: 32, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS", font: FONT, size: 26, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "— Avance —", font: FONT, size: 24, italics: true, color: COLOR_GRAY })],
        }),
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Autor:", font: FONT, size: 22, bold: true })],
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

    // ===================== CUERPO =====================
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
            children: [new TextRun({ text: "Documentación Técnica / Robot Platform", font: FONT, size: 18, color: COLOR_GRAY })],
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
        heading1("ÍNDICE"),
        new TableOfContents("Tabla de contenidos", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),

        // ============================================================
        // I. DESCRIPCIÓN DEL SISTEMA
        // ============================================================
        heading1("I. DESCRIPCIÓN DEL SISTEMA"),
        para("La plataforma Robot Platform es el componente de software del robot móvil agrícola. Su función principal es detectar, contar y clasificar frutos en tiempo real mientras el robot recorre los camellones de un fundo agrícola. El operador interactúa con el sistema desde un celular o tablet conectado a la red WiFi del robot, a través de una interfaz web."),
        para("El sistema opera en dos modos diferenciados mediante la variable de entorno ROBOT_MODE."),
        bulletRuns([{ text: "Modo robot: ", bold: true }, "ejecuta en la computadora embebida del robot (NVIDIA Jetson Xavier). Captura video, ejecuta inferencia YOLO, transmite en tiempo real por WebRTC y almacena datos localmente en SQLite. No requiere conexión a internet para operar."]),
        bulletRuns([{ text: "Modo servidor: ", bold: true }, "ejecuta en una PC del laboratorio. Recibe datos sincronizados desde múltiples robots, almacena en PostgreSQL, gestiona modelos YOLO y proporciona un dashboard con autenticación para administradores y clientes."]),
        emptyLine(),
        para("Ambos modos comparten el mismo codebase. La diferencia de comportamiento se controla exclusivamente por la variable de entorno mencionada (robot o server)."),

        // ============================================================
        // II. ARQUITECTURA
        // ============================================================
        heading1("II. ARQUITECTURA"),

        heading2("Visión general"),
        para("En modo robot, el sistema opera con dos procesos independientes que se comunican mediante un socket Unix. La Figura 1 presenta el diagrama de arquitectura del sistema y la Tabla 1 detalla los componentes de cada proceso."),

        // --- Diagrama de arquitectura ---
        ...(archImg ? [
          emptyLine(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [new ImageRun({
              type: "png", data: archImg,
              transformation: { width: 520, height: 350 },
              altText: { title: "Arquitectura", description: "Diagrama de arquitectura del sistema", name: "arquitectura" },
            })],
          }),
          new Paragraph({
            spacing: { before: 80, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "FIGURA 1. Arquitectura del sistema. El backend (azul) y el inference worker (naranja) operan como procesos independientes dentro del robot, comunicándose por socket Unix. El cliente accede a través de nginx y recibe video por WebRTC. La sincronización con el servidor central (morado) se realiza por HTTP.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
          }),
        ] : []),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Backend (Python 3.13)", 4680), headerCell("Inference Worker (Python 3.10)", 4680)] }),
            new TableRow({ children: [cell("FastAPI + Uvicorn", 4680), cell("Ultralytics YOLO + PyTorch CUDA", 4680)] }),
            new TableRow({ children: [cell("WebRTC (aiortc)", 4680), cell("BotSort tracking", 4680)] }),
            new TableRow({ children: [cell("API REST", 4680), cell("Socket Unix asyncio", 4680)] }),
            new TableRow({ children: [cell("SQLite (aiosqlite)", 4680), cell("Recarga de modelos en caliente", 4680)] }),
            new TableRow({ children: [cell("Sincronización HTTP", 4680), cell("Sin dependencias web", 4680)] }),
            new TableRow({ children: [cell("OpenCV (captura de video)", 4680), cell("OpenCV (decodificación JPEG)", 4680)] }),
          ],
        }),
        tableCaption("TABLA 1. Procesos del sistema en modo robot."),

        para("En modo servidor, el sistema ejecuta un único proceso (el backend) sin inference worker ni captura de video. La Tabla 2 compara las funciones activas en cada modo."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Robot (Jetson Xavier)", 4680), headerCell("Servidor (PC del Lab)", 4680)] }),
            new TableRow({ children: [cell("ROBOT_MODE=robot", 4680), cell("ROBOT_MODE=server", 4680)] }),
            new TableRow({ children: [cell("SQLite", 4680), cell("PostgreSQL", 4680)] }),
            new TableRow({ children: [cell("Captura de video + YOLO", 4680), cell("Autenticación JWT + roles", 4680)] }),
            new TableRow({ children: [cell("WebRTC streaming", 4680), cell("Administración de modelos y usuarios", 4680)] }),
            new TableRow({ children: [cell("Sync push (envío de datos)", 4680), cell("Recepción de sincronización", 4680)] }),
            new TableRow({ children: [cell("Sync pull (descarga de modelos)", 4680), cell("Distribución de modelos YOLO", 4680)] }),
            new TableRow({ children: [cell("Sin autenticación", 4680), cell("Login con usuario y contraseña", 4680)] }),
          ],
        }),
        tableCaption("TABLA 2. Funciones activas por modo de operación."),

        heading2("Ventajas de la separación en procesos"),
        para("La arquitectura de dos procesos independientes es una decisión de diseño que aporta múltiples beneficios al sistema."),
        bulletRuns([{ text: "Aislamiento de fallos. ", bold: true }, "Si el inference worker falla o se reinicia (por ejemplo, por un error en el modelo YOLO), el backend continúa operando: el streaming de video no se interrumpe, la API REST sigue disponible y los datos almacenados no se ven afectados."]),
        bulletRuns([{ text: "Desacoplamiento de velocidades. ", bold: true }, "La transmisión de video opera a 30 FPS mientras que la inferencia YOLO opera a 13 FPS en la Jetson Xavier. Si ambos ejecutaran en el mismo hilo, la inferencia frenaría la captura y el buffer de la cámara se llenaría progresivamente, generando un delay acumulativo entre la realidad y la interfaz. Con procesos separados, el streaming transmite en tiempo real y la detección se actualiza de forma asíncrona al ritmo que la GPU permite."]),
        bulletRuns([{ text: "Aislamiento de recursos. ", bold: true }, "La memoria GPU utilizada por PyTorch y YOLO se gestiona en un proceso separado del servidor web. Un pico de consumo de memoria en la inferencia no compromete la estabilidad del backend ni las conexiones WebRTC activas."]),
        bulletRuns([{ text: "Actualizaciones independientes. ", bold: true }, "El modelo YOLO se puede recargar en caliente sin reiniciar el backend. Esto permite actualizar el modelo durante la operación, ya sea por sincronización desde el servidor o por intervención manual, sin interrumpir sesiones activas ni conexiones de video."]),
        bulletRuns([{ text: "Flexibilidad tecnológica. ", bold: true }, "El backend no tiene dependencia directa de PyTorch, ultralytics ni ningún framework de inferencia. Si en el futuro se migra de PyTorch a TensorRT, o se cambia el modelo de detección, solo se modifica el worker sin tocar el backend."]),
        bulletRuns([{ text: "Monitoreo independiente. ", bold: true }, "Cada proceso genera sus propios logs y puede monitorearse por separado mediante systemd (make logs para el backend, make logs-inference para el worker), lo que facilita el diagnóstico de problemas en cada componente."]),
        bulletRuns([{ text: "Compatibilidad de entornos. ", bold: true }, "NVIDIA solo proporciona PyTorch con soporte CUDA para Python 3.8 y 3.10 en la Jetson Xavier (JetPack 5.1), mientras que el backend requiere Python 3.13 para utilizar las versiones actuales de FastAPI y sus dependencias asíncronas. La separación en procesos permite que cada componente utilice la versión de Python que necesita."]),
        bulletRuns([{ text: "Escalabilidad. ", bold: true }, "La comunicación por socket Unix permite escalar la arquitectura en el futuro: ejecutar múltiples workers en paralelo, mover la inferencia a otro dispositivo con mejor GPU, o implementar balanceo de carga entre workers sin modificar el backend."]),

        // --- Imagen de demostración ---
        emptyLine(),
        ...(demoImg ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [new ImageRun({
              type: "jpg", data: demoImg,
              transformation: { width: 520, height: 293 },
              altText: { title: "Demo detección", description: "Captura del módulo de visión con detección en tiempo real", name: "demo" },
            })],
          }),
          new Paragraph({
            spacing: { before: 80, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "FIGURA 2. Módulo de visión operando en el robot móvil. Se observa la detección en tiempo real (bounding box verde), la línea de conteo (línea inferior), el stream a 30 FPS y la inferencia YOLO a 13 FPS.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
          }),
        ] : []),

        para("La Figura 2 muestra el resultado de la integración de los tres componentes operando en tiempo real sobre la Jetson Xavier. El frontend se accede desde un navegador conectado a la red WiFi del robot (192.168.0.10). El backend captura video de la cámara y lo transmite por WebRTC a 30 FPS, mientras que el inference worker ejecuta la detección YOLO a 13 FPS. Las detecciones se superponen en la interfaz y el conteo se actualiza cuando un objeto cruza la línea configurada."),

        heading2("Protocolo de comunicación interna"),
        para("El backend y el inference worker se comunican a través de un socket Unix ubicado en /tmp/inference.sock. El protocolo es binario y utiliza prefijos de longitud (length-prefixed) para delimitar los mensajes. El flujo de una detección sigue estos pasos."),
        numberedItemRuns(nProtocolo, [{ text: "El backend captura un frame ", bold: true }, "de la cámara y lo codifica como JPEG."]),
        numberedItemRuns(nProtocolo, [{ text: "El backend envía el frame al worker ", bold: true }, "a través del socket. El mensaje contiene un encabezado de 8 bytes (4 bytes para el largo de los metadatos JSON y 4 bytes para el largo de la imagen JPEG), seguido de un JSON con parámetros de configuración (clase objetivo y umbral de confianza) y los bytes de la imagen."]),
        numberedItemRuns(nProtocolo, [{ text: "El worker ejecuta la inferencia ", bold: true }, "con YOLO y el tracking con BotSort sobre la imagen recibida."]),
        numberedItemRuns(nProtocolo, [{ text: "El worker responde con un JSON ", bold: true }, "que contiene la lista de detecciones (clase, confianza, coordenadas del bounding box y track_id de cada objeto), los datos de tracking (posición central de cada objeto rastreado) y el conteo total. El mensaje de respuesta también utiliza un prefijo de 4 bytes para indicar su longitud."]),
        numberedItemRuns(nProtocolo, [{ text: "El backend recibe la respuesta ", bold: true }, "y la envía al frontend a través del data channel de WebRTC como JSON, donde se renderizan las detecciones sobre el video."]),
        emptyLine(),
        para("Además del flujo de detección, el backend puede enviar comandos de control al worker utilizando el mismo socket. El comando reload_model indica al worker que cargue un nuevo modelo YOLO desde una ruta absoluta sin reiniciar el proceso, lo que permite actualizar el modelo después de una sincronización. El comando status consulta qué modelo está activo y el estado general del worker."),

        // ============================================================
        // III. STACK TECNOLÓGICO
        // ============================================================
        heading1("III. STACK TECNOLÓGICO"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2600, 6760],
          rows: [
            new TableRow({ children: [headerCell("Componente", 2600), headerCell("Tecnología", 6760)] }),
            new TableRow({ children: [cell("Backend", 2600), cell("FastAPI, Uvicorn, Python 3.13, SQLAlchemy (async), Alembic", 6760)] }),
            new TableRow({ children: [cell("Inferencia", 2600), cell("Python 3.10, Ultralytics YOLO v11, PyTorch CUDA, BotSort", 6760)] }),
            new TableRow({ children: [cell("Frontend", 2600), cell("React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui", 6760)] }),
            new TableRow({ children: [cell("Streaming de video", 2600), cell("WebRTC mediante aiortc, codificación H.264 por hardware (NVENC)", 6760)] }),
            new TableRow({ children: [cell("Base de datos", 2600), cell("SQLite con aiosqlite (robot), PostgreSQL con psycopg (servidor)", 6760)] }),
            new TableRow({ children: [cell("Comunicación interna", 2600), cell("Socket Unix con protocolo binario length-prefixed", 6760)] }),
            new TableRow({ children: [cell("Proxy y web server", 2600), cell("nginx (proxy inverso + archivos estáticos del frontend)", 6760)] }),
            new TableRow({ children: [cell("Gestión de servicios", 2600), cell("systemd (arranque automático, reinicio ante fallos)", 6760)] }),
            new TableRow({ children: [cell("Gestión de dependencias", 2600), cell("uv (Python), npm (Node.js)", 6760)] }),
          ],
        }),
        tableCaption("TABLA 3. Stack tecnológico de la plataforma."),

        // ============================================================
        // IV. BACKEND
        // ============================================================
        heading1("IV. BACKEND"),
        paraRuns(["El backend es una aplicación ", { text: "FastAPI", bold: true }, " que expone una API REST y gestiona la conexión WebRTC para streaming de video. Sus funciones principales se describen a continuación."]),

        heading2("Transmisión de video en tiempo real"),
        para("El backend captura video de la cámara mediante OpenCV y lo transmite al frontend a través de WebRTC, codificado en H.264 por hardware (NVENC). El pipeline opera en tres etapas desacopladas: captura del frame, inferencia YOLO en un hilo secundario, y transmisión por WebRTC."),
        para("Los resultados de detección se envían por un data channel separado como JSON. Esto permite que el video fluya a 30 FPS independientemente de la velocidad de inferencia."),

        heading2("Gestión de sesiones de conteo"),
        para("El backend gestiona el ciclo de vida completo de una sesión de conteo. El operador inicia una sesión indicando la clase objetivo (por ejemplo, arándano) y el sistema cuenta objetos en tiempo real mediante cruce de línea. Al finalizar, los datos se persisten en la base de datos."),
        para("Las sesiones quedan asociadas a un camellón, un robot y un modelo YOLO. Pueden consultarse posteriormente con filtros por fecha o exportarse en formato CSV."),

        heading2("Configuración del sistema"),
        para("El backend permite configurar la cámara (dispositivo, resolución, recorte para cámaras estéreo) y los parámetros de conteo (modo vertical u horizontal, posición de la línea, dirección). También gestiona la configuración inicial del robot, donde se establece la URL del servidor central y la API key del dispositivo. Esta configuración se realiza una sola vez desde una página de setup al primer arranque."),

        heading2("Sincronización con el servidor central"),
        para("En modo robot, el backend ejecuta un loop de sincronización en segundo plano que se activa cuando detecta conectividad a internet. Este proceso envía los datos locales al servidor (sesiones, eventos, camellones) y descarga los modelos YOLO activos. Los detalles del protocolo de sincronización se describen en la sección IX."),

        heading2("Autenticación y administración"),
        para("En modo servidor, el backend protege los endpoints con autenticación JWT. Los usuarios se autentican con usuario y contraseña, y el token incluye su rol (admin o viewer) y empresa asociada. Los usuarios viewer solo acceden a datos de su propia empresa. El modo robot no requiere autenticación, dado que opera en una red local aislada."),
        para("El servidor también expone funciones de administración para gestionar usuarios, empresas, fundos, modelos de detección y dispositivos. La carga de modelos YOLO se realiza desde la interfaz, donde se sube el archivo .pt junto con metadatos de entrenamiento. Los endpoints de sincronización se protegen con API key de dispositivo."),

        // ============================================================
        // VI. INFERENCE WORKER
        // ============================================================
        heading1("V. INFERENCE WORKER"),
        para("El inference worker es un proceso independiente que ejecuta la detección de objetos y el tracking. Se encuentra en el directorio inference/ del proyecto con su propio archivo de dependencias, lo que mantiene las dependencias de inferencia (PyTorch, ultralytics) completamente aisladas del backend."),
        para("El worker utiliza Ultralytics YOLO v11 con tracking BotSort habilitado. Recibe imágenes JPEG del backend a través del socket Unix, ejecuta la inferencia sobre la GPU y retorna las detecciones con sus coordenadas y el identificador de tracking de cada objeto. Este identificador es la base del conteo por cruce de línea, ya que permite rastrear un mismo objeto entre frames consecutivos."),
        para("El worker soporta recarga de modelos en caliente. Cuando el robot sincroniza un nuevo modelo desde el servidor, el backend le indica al worker que cargue el nuevo archivo .pt sin reiniciar el proceso. Esto permite actualizar el modelo durante la operación sin interrumpir sesiones activas."),
        para("En producción, systemd gestiona el worker como un servicio que arranca automáticamente antes del backend."),

        // ============================================================
        // VII. FRONTEND
        // ============================================================
        heading1("VI. FRONTEND"),
        para("El frontend es una aplicación React 19 con TypeScript que se compila a archivos estáticos servidos por nginx. La interfaz se adapta automáticamente según el modo de operación (robot o servidor) y el rol del usuario."),
        para("En modo robot, la interfaz principal es el módulo de visión. Desde ahí el operador visualiza el video en tiempo real con las detecciones superpuestas, configura la línea de conteo, selecciona el camellón y la clase objetivo, e inicia sesiones de conteo. Al finalizar, los datos se guardan en la base de datos local. El operador accede desde un celular o tablet conectado a la red WiFi del robot, sin necesidad de autenticación."),
        para("En modo servidor, la interfaz incluye un sistema de login con JWT y páginas de administración para gestionar usuarios, empresas, fundos, modelos de detección y dispositivos (robots). Los usuarios con rol viewer solo ven datos de su empresa."),
        para("Ambos modos comparten dos módulos adicionales. El módulo de mapa integra Google Maps para visualizar la ubicación de fundos y camellones con los conteos acumulados. El módulo de dashboard presenta indicadores clave, tendencias diarias y distribución por camellón y clase, con filtros por rango de fecha."),

        // ============================================================
        // VIII. CONTEO POR CRUCE DE LÍNEA
        // ============================================================
        heading1("VII. CONTEO POR CRUCE DE LÍNEA"),
        para("El sistema de conteo utiliza un algoritmo de cruce de línea combinado con tracking de objetos (BotSort) para contar frutos u objetos que atraviesan una línea virtual configurada por el operador."),

        heading2("Algoritmo"),
        numberedItem(nConteo, "YOLO detecta objetos en cada frame y BotSort asigna un track_id único a cada objeto rastreado."),
        numberedItem(nConteo, "El ObjectCounter mantiene dos listas internas (LIST_0 y LIST_1) que registran la posición de cada objeto respecto a la línea."),
        numberedItem(nConteo, "Cuando un objeto cruza de LIST_0 a LIST_1 (es decir, cruza la línea en la dirección configurada), se registra un evento de conteo."),
        numberedItem(nConteo, "El track_id previene conteos duplicados: un mismo objeto solo se cuenta una vez aunque permanezca visible durante varios frames."),

        heading2("Modos de conteo"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2340, 2340, 4680],
          rows: [
            new TableRow({ children: [headerCell("Modo", 2340), headerCell("Dirección", 2340), headerCell("Condición de conteo", 4680)] }),
            new TableRow({ children: [cell("Vertical", 2340), cell("top2down", 2340), cell("Objeto cruza de arriba hacia abajo (cy > threshold)", 4680)] }),
            new TableRow({ children: [cell("Vertical", 2340), cell("down2top", 2340), cell("Objeto cruza de abajo hacia arriba (cy < threshold)", 4680)] }),
            new TableRow({ children: [cell("Horizontal", 2340), cell("left2right", 2340), cell("Objeto cruza de izquierda a derecha (cx > threshold)", 4680)] }),
            new TableRow({ children: [cell("Horizontal", 2340), cell("right2left", 2340), cell("Objeto cruza de derecha a izquierda (cx < threshold)", 4680)] }),
          ],
        }),
        tableCaption("TABLA 4. Modos de conteo por cruce de línea."),

        // ============================================================
        // IX. SINCRONIZACIÓN
        // ============================================================
        heading1("VIII. SINCRONIZACIÓN ROBOT-SERVIDOR"),
        para("La sincronización permite que el robot envíe los datos de conteo al servidor central y descargue modelos YOLO actualizados. Este proceso opera de manera automática cuando el robot detecta conectividad a internet."),

        heading2("Flujo de sincronización"),
        numberedItem(nSync, "El loop de sincronización ejecuta cada 30 segundos (configurable)."),
        numberedItem(nSync, "Verifica la conectividad consultando GET /api/sync/health del servidor."),
        numberedItem(nSync, "Push: envía registros locales no sincronizados al servidor en orden de dependencia (empresas, fundos, locations, camellones, sessions, events)."),
        numberedItem(nSync, "Cada lote se envía por POST con autenticación por API key. El servidor deduplica por UUID (upsert)."),
        numberedItem(nSync, "Pull: consulta los modelos activos en el servidor y los descarga si no existen localmente o si el hash difiere."),
        numberedItem(nSync, "Después de descargar un modelo, envía el comando reload_model al inference worker para que lo cargue sin reiniciar."),

        heading2("Gestión de modelos"),
        numberedItem(nModelo, "El administrador sube un archivo .pt al servidor desde la interfaz de administración, junto con metadatos (versión, epochs, métricas)."),
        numberedItem(nModelo, "El sistema calcula el hash SHA256 del archivo y almacena el registro en la base de datos."),
        numberedItem(nModelo, "El administrador activa el modelo. Al activar uno, los demás se desactivan."),
        numberedItem(nModelo, "En el siguiente ciclo de sincronización, el robot detecta el nuevo modelo activo, lo descarga y recarga el worker."),

        // ============================================================
        // X. DESPLIEGUE
        // ============================================================
        heading1("IX. DESPLIEGUE Y OPERACIÓN"),
        para("La instalación del sistema se realiza mediante un script automatizado (deploy/install.sh) que recibe como argumento el modo de operación (robot o server). El script instala las dependencias del sistema, compila el frontend, configura nginx como proxy inverso y registra los servicios en systemd. En modo servidor, adicionalmente configura PostgreSQL y ejecuta las migraciones de base de datos."),
        para("Actualmente solo el robot se encuentra desplegado en producción. El servidor del laboratorio cuenta con el script preparado pero aún no ha sido instalado."),
        para("En el robot, systemd gestiona dos servicios: el inference worker y el backend. El worker arranca primero y queda escuchando en el socket Unix. El backend depende del worker y se levanta a continuación. Ambos se reinician automáticamente ante fallos."),
        para("Desde la perspectiva del operador, el flujo es simple. Al encender el robot, los servicios arrancan sin intervención manual. El operador se conecta a la red WiFi del robot desde un celular o tablet, abre un navegador en la dirección IP del robot (puerto 8080) y accede directamente a la interfaz de visión para iniciar sesiones de conteo."),
        para("Para la administración del robot en producción se utilizan los comandos detallados en la Tabla 5."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3200, 6160],
          rows: [
            new TableRow({ children: [headerCell("Comando", 3200), headerCell("Descripción", 6160)] }),
            new TableRow({ children: [cell("make status", 3200), cell("Ver estado de los servicios (backend e inference worker)", 6160)] }),
            new TableRow({ children: [cell("make restart", 3200), cell("Reiniciar ambos servicios", 6160)] }),
            new TableRow({ children: [cell("make logs", 3200), cell("Ver logs del backend en tiempo real", 6160)] }),
            new TableRow({ children: [cell("make logs-inference", 3200), cell("Ver logs del inference worker en tiempo real", 6160)] }),
            new TableRow({ children: [cell("make update", 3200), cell("Actualizar código desde el repositorio, recompilar frontend y reiniciar servicios", 6160)] }),
          ],
        }),
        tableCaption("TABLA 5. Comandos de operación del robot."),

        // ============================================================
        // XII. INCIDENCIAS CONOCIDAS
        // ============================================================
        heading1("X. INCIDENCIAS CONOCIDAS"),
        para("Durante las pruebas de integración en el robot móvil se han identificado las incidencias descritas en la Tabla 9."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [600, 2600, 3800, 2360],
          rows: [
            new TableRow({ children: [
              headerCell("#", 600),
              headerCell("Incidencia", 2600),
              headerCell("Descripción", 3800),
              headerCell("Impacto", 2360),
            ]}),
            new TableRow({ children: [
              cell("1", 600),
              cell("Cámara no se libera al desconectarse", 2600),
              cell("Si la cámara se desconecta físicamente durante la operación, el proceso del backend mantiene el recurso de video ocupado. Es necesario reiniciar el servicio (make restart) para recuperar el acceso.", 3800),
              cell("Requiere reinicio manual", 2360),
            ]}),
            new TableRow({ children: [
              cell("2", 600),
              cell("Sesión de conteo no se cierra", 2600),
              cell("Al desconectar la cámara desde la interfaz, la sesión de conteo puede quedar activa internamente, impidiendo iniciar una nueva sesión hasta reiniciar el servicio.", 3800),
              cell("Bloquea nueva sesión", 2360),
            ]}),
          ],
        }),
        tableCaption("TABLA 6. Incidencias detectadas en integración."),

        // ============================================================
        // XIII. FUNCIONALIDADES PENDIENTES
        // ============================================================
        heading1("XI. FUNCIONALIDADES PENDIENTES"),

        heading2("Despliegue del servidor central"),
        para("El servidor del laboratorio aún no ha sido desplegado. El script de instalación y la configuración de systemd están preparados, pero falta ejecutar la instalación en la PC del laboratorio, configurar PostgreSQL y establecer el acceso remoto. Hasta que el servidor esté operativo, la sincronización entre robots y servidor no puede ejecutarse en producción."),

        heading2("Asignación de modelos por dispositivo"),
        para("Actualmente todos los robots descargan el mismo modelo activo del servidor. Se requiere implementar la asignación de modelos específicos a cada robot según el tipo de fruta del fundo donde operará."),

        heading2("Clasificación offline de frutos"),
        para("Pipeline post-sesión para clasificar frutos individuales detectados durante el conteo. Incluye extracción de crops por fruto único (mejor frame por track_id) y clasificación por un modelo independiente de YOLO (madurez, calidad, variedad)."),

        heading2("Mapa offline"),
        para("El módulo de mapa actualmente depende de conexión a internet para cargar los tiles de Google Maps. Para la operación en campo sin conectividad, se requiere implementar la descarga previa de tiles al robot y la visualización offline."),

        heading2("Transmisión de video por red local"),
        para("Actualmente la cámara se conecta al robot por USB. Por restricciones futuras de hardware, se requiere soportar la recepción de frames desde la cámara a través de la red WiFi interna del robot, sin depender de conexión a internet."),

        heading2("Evaluación y finetuning del modelo YOLO"),
        para("Validación del modelo en sesiones de conteo reales con frutos, documentación de métricas de precisión y reentrenamiento del modelo si los resultados no alcanzan la precisión requerida."),

        // ============================================================
        // ANEXO: MODELO DE DATOS
        // ============================================================
        heading1("ANEXO: MODELO DE DATOS"),
        para("La base de datos utiliza SQLAlchemy como ORM con soporte asíncrono. Todos los modelos incluyen un campo uuid generado automáticamente para sincronización y un campo device_id para identificar el robot de origen. La Tabla 9 resume las entidades del sistema."),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [1800, 1800, 5760],
          rows: [
            new TableRow({ children: [headerCell("Entidad", 1800), headerCell("Grupo", 1800), headerCell("Descripción", 5760)] }),
            new TableRow({ children: [cell("Empresa", 1800), cell("Organización", 1800), cell("Entidad agroindustrial que agrupa múltiples fundos", 5760)] }),
            new TableRow({ children: [cell("Fundo", 1800), cell("Organización", 1800), cell("Unidad productiva asociada a una empresa", 5760)] }),
            new TableRow({ children: [cell("User", 1800), cell("Organización", 1800), cell("Usuario con rol (admin o viewer) y empresa asociada", 5760)] }),
            new TableRow({ children: [cell("Device", 1800), cell("Organización", 1800), cell("Robot registrado con API key y fecha de última sincronización", 5760)] }),
            new TableRow({ children: [cell("Location", 1800), cell("Operación", 1800), cell("Marcador en el mapa con latitud, longitud y polígono opcional", 5760)] }),
            new TableRow({ children: [cell("Camellon", 1800), cell("Operación", 1800), cell("Hilera dentro de un fundo donde se ejecuta una sesión de conteo", 5760)] }),
            new TableRow({ children: [cell("Session", 1800), cell("Operación", 1800), cell("Sesión de conteo con camellón, robot, clase objetivo, hora de inicio/fin y conteo total", 5760)] }),
            new TableRow({ children: [cell("Event", 1800), cell("Operación", 1800), cell("Evento individual de detección por cruce de línea dentro de una sesión", 5760)] }),
            new TableRow({ children: [cell("DetectionModel", 1800), cell("Detección", 1800), cell("Modelo YOLO con archivo .pt, hash, versión, métricas de entrenamiento y class_mapping", 5760)] }),
            new TableRow({ children: [cell("CaptureBurst", 1800), cell("Detección", 1800), cell("Ráfaga de frames capturados durante una sesión para auditoría", 5760)] }),
            new TableRow({ children: [cell("CaptureFrame", 1800), cell("Detección", 1800), cell("Frame individual con ruta al archivo JPEG y timestamp", 5760)] }),
            new TableRow({ children: [cell("FrameDetection", 1800), cell("Detección", 1800), cell("Detección dentro de un frame con bbox, confidence, class_name y track_id", 5760)] }),
            new TableRow({ children: [cell("SyncLog", 1800), cell("Sincronización", 1800), cell("Registro que asocia un UUID con marca de tiempo para controlar qué datos ya fueron enviados", 5760)] }),
            new TableRow({ children: [cell("Command", 1800), cell("Sincronización", 1800), cell("Cola de comandos del servidor hacia el robot para acciones remotas", 5760)] }),
          ],
        }),
        tableCaption("TABLA 7. Entidades del modelo de datos."),
      ],
    },
  ],
});

// --- Generate ---
const OUTPUT = "/home/pqbas/labinm/robot-platform/docs/roadmap/documentacion_tecnica_avance.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Generated: ${OUTPUT}`);
});
