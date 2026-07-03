'use strict';
/* input.js — keyboard + touch (virtual joystick, FIRE / MG / MINE buttons)
   plus mobile gesture lockdown so steering never scrolls / zooms / reloads. */

var INPUT = (function () {

  var keys = {};
  var touchMode = false;

  var joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0, mag: 0, ang: 0 };
  var btn = { fire: false, mg: false, mine: false };
  var mineEdge = false;   // consumed once per press

  /* ---------------- keyboard ---------------- */
  window.addEventListener('keydown', function (e) {
    if (e.repeat) { if (isGameKey(e)) e.preventDefault(); return; }
    keys[e.code] = true;
    if (e.code === 'KeyE') mineEdge = true;
    if (isGameKey(e)) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  function isGameKey(e) {
    return ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyE', 'ShiftLeft', 'ShiftRight'].indexOf(e.code) >= 0;
  }

  /* ---------------- gesture lockdown ---------------- */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault();   // kill double-tap zoom
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------------- touch joystick (left half of screen) ---------------- */
  function setupTouch() {
    var zone = document.getElementById('joyZone');
    var knob = document.getElementById('joyKnob');
    var ring = document.getElementById('joyRing');
    if (!zone) return;

    function place(x, y) {
      ring.style.left = (x - 60) + 'px'; ring.style.top = (y - 60) + 'px';
    }
    function knobAt(dx, dy) {
      knob.style.left = (joy.cx + dx - 26) + 'px'; knob.style.top = (joy.cy + dy - 26) + 'px';
    }

    zone.addEventListener('touchstart', function (e) {
      touchMode = true; document.body.classList.add('touch');
      var t = e.changedTouches[0];
      joy.active = true; joy.id = t.identifier;
      joy.cx = t.clientX; joy.cy = t.clientY;
      joy.dx = 0; joy.dy = 0; joy.mag = 0;
      ring.style.display = 'block'; knob.style.display = 'block';
      place(joy.cx, joy.cy); knobAt(0, 0);
      e.preventDefault();
    }, { passive: false });

    zone.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== joy.id) continue;
        var dx = t.clientX - joy.cx, dy = t.clientY - joy.cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var max = 52;
        if (d > max) { dx *= max / d; dy *= max / d; d = max; }
        joy.dx = dx; joy.dy = dy;
        joy.mag = d / max;
        joy.ang = Math.atan2(dy, dx);
        knobAt(dx, dy);
      }
      e.preventDefault();
    }, { passive: false });

    function endJoy(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joy.id) {
          joy.active = false; joy.mag = 0; joy.id = -1;
          ring.style.display = 'none'; knob.style.display = 'none';
        }
      }
      e.preventDefault();
    }
    zone.addEventListener('touchend', endJoy, { passive: false });
    zone.addEventListener('touchcancel', endJoy, { passive: false });

    /* buttons */
    bindHold('btnFire', 'fire');
    bindHold('btnMG', 'mg');
    var bm = document.getElementById('btnMine');
    if (bm) {
      bm.addEventListener('touchstart', function (e) {
        touchMode = true; document.body.classList.add('touch');
        mineEdge = true; btn.mine = true; e.preventDefault();
      }, { passive: false });
      bm.addEventListener('touchend', function (e) { btn.mine = false; e.preventDefault(); }, { passive: false });
    }
    function bindHold(id, prop) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', function (e) {
        touchMode = true; document.body.classList.add('touch');
        btn[prop] = true; e.preventDefault();
      }, { passive: false });
      el.addEventListener('touchend', function (e) { btn[prop] = false; e.preventDefault(); }, { passive: false });
      el.addEventListener('touchcancel', function (e) { btn[prop] = false; e.preventDefault(); }, { passive: false });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTouch);
  else setupTouch();

  if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0)
    document.addEventListener('DOMContentLoaded', function () { document.body.classList.add('touch'); });

  /* ---------------- unified drive query ----------------
     Returns { throttle, steer, fire, mg, mine } for the given hull angle.
     Touch joystick: point the stick where you want to go. */
  function getDrive(hullAngle) {
    var throttle = 0, steer = 0;

    if (keys['KeyW'] || keys['ArrowUp']) throttle += 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle -= 1;
    if (keys['KeyA'] || keys['ArrowLeft']) steer -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer += 1;

    if (joy.active && joy.mag > 0.12) {
      var d = joy.ang - hullAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      steer = Math.max(-1, Math.min(1, d * 2.4));
      throttle = joy.mag * Math.max(0.15, Math.cos(d));
    }

    var mine = mineEdge; mineEdge = false;
    return {
      throttle: throttle, steer: steer,
      fire: !!(keys['Space'] || btn.fire),
      mg: !!(keys['KeyF'] || keys['ShiftLeft'] || keys['ShiftRight'] || btn.mg),
      mine: mine
    };
  }

  function anyKey() { return Object.keys(keys).some(function (k) { return keys[k]; }) || joy.active || btn.fire; }

  return {
    getDrive: getDrive,
    keys: keys,
    isTouch: function () { return document.body.classList.contains('touch'); },
    anyKey: anyKey
  };
})();
