const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents,
} = require("docx");

// --- Constants ---
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const FONT = "Arial";
const COLOR_PRIMARY = "1F4E79";
const COLOR_HEADER_BG = "D5E8F0";
const COLOR_GRAY = "666666";
const COLOR_PLACEHOLDER = "999999";

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

function placeholder(text) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text: "[" + text + "]", font: FONT, size: 22, color: COLOR_PLACEHOLDER, italics: true })],
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

function bulletPlaceholder(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text: "[" + text + "]", font: FONT, size: 22, color: COLOR_PLACEHOLDER, italics: true })],
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

function headerCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: FONT, size: 20 })] })],
  });
}

function cell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20 })] })],
  });
}

function placeholderCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, color: COLOR_PLACEHOLDER, italics: true })] })],
  });
}

function tableCaption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}

function figCaption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}

// --- Document ---
const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "\u2022",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
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
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({
            text: "\"Desarrollo e implementaci\u00F3n de un robot m\u00F3vil multifuncional reconfigurable mec\u00E1nicamente para adaptarse a fundos agr\u00EDcolas con diferentes camellones y entre surcos variables de la Regi\u00F3n La Libertad-Per\u00FA\"",
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
          children: [new TextRun({
            text: "INFORME TECNICO # _",
            font: FONT, size: 36, bold: true, color: COLOR_PRIMARY,
          })],
        }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({
            text: "[T\u00EDtulo del informe]",
            font: FONT, size: 26, bold: true, color: COLOR_PLACEHOLDER, italics: true,
          })],
        }),
        emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "Nombre del autor:", font: FONT, size: 22, bold: true })],
        }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Percy Brayam Cubas Mu\u00F1oz", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Diana Rebecca, Rodriguez Ruiz", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Elver Joel, Sandoval Salinas", font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Wilder, Oblitas D.", font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Trujillo - Per\u00FA", font: FONT, size: 22 })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "[MES] - [A\u00D1O]", font: FONT, size: 22, bold: true, color: COLOR_PLACEHOLDER })],
        }),
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
            children: [new TextRun({ text: "Informe T\u00E9cnico #_ \u2014 [T\u00EDtulo corto]", font: FONT, size: 18, color: COLOR_GRAY })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "P\u00E1gina ", font: FONT, size: 18, color: COLOR_GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: COLOR_GRAY }),
            ],
          })],
        }),
      },
      children: [
        // --- INDICE ---
        heading1("\u00CDNDICE"),
        new TableOfContents("Tabla de contenidos", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),

        // --- RESUMEN ---
        heading1("RESUMEN"),
        placeholder("Escribir un resumen de 1-2 p\u00E1rrafos describiendo el contenido del informe. Incluir las actividades principales y los resultados m\u00E1s relevantes."),
        bulletPlaceholder("Actividad o resultado principal 1"),
        bulletPlaceholder("Actividad o resultado principal 2"),
        bulletPlaceholder("Actividad o resultado principal 3"),
        placeholder("Indicar que las siguientes secciones detallan cada uno de estos aspectos."),
        new Paragraph({ children: [new PageBreak()] }),

        // --- I. INTRODUCCION ---
        heading1("I. INTRODUCCI\u00D3N"),
        placeholder("Describir el contexto del trabajo, la problem\u00E1tica abordada, los antecedentes relevantes y la motivaci\u00F3n del informe. Hacer referencia a informes anteriores si aplica."),
        placeholder("Listar los aspectos espec\u00EDficos que cubre el informe:"),
        bulletPlaceholder("Aspecto 1"),
        bulletPlaceholder("Aspecto 2"),
        bulletPlaceholder("Aspecto 3"),
        placeholder("Cerrar con una breve menci\u00F3n del resultado o hallazgo principal."),
        new Paragraph({ children: [new PageBreak()] }),

        // --- II. OBJETIVO GENERAL ---
        heading1("II. OBJETIVO GENERAL"),
        placeholder("Redactar el objetivo general del trabajo descrito en este informe. Debe ser un \u00FAnico p\u00E1rrafo conciso que indique qu\u00E9 se busca lograr."),
        new Paragraph({ children: [new PageBreak()] }),

        // --- III. METODOLOGIA ---
        heading1("III. METODOLOG\u00CDA"),
        placeholder("Introducir la lista de actividades realizadas para lograr el objetivo:"),
        bulletPlaceholder("Actividad 1"),
        bulletPlaceholder("Actividad 2"),
        bulletPlaceholder("Actividad 3"),
        bulletPlaceholder("Actividad 4"),
        new Paragraph({ children: [new PageBreak()] }),

        // --- IV. MATERIALES ---
        heading1("IV. MATERIALES"),

        heading2("1. [T\u00EDtulo de la secci\u00F3n]"),
        placeholder("Describir el primer componente, herramienta, m\u00E9todo o material utilizado."),

        // Ejemplo de tabla
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [3120, 3120, 3120],
          rows: [
            new TableRow({ children: [headerCell("Columna 1", 3120), headerCell("Columna 2", 3120), headerCell("Columna 3", 3120)] }),
            new TableRow({ children: [placeholderCell("Dato", 3120), placeholderCell("Dato", 3120), placeholderCell("Dato", 3120)] }),
            new TableRow({ children: [placeholderCell("Dato", 3120), placeholderCell("Dato", 3120), placeholderCell("Dato", 3120)] }),
            new TableRow({ children: [placeholderCell("Dato", 3120), placeholderCell("Dato", 3120), placeholderCell("Dato", 3120)] }),
          ],
        }),
        tableCaption("TABLA 1. [Descripci\u00F3n de la tabla]"),

        heading2("2. [T\u00EDtulo de la secci\u00F3n]"),
        placeholder("Describir el segundo componente o m\u00E9todo."),

        heading3("2.1. [Subt\u00EDtulo]"),
        placeholder("Detallar un aspecto espec\u00EDfico."),

        heading3("2.2. [Subt\u00EDtulo]"),
        placeholder("Detallar otro aspecto espec\u00EDfico."),

        heading2("3. [T\u00EDtulo de la secci\u00F3n]"),
        placeholder("Describir el tercer componente o m\u00E9todo."),
        bulletPlaceholder("Punto relevante 1"),
        bulletPlaceholder("Punto relevante 2"),
        bulletPlaceholder("Punto relevante 3"),

        // Ejemplo de figura placeholder
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: "[Insertar figura aqu\u00ED]", font: FONT, size: 22, color: COLOR_PLACEHOLDER, italics: true })],
        }),
        figCaption("FIGURA 1. [Descripci\u00F3n de la figura]"),

        heading2("4. [T\u00EDtulo de la secci\u00F3n]"),
        placeholder("Describir componentes adicionales seg\u00FAn sea necesario. Agregar m\u00E1s secciones duplicando la estructura."),

        new Paragraph({ children: [new PageBreak()] }),

        // --- V. RESULTADOS ---
        heading1("V. RESULTADOS"),
        placeholder("Introducci\u00F3n breve a los resultados obtenidos."),

        heading2("1. [Resultado 1]"),
        placeholder("Describir el primer resultado con datos cuantitativos si es posible."),

        // Ejemplo de tabla de resultados
        emptyLine(),
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2340, 2340, 2340, 2340],
          rows: [
            new TableRow({ children: [headerCell("M\u00E9trica", 2340), headerCell("Valor 1", 2340), headerCell("Valor 2", 2340), headerCell("Valor 3", 2340)] }),
            new TableRow({ children: [placeholderCell("M\u00E9trica 1", 2340), placeholderCell("-", 2340), placeholderCell("-", 2340), placeholderCell("-", 2340)] }),
            new TableRow({ children: [placeholderCell("M\u00E9trica 2", 2340), placeholderCell("-", 2340), placeholderCell("-", 2340), placeholderCell("-", 2340)] }),
          ],
        }),
        tableCaption("TABLA 2. [Descripci\u00F3n de la tabla de resultados]"),

        heading2("2. [Resultado 2]"),
        placeholder("Describir el segundo resultado."),

        heading2("3. [Resultado 3]"),
        placeholder("Describir resultados adicionales."),

        new Paragraph({ children: [new PageBreak()] }),

        // --- VI. CONCLUSIONES ---
        heading1("VI. CONCLUSIONES"),
        placeholder("P\u00E1rrafo introductorio resumiendo el alcance del trabajo:"),
        bulletPlaceholder("Conclusi\u00F3n 1"),
        bulletPlaceholder("Conclusi\u00F3n 2"),
        bulletPlaceholder("Conclusi\u00F3n 3"),
        bulletPlaceholder("Conclusi\u00F3n 4"),

        new Paragraph({ children: [new PageBreak()] }),

        // --- VII. REFERENCIAS ---
        heading1("VII. REFERENCIAS"),
        placeholder("Autor, A. (A\u00F1o). T\u00EDtulo del trabajo. Fuente."),
        placeholder("Autor, B. (A\u00F1o). T\u00EDtulo del trabajo. Fuente."),
        placeholder("Autor, C. (A\u00F1o). T\u00EDtulo del trabajo. Fuente."),
      ],
    },
  ],
});

// --- Generate ---
Packer.toBuffer(doc).then(buffer => {
  const out = "/home/pqbas/labinm/robot-platform/docs/PLANTILLA_INFORME_TECNICO.docx";
  fs.writeFileSync(out, buffer);
  console.log("Created: " + out);
});
