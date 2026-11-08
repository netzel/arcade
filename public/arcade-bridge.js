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
 * Games run as their own top-level page (no iframe: iOS can stop delivering
 * touches to iframes until a reload). The in-game menu (play.js) runs on the
 * same page and listens with ArcadeBridge.on(fn).
 */
(function () {
  'use strict';
  if (window.ArcadeBridge) return;

  var RESTORE_KEY = 'sga:restore';

  // Lets games style themselves differently inside the arcade, e.g.
  //   html.in-arcade #myFullscreenButton { display: none }
  document.documentElement.classList.add('in-arcade');

  // Events for the in-game menu. It loads after the game's own scripts, so
  // the latest event of each type is kept and replayed when it subscribes.
  var listeners = [];
  var latest = {};
  function emit(type, data) {
    latest[type] = data || {};
    listeners.forEach(function (fn) { try { fn(type, latest[type]); } catch (e) { console.error(e); } });
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

  // Close this page's audio when the arcade swaps games. iPhones/iPads only
  // allow a handful of live audio contexts; leftovers from earlier games can
  // make the next game's sound (and, in unguarded games, its taps) fail
  // until the browser is reloaded.
  window.addEventListener('pagehide', function (e) {
    if (e.persisted) return; // kept for back/forward: it may come back
    contexts.forEach(function (ctx) {
      try { if (ctx.state !== 'closed') ctx.close(); } catch (err) { /* ignore */ }
    });
    contexts = [];
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
  var pausePending = false; // a pause was asked for and not cancelled yet
  function finishPause() {
    // resume() may arrive before the deferred frame/timer below fires; a
    // cancelled pause must not freeze the game later with no menu showing.
    if (paused || !pausePending) return;
    pausePending = false;
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
    pausePending = true;
    if (document.hidden) { finishPause(); return; }
    // Let the game draw one more frame, then grab it for the thumbnail
    // inside the same frame (WebGL buffers are only readable then).
    origRaf(finishPause);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(finishPause, 150); // in case rAF is throttled
  }
  function resume() {
    clearTimeout(pauseTimer);
    pausePending = false;
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
    inArcade: true,
    on: function (fn) {
      listeners.push(fn);
      Object.keys(latest).forEach(function (t) { if (t !== 'menu') { try { fn(t, latest[t]); } catch (e) { console.error(e); } } });
    },
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

/*
 * Tap diagnostics: add ?debug to the arcade (or game) URL to show a panel
 * listing the device, which input events actually arrive, and any errors.
 * Invisible and inert otherwise.
 */
(function () {
  var on = false;
  try { on = /[?&]debug\b/.test(location.search) || (window.parent !== window && /[?&]debug\b/.test(window.parent.location.search)); } catch (e) { /* ignore */ }
  if (!on) return;
  var lines = [], box = null, counts = {};
  function render() {
    if (!box) return;
    var c = Object.keys(counts).map(function (k) { return k + ':' + counts[k]; }).join('  ');
    box.textContent = 'UA: ' + navigator.userAgent +
      '\nPointerEvent:' + !!window.PointerEvent + '  ontouchstart:' + ('ontouchstart' in window) +
      '  maxTouch:' + (navigator.maxTouchPoints || 0) + '  inFrame:' + (window.parent !== window) +
      '\nCOUNTS ' + c + '\n' + lines.join('\n');
  }
  function log(s) { lines.unshift(new Date().toISOString().slice(17, 23) + ' ' + s); lines.length = Math.min(lines.length, 14); render(); }
  ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'click'].forEach(function (t) {
    window.addEventListener(t, function (e) {
      counts[t] = (counts[t] || 0) + 1;
      var tg = e.target, name = tg && tg.tagName ? tg.tagName.toLowerCase() + (tg.id ? '#' + tg.id : '') : String(tg);
      log(t + (e.pointerType ? '(' + e.pointerType + ')' : '') + ' on ' + name + ' cancelable:' + e.cancelable);
    }, { capture: true, passive: true });
  });
  window.addEventListener('error', function (e) { log('ERROR ' + e.message + ' @' + (e.lineno || '?')); });
  window.addEventListener('unhandledrejection', function (e) { log('REJECT ' + (e.reason && e.reason.message || e.reason)); });
  document.addEventListener('DOMContentLoaded', function () {
    box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:4px;right:4px;bottom:4px;max-height:45%;overflow:hidden;margin:0;padding:6px;' +
      'background:rgba(0,0,0,.78);color:#7CFC00;font:11px/1.3 monospace;white-space:pre-wrap;word-break:break-all;z-index:2147483647;pointer-events:none;border-radius:6px';
    document.body.appendChild(box);
    render();
  });
})();
