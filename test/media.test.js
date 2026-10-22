// core/media.js: images and GIFs over 512 px are shrunk (animated ones keep their frames), smaller ones stay byte for
// byte; links are downloaded once, Giphy and Tenor pages give their GIF (their MP4 when the GIF is over 10 MB).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

process.env.JARCHI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchi-media-'));
const media = require('../core/media');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); // 1 x 1
const MP4 = Buffer.from('\0\0\0\x18ftypisom\0\0\0\0', 'latin1');
const frame = (color, width = 1000, height = 600) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();

test('shrink: over 512 px -> 512 on the longest side, same format; animated stays animated; small ones untouched', async () => {
  let m = await sharp(await media.shrink(await frame('#f00'))).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['png', 512, 307]);
  m = await sharp(await media.shrink(await sharp(await frame('#f00', 600, 2000)).jpeg().toBuffer())).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['jpeg', 154, 512]);
  for (const format of ['gif', 'webp']) {
    const anim = await sharp([await frame('#f00'), await frame('#00f'), await frame('#0f0')], { join: { animated: true } }).toFormat(format, { delay: [100, 200, 300], loop: 0 }).toBuffer();
    m = await sharp(await media.shrink(anim), { animated: true }).metadata();
    assert.deepEqual([m.format, m.width, m.pageHeight, m.pages, m.delay], [format, 512, 307, 3, [100, 200, 300]], format);
  }
  assert.equal(await media.shrink(GIF), GIF, 'a small image is never enlarged or re-encoded');
  assert.equal(await media.shrink(MP4), MP4, 'videos and sounds pass through');
  await assert.rejects(media.shrink(Buffer.from('GIF89a broken', 'latin1')), { code: 'bad_file' });
});

// The internet, for the link tests: url -> [body, headers].
const web = {};
const realFetch = global.fetch;
test.before(() => {
  global.fetch = async (url) => {
    const [body, headers] = web[String(url)] ?? [];
    if (!body) return new Response('not found', { status: 404 });
    const res = new Response(body, { headers });
    Object.defineProperty(res, 'url', { value: String(url) });
    return res;
  };
});
test.after(() => (global.fetch = realFetch));

test('links: a file, Giphy and Tenor pages, and what fails', async () => {
  web['https://example.com/media/party.gif'] = [GIF, { 'content-type': 'image/gif' }];
  assert.deepEqual(await media.download('https://example.com/media/party.gif'), { buf: GIF, name: 'party.gif' });

  // Giphy: the id at the end of the page's address -> media.giphy.com, without loading the page.
  web['https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif'] = [GIF];
  assert.deepEqual(await media.download('https://giphy.com/gifs/cat-funny-JIX9t2j0ZTN9S'), { buf: GIF, name: 'cat-funny-JIX9t2j0ZTN9S' });

  // Tenor: og:image (the GIF), here over 10 MB, so og:video (the MP4).
  web['https://tenor.com/view/cat-cute-gif-26060295'] = ['<html><head><meta class="dynamic" property="og:image" content="https://media1.tenor.com/m/abc/cat.gif">'
    + '<meta class="dynamic" property="og:video" content="https://media.tenor.com/abc/cat.mp4"></head></html>', { 'content-type': 'text/html; charset=utf-8' }];
  web['https://media1.tenor.com/m/abc/cat.gif'] = [Buffer.alloc(11 * 1024 * 1024, 1)];
  web['https://media.tenor.com/abc/cat.mp4'] = [MP4];
  assert.deepEqual((await media.download('https://tenor.com/view/cat-cute-gif-26060295')).buf, MP4);

  web['https://example.com/page'] = ['<html><meta property="og:image" content="https://example.com/media/party.gif"></html>', { 'content-type': 'text/html' }];
  await assert.rejects(media.download('https://example.com/page'), { code: 'not_media' }, 'only Giphy and Tenor pages are read');
  web['https://example.com/notes.txt'] = ['just text', { 'content-type': 'text/plain' }];
  await assert.rejects(media.download('https://example.com/notes.txt'), { code: 'not_media' });
  web['https://example.com/huge.gif'] = [Buffer.alloc(11 * 1024 * 1024, 1)];
  await assert.rejects(media.download('https://example.com/huge.gif'), { code: 'too_large' });
  await assert.rejects(media.download('https://example.com/gone.gif'), { code: 'link_failed' });
  await assert.rejects(media.download('ftp://example.com/a.gif'), { code: 'bad_link' });
  await assert.rejects(media.download('not a link'), { code: 'bad_link' });
});
