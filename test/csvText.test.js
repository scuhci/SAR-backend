const test = require('node:test');
const assert = require('node:assert');

const { cleanText, jsonToCsv } = require('../utilities/jsonToCsv');

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

test('review text preserves angle brackets and entity text', () => {
  const texts = [
    'I <3 this app, but 5 > 4 stars is fair',
    'Works on iOS <15 and on watchOS >9, nothing else',
    'a < b and c > d',
    'AT&amp;T 5 &gt; 4',
  ];

  for (const TEXT of texts) {
    const csv = jsonToCsv([{
      id: '1',
      version: '1.0',
      score: 5,
      title: TEXT,
      text: TEXT,
      url: 'u',
      updated: 'd',
    }], 'reviews');
    const [header, row] = csv.split('\n');
    const columns = parseRow(header);
    const cells = parseRow(row);
    assert.strictEqual(cells[columns.indexOf('reviewTitle')], TEXT);
    assert.strictEqual(cells[columns.indexOf('reviewText')], TEXT);
  }
});

test('app description and release notes preserve angle brackets', () => {
  const description = 'Supports iOS <15 and watchOS >9';
  const releaseNotes = 'Fixed crash when count <10 or >99';
  const csv = jsonToCsv([{
    title: 'App',
    appId: 'a.b',
    description,
    releaseNotes,
  }], 'app');
  const [header, row] = csv.split('\n');
  const columns = parseRow(header);
  const cells = parseRow(row);
  assert.strictEqual(cells[columns.indexOf('description')], description);
  assert.strictEqual(cells[columns.indexOf('releaseNotes')], releaseNotes);
});

test('cleanText keeps ordinary angle brackets', () => {
  assert.strictEqual(cleanText('a < b and c > d'), 'a < b and c > d');
});

test('review text still doubles quotes for CSV', () => {
  const text = 'Great, "really" great; 5 > 4';
  const csv = jsonToCsv([{
    id: '1',
    version: '1.0',
    score: 5,
    title: 'Great',
    text,
    url: 'u',
    updated: 'd',
  }], 'reviews');
  const [header, row] = csv.split('\n');
  const columns = parseRow(header);
  const cells = parseRow(row);
  assert.strictEqual(cells[columns.indexOf('reviewText')], text);
});
