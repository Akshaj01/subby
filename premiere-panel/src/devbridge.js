// Development bridge: lets Claude run commands in Premiere without clicking.
// While the panel is open it polls dev-bridge/command.json and writes result.json.
// Edits through the bridge are limited to the "SubtitleTool Test" project.
// Set ENABLED to false to switch it off.
(function () {
  const ENABLED = true;
  if (!ENABLED) return;

  const ST = globalThis.ST;
  const ppro = require("premierepro");
  const uxp = require("uxp");
  const fs = require("fs");

  const TEST_PROJECT = "SubtitleTool Test";

  // Folders are found from the plugin's own folder: UXP Developer Tools loads the dev copy straight from
  // <repo>/premiere-panel, so the repo root is its parent. Set once in start(), before any polling.
  let ROOT = null;
  let BRIDGE = null; // file: URL of <repo>/dev-bridge/
  let FRAMES_DIR = null; // where exportFrame writes PNGs

  let lastId = null;
  let busy = false;
  let captured = null;

  ST.app.listeners.push((msg, cls) => {
    if (captured) captured.push((cls === "bad" ? "[FAIL] " : cls === "ok" ? "[ OK ] " : "") + msg);
  });

  async function context() {
    const project = await ppro.Project.getActiveProject();
    if (!project || project.name.indexOf(TEST_PROJECT) === -1) throw new Error("Bridge edits only run in the " + TEST_PROJECT + " project");
    const sequence = await project.getActiveSequence();
    return { project, sequence };
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const helpers = { context, log: ST.app.log };

  const ACTIONS = {
    ping: async () => ({ pong: true, host: uxp.host.name + " " + uxp.host.version }),
    eval: async (args) => {
      await context(); // only while the test project is the active one
      return new AsyncFunction("ppro", "ST", "h", "args", args.code)(ppro, ST, helpers, args);
    },
    generate: async (args) => ST.app.generate(args.settings || {}, TEST_PROJECT),
    remove: async () => ST.app.remove(TEST_PROJECT),
    useSequence: async (args) => {
      const { project } = await context();
      const all = await project.getSequences();
      const target = all.find((q) => q.name === args.name);
      if (!target) throw new Error("No sequence named " + args.name);
      await project.setActiveSequence(target);
      try { await project.openSequence(target); } catch (e) { /* optional */ }
      return { active: target.name };
    },
    exportFrame: async (args) => {
      const { sequence } = await context();
      const name = args.name || "frame-" + Date.now() + ".png";
      const ok = await ppro.Exporter.exportSequenceFrame(sequence, ppro.TickTime.createWithSeconds(args.time || 0), name, FRAMES_DIR, args.width || 960, args.height || 540);
      return { exported: ok, path: FRAMES_DIR + name };
    },
    save: async () => { const { project } = await context(); return { saved: await project.save() }; },
  };

  function readJson(name) {
    return JSON.parse(fs.readFileSync(BRIDGE + name, { encoding: "utf-8" }));
  }
  function writeJson(name, obj) {
    fs.writeFileSync(BRIDGE + name, JSON.stringify(obj, null, 2), { encoding: "utf-8" });
  }
  function safe(data) {
    try { return JSON.parse(JSON.stringify(data === undefined ? null : data)); } catch (e) { return String(data); }
  }

  async function poll() {
    if (busy) return;
    let cmd;
    try { cmd = readJson("command.json"); } catch (e) { return; }
    if (!cmd || cmd.id === undefined || cmd.id === lastId) return;
    lastId = cmd.id;
    busy = true;
    captured = [];
    const started = Date.now();
    let result;
    try {
      const fn = ACTIONS[cmd.action];
      if (!fn) throw new Error("Unknown action: " + cmd.action);
      result = { id: cmd.id, action: cmd.action, ok: true, data: safe(await fn(cmd.args || {})) };
    } catch (e) {
      result = { id: cmd.id, action: cmd.action, ok: false, error: e && e.message ? e.message : String(e) };
    }
    result.ms = Date.now() - started;
    result.lines = captured;
    captured = null;
    try { writeJson("result.json", result); } catch (e) { /* ignore */ }
    busy = false;
  }

  function heartbeat() {
    try { writeJson("status.json", { alive: new Date().toISOString(), lastId, busy, host: uxp.host.name + " " + uxp.host.version }); } catch (e) { /* ignore */ }
  }

  async function start() {
    const folder = await uxp.storage.localFileSystem.getPluginFolder();
    ROOT = folder.nativePath.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
    BRIDGE = "file:" + ROOT + "/dev-bridge/";
    FRAMES_DIR = ROOT + "/test-project/frames/";
    try { lastId = readJson("command.json").id; } catch (e) { lastId = null; }
    heartbeat();
    setInterval(heartbeat, 3000);
    setInterval(poll, 500);
  }
  start().catch((e) => ST.app.log("Dev bridge didn't start: " + (e && e.message ? e.message : e), "bad"));
})();
