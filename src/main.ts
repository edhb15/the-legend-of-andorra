import "@fontsource/cinzel/400.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/cinzel-decorative/900.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "./ui/styles.css";
import { Vector3 } from "@babylonjs/core";
import { Game } from "./core/Game";
import { START_HOUR } from "./config";

async function boot(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const game = new Game(canvas);
  game.ui.showLoading();
  game.camera.mode = "orbit";
  game.camera.orbitCenter = new Vector3(0, 150, 0);
  game.camera.orbitRadius = 2400;
  game.camera.orbitHeight = 900;
  game.start();
  try {
    await game.init((f, label) => game.ui.setLoading(f, label));
  } catch (e) {
    console.error(e);
    game.ui.setLoading(1, "Something went wrong while building the world: " + (e as Error).message);
    return;
  }
  (window as any).__ready = true;

  let pendingLoad: string | null = null;
  let pendingNew = false;
  try {
    pendingLoad = sessionStorage.getItem("loa.pendingLoad");
    pendingNew = sessionStorage.getItem("loa.pendingNew") === "1";
    sessionStorage.removeItem("loa.pendingLoad");
    sessionStorage.removeItem("loa.pendingNew");
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams(location.search);
  if (params.has("autostart")) pendingNew = true;

  if (pendingLoad && game.save.load(pendingLoad)) {
    game.ui.hideTitle();
    startPlaying(game);
    return;
  }
  if (pendingNew) {
    game.ui.hideTitle();
    await newGame(game, !params.has("skipintro"));
    return;
  }
  // title screen: watch Andorra at dusk while the cloud gathers
  game.state = "title";
  game.time.minutes = 18.6 * 60;
  const action = await game.ui.showTitle();
  if (action === "new") await newGame(game, true);
  else if (action === "continue") {
    const slot = game.save.latestSlot();
    if (slot && game.save.load(slot)) startPlaying(game);
    else await newGame(game, true);
  } else if (action.startsWith("load:")) {
    if (game.save.load(action.slice(5))) startPlaying(game);
    else await newGame(game, true);
  }
}

async function newGame(game: Game, intro: boolean): Promise<void> {
  game.save.started = true;
  game.time.minutes = START_HOUR * 60;
  game.time.deserialize({ minutes: START_HOUR * 60 });
  game.inventory.reset();
  game.player.maxHp = 100;
  game.player.hp = 100;
  game.player.maxStamina = 100;
  game.player.stamina = 100;
  game.player.weaponId = "traveler_sword";
  game.player.buildRig();
  game.quests.newGame();
  const home = game.world.homeVillage();
  const x = home.waystone.x + 3, z = home.waystone.z + 4;
  game.player.teleport(x, game.physics.groundHeight(x, z, 1e5), z, Math.atan2(home.x - x, home.z - z));
  game.discovered.add(home.id);
  game.discovered.add("waystone_" + home.id);
  game.evolution.refreshNow();
  game.camera.mode = "follow";
  game.camera.snapBehindPlayer();
  if (intro) {
    game.state = "playing";
    await game.cinematics.intro();
  } else {
    game.state = "playing";
    game.ui.bigTitle("DAY 1", "14 days remain", "#e8c66a");
  }
  game.ui.toast("Speak with Elder Joan by the waystone (press E near her)", "info");
  game.ui.toast("Click the screen to capture the mouse · Esc for menu", "info");
  game.save.autosave("start");
}

function startPlaying(game: Game): void {
  game.camera.mode = "follow";
  game.camera.snapBehindPlayer();
  game.state = "playing";
  game.evolution.refreshNow();
  game.ui.toast("Adventure resumed. Click the screen to capture the mouse.", "info");
}

boot();
