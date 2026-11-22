# THE LEGEND OF ANDORRA

An open-world 3D fantasy adventure set on the **real terrain of Andorra**, built with **Babylon.js** and TypeScript.

Zorg, Lord of the Dark Side, has returned to his cave beneath **Comapedrosa** and unleashed a poisonous cloud that is swallowing Andorra from its borders inward. In **exactly 14 in‑game days** the whole country will be consumed. Defeat five guardian monsters, claim their magical shards, find the legendary sword maker, forge **the Rainbow Sword**, and end Zorg forever.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. For a production build:

```bash
npm run build
npm run preview
```

The build output in `dist/` is a static site; host it anywhere.

## MapTiler 3D terrain (configurable key)

The world is built from MapTiler's quantized‑mesh terrain
(`https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/tiles.json?key=…`). Provide your key in any of these ways:

1. **In game:** Title screen → Settings → *MapTiler 3D terrain* → API key (stored in `localStorage`, applied on next launch).
2. **URL:** `http://localhost:5173/?maptilerKey=YOUR_KEY`
3. **Build time:** copy `.env.example` to `.env.local` and set `VITE_MAPTILER_KEY=YOUR_KEY`.

MapTiler keys are visible to anyone who plays a web game, so restrict yours to your site's address (for example `edhb15.github.io`) under *Allowed HTTP origins* in the MapTiler dashboard.

While MapTiler terrain is in use, the game shows MapTiler's logo and "© MapTiler © OpenStreetMap contributors" (with links) at the bottom of the screen, as MapTiler requires. The logo is loaded from MapTiler. With the bundled elevation model the credit is hidden, because none of MapTiler's data is on screen then.

The tiles are decoded in the browser (`src/world/terrain/QuantizedMesh.ts`) and rasterised into the game's heightfield. If no key is set, or MapTiler can't be reached, the game falls back to a bundled elevation model of Andorra (`public/data/andorra_dem.png`) so the real geography is always present. Force a source with `?terrain=offline` or `?terrain=maptiler`.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Camera (click the screen to capture the mouse, or drag with a button held) |
| Shift | Sprint |
| Space | Jump |
| Left click | Attack (combo); hold to charge a spin attack; click in mid‑air for a plunge |
| Right click | Block (time it for a parry that staggers enemies) |
| Q | Dodge roll (i‑frames) |
| E | Interact / talk / open |
| Tab, F or middle click | Lock on |
| H | Quick heal |
| 1–5 / R | Rainbow Sword abilities / Prismatic Nova ultimate |
| I / M / J | Inventory / Map / Quest log |
| Esc | Pause menu |

### Phones and tablets

Touch controls switch on by themselves on phones and tablets, and on a touchscreen laptop the moment you touch the screen. A mouse click switches back. You can also force them in Settings → *Touch controls* or with `?touch=1` / `?touch=0`.

| Touch | Action |
| --- | --- |
| Left side of the screen | Move: put your thumb down anywhere and drag (a light push walks) |
| Right side of the screen | Look around: drag |
| ⚔️ Attack | Tap for combos, hold for the spin attack, tap in mid-air to plunge |
| 🛡️ Block | Hold (time it to parry) |
| ⬆️ Jump · 💨 Dodge · 🎯 Lock · 🧪 Heal | Jump, dodge roll, lock on, quick heal (the badge shows your potions) |
| 🏃 Sprint | Switch running on; it switches off when you stop |
| 👆 Prompt | Tap the prompt to talk, open or use |
| Ability icons | Tap to cast the Rainbow Sword's powers |
| 🎒 🗺️ 📜 ☰ ⛶ | Inventory, map, quest log, menu, full screen |
| Map | Drag to pan, pinch to zoom, tap to place a marker, tap a marker to remove it |

Phones and tablets start on *Low* graphics. Landscape works best; in portrait the game suggests turning the device.

## What's in the game

- **Real Andorra.** Real elevation (≈25 m resolution, 1:5 horizontal scale with 1.4× vertical exaggeration), the real border polygon, rivers derived from flow accumulation on the real terrain (the Valira valleys appear on their own), and mountain lakes detected from the elevation data (Engolasters, Tristaina, Juclar…). Ten villages sit at their real coordinates: Ordino (home), La Massana, Andorra la Vella, Sant Julià de Lòria, Encamp, Canillo, Soldeu, Pas de la Casa, Arinsal and El Serrat. Roads are routed along the valleys with A*, with bridges where they cross rivers.
- **World.** Forests placed by altitude, slope and aspect (thin‑instanced, with LODs; trees shake and can be felled), grass that bends around the hero, boulders, stone villages with slate roofs, an inn, smithies, shops, chapels, quest boards and save waystones, the Fortress of Enclar, ruins, a watchtower, a waterfall hiding a treasure, the hidden forge, and caves (Flame cave, Frost cave, Zorg's cave, two hidden caves, the Vault of the Old Kings).
- **14‑day poison cloud.** Driven by a signed distance field from Andorra's real border. Coverage follows a fixed timetable (day 1: the borders; days 2–4: outer valleys; … day 14: everything). It's rendered as a raymarched volumetric post‑process that pools in the valleys, so you can watch it advance from the peaks. Ground, trees, grass and water inside it are corrupted. Standing in it causes escalating damage, a green screen effect, warnings, particles and a heartbeat. Guardian lairs and Ordino's waystone ward hold it back, and Purity Tonics, the Lantern of Purity and the Rainbow Sword reduce the damage.
- **Living villages.** Villagers sleep, work (smiths hammer, farmers hoe, merchants tend stalls), eat, chat and greet you. As the cloud approaches they grow worried, then frightened (barricades, packing, closing shops, higher prices), then evacuate to the refuge camp in Ordino. Abandoned villages burn and hold new treasure. Dialogue changes with the day and with the distance to the cloud.
- **Combat.** Three‑hit combos, charged spin attack, plunge attack, block and parry, dodge with i‑frames, lock‑on, hit‑stop, knockback, damage numbers, enemy health bars and status effects (burn, chill, root, shock). Enemies: goblins, goblin shamans, shadow wolves, skeletons, poison slimes, cave bats, fire and ice imps, Zorg's dark knights and thorn sprouts. They patrol, notice you, chase and attack, and grow more aggressive as darkness spreads.
- **Five bosses**, each with a cinematic intro, arena barrier, boss bar, three phases, telegraphed attacks and a shard reward that floats to you:
  - *The Flame Beast* (Red shard, fire cave): fireballs, eruptions, fire breath, charge, stomp, lava pools.
  - *The Forest Guardian* (Green shard, Elder Grove of Madriu): root traps, summoned thorn sprouts, punches, sweeps, spores.
  - *The Frost Dragon* (Blue shard, frozen hollow of l'Estanyó): ice breath, shard volleys, freezing ground, tail spin, flight, blizzard.
  - *The Shadow Knight* (White shard, Fortress of Enclar): sword combos, teleports, shadow waves, summoned soldiers.
  - *The Thunder Titan* (Yellow shard, Pessons summit): lightning strikes, jumpable shockwaves, punches, a storm that follows you, an electric aura.
- **The Rainbow Sword.** Find Mestre Ferran's hidden forge on the shoulder of Casamanya (look for the smoke) and watch the forging cinematic. It has five abilities (Flame Wave, Nature's Grace, Frost Nova, Light Beam, Chain Lightning) and a Prismatic Nova ultimate, deals extra damage to dark creatures, and is the only weapon that can pierce Zorg's Final Darkness.
- **Zorg.** A three‑phase final fight (Dark Lord → Poison Master → Final Darkness) deep in Comapedrosa, followed by the ending: the cloud dissolves, the sky clears, "ANDORRA HAS BEEN SAVED!", and the credits.
- **Death.** Slow motion, a fall, the camera circling the body, darkness and a red tint, **WASTED**, then a fade to black. You wake in Ordino and keep your items, shards, sword, quests and defeated bosses. The day doesn't reset and the cloud doesn't shrink.
- **Quests.** The main quest plus seven side quests: The Lost Shepherd, Treasure of the Old Kings (hidden lever and vault), Hold the Line at Canillo (wave defence), Lights of the Ancients (five spirit lanterns), Chronicle of the Shards (five lore steles), Herbs for the Sick and The Last Caravan. Some are only available on certain days and can fail.
- **Treasure.** Over 40 chests in four rarities with their own opening animations. Puzzles include rune order, timed braziers, a night‑only chest in a stone circle, camp‑locked chests and cairns you dig up. Glowing pebbles hint at hidden ones. Rewards include weapons, armour, potions, heart crystals, stamina vessels, magic objects, crafting materials and cosmetic capes and hats.
- **Map and navigation.** A parchment map generated from the real terrain, showing the poison front live, discovered places, rumoured lairs (?), quest objectives and your own markers, plus a minimap.
- **Day and night** with sunrise, sunsets, a moon and stars. The sky grows darker and more ominous each day.
- **Audio.** Procedural, generative music (village, exploration, night, cave, battle, boss, final boss phases, forge, death, ending) that darkens as the cloud spreads, plus ambience (wind by altitude, rivers, birds, crickets, cave drips) and synthesized sound effects.
- **Save / load.** Autosave plus three manual slots (save at waystones or from the pause menu). Waystones also offer fast travel, which costs in‑game time.

## Tests

```bash
npm test          # unit tests: quantized-mesh decoder round-trip, 14-day cloud timetable
npm run typecheck # strict TypeScript
```

## Settings

Quality (low/medium/high: shadows, post‑processing, vegetation distance, fog quality), volumes, touch controls (auto/on/off), look sensitivity, invert Y, and the **length of an in‑game day** (default 16 minutes, so 14 days ≈ 3.7 hours). URL helpers: `?quality=low|medium|high`, `?dayLength=8`, `?touch=1|0`, `?autostart&skipintro`, `?debug`.

## Code layout

```
src/
  core/        Game loop & wiring, input, events, math, noise
  world/       TerrainManager, terrain sources (MapTiler quantized mesh, offline DEM), material plugins,
               Hydrology, Water, Vegetation, Roads, Villages, Buildings, Interiors (caves), Environment (sky/sun/moon)
  entities/    PlayerController, CameraController, Humanoid rig, Enemy, bosses (5 guardians + Zorg), props
  systems/     CombatSystem, EnemyManager, BossManager, PoisonCloudSystem, TimeManager, WorldEvolutionSystem,
               NPCBehaviourSystem, DialogueSystem, QuestManager, InventorySystem, TreasureSystem, MagicWeaponSystem,
               CinematicManager, RespawnSystem, SaveSystem, AudioManager, InteractionSystem, Physics, Effects
  ui/          UIManager (HUD, menus, dialogue, inventory, shop), MapView, styles
  data/        Items, dialogue lines
```

## Data sources and attribution

- **Terrain (live):** © [MapTiler](https://www.maptiler.com/copyright/) © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Requires your own API key; the credit and logo are shown in game while it is used.
- **Terrain (offline fallback):** resampled from the open [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) dataset (Mapzen/Tilezen: SRTM, EU‑DEM © Copernicus and others).
- **Border of Andorra:** [Natural Earth](https://www.naturalearthdata.com/) 1:10m Admin‑0 (public domain).
- **Fonts:** Cinzel, Cinzel Decorative and EB Garamond (SIL Open Font License) via Fontsource.

Everything else (models, textures, animation, music and sound) is generated procedurally at runtime.
