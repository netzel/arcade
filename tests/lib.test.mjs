import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, slugify, parsePlayers, parseBool, htmlTitle, injectBridge, buildManifest } from '../scripts/lib.mjs';

test('parseEnv handles comments, blanks, quotes, and = in values', () => {
  const env = parseEnv("# c\n\nA=1\nB=\"two words\"\nC='x'\nD=a=b\n  E = spaced \nbad line\n");
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x', D: 'a=b', E: 'spaced' });
});

test('slugify makes safe ids', () => {
  assert.equal(slugify('midnight walk - unicorn maze game.html'), 'midnight-walk-unicorn-maze-game');
  assert.equal(slugify('Midnight_Walk_v4.HTML'), 'midnight-walk-v4');
  assert.equal(slugify('!!!.html'), 'game');
});

test('parsePlayers parses Name:emoji, defaults emoji, drops blanks and dupes', () => {
  assert.deepEqual(parsePlayers('Cece:🦄, Alana:🌈 ,, cece:🐱, Sam'), [
    { id: 'cece', name: 'Cece', emoji: '🦄' },
    { id: 'alana', name: 'Alana', emoji: '🌈' },
    { id: 'sam', name: 'Sam', emoji: '⭐' },
  ]);
  assert.deepEqual(parsePlayers(''), []);
  assert.deepEqual(parsePlayers(undefined), []);
});

test('parseBool', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'on']) assert.equal(parseBool(v), true);
  for (const v of ['false', '0', '', undefined, 'nope']) assert.equal(parseBool(v), false);
});

test('htmlTitle', () => {
  assert.equal(htmlTitle('<head><title> Unicorn Meadow </title></head>'), 'Unicorn Meadow');
  assert.equal(htmlTitle('<head></head>'), '');
});

test('injectBridge puts the script first in <head>, once', () => {
  const out = injectBridge('<!DOCTYPE html><html><head lang="x"><meta charset="utf-8"></head></html>');
  assert.match(out, /<head lang="x"><script src="\/arcade-bridge.js"><\/script><meta/);
  assert.equal(injectBridge(out), out);
  assert.match(injectBridge('<html><body>x</body></html>'), /^<html><script src/);
  assert.match(injectBridge('<canvas></canvas>'), /^<script src/);
});

test('buildManifest merges metadata with files on disk', () => {
  const meta = [
    { id: 'Midnight Walk', file: 'mw.html', title: 'Midnight', orientation: 'landscape', colors: ['#111', '#222'], menuButton: 'top-right' },
    { id: 'gone', file: 'missing.html' },
    { id: 'hidden', file: 'secret.html', hidden: true },
    { id: 'midnight-walk', file: 'dupe.html' },
  ];
  const files = ['mw.html', 'new_game.html', 'secret.html', 'dupe.html'];
  const { games, warnings } = buildManifest(meta, files, (f) => (f === 'new_game.html' ? 'Brand New' : ''));
  assert.deepEqual(games.map((g) => g.id), ['midnight-walk', 'new-game']);
  assert.equal(games[0].path, 'games/midnight-walk.html');
  assert.equal(games[0].orientation, 'landscape');
  assert.equal(games[0].menuButton, 'top-right');
  assert.equal(games[1].title, 'Brand New');
  assert.equal(games[1].orientation, 'any');
  assert.equal(games[1].menuButton, 'top-left');
  assert.equal(games[1].background, '#000000');
  assert.ok(warnings.some((w) => w.includes('missing.html')));
  assert.ok(warnings.some((w) => w.includes('duplicate')));
  assert.ok(warnings.some((w) => w.includes('new_game.html')));
});

test('buildManifest rejects bad orientation/background values', () => {
  const { games } = buildManifest([{ file: 'a.html', orientation: 'sideways', background: 'red;}' }], ['a.html']);
  assert.equal(games[0].orientation, 'any');
  assert.equal(games[0].background, '#000000');
});

test('saves are off unless a game explicitly opts in', () => {
  const { games } = buildManifest(
    [{ file: 'a.html' }, { file: 'b.html', saves: true }, { file: 'c.html', saves: 'yes' }, { file: 'd.html', saves: false }],
    ['a.html', 'b.html', 'c.html', 'd.html'],
  );
  assert.deepEqual(games.map((g) => g.saves), [false, true, false, false]);
});

test('startOver is on unless a game turns it off', () => {
  const { games } = buildManifest(
    [{ file: 'a.html' }, { file: 'b.html', startOver: false }, { file: 'c.html', startOver: 'no' }],
    ['a.html', 'b.html', 'c.html'],
  );
  assert.deepEqual(games.map((g) => g.startOver), [true, false, true]);
});
