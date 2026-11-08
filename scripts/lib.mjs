// Pure helpers used by build.mjs (kept separate so they can be unit tested).

/** Minimal .env parser: KEY=value, # comments, optional quotes. */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function slugify(name) {
  return name
    .replace(/\.html?$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';
}

/** "Cece:🦄, Alana:🌈" -> [{ id, name, emoji }] */
export function parsePlayers(value) {
  if (!value) return [];
  const seen = new Set();
  const players = [];
  for (const part of value.split(',')) {
    const [rawName, rawEmoji] = part.split(':');
    const name = (rawName || '').trim();
    if (!name) continue;
    const id = slugify(name);
    if (seen.has(id)) continue;
    seen.add(id);
    players.push({ id, name, emoji: (rawEmoji || '').trim() || '⭐' });
  }
  return players;
}

export function parseBool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

/** Pull <title> text out of an HTML document, if any. */
export function htmlTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

/** Insert the bridge <script> as the very first thing in <head>. */
export function injectBridge(html, src = '/arcade-bridge.js', extra = '') {
  if (html.includes(src)) return html;
  const tag = `<script src="${src}"></script>${extra}`;
  const head = html.match(/<head[^>]*>/i);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  // No <head>: put it right after <html ...> or at the very top.
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

const DEFAULT_COLORS = [
  ['#ff7ac6', '#8b5cf6'],
  ['#38bdf8', '#6366f1'],
  ['#fbbf24', '#f97316'],
  ['#34d399', '#0ea5e9'],
  ['#f472b6', '#fb7185'],
];

/**
 * Merge games/games.json metadata with the HTML files actually present.
 * - Every listed game must have its file (otherwise it is skipped + warned).
 * - Any HTML file not listed is added with sensible defaults, so dropping a
 *   new game into games/ is enough to see it in the arcade.
 */
export function buildManifest(meta, files, readTitle = () => '') {
  const warnings = [];
  const games = [];
  const usedIds = new Set();
  const fileSet = new Set(files);
  const listedFiles = new Set();

  for (const entry of meta) {
    if (!entry || !entry.file) { warnings.push('games.json entry without "file" skipped'); continue; }
    listedFiles.add(entry.file);
    if (entry.hidden) continue;
    if (!fileSet.has(entry.file)) { warnings.push(`games.json lists "${entry.file}" but it is not in games/`); continue; }
    const id = entry.id ? slugify(entry.id) : slugify(entry.file);
    if (usedIds.has(id)) { warnings.push(`duplicate game id "${id}" skipped`); continue; }
    usedIds.add(id);
    games.push(normalize({ ...entry, id }, games.length));
  }

  for (const file of files) {
    if (listedFiles.has(file)) continue;
    let id = slugify(file);
    while (usedIds.has(id)) id += '-2';
    usedIds.add(id);
    const title = readTitle(file) || file.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ');
    warnings.push(`"${file}" is not in games.json — added with default look (id "${id}")`);
    games.push(normalize({ id, file, title }, games.length));
  }
  return { games, warnings };
}

function normalize(entry, index) {
  const colors = Array.isArray(entry.colors) && entry.colors.length >= 2 ? entry.colors.slice(0, 2) : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  const orientation = ['landscape', 'portrait', 'any'].includes(entry.orientation) ? entry.orientation : 'any';
  const menuButton = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(entry.menuButton) ? entry.menuButton : 'top-left';
  const background = /^#[0-9a-f]{3,8}$/i.test(entry.background || '') ? entry.background : '#000000';
  return {
    id: entry.id,
    file: entry.file,
    path: `games/${entry.id}.html`,
    title: String(entry.title || entry.id),
    tagline: String(entry.tagline || ''),
    emoji: String(entry.emoji || '🎮'),
    colors,
    orientation,
    controls: String(entry.controls || ''),
    menuButton,
    background,
    saves: entry.saves === true, // off unless a game explicitly opts in
  };
}
