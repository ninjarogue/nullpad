// Reads where the page paints each block of the note, and judges whether a step moved any block
// that it had no business moving. The rule, in words, is at the top of run.mjs.

/**
 * Where a box is, in the coordinates of the page's own content: scrolling the page moves nothing.
 * @typedef {{ top: number, left: number, width: number, height: number }} Box
 */

/**
 * A block of the note as the page paints it: a drawn element above or below the text field, or the
 * text field's own part. `row` is the first row of the note the block draws, `lines` the painted
 * lines of text in it, `lineHeights` the line heights its text is set in. A `frozen` field keeps
 * the layout of the rows it replaced until the page commits it.
 * @typedef {{ kind: string, text: string, row: string | null, field: boolean, frozen: boolean, box: Box, marginTop: number, marginBottom: number, lines: Box[], lineHeights: number[] }} Block
 */

const tolerance = 0.5;

const tokens = (value) => (value ?? '').split(/\s+/).filter(Boolean);
const round = (n) => Math.round(n * 10) / 10;

/** Every block the page paints, top to bottom, in one protocol call. */
export async function capture(cdp) {
  const { documents, strings } = await cdp.send('DOMSnapshot.captureSnapshot', {
    computedStyles: ['line-height', 'margin-top', 'margin-bottom'],
    includeDOMRects: true,
  });
  const [{ nodes, layout, textBoxes }] = documents;
  const word = (i) => strings[i];
  const layoutOf = new Map(layout.nodeIndex.map((node, i) => [node, i]));
  const children = nodes.parentIndex.map(() => []);
  nodes.parentIndex.forEach((parent, node) => parent >= 0 && children[parent].push(node));
  const isElement = (node) => nodes.nodeType[node] === 1;
  const attribute = (node, name) => {
    const attributes = nodes.attributes[node];
    for (let i = 0; i < attributes.length; i += 2) if (word(attributes[i]) === name) return word(attributes[i + 1]);
    return null;
  };
  const classes = (node) => tokens(attribute(node, 'class'));

  const page = nodes.nodeName.findIndex((name, node) => word(name) === 'DIV' && classes(node).includes('page') && classes(node).includes('live'));
  if (page < 0) return null;
  const [scrollLeft, scrollTop] = layout.scrollRects[layoutOf.get(page)];
  const boxOf = (node) => {
    const [left, top, width, height] = layout.bounds[layoutOf.get(node)];
    return { left: left + scrollLeft, top: top + scrollTop, width, height };
  };
  const style = (node, at) => word(layout.styles[layoutOf.get(node)][at]);
  const lineHeightOf = (node) => {
    const value = style(node, 0);
    return value.endsWith('px') ? round(parseFloat(value)) : null;
  };

  const owner = new Map();
  const blocks = [];
  const take = (root, field) => {
    const index = blocks.length;
    const parts = [];
    const lineHeights = new Set();
    const walk = (node) => {
      owner.set(node, index);
      if (nodes.nodeType[node] === 3) parts.push(word(nodes.nodeValue[node]));
      else if (layoutOf.has(node) && children[node].some((child) => nodes.nodeType[child] === 3)) {
        const height = lineHeightOf(node);
        if (height !== null) lineHeights.add(height);
      }
      children[node].forEach(walk);
    };
    walk(root);
    const name = word(nodes.nodeName[root]).toLowerCase();
    const own = classes(root);
    if (own.includes('blank')) lineHeights.add(round(boxOf(root).height));
    const textarea = field ? nodes.nodeName.findIndex((n, node) => word(n) === 'TEXTAREA' && owner.get(node) === index) : -1;
    blocks.push({
      kind: field ? 'field' : [name, ...own.filter((c) => c === 'blank' || c === 'table-scroll')].join('.'),
      text: parts.join(''),
      row: field ? null : attribute(root, 'data-row'),
      field,
      frozen: field && (own.includes('framed') || own.includes('held')),
      box: boxOf(root),
      marginTop: parseFloat(style(root, 1)) || 0,
      marginBottom: parseFloat(style(root, 2)) || 0,
      lines: [],
      lineHeights: [...lineHeights, ...(textarea >= 0 && lineHeightOf(textarea) !== null ? [lineHeightOf(textarea)] : [])].sort((a, b) => a - b),
    });
  };
  for (const part of children[page]) {
    if (!isElement(part) || !classes(part).includes('part') || !layoutOf.has(part)) continue;
    if (classes(part).includes('editor')) {
      if (!classes(part).includes('painted')) take(part, true);
    } else for (const block of children[part]) if (isElement(block) && layoutOf.has(block)) take(block, false);
  }
  textBoxes.layoutIndex.forEach((at, i) => {
    const block = blocks[owner.get(layout.nodeIndex[at])];
    if (!block || block.field) return;
    const [left, top, width, height] = textBoxes.bounds[i];
    block.lines.push({ left: left + scrollLeft, top: top + scrollTop, width, height });
  });
  return blocks;
}

/** What makes two blocks the same block in both pages. The rows hold still unless the text changed. */
const key = (block, typed) => (block.field ? null : `${block.kind}\0${typed ? '' : block.row}\0${block.text}`);

/**
 * The pairs [before, after] of blocks that are the same block in both, and never the text field.
 * A step that changed the text pairs only the blocks it left alone at the top and at the bottom.
 */
function align(before, after, typed) {
  const same = (i, j) => key(before[i], typed) !== null && key(before[i], typed) === key(after[j], typed);
  const pairs = [];
  let head = 0;
  while (head < before.length && head < after.length && same(head, head)) pairs.push([head, head++]);
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && same(before.length - 1 - tail, after.length - 1 - tail)) tail++;
  if (!typed) {
    const rest = [before.length - tail - head, after.length - tail - head];
    const best = Array.from({ length: rest[0] + 1 }, () => new Array(rest[1] + 1).fill(0));
    for (let i = rest[0] - 1; i >= 0; i--)
      for (let j = rest[1] - 1; j >= 0; j--)
        best[i][j] = same(head + i, head + j) ? best[i + 1][j + 1] + 1 : Math.max(best[i + 1][j], best[i][j + 1]);
    for (let i = 0, j = 0; i < rest[0] && j < rest[1]; ) {
      if (same(head + i, head + j)) pairs.push([head + i++, head + j++]);
      else if (best[i + 1][j] >= best[i][j + 1]) i++;
      else j++;
    }
  }
  for (let i = 0; i < tail; i++) pairs.push([before.length - tail + i, after.length - tail + i]);
  return pairs;
}

/** Where the room a block takes starts and ends. A rule draws its line in the middle of its margins, so its room is its margins and its line. */
const roomTop = (block) => (block.kind === 'hr' ? block.box.top - block.marginTop : block.box.top);
const roomBottom = (block) => block.box.top + block.box.height + (block.kind === 'hr' ? block.marginBottom : 0);

const px = (n) => `${n > 0 ? '+' : ''}${Math.round(n * 100) / 100}px`;
const name = (block) => (block.field ? 'text field' : `${block.kind} ${JSON.stringify(block.text.slice(0, 24))}`);
const names = (blocks) => (blocks.length ? blocks.map(name).join(', ') : 'nothing');
const plain = (block) => (block.field || block.kind === 'p' || block.kind === 'div.blank') && block.marginTop === 0 && block.marginBottom === 0;

/**
 * One thing a step moved that it should not have: what it says, how far (0 when it is not a
 * distance) and the blocks it is about, as they were painted.
 * @typedef {{ text: string, change: number, blocks: { kind: string, text: string }[] }} Problem
 */

/**
 * What the step moved that it should not have. `typed` says the step changed the text.
 * @param {Block[]} before
 * @param {Block[]} after
 * @param {{ typed: boolean }} step
 * @returns {Problem[]}
 */
export function judge(before, after, { typed }) {
  const problems = [];
  const report = (text, change, blocks) => problems.push({ text, change, blocks: blocks.map(({ kind, text }) => ({ kind, text })) });
  if (!before.length || !after.length) return problems;
  const pairs = align(before, after, typed);

  const first = roomTop(after[0]) - roomTop(before[0]);
  if (Math.abs(first) > tolerance && !before[0].frozen) report(`the first block moved ${px(first)}: ${name(before[0])} -> ${name(after[0])}`, first, [before[0], after[0]]);

  let drift = 0;
  let from = [0, 0];
  const gap = (to, anchors) => {
    const lost = before.slice(from[0], to[0]);
    const gained = after.slice(from[1], to[1]);
    const touched = [...lost, ...gained];
    const earlier = drift;
    const change = anchors - earlier;
    const where = `${names(lost)} -> ${names(gained)}`;
    drift = anchors;
    if (lost.some((block) => block.frozen)) return;
    const moved = lost.length && gained.length && (!typed || touched.every(plain)) ? roomTop(gained[0]) - roomTop(lost[0]) - earlier : 0;
    if (Math.abs(moved) > tolerance) report(`the first touched block did not stay where it was, it moved ${px(moved)}: ${where}`, moved, touched);
    if (!touched.length) {
      if (Math.abs(change) > tolerance) report(`two blocks that did not change moved ${px(change)} apart: ${name(before[from[0] - 1] ?? before[to[0]])}`, change, [before[from[0] - 1] ?? before[to[0]]]);
    } else if (!typed) {
      if (Math.abs(change) > tolerance) report(`the text did not change, but the blocks below moved ${px(change)}: ${where}`, change, touched);
    } else if (touched.every(plain)) {
      const heights = [...new Set(touched.flatMap((block) => block.lineHeights))];
      if (heights.length === 1) {
        const lines = Math.round(change / heights[0]);
        if (Math.abs(change - lines * heights[0]) > tolerance + 0.02 * Math.abs(lines)) {
          report(`the blocks below moved ${px(change)}, not a whole number of ${heights[0]}px lines: ${where}`, change, touched);
        }
      }
    }
  };

  for (const [i, j] of pairs) {
    gap([i, j], after[j].box.top - before[i].box.top);
    from = [i + 1, j + 1];
    const was = before[i];
    const now = after[j];
    const shift = now.box.top - was.box.top;
    if (Math.abs(now.box.left - was.box.left) > tolerance) report(`${name(now)} moved sideways ${px(now.box.left - was.box.left)}`, now.box.left - was.box.left, [now]);
    if (Math.abs(now.box.height - was.box.height) > tolerance) report(`${name(now)} changed height ${px(now.box.height - was.box.height)}`, now.box.height - was.box.height, [now]);
    if (now.lines.length !== was.lines.length) report(`${name(now)} was painted on ${was.lines.length} lines and is on ${now.lines.length}`, 0, [now]);
    else
      now.lines.forEach((line, n) => {
        const old = was.lines[n];
        if (Math.abs(line.left - old.left) > tolerance) report(`line ${n + 1} of ${name(now)} moved sideways ${px(line.left - old.left)}`, line.left - old.left, [now]);
        else if (Math.abs(line.top - old.top - shift) > tolerance) report(`line ${n + 1} of ${name(now)} moved ${px(line.top - old.top - shift)} within its block`, line.top - old.top - shift, [now]);
        else if (Math.abs(line.width - old.width) > tolerance) report(`line ${n + 1} of ${name(now)} changed width ${px(line.width - old.width)}`, line.width - old.width, [now]);
      });
  }
  const bottom = (blocks) => roomBottom(blocks.at(-1));
  const last = pairs.at(-1);
  if (!last || last[0] !== before.length - 1 || last[1] !== after.length - 1) gap([before.length, after.length], bottom(after) - bottom(before));
  return problems;
}
