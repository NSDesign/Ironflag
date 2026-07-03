'use strict';
/* maze.js — procedural maze: recursive backtracker + braiding, wall rects,
   river / bridge / tunnel carving (forest), weak walls, weighted BFS pathfinding.
   DOM-free so it can be smoke-tested headlessly. */

var MAZE = (function () {

  var CELL = 64;          // world pixels per cell
  var WALL_T = 12;        // wall thickness

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* opts: { cols, rows, seed, braid (0..1), weakProb, river:boolean } */
  function generate(opts) {
    var cols = opts.cols, rows = opts.rows;
    var rng = mulberry32(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
    var braid = opts.braid == null ? 0.3 : opts.braid;
    var weakProb = opts.weakProb == null ? 0.12 : opts.weakProb;

    var cells = new Array(cols * rows);
    for (var y = 0; y < rows; y++)
      for (var x = 0; x < cols; x++)
        cells[y * cols + x] = { x: x, y: y, visited: false, water: false, bridge: false, tunnel: false };

    function cell(x, y) { return cells[y * cols + x]; }
    function inB(x, y) { return x >= 0 && y >= 0 && x < cols && y < rows; }

    /* Walls. V[x][y] = vertical wall on the WEST edge of cell (x,y), x in 0..cols.
       H[y][x] = horizontal wall on the NORTH edge of cell (x,y), y in 0..rows. */
    var V = [], H = [];
    for (var vx = 0; vx <= cols; vx++) {
      V[vx] = [];
      for (var vy = 0; vy < rows; vy++)
        V[vx][vy] = { alive: true, weak: false, hp: 0, maxHp: 0, vert: true, gx: vx, gy: vy,
                      boundary: (vx === 0 || vx === cols) };
    }
    for (var hy = 0; hy <= rows; hy++) {
      H[hy] = [];
      for (var hx = 0; hx < cols; hx++)
        H[hy][hx] = { alive: true, weak: false, hp: 0, maxHp: 0, vert: false, gx: hx, gy: hy,
                      boundary: (hy === 0 || hy === rows) };
    }

    /* wall between two orthogonally adjacent cells */
    function wallBetween(x1, y1, x2, y2) {
      if (x2 === x1 + 1) return V[x2][y1];
      if (x2 === x1 - 1) return V[x1][y1];
      if (y2 === y1 + 1) return H[y2][x1];
      if (y2 === y1 - 1) return H[y1][x1];
      return null;
    }

    /* ---- carve: iterative recursive backtracker starting at bottom-left ---- */
    var stack = [cell(0, rows - 1)];
    cell(0, rows - 1).visited = true;
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (stack.length) {
      var c = stack[stack.length - 1];
      var opts2 = [];
      for (var d = 0; d < 4; d++) {
        var nx = c.x + DIRS[d][0], ny = c.y + DIRS[d][1];
        if (inB(nx, ny) && !cell(nx, ny).visited) opts2.push([nx, ny]);
      }
      if (!opts2.length) { stack.pop(); continue; }
      var pick = opts2[(rng() * opts2.length) | 0];
      wallBetween(c.x, c.y, pick[0], pick[1]).alive = false;
      var nc = cell(pick[0], pick[1]);
      nc.visited = true;
      stack.push(nc);
    }

    /* ---- braid: knock a wall off dead-ends to create loops ---- */
    for (var by = 0; by < rows; by++) {
      for (var bx = 0; bx < cols; bx++) {
        var open = 0, closedN = [];
        for (var bd = 0; bd < 4; bd++) {
          var mx = bx + DIRS[bd][0], my = by + DIRS[bd][1];
          if (!inB(mx, my)) continue;
          var w = wallBetween(bx, by, mx, my);
          if (w.alive) closedN.push(w); else open++;
        }
        if (open <= 1 && closedN.length && rng() < braid)
          closedN[(rng() * closedN.length) | 0].alive = false;
      }
    }

    /* ---- river (forest): one horizontal band of water, 2 bridges + 1 tunnel ---- */
    var riverRow = -1, bridges = [], tunnelCol = -1;
    if (opts.river) {
      riverRow = (rows / 2) | 0;
      for (var rx = 0; rx < cols; rx++) {
        cell(rx, riverRow).water = true;
        H[riverRow][rx].alive = false;         // open both banks — water itself blocks
        H[riverRow + 1][rx].alive = false;
        if (rx > 0) V[rx][riverRow].alive = false; // open span inside the river
      }
      // pick 2 bridge columns and 1 tunnel column, well separated
      var picks = [], guard = 0;
      while (picks.length < 3 && guard++ < 400) {
        var pc = 1 + ((rng() * (cols - 2)) | 0);
        var okp = true;
        for (var pi = 0; pi < picks.length; pi++) if (Math.abs(picks[pi] - pc) < 3) okp = false;
        if (okp) picks.push(pc);
      }
      while (picks.length < 3) picks.push(1 + picks.length * 3);
      bridges = [picks[0], picks[1]];
      tunnelCol = picks[2];
      cell(bridges[0], riverRow).bridge = true;
      cell(bridges[1], riverRow).bridge = true;
      var tc = cell(tunnelCol, riverRow);
      tc.tunnel = true;
      // funnel walls beside crossings so they read as narrow spans
      for (var ci = 0; ci < 3; ci++) {
        var cc = picks[ci];
        V[cc][riverRow].alive = true; V[cc][riverRow].weak = false;
        if (cc + 1 <= cols) { V[cc + 1][riverRow].alive = true; V[cc + 1][riverRow].weak = false; }
      }
    }

    /* ---- connectivity repair ----
       Severing a whole row into water can strand pockets whose only tree
       connection ran through that row. Flood-fill from a passable cell and
       knock a wall through to every unreached pocket until one region remains.
       Walls to water are never touched, so the crossing count is preserved. */
    (function repair() {
      function pass(x, y) { var c = cell(x, y); return !c.water || c.bridge || c.tunnel; }
      var seen = new Uint8Array(cols * rows), q = [];
      function flood() {
        while (q.length) {
          var id = q.pop(), x = id % cols, y = (id / cols) | 0;
          for (var d = 0; d < 4; d++) {
            var nx = x + DIRS[d][0], ny = y + DIRS[d][1];
            if (!inB(nx, ny) || seen[nx + ny * cols] || !pass(nx, ny)) continue;
            if (wallBetween(x, y, nx, ny).alive) continue;
            seen[nx + ny * cols] = 1; q.push(nx + ny * cols);
          }
        }
      }
      for (var sy = 0; sy < rows && !q.length; sy++)
        for (var sx = 0; sx < cols && !q.length; sx++)
          if (pass(sx, sy)) { seen[sx + sy * cols] = 1; q.push(sx + sy * cols); }
      flood();
      var changed = true;
      while (changed) {
        changed = false;
        for (var y2 = 0; y2 < rows && !changed; y2++) for (var x2 = 0; x2 < cols && !changed; x2++) {
          var id2 = x2 + y2 * cols;
          if (seen[id2] || !pass(x2, y2)) continue;
          for (var d2 = 0; d2 < 4; d2++) {
            var ax = x2 + DIRS[d2][0], ay = y2 + DIRS[d2][1];
            if (!inB(ax, ay) || !seen[ax + ay * cols] || !pass(ax, ay)) continue;
            wallBetween(x2, y2, ax, ay).alive = false;
            seen[id2] = 1; q.push(id2); flood(); changed = true; break;
          }
        }
      }
    })();

    /* ---- weak (destructible) walls on interior alive walls ---- */
    function maybeWeak(w) {
      if (w.boundary || !w.alive || w.weak) return;
      if (rng() < weakProb) {
        w.weak = true;
        w.maxHp = 1 + ((rng() * 3) | 0);   // 1..3 shell hits
        w.hp = w.maxHp;
      }
    }
    for (var wx = 1; wx < cols; wx++) for (var wy = 0; wy < rows; wy++) {
      if (opts.river && wy === riverRow) continue;
      maybeWeak(V[wx][wy]);
    }
    for (var wy2 = 1; wy2 < rows; wy2++) for (var wx2 = 0; wx2 < cols; wx2++) {
      if (opts.river && (wy2 === riverRow || wy2 === riverRow + 1)) continue;
      maybeWeak(H[wy2][wx2]);
    }

    /* ---- geometry helpers ---- */
    function wallRect(w) {
      if (w.vert)
        return { x: w.gx * CELL - WALL_T / 2, y: w.gy * CELL - WALL_T / 2, w: WALL_T, h: CELL + WALL_T };
      return { x: w.gx * CELL - WALL_T / 2, y: w.gy * CELL - WALL_T / 2, w: CELL + WALL_T, h: WALL_T };
    }

    var blockedHook = null;   // game.js can veto cells (dense wire, hedgehogs) for AI pathing
    function passable(x, y) {
      if (!inB(x, y)) return false;
      if (blockedHook && blockedHook(x, y)) return false;
      var c2 = cell(x, y);
      return !c2.water || c2.bridge || c2.tunnel;
    }

    /* walls near a world point (for cheap collision / LOS culling) */
    function nearWalls(px, py, out) {
      out = out || [];
      out.length = 0;
      var cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
      for (var ox = 0; ox <= 1; ox++) {
        var qx = cx + ox;
        if (qx < 0 || qx > cols) continue;
        for (var oy = -1; oy <= 1; oy++) {
          var qy = cy + oy;
          if (qy >= 0 && qy < rows && V[qx][qy].alive) out.push(V[qx][qy]);
        }
      }
      for (var oy2 = 0; oy2 <= 1; oy2++) {
        var ry = cy + oy2;
        if (ry < 0 || ry > rows) continue;
        for (var ox2 = -1; ox2 <= 1; ox2++) {
          var rx2 = cx + ox2;
          if (rx2 >= 0 && rx2 < cols && H[ry][rx2].alive) out.push(H[ry][rx2]);
        }
      }
      return out;
    }

    function allWalls() {
      var list = [];
      for (var ax = 0; ax <= cols; ax++) for (var ay = 0; ay < rows; ay++) if (V[ax][ay].alive) list.push(V[ax][ay]);
      for (var ay2 = 0; ay2 <= rows; ay2++) for (var ax2 = 0; ax2 < cols; ax2++) if (H[ay2][ax2].alive) list.push(H[ay2][ax2]);
      return list;
    }

    /* ---- weighted BFS / uniform-cost search.
       Crossing an alive weak wall costs extra (the AI can shell it open).
       Returns array of {x,y} cells, or null. ---- */
    var WEAK_COST = 8;
    function findPath(sx, sy, tx, ty, allowWeak) {
      if (!inB(sx, sy) || !inB(tx, ty)) return null;
      var N = cols * rows;
      var dist = new Float64Array(N); dist.fill(Infinity);
      var prev = new Int32Array(N); prev.fill(-1);
      var heap = [];
      function push(i, d) { heap.push([d, i]); var k = heap.length - 1;
        while (k > 0) { var p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break;
          var t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; } }
      function pop() { var top = heap[0], last = heap.pop();
        if (heap.length) { heap[0] = last; var k = 0;
          for (;;) { var l = k * 2 + 1, r = l + 1, m = k;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m; } }
        return top; }
      var s = sy * cols + sx, t2 = ty * cols + tx;
      dist[s] = 0; push(s, 0);
      while (heap.length) {
        var cur = pop(); var cd = cur[0], ci = cur[1];
        if (cd > dist[ci]) continue;
        if (ci === t2) break;
        var cx3 = ci % cols, cy3 = (ci / cols) | 0;
        for (var d3 = 0; d3 < 4; d3++) {
          var nx3 = cx3 + DIRS[d3][0], ny3 = cy3 + DIRS[d3][1];
          if (!passable(nx3, ny3)) continue;
          var w3 = wallBetween(cx3, cy3, nx3, ny3);
          var step = 1;
          if (w3.alive) {
            if (allowWeak && w3.weak) step = WEAK_COST; else continue;
          }
          var ni = ny3 * cols + nx3;
          if (cd + step < dist[ni]) { dist[ni] = cd + step; prev[ni] = ci; push(ni, cd + step); }
        }
      }
      if (dist[t2] === Infinity) return null;
      var path = [], at = t2;
      while (at !== -1) { path.push({ x: at % cols, y: (at / cols) | 0 }); at = prev[at]; }
      path.reverse();
      return path;
    }

    return {
      cols: cols, rows: rows, CELL: CELL, WALL_T: WALL_T,
      worldW: cols * CELL, worldH: rows * CELL,
      cells: cells, cell: cell, inB: inB,
      V: V, H: H,
      riverRow: riverRow, bridges: bridges, tunnelCol: tunnelCol,
      wallBetween: wallBetween, wallRect: wallRect,
      passable: passable, nearWalls: nearWalls, allWalls: allWalls,
      setBlockedHook: function (fn) { blockedHook = fn; },
      findPath: findPath,
      cellOf: function (px, py) { return { x: Math.floor(px / CELL), y: Math.floor(py / CELL) }; },
      center: function (cx, cy) { return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL }; },
      rng: rng
    };
  }

  return { generate: generate, CELL: CELL, WALL_T: WALL_T, mulberry32: mulberry32 };
})();

if (typeof module !== 'undefined') module.exports = MAZE;
