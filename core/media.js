// Files for the widgets, uploaded or from a link: at most 10 MB; images and GIFs bigger than 512 px on their longest
// side are shrunk to it (animated GIF and WebP keep every frame), smaller ones stay exactly as they are.
// A link is downloaded once (through the proxy setting, like everything else) and then treated like an upload. Giphy and
// Tenor page links give the GIF on the page, or its MP4 when the GIF is over 10 MB.
const sharp = require('sharp');
const { sniff } = require('./settings');

const MAX_BYTES = 10 * 1024 * 1024;
const SIDE = 512;
const RASTER = { png: 'png', jpg: 'jpeg', gif: 'gif', webp: 'webp' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const bad = (code) => Object.assign(new Error(code), { status: 400, code });

async function shrink(buf) {
  if (!Buffer.isBuffer(buf)) throw bad('bad_request');
  const format = RASTER[sniff(buf)];
  if (!format) return buf; // a video or a sound
  try {
    const img = sharp(buf, { animated: true });
    const { width, height, pageHeight = height } = await img.metadata(); // animated: height is all the frames, one above the other
    if (Math.max(width, pageHeight) <= SIDE) return buf;
    if (format === 'jpeg') img.rotate(); // a phone photo: upright, as its EXIF says
    return await img.resize(SIDE, SIDE, { fit: 'inside' }).toFormat(format).toBuffer();
  } catch {
    throw bad('bad_file');
  }
}

// GET a link, 10 MB at most -> { buf, type, url } (url: where it ended up after redirects).
async function get(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw bad('link_failed');
  }
  if (!res.ok) throw bad('link_failed');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) {
    res.body?.cancel().catch(() => {});
    throw bad('too_large');
  }
  const parts = [];
  let n = 0;
  try {
    for await (const part of res.body) {
      n += part.length;
      if (n > MAX_BYTES) throw bad('too_large'); // leaving the loop stops the download
      parts.push(part);
    }
  } catch (err) {
    throw err.code === 'too_large' ? err : bad('link_failed');
  }
  return { buf: Buffer.concat(parts), type: res.headers.get('content-type') ?? '', url: new URL(res.url) };
}

// A Giphy page (giphy.com/gifs/<words>-<id>, /stickers/..., /embed/<id>) -> its GIF, then its MP4.
function giphy(url) {
  const id = /^(www\.)?giphy\.com$/i.test(url.hostname) && /^\/(?:gifs|stickers|embed)\/(?:.*-)?([a-z0-9]+)\/?$/i.exec(url.pathname)?.[1];
  return id ? [`https://media.giphy.com/media/${id}/giphy.gif`, `https://media.giphy.com/media/${id}/giphy.mp4`] : null;
}

// A Tenor page -> its GIF (og:image), then its MP4 (og:video).
function tenor(url, html) {
  if (!/(^|\.)tenor\.com$/i.test(url.hostname)) return null;
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1].toLowerCase();
    const val = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && val) meta[key] ??= val.replace(/&amp;/g, '&');
  }
  return ['og:image', 'og:video:secure_url', 'og:video'].map((k) => meta[k]).filter(Boolean);
}

// A link -> { buf, name }. Errors: bad_link (not a web address), link_failed, too_large, not_media (a page, or a file
// that isn't an image, GIF, video or sound).
async function download(link) {
  let url;
  try { url = new URL(link); } catch {}
  if (!url || !/^https?:$/.test(url.protocol)) throw bad('bad_link');
  let name;
  try { name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? ''); } catch {}
  name ||= url.hostname;
  let files = giphy(url);
  if (!files) {
    const got = await get(url);
    if (sniff(got.buf)) return { buf: got.buf, name };
    files = /html/i.test(got.type) ? giphy(got.url) ?? tenor(got.url, got.buf.toString('utf8')) : null; // a short link can end up on a page
    if (!files?.length) throw bad('not_media');
  }
  // The page's GIF, else its video: the first one that downloads within 10 MB.
  let err;
  for (const file of files) {
    try {
      const got = await get(new URL(file, url));
      if (sniff(got.buf)) return { buf: got.buf, name };
      err = bad('not_media');
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

module.exports = { shrink, download, MAX_BYTES };
