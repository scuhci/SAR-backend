const test = require('node:test');
const assert = require('node:assert');

const { jsonToCsv } = require('../utilities/jsonToCsv');

// Minimal RFC-4180 parser: every cell must be a quoted field, with "" for a
// literal quote. Throws if the row is not fully quoted.
function parseRow(line) {
  const cells = [];
  let i = 0;
  while (i < line.length) {
    assert.strictEqual(line[i], '"', `cell ${cells.length} is not quoted: ${line}`);
    i++;
    let cell = '';
    for (;;) {
      if (line[i] === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 2;
      } else if (line[i] === '"') {
        i++;
        break;
      } else {
        assert.ok(i < line.length, `unterminated quote in: ${line}`);
        cell += line[i++];
      }
    }
    cells.push(cell);
    if (i < line.length) {
      assert.strictEqual(line[i], ',', `expected comma after cell: ${line}`);
      i++;
    }
  }
  return cells;
}

test('array elements with quotes and commas are escaped as one cell', () => {
  const csv = jsonToCsv(
    [{ id: 1, title: 'Plain', languages: ['EN', 'He said "hi"', 'a,b'] }],
    'app'
  );
  const [header, row] = csv.split('\n');
  const cols = parseRow(header);
  const cells = parseRow(row);
  assert.strictEqual(cells.length, cols.length);
  assert.strictEqual(cells[cols.indexOf('supportedLanguages')], 'EN, He said "hi", a,b');
});

test('object values are serialised instead of [object Object]', () => {
  const csv = jsonToCsv([{ id: 1, meta: { a: 1, b: 'x' } }], 'app');
  const [header, row] = csv.split('\n');
  const cells = parseRow(row);
  assert.strictEqual(cells[parseRow(header).indexOf('meta')], '{"a":1,"b":"x"}');
  assert.ok(!csv.includes('[object Object]'));
});

test('dateScraped is a quoted ISO timestamp', () => {
  const csv = jsonToCsv([{ id: 1 }], 'app');
  const [header, row] = csv.split('\n');
  const cells = parseRow(row);
  const date = cells[parseRow(header).indexOf('dateScraped')];
  assert.match(date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!Number.isNaN(Date.parse(date)));
});

test('numbers, booleans and null still produce one quoted cell each', () => {
  const csv = jsonToCsv([{ id: 7, score: 4.5, free: true, price: null, url: undefined }], 'reviews');
  const [header, row] = csv.split('\n');
  const cols = parseRow(header);
  const cells = parseRow(row);
  assert.strictEqual(cells.length, cols.length);
  assert.strictEqual(cells[cols.indexOf('reviewID')], '7');
  assert.strictEqual(cells[cols.indexOf('rating')], '4.5');
  assert.strictEqual(cells[cols.indexOf('price')], '');
  assert.strictEqual(cells[cols.indexOf('reviewURL')], '');
});

test('string cells still have HTML stripped and quotes doubled', () => {
  const csv = jsonToCsv([{ id: 1, text: '<b>Say</b> &quot;yo&quot;\nnow' }], 'reviews');
  const [header, row] = csv.split('\n');
  const cells = parseRow(row);
  assert.strictEqual(cells[parseRow(header).indexOf('reviewText')], 'Say "yo" now');
});

test('a column missing from a later row is still a quoted empty cell', () => {
  const csv = jsonToCsv([{ id: 1, text: 'a', title: 't' }, { id: 2, text: 'b' }], 'reviews');
  const [header, , row2] = csv.split('\n');
  const cols = parseRow(header);
  const cells = parseRow(row2);
  assert.strictEqual(cells.length, cols.length);
  assert.strictEqual(cells[cols.indexOf('reviewTitle')], '');
});
