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

// Numbered list: each call to newNumberedList() creates a fresh reference
// that restarts numbering from 1.
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

// --- Build content (so numbered list references are registered) ---

// Pre-create all numbered list references
const nVision = newNumberedList();
const nCampo1 = newNumberedList();
const nCampo2 = newNumberedList();
const nLab = newNumberedList();
const nServidor = newNumberedList();
const nFase8e1 = newNumberedList();
const nFase8e2 = newNumberedList();
const nFuturo = newNumberedList();
const nVerificacion = newNumberedList();

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
          children: [new TextRun({ text: "PLAN DE DESARROLLO E INTEGRACIÓN DE PLATAFORMA PARA LA DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS EN ENTORNOS AGRÍCOLAS", font: FONT, size: 32, bold: true, color: COLOR_PRIMARY })],
        }),
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: "Nombre del autor:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Percy Brayam Cubas Muñoz", font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Trujillo - Perú", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MARZO - 2026", font: FONT, size: 22, bold: true })] }),
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
            children: [new TextRun({ text: "Plan de Desarrollo e Integración / Robot Platform", font: FONT, size: 18, color: COLOR_GRAY })],
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

        // --- I. VISIÓN GENERAL ---
        heading1("I. VISIÓN GENERAL"),
        para("El sistema actual funciona completamente en local: el robot (Jetson Xavier) ejecuta el backend FastAPI con WebRTC y YOLO, y el operador interactúa mediante el frontend web conectado al WiFi del robot desde un celular o tablet con navegador. Los datos quedan almacenados en SQLite local y no salen del dispositivo."),
        para("El presente roadmap tiene como objetivo cerrar el ciclo operacional completo del sistema. Este ciclo comprende cuatro etapas."),
        numberedItemRuns(nVision, [{ text: "Campo. ", bold: true }, "El robot opera offline en el fundo y el operador utiliza el frontend web desde su celular."]),
        numberedItemRuns(nVision, [{ text: "Sincronización. ", bold: true }, "Cuando el robot obtiene conectividad a internet (mediante tethering o WiFi cercano), envía los datos acumulados al servidor."]),
        numberedItemRuns(nVision, [{ text: "Servidor central. ", bold: true }, "Una PC en el laboratorio recibe datos de múltiples robots y los almacena en PostgreSQL."]),
        numberedItemRuns(nVision, [{ text: "Acceso remoto. ", bold: true }, "El equipo LABINM y los clientes de la empresa acceden a datos históricos (dashboard, sesiones, CSV) vía web con autenticación."]),
        para("El sistema no requiere transmisión de video en vivo de forma remota. Se transfieren datos históricos de conteo, resultados de clasificación por fruto y, de forma manual, los crops e imágenes capturadas para auditoría y entrenamiento."),

        // --- II. MODELO DE DOMINIO ---
        heading1("II. MODELO DE DOMINIO"),
        para("El sistema organiza la información en una jerarquía de cinco niveles."),
        bulletRuns([{ text: "Empresa", bold: true }, " (ej. Danper): entidad agroindustrial que puede administrar múltiples fundos."]),
        bulletRuns([{ text: "Fundo", bold: true }, " (ej. Fundo Santa Rosa): unidad productiva que agrupa camellones o hileras donde se realizan los conteos."]),
        bulletRuns([{ text: "Camellón o hilera", bold: true }, ": subregión dentro del fundo donde se ejecuta una sesión de conteo."]),
        bulletRuns([{ text: "Sesión de conteo", bold: true }, ": registro asociado a un camellón, un robot y un modelo YOLO específico."]),
        bulletRuns([{ text: "Eventos", bold: true }, ": conteos individuales registrados dentro de una sesión."]),
        emptyLine(),
        para("Un robot rota entre fundos y empresas según las necesidades de evaluación. Las sesiones quedan asociadas al camellón, y por extensión al fundo y la empresa, así como al robot que las ejecutó."),
        heading2("Roles de usuario"),
        bulletRuns([{ text: "Administrador ", bold: true }, "(LABINM): accede a todos los datos de todas las empresas y gestiona usuarios, empresas, fundos y robots."]),
        bulletRuns([{ text: "Viewer ", bold: true }, "(cliente de empresa): accede únicamente a los datos de su empresa, incluyendo dashboard, mapa y exportación CSV."]),

        // --- III. FLUJOS OPERATIVOS ---
        heading1("III. FLUJOS OPERATIVOS"),

        heading2("Antes de ir a campo (administrador, en el servidor)"),
        numberedItem(nCampo1, "Crear la empresa en el sistema si no existe previamente."),
        numberedItem(nCampo1, "Crear el fundo asociado a la empresa, asignar el tipo de fruta y, opcionalmente, asociar una región geográfica en el mapa."),
        numberedItem(nCampo1, "Verificar que el modelo YOLO correspondiente al tipo de fruta se encuentra subido y activo en el servidor."),
        numberedItemRuns(nCampo1, ["Los camellones ", { text: "no se crean en esta etapa", bold: true }, ", dado que su identificación se realiza directamente en campo según las condiciones encontradas por el operador."]),

        heading2("En campo (operador, en el robot sin internet)"),
        numberedItem(nCampo2, "Conectarse al punto de acceso WiFi del robot desde un celular o tablet."),
        numberedItem(nCampo2, "Abrir el frontend web y seleccionar el fundo correspondiente, previamente precargado desde el servidor."),
        numberedItemRuns(nCampo2, [{ text: "Crear el camellón ", bold: true }, "directamente en el frontend si no existe. El operador define los camellones sobre la marcha según las condiciones encontradas en el fundo."]),
        numberedItem(nCampo2, "Iniciar la sesión de conteo en el camellón seleccionado."),
        numberedItem(nCampo2, "Finalizar la sesión. Los datos quedan almacenados en SQLite local."),
        emptyLine(),
        paraRuns([{ text: "El mapa es complementario, no bloqueante. ", bold: true }, "La interfaz de Google Maps no es un requisito para la operación. Si no se dispone de tiles precargados, la interfaz presenta listas de fundos y camellones como alternativa funcional."]),

        heading2("De vuelta en el laboratorio (sincronización)"),
        numberedItem(nLab, "El robot detecta conectividad a internet y sincroniza datos de forma automática, incluyendo sesiones, eventos y camellones creados en campo."),
        numberedItem(nLab, "El administrador activa la sincronización de frames de manera manual si requiere auditar las detecciones realizadas."),
        numberedItem(nLab, "Los camellones creados en campo aparecen en el servidor correctamente asociados al fundo correspondiente."),

        heading2("En el servidor (administrador o viewer, con internet)"),
        numberedItem(nServidor, "El dashboard muestra datos históricos de todos los robots y fundos registrados."),
        numberedItem(nServidor, "Los usuarios con rol viewer acceden únicamente a los datos de su empresa."),
        numberedItem(nServidor, "El administrador puede revisar los frames capturados con las detecciones superpuestas para fines de auditoría."),
        numberedItem(nServidor, "Es posible exportar los resultados de conteo en formato CSV."),

        // --- IV. ARQUITECTURA ---
        heading1("IV. ARQUITECTURA"),
        paraRuns(["El sistema opera con un único codebase (", { text: "back/", italics: true }, ") cuyo comportamiento se diferencia mediante la variable de entorno ", { text: "ROBOT_MODE", bold: true }, ", que admite los valores ", { text: "robot", italics: true }, " y ", { text: "server", italics: true }, ". La Tabla 1 resume los componentes de cada modo."]),
        emptyLine(),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [headerCell("Robot (Jetson Xavier)", 4680), headerCell("Servidor (PC del Lab)", 4680)] }),
            new TableRow({ children: [cell("ROBOT_MODE=robot", 4680), cell("ROBOT_MODE=server", 4680)] }),
            new TableRow({ children: [cell("SQLite", 4680), cell("PostgreSQL", 4680)] }),
            new TableRow({ children: [cell("Cámara + YOLO", 4680), cell("Autenticación JWT", 4680)] }),
            new TableRow({ children: [cell("WebRTC streaming", 4680), cell("Cloudflare Tunnel", 4680)] }),
            new TableRow({ children: [cell("Sincronización push (background task)", 4680), cell("Recepción de sincronización", 4680)] }),
          ],
        }),
        tableCaption("TABLA 1. Componentes por modo de operación."),

        para("El operador en campo se conecta al punto de acceso WiFi local del robot desde un celular o tablet mediante navegador. Los usuarios remotos (equipo LABINM y clientes) acceden al servidor a través de internet."),

        // --- V. CRONOGRAMA ---
        heading1("V. CRONOGRAMA DE DESARROLLO"),
        para("El desarrollo se organiza en nueve fases, cada una con una duración estimada de una semana. La disponibilidad de trabajo es de 3 a 4 horas diarias (de 18:00 a 22:00), equivalentes a 15 a 20 horas semanales. La Tabla 2 presenta el cronograma completo."),

        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [1200, 3600, 2800, 1760],
          rows: [
            new TableRow({ children: [headerCell("Semana", 1200), headerCell("Fase", 3600), headerCell("Descripción", 2800), headerCell("Dependencia", 1760)] }),
            new TableRow({ children: [cell("1", 1200), cell("Fase 1: Desacoplamiento del pipeline", 3600), cell("Separar streaming, inferencia YOLO y captura de frames", 2800), cell("Ninguna", 1760)] }),
            new TableRow({ children: [cell("2", 1200), cell("Fase 2: Base de datos e identidad", 3600), cell("UUIDs, device_id, modelos Empresa, Fundo, migración", 2800), cell("Fase 1", 1760)] }),
            new TableRow({ children: [cell("3", 1200), cell("Fase 3: Sincronización", 3600), cell("Sincronización bidireccional: envío de datos y descarga de modelos YOLO", 2800), cell("Fase 2", 1760)] }),
            new TableRow({ children: [cell("4", 1200), cell("Fase 4: Autenticación", 3600), cell("Login JWT, API keys, roles administrador/viewer", 2800), cell("Fase 2", 1760)] }),
            new TableRow({ children: [cell("5", 1200), cell("Fase 5: Frontend del servidor", 3600), cell("Login, rutas protegidas, filtros, gestión de modelos", 2800), cell("Fase 4", 1760)] }),
            new TableRow({ children: [cell("6", 1200), cell("Fase 6: Clasificación offline", 3600), cell("Pipeline post-sesión: crops por fruto único, clasificación", 2800), cell("Fase 2", 1760)] }),
            new TableRow({ children: [cell("7", 1200), cell("Fase 7: Despliegue", 3600), cell("Docker, Cloudflare Tunnel, setup de Jetson", 2800), cell("Fases 3,4,5,6", 1760)] }),
            new TableRow({ children: [cell("8", 1200), cell("Fase 8: Integración en laboratorio", 3600), cell("Ciclo completo y pruebas en universidad", 2800), cell("Fase 7", 1760)] }),
            new TableRow({ children: [cell("9", 1200), cell("Fase 9: Evaluación YOLO", 3600), cell("Evaluar precisión del modelo y reentrenar si es necesario", 2800), cell("Fase 8", 1760)] }),
          ],
        }),
        tableCaption("TABLA 2. Cronograma de desarrollo: 9 fases en 9 semanas."),

        paraRuns(["Las pruebas en campo con empresas agroindustriales se coordinan de forma independiente una vez completada la validación en la universidad, dado que requieren gestión logística con la empresa y se encuentran ", { text: "fuera del alcance de este cronograma", bold: true }, "."]),

        // --- VI. DETALLE DE FASES ---
        heading1("VI. DETALLE DE FASES"),

        // Fase 1
        heading2("Fase 1: Desacoplamiento del pipeline"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Separar el streaming de video, la inferencia YOLO y la captura de frames en hilos independientes, de modo que la falla o lentitud de un componente no afecte a los demás."]),
        heading3("Problema actual"),
        paraRuns(["En la implementación actual, el método ", { text: "recv()", italics: true }, " de ", { text: "camera.py", italics: true }, " ejecuta tres operaciones en secuencia: captura del frame, inferencia YOLO (con latencia de 30 a 100 ms por frame) y transmisión por WebRTC. Esta arquitectura implica que si YOLO falla, el stream se interrumpe; y si YOLO opera con lentitud, el stream se congela."]),
        heading3("Arquitectura propuesta"),
        bulletRuns([{ text: "Hilo 1 (streaming). ", bold: true }, "Captura frames de la cámara y los transmite por WebRTC. No se interrumpe bajo ninguna circunstancia."]),
        bulletRuns([{ text: "Hilo 2 (inferencia). ", bold: true }, "YOLO consume frames desde una cola, genera detecciones y las envía por el data channel de WebRTC."]),
        bulletRuns([{ text: "Hilo 3 (persistencia). ", bold: true }, "Codifica frames en formato JPEG, los almacena en disco e inserta los registros correspondientes en la base de datos. Opera en ráfagas periódicas."]),
        heading3("Metas de fase"),
        bullet("El stream funciona de manera independiente a YOLO."),
        bullet("Si YOLO falla, el stream continúa y las detecciones se pausan temporalmente."),
        bullet("La captura de frames no afecta el framerate del stream."),
        emptyLine(),

        // Fase 2
        heading2("Fase 2: Base de datos e identidad"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Incorporar UUIDs, identificación de dispositivos y modelos de Empresa, Fundo y tipo de fruta para soportar operación multi-robot y sincronización."]),
        heading3("Cambios principales"),
        bullet("Se agrega uuid (único) y device_id a los modelos Camellon, Session, Event y Location."),
        bullet("El device_id se obtiene automáticamente del número de serie del hardware de la Jetson."),
        bullet("Se crean doce nuevos modelos: empresas, fruit_types, yolo_models, fundos, devices, users, capture_bursts, capture_frames, frame_detections, fruit_crops, fruit_classifications y sync_log."),
        heading3("Modelo yolo_models"),
        para("Este modelo almacena trazabilidad completa de cada versión del modelo YOLO: tipo de fruta, versión, clases detectadas (extraídas automáticamente del archivo .pt), número de épocas de entrenamiento, mAP@0.5, mAP@0.5:0.95, precisión, recall, tamaño del dataset, notas del AI Engineer y usuario que lo subió."),
        heading3("Captura de frames"),
        para("Durante una sesión de conteo, el robot almacena ráfagas de aproximadamente 60 frames a intervalos regulares. Cada frame se almacena como JPEG sin anotaciones y las detecciones se registran como datos estructurados independientes. Este diseño permite auditoría por parte del cliente, generación de datos de entrenamiento, evaluación comparativa entre versiones del modelo y análisis de casos de fallo."),
        para("La sincronización de frames no se ejecuta de forma automática. El administrador debe activarla manualmente desde el dashboard del robot, idealmente de vuelta en el laboratorio con buena conectividad."),
        heading3("Metas de fase"),
        bullet("Los modelos existentes incorporan uuid y device_id."),
        bullet("Los modelos Empresa, Fundo, FruitType y YoloModel se encuentran operativos."),
        bullet("Los modelos de captura (capture_bursts, capture_frames, frame_detections) están implementados."),
        bullet("La migración de base de datos se ejecuta sin errores."),
        emptyLine(),

        // Fase 3
        heading2("Fase 3: Protocolo de sincronización"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Implementar sincronización bidireccional con cola de comandos: el robot envía datos al servidor, descarga modelos YOLO actualizados y ejecuta comandos remotos."]),
        heading3("Principios de diseño"),
        bulletRuns([{ text: "Push de datos. ", bold: true }, "El robot envía sesiones y eventos al servidor, dado que se encuentra detrás de NAT y no puede recibir conexiones entrantes."]),
        bulletRuns([{ text: "Pull de modelos. ", bold: true }, "El robot descarga pesos YOLO nuevos publicados en el servidor."]),
        bulletRuns([{ text: "Pull de comandos. ", bold: true }, "El robot consulta si el servidor tiene comandos pendientes (por ejemplo, solicitar frames de una sesión específica)."]),
        bulletRuns([{ text: "Idempotencia. ", bold: true }, "Se utilizan UUIDs para deduplicación; reenviar datos es una operación sin efecto."]),
        bulletRuns([{ text: "Orden de dependencia. ", bold: true }, "El envío sigue un orden estricto: empresas, fundos, locations, camellones, sessions, events."]),
        bulletRuns([{ text: "Frames bajo demanda. ", bold: true }, "La sincronización de frames se activa remotamente desde el servidor mediante la cola de comandos. No requiere acceso a la red local del robot."]),
        heading3("Cola de comandos remotos"),
        para("Dado que el robot se encuentra detrás de NAT, el servidor no puede iniciar conexiones hacia él. La cola de comandos resuelve este problema: el administrador o AI Engineer publica un comando desde el dashboard del servidor, y el robot lo consulta y ejecuta en el siguiente ciclo de sincronización."),
        para("Este mecanismo habilita un ciclo de mejora continua completamente remoto. El AI Engineer revisa los resultados en el dashboard, solicita frames de sesiones con problemas, los descarga del servidor para re-etiquetar y reentrenar el modelo, y publica la nueva versión. El robot la descarga automáticamente en el siguiente ciclo. Ningún paso requiere presencia física en el laboratorio después del setup inicial."),
        heading3("Metas de fase"),
        bullet("El robot detecta conectividad y envía datos de forma automática."),
        bullet("El robot captura ráfagas de frames con detecciones durante el conteo."),
        bullet("El servidor recibe, deduplica e inserta los datos recibidos."),
        bullet("El robot descarga modelos YOLO nuevos o actualizados desde el servidor."),
        bullet("La cola de comandos permite solicitar frames remotamente sin acceso a la red local del robot."),
        bullet("La resincronización no genera registros duplicados."),
        emptyLine(),

        // Fase 4
        heading2("Fase 4: Sistema de autenticación"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Implementar autenticación basada en JWT para usuarios del servidor y API key para robots."]),
        heading3("Componentes de autenticación"),
        bullet("Funciones de hash y verificación de contraseñas mediante bcrypt (passlib)."),
        bullet("Generación de tokens JWT con campos sub (username), role, empresa_uuid y exp."),
        bullet("Dependency de FastAPI para decodificar JWT y obtener el usuario actual."),
        bullet("Dependency de verificación de rol para restringir acceso a funciones administrativas."),
        bullet("Dependency de verificación de API key para autenticar robots en los endpoints de sincronización."),
        heading3("Endpoints de administración"),
        bullet("Operaciones CRUD de usuarios, empresas y fundos."),
        bullet("Gestión de tipos de fruta y modelos YOLO, incluyendo carga de archivos .pt y activación de versiones."),
        bullet("Filtrado automático por empresa para usuarios con rol viewer."),
        heading3("Metas de fase"),
        bullet("El endpoint de login retorna un JWT válido."),
        bullet("El administrador puede crear empresas, fundos, tipos de fruta y usuarios."),
        bullet("El administrador puede cargar modelos YOLO y activar o desactivar versiones."),
        bullet("Los usuarios con rol viewer acceden únicamente a datos de su empresa."),
        bullet("La API key autentica robots en los endpoints de sincronización."),
        emptyLine(),

        // Fase 5
        heading2("Fase 5: Frontend del servidor"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Implementar login, rutas protegidas y una interfaz adaptada al rol del usuario."]),
        heading3("Componentes nuevos"),
        bullet("Contexto de autenticación (AuthContext) con estado de token, usuario, rol y empresa."),
        bullet("Página de login, componente de ruta protegida y menú de usuario."),
        bullet("Páginas de administración: usuarios, empresas, dispositivos y modelos."),
        bullet("Visor de frames capturados con detecciones renderizadas sobre la imagen para auditoría."),
        heading3("Visibilidad por rol"),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2340, 2340, 2340, 2340],
          rows: [
            new TableRow({ children: [headerCell("Página", 2340), headerCell("Administrador", 2340), headerCell("Viewer", 2340), headerCell("Modo robot", 2340)] }),
            new TableRow({ children: [cell("Dashboard", 2340), cell("Sí", 2340), cell("Sí (filtrado)", 2340), cell("Sí (sin auth)", 2340)] }),
            new TableRow({ children: [cell("Mapa", 2340), cell("Sí", 2340), cell("Sí (filtrado)", 2340), cell("Sí (sin auth)", 2340)] }),
            new TableRow({ children: [cell("Visión", 2340), cell("No", 2340), cell("No", 2340), cell("Sí (sin auth)", 2340)] }),
            new TableRow({ children: [cell("Administración", 2340), cell("Sí", 2340), cell("No", 2340), cell("No", 2340)] }),
          ],
        }),
        tableCaption("TABLA 3. Visibilidad de páginas según rol de usuario."),
        heading3("Frontend en modo robot"),
        para("El frontend en modo robot soporta el flujo operativo offline completo: selección del fundo desde la lista precargada, creación de camellones sobre la marcha, inicio y finalización de sesiones de conteo, funcionamiento sin conexión a Google Maps y operación sin requerir autenticación."),
        heading3("Metas de fase"),
        bullet("Login funcional con persistencia de sesión."),
        bullet("El administrador accede a todas las páginas de administración, incluyendo gestión de modelos YOLO."),
        bullet("Los usuarios viewer visualizan dashboard y mapa filtrados por su empresa."),
        bullet("El operador en modo robot puede seleccionar fundo, crear camellones y operar sin internet ni autenticación."),
        emptyLine(),

        // Fase 6
        heading2("Fase 6: Clasificación offline"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Implementar un pipeline post-sesión que extraiga crops de cada fruto único detectado y los clasifique mediante un modelo de clasificación independiente de YOLO."]),
        heading3("Concepto"),
        para("Durante el conteo en tiempo real, YOLO detecta frutos y BotSort asigna identificadores únicos a cada uno. La clasificación no ocurre en tiempo real, sino después de finalizar la sesión. El pipeline offline procesa los frames capturados y, para cada fruto único, extrae el mejor crop (el frame donde el fruto se observa con mayor claridad y tamaño), lo pasa por un modelo de clasificación (madurez, calidad, variedad) y almacena el resultado asociado al fruto."),
        heading3("Modelos de datos"),
        bullet("fruit_crops: almacena el crop extraído por cada fruto único, incluyendo session_uuid, track_id (de BotSort), ruta de imagen, frame de origen y coordenadas del bounding box."),
        bullet("fruit_classifications: almacena el resultado de clasificación por crop, incluyendo el modelo utilizado, la clase asignada (maduro, verde, dañado), la confianza y la fecha de procesamiento."),
        heading3("Servicio de clasificación"),
        para("El servicio se ejecuta al finalizar una sesión o de forma manual desde el frontend. Recorre los frames capturados de la sesión, identifica cada track_id único, selecciona el frame con mayor área de bounding box para cada uno, extrae el crop y lo procesa con el modelo de clasificación. Los resultados se almacenan en la base de datos y se sincronizan al servidor."),
        heading3("Frontend"),
        bullet("Galería de frutos únicos detectados con su clasificación en el detalle de sesión."),
        bullet("Filtros por clase (maduro, verde, dañado, etc.)."),
        bullet("Estadísticas de distribución por clase dentro de cada sesión."),
        heading3("Metas de fase"),
        bullet("Pipeline de extracción de crops por fruto único implementado."),
        bullet("Modelo de clasificación integrado al sistema."),
        bullet("Resultados de clasificación asociados a cada sesión."),
        bullet("Visualización de crops y clasificaciones en el frontend."),
        bullet("Sincronización de resultados de clasificación al servidor."),
        emptyLine(),

        // Fase 7
        heading2("Fase 7: Despliegue"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Desplegar el sistema en dos máquinas: el servidor (PC del laboratorio) y el robot (Jetson Xavier). El costo de infraestructura es nulo."]),
        heading3("A. Despliegue del servidor (PC del laboratorio)"),
        bullet("Orquestación mediante Docker Compose con PostgreSQL, backend y cloudflared."),
        bullet("Exposición mediante Cloudflare Tunnel con enlace estable y HTTPS automático, sin costo."),
        bullet("No requiere IP pública, dominio propio ni redirección de puertos."),
        bullet("Compatible con la red de la universidad sin necesidad de permisos adicionales."),
        heading3("B. Despliegue del robot (Jetson Xavier)"),
        bullet("Instalación de dependencias: Python 3.13, uv y clonación del repositorio."),
        bullet("Configuración del archivo .env con ROBOT_MODE=robot, SYNC_SERVER_URL y SYNC_API_KEY."),
        bullet("El identificador del robot se obtiene automáticamente del número de serie de la Jetson."),
        bullet("Servicio systemd configurado para arranque automático al encender la Jetson."),
        bullet("Configuración de punto de acceso WiFi para conexión del operador desde celular o tablet."),
        bullet("Script de instalación reproducible (robot-setup.sh) para configurar nuevas unidades Jetson."),
        heading3("Metas de fase"),
        bullet("El servidor se levanta con docker compose y es accesible por internet via Cloudflare Tunnel."),
        bullet("La Jetson arranca el backend automáticamente al encender y expone un punto de acceso WiFi."),
        bullet("El script de setup permite replicar la instalación en nuevas unidades Jetson."),
        bullet("El archivo .env.example documenta todas las variables de entorno necesarias."),
        emptyLine(),

        // Fase 8
        heading2("Fase 8: Integración en laboratorio"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Validar el funcionamiento integral del sistema antes de proceder a la evaluación del modelo."]),
        heading3("Etapa 1: Integración de software"),
        numberedItem(nFase8e1, "Levantar el servidor y configurar Cloudflare Tunnel."),
        numberedItem(nFase8e1, "Crear datos de prueba: empresa, fundo y modelo YOLO."),
        numberedItem(nFase8e1, "Verificar la sincronización del robot hacia el servidor ejecutando sesiones de conteo y confirmando la recepción de datos."),
        numberedItem(nFase8e1, "Verificar la sincronización del servidor hacia el robot cargando un archivo .pt desde el panel de administración y confirmando la descarga en el robot."),
        numberedItem(nFase8e1, "Crear un usuario con rol viewer y verificar que el filtrado por empresa opera correctamente."),
        numberedItem(nFase8e1, "Verificar los filtros del dashboard y la exportación CSV."),
        numberedItem(nFase8e1, "Corregir los defectos identificados durante las pruebas."),
        heading3("Etapa 2: Simulación de operación real en laboratorio"),
        numberedItem(nFase8e2, "Transportar el robot simulando condiciones de campo (encender, desconectar del laboratorio)."),
        numberedItem(nFase8e2, "Seleccionar la región de interés desde el frontend."),
        numberedItem(nFase8e2, "Ejecutar una sesión de conteo completa utilizando el frontend web desde un celular o tablet."),
        numberedItem(nFase8e2, "Finalizar la sesión y verificar que los datos se registraron correctamente."),
        numberedItem(nFase8e2, "Sincronizar y verificar que los datos se recibieron en el servidor."),
        numberedItem(nFase8e2, "Revisar los resultados en el dashboard del servidor."),
        emptyLine(),
        para("El propósito de esta etapa es identificar fricciones en el flujo operativo real antes de evaluar el modelo: problemas de usabilidad, pasos confusos o errores que solo se manifiestan al seguir el procedimiento completo de principio a fin."),
        heading3("Metas de fase"),
        bullet("Ciclo completo funcionando: robot, sincronización, servidor y dashboard."),
        bullet("Cero defectos críticos en el flujo principal."),
        bullet("Simulación operativa exitosa de principio a fin."),
        emptyLine(),

        // Fase 9
        heading2("Fase 9: Evaluación y finetuning YOLO"),
        paraRuns([{ text: "Objetivo. ", bold: true }, "Evaluar el modelo actual en condiciones de conteo real y realizar finetuning en caso de ser necesario."]),
        para("La recolección de datos y el etiquetado se encuentran realizados. La actividad pendiente es validar el modelo en sesiones de conteo reales y ajustarlo si los resultados no alcanzan la precisión requerida."),
        heading3("Evaluación"),
        bullet("Ejecutar el modelo actual en sesiones de conteo reales en la universidad con el sistema completo operativo."),
        bullet("Evaluar la precisión del conteo, identificando falsos positivos y falsos negativos."),
        bullet("Identificar condiciones problemáticas: iluminación, ángulo de captura, velocidad de desplazamiento del robot."),
        bullet("Documentar métricas de rendimiento y casos de fallo."),
        bullet("Utilizar los frames capturados por el sistema para análisis detallado."),
        heading3("Finetuning (si es necesario)"),
        bullet("Recolectar imágenes adicionales de los casos donde el modelo presentó fallas."),
        bullet("Reentrenar el modelo con el dataset ampliado."),
        bullet("Cargar el modelo mejorado al servidor; el robot lo descarga automáticamente en el siguiente ciclo de sincronización."),
        para("Si la evaluación demuestra que el modelo opera con la precisión requerida, el tiempo restante se destina a optimización de otros aspectos del sistema."),
        heading3("Metas de fase"),
        bullet("Modelo evaluado en condiciones de conteo real."),
        bullet("Métricas de precisión documentadas."),
        bullet("Finetuning realizado si fue necesario."),
        bullet("Modelo final publicado en el servidor."),
        emptyLine(),

        // --- VII. FUTURO ---
        heading1("VII. PRUEBAS EN CAMPO (AGROINDUSTRIA)"),
        para("Las pruebas en campo con empresas agroindustriales se encuentran fuera del alcance del presente cronograma, dado que requieren coordinación logística con la empresa, lo cual implica tiempos de gestión independientes al desarrollo."),
        paraRuns([{ text: "Condición de entrada. ", bold: true }, "Todas las validaciones en universidad deben estar completadas (Fases 8 y 9)."]),
        para("Al momento de coordinar las pruebas, el procedimiento planificado comprende los siguientes pasos."),
        numberedItem(nFuturo, "Configurar la empresa y el fundo en el servidor, y verificar que el robot dispone del modelo correcto."),
        numberedItem(nFuturo, "El operador utiliza el frontend web para realizar conteo real en el fundo."),
        numberedItem(nFuturo, "Conectar el robot a internet mediante tethering y verificar la recepción de datos en el servidor."),
        numberedItem(nFuturo, "Presentar el dashboard al cliente y recoger retroalimentación."),

        // --- VIII. VERIFICACIÓN ---
        heading1("VIII. VERIFICACIÓN END-TO-END"),
        para("A continuación se detallan los criterios de validación del sistema completo."),
        numberedItemRuns(nVerificacion, [{ text: "Robot en campo. ", bold: true }, "El robot opera en modo robot, el frontend web se conecta correctamente y el conteo funciona."]),
        numberedItemRuns(nVerificacion, [{ text: "Sincronización push. ", bold: true }, "Al conectar el robot a internet, los logs confirman la sincronización de datos y el registro sync_log se actualiza."]),
        numberedItemRuns(nVerificacion, [{ text: "Sincronización pull de modelos. ", bold: true }, "El administrador carga un archivo .pt al servidor; el robot lo sincroniza y descarga el nuevo modelo."]),
        numberedItemRuns(nVerificacion, [{ text: "Auditoría. ", bold: true }, "Al abrir una sesión en el dashboard, se visualizan los frames capturados con las detecciones superpuestas."]),
        numberedItemRuns(nVerificacion, [{ text: "Clasificación offline. ", bold: true }, "Al finalizar una sesión, el pipeline extrae crops de cada fruto único, ejecuta el modelo de clasificación y los resultados se visualizan en el detalle de sesión."]),
        numberedItemRuns(nVerificacion, [{ text: "Servidor. ", bold: true }, "Al iniciar los contenedores, el administrador puede autenticarse y el dashboard muestra los datos del robot."]),
        numberedItemRuns(nVerificacion, [{ text: "Viewer. ", bold: true }, "Al iniciar sesión como cliente de empresa, solo se visualizan datos de su empresa y es posible exportar CSV."]),
        numberedItemRuns(nVerificacion, [{ text: "Multi-robot. ", bold: true }, "Un segundo robot, identificado automáticamente por el número de serie de la Jetson, sincroniza datos y el servidor muestra información de ambos dispositivos."]),
        numberedItemRuns(nVerificacion, [{ text: "Multi-empresa. ", bold: true }, "Un usuario viewer de una empresa no puede acceder a datos de otra empresa."]),
        numberedItemRuns(nVerificacion, [{ text: "Multi-fruta. ", bold: true }, "Cada fundo utiliza el modelo YOLO correspondiente a su tipo de fruta; cada robot descarga únicamente el modelo que necesita."]),
        numberedItemRuns(nVerificacion, [{ text: "Idempotencia. ", bold: true }, "Al resincronizar el mismo robot, los registros duplicados se omiten sin generar inconsistencias."]),
        numberedItemRuns(nVerificacion, [{ text: "Operación sin internet. ", bold: true }, "El robot opera con normalidad en modo offline; los datos se acumulan localmente y se sincronizan automáticamente al recuperar conectividad."]),
      ],
    },
  ],
});

// --- Generate ---
const OUTPUT = "/home/pqbas/labinm/robot-platform/docs/roadmap/plan_desarrollo_integracion.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Generated: ${OUTPUT}`);
});
