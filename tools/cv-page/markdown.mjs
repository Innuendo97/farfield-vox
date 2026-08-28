// The same small markdown the rooms of the world read, rendered to a string
// instead of to DOM nodes.
//
// It is deliberately a second implementation of the grammar in src/ui/room.js
// and not a shared module: that one builds elements and appends text nodes, so
// nothing it renders can become markup, while this one has to escape by hand.
// The grammar itself is tiny and fixed — headings, paragraphs, lists, bold,
// italic and code, which is all the detail fields in content/*.json are written
// in — so keeping the two in step is a matter of reading twenty lines.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Every string that reaches the page goes through this, without exception. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Bold, italic and code in one pass. The alternatives are ordered so the two
// star forms cannot be confused: the double one has to be tried first.
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

export function renderInline(source) {
  let html = '';
  for (const piece of String(source ?? '').split(INLINE)) {
    if (!piece) continue;
    if ((piece.startsWith('**') && piece.endsWith('**'))
      || (piece.startsWith('__') && piece.endsWith('__'))) {
      html += `<strong>${escapeHtml(piece.slice(2, -2))}</strong>`;
    } else if ((piece.startsWith('*') && piece.endsWith('*'))
      || (piece.startsWith('_') && piece.endsWith('_'))) {
      html += `<em>${escapeHtml(piece.slice(1, -1))}</em>`;
    } else if (piece.startsWith('`') && piece.endsWith('`')) {
      html += `<code>${escapeHtml(piece.slice(1, -1))}</code>`;
    } else {
      html += escapeHtml(piece);
    }
  }
  return html;
}

/**
 * Headings, paragraphs, lists and the inline forms above. Nothing else.
 *
 * Headings start at h4 because the page has already spent h1 on the name, h2 on
 * the section and h3 on the entry this detail belongs to.
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').split('\n');
  let html = '';
  let paragraph = [];
  let list = null;

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${renderInline(paragraph.join(' '))}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length + 3;
      html += `<h${level}>${renderInline(heading[2])}</h${level}>`;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (list !== wanted) {
        closeList();
        html += `<${wanted}>`;
        list = wanted;
      }
      html += `<li>${renderInline((bullet || numbered)[1])}</li>`;
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  closeParagraph();
  closeList();
  return html;
}
