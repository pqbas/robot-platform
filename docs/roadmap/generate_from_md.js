// Compila docs/documentacion_tecnica_avance.md a docx, manteniendo portada,
// índice y estilos. Sin dependencias externas (parser markdown mínimo).
//
// Uso:  node docs/roadmap/generate_from_md.js
//
// Sintaxis soportada en el .md:
//   #/##/###          encabezados
//   párrafos          texto plano justificado, **bold** inline
//   - item            bullet (admite **prefijo:** al inicio)
//   1. item           lista numerada (cada bloque numerado reinicia su contador)
//   | a | b |         tabla pipe markdown; primera fila = header
//   | --- | --- |
//   ^TEXTO            leyenda (centrada, gris, itálica) para tabla o figura
//   ::figure RUTA     inserta imagen
//   <!-- widths: ... --> antes de tabla: anchos personalizados (DXA)

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents,
  ImageRun,
} = require("docx");

// ----------------------- assets -----------------------
const REPO = "/home/pqbas/labinm/robot-platform";
const MD_PATH = path.join(REPO, "docs/documentacion_tecnica_avance.md");
const OUTPUT = path.join(REPO, "docs/documentacion_tecnica_avance.docx");

const BANNER_PATH = "/home/pqbas/labinm/.assets/banner_upao.jpg";
const LOGO_PATH = "/home/pqbas/labinm/.assets/logo_upao.jpg";
const bannerImg = fs.existsSync(BANNER_PATH) ? fs.readFileSync(BANNER_PATH) : null;
const logoImg = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;

// ----------------------- estilo -----------------------
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

// ----------------------- helpers docx -----------------------
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
function emptyLine() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}
function tableCaption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}
function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: inlineRuns(text, { bold: true, size: 20 }) })],
  });
}
function bodyCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    children: [new Paragraph({ children: inlineRuns(text, { size: 20 }) })],
  });
}

// Convierte texto con **bold** inline a runs.
function inlineRuns(text, baseOpts = {}) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: 22, ...baseOpts }));
    }
    out.push(new TextRun({ text: m[1], font: FONT, size: 22, bold: true, ...baseOpts }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(new TextRun({ text: text.slice(last), font: FONT, size: 22, ...baseOpts }));
  }
  return out;
}
function paragraph(text) {
  return new Paragraph({
    spacing: { after: 120 },
    alignment: AlignmentType.JUSTIFIED,
    children: inlineRuns(text),
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 80 },
    children: inlineRuns(text),
  });
}
function numbered(ref, text) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: inlineRuns(text),
  });
}
// Lee dimensiones nativas de PNG y JPEG sin dependencias externas.
function readImageSize(buf) {
  // PNG: bytes 16..24 = width, height (uint32 BE) tras la firma "\x89PNG..."
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: empieza con 0xFFD8; recorrer marcadores hasta SOFx
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p < buf.length) {
      if (buf[p] !== 0xff) break;
      const marker = buf[p + 1];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSOF = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      const segLen = buf.readUInt16BE(p + 2);
      if (isSOF) {
        return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
      }
      p += 2 + segLen;
    }
  }
  return null;
}

const FIGURE_MAX_WIDTH_PX = 520;
const FIGURE_MAX_HEIGHT_PX = 600;

function figureImage(absPath) {
  if (!fs.existsSync(absPath)) {
    console.warn(`figure not found: ${absPath}`);
    return emptyLine();
  }
  const data = fs.readFileSync(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const type = ext === "jpg" || ext === "jpeg" ? "jpg" : ext;

  // Escala respetando el ratio original; cabe dentro de FIGURE_MAX_WIDTH/HEIGHT.
  const native = readImageSize(data);
  let width = FIGURE_MAX_WIDTH_PX;
  let height = Math.round(FIGURE_MAX_WIDTH_PX * 0.673);
  if (native && native.width > 0 && native.height > 0) {
    const scale = Math.min(
      FIGURE_MAX_WIDTH_PX / native.width,
      FIGURE_MAX_HEIGHT_PX / native.height,
      1,
    );
    width = Math.round(native.width * scale);
    height = Math.round(native.height * scale);
  } else {
    console.warn(`could not read native size of ${absPath}, using default`);
  }

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    children: [new ImageRun({
      type, data,
      transformation: { width, height },
      altText: { title: "Figura", description: "Figura del documento", name: "figura" },
    })],
  });
}
function caption(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, font: FONT, size: 20, italics: true, color: COLOR_GRAY })],
  });
}

// ----------------------- listas numeradas dinámicas -----------------------
let _numCounter = 0;
const _numConfigs = [];
function newNumberedListRef() {
  const ref = `numbers_${_numCounter++}`;
  _numConfigs.push({
    reference: ref,
    levels: [{
      level: 0, format: LevelFormat.DECIMAL, text: "%1.",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } },
    }],
  });
  return ref;
}

// ----------------------- parser markdown -----------------------
// Una línea inicia un nuevo bloque si coincide con alguno de estos patrones.
// Cualquier otra línea no vacía es continuación del bloque previo (lazy continuation).
function startsNewBlock(line) {
  if (line.trim() === "") return true;
  return /^(#{1,3}\s|-\s+|\d+\.\s+|\^|::figure\s|!\[.*?\]\(.+?\)|<!--|\|)/.test(line);
}

// Devuelve el resto del bloque (líneas de continuación) desde el índice `i`,
// concatenado con espacio. Avanza el índice del caller.
function consumeContinuation(lines, i) {
  const buf = [];
  while (i < lines.length && !startsNewBlock(lines[i])) {
    buf.push(lines[i].trim());
    i++;
  }
  return { text: buf.join(" "), next: i };
}

function parseMarkdown(text) {
  const blocks = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  let pendingWidths = null;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Comentarios HTML (incluso multilínea)
    if (line.trim().startsWith("<!--")) {
      let collected = line;
      while (!collected.includes("-->") && i + 1 < lines.length) {
        i++;
        collected += "\n" + lines[i];
      }
      const widthsMatch = collected.match(/widths:\s*([\d,\s]+)/);
      if (widthsMatch) {
        pendingWidths = widthsMatch[1].split(",").map(s => parseInt(s.trim(), 10));
      }
      i++;
      continue;
    }

    let m;
    if ((m = line.match(/^#\s+(.*)$/))) { blocks.push({ type: "h1", text: m[1].trim() }); i++; continue; }
    if ((m = line.match(/^##\s+(.*)$/))) { blocks.push({ type: "h2", text: m[1].trim() }); i++; continue; }
    if ((m = line.match(/^###\s+(.*)$/))) { blocks.push({ type: "h3", text: m[1].trim() }); i++; continue; }

    if ((m = line.match(/^\^\s*(.*)$/))) {
      // captions también admiten continuación
      i++;
      const cont = consumeContinuation(lines, i);
      const text = cont.text ? `${m[1].trim()} ${cont.text}` : m[1].trim();
      blocks.push({ type: "caption", text });
      i = cont.next;
      continue;
    }

    if ((m = line.match(/^::figure\s+(.+)$/))) {
      let p = m[1].trim();
      if (!path.isAbsolute(p)) p = path.resolve(REPO, p);
      blocks.push({ type: "figure", path: p });
      i++; continue;
    }

    // Sintaxis markdown estándar: ![alt](path). Si alt no está vacío, se usa como leyenda.
    if ((m = line.match(/^!\[(.*?)\]\((.+?)\)\s*$/))) {
      const alt = m[1].trim();
      let p = decodeURIComponent(m[2].trim());
      if (!path.isAbsolute(p)) p = path.resolve(REPO, p);
      blocks.push({ type: "figure", path: p });
      if (alt) blocks.push({ type: "caption", text: alt });
      i++; continue;
    }

    // Bullet list (con continuación de cada ítem)
    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        let item = lines[i].replace(/^-\s+/, "");
        i++;
        const cont = consumeContinuation(lines, i);
        if (cont.text) item += " " + cont.text;
        i = cont.next;
        items.push(item);
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Numbered list (con continuación de cada ítem)
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\d+\.\s+/, "");
        i++;
        const cont = consumeContinuation(lines, i);
        if (cont.text) item += " " + cont.text;
        i = cont.next;
        items.push(item);
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Tabla pipe
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|\s*[-:]/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const split = (r) => r.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
      const header = split(rows[0]);
      const body = rows.slice(2).map(split);
      blocks.push({ type: "table", header, body, widths: pendingWidths });
      pendingWidths = null;
      continue;
    }

    // Párrafo: la línea actual + cualquier continuación lazy.
    let pText = line.trim();
    i++;
    const cont = consumeContinuation(lines, i);
    if (cont.text) pText += " " + cont.text;
    i = cont.next;
    blocks.push({ type: "p", text: pText });
  }

  return blocks;
}

// ----------------------- blocks → docx -----------------------
function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case "h1": out.push(heading1(b.text)); break;
      case "h2": out.push(heading2(b.text)); break;
      case "h3": out.push(heading3(b.text)); break;
      case "p":  out.push(paragraph(b.text)); break;
      case "ul":
        for (const it of b.items) out.push(bullet(it));
        break;
      case "ol": {
        const ref = newNumberedListRef();
        for (const it of b.items) out.push(numbered(ref, it));
        break;
      }
      case "figure": out.push(emptyLine(), figureImage(b.path)); break;
      case "caption": out.push(caption(b.text)); break;
      case "table": {
        const cols = b.header.length;
        const widths = b.widths && b.widths.length === cols
          ? b.widths
          : new Array(cols).fill(Math.floor(CONTENT_WIDTH / cols));
        const rows = [];
        rows.push(new TableRow({
          children: b.header.map((t, idx) => headerCell(t, widths[idx])),
        }));
        for (const r of b.body) {
          rows.push(new TableRow({
            children: r.map((t, idx) => bodyCell(t, widths[idx])),
          }));
        }
        out.push(new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: widths,
          rows,
        }));
        break;
      }
    }
  }
  return out;
}

// ----------------------- frontmatter -----------------------
// Soporta un bloque YAML simple (key: value) al inicio del archivo,
// delimitado por --- ... ---. Devuelve { meta, body } sin el bloque.
function extractFrontmatter(text) {
  const meta = {};
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta, body: text };
  const block = m[1];
  for (const line of block.split("\n")) {
    const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

// Defaults para la portada (se sobrescriben con el frontmatter del .md).
const COVER_DEFAULTS = {
  title: "DOCUMENTACIÓN TÉCNICA DE LA PLATAFORMA",
  subtitle: "SISTEMA DE DETECCIÓN, CONTEO Y CLASIFICACIÓN DE FRUTOS",
  version: "Avance 2",
  author: "Percy Brayam Cubas Muñoz",
  date: "5 de mayo de 2026",
  location: "Trujillo - Perú",
  month: "MAYO - 2026",
  project_quote: "\"Desarrollo e implementación de un robot móvil multifuncional reconfigurable mecánicamente para adaptarse a fundos agrícolas con diferentes camellones y entre surcos variables de la Región La Libertad-Perú\"",
  project_code: "PE5010-86701-2024-PROCIENCIA",
};

// ----------------------- ejecución -----------------------
const rawMd = fs.readFileSync(MD_PATH, "utf-8");
const { meta, body: md } = extractFrontmatter(rawMd);
const cover = { ...COVER_DEFAULTS, ...meta };
const blocks = parseMarkdown(md);
const bodyChildren = renderBlocks(blocks);

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
      ..._numConfigs,
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
    // Portada
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
            text: cover.project_quote,
            font: FONT, size: 22, italics: true, color: COLOR_GRAY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 400 },
          children: [new TextRun({ text: cover.project_code, font: FONT, size: 22, color: COLOR_GRAY })],
        }),
        emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: cover.title, font: FONT, size: 32, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: cover.subtitle, font: FONT, size: 26, bold: true, color: COLOR_PRIMARY })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: cover.version, font: FONT, size: 24, italics: true, color: COLOR_GRAY })],
        }),
        emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "Autor:", font: FONT, size: 22, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: cover.author, font: FONT, size: 22 })] }),
        emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
          children: [new TextRun({ text: "Fecha:", font: FONT, size: 22, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: cover.date, font: FONT, size: 22 })] }),
        emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
          children: [new TextRun({ text: cover.location, font: FONT, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: cover.month, font: FONT, size: 22, bold: true })] }),
      ],
    },
    // Cuerpo
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
        ...bodyChildren,
      ],
    },
  ],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log(`Generated: ${OUTPUT}`);
});
