/*
 * Super Games Arcade — game bridge
 * ---------------------------------
 * Injected as the FIRST script in every game page by scripts/build.mjs, so it
 * runs before the game's own code. It gives the arcade generic control over
 * any game, even ones that know nothing about the arcade:
 *
 *   - pause / resume   (holds requestAnimationFrame callbacks and freezes
 *                       performance.now so physics doesn't "jump" on resume)
 *   - mute / unmute    (Web Audio contexts + <audio>/<video> elements)
 *   - thumbnails       (captures the game canvas right after a rendered frame,
 *                       which works for 2D and WebGL canvases)
 *
 * Games can OPT IN to real save/load by calling, after they're set up:
 *
 *   if (window.ArcadeBridge) ArcadeBridge.register({
 *     version: 1,                       // bump when the state shape changes
 *     getState: function(){ return {...} or null },  // null = nothing worth saving
 *     setState: function(state){ ... }  // restore a state returned by getState
 *   });
 *
 * When the arcade loads a save, it reloads the game page and hands the state
 * over; register() calls setState() with it immediately. Games that need the
 * state earlier (e.g. to pick a level before building the scene) can call
 * ArcadeBridge.peekRestore(version).
 *
 * Opening a game file directly (outside the arcade) still works: every call
 * here is a harmless no-op apart from the hooks.
 */
(function () {
  'use strict';
  if (window.ArcadeBridge) return;

  var RESTORE_KEY = 'sga:restore';
  var shell = null;
  try {
    if (window.parent !== window && window.parent.ArcadeShell) shell = window.parent.ArcadeShell;
  } catch (e) { shell = null; } // cross-origin parent: run standalone

  // Lets games style themselves differently inside the arcade, e.g.
  //   html.in-arcade #myFullscreenButton { display: none }
  if (shell) document.documentElement.classList.add('in-arcade');

  function emit(type, data) {
    if (!shell) return;
    try { shell.bridgeEvent(type, data || {}, window); } catch (e) { /* shell gone */ }
  }

  // ── Clock: freeze performance.now() while paused ─────────────────────
  var realNow = performance.now.bind(performance);
  var pausedAt = null;  // real time when the pause began
  var pausedTotal = 0;  // total real ms spent paused
  function gameNow() { return (pausedAt !== null ? pausedAt : realNow()) - pausedTotal; }
  try { performance.now = gameNow; } catch (e) { /* read-only in some engines */ }

  // ── requestAnimationFrame: hold callbacks while paused ──────────────
  var origRaf = window.requestAnimationFrame.bind(window);
  var origCaf = window.cancelAnimationFrame.bind(window);
  var nextId = 1;
  var live = new Map();  // our id -> native id
  var held = new Map();  // our id -> callback (waiting for resume)
  var paused = false;

  function schedule(id, cb) {
    var nativeId = origRaf(function () {
      live.delete(id);
      if (paused) { held.set(id, cb); return; }
      cb(gameNow());
    });
    live.set(id, nativeId);
  }
  window.requestAnimationFrame = function (cb) {
    var id = nextId++;
    if (paused) held.set(id, cb); else schedule(id, cb);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    if (live.has(id)) { origCaf(live.get(id)); live.delete(id); }
    held.delete(id);
  };

  // ── Audio: track every Web Audio context the game creates ───────────
  var contexts = [];
  var muted = false;
  function silenced() { return muted || paused; }

  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Orig = window[name];
    if (typeof Orig !== 'function') return;
    var origResume = Orig.prototype.resume;
    function Wrapped(opts) {
      var ctx = opts === undefined ? new Orig() : new Orig(opts);
      contexts.push(ctx);
      // The game may call resume() itself (e.g. on a tap). Don't let it
      // un-mute while the arcade has sound off or the game is paused.
      ctx.resume = function () {
        if (silenced()) return Promise.resolve();
        return origResume.call(ctx);
      };
      if (silenced()) { try { ctx.suspend(); } catch (e) { /* ignore */ } }
      return ctx;
    }
    Wrapped.prototype = Orig.prototype;
    try { Object.setPrototypeOf(Wrapped, Orig); } catch (e) { /* static props */ }
    window[name] = Wrapped;
  });

  var pausedMedia = [];
  function applyAudio() {
    var off = silenced();
    contexts.forEach(function (ctx) {
      if (ctx.state === 'closed') return;
      try {
        if (off) ctx.suspend();
        else Object.getPrototypeOf(ctx).resume.call(ctx);
      } catch (e) { /* ignore */ }
    });
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) media[i].muted = muted;
  }
  // Media that starts playing later should respect the mute setting too.
  document.addEventListener('play', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'AUDIO' || t.tagName === 'VIDEO')) {
      t.muted = muted;
      if (paused) { t.pause(); pausedMedia.push(t); }
    }
  }, true);

  // ── Thumbnails ───────────────────────────────────────────────────────
  var lastThumb = null;
  function biggestCanvas() {
    var best = null, bestArea = 0;
    var all = document.querySelectorAll('canvas');
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) { best = all[i]; bestArea = area; }
    }
    return best;
  }
  function capture() {
    try {
      var src = biggestCanvas();
      if (!src || !src.width || !src.height) return null;
      var w = 320, h = Math.max(1, Math.round(w * src.height / src.width));
      if (h > 240) { h = 240; w = Math.round(h * src.width / src.height); }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) {
      return null; // tainted canvas or unsupported
    }
  }

  // ── Pause / resume ───────────────────────────────────────────────────
  var pauseTimer = null;
  function finishPause() {
    if (paused) return;
    clearTimeout(pauseTimer);
    lastThumb = capture() || lastThumb;
    paused = true;
    pausedAt = realNow();
    pausedMedia = [];
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) {
      if (!media[i].paused) { media[i].pause(); pausedMedia.push(media[i]); }
    }
    applyAudio();
  }
  function pause() {
    if (paused) return;
    if (document.hidden) { finishPause(); return; }
    // Let the game draw one more frame, then grab it for the thumbnail
    // inside the same frame (WebGL buffers are only readable then).
    origRaf(finishPause);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(finishPause, 150); // in case rAF is throttled
  }
  function resume() {
    clearTimeout(pauseTimer);
    if (!paused) return;
    pausedTotal += realNow() - pausedAt;
    pausedAt = null;
    paused = false;
    held.forEach(function (cb, id) { schedule(id, cb); });
    held.clear();
    pausedMedia.forEach(function (m) { try { m.play(); } catch (e) { /* ignore */ } });
    pausedMedia = [];
    applyAudio();
  }

  // ── Save / load hand-off ─────────────────────────────────────────────
  var handlers = null;
  var restore = null;
  try {
    var raw = sessionStorage.getItem(RESTORE_KEY);
    if (raw) {
      sessionStorage.removeItem(RESTORE_KEY);
      restore = JSON.parse(raw);
    }
  } catch (e) { restore = null; }

  function restoreMatches(version) {
    return !!(restore && restore.state != null &&
      (version === undefined || restore.version === undefined || restore.version === version));
  }

  // Escape opens the arcade menu even while the game has keyboard focus.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') emit('menu');
  }, true);

  window.ArcadeBridge = {
    inArcade: !!shell,
    register: function (h) {
      if (!h || typeof h.getState !== 'function' || typeof h.setState !== 'function') {
        console.warn('[arcade] register() needs getState and setState functions');
        return;
      }
      handlers = { getState: h.getState, setState: h.setState, version: h.version };
      var restored = false, failed = false;
      if (restore) {
        if (restoreMatches(h.version)) {
          try { h.setState(restore.state); restored = true; }
          catch (e) { failed = true; console.error('[arcade] setState failed', e); }
        } else {
          failed = true;
          console.warn('[arcade] save is from an older version of this game; ignoring it');
        }
        restore = null;
      }
      emit('register', { canSave: true, restored: restored, restoreFailed: failed });
    },
    peekRestore: function (version) {
      return restoreMatches(version) ? restore.state : null;
    },
    canSave: function () { return !!handlers; },
    getState: function () {
      if (!handlers) return { supported: false };
      var state = handlers.getState();
      // Round-trip through JSON so we store plain data and fail loudly here
      // rather than when the save is loaded.
      return { supported: true, version: handlers.version, state: state == null ? null : JSON.parse(JSON.stringify(state)) };
    },
    // Latest thumbnail. WebGL canvases can only be read right after a frame
    // renders, so the arcade calls refreshThumb() ahead of time.
    thumbnail: function () { return lastThumb || capture(); },
    refreshThumb: function () {
      if (paused || document.hidden) return;
      origRaf(function () { lastThumb = capture() || lastThumb; });
    },
    pause: pause,
    resume: resume,
    isPaused: function () { return paused; },
    setMuted: function (m) { muted = !!m; applyAudio(); }
  };

  emit('boot', { hadRestore: !!restore });
  document.addEventListener('DOMContentLoaded', function () {
    // Give games that never call register() a moment, then report "no saves".
    setTimeout(function () { if (!handlers) emit('register', { canSave: false }); }, 1500);
  });
})();
