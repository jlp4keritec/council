// Exporters : convertit un message assistant complet en MD, JSON, DOCX, PPTX.
//
// Architecture :
// - JSON et Markdown : pures fonctions, retournent string. Le frontend peut
//   declencher le download directement sans appel reseau.
// - DOCX et PPTX : utilisent les libs `docx` et `pptxgenjs` cote serveur,
//   retournent un Buffer envoye en download par l'endpoint dedicacie.

import {
  Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle,
} from 'docx';
import PptxGenJS from 'pptxgenjs';

// ============================================================================
// Helpers communs
// ============================================================================

function shortModel(modelId) {
  if (!modelId) return '?';
  const parts = String(modelId).split('/');
  return parts[parts.length - 1];
}

function formatDuration(ms) {
  if (ms == null || isNaN(ms)) return '–';
  const seconds = ms / 1000;
  if (seconds < 1) return `${ms} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}m${String(sec).padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function extractUserQuestion(conv, assistantIndex) {
  // La question est le message user juste avant le message assistant
  const messages = conv.messages || [];
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content || '';
  }
  return '(question introuvable)';
}

// ============================================================================
// MARKDOWN
// ============================================================================

export function exportToMarkdown(conv, assistantIndex) {
  const msg = conv.messages[assistantIndex];
  const question = extractUserQuestion(conv, assistantIndex);
  const stage3 = msg.stage3 || {};
  const stage1 = msg.stage1 || [];
  const stage2 = msg.stage2 || [];
  const meta = msg.metadata || {};
  const timings = msg.timings || {};
  const pricing = msg.pricing?.total || {};

  let md = `# ${conv.title || 'Conversation sans titre'}\n\n`;
  md += `**Date :** ${formatDate(msg.created_at)}\n`;
  md += `**Question :**\n\n> ${question.replace(/\n/g, '\n> ')}\n\n`;
  md += `---\n\n`;

  // Synthese
  md += `## Synthèse du Chairman\n\n`;
  md += `*Modèle : \`${stage3.model || 'inconnu'}\`${stage3.used_fallback ? ' (fallback)' : ''}*\n\n`;
  md += `${stage3.response || '(synthèse non disponible)'}\n\n`;

  // Analyse meta-cognitive (si presente)
  if (stage3.analysis && typeof stage3.analysis === 'object') {
    md += `## Analyse du Chairman\n\n`;
    const a = stage3.analysis;
    if (Array.isArray(a.consensus_points) && a.consensus_points.length > 0) {
      md += `### Points de consensus\n\n`;
      a.consensus_points.forEach((p) => { md += `- ${p}\n`; });
      md += `\n`;
    }
    if (Array.isArray(a.disagreements) && a.disagreements.length > 0) {
      md += `### Désaccords arbitrés\n\n`;
      a.disagreements.forEach((d) => {
        md += `**Sujet :** ${d.topic || '–'}\n\n`;
        if (d.positions) md += `*Positions :* ${d.positions}\n\n`;
        if (d.my_arbitration) md += `*Arbitrage :* ${d.my_arbitration}\n\n`;
      });
    }
    if (Array.isArray(a.rejected_arguments) && a.rejected_arguments.length > 0) {
      md += `### Arguments écartés\n\n`;
      a.rejected_arguments.forEach((r) => { md += `- ${r}\n`; });
      md += `\n`;
    }
    if (a.weighting_rationale) {
      md += `### Pondération des modèles\n\n`;
      md += `*${a.weighting_rationale}*\n\n`;
    }
  }

  // Opinions individuelles
  md += `## Opinions individuelles (Stage 1)\n\n`;
  stage1.forEach((r, i) => {
    md += `### Modèle ${String.fromCharCode(65 + i)} — \`${r.model}\`\n\n`;
    if (r.duration_ms != null) md += `*Durée : ${formatDuration(r.duration_ms)}${r.from_fallback ? ' · ↻ fallback' : ''}*\n\n`;
    md += `${r.response || '(pas de réponse)'}\n\n`;
  });

  // Classement agrege
  if (meta.aggregate_rankings && meta.aggregate_rankings.length > 0) {
    md += `## Classement agrégé (Stage 2)\n\n`;
    md += `| Modèle | Rang moyen | Positions reçues | Nb évaluations |\n`;
    md += `|---|---|---|---|\n`;
    meta.aggregate_rankings.forEach((a) => {
      md += `| \`${a.model}\` | ${a.average_rank.toFixed(2)} | [${(a.raw_positions || []).join(', ')}] | ${a.rankings_count} |\n`;
    });
    md += `\n`;
  }

  // Metadonnees
  md += `---\n\n## Métadonnées\n\n`;
  if (timings) {
    md += `**Temps :** Stage 1 \`${formatDuration(timings.stage1_ms)}\` · `;
    md += `Stage 2 \`${formatDuration(timings.stage2_ms)}\` · `;
    md += `Stage 3 \`${formatDuration(timings.stage3_ms)}\` · `;
    md += `Total \`${formatDuration(timings.total_ms)}\`\n\n`;
  }
  if (pricing.total_tokens != null) {
    md += `**Tokens :** ${pricing.total_tokens} (${pricing.total_prompt_tokens || 0} in / ${pricing.total_completion_tokens || 0} out)`;
    if (pricing.total_cost_usd != null) md += ` — **$${pricing.total_cost_usd.toFixed(4)}**`;
    md += `\n\n`;
  }
  if (Array.isArray(meta.attempted_fallback) && meta.attempted_fallback.length > 0) {
    md += `**Modèles fallback tentés :** ${meta.attempted_fallback.join(', ')}\n\n`;
  }
  if (Array.isArray(meta.failed_models_stage1) && meta.failed_models_stage1.length > 0) {
    md += `**Modèles configurés sans réponse :** ${meta.failed_models_stage1.join(', ')}\n\n`;
  }

  md += `---\n\n*Généré par LLM Council Node.js v2.5 — ${new Date().toISOString()}*\n`;
  return md;
}

// ============================================================================
// JSON
// ============================================================================

export function exportToJson(conv, assistantIndex) {
  const msg = conv.messages[assistantIndex];
  return JSON.stringify(
    {
      conversation: {
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
      },
      question: extractUserQuestion(conv, assistantIndex),
      assistant_message: msg,
      exported_at: new Date().toISOString(),
      exporter_version: '2.5',
    },
    null,
    2,
  );
}

// ============================================================================
// DOCX
// ============================================================================

function makeParagraph(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text || ''), bold: opts.bold, italics: opts.italic, size: opts.size, color: opts.color })],
    spacing: { after: opts.spaceAfter || 120 },
    alignment: opts.align,
  });
}

function makeHeading(text, level) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 240, after: 120 },
  });
}

function makeTable(headerCells, rows) {
  const headerRow = new TableRow({
    children: headerCells.map(
      (h) => new TableCell({
        children: [makeParagraph(h, { bold: true })],
        width: { size: 100 / headerCells.length, type: WidthType.PERCENTAGE },
      }),
    ),
    tableHeader: true,
  });

  const bodyRows = rows.map(
    (row) => new TableRow({
      children: row.map(
        (cell) => new TableCell({
          children: [makeParagraph(cell)],
          width: { size: 100 / row.length, type: WidthType.PERCENTAGE },
        }),
      ),
    }),
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

/**
 * Convertit le markdown du Chairman en paragraphes docx en preservant
 * grossierement les titres, listes, gras et italiques. Volontairement simple :
 * pas de parser complet, juste les patterns frequents.
 */
function markdownToDocxParagraphs(md) {
  if (!md) return [makeParagraph('(pas de contenu)')];
  const lines = String(md).split(/\r?\n/);
  const out = [];

  for (let line of lines) {
    if (!line.trim()) { out.push(new Paragraph({ spacing: { after: 80 } })); continue; }

    // Headers ##, ### (## reserve aux sections principales, on passe en H3-H4)
    if (line.startsWith('### ')) { out.push(makeHeading(line.slice(4).trim(), HeadingLevel.HEADING_3)); continue; }
    if (line.startsWith('## ')) { out.push(makeHeading(line.slice(3).trim(), HeadingLevel.HEADING_3)); continue; }
    if (line.startsWith('# ')) { out.push(makeHeading(line.slice(2).trim(), HeadingLevel.HEADING_3)); continue; }

    // Listes (- ou *)
    if (/^[-*]\s/.test(line)) {
      const text = line.replace(/^[-*]\s+/, '');
      out.push(new Paragraph({
        children: [new TextRun({ text: '• ' }), ...inlineRuns(text)],
        spacing: { after: 80 },
        indent: { left: 360 },
      }));
      continue;
    }
    // Liste numerotee
    if (/^\d+\.\s/.test(line)) {
      const text = line.replace(/^\d+\.\s+/, '');
      out.push(new Paragraph({
        children: inlineRuns(text),
        spacing: { after: 80 },
        indent: { left: 360 },
        numbering: undefined,    // simplifie : pas de vrais numerotes (docx complexe)
      }));
      continue;
    }

    // Paragraphe normal avec runs (gras, italique)
    out.push(new Paragraph({
      children: inlineRuns(line),
      spacing: { after: 120 },
    }));
  }

  return out;
}

function inlineRuns(text) {
  // Parser minimal **gras** et *italique*
  const runs = [];
  let remaining = text;
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, m.index) }));
    }
    const tok = m[0];
    if (tok.startsWith('**')) {
      runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    } else if (tok.startsWith('*')) {
      runs.push(new TextRun({ text: tok.slice(1, -1), italics: true }));
    } else if (tok.startsWith('`')) {
      runs.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas' }));
    }
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < text.length) runs.push(new TextRun({ text: text.slice(lastIndex) }));
  if (runs.length === 0) runs.push(new TextRun({ text }));
  return runs;
}

export async function exportToDocx(conv, assistantIndex) {
  const msg = conv.messages[assistantIndex];
  const question = extractUserQuestion(conv, assistantIndex);
  const stage3 = msg.stage3 || {};
  const stage1 = msg.stage1 || [];
  const meta = msg.metadata || {};
  const timings = msg.timings || {};
  const pricing = msg.pricing?.total || {};

  const sections = [];

  // Titre principal + entete
  sections.push(makeHeading(conv.title || 'Conversation Council', HeadingLevel.TITLE));
  sections.push(makeParagraph(`Date : ${formatDate(msg.created_at)}`, { italic: true }));
  sections.push(makeParagraph(''));

  // Question
  sections.push(makeHeading('Question', HeadingLevel.HEADING_1));
  sections.push(makeParagraph(question));
  sections.push(makeParagraph(''));

  // Synthese
  sections.push(makeHeading('Synthèse du Chairman', HeadingLevel.HEADING_1));
  sections.push(makeParagraph(`Modèle : ${stage3.model || 'inconnu'}${stage3.used_fallback ? ' (fallback)' : ''}`, { italic: true, color: '666666' }));
  sections.push(makeParagraph(''));
  sections.push(...markdownToDocxParagraphs(stage3.response || ''));

  // Analyse
  if (stage3.analysis && typeof stage3.analysis === 'object') {
    sections.push(makeHeading('Analyse du Chairman', HeadingLevel.HEADING_1));
    const a = stage3.analysis;

    if (Array.isArray(a.consensus_points) && a.consensus_points.length > 0) {
      sections.push(makeHeading('Points de consensus', HeadingLevel.HEADING_2));
      a.consensus_points.forEach((p) => {
        sections.push(new Paragraph({
          children: [new TextRun({ text: '✓ ', color: '198754', bold: true }), new TextRun({ text: p })],
          spacing: { after: 80 }, indent: { left: 360 },
        }));
      });
    }

    if (Array.isArray(a.disagreements) && a.disagreements.length > 0) {
      sections.push(makeHeading('Désaccords arbitrés', HeadingLevel.HEADING_2));
      a.disagreements.forEach((d) => {
        sections.push(new Paragraph({
          children: [new TextRun({ text: 'Sujet : ', bold: true }), new TextRun({ text: d.topic || '–' })],
          spacing: { after: 60 },
        }));
        if (d.positions) {
          sections.push(new Paragraph({
            children: [new TextRun({ text: 'Positions : ', bold: true, italics: true }), new TextRun({ text: d.positions, italics: true })],
            spacing: { after: 60 }, indent: { left: 240 },
          }));
        }
        if (d.my_arbitration) {
          sections.push(new Paragraph({
            children: [new TextRun({ text: 'Arbitrage : ', bold: true }), new TextRun({ text: d.my_arbitration })],
            spacing: { after: 160 }, indent: { left: 240 },
          }));
        }
      });
    }

    if (Array.isArray(a.rejected_arguments) && a.rejected_arguments.length > 0) {
      sections.push(makeHeading('Arguments écartés', HeadingLevel.HEADING_2));
      a.rejected_arguments.forEach((r) => {
        sections.push(new Paragraph({
          children: [new TextRun({ text: '✗ ', color: 'DC3545', bold: true }), new TextRun({ text: r })],
          spacing: { after: 80 }, indent: { left: 360 },
        }));
      });
    }

    if (a.weighting_rationale) {
      sections.push(makeHeading('Pondération des modèles', HeadingLevel.HEADING_2));
      sections.push(makeParagraph(a.weighting_rationale, { italic: true }));
    }
  }

  // Opinions individuelles
  sections.push(makeHeading('Opinions individuelles (Stage 1)', HeadingLevel.HEADING_1));
  stage1.forEach((r, i) => {
    sections.push(makeHeading(`Modèle ${String.fromCharCode(65 + i)} — ${r.model}`, HeadingLevel.HEADING_2));
    if (r.duration_ms != null) {
      sections.push(makeParagraph(
        `Durée : ${formatDuration(r.duration_ms)}${r.from_fallback ? ' · ajouté via fallback' : ''}`,
        { italic: true, color: '666666' },
      ));
    }
    sections.push(...markdownToDocxParagraphs(r.response || '(pas de réponse)'));
  });

  // Classement
  if (meta.aggregate_rankings && meta.aggregate_rankings.length > 0) {
    sections.push(makeHeading('Classement agrégé (Stage 2)', HeadingLevel.HEADING_1));
    sections.push(makeTable(
      ['Modèle', 'Rang moyen', 'Positions reçues', 'Nb évaluations'],
      meta.aggregate_rankings.map((a) => [
        a.model,
        a.average_rank.toFixed(2),
        `[${(a.raw_positions || []).join(', ')}]`,
        String(a.rankings_count),
      ]),
    ));
    sections.push(makeParagraph(''));
  }

  // Metadonnees
  sections.push(makeHeading('Métadonnées', HeadingLevel.HEADING_1));
  if (timings) {
    sections.push(makeParagraph(
      `Temps : Stage 1 ${formatDuration(timings.stage1_ms)} · Stage 2 ${formatDuration(timings.stage2_ms)} · Stage 3 ${formatDuration(timings.stage3_ms)} · Total ${formatDuration(timings.total_ms)}`,
    ));
  }
  if (pricing.total_tokens != null) {
    let line = `Tokens : ${pricing.total_tokens} (${pricing.total_prompt_tokens || 0} in / ${pricing.total_completion_tokens || 0} out)`;
    if (pricing.total_cost_usd != null) line += ` — $${pricing.total_cost_usd.toFixed(4)}`;
    sections.push(makeParagraph(line));
  }

  // Footer
  sections.push(makeParagraph(''));
  sections.push(makeParagraph(
    `Généré par LLM Council Node.js v2.5 — ${new Date().toISOString()}`,
    { italic: true, color: '999999', size: 18 },
  ));

  const doc = new Document({
    creator: 'LLM Council',
    title: conv.title || 'Conversation Council',
    sections: [{ children: sections }],
  });

  return await Packer.toBuffer(doc);
}

// ============================================================================
// PPTX
// ============================================================================

const PPTX_COLORS = {
  primary: '4A90E2',
  text: '212529',
  textSecondary: '6C757D',
  accent: '198754',
  warning: 'D97706',
  danger: 'DC3545',
  bg: 'F8F9FA',
};

function addTitleSlide(pptx, title, subtitle) {
  const slide = pptx.addSlide();
  slide.background = { color: PPTX_COLORS.bg };
  slide.addText(title, {
    x: 0.5, y: 2.0, w: 9, h: 1.5,
    fontSize: 36, bold: true, color: PPTX_COLORS.text,
    align: 'center',
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 3.5, w: 9, h: 0.6,
      fontSize: 18, color: PPTX_COLORS.textSecondary,
      align: 'center',
    });
  }
  slide.addText('LLM Council Node.js · ' + new Date().toLocaleDateString('fr-FR'), {
    x: 0.5, y: 6.8, w: 9, h: 0.3,
    fontSize: 10, color: PPTX_COLORS.textSecondary,
    align: 'center', italic: true,
  });
}

function addContentSlide(pptx, title, contentLines, accent = PPTX_COLORS.primary) {
  const slide = pptx.addSlide();
  slide.addText(title, {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 24, bold: true, color: accent,
  });
  // Ligne separatrice
  slide.addShape('rect', {
    x: 0.5, y: 0.95, w: 9, h: 0.04, fill: { color: accent }, line: { color: accent },
  });

  // Texte tronque pour tenir dans le slide
  const truncated = contentLines.map((l) => (l.length > 200 ? l.slice(0, 197) + '...' : l)).slice(0, 12);
  slide.addText(truncated.join('\n\n'), {
    x: 0.5, y: 1.1, w: 9, h: 5.5,
    fontSize: 13, color: PPTX_COLORS.text,
    valign: 'top',
  });
}

export async function exportToPptx(conv, assistantIndex) {
  const msg = conv.messages[assistantIndex];
  const question = extractUserQuestion(conv, assistantIndex);
  const stage3 = msg.stage3 || {};
  const stage1 = msg.stage1 || [];
  const meta = msg.metadata || {};
  const timings = msg.timings || {};
  const pricing = msg.pricing?.total || {};

  const pptx = new PptxGenJS();
  pptx.author = 'LLM Council';
  pptx.title = conv.title || 'Conversation Council';
  pptx.layout = 'LAYOUT_WIDE';   // 16:9

  // Slide 1 : Titre
  addTitleSlide(pptx, conv.title || 'Council', `Pipeline ${stage1.length} modèles · ${formatDuration(timings.total_ms)}`);

  // Slide 2 : Question
  const qSlide = pptx.addSlide();
  qSlide.addText('Question posée', {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 24, bold: true, color: PPTX_COLORS.primary,
  });
  qSlide.addShape('rect', { x: 0.5, y: 0.95, w: 9, h: 0.04, fill: { color: PPTX_COLORS.primary }, line: { color: PPTX_COLORS.primary } });
  qSlide.addText(question, {
    x: 0.5, y: 1.3, w: 9, h: 5.5,
    fontSize: 16, color: PPTX_COLORS.text, valign: 'top',
  });

  // Slide 3 : Synthese
  addContentSlide(
    pptx,
    'Synthèse du Chairman',
    [
      `Modèle utilisé : ${stage3.model || 'inconnu'}${stage3.used_fallback ? ' (fallback)' : ''}`,
      '',
      ...String(stage3.response || '').split(/\n\n+/).slice(0, 6),
    ],
    PPTX_COLORS.accent,
  );

  // Slide 4 : Analyse (si presente)
  if (stage3.analysis && typeof stage3.analysis === 'object') {
    const a = stage3.analysis;
    const lines = [];
    if (Array.isArray(a.consensus_points) && a.consensus_points.length > 0) {
      lines.push('CONSENSUS :');
      a.consensus_points.slice(0, 3).forEach((p) => lines.push('  ✓ ' + p));
      lines.push('');
    }
    if (Array.isArray(a.disagreements) && a.disagreements.length > 0) {
      lines.push('DÉSACCORDS ARBITRÉS :');
      a.disagreements.slice(0, 2).forEach((d) => {
        lines.push('  • ' + (d.topic || ''));
        if (d.my_arbitration) lines.push('    → ' + d.my_arbitration.slice(0, 120));
      });
      lines.push('');
    }
    if (a.weighting_rationale) {
      lines.push('PONDÉRATION : ' + a.weighting_rationale.slice(0, 200));
    }
    if (lines.length > 0) addContentSlide(pptx, 'Analyse du Chairman', lines, PPTX_COLORS.warning);
  }

  // Slide(s) : Opinions individuelles (1 slide par modele)
  stage1.forEach((r, i) => {
    addContentSlide(
      pptx,
      `Opinion ${String.fromCharCode(65 + i)} — ${shortModel(r.model)}`,
      [
        `Modèle : ${r.model}${r.from_fallback ? ' (ajouté via fallback)' : ''}`,
        `Durée : ${formatDuration(r.duration_ms)}`,
        '',
        ...String(r.response || '').split(/\n\n+/).slice(0, 5),
      ],
      PPTX_COLORS.primary,
    );
  });

  // Slide : Classement Stage 2
  if (meta.aggregate_rankings && meta.aggregate_rankings.length > 0) {
    const slide = pptx.addSlide();
    slide.addText('Classement agrégé (Stage 2)', {
      x: 0.5, y: 0.3, w: 9, h: 0.6,
      fontSize: 24, bold: true, color: PPTX_COLORS.primary,
    });
    slide.addShape('rect', { x: 0.5, y: 0.95, w: 9, h: 0.04, fill: { color: PPTX_COLORS.primary }, line: { color: PPTX_COLORS.primary } });

    const rows = [
      [
        { text: 'Modèle', options: { bold: true, fill: { color: PPTX_COLORS.bg } } },
        { text: 'Rang moyen', options: { bold: true, fill: { color: PPTX_COLORS.bg } } },
        { text: 'Positions reçues', options: { bold: true, fill: { color: PPTX_COLORS.bg } } },
      ],
      ...meta.aggregate_rankings.map((a) => [
        shortModel(a.model),
        a.average_rank.toFixed(2),
        `[${(a.raw_positions || []).join(', ')}]`,
      ]),
    ];
    slide.addTable(rows, {
      x: 0.5, y: 1.2, w: 9,
      fontSize: 14, color: PPTX_COLORS.text,
      border: { type: 'solid', pt: 1, color: 'DDDDDD' },
    });
  }

  // Slide finale : metadonnees
  const lastSlide = pptx.addSlide();
  lastSlide.addText('Métadonnées du pipeline', {
    x: 0.5, y: 0.3, w: 9, h: 0.6,
    fontSize: 24, bold: true, color: PPTX_COLORS.primary,
  });
  lastSlide.addShape('rect', { x: 0.5, y: 0.95, w: 9, h: 0.04, fill: { color: PPTX_COLORS.primary }, line: { color: PPTX_COLORS.primary } });

  const metaLines = [];
  if (timings) {
    metaLines.push(`Temps Stage 1 : ${formatDuration(timings.stage1_ms)}`);
    metaLines.push(`Temps Stage 2 : ${formatDuration(timings.stage2_ms)}`);
    metaLines.push(`Temps Stage 3 : ${formatDuration(timings.stage3_ms)}`);
    metaLines.push(`Temps total : ${formatDuration(timings.total_ms)}`);
    metaLines.push('');
  }
  if (pricing.total_tokens != null) {
    metaLines.push(`Tokens : ${pricing.total_tokens} (${pricing.total_prompt_tokens || 0} in / ${pricing.total_completion_tokens || 0} out)`);
    if (pricing.total_cost_usd != null) metaLines.push(`Coût : $${pricing.total_cost_usd.toFixed(4)}`);
  }
  if (Array.isArray(meta.failed_models_stage1) && meta.failed_models_stage1.length > 0) {
    metaLines.push('');
    metaLines.push(`Modèles configurés sans réponse : ${meta.failed_models_stage1.length}`);
  }
  lastSlide.addText(metaLines.join('\n'), {
    x: 0.5, y: 1.3, w: 9, h: 5,
    fontSize: 16, color: PPTX_COLORS.text, valign: 'top',
  });

  // pptxgenjs.write retourne un base64 ou un buffer selon outputType
  return await pptx.write({ outputType: 'nodebuffer' });
}
