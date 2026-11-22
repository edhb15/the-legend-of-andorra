import { Engine, Scene, DefaultRenderingPipeline, GlowLayer, Vector3, ImageProcessingConfiguration, Color4 } from "@babylonjs/core";
import { loadSettings, saveSettings, Settings, DEBUG } from "../config";
import { EventBus } from "./EventBus";
import { Input } from "./Input";
import { TimeManager } from "../systems/TimeManager";
import { Environment } from "../world/Environment";
import { TerrainManager } from "../world/TerrainManager";
import { Hydrology } from "../world/Hydrology";
import { CollisionWorld } from "../systems/Physics";
import { WorldManager } from "../world/WorldManager";
import { PoisonCloudSystem } from "../systems/PoisonCloudSystem";
import { Effects } from "../systems/Effects";
import { AudioManager } from "../systems/AudioManager";
import { UIManager } from "../ui/UIManager";
import { CameraController } from "../entities/CameraController";
import { PlayerController } from "../entities/PlayerController";
import { CombatSystem } from "../systems/CombatSystem";
import { EnemyManager } from "../systems/EnemyManager";
import { BossManager } from "../systems/BossManager";
import { InventorySystem } from "../systems/InventorySystem";
import { QuestManager } from "../systems/QuestManager";
import { DialogueSystem } from "../systems/DialogueSystem";
import { NPCBehaviourSystem } from "../systems/NPCBehaviourSystem";
import { TreasureSystem } from "../systems/TreasureSystem";
import { WorldEvolutionSystem } from "../systems/WorldEvolutionSystem";
import { MagicWeaponSystem } from "../systems/MagicWeaponSystem";
import { RespawnSystem } from "../systems/RespawnSystem";
import { CinematicManager } from "../systems/CinematicManager";
import { InteriorManager } from "../world/Interiors";
import { SaveSystem } from "../systems/SaveSystem";
import { InteractionSystem } from "../systems/InteractionSystem";
import { tickRainbow } from "../entities/Props";
import { WorldShaderGlobals } from "../world/MaterialPlugins";

export type GameState = "loading" | "title" | "playing" | "paused" | "menu" | "dialogue" | "cinematic" | "dead" | "ending";

export class Game {
  engine: Engine;
  scene: Scene;
  settings: Settings;
  events = new EventBus();
  input: Input;
  time: TimeManager;
  env: Environment;
  terrain: TerrainManager;
  hydro: Hydrology;
  physics: CollisionWorld;
  world: WorldManager;
  poison: PoisonCloudSystem;
  fx: Effects;
  audio: AudioManager;
  ui: UIManager;
  camera: CameraController;
  player!: PlayerController;
  combat: CombatSystem;
  enemies: EnemyManager;
  bosses: BossManager;
  inventory: InventorySystem;
  quests: QuestManager;
  dialogue: DialogueSystem;
  npcs: NPCBehaviourSystem;
  treasure: TreasureSystem;
  evolution: WorldEvolutionSystem;
  magic: MagicWeaponSystem;
  respawn: RespawnSystem;
  cinematics: CinematicManager;
  interiors: InteriorManager;
  save: SaveSystem;
  interaction: InteractionSystem;
  pipeline: DefaultRenderingPipeline | null = null;
  glow: GlowLayer;
  state: GameState = "loading";
  /** Story flags (persisted). */
  flags: Record<string, any> = {};
  /** Locations the player has discovered (persisted). */
  discovered = new Set<string>();
  elapsed = 0;
  timeScale = 1;
  private hitStop = 0;
  terrainSource = "offline";
  terrainNote = "";
  victory = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 60;
  /** uncapped frame time (cinematics & UI run on real time) */
  realDt = 0.016;

  constructor(public canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, antialias: true, powerPreference: "high-performance" }, true);
    this.applyResolution();
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.02, 0.04, 1);
    this.scene.skipPointerMovePicking = true;
    this.scene.constantlyUpdateMeshUnderPointer = false;
    this.input = new Input(canvas);
    this.time = new TimeManager(this);
    this.env = new Environment(this.scene, this.settings.quality);
    this.terrain = new TerrainManager(this.scene);
    this.hydro = new Hydrology(this.terrain);
    this.physics = new CollisionWorld(this.terrain, this.hydro);
    this.fx = new Effects(this, this.scene);
    this.audio = new AudioManager(this);
    this.ui = new UIManager(this);
    this.camera = new CameraController(this);
    this.glow = new GlowLayer("glow", this.scene, { mainTextureRatio: 0.5, blurKernelSize: 32 });
    this.glow.intensity = 0.75;
    this.world = new WorldManager(this);
    this.poison = new PoisonCloudSystem(this);
    this.interiors = new InteriorManager(this);
    this.combat = new CombatSystem(this);
    this.enemies = new EnemyManager(this);
    this.bosses = new BossManager(this);
    this.inventory = new InventorySystem(this);
    this.quests = new QuestManager(this);
    this.dialogue = new DialogueSystem(this);
    this.npcs = new NPCBehaviourSystem(this);
    this.treasure = new TreasureSystem(this);
    this.evolution = new WorldEvolutionSystem(this);
    this.magic = new MagicWeaponSystem(this);
    this.respawn = new RespawnSystem(this);
    this.cinematics = new CinematicManager(this);
    this.save = new SaveSystem(this);
    this.interaction = new InteractionSystem(this);
    window.addEventListener("resize", () => this.engine.resize());
    (window as any).game = this;
  }

  applyResolution(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const q = this.settings.quality;
    const target = q === "high" ? dpr : q === "medium" ? Math.min(dpr, 1.25) : 1;
    this.engine.setHardwareScalingLevel((q === "low" ? 1.25 : 1) / target);
  }

  async init(progress: (f: number, label: string) => void): Promise<void> {
    await this.world.build(progress);
    progress(0.86, "Summoning the poison cloud…");
    this.poison.init();
    progress(0.88, "Carving the caves beneath the mountains…");
    this.interiors.init();
    progress(0.9, "Awakening the villagers…");
    this.player = new PlayerController(this);
    this.npcs.init();
    this.enemies.init();
    this.bosses.init();
    this.treasure.init();
    this.quests.init();
    this.evolution.init();
    this.magic.init();
    progress(0.95, "Tuning the light of the Pyrenees…");
    this.setupPipeline();
    this.ui.init();
    this.audio.init();
    progress(1, "Ready");
  }

  setupPipeline(): void {
    if (this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    const cam = this.camera.camera;
    const q = this.settings.quality;
    const p = new DefaultRenderingPipeline("pipeline", true, this.scene, [cam]);
    p.fxaaEnabled = true;
    p.bloomEnabled = q !== "low";
    p.bloomThreshold = 0.82;
    p.bloomWeight = 0.35;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.imageProcessingEnabled = true;
    p.imageProcessing.toneMappingEnabled = true;
    p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    p.imageProcessing.exposure = 1.3;
    p.imageProcessing.contrast = 1.12;
    p.imageProcessing.vignetteEnabled = true;
    p.imageProcessing.vignetteWeight = 1.6;
    p.imageProcessing.vignetteStretch = 0.3;
    p.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0);
    p.imageProcessing.colorCurvesEnabled = true;
    p.chromaticAberrationEnabled = false;
    p.samples = 1;
    this.pipeline = p;
    this.glow.isEnabled = q !== "low";
  }

  applySettings(): void {
    saveSettings(this.settings);
    this.applyResolution();
    this.env.setQuality(this.settings.quality);
    this.world.onQualityChanged();
    this.poison.onQualityChanged();
    this.setupPipeline();
    this.audio.applyVolumes();
    this.player?.refreshShadowCasting();
  }

  /** Brief freeze on heavy hits for impact. */
  addHitStop(s: number): void {
    this.hitStop = Math.max(this.hitStop, s);
  }

  isGameplayActive(): boolean {
    return this.state === "playing";
  }

  start(): void {
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const realDt = Math.min(0.5, (now - last) / 1000);
      let dt = Math.min(0.05, realDt);
      last = now;
      this.realDt = realDt;
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      try {
        this.frame(dt);
      } catch (e) {
        console.error("[Game] frame error", e);
      }
      this.scene.render();
      this.input.endFrame();
    });
  }

  private frame(rawDt: number): void {
    let dt = rawDt * this.timeScale;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt *= 0.05;
    }
    this.elapsed += dt;
    WorldShaderGlobals.time = this.elapsed;
    const playing = this.state === "playing";
    const simulating = playing || this.state === "cinematic" || this.state === "dead" || this.state === "dialogue" || this.state === "ending";
    this.input.enabled = playing;

    this.ui.handleGlobalInput();

    if (this.state !== "loading" && this.player) {
      if (playing) this.time.update(dt);
      if (simulating) {
        this.player.update(dt);
        this.combat.update(dt);
        this.enemies.update(dt);
        this.bosses.update(dt);
        this.npcs.update(dt);
        this.magic.update(dt);
        this.treasure.update(dt);
        this.interiors.update(dt);
        this.evolution.update(dt);
        this.respawn.update(dt);
        if (playing) this.interaction.update(dt);
        this.quests.update(dt);
      }
      this.poison.update(dt);
      this.cinematics.update(this.realDt);
      this.camera.update(rawDt);
      const cp = this.camera.camera.position;
      this.world.update(dt, cp);
      this.terrain.update(cp.x, cp.y, cp.z, 3);
      this.env.update({ hour: this.time.hour, doom: this.evolution.skyDoom, victory: this.victory, time: this.elapsed, interior: !!this.interiors.current });
      tickRainbow(dt);
      this.fx.update(dt);
      this.audio.update(rawDt);
      this.save.update(rawDt);
    } else {
      this.camera.update(rawDt);
    }
    this.ui.update(this.realDt);
  }

  /** Teleport helper. */
  playerPos(): Vector3 {
    return this.player.position;
  }

  debug(): boolean {
    return DEBUG;
  }
}
