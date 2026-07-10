'use strict';
/* game.js — themes, levels, AI, CTF rules, items, HUD, rendering, audio. */

(function () {

  var TAU = Math.PI * 2;
  var clamp = ENT.clamp, angDiff = ENT.angDiff, dist2 = ENT.dist2;

  var cv = document.getElementById('game');
  var cx = cv.getContext('2d');
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    cv.width = Math.floor(innerWidth * DPR);
    cv.height = Math.floor(innerHeight * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ============================ AUDIO ============================ */
  var AU = (function () {
    var ac = null, master = null;
    function ensure() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
      } catch (e) { return false; }
      return true;
    }
    function env(g, t0, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    }
    function tone(type, f0, f1, dur, peak, when) {
      if (!ac) return;
      var t0 = ac.currentTime + (when || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      env(g, t0, 0.004, peak, dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.1);
    }
    function noise(dur, peak, lp, when) {
      if (!ac) return;
      var t0 = ac.currentTime + (when || 0);
      var len = Math.max(1, (dur * ac.sampleRate) | 0);
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var s = ac.createBufferSource(); s.buffer = buf;
      var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 900;
      var g = ac.createGain(); env(g, t0, 0.004, peak, dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0);
    }
    return {
      ensure: ensure,
      shot: function () { noise(0.16, 0.5, 1400); tone('square', 150, 55, 0.14, 0.25); },
      boom: function (big) {
        noise(big ? 0.8 : 0.4, big ? 0.9 : 0.55, big ? 420 : 620);
        tone('sine', big ? 90 : 120, 30, big ? 0.7 : 0.4, big ? 0.5 : 0.3);
      },
      clank: function () { tone('triangle', 900, 300, 0.07, 0.2); noise(0.05, 0.18, 3200); },
      crumble: function () { noise(0.5, 0.5, 500); noise(0.35, 0.3, 900, 0.1); },
      pickup: function () { tone('square', 620, 0, 0.07, 0.22); tone('square', 930, 0, 0.1, 0.22, 0.08); },
      beep: function () { tone('square', 1560, 0, 0.06, 0.2); },
      alarm: function () { tone('square', 520, 0, 0.12, 0.24); tone('square', 390, 0, 0.12, 0.24, 0.14); tone('square', 520, 0, 0.12, 0.24, 0.28); },
      score: function () { tone('square', 523, 0, 0.1, 0.25); tone('square', 659, 0, 0.1, 0.25, 0.1); tone('square', 784, 0, 0.2, 0.28, 0.2); },
      lose: function () { tone('sawtooth', 300, 90, 0.8, 0.3); },
      plane: function () { tone('sawtooth', 110, 70, 2.2, 0.16); tone('sawtooth', 113, 72, 2.2, 0.12); },
      drop: function () { tone('sine', 800, 200, 0.5, 0.14); }
    };
  })();

  /* ============================ THEMES ============================ */
  var THEMES = [
    { key: 'city', name: 'CITY',
      cols: 22, rows: 16, braid: 0.32, weakProb: 0.15, river: false,
      floor: '#26292d', floorTone: '#2e3237',
      wallFill: '#4b5158', wallEdge: '#22262b', wallWeak: '#6d5849',
      mud: 2, wire: 16, denseWire: 5, hedgehogs: 24, sand: 0,
      turrets: 2, turretBandMin: 2, turretBandMax: 4,
      buildings: 3, buildingSizeMin: 2, buildingSizeMax: 3, buildingBandMin: 3, buildingBandMax: 7,
      brief: 'Tight streets and crumbling blocks. Barbed wire chokes the lanes; hedgehog barricades seal the rest. Shell the cracked walls open — and watch for gun turrets guarding the enemy base.'
    },
    { key: 'forest', name: 'FOREST',
      cols: 21, rows: 17, braid: 0.3, weakProb: 0.06, river: true,
      floor: '#24331d', floorTone: '#2c3d23',
      wallFill: '#31491f', wallEdge: '#16230e', wallWeak: '#5c4a2c',
      mud: 15, wire: 4, denseWire: 1, hedgehogs: 6, sand: 0, trees: 22,
      turrets: 2, turretBandMin: 2, turretBandMax: 4,
      buildings: 2, buildingSizeMin: 2, buildingSizeMax: 3, buildingBandMin: 3, buildingBandMax: 7,
      brief: 'A river cuts the map in two — take a bridge, or vanish into the stone tunnel beneath it. Trees give cover but their trunks stop you dead. Mind the bog; mud halves your speed.'
    },
    { key: 'desert', name: 'DESERT',
      cols: 24, rows: 16, braid: 0.68, weakProb: 0.26, river: false,
      floor: '#b3915c', floorTone: '#c2a06a',
      wallFill: '#a06c46', wallEdge: '#6e4527', wallWeak: '#b98a5a',
      mud: 0, wire: 6, denseWire: 1, hedgehogs: 10, sand: 18,
      turrets: 3, turretBandMin: 2, turretBandMax: 4,
      buildings: 4, buildingSizeMin: 2, buildingSizeMax: 3, buildingBandMin: 3, buildingBandMax: 7,
      brief: 'Open, looping dune runs. Soft sand drags at your tracks and the adobe walls barely hold — almost every route can be blasted open. Gun turrets ring the enemy base.'
    }
  ];

  var DIFFS = [
    { name: 'EASY',   base: 2, speed: 0.8,  reload: 1.9, dmg: 0.8,  allowed: 4, hp: 90 },
    { name: 'NORMAL', base: 3, speed: 1.0,  reload: 1.3, dmg: 1.0,  allowed: 3, hp: 100 },
    { name: 'HARD',   base: 4, speed: 1.15, reload: 0.9, dmg: 1.25, allowed: 2, hp: 110 }
  ];

  /* ============================ GAME STATE ============================ */
  var G = {
    state: 'menu', diff: DIFFS[1], diffIx: 1,
    level: 1, time: 0, freezeT: 0,
    maze: null, theme: THEMES[0],
    tanks: [], player: null,
    shells: [], mines: [], items: [],
    fx: [], tracks: [], firePatches: [], bombs: [], strafes: [],
    plane: null,
    mud: [], wire: [], hedgehogs: [], sand: [], trees: [], turrets: [],
    buildings: [], doors: [],
    flags: null, pads: null,
    playerCaps: 0, enemyCaps: 0, capsNeeded: 1,
    itemSpawnT: 6,
    shake: 0, camX: 0, camY: 0,
    terrainBase: null, terrainOver: null,
    blockedCells: null,
    rand: Math.random,
    best: parseInt(localStorage.getItem('ironflag_best') || '0', 10) || 0
  };
  window.G = G; // handy for debugging / headless tests

  /* enemy flag artwork — swap assets/enemy-flag.svg for your own */
  var enemyFlagImg = new Image(), enemyFlagReady = false;
  enemyFlagImg.onload = function () { enemyFlagReady = true; };
  enemyFlagImg.onerror = function () { enemyFlagReady = false; };
  enemyFlagImg.src = 'assets/enemy-flag.svg';

  /* ============================ LEVEL BUILD ============================ */
  function openArea(m, cx0, cy0) { // knock out walls inside a 2x2 corner block
    for (var dx = 0; dx <= 1; dx++) for (var dy = 0; dy <= 1; dy++) {
      var x = cx0 + dx, y = cy0 + dy;
      if (dx === 0 && m.inB(x + 1, y)) { var w = m.wallBetween(x, y, x + 1, y); w.alive = false; }
      if (dy === 0 && m.inB(x, y + 1)) { var w2 = m.wallBetween(x, y, x, y + 1); w2.alive = false; }
    }
  }

  function cellKey(x, y) { return x + ',' + y; }

  function buildLevel(level) {
    var theme = THEMES[(level - 1) % THEMES.length];
    G.theme = theme;
    G.capsNeeded = level >= 4 ? 2 : 1;
    G.playerCaps = 0; G.enemyCaps = 0;

    var m = MAZE.generate({
      cols: theme.cols, rows: theme.rows,
      braid: theme.braid, weakProb: theme.weakProb, river: theme.river,
      seed: (Math.random() * 1e9) | 0
    });
    G.maze = m;

    var baseP = { x: 0, y: m.rows - 1 };            // bottom-left, green pad
    var baseE = { x: m.cols - 1, y: 0 };            // top-right, red base
    openArea(m, 0, m.rows - 2);
    openArea(m, m.cols - 2, 0);

    G.blockedCells = new Set();
    m.setBlockedHook(function (x, y) { return G.blockedCells.has(cellKey(x, y)); });

    var pc = m.center(baseP.x, baseP.y), ec = m.center(baseE.x, baseE.y);
    G.pads = {
      P: { x: pc.x, y: pc.y, r: m.CELL * 0.62 },
      E: { x: ec.x, y: ec.y, r: m.CELL * 0.62 }
    };
    G.flags = {
      P: { team: 'P', home: { x: pc.x, y: pc.y }, x: pc.x, y: pc.y, carrier: null, dropT: 0 },
      E: { team: 'E', home: { x: ec.x, y: ec.y }, x: ec.x, y: ec.y, carrier: null, dropT: 0 }
    };

    /* ---- place terrain features on safe floor cells ---- */
    G.mud = []; G.wire = []; G.hedgehogs = []; G.sand = []; G.trees = [];
    var rng = m.rng;
    function farFromBases(cxl, cyl) {
      return (Math.abs(cxl - baseP.x) + Math.abs(cyl - baseP.y)) > 3 &&
             (Math.abs(cxl - baseE.x) + Math.abs(cyl - baseE.y)) > 3;
    }
    /* hard exclusion for base-clustering placement (buildings/turrets): the
       exact base pad cell + the enemy spawn cluster, regardless of distance
       band — this is the opposite intent from farFromBases() above, so it's
       its own predicate rather than reusing/inverting that one. */
    function nearBaseCore(cxl, cyl) {
      if ((cxl === baseP.x && cyl === baseP.y) || (cxl === baseE.x && cyl === baseE.y)) return true;
      for (var ei = 0; ei < 4; ei++) {
        var ox = clamp(baseE.x - (ei % 2), 0, m.cols - 1), oy = clamp(baseE.y + ((ei / 2) | 0) % 2, 0, m.rows - 1);
        if (cxl === ox && cyl === oy) return true;
      }
      return false;
    }
    function pickCell(pred) {
      for (var t = 0; t < 200; t++) {
        var x = (rng() * m.cols) | 0, y = (rng() * m.rows) | 0;
        var c = m.cell(x, y);
        if (c.water || c.tunnel || c.bridge) continue;
        if (theme.river && Math.abs(y - m.riverRow) <= 1) continue;
        if (!farFromBases(x, y)) continue;
        if (G.blockedCells.has(cellKey(x, y))) continue;
        if (pred && !pred(x, y, c)) continue;
        return { x: x, y: y };
      }
      return null;
    }
    /* rejection-sample a cell within [bandMin,bandMax] Manhattan cells of
       (cxTarget,cyTarget) — used to cluster buildings/turrets near a base,
       the inverse of pickCell's farFromBases exclusion. Sampled directly in
       Manhattan (dx,dy) space — not polar/Euclidean then distance-filtered —
       so every draw lands exactly on the target ring instead of wasting most
       attempts on angles that round to the wrong Manhattan distance. */
    function pickNearBase(cxTarget, cyTarget, bandMin, bandMax) {
      for (var t = 0; t < 200; t++) {
        var d = bandMin + ((rng() * (bandMax - bandMin + 1)) | 0);
        var dx = ((rng() * (2 * d + 1)) | 0) - d;
        var dy = (rng() < 0.5 ? 1 : -1) * (d - Math.abs(dx));
        var x = cxTarget + dx, y = cyTarget + dy;
        if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue;
        var c = m.cell(x, y);
        if (c.water || c.tunnel || c.bridge) continue;
        if (theme.river && Math.abs(y - m.riverRow) <= 1) continue;
        if (nearBaseCore(x, y)) continue;
        if (G.blockedCells.has(cellKey(x, y))) continue;
        return { x: x, y: y };
      }
      return null;
    }

    var i, c2, wc;
    for (i = 0; i < theme.mud; i++) {
      c2 = pickCell(); if (!c2) break;
      wc = m.center(c2.x, c2.y);
      G.mud.push({ x: wc.x + (rng() - 0.5) * 20, y: wc.y + (rng() - 0.5) * 20, r: 32 + rng() * 20 });
    }
    for (i = 0; i < theme.sand; i++) {
      c2 = pickCell(); if (!c2) break;
      wc = m.center(c2.x, c2.y);
      G.sand.push({ x: wc.x + (rng() - 0.5) * 24, y: wc.y + (rng() - 0.5) * 24, r: 40 + rng() * 30 });
    }
    var wireTotal = theme.wire, dense = theme.denseWire, wireTries = 0;
    for (i = 0; i < wireTotal; i++) {
      if (wireTries++ > wireTotal * 8) break;     // never spin forever on a cramped map
      c2 = pickCell(); if (!c2) break;
      var isDense = i < dense;
      G.wire.push({ cx: c2.x, cy: c2.y,
        x: c2.x * m.CELL + 8, y: c2.y * m.CELL + 8, w: m.CELL - 16, h: m.CELL - 16, dense: isDense });
      if (isDense) {
        // dense wire all but traps a tank — keep it off the only route
        G.blockedCells.add(cellKey(c2.x, c2.y));
        if (!m.findPath(baseP.x, baseP.y, baseE.x, baseE.y, false)) {
          G.blockedCells.delete(cellKey(c2.x, c2.y));
          G.wire.pop(); i--; continue;
        }
      }
    }
    for (i = 0; i < theme.hedgehogs; i++) {
      c2 = pickCell(function (x, y) { return !G.blockedCells.has(cellKey(x, y)); });
      if (!c2) break;
      wc = m.center(c2.x, c2.y);
      G.blockedCells.add(cellKey(c2.x, c2.y));
      if (!m.findPath(baseP.x, baseP.y, baseE.x, baseE.y, false)) {
        G.blockedCells.delete(cellKey(c2.x, c2.y));
        continue;
      }
      G.hedgehogs.push({ x: wc.x + (rng() - 0.5) * 14, y: wc.y + (rng() - 0.5) * 14, r: 11,
        a: rng() * TAU, cx: c2.x, cy: c2.y });
    }
    for (i = 0; i < (theme.trees || 0); i++) {
      c2 = pickCell(function (x, y) { return !G.blockedCells.has(cellKey(x, y)); });
      if (!c2) break;
      wc = m.center(c2.x, c2.y);
      G.blockedCells.add(cellKey(c2.x, c2.y));
      if (!m.findPath(baseP.x, baseP.y, baseE.x, baseE.y, false)) {
        G.blockedCells.delete(cellKey(c2.x, c2.y));
        continue;
      }
      G.trees.push({
        x: wc.x + (rng() - 0.5) * 14, y: wc.y + (rng() - 0.5) * 14,
        trunkR: 8, canopyR: 26 + rng() * 8,
        cx: c2.x, cy: c2.y, seed: (rng() * 1e9) | 0
      });
    }

    /* ---- turrets: enemy-base defense only, stats scale with difficulty ---- */
    G.turrets = [];
    var turretHp = [50, 65, 85][G.diffIx];
    var turretReload = [2.0, 1.5, 1.1][G.diffIx];
    var turretRange = [420, 480, 540][G.diffIx];
    for (i = 0; i < (theme.turrets || 0); i++) {
      c2 = pickNearBase(baseE.x, baseE.y, theme.turretBandMin || 2, theme.turretBandMax || 6);
      if (!c2) break;
      wc = m.center(c2.x, c2.y);
      G.blockedCells.add(cellKey(c2.x, c2.y));
      if (!m.findPath(baseP.x, baseP.y, baseE.x, baseE.y, false)) {
        G.blockedCells.delete(cellKey(c2.x, c2.y));
        continue;
      }
      G.turrets.push(new ENT.Turret({
        x: wc.x, y: wc.y, a: rng() * TAU, team: 'E',
        maxHp: turretHp, reload: turretReload, range: turretRange,
        cellX: c2.x, cellY: c2.y
      }));
    }

    /* ---- buildings + doors: sealed multi-cell structures near each base.
       Player-side buildings get an automatic (proximity) door; enemy-side
       buildings get a destructible barricade door reusing the ordinary
       weak-wall mechanic. Footprints keep a 1-cell margin off the map edge
       so every touched wall is an interior (non-boundary) wall. ---- */
    G.buildings = []; G.doors = [];
    var buildingIdSeq = 0, doorIdSeq = 0;
    function placeBuildings(teamKey, targetBase, count) {
      for (var n = 0; n < count; n++) {
        var placedOne = false;
        for (var attempt = 0; attempt < 60 && !placedOne; attempt++) {
          var sizeMin = theme.buildingSizeMin || 2, sizeMax = theme.buildingSizeMax || 3;
          var bw = sizeMin + ((rng() * (sizeMax - sizeMin + 1)) | 0);
          var bh = sizeMin + ((rng() * (sizeMax - sizeMin + 1)) | 0);
          var anchor = pickNearBase(targetBase.x, targetBase.y, theme.buildingBandMin || 2, theme.buildingBandMax || 5);
          if (!anchor) continue;
          var cx0 = clamp(anchor.x - ((bw / 2) | 0), 1, Math.max(1, m.cols - 1 - bw));
          var cy0 = clamp(anchor.y - ((bh / 2) | 0), 1, Math.max(1, m.rows - 1 - bh));
          if (cx0 < 1 || cy0 < 1 || cx0 + bw > m.cols - 1 || cy0 + bh > m.rows - 1) continue;

          var cellsOk = true;
          for (var fx = cx0; fx < cx0 + bw && cellsOk; fx++) {
            for (var fy = cy0; fy < cy0 + bh && cellsOk; fy++) {
              var fc = m.cell(fx, fy);
              if (fc.water || fc.tunnel || fc.bridge) cellsOk = false;
              if (G.blockedCells.has(cellKey(fx, fy))) cellsOk = false;
              if (nearBaseCore(fx, fy)) cellsOk = false;
            }
          }
          if (!cellsOk) continue;

          // gather every interior + perimeter wall of the footprint, and
          // every perimeter edge that's a viable door (leads to an open,
          // unblocked, in-bounds cell outside the building)
          var touched = [], doorCandidates = [];
          for (var gx = cx0; gx < cx0 + bw; gx++) {
            for (var gy = cy0; gy < cy0 + bh; gy++) {
              if (gx + 1 < cx0 + bw) touched.push(m.wallBetween(gx, gy, gx + 1, gy));
              if (gy + 1 < cy0 + bh) touched.push(m.wallBetween(gx, gy, gx, gy + 1));
              var nbrs = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]];
              for (var nb = 0; nb < 4; nb++) {
                var nx = nbrs[nb][0], ny = nbrs[nb][1];
                var inside = nx >= cx0 && nx < cx0 + bw && ny >= cy0 && ny < cy0 + bh;
                if (inside) continue;
                var pw = m.wallBetween(gx, gy, nx, ny);
                touched.push(pw);
                if (m.inB(nx, ny)) {
                  var oc = m.cell(nx, ny);
                  if (!oc.water && !oc.tunnel && !oc.bridge && !G.blockedCells.has(cellKey(nx, ny)))
                    doorCandidates.push(pw);
                }
              }
            }
          }
          if (!doorCandidates.length) continue;
          var doorWall = doorCandidates[(rng() * doorCandidates.length) | 0];

          // snapshot every touched wall so a failed connectivity check can roll back
          var snapshot = [];
          for (var si = 0; si < touched.length; si++)
            snapshot.push({ w: touched[si], alive: touched[si].alive, weak: touched[si].weak });
          for (var ti = 0; ti < touched.length; ti++) {
            if (touched[ti] === doorWall) continue;
            touched[ti].alive = true; touched[ti].weak = false;
          }
          doorWall.alive = false; // simulate "door open" for the connectivity check
          var pathOk = !!m.findPath(baseP.x, baseP.y, baseE.x, baseE.y, false);
          doorWall.alive = true;  // doors start closed either way

          if (!pathOk) {
            for (var ri = 0; ri < snapshot.length; ri++) {
              snapshot[ri].w.alive = snapshot[ri].alive; snapshot[ri].w.weak = snapshot[ri].weak;
            }
            continue;
          }

          // commit
          var buildingId = 'b' + (buildingIdSeq++);
          for (var cx1 = cx0; cx1 < cx0 + bw; cx1++)
            for (var cy1 = cy0; cy1 < cy0 + bh; cy1++)
              G.blockedCells.add(cellKey(cx1, cy1));
          for (var tj = 0; tj < touched.length; tj++)
            if (touched[tj] !== doorWall) touched[tj].building = buildingId;

          var isAuto = teamKey === 'P';
          if (isAuto) {
            doorWall.weak = false;
          } else {
            doorWall.weak = true;
            doorWall.maxHp = 2 + ((rng() * 2) | 0);
            doorWall.hp = doorWall.maxHp;
          }
          var doorRect = m.wallRect(doorWall);
          var doorRec = {
            id: 'd' + (doorIdSeq++), wall: doorWall,
            x: doorRect.x + doorRect.w / 2, y: doorRect.y + doorRect.h / 2,
            auto: isAuto, open: false, openT: 0, triggerR: 70
          };
          doorWall.isDoor = doorRec;
          G.doors.push(doorRec);
          G.buildings.push({
            id: buildingId, team: teamKey,
            cellX: cx0, cellY: cy0, cols: bw, rows: bh,
            x: cx0 * m.CELL, y: cy0 * m.CELL, w: bw * m.CELL, h: bh * m.CELL,
            doorId: doorRec.id, roofSeed: (rng() * 1e9) | 0
          });
          placedOne = true;
        }
      }
    }
    var buildingTotal = theme.buildings || 0;
    placeBuildings('P', baseP, Math.ceil(buildingTotal / 2));
    placeBuildings('E', baseE, Math.floor(buildingTotal / 2));

    /* ---- tanks ---- */
    G.tanks = [];
    var pT = new ENT.Tank({
      team: 'P', isPlayer: true, x: pc.x, y: pc.y, a: -Math.PI / 4,
      maxHp: G.diff.hp, speed: 165, turn: 3.2, reload: 0.4, dmgMul: 1
    });
    G.player = pT; G.tanks.push(pT);

    var n = Math.min(7, G.diff.base + (((level - 1) / 2) | 0));
    var espd = 150 * G.diff.speed * Math.min(1.35, 1 + 0.05 * (level - 1));
    var erel = Math.max(0.6, G.diff.reload * (1 - 0.05 * (level - 1)));
    var edmg = Math.min(1.7, G.diff.dmg * (1 + 0.06 * (level - 1)));
    for (i = 0; i < n; i++) {
      var off = m.center(clamp(baseE.x - (i % 2), 0, m.cols - 1), clamp(baseE.y + ((i / 2) | 0) % 2, 0, m.rows - 1));
      var e = new ENT.Tank({
        team: 'E', x: off.x, y: off.y, a: Math.PI * 0.75,
        maxHp: 78 + level * 4, speed: espd, turn: 2.7, reload: erel, dmgMul: edmg,
        ai: { role: i === 0 ? 'runner' : 'hunter', path: null, pathI: 0, repathT: 0,
              wanderT: 0, stuckT: 0, backT: 0, target: null, guard: i === 1 }
      });
      e.homeX = off.x; e.homeY = off.y;
      G.tanks.push(e);
    }

    /* ---- clear the field ---- */
    G.shells = []; G.mines = []; G.items = [];
    G.fx = []; G.tracks = []; G.firePatches = []; G.bombs = []; G.strafes = [];
    G.plane = null; G.itemSpawnT = 6;

    bakeTerrain();
  }

  /* round reset after any capture: everyone back to base, field cleared */
  function roundReset() {
    var m = G.maze;
    for (var i = 0; i < G.tanks.length; i++) {
      var t = G.tanks[i];
      t.dead = false; t.respawn();
    }
    G.flags.P.carrier = null; G.flags.P.x = G.flags.P.home.x; G.flags.P.y = G.flags.P.home.y; G.flags.P.dropT = 0;
    G.flags.E.carrier = null; G.flags.E.x = G.flags.E.home.x; G.flags.E.y = G.flags.E.home.y; G.flags.E.dropT = 0;
    G.shells = []; G.mines = []; G.items = [];
    G.fx = []; G.firePatches = []; G.bombs = []; G.strafes = []; G.plane = null;
    G.itemSpawnT = 5;
    G.freezeT = 1.5;
  }

  /* ============================ TERRAIN BAKE ============================ */
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function bakeTerrain() {
    var m = G.maze, th = G.theme, C = m.CELL;
    var base = mkCanvas(m.worldW, m.worldH);
    var over = mkCanvas(m.worldW, m.worldH);
    var b = base.getContext('2d'), o = over.getContext('2d');
    var rng = MAZE.mulberry32(12345 + G.level * 77);

    /* floor */
    b.fillStyle = th.floor; b.fillRect(0, 0, m.worldW, m.worldH);
    for (var i = 0; i < 500; i++) {                       // mottling
      b.fillStyle = 'rgba(' + (rng() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.02 + rng() * 0.04).toFixed(3) + ')';
      var bx = rng() * m.worldW, by = rng() * m.worldH, br = 12 + rng() * 60;
      b.beginPath(); b.ellipse(bx, by, br, br * (0.5 + rng() * 0.5), rng() * TAU, 0, TAU); b.fill();
    }
    if (th.key === 'city') {                              // lane cracks + debris
      b.strokeStyle = 'rgba(0,0,0,.18)'; b.lineWidth = 1.4;
      for (i = 0; i < 90; i++) {
        var sx = rng() * m.worldW, sy = rng() * m.worldH;
        b.beginPath(); b.moveTo(sx, sy);
        for (var k = 0; k < 3; k++) { sx += (rng() - 0.5) * 40; sy += (rng() - 0.5) * 40; b.lineTo(sx, sy); }
        b.stroke();
      }
      b.fillStyle = 'rgba(180,180,190,.08)';
      for (i = 0; i < 220; i++) b.fillRect(rng() * m.worldW, rng() * m.worldH, 2 + rng() * 4, 2 + rng() * 4);
    }
    if (th.key === 'forest') {                            // grass tufts + fallen leaves
      for (i = 0; i < 700; i++) {
        b.fillStyle = rng() < 0.7 ? 'rgba(70,110,50,.25)' : 'rgba(140,120,40,.2)';
        b.fillRect(rng() * m.worldW, rng() * m.worldH, 2, 3 + rng() * 3);
      }
    }
    if (th.key === 'desert') {                            // dune ripple streaks
      b.strokeStyle = 'rgba(120,90,50,.14)'; b.lineWidth = 2;
      for (i = 0; i < 160; i++) {
        var dx0 = rng() * m.worldW, dy0 = rng() * m.worldH, dl = 26 + rng() * 60;
        b.beginPath(); b.moveTo(dx0, dy0);
        b.quadraticCurveTo(dx0 + dl / 2, dy0 - 5 - rng() * 6, dx0 + dl, dy0);
        b.stroke();
      }
    }

    /* soft sand patches (slow) */
    for (i = 0; i < G.sand.length; i++) {
      var s = G.sand[i];
      var g = b.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(230,205,150,.85)'); g.addColorStop(1, 'rgba(230,205,150,0)');
      b.fillStyle = g; b.beginPath(); b.arc(s.x, s.y, s.r, 0, TAU); b.fill();
      b.strokeStyle = 'rgba(150,115,65,.4)'; b.lineWidth = 1.5;
      for (var rj = 0.35; rj < 1; rj += 0.28) {
        b.beginPath(); b.arc(s.x, s.y, s.r * rj, rng() * TAU, rng() * TAU + 2.2); b.stroke();
      }
    }

    /* mud bogs (half speed) */
    for (i = 0; i < G.mud.length; i++) {
      var mu = G.mud[i];
      b.fillStyle = 'rgba(48,34,20,.92)';
      b.beginPath();
      for (var a2 = 0; a2 <= 12; a2++) {
        var an = a2 / 12 * TAU, rr = mu.r * (0.8 + 0.25 * Math.sin(an * 3 + mu.x));
        var px2 = mu.x + Math.cos(an) * rr, py2 = mu.y + Math.sin(an) * rr;
        if (a2 === 0) b.moveTo(px2, py2); else b.lineTo(px2, py2);
      }
      b.closePath(); b.fill();
      b.strokeStyle = 'rgba(120,90,55,.5)'; b.lineWidth = 1.6;
      b.beginPath(); b.arc(mu.x, mu.y, mu.r * 0.5, 0, TAU); b.stroke();
      b.beginPath(); b.arc(mu.x, mu.y, mu.r * 0.25, 0, TAU); b.stroke();
      b.fillStyle = 'rgba(200,190,150,.16)';
      b.beginPath(); b.ellipse(mu.x - mu.r * 0.25, mu.y - mu.r * 0.25, mu.r * 0.2, mu.r * 0.1, 0.6, 0, TAU); b.fill();
    }

    /* river, bridges, tunnel */
    if (th.river) {
      var ry = m.riverRow * C;
      var wg = b.createLinearGradient(0, ry, 0, ry + C);
      wg.addColorStop(0, '#274b52'); wg.addColorStop(0.5, '#2f6b6e'); wg.addColorStop(1, '#274b52');
      b.fillStyle = wg; b.fillRect(0, ry, m.worldW, C);
      b.fillStyle = 'rgba(255,255,255,.09)';
      for (i = 0; i < 60; i++) b.fillRect(rng() * m.worldW, ry + 6 + rng() * (C - 12), 10 + rng() * 22, 2);
      b.fillStyle = 'rgba(20,32,16,.9)';                  // banks
      b.fillRect(0, ry - 4, m.worldW, 4); b.fillRect(0, ry + C, m.worldW, 4);

      for (i = 0; i < m.bridges.length; i++) {            // plank bridges
        var bxc = m.bridges[i] * C;
        b.fillStyle = '#6a4a28'; b.fillRect(bxc + 4, ry - 6, C - 8, C + 12);
        b.strokeStyle = 'rgba(0,0,0,.35)'; b.lineWidth = 2;
        for (var pl = 0; pl < 7; pl++) {
          b.beginPath(); b.moveTo(bxc + 4, ry - 6 + pl * (C + 12) / 7);
          b.lineTo(bxc + C - 4, ry - 6 + pl * (C + 12) / 7); b.stroke();
        }
        b.fillStyle = '#3c2a14';
        b.fillRect(bxc + 2, ry - 8, C - 4, 4); b.fillRect(bxc + 2, ry + C + 4, C - 4, 4);
      }

      var tx = m.tunnelCol * C;                           // tunnel: ramps on base…
      var rg1 = b.createLinearGradient(0, ry - C * 0.7, 0, ry);
      rg1.addColorStop(0, 'rgba(0,0,0,0)'); rg1.addColorStop(1, 'rgba(0,0,0,.65)');
      b.fillStyle = rg1; b.fillRect(tx + 8, ry - C * 0.7, C - 16, C * 0.7);
      var rg2 = b.createLinearGradient(0, ry + C, 0, ry + C * 1.7);
      rg2.addColorStop(0, 'rgba(0,0,0,.65)'); rg2.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = rg2; b.fillRect(tx + 8, ry + C, C - 16, C * 0.7);
      b.fillStyle = '#0c1410'; b.fillRect(tx + 8, ry, C - 16, C);

      o.fillStyle = '#5c6258';                            // …stone roof on the OVER layer
      o.fillRect(tx + 2, ry - 8, C - 4, C + 16);
      o.fillStyle = 'rgba(0,0,0,.28)';
      for (var st = 0; st < 4; st++)
        for (var su = 0; su < 3; su++)
          o.strokeStyle = 'rgba(0,0,0,.3)', o.lineWidth = 1.6,
          o.strokeRect(tx + 4 + su * (C - 8) / 3, ry - 6 + st * (C + 12) / 4, (C - 8) / 3, (C + 12) / 4);
      o.fillStyle = '#2b2f29';
      o.fillRect(tx + 2, ry - 8, C - 4, 5); o.fillRect(tx + 2, ry + C + 3, C - 4, 5);
    }

    /* barbed wire (baked) — projectiles fly straight over it */
    for (i = 0; i < G.wire.length; i++) {
      var w2 = G.wire[i];
      b.strokeStyle = w2.dense ? 'rgba(140,130,116,.95)' : 'rgba(125,115,100,.8)';
      b.lineWidth = 1.4;
      var rows2 = w2.dense ? 5 : 3;
      for (var r2 = 0; r2 < rows2; r2++) {
        var wy2 = w2.y + (r2 + 0.5) * w2.h / rows2;
        b.beginPath(); b.moveTo(w2.x, wy2);
        for (var q = 0; q <= 8; q++)
          b.lineTo(w2.x + q * w2.w / 8, wy2 + (q % 2 ? -3 : 3));
        b.stroke();
        for (q = 0; q < 8; q++) {                          // barbs
          var bxp = w2.x + (q + 0.5) * w2.w / 8;
          b.beginPath(); b.moveTo(bxp - 3, wy2 - 3); b.lineTo(bxp + 3, wy2 + 3);
          b.moveTo(bxp + 3, wy2 - 3); b.lineTo(bxp - 3, wy2 + 3); b.stroke();
        }
      }
      b.fillStyle = 'rgba(70,60,50,.9)';                   // posts
      b.fillRect(w2.x - 2, w2.y - 2, 4, w2.h + 4); b.fillRect(w2.x + w2.w - 2, w2.y - 2, 4, w2.h + 4);
      if (w2.dense) {
        b.fillStyle = 'rgba(200,60,40,.7)';
        b.fillRect(w2.x + w2.w / 2 - 8, w2.y - 5, 16, 5);   // warning tab
      }
    }

    /* czech hedgehogs (baked) — tanks stop dead, shells pass between the beams */
    for (i = 0; i < G.hedgehogs.length; i++) {
      var hh = G.hedgehogs[i];
      b.save(); b.translate(hh.x, hh.y); b.rotate(hh.a);
      b.strokeStyle = '#1c1f22'; b.lineWidth = 5; b.lineCap = 'round';
      for (var hb = 0; hb < 3; hb++) {
        var ha = hb * TAU / 3;
        b.beginPath(); b.moveTo(Math.cos(ha) * -12, Math.sin(ha) * -12);
        b.lineTo(Math.cos(ha) * 12, Math.sin(ha) * 12); b.stroke();
      }
      b.strokeStyle = '#565d63'; b.lineWidth = 2.6;
      for (hb = 0; hb < 3; hb++) {
        var ha2 = hb * TAU / 3;
        b.beginPath(); b.moveTo(Math.cos(ha2) * -12, Math.sin(ha2) * -12);
        b.lineTo(Math.cos(ha2) * 12, Math.sin(ha2) * 12); b.stroke();
      }
      b.restore();
    }

    /* trees — trunk baked on the base layer (hard collision), leafy canopy
       baked on the OVER layer so it re-covers tanks passing underneath every
       frame, same trick as the tunnel roof above. */
    for (i = 0; i < G.trees.length; i++) {
      var tre2 = G.trees[i];
      var trng = MAZE.mulberry32(tre2.seed);
      b.save(); b.translate(tre2.x, tre2.y);
      b.fillStyle = '#2a1f12';
      b.beginPath(); b.arc(0, 0, tre2.trunkR, 0, TAU); b.fill();
      b.strokeStyle = 'rgba(0,0,0,.4)'; b.lineWidth = 1.5;
      b.beginPath(); b.arc(0, 0, tre2.trunkR, 0, TAU); b.stroke();
      b.restore();

      o.save(); o.translate(tre2.x, tre2.y);
      o.fillStyle = 'rgba(30,20,10,.35)';
      o.beginPath(); o.arc(2, 3, tre2.canopyR, 0, TAU); o.fill();     // ground shadow
      var cg = o.createRadialGradient(-tre2.canopyR * 0.3, -tre2.canopyR * 0.3, 2, 0, 0, tre2.canopyR);
      cg.addColorStop(0, '#5f8f3e'); cg.addColorStop(1, '#294f1c');
      o.fillStyle = cg;
      o.beginPath(); o.arc(0, 0, tre2.canopyR, 0, TAU); o.fill();
      o.fillStyle = 'rgba(90,150,60,.5)';
      for (var lf = 0; lf < 10; lf++) {
        var lfa = trng() * TAU, lfr = trng() * tre2.canopyR * 0.75;
        o.beginPath(); o.arc(Math.cos(lfa) * lfr, Math.sin(lfa) * lfr, 3 + trng() * 3, 0, TAU); o.fill();
      }
      o.strokeStyle = 'rgba(0,0,0,.25)'; o.lineWidth = 1.5;
      o.beginPath(); o.arc(0, 0, tre2.canopyR, 0, TAU); o.stroke();
      o.restore();
    }

    /* buildings — solid sealed structures with roof/window dressing, baked
       once (their walls are excluded from the live drawWalls() pass). */
    for (i = 0; i < G.buildings.length; i++) {
      var bd = G.buildings[i];
      var brng = MAZE.mulberry32(bd.roofSeed);
      var roofCol = bd.team === 'P' ? '#3f5a3a' : '#5a3f32';
      var roofEdge = bd.team === 'P' ? '#233420' : '#33231b';
      b.fillStyle = roofCol;
      b.fillRect(bd.x, bd.y, bd.w, bd.h);
      b.strokeStyle = roofEdge; b.lineWidth = 3;
      b.strokeRect(bd.x + 1.5, bd.y + 1.5, bd.w - 3, bd.h - 3);
      b.fillStyle = 'rgba(0,0,0,.22)';
      for (var wy4 = 0; wy4 < bd.rows; wy4++) {
        for (var wx4 = 0; wx4 < bd.cols; wx4++) {
          if (brng() < 0.55)
            b.fillRect(bd.x + wx4 * C + C * 0.28, bd.y + wy4 * C + C * 0.28, C * 0.44, C * 0.44);
        }
      }
      b.strokeStyle = 'rgba(0,0,0,.3)'; b.lineWidth = 2;
      b.beginPath();
      if (bd.w >= bd.h) { b.moveTo(bd.x, bd.y + bd.h / 2); b.lineTo(bd.x + bd.w, bd.y + bd.h / 2); }
      else { b.moveTo(bd.x + bd.w / 2, bd.y); b.lineTo(bd.x + bd.w / 2, bd.y + bd.h); }
      b.stroke();
    }

    /* base pads */
    drawPad(b, G.pads.P, '#3f8a4a', '#83d489');
    drawPad(b, G.pads.E, '#95352a', '#e06a52');

    G.terrainBase = base; G.terrainOver = over;
  }

  function drawPad(b, pad, col, edge) {
    b.save(); b.translate(pad.x, pad.y);
    b.fillStyle = col; b.globalAlpha = 0.85;
    b.fillRect(-pad.r, -pad.r, pad.r * 2, pad.r * 2);
    b.globalAlpha = 1;
    b.strokeStyle = edge; b.lineWidth = 3;
    b.strokeRect(-pad.r, -pad.r, pad.r * 2, pad.r * 2);
    b.strokeStyle = 'rgba(0,0,0,.3)'; b.lineWidth = 2;
    b.beginPath(); b.moveTo(-pad.r * 0.55, 0); b.lineTo(pad.r * 0.55, 0);
    b.moveTo(0, -pad.r * 0.55); b.lineTo(0, pad.r * 0.55); b.stroke();
    b.beginPath(); b.arc(0, 0, pad.r * 0.4, 0, TAU); b.stroke();
    b.restore();
  }

  /* ============================ GAME FACADE (used by entities) ============================ */
  G.speedMulAt = function (x, y) {
    var mul = 1, i;
    for (i = 0; i < G.mud.length; i++) {
      var m2 = G.mud[i];
      if (dist2(x, y, m2.x, m2.y) < m2.r * m2.r) { mul = Math.min(mul, 0.5); break; }
    }
    for (i = 0; i < G.sand.length; i++) {
      var s = G.sand[i];
      if (dist2(x, y, s.x, s.y) < s.r * s.r) { mul = Math.min(mul, 0.7); break; }
    }
    for (i = 0; i < G.wire.length; i++) {
      var w = G.wire[i];
      if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h)
        mul = Math.min(mul, w.dense ? 0.16 : 0.55);
    }
    return mul;
  };

  G.fireShell = function (tank) {
    G.shells.push(new ENT.Shell(tank, G));
    muzzleFX(tank, 1);
    AU.shot();
    if (tank.isPlayer) G.shake = Math.min(6, G.shake + 2.4);
  };
  G.dropMine = function (tank) {
    if (!tank.isPlayer) return;
    var active = 0;
    for (var i = 0; i < G.mines.length; i++) if (!G.mines[i].dead && G.mines[i].owner === tank) active++;
    if (active >= 4 || tank.minesInv <= 0) { AU.clank(); return; }
    tank.minesInv--;
    var mx = tank.x - Math.cos(tank.a) * (tank.r + 12);
    var my = tank.y - Math.sin(tank.a) * (tank.r + 12);
    G.mines.push(new ENT.Mine(tank, mx, my));
    AU.drop();
  };
  G.mineBeep = function () { AU.beep(); };
  G.onArmorEnd = function () {};
  G.onRespawn = function () {};
  G.onTankHit = function (t, d) {
    addFx({ type: 'hit', x: t.x, y: t.y, life: 0.18, max: 0.18 });
    if (t.isPlayer) G.shake = Math.min(9, G.shake + d * 0.16);
  };
  G.addTrack = function (t) {
    G.tracks.push({ x: t.x, y: t.y, a: t.a, life: 5 });
    if (G.tracks.length > 420) G.tracks.splice(0, G.tracks.length - 420);
  };
  G.sparkFX = function (x, y) { addFx({ type: 'spark', x: x, y: y, life: 0.14, max: 0.14 }); };

  G.nearestVisibleEnemy = function (t) {
    var best = null, bd = Infinity;
    for (var i = 0; i < G.tanks.length; i++) {
      var e = G.tanks[i];
      if (e.team === t.team || e.dead || e.hidden) continue;
      var d = dist2(t.x, t.y, e.x, e.y);
      if (d < bd && d < 620 * 620 && ENT.losClear(G, t.x, t.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  };

  G.turretTarget = function (tu) {
    var best = null, bd = Infinity;
    for (var i = 0; i < G.tanks.length; i++) {
      var e = G.tanks[i];
      if (e.team === tu.team || e.dead || e.hidden) continue;
      var d = dist2(tu.x, tu.y, e.x, e.y);
      if (d < bd && d < tu.range * tu.range && ENT.losClear(G, tu.x, tu.y, e.x, e.y)) { bd = d; best = e; }
    }
    return best;
  };

  G.shellHitsWall = function (shell, wall) {
    var r = G.maze.wallRect(wall);
    var hx = clamp(shell.x, r.x, r.x + r.w), hy = clamp(shell.y, r.y, r.y + r.h);
    addFx({ type: 'boom', x: hx, y: hy, r: 26, life: 0.3, max: 0.3 });
    if (wall.weak && !wall.boundary) {
      wall.hp--;
      if (wall.hp <= 0) {
        wall.alive = false;
        AU.crumble();
        rubbleFX(r);
      } else AU.clank();
    } else AU.clank();
  };

  /* explosion: direct-hit damage + splash to tanks, chips weak walls, chains mines */
  G.explode = function (x, y, radius, dmg, owner, directHit) {
    addFx({ type: 'boom', x: x, y: y, r: radius, life: 0.42, max: 0.42 });
    for (var p = 0; p < 14; p++) {
      var an = Math.random() * TAU, sp = 40 + Math.random() * 160;
      addFx({ type: 'p', x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: 0.4 + Math.random() * 0.4, max: 0.8, col: p < 6 ? '#ffb44a' : '#5a5a5a', sz: 2 + Math.random() * 3 });
    }
    AU.boom(radius > 60);
    if (dist2(x, y, G.player.x, G.player.y) < 300 * 300) G.shake = Math.min(11, G.shake + radius * 0.09);

    if (directHit && !directHit.dead) directHit.takeDamage(dmg, G, owner);
    for (var i = 0; i < G.tanks.length; i++) {
      var t = G.tanks[i];
      if (t.dead || t === directHit) continue;
      var d = Math.sqrt(dist2(x, y, t.x, t.y));
      if (d < radius + t.r) {
        var f = 1 - Math.max(0, d - t.r) / radius;
        t.takeDamage(dmg * f * 0.65, G, owner);
      }
    }
    for (var ti = 0; ti < G.turrets.length; ti++) {
      var tur = G.turrets[ti];
      if (tur.dead || tur === directHit) continue;
      var dt2 = Math.sqrt(dist2(x, y, tur.x, tur.y));
      if (dt2 < radius + tur.r) {
        var ft = 1 - Math.max(0, dt2 - tur.r) / radius;
        tur.takeDamage(dmg * ft * 0.65, G, owner);
      }
    }
    // chip weak walls caught in the blast
    var walls = G.maze.nearWalls(x, y);
    for (var w = 0; w < walls.length; w++) {
      var wl = walls[w];
      if (!wl.weak || wl.boundary || !wl.alive) continue;
      var r2 = G.maze.wallRect(wl);
      if (ENT.circleRect(x, y, radius * 0.8, r2)) {
        wl.hp--;
        if (wl.hp <= 0) { wl.alive = false; AU.crumble(); rubbleFX(r2); }
      }
    }
    // chain nearby mines
    for (var mi = 0; mi < G.mines.length; mi++) {
      var mn = G.mines[mi];
      if (!mn.dead && dist2(x, y, mn.x, mn.y) < (radius * 0.9) * (radius * 0.9)) {
        mn.armT = 0; mn.beeping = true; mn.beepT = Math.min(mn.beepT, 0.1);
      }
    }
  };

  G.killTank = function (t, src) {
    if (t.dead) return;
    t.dead = true;
    t.respawnT = t.isPlayer ? 2.6 : 3.4;
    if (t.carrying) dropFlag(t);
    addFx({ type: 'boom', x: t.x, y: t.y, r: 54, life: 0.55, max: 0.55 });
    for (var p = 0; p < 26; p++) {
      var an = Math.random() * TAU, sp = 50 + Math.random() * 220;
      addFx({ type: 'p', x: t.x, y: t.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: 0.5 + Math.random() * 0.7, max: 1.2,
        col: p < 8 ? '#ffcf6a' : (p < 16 ? '#e06a3a' : '#484848'), sz: 2 + Math.random() * 4 });
    }
    addFx({ type: 'wreck', x: t.x, y: t.y, a: t.a, life: t.respawnT, max: t.respawnT, pcol: t.isPlayer });
    AU.boom(true);
    if (t.isPlayer) { G.shake = 13; showBanner('TANK DESTROYED', 1100); }
  };

  G.killTurret = function (tu) {
    if (tu.dead) return;
    tu.dead = true;
    addFx({ type: 'boom', x: tu.x, y: tu.y, r: 40, life: 0.5, max: 0.5 });
    for (var p = 0; p < 20; p++) {
      var an = Math.random() * TAU, sp = 40 + Math.random() * 180;
      addFx({ type: 'p', x: tu.x, y: tu.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: 0.4 + Math.random() * 0.6, max: 1, col: p < 8 ? '#ffcf6a' : '#484848', sz: 2 + Math.random() * 3 });
    }
    AU.boom(false);
    G.blockedCells.delete(cellKey(tu.cellX, tu.cellY));
  };

  function muzzleFX(tank, scale) {
    var a = tank.turret, mz = tank.r + 16;
    addFx({ type: 'muz', x: tank.x + Math.cos(a) * mz, y: tank.y + Math.sin(a) * mz,
      a: a, life: 0.08, max: 0.08, s: scale });
  }
  function rubbleFX(r) {
    var cx2 = r.x + r.w / 2, cy2 = r.y + r.h / 2;
    for (var p = 0; p < 16; p++) {
      var an = Math.random() * TAU, sp = 30 + Math.random() * 120;
      addFx({ type: 'p', x: cx2 + (Math.random() - 0.5) * r.w, y: cy2 + (Math.random() - 0.5) * r.h,
        vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: 0.5 + Math.random() * 0.5, max: 1, col: '#8a8478', sz: 2 + Math.random() * 3.5 });
    }
    addFx({ type: 'rubble', x: cx2, y: cy2, w: r.w, h: r.h, life: 999, max: 999 });
  }
  function addFx(f) { G.fx.push(f); }

  /* ============================ FLAGS / CTF ============================ */
  function dropFlag(t) {
    var f = t.carrying;
    f.carrier = null; f.x = t.x; f.y = t.y; f.dropT = 15;   // returns home after 15 s untouched
    t.carrying = null;
  }

  function updateFlags(dt) {
    ['P', 'E'].forEach(function (k) {
      var f = G.flags[k];
      if (f.carrier) {
        if (f.carrier.dead) { f.carrier = null; }
        else {
          f.x = f.carrier.x - Math.cos(f.carrier.a) * 14;
          f.y = f.carrier.y - Math.sin(f.carrier.a) * 14;
          return;
        }
      }
      var atHome = Math.abs(f.x - f.home.x) < 1 && Math.abs(f.y - f.home.y) < 1;
      if (!atHome) {
        f.dropT -= dt;
        if (f.dropT <= 0) { f.x = f.home.x; f.y = f.home.y; showBanner(k === 'E' ? 'ENEMY FLAG RETURNED' : 'YOUR FLAG RETURNED', 1100); }
      }
      // touches
      for (var i = 0; i < G.tanks.length; i++) {
        var t = G.tanks[i];
        if (t.dead) continue;
        if (dist2(t.x, t.y, f.x, f.y) > (t.r + 14) * (t.r + 14)) continue;
        if (t.team !== k) {                          // enemy of this flag grabs it
          if (f.carrier) continue;
          f.carrier = t; t.carrying = f; f.dropT = 0;
          if (k === 'E') { showBanner('ENEMY FLAG TAKEN', 1300); AU.alarm(); }
          else { showBanner('THEY HAVE YOUR FLAG!', 1300); AU.alarm(); }
          return;
        } else if (!atHome && !f.carrier) {          // own team touches dropped flag → instant return
          f.x = f.home.x; f.y = f.home.y; f.dropT = 0;
          showBanner(k === 'P' ? 'FLAG RECOVERED' : 'ENEMY FLAG RESET', 1100);
          AU.pickup();
          return;
        }
      }
    });

    // scoring
    var pf = G.flags.E, pl = G.player;
    if (pf.carrier === pl && dist2(pl.x, pl.y, G.pads.P.x, G.pads.P.y) < G.pads.P.r * G.pads.P.r) {
      pf.carrier = null; pl.carrying = null;
      G.playerCaps++;
      AU.score();
      if (G.playerCaps >= G.capsNeeded) { levelComplete(); return; }
      showBanner('CAPTURE! ' + G.playerCaps + ' / ' + G.capsNeeded, 1600);
      roundReset();
    }
    var ef = G.flags.P;
    if (ef.carrier && ef.carrier.team === 'E' &&
        dist2(ef.carrier.x, ef.carrier.y, G.pads.E.x, G.pads.E.y) < G.pads.E.r * G.pads.E.r) {
      ef.carrier.carrying = null; ef.carrier = null;
      G.enemyCaps++;
      AU.lose();
      if (G.enemyCaps >= G.diff.allowed) { gameOver(); return; }
      showBanner('FLAG LOST — ' + (G.diff.allowed - G.enemyCaps) + ' LEFT', 1800);
      roundReset();
    }
  }

  /* ============================ SPECIAL ITEMS ============================ */
  var ITEM_TYPES = [
    { k: 'auto',  sym: '\u25CE', w: 3 },   // ◎
    { k: 'armor', sym: '\u26E8', w: 3 },   // ⛨
    { k: 'air',   sym: '\u2708', w: 2 },   // ✈
    { k: 'mines', sym: '+',      w: 3 }
  ];
  var ARMORS = [['STEEL', 3], ['COMPOSITE', 4], ['REACTIVE', 5]];

  function spawnItem() {
    if (G.items.length >= 3) return;
    var m = G.maze;
    for (var t = 0; t < 80; t++) {
      var x = (Math.random() * m.cols) | 0, y = (Math.random() * m.rows) | 0;
      var c = m.cell(x, y);
      if (c.water || c.tunnel) continue;
      if (G.blockedCells.has(cellKey(x, y))) continue;
      var wc = m.center(x, y);
      if (dist2(wc.x, wc.y, G.pads.P.x, G.pads.P.y) < 200 * 200) continue;
      if (dist2(wc.x, wc.y, G.pads.E.x, G.pads.E.y) < 200 * 200) continue;
      var tw = 0, i;
      for (i = 0; i < ITEM_TYPES.length; i++) tw += ITEM_TYPES[i].w;
      var pick = Math.random() * tw, ty = ITEM_TYPES[0];
      for (i = 0; i < ITEM_TYPES.length; i++) { pick -= ITEM_TYPES[i].w; if (pick <= 0) { ty = ITEM_TYPES[i]; break; } }
      G.items.push({ x: wc.x, y: wc.y, type: ty, bob: Math.random() * TAU });
      return;
    }
  }

  function updateItems(dt) {
    G.itemSpawnT -= dt;
    if (G.itemSpawnT <= 0) { G.itemSpawnT = 11 + Math.random() * 6; spawnItem(); }
    var pl = G.player;
    for (var i = G.items.length - 1; i >= 0; i--) {
      var it = G.items[i];
      it.bob += dt * 3;
      if (!pl.dead && dist2(pl.x, pl.y, it.x, it.y) < 26 * 26) {
        applyItem(it.type.k);
        G.items.splice(i, 1);
      }
    }
  }

  function applyItem(k) {
    AU.pickup();
    var pl = G.player;
    if (k === 'auto') {
      pl.autoT = 10; pl.autoLock = null; pl.autoLockT = 0;
      showBanner('AUTO-TARGET ONLINE', 1200);
    } else if (k === 'armor') {
      var a = ARMORS[(Math.random() * ARMORS.length) | 0];
      pl.armor = { name: a[0], dur: a[1], remain: a[1], started: false };
      showBanner(a[0] + ' PLATING FITTED', 1200);
    } else if (k === 'air') {
      callAirSupport();
    } else if (k === 'mines') {
      pl.minesCap = Math.min(12, pl.minesCap + 2);
      pl.minesInv = Math.min(pl.minesCap, pl.minesInv + 2);
      showBanner('MINE RACK +2  (' + pl.minesInv + '/' + pl.minesCap + ')', 1200);
    }
  }

  /* ---- air support: sweeps the enemy's side of the map ---- */
  function inEnemyHalf(x, y) {
    return (x / G.maze.worldW + (1 - y / G.maze.worldH)) > 1.02;
  }
  function callAirSupport() {
    var kinds = ['bombs', 'napalm', 'strafe'];
    var kind = kinds[(Math.random() * 3) | 0];
    var y = G.maze.worldH * (0.1 + Math.random() * 0.3);
    G.plane = { x: -140, y: y, vx: 430, kind: kind, dropT: 0, engineT: 0 };
    showBanner('AIR SUPPORT — ' + (kind === 'bombs' ? 'BOMBS' : kind === 'napalm' ? 'NAPALM' : 'STRAFING RUN'), 1500);
    AU.plane();
  }
  function updatePlane(dt) {
    var p = G.plane;
    if (!p) return;
    p.x += p.vx * dt;
    p.engineT -= dt;
    if (p.engineT <= 0) { p.engineT = 1.8; AU.plane(); }
    p.dropT -= dt;
    if (p.dropT <= 0 && inEnemyHalf(p.x, p.y)) {
      if (p.kind === 'bombs') {
        p.dropT = 0.34;
        G.bombs.push({ x: p.x, y: p.y + 20 + Math.random() * 60, t: 0.55 });
      } else if (p.kind === 'napalm') {
        p.dropT = 0.22;
        G.firePatches.push({ x: p.x + (Math.random() - 0.5) * 30, y: p.y + 30 + Math.random() * 70,
          r: 30 + Math.random() * 14, life: 6 });
        if (Math.random() < 0.25) AU.boom(false);
      } else {
        p.dropT = 0.05;
        var ix = p.x + 30, iy = p.y + 26 + Math.random() * 90;
        G.strafes.push({ x: ix, y: iy, life: 0.2 });
        for (var i = 0; i < G.tanks.length; i++) {
          var t = G.tanks[i];
          if (!t.dead && dist2(ix, iy, t.x, t.y) < 20 * 20) t.takeDamage(7, G, G.player);
        }
      }
    }
    if (p.x > G.maze.worldW + 160) G.plane = null;
  }
  function updateBombsAndFire(dt) {
    for (var i = G.bombs.length - 1; i >= 0; i--) {
      var b = G.bombs[i];
      b.t -= dt;
      if (b.t <= 0) { G.explode(b.x, b.y, 72, 55, G.player, null); G.bombs.splice(i, 1); }
    }
    for (i = G.firePatches.length - 1; i >= 0; i--) {
      var f = G.firePatches[i];
      f.life -= dt;
      if (f.life <= 0) { G.firePatches.splice(i, 1); continue; }
      for (var t2 = 0; t2 < G.tanks.length; t2++) {
        var tk = G.tanks[t2];
        if (!tk.dead && dist2(f.x, f.y, tk.x, tk.y) < (f.r + tk.r * 0.5) * (f.r + tk.r * 0.5))
          tk.takeDamage(20 * dt, G, G.player);
      }
    }
    for (i = G.strafes.length - 1; i >= 0; i--) {
      G.strafes[i].life -= dt;
      if (G.strafes[i].life <= 0) G.strafes.splice(i, 1);
    }
  }

  /* ============================ ENEMY AI ============================ */
  function aiControl(t, dt) {
    var ai = t.ai, m = G.maze, pl = G.player;
    var ctrl = { throttle: 0, steer: 0, fire: false, mine: false, aim: null };
    if (t.dead) return ctrl;

    var myCell = m.cellOf(t.x, t.y);
    var playerVisible = !pl.dead && !pl.hidden &&
      dist2(t.x, t.y, pl.x, pl.y) < 560 * 560 &&
      ENT.losClear(G, t.x, t.y, pl.x, pl.y);

    /* ------ choose destination cell ------ */
    var dest = null, reason = '';
    if (t.carrying) {                                        // haul the stolen flag home
      dest = m.cellOf(t.homeX, t.homeY); reason = 'home';
    } else if (ai.role === 'runner') {
      var pf = G.flags.P;
      if (!pf.carrier) { dest = m.cellOf(pf.x, pf.y); reason = 'steal'; }
      else if (pf.carrier.team === 'E') { dest = m.cellOf(pf.carrier.x, pf.carrier.y); reason = 'escort'; }
    }
    if (!dest) {
      var ef = G.flags.E;
      if (ef.carrier === pl && !pl.hidden) {                 // hunt the thief
        dest = m.cellOf(pl.x, pl.y); reason = 'intercept';
      } else if (ef.carrier == null && (Math.abs(ef.x - ef.home.x) > 1 || Math.abs(ef.y - ef.home.y) > 1)) {
        dest = m.cellOf(ef.x, ef.y); reason = 'recover';     // touch own dropped flag to reset it
      } else if (playerVisible) {
        dest = m.cellOf(pl.x, pl.y); reason = 'chase';
      } else if (ai.guard && !ef.carrier) {
        dest = m.cellOf(ef.x, ef.y); reason = 'guard';
      } else {
        ai.wanderT -= dt;
        if (!ai.target || ai.wanderT <= 0) {
          ai.wanderT = 5 + Math.random() * 4;
          for (var w = 0; w < 40; w++) {
            var rx = (Math.random() * m.cols) | 0, ry = (Math.random() * m.rows) | 0;
            if (m.passable(rx, ry)) { ai.target = { x: rx, y: ry }; break; }
          }
        }
        dest = ai.target; reason = 'wander';
      }
    }

    /* ------ path ------ */
    ai.repathT -= dt;
    var destKey = dest ? dest.x + ':' + dest.y : '';
    if (dest && (ai.repathT <= 0 || ai.destKey !== destKey || !ai.path)) {
      ai.repathT = reason === 'chase' || reason === 'intercept' ? 0.9 : 1.7;
      ai.destKey = destKey;
      ai.path = m.findPath(myCell.x, myCell.y, dest.x, dest.y, true);
      ai.pathI = 1;
    }

    /* ------ stuck / reversing ------ */
    if (ai.backT > 0) {
      ai.backT -= dt;
      ctrl.throttle = -0.8; ctrl.steer = ai.backSteer;
    } else {
      if (t.speedNow < 9) ai.stuckT += dt; else ai.stuckT = 0;
      if (ai.stuckT > 1.4) {
        ai.stuckT = 0; ai.backT = 0.45; ai.backSteer = Math.random() < 0.5 ? -1 : 1;
        ai.repathT = 0;
      }
    }

    /* ------ follow path, shelling weak walls that block it ------ */
    var shootWallAt = null;
    if (ai.backT <= 0 && ai.path && ai.pathI < ai.path.length) {
      var wp = ai.path[ai.pathI];
      var wpc = m.center(wp.x, wp.y);
      var prev = ai.path[ai.pathI - 1] || myCell;
      var wall = m.wallBetween(prev.x, prev.y, wp.x, wp.y);
      if (wall && wall.alive && wall.weak &&
          Math.abs(myCell.x - prev.x) <= 0 && Math.abs(myCell.y - prev.y) <= 0) {
        // stand off and shell the cracked wall open
        var wr = m.wallRect(wall);
        shootWallAt = { x: wr.x + wr.w / 2, y: wr.y + wr.h / 2 };
      } else {
        var da = angDiff(t.a, Math.atan2(wpc.y - t.y, wpc.x - t.x));
        ctrl.steer = clamp(da * 2.4, -1, 1);
        ctrl.throttle = Math.abs(da) < 1.25 ? 1 : 0.2;
        if (dist2(t.x, t.y, wpc.x, wpc.y) < 22 * 22) ai.pathI++;
      }
    } else if (ai.backT <= 0 && dest) {
      var dc = m.center(dest.x, dest.y);
      var da2 = angDiff(t.a, Math.atan2(dc.y - t.y, dc.x - t.x));
      ctrl.steer = clamp(da2 * 2.4, -1, 1);
      ctrl.throttle = Math.abs(da2) < 1.3 ? 0.8 : 0.15;
    }

    /* ------ gunnery ------ */
    if (shootWallAt) {
      ctrl.aim = Math.atan2(shootWallAt.y - t.y, shootWallAt.x - t.x);
      ctrl.throttle = 0; ctrl.steer = 0;
      if (Math.abs(angDiff(t.turret, ctrl.aim)) < 0.12) ctrl.fire = true;
    } else if (playerVisible) {
      var lead = 0.16 * Math.sqrt(dist2(t.x, t.y, pl.x, pl.y)) / 470;
      var px2 = pl.x + pl.vx * lead, py2 = pl.y + pl.vy * lead;
      ctrl.aim = Math.atan2(py2 - t.y, px2 - t.x);
      var ad = Math.abs(angDiff(t.turret, ctrl.aim));
      var d2 = dist2(t.x, t.y, pl.x, pl.y);
      if (ad < 0.14 && d2 < 520 * 520) ctrl.fire = true;
      if (!t.carrying && reason !== 'steal' && d2 < 260 * 260 && ctrl.throttle > 0.5)
        ctrl.throttle = 0.55;                              // don't just faceplant into the player
    }
    return ctrl;
  }

  /* ============================ ROUND / LEVEL FLOW ============================ */
  var $ = function (id) { return document.getElementById(id); };
  var bannerT = 0;
  function showBanner(txt, ms) {
    var b = $('banner');
    b.textContent = txt;
    b.classList.add('show');
    bannerT = (ms || 1200) / 1000;
  }

  function levelComplete() {
    G.state = 'level';
    AU.score();
    if (G.level > G.best) { G.best = G.level; localStorage.setItem('ironflag_best', String(G.best)); }
    var next = THEMES[G.level % THEMES.length];
    $('lvTop').textContent = 'SECTOR CLEARED — ' + G.theme.name;
    $('lvTitle').textContent = 'LEVEL ' + (G.level + 1) + ' · ' + next.name;
    $('lvBrief').textContent = next.brief + (G.level + 1 >= 4 ? ' Two captures required to clear this sector.' : '');
    $('screenMenu').classList.add('hidden');
    $('screenOver').classList.add('hidden');
    $('screenLevel').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  function gameOver() {
    G.state = 'over';
    AU.lose();
    $('ovTitle').textContent = 'DEFEAT';
    $('ovBrief').textContent = 'The enemy captured your flag ' + G.enemyCaps + ' times on ' +
      G.diff.name + '. You fell at level ' + G.level + ' (' + G.theme.name + '). Best run: level ' + G.best + '.';
    $('screenMenu').classList.add('hidden');
    $('screenLevel').classList.add('hidden');
    $('screenOver').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  function startGame() {
    AU.ensure();
    G.level = 1;
    buildLevel(1);
    G.state = 'play';
    G.freezeT = 0.8;
    $('overlay').classList.add('hidden');
    showBanner('LEVEL 1 · ' + G.theme.name, 1400);
  }
  function nextLevel() {
    G.level++;
    buildLevel(G.level);
    G.state = 'play';
    G.freezeT = 0.8;
    $('overlay').classList.add('hidden');
    showBanner('LEVEL ' + G.level + ' · ' + G.theme.name, 1400);
  }

  /* ============================ UPDATE ============================ */
  function ramCheck(dt) {
    for (var i = 0; i < G.tanks.length; i++) {
      for (var j = i + 1; j < G.tanks.length; j++) {
        var a = G.tanks[i], b = G.tanks[j];
        if (a.dead || b.dead) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var min = a.r + b.r;
        if (d < min) {
          var nx = dx / d, ny = dy / d, push = (min - d) / 2 + 0.5;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          var closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;   // approach speed along normal
          if (closing > 45 && a.ramCd <= 0 && b.ramCd <= 0) {
            var dmg = Math.min(50, closing * 0.16);                // ram: up to 50, hurts both tanks
            a.ramCd = b.ramCd = 0.6;
            a.takeDamage(dmg * 0.9, G, b);
            b.takeDamage(dmg, G, a);
            addFx({ type: 'boom', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 22, life: 0.25, max: 0.25 });
            AU.clank(); AU.boom(false);
          }
        }
      }
    }
  }

  function update(dt) {
    G.time += dt;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('show'); }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 22);

    // effects always tick
    for (var f = G.fx.length - 1; f >= 0; f--) {
      var e = G.fx[f];
      e.life -= dt;
      if (e.type === 'p') { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.94; e.vy *= 0.94; }
      if (e.life <= 0 && e.type !== 'rubble') G.fx.splice(f, 1);
    }
    for (var tr = G.tracks.length - 1; tr >= 0; tr--) {
      G.tracks[tr].life -= dt;
      if (G.tracks[tr].life <= 0) G.tracks.splice(tr, 1);
    }

    if (G.state !== 'play') return;
    if (G.freezeT > 0) { G.freezeT -= dt; return; }

    // player control
    var pc = INPUT.getDrive(G.player.a);
    G.player.update(dt, G, pc);

    // enemies
    for (var i = 0; i < G.tanks.length; i++) {
      var t = G.tanks[i];
      if (t.isPlayer) continue;
      t.update(dt, G, aiControl(t, dt));
    }

    for (var tu3 = 0; tu3 < G.turrets.length; tu3++) G.turrets[tu3].update(dt, G);

    ramCheck(dt);

    for (i = G.shells.length - 1; i >= 0; i--) { G.shells[i].update(dt, G); if (G.shells[i].dead) G.shells.splice(i, 1); }
    for (i = G.mines.length - 1; i >= 0; i--) { G.mines[i].update(dt, G); if (G.mines[i].dead) G.mines.splice(i, 1); }

    updateItems(dt);
    updatePlane(dt);
    updateBombsAndFire(dt);
    updateFlags(dt);
    updateDoors(dt);
  }

  /* automatic doors slide open for any nearby tank; barricade doors need no
     per-frame logic — they're driven entirely by shellHitsWall() below. */
  function updateDoors(dt) {
    for (var i = 0; i < G.doors.length; i++) {
      var d = G.doors[i];
      if (!d.auto) continue;
      var near = false;
      for (var j = 0; j < G.tanks.length; j++) {
        var tk = G.tanks[j];
        if (tk.dead) continue;
        if (dist2(tk.x, tk.y, d.x, d.y) < d.triggerR * d.triggerR) { near = true; break; }
      }
      d.openT = clamp(d.openT + (near ? 1 : -1) * dt * 2.2, 0, 1);
      d.open = d.openT > 0.5;
      d.wall.alive = !d.open;
    }
  }

  /* ============================ RENDER ============================ */
  function camera() {
    var m = G.maze;
    var viewH = m.CELL * 9.2;
    var scale = cv.height / viewH;
    var vw = cv.width / scale, vh = cv.height / scale;
    var cxr = clamp(G.player.x, vw / 2, Math.max(vw / 2, m.worldW - vw / 2));
    var cyr = clamp(G.player.y, vh / 2, Math.max(vh / 2, m.worldH - vh / 2));
    if (m.worldW < vw) cxr = m.worldW / 2;
    if (m.worldH < vh) cyr = m.worldH / 2;
    G.camX = cxr; G.camY = cyr;
    return { scale: scale, x: cxr - vw / 2, y: cyr - vh / 2, vw: vw, vh: vh };
  }

  /* cracks — deeper as hp drops. Shared by ordinary weak walls and barricade
     doors so both render identically. */
  function drawWeakCracks(r, w) {
    var seed = (w.gx * 73 + w.gy * 131 + (w.vert ? 7 : 0));
    cx.strokeStyle = 'rgba(20,12,8,.75)'; cx.lineWidth = 1.4;
    var cracks = 1 + (w.maxHp - w.hp) * 2 + (seed % 2);
    for (var cnum = 0; cnum < cracks; cnum++) {
      var sxr = r.x + ((seed * (cnum + 2) * 31) % Math.max(1, r.w));
      var syr = r.y + ((seed * (cnum + 3) * 19) % Math.max(1, r.h));
      cx.beginPath(); cx.moveTo(sxr, syr);
      cx.lineTo(sxr + (((seed + cnum) % 7) - 3) * 3, syr + (((seed + cnum) % 5) - 2) * 4);
      cx.lineTo(sxr + (((seed + cnum) % 5) - 2) * 5, syr + (((seed + cnum) % 9) - 4) * 3);
      cx.stroke();
    }
    cx.strokeStyle = 'rgba(255,210,120,.28)';
    cx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  function drawWalls(cam) {
    var m = G.maze, th = G.theme;
    var x0 = cam.x - 40, y0 = cam.y - 40, x1 = cam.x + cam.vw + 40, y1 = cam.y + cam.vh + 40;
    var walls = m.allWalls();
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (w.building || w.isDoor) continue;   // buildings/doors render themselves
      var r = m.wallRect(w);
      if (r.x + r.w < x0 || r.x > x1 || r.y + r.h < y0 || r.y > y1) continue;
      var seed = (w.gx * 73 + w.gy * 131 + (w.vert ? 7 : 0));
      cx.fillStyle = w.weak ? th.wallWeak : th.wallFill;
      cx.fillRect(r.x, r.y, r.w, r.h);
      cx.strokeStyle = th.wallEdge; cx.lineWidth = 2;
      cx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      // theme dressing
      if (th.key === 'city' && !w.weak) {
        cx.fillStyle = 'rgba(150,190,210,.25)';
        var n2 = w.vert ? 4 : 4;
        for (var q = 0; q < n2; q++) {
          if ((seed + q) % 3 === 0) continue;
          if (w.vert) cx.fillRect(r.x + 3, r.y + 8 + q * (r.h - 14) / n2, r.w - 6, 4);
          else cx.fillRect(r.x + 8 + q * (r.w - 14) / n2, r.y + 3, 4, r.h - 6);
        }
      }
      if (th.key === 'forest' && !w.weak) {
        cx.fillStyle = 'rgba(90,150,60,.5)';
        for (var lb = 0; lb < 3; lb++) {
          var lx = r.x + ((seed * (lb + 3) * 17) % Math.max(1, r.w - 8)) + 4;
          var ly = r.y + ((seed * (lb + 5) * 23) % Math.max(1, r.h - 8)) + 4;
          cx.beginPath(); cx.arc(lx, ly, 4, 0, TAU); cx.fill();
        }
      }
      if (w.weak) drawWeakCracks(r, w);
    }
  }

  function drawDoors(cam) {
    var x0 = cam.x - 40, y0 = cam.y - 40, x1 = cam.x + cam.vw + 40, y1 = cam.y + cam.vh + 40;
    for (var i = 0; i < G.doors.length; i++) {
      var d = G.doors[i];
      var r = G.maze.wallRect(d.wall);
      if (r.x + r.w < x0 || r.x > x1 || r.y + r.h < y0 || r.y > y1) continue;
      if (d.auto) {
        cx.save();
        cx.fillStyle = '#8a8f76';
        cx.strokeStyle = '#3a3d30'; cx.lineWidth = 2;
        if (d.wall.vert) {
          var halfH = r.h / 2 * (1 - d.openT * 0.92);
          cx.fillRect(r.x, r.y, r.w, halfH); cx.strokeRect(r.x, r.y, r.w, halfH);
          cx.fillRect(r.x, r.y + r.h - halfH, r.w, halfH); cx.strokeRect(r.x, r.y + r.h - halfH, r.w, halfH);
        } else {
          var halfW = r.w / 2 * (1 - d.openT * 0.92);
          cx.fillRect(r.x, r.y, halfW, r.h); cx.strokeRect(r.x, r.y, halfW, r.h);
          cx.fillRect(r.x + r.w - halfW, r.y, halfW, r.h); cx.strokeRect(r.x + r.w - halfW, r.y, halfW, r.h);
        }
        cx.fillStyle = d.open ? '#7cc97f' : '#c8452c';
        cx.beginPath(); cx.arc(r.x + r.w / 2, r.y + r.h / 2, 2.4, 0, TAU); cx.fill();
        cx.restore();
      } else {
        if (!d.wall.alive) continue;   // breached — nothing left to draw
        cx.fillStyle = '#6a4a28';
        cx.fillRect(r.x, r.y, r.w, r.h);
        cx.strokeStyle = '#2c1c0c'; cx.lineWidth = 2;
        cx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        drawWeakCracks(r, d.wall);
      }
    }
  }

  function drawFlag(f, isEnemy) {
    if (f.carrier && f.carrier.hidden) return;
    cx.save();
    cx.translate(f.x, f.y);
    cx.strokeStyle = '#d8d2c0'; cx.lineWidth = 2.4;
    cx.beginPath(); cx.moveTo(0, 6); cx.lineTo(0, -22); cx.stroke();
    var wave = Math.sin(G.time * 6 + f.x) * 2;
    if (isEnemy && enemyFlagReady) {
      cx.drawImage(enemyFlagImg, 0, -22 + wave * 0.3, 22, 14);
    } else {
      cx.fillStyle = isEnemy ? '#d1452e' : '#57b45e';
      cx.beginPath();
      cx.moveTo(0, -22); cx.lineTo(20, -17 + wave); cx.lineTo(0, -11);
      cx.closePath(); cx.fill();
    }
    cx.fillStyle = 'rgba(0,0,0,.3)';
    cx.beginPath(); cx.ellipse(0, 7, 7, 3, 0, 0, TAU); cx.fill();
    cx.restore();
  }

  function drawTank(t, ghost) {
    cx.save();
    if (ghost) cx.globalAlpha = 0.34;
    cx.translate(t.x, t.y);
    // shadow
    cx.fillStyle = 'rgba(0,0,0,.3)';
    cx.beginPath(); cx.ellipse(2, 3, t.r + 3, t.r, t.a, 0, TAU); cx.fill();
    cx.rotate(t.a);
    var body = t.isPlayer ? '#6f8f4e' : '#a3543c';
    var dark = t.isPlayer ? '#42582c' : '#67301f';
    // tracks
    cx.fillStyle = '#22251f';
    cx.fillRect(-t.r - 1, -t.r - 1, (t.r + 1) * 2, 7);
    cx.fillRect(-t.r - 1, t.r - 6, (t.r + 1) * 2, 7);
    cx.fillStyle = 'rgba(255,255,255,.14)';
    for (var s = -2; s <= 2; s++) {
      cx.fillRect(s * 7 - 1 + ((G.time * t.speedNow * 0.06) % 7), -t.r - 1, 2, 7);
      cx.fillRect(s * 7 - 1 + ((G.time * t.speedNow * 0.06) % 7), t.r - 6, 2, 7);
    }
    // hull
    cx.fillStyle = body;
    cx.fillRect(-t.r + 1, -t.r + 5, t.r * 2 - 2, t.r * 2 - 10);
    cx.strokeStyle = dark; cx.lineWidth = 2;
    cx.strokeRect(-t.r + 1, -t.r + 5, t.r * 2 - 2, t.r * 2 - 10);
    cx.fillStyle = dark;
    cx.fillRect(t.r - 6, -3, 4, 6);          // hatch nub, marks the front
    cx.restore();

    // turret (independent angle)
    cx.save();
    if (ghost) cx.globalAlpha = 0.34;
    cx.translate(t.x, t.y);
    cx.rotate(t.turret);
    cx.fillStyle = dark;
    cx.fillRect(t.r * 0.3, -2.6, t.r + 12, 5.2);          // barrel
    cx.fillStyle = body;
    cx.beginPath(); cx.arc(0, 0, t.r * 0.62, 0, TAU); cx.fill();
    cx.strokeStyle = dark; cx.lineWidth = 2; cx.stroke();
    cx.restore();

    // armor pickup shimmer
    if (t.armor) {
      cx.save();
      cx.strokeStyle = 'rgba(140,220,150,' + (0.5 + 0.3 * Math.sin(G.time * 8)) + ')';
      cx.lineWidth = 2.5;
      cx.beginPath(); cx.arc(t.x, t.y, t.r + 6, 0, TAU); cx.stroke();
      cx.restore();
    }
    // auto-target reticle on the lock
    if (t.isPlayer && t.autoT > 0 && t.autoLock && !t.autoLock.dead) {
      var L = t.autoLock;
      cx.save();
      cx.strokeStyle = '#f0a83c'; cx.lineWidth = 2;
      cx.translate(L.x, L.y); cx.rotate(G.time * 2);
      var rr = L.r + 9;
      for (var qq = 0; qq < 4; qq++) {
        cx.rotate(Math.PI / 2);
        cx.beginPath(); cx.arc(0, 0, rr, -0.4, 0.4); cx.stroke();
      }
      cx.restore();
    }
    // hp pip over damaged tanks
    if (t.hp < t.maxHp - 1) {
      var w2 = 26, p = t.hp / t.maxHp;
      cx.fillStyle = 'rgba(0,0,0,.55)';
      cx.fillRect(t.x - w2 / 2, t.y - t.r - 12, w2, 4);
      cx.fillStyle = p > 0.5 ? '#7cc97f' : (p > 0.25 ? '#f0a83c' : '#c8452c');
      cx.fillRect(t.x - w2 / 2, t.y - t.r - 12, w2 * p, 4);
    }
  }

  function drawTurret(tu) {
    cx.save();
    cx.translate(tu.x, tu.y);
    cx.fillStyle = 'rgba(0,0,0,.3)';
    cx.beginPath(); cx.ellipse(2, 3, tu.r + 3, tu.r, 0, 0, TAU); cx.fill();
    // fixed concrete emplacement base
    cx.fillStyle = '#5a5a52';
    cx.beginPath(); cx.arc(0, 0, tu.r, 0, TAU); cx.fill();
    cx.strokeStyle = '#2c2c26'; cx.lineWidth = 2.4;
    cx.beginPath(); cx.arc(0, 0, tu.r, 0, TAU); cx.stroke();
    for (var sb = 0; sb < 8; sb++) {
      var sa = sb / 8 * TAU;
      cx.fillStyle = 'rgba(0,0,0,.22)';
      cx.beginPath(); cx.arc(Math.cos(sa) * tu.r * 0.68, Math.sin(sa) * tu.r * 0.68, 2.4, 0, TAU); cx.fill();
    }
    // rotating gun
    cx.rotate(tu.turret);
    cx.fillStyle = '#3a3a32';
    cx.fillRect(tu.r * 0.1, -2.8, tu.r + 10, 5.6);
    cx.fillStyle = '#6d6d62';
    cx.beginPath(); cx.arc(0, 0, tu.r * 0.5, 0, TAU); cx.fill();
    cx.strokeStyle = '#232320'; cx.lineWidth = 2; cx.stroke();
    cx.restore();
    if (tu.hp < tu.maxHp - 1) {
      var w3 = 26, p2 = tu.hp / tu.maxHp;
      cx.fillStyle = 'rgba(0,0,0,.55)';
      cx.fillRect(tu.x - w3 / 2, tu.y - tu.r - 12, w3, 4);
      cx.fillStyle = p2 > 0.5 ? '#7cc97f' : (p2 > 0.25 ? '#f0a83c' : '#c8452c');
      cx.fillRect(tu.x - w3 / 2, tu.y - tu.r - 12, w3 * p2, 4);
    }
  }

  function drawMine(mn, isPlayerView) {
    cx.save();
    cx.translate(mn.x, mn.y);
    var blink = mn.beeping ? (Math.sin(G.time * 18) > 0) : false;
    cx.fillStyle = '#2c2f28';
    cx.beginPath(); cx.arc(0, 0, mn.r, 0, TAU); cx.fill();
    cx.strokeStyle = '#565d52'; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(0, 0, mn.r, 0, TAU); cx.stroke();
    for (var s = 0; s < 5; s++) {
      var a2 = s / 5 * TAU + 0.4;
      cx.fillStyle = '#565d52';
      cx.fillRect(Math.cos(a2) * mn.r - 1.4, Math.sin(a2) * mn.r - 1.4, 2.8, 2.8);
    }
    cx.fillStyle = blink ? '#ff5540' : (mn.armT > 0 ? '#f0a83c' : '#c8452c');
    cx.beginPath(); cx.arc(0, 0, 2.6, 0, TAU); cx.fill();
    if (mn.beeping) {
      cx.fillStyle = '#ffd9a0';
      cx.font = 'bold 9px monospace'; cx.textAlign = 'center';
      cx.fillText(Math.ceil(mn.beepT), 0, -mn.r - 3);
    }
    cx.restore();
  }

  function drawItem(it) {
    var bob = Math.sin(it.bob) * 2.4;
    cx.save();
    cx.translate(it.x, it.y + bob);
    cx.fillStyle = 'rgba(0,0,0,.28)';
    cx.beginPath(); cx.ellipse(0, 10 - bob, 12, 4.5, 0, 0, TAU); cx.fill();
    cx.fillStyle = '#8a6d3b';
    cx.fillRect(-11, -11, 22, 22);
    cx.strokeStyle = '#4f3c1c'; cx.lineWidth = 2;
    cx.strokeRect(-11, -11, 22, 22);
    cx.beginPath(); cx.moveTo(-11, 0); cx.lineTo(11, 0); cx.moveTo(0, -11); cx.lineTo(0, 11); cx.stroke();
    cx.fillStyle = '#ffe9b8';
    cx.font = 'bold 13px monospace'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(it.type.sym, 0, 1);
    cx.restore();
  }

  function drawFx() {
    for (var i = 0; i < G.fx.length; i++) {
      var e = G.fx[i], k = e.life / e.max;
      if (e.type === 'boom') {
        cx.save();
        cx.globalAlpha = Math.max(0, k);
        var rr = e.r * (1.2 - k * 0.6);
        var g = cx.createRadialGradient(e.x, e.y, 2, e.x, e.y, rr);
        g.addColorStop(0, 'rgba(255,240,190,.95)');
        g.addColorStop(0.45, 'rgba(240,140,50,.8)');
        g.addColorStop(1, 'rgba(60,40,20,0)');
        cx.fillStyle = g;
        cx.beginPath(); cx.arc(e.x, e.y, rr, 0, TAU); cx.fill();
        cx.restore();
      } else if (e.type === 'p') {
        cx.globalAlpha = Math.max(0, k);
        cx.fillStyle = e.col;
        cx.fillRect(e.x - e.sz / 2, e.y - e.sz / 2, e.sz, e.sz);
        cx.globalAlpha = 1;
      } else if (e.type === 'muz') {
        cx.save();
        cx.translate(e.x, e.y); cx.rotate(e.a);
        cx.fillStyle = 'rgba(255,220,140,' + (k * 0.95) + ')';
        cx.beginPath();
        cx.moveTo(0, -4 * e.s); cx.lineTo(14 * e.s, 0); cx.lineTo(0, 4 * e.s);
        cx.closePath(); cx.fill();
        cx.restore();
      } else if (e.type === 'spark') {
        cx.fillStyle = 'rgba(255,230,150,' + k + ')';
        cx.fillRect(e.x - 2, e.y - 2, 4, 4);
      } else if (e.type === 'hit') {
        cx.strokeStyle = 'rgba(255,120,80,' + k + ')';
        cx.lineWidth = 2;
        cx.beginPath(); cx.arc(e.x, e.y, 18 * (1.4 - k), 0, TAU); cx.stroke();
      } else if (e.type === 'wreck') {
        cx.save();
        cx.translate(e.x, e.y); cx.rotate(e.a);
        cx.globalAlpha = 0.8;
        cx.fillStyle = '#2a2b28';
        cx.fillRect(-13, -10, 26, 20);
        cx.fillStyle = '#151613';
        cx.fillRect(-6, -5, 12, 10);
        cx.restore();
        cx.globalAlpha = 1;
        if (((G.time * 6) | 0) % 2 === 0) {
          cx.fillStyle = 'rgba(120,120,120,.35)';
          cx.beginPath(); cx.arc(e.x + Math.sin(G.time * 3) * 3, e.y - 14, 6, 0, TAU); cx.fill();
        }
      } else if (e.type === 'rubble') {
        cx.fillStyle = 'rgba(120,112,100,.5)';
        for (var rb = 0; rb < 6; rb++) {
          var rx = e.x + Math.sin(rb * 37 + e.y) * e.w * 0.4;
          var ry2 = e.y + Math.cos(rb * 53 + e.x) * e.h * 0.4;
          cx.fillRect(rx - 3, ry2 - 2, 6, 4);
        }
      }
    }
    // napalm patches
    for (var f2 = 0; f2 < G.firePatches.length; f2++) {
      var fp = G.firePatches[f2];
      var fk = Math.min(1, fp.life / 1.5);
      cx.save();
      cx.globalAlpha = 0.75 * fk;
      var fg = cx.createRadialGradient(fp.x, fp.y, 2, fp.x, fp.y, fp.r);
      fg.addColorStop(0, 'rgba(255,230,140,.95)');
      fg.addColorStop(0.5, 'rgba(235,110,40,.85)');
      fg.addColorStop(1, 'rgba(120,30,10,0)');
      cx.fillStyle = fg;
      cx.beginPath(); cx.arc(fp.x, fp.y, fp.r * (0.92 + 0.08 * Math.sin(G.time * 11 + fp.x)), 0, TAU); cx.fill();
      cx.restore();
    }
    for (var s2 = 0; s2 < G.strafes.length; s2++) {
      var st2 = G.strafes[s2];
      cx.fillStyle = 'rgba(255,240,180,' + (st2.life / 0.2) + ')';
      cx.fillRect(st2.x - 2, st2.y - 2, 4, 4);
    }
    for (var b2 = 0; b2 < G.bombs.length; b2++) {
      var bo = G.bombs[b2];
      cx.fillStyle = '#20231e';
      cx.beginPath(); cx.ellipse(bo.x, bo.y, 5, 8, 0, 0, TAU); cx.fill();
      cx.strokeStyle = 'rgba(0,0,0,.35)';
      cx.beginPath(); cx.arc(bo.x, bo.y, 10 + bo.t * 40, 0, TAU); cx.stroke();
    }
  }

  function drawCompass() {
    var pl = G.player;
    if (pl.dead) return;
    var target, col;
    if (pl.carrying) { target = G.pads.P; col = '#7cc97f'; }
    else { var f = G.flags.E; target = f; col = '#f0a83c'; }
    var a = Math.atan2(target.y - pl.y, target.x - pl.x);
    var d = Math.sqrt(dist2(pl.x, pl.y, target.x, target.y));
    if (d < 90) return;
    cx.save();
    cx.translate(pl.x + Math.cos(a) * 44, pl.y + Math.sin(a) * 44);
    cx.rotate(a);
    cx.globalAlpha = 0.85 + 0.15 * Math.sin(G.time * 5);
    cx.fillStyle = col;
    cx.beginPath();
    cx.moveTo(10, 0); cx.lineTo(-6, -6); cx.lineTo(-2, 0); cx.lineTo(-6, 6);
    cx.closePath(); cx.fill();
    cx.restore();
  }

  function drawPlane() {
    var p = G.plane;
    if (!p) return;
    // shadow on the ground
    cx.fillStyle = 'rgba(0,0,0,.25)';
    cx.beginPath(); cx.ellipse(p.x - 16, p.y + 34, 26, 8, 0, 0, TAU); cx.fill();
    cx.save();
    cx.translate(p.x, p.y);
    cx.fillStyle = '#5a6b52';
    cx.beginPath();                              // fuselage
    cx.moveTo(26, 0); cx.lineTo(-18, -5); cx.lineTo(-18, 5);
    cx.closePath(); cx.fill();
    cx.fillRect(-6, -22, 10, 44);                // wings
    cx.fillRect(-20, -8, 5, 16);                 // tail
    cx.fillStyle = '#3a4634';
    cx.fillRect(4, -3, 10, 6);
    cx.restore();
  }

  function draw() {
    var m = G.maze;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = '#0b0e0a';
    cx.fillRect(0, 0, cv.width, cv.height);
    if (!m) return;

    var cam = camera();
    var shx = (Math.random() - 0.5) * G.shake, shy = (Math.random() - 0.5) * G.shake;
    cx.setTransform(cam.scale, 0, 0, cam.scale, -(cam.x + shx) * cam.scale, -(cam.y + shy) * cam.scale);

    cx.drawImage(G.terrainBase, 0, 0);

    // river shimmer
    if (G.theme.river) {
      var ry = m.riverRow * m.CELL;
      cx.fillStyle = 'rgba(255,255,255,.12)';
      for (var sh2 = 0; sh2 < 7; sh2++) {
        var sxp = ((G.time * 26 + sh2 * 217) % (m.worldW + 60)) - 30;
        cx.fillRect(sxp, ry + 10 + (sh2 * 13) % (m.CELL - 20), 18, 2);
      }
    }

    // track marks
    for (var t2 = 0; t2 < G.tracks.length; t2++) {
      var tk2 = G.tracks[t2];
      cx.save();
      cx.translate(tk2.x, tk2.y); cx.rotate(tk2.a);
      cx.globalAlpha = Math.min(0.28, tk2.life * 0.09);
      cx.fillStyle = '#000';
      cx.fillRect(-2, -13, 4, 5); cx.fillRect(-2, 8, 4, 5);
      cx.restore();
    }
    cx.globalAlpha = 1;

    // mines — deployed charges stay visible on the field
    for (var mi2 = 0; mi2 < G.mines.length; mi2++) drawMine(G.mines[mi2]);

    // flags under tanks
    drawFlag(G.flags.P, false);
    drawFlag(G.flags.E, true);

    drawWalls(cam);
    drawDoors(cam);

    for (var it2 = 0; it2 < G.items.length; it2++) drawItem(G.items[it2]);

    for (var tu4 = 0; tu4 < G.turrets.length; tu4++) {
      if (!G.turrets[tu4].dead) drawTurret(G.turrets[tu4]);
    }

    // tanks (tunnel-hidden ones are skipped; roofs go on top anyway)
    for (var tk3 = 0; tk3 < G.tanks.length; tk3++) {
      var tt = G.tanks[tk3];
      if (tt.dead || tt.hidden) continue;
      drawTank(tt, false);
    }

    // projectiles
    for (var sh3 = 0; sh3 < G.shells.length; sh3++) {
      var s3 = G.shells[sh3];
      cx.save();
      cx.translate(s3.x, s3.y); cx.rotate(Math.atan2(s3.vy, s3.vx));
      cx.fillStyle = '#ffd98f';
      cx.fillRect(-5, -2.2, 10, 4.4);
      cx.fillStyle = 'rgba(255,180,80,.4)';
      cx.fillRect(-14, -1.4, 8, 2.8);
      cx.restore();
    }

    drawFx();

    // tunnel roofs / bridge rails cover whoever is underneath
    cx.drawImage(G.terrainOver, 0, 0);

    // your own tank ghosts through the roof so you can still steer
    if (G.player.hidden && !G.player.dead) drawTank(G.player, true);

    drawPlane();
    drawCompass();
  }

  /* ============================ HUD ============================ */
  var hudT = 0;
  function updateHUD(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.1;
    var pl = G.player;
    var p = clamp(pl.hp / pl.maxHp, 0, 1);
    var hf = $('hpFill');
    hf.style.width = (p * 100).toFixed(1) + '%';
    hf.className = p < 0.25 ? 'crit' : (p < 0.5 ? 'low' : '');
    $('hudLevel').textContent = 'LV ' + G.level + ' · ' + G.diff.name;
    $('hudTerrain').textContent = G.theme.name;
    $('scoreYou').textContent = '\u2691 ' + G.playerCaps + '/' + G.capsNeeded;
    $('scoreFoe').textContent = '\u2691 ' + G.enemyCaps + '/' + G.diff.allowed;

    var chips = [];
    if (pl.autoT > 0) chips.push('<span class="item-chip">\u25CE ' + pl.autoT.toFixed(0) + 's</span>');
    if (pl.armor) chips.push('<span class="item-chip shield">\u26E8 ' + pl.armor.name +
      (pl.armor.started ? ' ' + pl.armor.remain.toFixed(1) + 's' : ' ARMED') + '</span>');
    if (G.plane) chips.push('<span class="item-chip">\u2708 INBOUND</span>');
    $('itemRow').innerHTML = chips.join('');

    drawMineHud($('mineHud'));
  }

  /* mine inventory widget: overlapping discs, every 5 collapse into an ammo box,
     deployed mines trail behind as outlines until they detonate */
  function drawMineHud(canvas) {
    if (!canvas) return;
    var c = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    var pl = G.player;
    var x = 6, mid = H / 2;
    var boxes = (pl.minesInv / 5) | 0, rem = pl.minesInv % 5;
    for (var b = 0; b < boxes; b++) {                      // ammo boxes
      c.fillStyle = '#6d5836';
      c.fillRect(x, mid - 8, 18, 16);
      c.strokeStyle = '#3d2f18'; c.lineWidth = 1.6;
      c.strokeRect(x, mid - 8, 18, 16);
      c.beginPath(); c.moveTo(x, mid); c.lineTo(x + 18, mid); c.stroke();
      c.fillStyle = '#e6e0cf'; c.font = 'bold 8px monospace'; c.textAlign = 'center';
      c.fillText('5', x + 9, mid - 1.5);
      x += 23;
    }
    for (var d = 0; d < rem; d++) {                        // loose discs, overlapping
      c.fillStyle = '#2c2f28';
      c.beginPath(); c.arc(x + 7, mid, 7, 0, TAU); c.fill();
      c.strokeStyle = '#7d857a'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x + 7, mid, 7, 0, TAU); c.stroke();
      c.fillStyle = '#c8452c';
      c.beginPath(); c.arc(x + 7, mid, 1.8, 0, TAU); c.fill();
      x += 9;
    }
    x += 8;
    var deployed = 0;
    for (var i = 0; i < G.mines.length; i++) if (!G.mines[i].dead && G.mines[i].owner === pl) deployed++;
    for (var o = 0; o < deployed; o++) {                   // outlines = live on the field
      c.strokeStyle = 'rgba(240,168,60,.85)'; c.lineWidth = 1.4;
      c.setLineDash([2.5, 2.5]);
      c.beginPath(); c.arc(x + 6, mid, 6, 0, TAU); c.stroke();
      c.setLineDash([]);
      x += 10;
    }
  }

  /* FIRE button: reload shown as a fill rising bottom-to-top,
     re-revealing the shell icon as it completes */
  function shellIcon(c, W, H, col) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3;
    var cxp = W / 2, top = H * 0.2, bot = H * 0.76, w = W * 0.16;
    c.beginPath();
    c.moveTo(cxp - w, bot);
    c.lineTo(cxp - w, top + 12);
    c.quadraticCurveTo(cxp - w, top, cxp, top - 2);
    c.quadraticCurveTo(cxp + w, top, cxp + w, top + 12);
    c.lineTo(cxp + w, bot);
    c.closePath();
    c.fill();
    c.fillRect(cxp - w - 4, bot, (w + 4) * 2, 5);
  }
  function drawFireBtn() {
    var el = document.querySelector('#btnFire canvas');
    if (!el) return;
    var c = el.getContext('2d');
    var W = el.width, H = el.height;
    c.clearRect(0, 0, W, H);
    var pl = G.player;
    var prog = pl ? 1 - clamp(pl.reloadT / pl.reload, 0, 1) : 1;
    shellIcon(c, W, H, 'rgba(230,224,207,.22)');           // ghost icon
    c.save();
    c.beginPath();
    c.rect(0, H * (1 - prog), W, H * prog);                // rising fill window
    c.clip();
    c.fillStyle = 'rgba(240,168,60,.16)';
    c.fillRect(0, H * (1 - prog), W, H * prog);
    shellIcon(c, W, H, prog >= 1 ? '#ffd27a' : '#c89552');
    c.restore();
    if (prog >= 1) {
      c.strokeStyle = 'rgba(255,210,122,.65)'; c.lineWidth = 2;
      c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 5, 0, TAU); c.stroke();
    }
  }
  var touchHudT = 0;
  function updateTouchHud(dt) {
    if (!INPUT.isTouch()) return;
    touchHudT -= dt;
    if (touchHudT > 0) return;
    touchHudT = 0.08;
    drawFireBtn();
    drawMineHud(document.querySelector('#btnMine canvas'));
  }

  /* ============================ OVERLAY WIRING ============================ */
  var diffBtns = document.querySelectorAll('.diff');
  diffBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      diffBtns.forEach(function (o) { o.classList.remove('sel'); });
      b.classList.add('sel');
      G.diffIx = parseInt(b.dataset.d, 10);
      G.diff = DIFFS[G.diffIx];
      AU.ensure(); AU.pickup();
    });
  });
  $('btnStart').addEventListener('click', startGame);
  $('btnNext').addEventListener('click', nextLevel);
  $('btnRetry').addEventListener('click', function () {
    $('screenOver').classList.add('hidden');
    $('screenMenu').classList.remove('hidden');
  });

  /* ============================ MAIN LOOP ============================ */
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (G.state === 'play' || G.state === 'level' || G.state === 'over') {
      update(dt);
      draw();
      updateHUD(dt);
      updateTouchHud(dt);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
