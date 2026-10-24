// What's new: each version's changes in English and Persian, written once in i18n/changelog.json (newest first). The
// panel shows that file on its What's new page. npm run release makes a version's notes the release text (build/notes.js):
// the English list, then the Persian one in a right-to-left block, as GitHub shows it. The installed app reads that
// text back from the update it downloaded (electron/main.js), so What's new has the update's notes before the restart.
const RTL = '<div dir="rtl">';
const list = (items) => items.map((s) => `- ${s}`).join('\n');
const text = ({ en, fa }) => `${list(en)}\n\n${RTL}\n\n${list(fa)}\n\n</div>\n`;
function parse(notes) {
  const items = (part = '') => part.split(/\r?\n/).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
  const [en, fa] = notes.split(RTL);
  return { en: items(en), fa: items(fa) };
}

module.exports = { text, parse };
