import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge as problemsOf } from '../e2e/typist/shifts.mjs';

const judge = (before, after, step) => problemsOf(before, after, step).map((problem) => problem.text);

const line = 27.2;
const heading = 54.4;
const gapAbove = 6.4;

/** A block painted at `top`, one line high unless said otherwise, with one painted line of text. The text names its row unless `row` does. */
const block = (kind, text, top, { height = line, left = 0, field = false, frozen = false, row = text, margin = 0, marginBottom = 0, lineHeights = [line] } = {}) => ({
  kind,
  text,
  row: field ? null : row,
  field,
  frozen,
  box: { top, left, width: 700, height },
  marginTop: margin,
  marginBottom,
  lines: field ? [] : [{ top: top + 3, left, width: 40, height: 20 }],
  lineHeights,
});
const p = (text, top, options) => block('p', text, top, options);
const field = (top, lines = 1, options) => block('field', '', top, { height: line * lines, field: true, ...options });
const moved = (b, by) => ({ ...b, box: { ...b.box, top: b.box.top + by }, lines: b.lines.map((l) => ({ ...l, top: l.top + by })) });

const note = () => [p('one', 0), field(line), p('three', line * 2), p('four', line * 3)];

test('a step that moves nothing is fine', () => {
  assert.deepEqual(judge(note(), note(), { typed: false }), []);
  assert.deepEqual(judge(note(), note(), { typed: true }), []);
});

test('the cursor passing to an equally tall block moves nothing', () => {
  const before = [p('one', 0), field(line), p('three', line * 2)];
  const after = [p('one', 0), p('two', line), field(line * 2)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
});

test('the field passing down over a blank row moves nothing, though the blank rows look the same', () => {
  const before = [p('one', 0), block('div.blank', '', line, { row: '1' }), field(line * 2), block('div.blank', '', line * 3, { row: '3' })];
  const after = [p('one', 0), block('div.blank', '', line, { row: '1' }), block('div.blank', '', line * 2, { row: '2' }), field(line * 3)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
});

test('typing a line more pushes the blocks below down by that line', () => {
  const after = [p('one', 0), field(line, 2), moved(p('three', line * 2), line), moved(p('four', line * 3), line)];
  assert.deepEqual(judge(note(), after, { typed: true }), []);
});

test('typing that pushes the blocks below down by half a line is caught', () => {
  const after = [p('one', 0), field(line), moved(p('three', line * 2), line / 2), moved(p('four', line * 3), line / 2)];
  const found = judge(note(), after, { typed: true });
  assert.equal(found.length, 1);
  assert.match(found[0], /not a whole number of 27.2px lines/);
});

test('turning a line into a heading changes the line height, so any height is fine', () => {
  const field39 = field(line, 1, { lineHeights: [39] });
  field39.box.height = 39;
  const after = [p('one', 0), field39, moved(p('three', line * 2), 39 - line), moved(p('four', line * 3), 39 - line)];
  assert.deepEqual(judge(note(), after, { typed: true }), []);
});

test('typing in a list moves the blocks below by more than lines, and is not judged by lines', () => {
  const list = block('ul', 'item', line, { height: 30, lineHeights: [line] });
  const before = [p('one', 0), list, p('after', 30 + line)];
  const after = [p('one', 0), field(line, 2), moved(p('after', 30 + line), 20)];
  assert.deepEqual(judge(before, after, { typed: true }), []);
});

test('a block that moves while no text changed is caught, with the blocks below', () => {
  const after = [p('one', 0), field(line, 2), moved(p('three', line * 2), line), moved(p('four', line * 3), line)];
  const found = judge(note(), after, { typed: false });
  assert.equal(found.length, 1);
  assert.match(found[0], /the text did not change, but the blocks below moved \+27.2px/);
});

test('a drawn block that is taller than the field which replaces it is caught as a jump below it', () => {
  const tall = block('p', 'tall', line, { height: line * 2 });
  const before = [p('one', 0), tall, p('three', line * 3)];
  const after = [p('one', 0), field(line), p('three', line * 2)];
  const found = judge(before, after, { typed: false });
  assert.equal(found.length, 1);
  assert.match(found[0], /the text did not change, but the blocks below moved -27.2px/);
});

test('a block above the cursor that moves is caught', () => {
  const after = note();
  after[0] = moved(after[0], 4);
  const found = judge(note(), after, { typed: true });
  assert.ok(found.some((problem) => /first block/.test(problem)));
});

test('a block that slides sideways is caught', () => {
  const after = note();
  after[3] = { ...after[3], box: { ...after[3].box, left: 3 }, lines: after[3].lines.map((l) => ({ ...l, left: 3 })) };
  const found = judge(note(), after, { typed: false });
  assert.ok(found.some((problem) => /moved sideways \+3px/.test(problem)));
});

test('two blocks that did not change and drift apart are caught, even when typing', () => {
  const after = note();
  after[3] = moved(after[3], 3);
  const found = judge(note(), after, { typed: true });
  assert.ok(found.some((problem) => /moved \+3px apart/.test(problem)));
});

test('a block whose lines wrap differently is caught', () => {
  const after = note();
  after[2] = { ...after[2], lines: [...after[2].lines, { top: 90, left: 0, width: 40, height: 20 }] };
  assert.ok(judge(note(), after, { typed: false }).some((problem) => /painted on 1 lines and is on 2/.test(problem)));
});

test('the text field growing at the end of the note, with no block after it, needs no anchor below', () => {
  const before = [p('one', 0), field(line)];
  const after = [p('one', 0), field(line, 2)];
  assert.deepEqual(judge(before, after, { typed: true }), []);
  assert.ok(judge(before, [p('one', 0), field(line * 1.3)], { typed: true }).length > 0);
});

test('a table whose own height differs from the rows that open in its place is caught as a jump', () => {
  const table = block('div.table-scroll', 'ab12', line, { height: 90 });
  const before = [p('one', 0), table, p('after', 90 + line)];
  const after = [p('one', 0), field(line, 4), p('after', line * 5)];
  assert.ok(judge(before, after, { typed: false }).some((problem) => /moved/.test(problem)));
});

const headed = () => [
  p('one', 0),
  block('h1', 'Head', line + gapAbove, { height: heading, margin: gapAbove }),
  p('three', line + gapAbove + heading),
];

test('a heading that the field takes over with the same margin and height moves nothing', () => {
  const after = [p('one', 0), field(line + gapAbove, 2, { height: heading, margin: gapAbove }), p('three', line + gapAbove + heading)];
  assert.deepEqual(judge(headed(), after, { typed: false }), []);
});

test('a margin that goes when the cursor enters a block is caught', () => {
  const after = [p('one', 0), field(line, 2, { height: heading, margin: 0 }), p('three', line + heading)];
  const found = judge(headed(), after, { typed: false });
  assert.ok(found.some((problem) => /the first touched block did not stay where it was, it moved -6.4px/.test(problem)));
  assert.ok(found.some((problem) => /the text did not change, but the blocks below moved -6.4px/.test(problem)));
});

test('a field that is a different height from the heading it replaces is caught', () => {
  const after = [p('one', 0), field(line + gapAbove, 2, { height: heading - 2.72, margin: gapAbove }), p('three', line + gapAbove + heading - 2.72)];
  assert.match(judge(headed(), after, { typed: false })[0], /the text did not change, but the blocks below moved -2.72px/);
});

test('a field that held the layout of the rows it replaced may reflow when the page commits it', () => {
  const before = [p('one', 0), field(line, 1, { frozen: true }), p('three', line * 2)];
  const after = [p('one', 0), block('h1', 'Head', line + gapAbove, { height: heading, margin: gapAbove }), moved(p('three', line * 2), heading + gapAbove - line)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
  before[1].frozen = false;
  assert.ok(judge(before, after, { typed: false }).length > 0);
});

test('a field that held the layout of the first rows may move them when the page commits it', () => {
  const before = [field(0, 1, { frozen: true }), p('after', line)];
  const after = [block('ul', 'item', 4), moved(p('after', line), 4)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
  before[0].frozen = false;
  assert.ok(judge(before, after, { typed: false }).some((problem) => /the first block/.test(problem)));
});

test('a list item field has margins of its own, so the move below it is not judged by lines', () => {
  const before = [p('one', 0), field(line), p('three', line * 2)];
  const after = [p('one', 0), p('two', line), field(line * 2 + 4, 1, { margin: 4 }), p('three', line * 3 + 8)];
  assert.deepEqual(judge(before, after, { typed: true }), []);
});

test('joining a heading with the blank row below it removes a blank line, which is not a whole number of heading lines', () => {
  const head = (top) => field(top, 1, { height: 40, lineHeights: [40] });
  const before = [head(0), block('div.blank', '', 40, { row: '1' }), p('after', 40 + line)];
  const after = [head(0), p('after', 40)];
  assert.deepEqual(judge(before, after, { typed: true }), []);
});

test('typing that turns a heading into a paragraph drops its margin, and its text moves up by that margin', () => {
  const before = [p('one', 0), block('h1', 'Head', line + gapAbove, { height: heading, margin: gapAbove }), p('three', line + gapAbove + heading)];
  const after = [p('one', 0), field(line, 2), p('three', line * 3)];
  assert.deepEqual(judge(before, after, { typed: true }), []);
});

test('a problem says how far a block moved and which blocks it is about', () => {
  const after = [p('one', 0), field(line, 2), moved(p('three', line * 2), line), moved(p('four', line * 3), line)];
  const [problem] = problemsOf(note(), after, { typed: false });
  assert.equal(Math.round(problem.change * 10) / 10, line);
  assert.deepEqual(problem.blocks.map((b) => b.kind), ['field', 'field']);
});

test('a list item field at the top has a margin below it only, so the move below it is not judged by lines either', () => {
  const item = field(0, 1, { marginBottom: 4 });
  const before = [item, block('div.blank', '', line + 4, { row: '1' })];
  const after = [field(0, 1, { marginBottom: 4 })];
  assert.deepEqual(judge(before, after, { typed: true }), []);
});

const rule = (top) => block('hr', '', top + 12.6, { height: 2, margin: 12.6, marginBottom: 12.6, row: '2' });

test('a rule takes the room of the row it replaces, though its line is drawn in the middle of it', () => {
  const before = [p('one', 0), field(line, 1), block('div.blank', '', line * 2, { row: '2' }), p('four', line * 3)];
  const after = [p('one', 0), rule(line), field(line * 2), p('four', line * 3)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
});

test('a rule with more room than the row it replaces is caught as a jump below it', () => {
  const before = [p('one', 0), field(line, 1), block('div.blank', '', line * 2, { row: '2' }), p('four', line * 3)];
  const wide = block('hr', '', line + 14.6, { height: 2, margin: 14.6, marginBottom: 14.6, row: '2' });
  const after = [p('one', 0), wide, moved(field(line * 2), 4), moved(p('four', line * 3), 4)];
  assert.ok(judge(before, after, { typed: false }).some((problem) => /the text did not change, but the blocks below moved \+4px/.test(problem)));
});

test('a rule at the end of the note takes the room of the row it replaces', () => {
  const before = [p('one', 0), field(line)];
  const after = [p('one', 0), rule(line)];
  assert.deepEqual(judge(before, after, { typed: false }), []);
  const wide = block('hr', '', line + 14.6, { height: 2, margin: 14.6, marginBottom: 14.6, row: '2' });
  assert.ok(judge(before, [p('one', 0), wide], { typed: false }).some((problem) => /moved \+4px/.test(problem)));
});
