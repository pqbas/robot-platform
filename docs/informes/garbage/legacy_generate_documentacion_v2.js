const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents,
  ImageRun,
} = require("docx");

const BANNER_PATH = "/home/pqbas/labinm/.assets/banner_upao.jpg";
const LOGO_PATH = "/home/pqbas/labinm/.assets/logo_upao.jpg";
const DEMO_PATH = "/home/pqbas/labinm/robot-platform/docs/assets/detection-demo-robot-movil.jpeg";
const ARCH_PATH = "/home/pqbas/labinm/robot-platform/docs/diagrams/arquitectura_actual.png";
const bannerImg = fs.existsSync(BANNER_PATH) ? fs.readFileSync(BANNER_PATH) : null;
const logoImg = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;
const demoImg = fs.existsSync(DEMO_PATH) ? fs.readFileSync(DEMO_PATH) : null;
const archImg = fs.existsSync(ARCH_PATH) ? fs.readFileSync(ARCH_PATH) : null;

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const FONT = "Arial";
const COLOR_PRIMARY = "1F4E79";
const COLOR_HEADER_BG = "D5E8F0";
const COLOR_GRAY = "666666";

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

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

const nConteo = newNumberedList();
const nSync = newNumberedList();
const nModelo = newNumberedList();
const nProtocolo = newNumberedList();
const nTensorrt = newNumberedList();
const nResol = newNumberedList();

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
      ..._numListConfigs,
    ],
  },
  styles: {
    default: { document: { run: { font: FONT, size: 22, language: { value: "es-PE" } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: COLOR_PRIMARY },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: FONT, italics: true },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ],
  },
  sections: [
    // ===================== PORTADA =====================
    {
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      children: [
        ...(bannerImg ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: "jpg", data: bannerImg,
            transformation: { width: 555, height: 36 },
            altText: { title: "Banner", description: "Banner UPAO", name: "banner" } })],
        })] : []),
        emptyLine(),
        ...(logoImg ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: "jpg", data: logoImg,
            transformation: { width: 200, height: 85 },
            altText: { title: "Logo UPAO", description: "Logo Universidad", name: "logo" } })],
        })] : []),
        emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({
            text: "\"Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú\"",
            font: FONT, size: 22, italics: true, color: COLOR_GRAY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 400 },
          children: [new TextRun({ text: "PE5010-86701-2024-PROCIENCIA", font: FONT, size: 22, color: COLOR_GRAY })],
        }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: "DOCUMENTACIÓN TÉCNICA DE LA PLATAFORMA", font: FONT, size: 32, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS", font: FONT, size: 26, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: "— Avance v2 —", font: FONT, size: 24, italics: true, color: COLOR_GRAY })],
        }),
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "Autor:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Percy Brayam Cubas Muñoz", font: FONT, size: 22 })] }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "Fecha:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "5 de mayo de 2026", font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Trujillo - Perú", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MAYO - 2026", font: FONT, size: 22, bold: true })] }),
      ],
    },

    // ===================== CUERPO =====================
    {
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
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
        bulletRuns([{ text: "Modo robot: ", bold: true }, "ejecuta en la computadora embebida del robot (NVIDIA Jetson Xavier). Captura video, ejecuta inferencia YOLO acelerada por TensorRT, transmite en tiempo real por WebRTC, graba sesiones en H.264 por hardware (NVENC) y almacena datos localmente en SQLite. No requiere conexión a internet para operar."]),
        bulletRuns([{ text: "Modo servidor: ", bold: true }, "ejecuta en una PC del laboratorio. Recibe datos sincronizados desde múltiples robots, almacena en PostgreSQL, gestiona modelos YOLO y proporciona un dashboard con autenticación para administradores y clientes."]),
        emptyLine(),
        para("Ambos modos comparten el mismo codebase del backend; la diferencia de comportamiento se controla por la variable de entorno mencionada (robot o server). En modo robot, el backend coordina cuatro procesos auxiliares (workers) que aíslan el acceso al hardware y la inferencia; el detalle se presenta en la sección II."),

        // ============================================================
        // II. ARQUITECTURA
        // ============================================================
        heading1("II. ARQUITECTURA"),

        heading2("Visión general"),
        para("En modo robot, el sistema opera con cinco procesos independientes que se comunican mediante sockets Unix. Esta separación es el resultado de iteraciones sobre la versión inicial monolítica, en las cuales el acoplamiento entre captura de video, inferencia y grabación generaba contención de recursos y degradaba el frame rate efectivo. La Figura 1 presenta el diagrama de arquitectura del sistema y la Tabla 1 detalla cada proceso."),

        ...(archImg ? [
          emptyLine(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [new ImageRun({ type: "png", data: archImg,
              transformation: { width: 520, height: 350 },
              altText: { title: "Arquitectura", description: "Diagrama de arquitectura del sistema", name: "arquitectura" } })],
          }),
          new Paragraph({
            spacing: { before: 80, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "FIGURA 1. Arquitectura del sistema en modo robot. El backend (azul) coordina cuatro workers independientes: camera-worker (captura), inference-worker (YOLO/TensorRT), recording-worker (NVENC) y conversion-worker (build de engines TensorRT bajo demanda). Cada uno expone un socket Unix dedicado. El cliente accede por nginx y recibe video por WebRTC; la sincronización con el servidor central se realiza por HTTP.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
          }),
        ] : []),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2200, 1400, 5760],
          rows: [
            new TableRow({ children: [headerCell("Proceso", 2200), headerCell("Socket Unix", 1400), headerCell("Responsabilidad", 5760)] }),
            new TableRow({ children: [cell("Backend", 2200), cell("HTTP :8080", 1400), cell("FastAPI + Uvicorn. API REST, WebRTC (aiortc), persistencia SQLite, sincronización HTTP. Coordina los workers.", 5760)] }),
            new TableRow({ children: [cell("camera-worker", 2200), cell("/tmp/camera.sock", 1400), cell("Captura V4L2 (ZED 2i estéreo SBS), crop al ojo izquierdo, fan-out a múltiples consumidores (backend WebRTC y recording simultáneos).", 5760)] }),
            new TableRow({ children: [cell("inference-worker", 2200), cell("/tmp/inference.sock", 1400), cell("Ultralytics YOLO v11 con tracking BotSort. Carga modelo .pt o engine .engine TensorRT FP16 según selección del operador. Recarga en caliente.", 5760)] }),
            new TableRow({ children: [cell("recording-worker", 2200), cell("/tmp/recording.sock", 1400), cell("Codifica el stream de cámara a H.264 con NVENC (Jetson nvv4l2h264enc, desktop h264_nvenc) o libx264 como fallback. Idle = 0 CPU mientras no hay grabación.", 5760)] }),
            new TableRow({ children: [cell("conversion-worker", 2200), cell("/tmp/conversion.sock", 1400), cell("Construye engines TensorRT FP16 a partir de modelos .pt cuando el operador activa TensorRT en /settings. Una conversión a la vez.", 5760)] }),
          ],
        }),
        tableCaption("TABLA 1. Procesos del sistema en modo robot."),

        para("En modo servidor, el sistema ejecuta un único proceso (el backend), sin workers de captura ni inferencia. La Tabla 2 compara las funciones activas en cada modo."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Robot (Jetson Xavier)", 4680), headerCell("Servidor (PC del laboratorio)", 4680)] }),
            new TableRow({ children: [cell("ROBOT_MODE=robot, puerto 8080", 4680), cell("ROBOT_MODE=server, puerto 9090", 4680)] }),
            new TableRow({ children: [cell("SQLite (aiosqlite)", 4680), cell("PostgreSQL (psycopg async)", 4680)] }),
            new TableRow({ children: [cell("Captura de video, inferencia, grabación, conversión TensorRT", 4680), cell("Autenticación JWT con roles", 4680)] }),
            new TableRow({ children: [cell("WebRTC streaming en tiempo real", 4680), cell("Administración de modelos, usuarios y dispositivos", 4680)] }),
            new TableRow({ children: [cell("Sync push (envío de datos) y sync pull (descarga de modelos)", 4680), cell("Recepción de sincronización y distribución de modelos", 4680)] }),
            new TableRow({ children: [cell("Sin autenticación (red local aislada)", 4680), cell("Login con usuario y contraseña", 4680)] }),
          ],
        }),
        tableCaption("TABLA 2. Funciones activas por modo de operación."),

        heading2("Razones para la separación en procesos"),
        para("La descomposición en backend más cuatro workers obedece a un conjunto de problemas concretos identificados durante la integración."),
        bulletRuns([{ text: "Aislamiento de fallos, ", bold: true }, "debido a que un error en el modelo YOLO o un cierre inesperado de la cámara dejaba el backend en un estado no recuperable. Con procesos separados, el fallo de un worker se contiene y systemd lo reinicia sin afectar el streaming ni la API."]),
        bulletRuns([{ text: "Desacoplamiento de tasas de frame, ", bold: true }, "debido a que la captura opera a 30 FPS y la inferencia opera a un ritmo menor. Cuando ambos compartían proceso, el buffer de video se acumulaba y aparecía un retardo creciente entre la realidad y la imagen mostrada al operador. Con workers separados, cada uno consume frames al ritmo que su GPU permite."]),
        bulletRuns([{ text: "Acceso único al dispositivo de cámara, ", bold: true }, "debido a que V4L2 no permite múltiples consumidores sobre el mismo /dev/video. El camera-worker abre la cámara una sola vez y reparte cada frame a sus clientes (WebRTC y grabación) por colas independientes con descarte del frame más antiguo si un consumidor se atrasa."]),
        bulletRuns([{ text: "Aislamiento de memoria GPU, ", bold: true }, "debido a que PyTorch, NVENC y TensorRT compiten por VRAM en la Jetson Xavier (8 GB compartida con sistema). Mantener cada uso en un proceso distinto permite delimitar el consumo y reiniciar uno sin tocar a los demás."]),
        bulletRuns([{ text: "Compatibilidad de versiones de Python, ", bold: true }, "debido a que JetPack 5.1 solo provee PyTorch CUDA y los bindings de TensorRT para Python 3.8 del sistema, mientras que el backend requiere Python 3.13 para utilizar las versiones actuales de FastAPI y SQLAlchemy async. Cada worker corre en el intérprete que su stack exige; el conversion-worker hereda tensorrt del sistema mediante --system-site-packages."]),
        bulletRuns([{ text: "Costo cero en reposo, ", bold: true }, "debido a que el recording-worker y el conversion-worker permanecen sin abrir cámara ni cargar modelos hasta recibir un comando. Esto evita ocupar NVENC, GPU y memoria mientras la sesión está inactiva."]),
        bulletRuns([{ text: "Recarga del modelo sin interrumpir el streaming, ", bold: true }, "debido a que el inference-worker acepta el comando reload_model y carga un nuevo .pt o .engine sin reiniciar. Aplica tras una sincronización del servidor o tras una conversión TensorRT recién terminada."]),
        bulletRuns([{ text: "Monitoreo independiente, ", bold: true }, "debido a que cada proceso es una unidad systemd separada con su propio journal. Los comandos make logs, make logs-camera, make logs-inference, make logs-recording y make logs-conversion exponen el flujo de cada componente."]),

        ...(demoImg ? [
          emptyLine(),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [new ImageRun({ type: "jpg", data: demoImg,
              transformation: { width: 520, height: 293 },
              altText: { title: "Demo detección", description: "Captura del módulo de visión con detección en tiempo real", name: "demo" } })],
          }),
          new Paragraph({
            spacing: { before: 80, after: 200 },
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "FIGURA 2. Módulo de visión operando sobre el robot móvil. La detección (bounding box verde) y la línea de conteo se renderizan sobre el video transmitido por WebRTC. El stream sostiene 1080p a 30 FPS y la inferencia con engine TensorRT FP16 alcanza 19 FPS sobre la Jetson Xavier.", font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
          }),
        ] : []),

        heading2("Protocolo de comunicación interna"),
        para("Todos los workers exponen un socket Unix con un protocolo binario simple length-prefixed. Cada mensaje se compone de un encabezado que indica los largos de los segmentos siguientes (JSON de control y, opcionalmente, un payload binario como un frame BGR o JPEG), seguido de esos segmentos. Esta uniformidad permite reutilizar el mismo cliente con pequeñas adaptaciones por worker."),
        para("El flujo principal entre la cámara, el backend y la inferencia opera de la siguiente manera."),
        numberedItemRuns(nProtocolo, [{ text: "El camera-worker abre la cámara V4L2 ", bold: true }, "una sola vez al recibir la primera conexión y publica un handshake JSON inicial con (width, height, channels, fps). A continuación entrega un stream de frames raw BGR length-prefixed."]),
        numberedItemRuns(nProtocolo, [{ text: "El backend lee frames del camera-worker, ", bold: true }, "los codifica como JPEG y los envía al inference-worker por /tmp/inference.sock junto con un JSON de configuración (clase objetivo, umbral de confianza)."]),
        numberedItemRuns(nProtocolo, [{ text: "El inference-worker ejecuta YOLO ", bold: true }, "(PyTorch o TensorRT, según el modelo cargado) con tracking BotSort y responde un JSON con la lista de detecciones, los track_id y el conteo total."]),
        numberedItemRuns(nProtocolo, [{ text: "El backend reenvía las detecciones al frontend ", bold: true }, "por el data channel de WebRTC, donde se renderizan superpuestas al video."]),
        numberedItemRuns(nProtocolo, [{ text: "El recording-worker, si hay sesión activa, ", bold: true }, "se conecta de forma independiente al camera-worker y consume su propia copia del stream para encodear con NVENC sin pasar por el backend."]),
        emptyLine(),
        para("El backend también puede emitir comandos de control sobre los mismos sockets. Los más relevantes son reload_model hacia el inference-worker (carga un nuevo archivo de modelo sin reiniciar), start y stop hacia el recording-worker (controlan la grabación de la sesión), convert hacia el conversion-worker (encola un build TensorRT) y reload hacia /tmp/camera-control.sock cuando el operador cambia la resolución desde el frontend."),

        // ============================================================
        // III. OPTIMIZACIONES DE INFERENCIA EN TIEMPO REAL
        // ============================================================
        heading1("III. OPTIMIZACIONES DE INFERENCIA EN TIEMPO REAL"),
        para("Las versiones iniciales de la plataforma sostenían inferencia YOLO a aproximadamente 13 FPS sobre la Jetson Xavier. Las iteraciones posteriores incorporaron tres optimizaciones que en conjunto elevaron el rendimiento efectivo y aliviaron el cuello de botella entre captura y detección. Esta sección documenta cada una con sus resultados medidos."),

        heading2("Aceleración de YOLO con TensorRT FP16"),
        para("El inference-worker original cargaba modelos .pt directamente con Ultralytics YOLO sobre PyTorch CUDA. La latencia por frame era suficiente para alimentar la detección a 13 FPS, pero dejaba sin uso parte de la capacidad de los Tensor Cores de la Jetson. La integración de TensorRT FP16 redujo la latencia por frame a alrededor de 51 ms, equivalentes a 19,5 FPS sostenidos sobre 600 frames de muestra."),
        para("El proceso completo se gestiona desde la interfaz, sin intervención por terminal. El operador activa o desactiva TensorRT por modelo desde la card 'Modelos asignados' en /settings."),
        numberedItemRuns(nTensorrt, [{ text: "El operador presiona el toggle TensorRT ", bold: true }, "para un modelo asignado al robot. El frontend hace PUT /api/models/{uuid}/tensorrt con tensorrt_enabled=true."]),
        numberedItemRuns(nTensorrt, [{ text: "El backend valida el estado, ", bold: true }, "calcula la ruta de cache (data/robot/models/<stem>.<sha256>.fp16.engine) y, si el engine no existe, encola la conversión vía /tmp/conversion.sock. El campo engine_status pasa a converting."]),
        numberedItemRuns(nTensorrt, [{ text: "El conversion-worker ejecuta ", bold: true }, "model.export(format='engine', half=True, imgsz=640) sobre la GPU usando los bindings de TensorRT que JetPack provee al sistema. Una conversión a la vez; la segunda solicitud retorna 409."]),
        numberedItemRuns(nTensorrt, [{ text: "Un poller asíncrono en el backend ", bold: true }, "consulta cada 5 s el estado del worker mientras hay conversiones en curso, transcribe el resultado a la base de datos y, cuando finaliza, recarga el inference-worker apuntando al .engine si el modelo es el activo."]),
        numberedItemRuns(nTensorrt, [{ text: "El frontend hace polling al backend ", bold: true }, "y muestra los estados (PyTorch, En cola, Convirtiendo, TensorRT FP16, Error) con badges. Sobre error ofrece un botón Reintentar."]),
        emptyLine(),
        para("La cache por hash sha256 del archivo .pt invalida automáticamente el engine cuando el modelo se reentrena y se reemplaza. Apagar el toggle preserva el archivo .engine en disco; volver a encenderlo recarga el cache sin recompilar. La Tabla 3 resume el rendimiento medido."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3120, 2080, 2080, 2080],
          rows: [
            new TableRow({ children: [headerCell("Backend de inferencia", 3120), headerCell("Latencia p50", 2080), headerCell("Latencia p99", 2080), headerCell("FPS efectivo", 2080)] }),
            new TableRow({ children: [cell("PyTorch FP32 (.pt) sobre CUDA", 3120), cell("~75 ms", 2080), cell("~85 ms", 2080), cell("~13", 2080)] }),
            new TableRow({ children: [cell("TensorRT FP16 (.engine)", 3120), cell("50,9 ms", 2080), cell("57,0 ms", 2080), cell("19,5", 2080)] }),
          ],
        }),
        tableCaption("TABLA 3. Rendimiento de inferencia YOLO sobre Jetson Xavier (medido sobre 600 frames a 640x640)."),

        heading2("Fan-out de cámara con un único acceso V4L2"),
        para("El camera-worker centraliza la apertura del dispositivo y reparte el stream a los consumidores que se conectan. Cada cliente recibe su propia cola; si uno se atrasa (por ejemplo, una red WiFi débil que retiene el frame WebRTC), el worker descarta el frame más antiguo de esa cola y conserva el más reciente, sin afectar al resto. Esto permite que la grabación local con NVENC y el streaming WebRTC operen en simultáneo a 1080p y 30 FPS sin que uno degrade al otro, y resuelve la imposibilidad de abrir /dev/video desde dos procesos a la vez."),
        para("La cámara por defecto es la ZED 2i en modo estéreo SBS (3840x1080, formato YUYV) a 30 FPS. El worker recorta al ojo izquierdo y entrega un frame BGR de 1920x1080 a sus consumidores."),

        heading2("Selector de resolución 720p y 1080p en línea"),
        para("El operador puede alternar entre 1080p y 720p desde el módulo Vision sin reiniciar servicios ni acceder al robot por SSH. La resolución activa se persiste en data/robot/camera_settings.json. Al cambiar el preset, el backend hace ping a /tmp/camera-control.sock y el camera-worker reabre V4L2 con la nueva configuración."),
        numberedItemRuns(nResol, [{ text: "1080p sostiene 1920x1080 a 30 FPS, ", bold: true }, "tanto en WebRTC como en grabación. Es el preset por defecto y aprovecha el bitrate de 12 Mbps en NVENC."]),
        numberedItemRuns(nResol, [{ text: "720p reduce a 1280x720 a 30 FPS, ", bold: true }, "con bitrate de 8 Mbps en NVENC. Es el preset recomendado cuando la red WiFi entre el robot y el dispositivo del operador es débil."]),
        emptyLine(),
        para("Si el archivo de configuración falta o presenta un valor inválido, el worker hace fallback a 1080p."),

        heading2("Grabación H.264 por hardware con detección automática de backend"),
        para("El recording-worker permanece en reposo hasta recibir el comando start. Al iniciar, se conecta al camera-worker, selecciona el codificador disponible y emite un archivo MP4 fragmentado por sesión. La selección de backend es automática y prioriza el hardware sobre la CPU."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3120, 3120, 3120],
          rows: [
            new TableRow({ children: [headerCell("Plataforma", 3120), headerCell("Codificador", 3120), headerCell("Bitrate (1080p / 720p)", 3120)] }),
            new TableRow({ children: [cell("Jetson Xavier (GStreamer)", 3120), cell("nvv4l2h264enc", 3120), cell("12 / 8 Mbps", 3120)] }),
            new TableRow({ children: [cell("Desktop NVIDIA (PyAV)", 3120), cell("h264_nvenc", 3120), cell("12 / 8 Mbps", 3120)] }),
            new TableRow({ children: [cell("Sin GPU (PyAV fallback)", 3120), cell("libx264", 3120), cell("9 / 6 Mbps", 3120)] }),
          ],
        }),
        tableCaption("TABLA 4. Backends de codificación seleccionados por el recording-worker."),
        para("Sobre Jetson, el plugin nvv4l2h264enc se entrega con el paquete nvidia-l4t-gstreamer de JetPack. El script de despliegue verifica con gst-inspect-1.0 que el plugin esté disponible antes de habilitar la unidad systemd."),

        // ============================================================
        // IV. STACK TECNOLÓGICO
        // ============================================================
        heading1("IV. STACK TECNOLÓGICO"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2600, 6760],
          rows: [
            new TableRow({ children: [headerCell("Componente", 2600), headerCell("Tecnología", 6760)] }),
            new TableRow({ children: [cell("Backend", 2600), cell("FastAPI, Uvicorn, Python 3.13, SQLAlchemy async, Alembic", 6760)] }),
            new TableRow({ children: [cell("Camera worker", 2600), cell("Python 3.8, OpenCV (V4L2), numpy, asyncio", 6760)] }),
            new TableRow({ children: [cell("Inference worker", 2600), cell("Python 3.8, Ultralytics YOLO v11, PyTorch CUDA, TensorRT FP16, BotSort", 6760)] }),
            new TableRow({ children: [cell("Recording worker", 2600), cell("Python 3.10, PyAV, GStreamer (nvv4l2h264enc), NVENC", 6760)] }),
            new TableRow({ children: [cell("Conversion worker", 2600), cell("Python 3.8 con --system-site-packages, Ultralytics export, TensorRT (JetPack)", 6760)] }),
            new TableRow({ children: [cell("Frontend", 2600), cell("React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui", 6760)] }),
            new TableRow({ children: [cell("Streaming de video", 2600), cell("WebRTC mediante aiortc, codificación H.264 NVENC", 6760)] }),
            new TableRow({ children: [cell("Base de datos", 2600), cell("SQLite con aiosqlite (robot), PostgreSQL con psycopg async (servidor)", 6760)] }),
            new TableRow({ children: [cell("Comunicación interna", 2600), cell("Sockets Unix, protocolo binario length-prefixed (un socket por worker)", 6760)] }),
            new TableRow({ children: [cell("Proxy y web server", 2600), cell("nginx (proxy inverso y archivos estáticos del frontend)", 6760)] }),
            new TableRow({ children: [cell("Gestión de servicios", 2600), cell("systemd, una unidad por proceso, Restart=on-failure", 6760)] }),
            new TableRow({ children: [cell("Gestión de dependencias", 2600), cell("uv (Python, un venv por worker), npm (Node.js)", 6760)] }),
          ],
        }),
        tableCaption("TABLA 5. Stack tecnológico de la plataforma."),

        // ============================================================
        // V. BACKEND
        // ============================================================
        heading1("V. BACKEND"),
        paraRuns(["El backend es una aplicación ", { text: "FastAPI", bold: true }, " que expone la API REST, gestiona la conexión WebRTC y coordina a los cuatro workers. Sus funciones principales se describen a continuación."]),

        heading2("Transmisión de video en tiempo real"),
        para("El backend lee frames del camera-worker y los retransmite al frontend por WebRTC con codificación H.264 acelerada en hardware. El pipeline opera en etapas desacopladas: lectura del camera-worker, envío de JPEG al inference-worker en un hilo secundario, y transmisión por WebRTC. Los resultados de detección viajan por un data channel separado como JSON, lo que permite que el video fluya a 30 FPS independientemente de la velocidad de inferencia."),

        heading2("Gestión de sesiones de conteo"),
        para("El backend gestiona el ciclo de vida de una sesión de conteo. El operador inicia una sesión indicando la clase objetivo y el sistema cuenta objetos en tiempo real mediante cruce de línea. Al iniciar la sesión, el backend ordena al recording-worker que empiece a grabar el stream de la cámara; al finalizarla, ordena el cierre y persiste el archivo asociado a la sesión. Los datos quedan asociados a un camellón, un robot y un modelo YOLO, y pueden consultarse por fecha o exportarse en CSV."),

        heading2("Configuración del sistema"),
        para("El backend permite configurar la cámara (dispositivo, resolución, recorte estéreo), los parámetros de conteo (modo vertical u horizontal, posición de la línea, dirección) y los modelos asignados al robot. La activación de TensorRT por modelo se gestiona desde la card 'Modelos asignados' en /settings (visible solo en modo robot). La configuración inicial (URL del servidor central y API key del dispositivo) se realiza una sola vez desde una página de setup en el primer arranque."),

        heading2("Sincronización con el servidor central"),
        para("En modo robot, el backend ejecuta un loop de sincronización en segundo plano que se activa cuando detecta conectividad. Este proceso envía los datos locales al servidor (sesiones, eventos, camellones) y descarga los modelos YOLO activos. El detalle del protocolo se documenta en la sección VIII."),

        heading2("Autenticación y administración"),
        para("En modo servidor, el backend protege los endpoints con autenticación JWT. Los usuarios se autentican con usuario y contraseña y el token incluye su rol (admin o viewer) y empresa asociada. Los usuarios viewer solo acceden a datos de su empresa. El modo robot no requiere autenticación, dado que opera en una red local aislada. El servidor también expone funciones de administración para gestionar usuarios, empresas, fundos, modelos y dispositivos. Los endpoints de sincronización se protegen con API key del dispositivo."),

        // ============================================================
        // VI. WORKERS
        // ============================================================
        heading1("VI. WORKERS"),
        para("Los cuatro workers son proyectos uv independientes ubicados en directorios separados (camera_worker/, inference/, recording_worker/, conversion_worker/). Cada uno mantiene su propio pyproject.toml y entorno virtual, lo que evita conflictos de dependencias entre las versiones de Python que cada stack requiere."),

        heading2("camera-worker"),
        para("Captura de video desde V4L2 con OpenCV. Mantiene una sola apertura del dispositivo y reparte cada frame a los clientes conectados con colas independientes. Soporta cambio de resolución en línea por /tmp/camera-control.sock. La configuración por defecto es ZED 2i estéreo SBS 3840x1080 YUYV a 30 FPS, con crop automático al ojo izquierdo y salida BGR 1920x1080 (o 1280x720 según el preset)."),

        heading2("inference-worker"),
        para("Detección y tracking con Ultralytics YOLO v11 más BotSort. Acepta tanto archivos .pt (PyTorch CUDA) como .engine (TensorRT FP16). Recibe imágenes JPEG del backend por /tmp/inference.sock, ejecuta inferencia en GPU y retorna las detecciones con su track_id. Soporta el comando reload_model para alternar entre modelos sin reiniciar el proceso."),

        heading2("recording-worker"),
        para("Codificación H.264 por hardware con selección automática de backend (nvv4l2h264enc en Jetson, h264_nvenc en desktop NVIDIA, libx264 como fallback). Permanece en reposo hasta recibir el comando start; en idle no consume CPU, NVENC, ni mantiene conexión con la cámara. El bitrate se autoescala según la altura del frame (12 Mbps a 1080p, 8 Mbps a 720p en NVENC)."),

        heading2("conversion-worker"),
        para("Construcción de engines TensorRT FP16 a partir de modelos .pt mediante el método export() de Ultralytics. Atiende solicitudes a través de /tmp/conversion.sock y procesa una conversión a la vez (la segunda obtiene 409). El nombre del engine en cache embebe el sha256 del .pt para invalidar automáticamente cuando el modelo se reentrena. En la Jetson, su entorno se construye con uv venv --system-site-packages para heredar los bindings de tensorrt que provee JetPack a través del paquete python3-libnvinfer."),

        // ============================================================
        // VII. FRONTEND
        // ============================================================
        heading1("VII. FRONTEND"),
        para("El frontend es una aplicación React 19 con TypeScript que se compila a archivos estáticos servidos por nginx. La interfaz se adapta automáticamente según el modo de operación y el rol del usuario."),
        para("En modo robot, la interfaz principal es el módulo de visión. El operador visualiza el video en tiempo real con las detecciones superpuestas, configura la línea de conteo, selecciona el camellón y la clase objetivo, alterna la resolución entre 1080p y 720p, e inicia sesiones de conteo. La página /settings expone la card 'Modelos asignados', donde se activa TensorRT por modelo. Al activar el toggle, el frontend hace polling cada 5 segundos para reflejar el estado de la conversión hasta que el engine quede listo."),
        para("En modo servidor, la interfaz incluye un sistema de login con JWT y páginas de administración para usuarios, empresas, fundos, modelos y dispositivos. Los usuarios viewer ven solo datos de su empresa. Ambos modos comparten el módulo de mapa (Google Maps con la ubicación de fundos y conteos acumulados) y el módulo de dashboard (indicadores y tendencias por fecha y camellón)."),

        // ============================================================
        // VIII. CONTEO POR CRUCE DE LÍNEA
        // ============================================================
        heading1("VIII. CONTEO POR CRUCE DE LÍNEA"),
        para("El sistema combina detección por YOLO con tracking de objetos (BotSort) y un algoritmo de cruce de línea para contar frutos que atraviesan una línea virtual configurada por el operador."),

        heading2("Algoritmo"),
        numberedItem(nConteo, "YOLO detecta objetos en cada frame y BotSort asigna un track_id único a cada objeto rastreado."),
        numberedItem(nConteo, "El ObjectCounter mantiene dos listas internas (LIST_0 y LIST_1) que registran la posición de cada objeto respecto a la línea."),
        numberedItem(nConteo, "Cuando un objeto cruza de LIST_0 a LIST_1 en la dirección configurada, se registra un evento de conteo."),
        numberedItem(nConteo, "El track_id previene conteos duplicados; un mismo objeto solo se cuenta una vez aunque permanezca visible durante varios frames."),

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
        tableCaption("TABLA 6. Modos de conteo por cruce de línea."),

        // ============================================================
        // IX. SINCRONIZACIÓN
        // ============================================================
        heading1("IX. SINCRONIZACIÓN ROBOT-SERVIDOR"),
        para("La sincronización permite que el robot envíe los datos de conteo al servidor central y descargue modelos YOLO actualizados. Opera de forma automática cuando el robot detecta conectividad."),

        heading2("Flujo de sincronización"),
        numberedItem(nSync, "El loop de sincronización ejecuta cada 30 segundos (configurable)."),
        numberedItem(nSync, "Verifica la conectividad consultando GET /api/sync/health del servidor."),
        numberedItem(nSync, "Push: envía registros locales no sincronizados al servidor en orden de dependencia (empresas, fundos, locations, camellones, sessions, events)."),
        numberedItem(nSync, "Cada lote se envía por POST con autenticación por API key y el servidor deduplica por UUID (upsert)."),
        numberedItem(nSync, "Pull: consulta los modelos asignados al robot y descarga los faltantes o aquellos cuyo hash difiere."),
        numberedItem(nSync, "Tras descargar un modelo, envía reload_model al inference-worker para que lo cargue sin reiniciar."),

        heading2("Gestión de modelos"),
        numberedItem(nModelo, "El administrador sube un archivo .pt al servidor desde la interfaz, junto con metadatos (versión, epochs, métricas)."),
        numberedItem(nModelo, "El sistema calcula el sha256 del archivo y guarda el registro en la base de datos."),
        numberedItem(nModelo, "El administrador asigna el modelo al robot correspondiente."),
        numberedItem(nModelo, "En el siguiente ciclo, el robot detecta la asignación, descarga el .pt y recarga el worker. Si el operador tiene TensorRT activado para ese modelo, el conversion-worker construirá el engine FP16 cuando el .pt llegue."),

        // ============================================================
        // X. DESPLIEGUE
        // ============================================================
        heading1("X. DESPLIEGUE Y OPERACIÓN"),
        para("La instalación se ejecuta con un script único (deploy/install.sh) que recibe el modo de operación (robot o server). El script instala dependencias del sistema, compila el frontend, configura nginx como proxy inverso y registra una unidad systemd por proceso. En modo robot adicionalmente verifica la presencia del plugin nvv4l2h264enc para grabación NVENC y crea el venv del conversion-worker con --system-site-packages para heredar tensorrt de JetPack. En modo servidor configura PostgreSQL y ejecuta las migraciones Alembic."),
        para("Sobre el robot, systemd gestiona cinco servicios: camera-worker, inference-worker, recording-worker, conversion-worker y backend. Los workers arrancan primero, dejan listos sus sockets y el backend se levanta a continuación con dependencia explícita en ellos. Todos se reinician automáticamente ante fallos."),
        para("Desde la perspectiva del operador, el flujo es directo. Al encender el robot los servicios arrancan sin intervención manual. El operador se conecta a la red WiFi del robot desde un celular o tablet, abre un navegador en la dirección IP del robot (puerto 8080) y accede a la interfaz para iniciar sesiones de conteo."),
        para("Para la administración del robot en producción se utilizan los comandos de la Tabla 7."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3200, 6160],
          rows: [
            new TableRow({ children: [headerCell("Comando", 3200), headerCell("Descripción", 6160)] }),
            new TableRow({ children: [cell("make status", 3200), cell("Estado de los cinco servicios (backend, camera, inference, recording, conversion)", 6160)] }),
            new TableRow({ children: [cell("make restart", 3200), cell("Reinicia todos los servicios", 6160)] }),
            new TableRow({ children: [cell("make logs", 3200), cell("Logs del backend en tiempo real", 6160)] }),
            new TableRow({ children: [cell("make logs-camera", 3200), cell("Logs del camera-worker", 6160)] }),
            new TableRow({ children: [cell("make logs-inference", 3200), cell("Logs del inference-worker (incluye perf [pytorch] y perf [engine])", 6160)] }),
            new TableRow({ children: [cell("make logs-recording", 3200), cell("Logs del recording-worker", 6160)] }),
            new TableRow({ children: [cell("make logs-conversion", 3200), cell("Logs del conversion-worker (build de engines TensorRT)", 6160)] }),
            new TableRow({ children: [cell("make update", 3200), cell("Actualiza el código, recompila el frontend y reinicia los servicios", 6160)] }),
          ],
        }),
        tableCaption("TABLA 7. Comandos de operación del robot."),

        // ============================================================
        // XI. INCIDENCIAS CONOCIDAS
        // ============================================================
        heading1("XI. INCIDENCIAS CONOCIDAS"),
        para("Durante las pruebas de integración del robot móvil se han identificado las incidencias descritas en la Tabla 8."),
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [600, 2600, 3800, 2360],
          rows: [
            new TableRow({ children: [
              headerCell("#", 600), headerCell("Incidencia", 2600), headerCell("Descripción", 3800), headerCell("Impacto", 2360),
            ]}),
            new TableRow({ children: [
              cell("1", 600),
              cell("Conversión TensorRT no recupera tras reinicio del backend", 2600),
              cell("Si el backend se reinicia mientras un engine se está construyendo, la fila queda en estado converting hasta que el reconciliador de arranque la marca como error con el mensaje 'Backend reiniciado durante conversión'. El operador debe pulsar Reintentar.", 3800),
              cell("Requiere reintento manual", 2360),
            ]}),
          ],
        }),
        tableCaption("TABLA 8. Incidencias detectadas en integración."),

        // ============================================================
        // XII. FUNCIONALIDADES PENDIENTES
        // ============================================================
        heading1("XII. FUNCIONALIDADES PENDIENTES"),

        heading2("Despliegue del servidor central"),
        para("El servidor del laboratorio aún no ha sido desplegado. El script de instalación y la configuración de systemd están preparados, pero falta ejecutar la instalación en la PC del laboratorio, configurar PostgreSQL y establecer el acceso remoto. Hasta que el servidor esté operativo, la sincronización entre robots y servidor no puede ejecutarse en producción."),

        heading2("Mapa offline"),
        para("El módulo de mapa actualmente depende de conexión a internet para cargar los tiles de Google Maps. Para operación en campo sin conectividad, se requiere implementar la descarga previa de tiles y su visualización offline."),

        heading2("Cámara por red local"),
        para("Actualmente la cámara se conecta al robot por USB. Por restricciones futuras de hardware, se requiere soportar la recepción de frames desde una cámara IP a través de la red WiFi interna del robot, sin depender de conexión a internet."),

        heading2("Clasificación offline de frutos"),
        para("Pipeline post-sesión para clasificar frutos individuales detectados durante el conteo. Incluye extracción de crops por track_id (mejor frame) y clasificación con un modelo independiente de YOLO orientado a madurez, calidad o variedad."),

        heading2("Evaluación y finetuning del modelo YOLO"),
        para("Validación del modelo en sesiones de conteo reales con frutos, documentación de métricas de precisión y reentrenamiento si los resultados no alcanzan la precisión objetivo. La aceleración con TensorRT no altera la métrica de precisión del modelo, por lo que las pruebas se ejecutan indistintamente sobre el .pt o el .engine."),

        // ============================================================
        // ANEXO: MODELO DE DATOS
        // ============================================================
        heading1("ANEXO. MODELO DE DATOS"),
        para("La base de datos utiliza SQLAlchemy como ORM con soporte asíncrono. Todos los modelos incluyen un campo uuid para sincronización y un campo device_id para identificar el robot de origen. La Tabla 9 resume las entidades del sistema, incluyendo los campos agregados a DetectionModel para soportar TensorRT (tensorrt_enabled, engine_status, engine_error)."),
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
            new TableRow({ children: [cell("Recording", 1800), cell("Operación", 1800), cell("Archivo MP4 H.264 generado por el recording-worker, asociado a una sesión", 5760)] }),
            new TableRow({ children: [cell("DetectionModel", 1800), cell("Detección", 1800), cell("Modelo YOLO con archivo .pt, hash, métricas y campos TensorRT (tensorrt_enabled, engine_status: pytorch|pending|converting|ready|error, engine_error)", 5760)] }),
            new TableRow({ children: [cell("CaptureBurst", 1800), cell("Detección", 1800), cell("Ráfaga de frames capturados durante una sesión para auditoría", 5760)] }),
            new TableRow({ children: [cell("CaptureFrame", 1800), cell("Detección", 1800), cell("Frame individual con ruta al archivo JPEG y timestamp", 5760)] }),
            new TableRow({ children: [cell("FrameDetection", 1800), cell("Detección", 1800), cell("Detección dentro de un frame con bbox, confidence, class_name y track_id", 5760)] }),
            new TableRow({ children: [cell("SyncLog", 1800), cell("Sincronización", 1800), cell("Registro que asocia un UUID con marca de tiempo para controlar qué datos ya fueron enviados", 5760)] }),
            new TableRow({ children: [cell("Command", 1800), cell("Sincronización", 1800), cell("Cola de comandos del servidor hacia el robot para acciones remotas", 5760)] }),
          ],
        }),
        tableCaption("TABLA 9. Entidades del modelo de datos."),
      ],
    },
  ],
});

const OUTPUT = "/home/pqbas/labinm/robot-platform/docs/documentacion_tecnica_avance.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Generated: ${OUTPUT}`);
});
