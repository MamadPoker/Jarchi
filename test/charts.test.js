const test = require('node:test');
const assert = require('node:assert/strict');
const { starsSeries, installsByVersion, addReading, downloadsSeries, starsSvg, downloadsSvg, niceMax } = require('../build/charts');

test('stars add up oldest first', () => {
  assert.deepEqual(starsSeries(['2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z']), [
    [Date.parse('2026-11-01T00:00:00Z'), 1],
    [Date.parse('2026-11-02T00:00:00Z'), 2],
  ]);
});

test('downloads count only the installer, and a version on both repos is added up', () => {
  const asset = (name, download_count) => ({ name, download_count });
  const versions = installsByVersion([
    {
      tag_name: 'v1.0.3',
      published_at: '2026-11-01T00:00:00Z',
      assets: [asset('Jarchi-Setup.exe', 2), asset('latest.yml', 30), asset('Jarchi-Setup.exe.blockmap', 4)],
    },
    { tag_name: 'v1.0.2', published_at: '2026-10-29T22:38:00Z', assets: [asset('Jarchi-Setup.exe', 2)] },
    { tag_name: 'v1.0.2', published_at: '2026-10-29T22:37:00Z', assets: [asset('Jarchi-Setup.exe', 6)] },
  ]);
  assert.deepEqual(
    versions.map((v) => [v.tag, v.n]),
    [
      ['v1.0.2', 8],
      ['v1.0.3', 2],
    ],
  );
});

test('one reading a day: a second run the same day replaces it, the past stays', () => {
  const at = Date.parse('2026-11-15T12:00:00Z');
  assert.deepEqual(
    addReading(
      [
        ['2026-11-14', 50],
        ['2026-11-15', 51],
      ],
      53,
      at,
    ),
    [
      ['2026-11-14', 50],
      ['2026-11-15', 53],
    ],
  );
});

test('before the first reading, the downloads are estimated from the releases', () => {
  const v = (tag, at, n) => ({ tag, at: Date.parse(at), n });
  const s = downloadsSeries(
    [v('v1.0.0', '2026-10-23T00:00:00Z', 8), v('v1.0.1', '2026-10-24T00:00:00Z', 6), v('v1.0.2', '2026-11-20T00:00:00Z', 1)],
    [['2026-11-14', 20]],
  );
  // By each release date, the versions before it had their downloads; v1.0.2 came after the first reading.
  assert.deepEqual(s.releases, [
    [Date.parse('2026-10-23T00:00:00Z'), 0],
    [Date.parse('2026-10-24T00:00:00Z'), 8],
  ]);
  assert.deepEqual(s.est.at(-1), [Date.parse('2026-11-14'), 20]);
  assert.deepEqual(s.real, [[Date.parse('2026-11-14'), 20]]);
});

test('the scale is four whole-number steps', () => {
  assert.deepEqual([0, 3, 6, 8, 50, 130].map(niceMax), [4, 4, 8, 8, 80, 200]);
});

test('the charts draw, with an empty repo too', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  assert.match(starsSvg([[now - 1e9, 1]], now), /aria-label="Star history: 1 star"/);
  assert.match(starsSvg([], now), /<svg/);
  const s = downloadsSeries([{ tag: 'v1.0.0', at: now - 1e9, n: 8 }], [['2026-11-14', 8]]);
  assert.match(downloadsSvg(s, now), /aria-label="Downloads: 8 installer downloads"/);
  assert.match(downloadsSvg(downloadsSeries([], []), now), /<svg/);
});
