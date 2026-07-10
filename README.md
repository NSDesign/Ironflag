# IRONFLAG

An aerial-view tank capture-the-flag game for the browser. Pure HTML/CSS/JavaScript on a single canvas — no dependencies, no build step.

**Play it:** https://nsdesign.github.io/Ironflag/

## The mission

Steal the red enemy flag from their base in the top-right corner and haul it back to your green pad in the bottom-left. The enemy is trying to do the same to you — if they capture your flag too many times (4 on Easy, 3 on Normal, 2 on Hard), you lose. After every capture the round resets: tanks respawn, the field is cleared, and the fight starts again.

Destroyed tanks respawn at their own base. A dropped flag returns home after 15 seconds untouched, or instantly when its own team touches it.

Levels cycle through three procedurally generated terrains, each with its own maze character:

| Terrain | Character |
|---|---|
| **CITY** | Tight streets and crumbling blocks. Barbed wire chokes the lanes; hedgehog barricades seal the rest. Shell the cracked walls open. |
| **FOREST** | A river splits the map — cross on a bridge, or vanish into the stone tunnel beneath it (tanks inside are hidden). Mud bogs halve your speed. |
| **DESERT** | Open, looping dune runs. Soft sand drags at your tracks, and the cracked adobe walls barely hold — almost every route can be blasted open. |

Every level brings more, faster, harder-hitting enemies. From level 4 onward you need **two** captures to clear a sector.

Sealed compound buildings sit near each base — yours slide open automatically as you approach, the enemy's are barricaded shut and need shelling open. Gun turrets guard the enemy base and forest maps are dotted with trees you can duck under (but not drive through the trunk).

## Controls

**Keyboard** — `WASD` / arrow keys to drive · `Space` fire missile · `E` drop a mine (max 4 armed at once).

**Touch** — left-thumb virtual joystick to drive; FIRE / MINE buttons on the right. The FIRE button's reload fills bottom-to-top, re-revealing the missile icon when ready. The MINE button shows your inventory as overlapping discs — every five collapse into an ammo box — with deployed mines trailing as outlines. The page locks out pull-to-refresh, overscroll and pinch/double-tap zoom.

## Weapons and damage

| Weapon | Damage | Notes |
|---|---|---|
| Ramming | up to 50 | Scales with closing speed; hurts both tanks |
| Mine | 45 | Arms after 1 s. Sits 60 s idle, then beeps for 10 s and self-detonates. Nearby mines chain. |
| Missile | 25 + splash | Fast reload, near-limitless fire; cracks weakened walls open in 1–3 hits |

Armor self-repairs a few seconds after the last hit. At zero, the tank explodes.

## Hazards

- **Mud / soft sand** — halves (or drags) your speed
- **Barbed wire** — slows you; dense coils nearly trap a tank. Projectiles fly over.
- **Czech hedgehogs** — stop tanks dead; projectiles pass through
- **Trees** (forest) — the leafy canopy is passable and covers whoever's underneath, but the trunk stops a tank dead. Shells pass through either way.
- **Weakened walls** — visibly cracked; crumble after 1–3 shell hits (the AI knows this too)
- **Gun turrets** — stationary emplacements defending the enemy base. They rotate and fire on sight within range, take shell damage, and leave their cell driveable once destroyed.

## Special items

Drive over supply crates to collect:

- **◎ Auto-target** — locks onto a visible enemy for 2 s per lock, 10 s total
- **⛨ Armor** — Steel / Composite / Reactive plating, 70% damage reduction for 3 / 4 / 5 s — the timer only starts at the **first hit** you take
- **✈ Air support** — a plane sweeps the enemy side with bombs, napalm, or a strafing run
- **+ Extra mines** — mine capacity +2, up to 12

## Running locally

It's static files — any web server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly with `file://` also works in most browsers, though the enemy-flag SVG may not load due to local file restrictions — the game falls back to a drawn flag.)

## Deploying to GitHub Pages

The repo ships with a workflow at `.github/workflows/deploy-pages.yml` that publishes the repository root to Pages on every push to `main`.

One-time setup after creating the repository:

1. Push the code to GitHub
2. In the repo: **Settings → Pages → Build and deployment → Source → GitHub Actions**
3. Push to `main` (or use the workflow's **Run workflow** button) — the site goes live at `https://<user>.github.io/<repo>/` and every future push redeploys it automatically

## Customizing the enemy flag

The enemy flag artwork lives at [`assets/enemy-flag.svg`](assets/enemy-flag.svg). Replace it with any image and the game scales it automatically.

## Project layout

```
index.html                       shell, HUD, touch controls, overlays
css/style.css                    stenciled military HUD styling
js/maze.js                       procedural maze generation + pathfinding
js/input.js                      keyboard, touch joystick, gesture lockout
js/entities.js                   tanks, shells, mines, turrets
js/game.js                       game state, AI, CTF rules, rendering, audio
assets/enemy-flag.svg            replaceable enemy flag artwork
.github/workflows/deploy-pages.yml   auto-deploy to GitHub Pages
```

## License

MIT — see [LICENSE](LICENSE).
