'use strict';
/* entities.js — Tank, Shell, Turret, Mine + collision & line-of-sight helpers.
   DOM-free. All world interaction goes through the `game` facade passed into
   update(): game.speedMulAt, game.solidRectsNear, game.hedgehogs, game.spawnFX ... */

var ENT = (function () {

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function angDiff(a, b) { var d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function circleRect(cx, cy, r, rc) {
    var nx = clamp(cx, rc.x, rc.x + rc.w), ny = clamp(cy, rc.y, rc.y + rc.h);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }
  function pointInRect(px, py, rc) {
    return px >= rc.x && px <= rc.x + rc.w && py >= rc.y && py <= rc.y + rc.h;
  }

  /* line of sight: sample the segment, blocked by alive walls + water is NOT
     blocking; tunnel roofs handled by the "hidden" flag on tanks. */
  function losClear(game, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return true;
    var steps = Math.ceil(len / 10);
    var scratch = losClear._s || (losClear._s = []);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var px = x1 + dx * t, py = y1 + dy * t;
      var walls = game.maze.nearWalls(px, py, scratch);
      for (var w = 0; w < walls.length; w++)
        if (pointInRect(px, py, game.maze.wallRect(walls[w]))) return false;
    }
    return true;
  }

  /* ============================ TANK ============================ */
  function Tank(o) {
    this.team = o.team;                 // 'P' or 'E'
    this.isPlayer = !!o.isPlayer;
    this.x = o.x; this.y = o.y;
    this.homeX = o.x; this.homeY = o.y;
    this.a = o.a || 0;                  // hull angle
    this.turret = this.a;               // turret angle
    this.r = 15;
    this.maxHp = o.maxHp || 100;
    this.hp = this.maxHp;
    this.baseSpeed = o.speed || 155;
    this.turnRate = o.turn || 3.0;
    this.reload = o.reload || 0.4;      // seconds per shell
    this.reloadT = 0;
    this.dmgMul = o.dmgMul || 1;
    this.dead = false;
    this.respawnT = 0;
    this.hidden = false;                // in the under-river tunnel
    this.carrying = null;               // flag ref
    this.lastHitAt = -99;
    this.regenDelay = 4;                // seconds without a hit before repair
    this.regenRate = 9;                 // hp / s
    this.vx = 0; this.vy = 0;           // measured velocity (for ram damage)
    this.speedNow = 0;
    // player extras
    this.minesCap = 6;
    this.minesInv = 6;
    this.mineRegenT = 0;
    this.armor = null;                  // {name,dur,started,remain}
    this.autoT = 0;                     // auto-target seconds remaining
    this.autoLock = null;               // current locked tank
    this.autoLockT = 0;
    this.ramCd = 0;
    this.tracksT = 0;
    this.ai = o.ai || null;
  }

  Tank.prototype.takeDamage = function (d, game, src) {
    if (this.dead) return;
    if (this.armor) {
      if (!this.armor.started) this.armor.started = true;
      d *= 0.3;                          // 70% off
    }
    this.hp -= d;
    this.lastHitAt = game.time;
    game.onTankHit(this, d, src);
    if (this.hp <= 0) { this.hp = 0; game.killTank(this, src); }
  };

  Tank.prototype.respawn = function () {
    this.dead = false;
    this.hp = this.maxHp;
    this.x = this.homeX; this.y = this.homeY;
    this.a = this.team === 'P' ? -Math.PI / 4 : (Math.PI * 3) / 4;
    this.turret = this.a;
    this.armor = null; this.autoT = 0; this.autoLock = null;
    this.reloadT = 0.4; this.hidden = false;
    this.vx = 0; this.vy = 0;
  };

  /* move with axis-separated sliding against walls, water and hedgehogs */
  Tank.prototype.moveWithCollision = function (game, dx, dy) {
    var m = game.maze, r = this.r;
    var scratch = this._sw || (this._sw = []);

    function blockedAt(px, py) {
      var walls = m.nearWalls(px, py, scratch);
      for (var i = 0; i < walls.length; i++)
        if (circleRect(px, py, r, m.wallRect(walls[i]))) return true;
      // water (non-bridge, non-tunnel) blocks tanks
      var C = m.CELL;
      var cx0 = Math.floor((px - r) / C), cx1 = Math.floor((px + r) / C);
      var cy0 = Math.floor((py - r) / C), cy1 = Math.floor((py + r) / C);
      for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
        if (!m.inB(cx, cy)) { return true; }
        var c = m.cell(cx, cy);
        if (c.water && !c.bridge && !c.tunnel) {
          if (circleRect(px, py, r * 0.8, { x: cx * C, y: cy * C, w: C, h: C })) return true;
        }
      }
      // hedgehogs — steel barricades stop tanks dead (shells pass between beams)
      var hh = game.hedgehogs;
      for (var h = 0; h < hh.length; h++) {
        var g = hh[h];
        if (dist2(px, py, g.x, g.y) < (r + g.r) * (r + g.r)) return true;
      }
      // trees — canopy is visual only; only the trunk blocks
      var trs = game.trees;
      for (var tr2 = 0; tr2 < trs.length; tr2++) {
        var tre = trs[tr2];
        if (dist2(px, py, tre.x, tre.y) < (r + tre.trunkR) * (r + tre.trunkR)) return true;
      }
      // stationary turrets — solid until destroyed
      var turs = game.turrets;
      for (var tu = 0; tu < turs.length; tu++) {
        var turret = turs[tu];
        if (turret.dead) continue;
        if (dist2(px, py, turret.x, turret.y) < (r + turret.r) * (r + turret.r)) return true;
      }
      return false;
    }

    if (!blockedAt(this.x + dx, this.y)) this.x += dx;
    if (!blockedAt(this.x, this.y + dy)) this.y += dy;
  };

  /* ctrl: { throttle:-1..1, steer:-1..1, fire:bool, mine:bool(edge),
             aim: absolute turret angle or null } */
  Tank.prototype.update = function (dt, game, ctrl) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.respawn(); game.onRespawn(this); }
      return;
    }

    var px = this.x, py = this.y;

    // terrain drag: mud / wire / sand
    var mul = game.speedMulAt(this.x, this.y);
    var spd = this.baseSpeed * mul;

    this.a += ctrl.steer * this.turnRate * dt * (ctrl.throttle < -0.05 ? 0.8 : 1);
    var fwd = ctrl.throttle * spd * (ctrl.throttle < 0 ? 0.62 : 1);
    var dx = Math.cos(this.a) * fwd * dt, dy = Math.sin(this.a) * fwd * dt;
    this.moveWithCollision(game, dx, dy);

    this.vx = (this.x - px) / dt; this.vy = (this.y - py) / dt;
    this.speedNow = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (this.speedNow > 20) {
      this.tracksT -= dt;
      if (this.tracksT <= 0) { this.tracksT = 0.09; game.addTrack(this); }
    }

    // tunnel concealment
    var c = game.maze.cellOf(this.x, this.y);
    this.hidden = game.maze.inB(c.x, c.y) && game.maze.cell(c.x, c.y).tunnel;

    // turret
    var want = this.a;
    if (ctrl.aim != null) want = ctrl.aim;
    if (this.isPlayer && this.autoT > 0) {
      this.autoT -= dt;
      this.autoLockT -= dt;
      if (!this.autoLock || this.autoLock.dead || this.autoLock.hidden || this.autoLockT <= 0 ||
          !losClear(game, this.x, this.y, this.autoLock.x, this.autoLock.y)) {
        this.autoLock = game.nearestVisibleEnemy(this);
        this.autoLockT = 2;             // 2 s per lock, re-acquiring for the item's 10 s
      }
      if (this.autoLock) want = Math.atan2(this.autoLock.y - this.y, this.autoLock.x - this.x);
      if (this.autoT <= 0) { this.autoLock = null; }
    }
    var td = angDiff(this.turret, want);
    var tspd = 6.5 * dt;
    this.turret += clamp(td, -tspd, tspd);

    // weapons
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.ramCd = Math.max(0, this.ramCd - dt);
    if (ctrl.fire && this.reloadT <= 0) {
      this.reloadT = this.reload;
      game.fireShell(this);
    }
    if (ctrl.mine) game.dropMine(this);

    // mine inventory trickle (player)
    if (this.isPlayer && this.minesInv < this.minesCap) {
      this.mineRegenT += dt;
      if (this.mineRegenT >= 9) { this.mineRegenT = 0; this.minesInv++; }
    }

    // armor timer only counts from the first hit taken
    if (this.armor && this.armor.started) {
      this.armor.remain -= dt;
      if (this.armor.remain <= 0) { this.armor = null; game.onArmorEnd(this); }
    }

    // self repair
    if (this.hp < this.maxHp && game.time - this.lastHitAt > this.regenDelay)
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
  };

  /* ============================ SHELL ============================ */
  function Shell(owner, game) {
    this.owner = owner; this.team = owner.team;
    var a = owner.turret;
    var mz = owner.r + 14;
    this.x = owner.x + Math.cos(a) * mz;
    this.y = owner.y + Math.sin(a) * mz;
    this.vx = Math.cos(a) * 470; this.vy = Math.sin(a) * 470;
    this.dmg = 25 * owner.dmgMul;
    this.splash = 58;
    this.dead = false;
    this.life = 3;
  }
  Shell.prototype.update = function (dt, game) {
    if (this.dead) return;
    this.life -= dt; if (this.life <= 0) { this.dead = true; return; }
    var steps = 3;
    var scratch = this._s || (this._s = []);
    for (var s = 0; s < steps && !this.dead; s++) {
      this.x += this.vx * dt / steps; this.y += this.vy * dt / steps;
      if (this.x < 0 || this.y < 0 || this.x > game.maze.worldW || this.y > game.maze.worldH) { this.dead = true; return; }
      // walls — weak walls take shell damage and crumble
      var walls = game.maze.nearWalls(this.x, this.y, scratch);
      for (var w = 0; w < walls.length; w++) {
        var wall = walls[w];
        if (pointInRect(this.x, this.y, game.maze.wallRect(wall))) {
          this.dead = true;
          game.shellHitsWall(this, wall);
          return;
        }
      }
      // tanks (not owner). Shells fly over wire + hedgehogs.
      var tanks = game.tanks;
      for (var t = 0; t < tanks.length; t++) {
        var tk = tanks[t];
        if (tk === this.owner || tk.dead) continue;
        if (dist2(this.x, this.y, tk.x, tk.y) < (tk.r + 4) * (tk.r + 4)) {
          this.dead = true;
          game.explode(this.x, this.y, this.splash, this.dmg, this.owner, tk);
          return;
        }
      }
      // stationary turrets
      var turs = game.turrets;
      for (var tu = 0; tu < turs.length; tu++) {
        var turret = turs[tu];
        if (turret === this.owner || turret.dead) continue;
        if (dist2(this.x, this.y, turret.x, turret.y) < (turret.r + 4) * (turret.r + 4)) {
          this.dead = true;
          game.explode(this.x, this.y, this.splash, this.dmg, this.owner, turret);
          return;
        }
      }
    }
  };

  /* ============================ TURRET ============================ */
  function Turret(o) {
    this.x = o.x; this.y = o.y;
    this.a = this.turret = o.a || 0;      // duck-types as a Shell owner
    this.r = o.r || 17;
    this.team = o.team;
    this.dmgMul = o.dmgMul || 1;
    this.maxHp = o.maxHp || 60;
    this.hp = this.maxHp;
    this.range = o.range || 480;
    this.reload = o.reload || 1.6;
    this.reloadT = 0.4;
    this.turnRate = o.turnRate || 3.2;    // slower slew than a tank turret (6.5 rad/s)
    this.dead = false;
    this.cellX = o.cellX; this.cellY = o.cellY;
  }
  Turret.prototype.takeDamage = function (d, game, src) {
    if (this.dead) return;
    this.hp -= d;
    if (this.hp <= 0) { this.hp = 0; game.killTurret(this, src); }
  };
  Turret.prototype.update = function (dt, game) {
    if (this.dead) return;
    this.reloadT = Math.max(0, this.reloadT - dt);
    var target = game.turretTarget(this);
    if (!target) return;
    var want = Math.atan2(target.y - this.y, target.x - this.x);
    var td = angDiff(this.turret, want);
    var tspd = this.turnRate * dt;
    this.turret += clamp(td, -tspd, tspd);
    this.a = this.turret;
    if (Math.abs(angDiff(this.turret, want)) < 0.1 && this.reloadT <= 0) {
      this.reloadT = this.reload;
      game.fireShell(this);
    }
  };

  /* ============================ MINE ============================ */
  function Mine(owner, x, y) {
    this.owner = owner; this.team = owner.team;
    this.x = x; this.y = y;
    this.r = 9;
    this.armT = 1.0;          // safe for 1 s so you can drive off it
    this.idleT = 60;          // after a minute idle...
    this.beepT = 10;          // ...beeps down 10 s then detonates
    this.beeping = false;
    this.beepTick = 0;
    this.dead = false;
    this.dmg = 45;
  }
  Mine.prototype.update = function (dt, game) {
    if (this.dead) return;
    if (this.armT > 0) { this.armT -= dt; return; }
    if (!this.beeping) {
      this.idleT -= dt;
      if (this.idleT <= 0) { this.beeping = true; game.mineBeep(this); }
    } else {
      this.beepT -= dt;
      this.beepTick -= dt;
      if (this.beepTick <= 0) {
        this.beepTick = Math.max(0.12, this.beepT / 10);
        game.mineBeep(this);
      }
      if (this.beepT <= 0) { this.detonate(game); return; }
    }
    var tanks = game.tanks;
    for (var t = 0; t < tanks.length; t++) {
      var tk = tanks[t];
      if (tk.dead) continue;
      if (dist2(this.x, this.y, tk.x, tk.y) < (tk.r + this.r) * (tk.r + this.r)) {
        this.detonate(game);
        return;
      }
    }
  };
  Mine.prototype.detonate = function (game) {
    if (this.dead) return;
    this.dead = true;
    game.explode(this.x, this.y, 64, this.dmg, this.owner, null);
    // chain detonation of nearby mines
    var mines = game.mines;
    for (var i = 0; i < mines.length; i++) {
      var m = mines[i];
      if (!m.dead && m !== this && dist2(this.x, this.y, m.x, m.y) < 70 * 70)
        m.armT = 0, m.beeping = true, m.beepT = Math.min(m.beepT, 0.12);
    }
  };

  return {
    Tank: Tank, Shell: Shell, Turret: Turret, Mine: Mine,
    losClear: losClear, circleRect: circleRect, pointInRect: pointInRect,
    clamp: clamp, angDiff: angDiff, dist2: dist2, TAU: TAU
  };
})();

if (typeof module !== 'undefined') module.exports = ENT;
