// Bakes subtitle text into copies of the After Effects template (.mogrt).
// Premiere 26.5 plugins can't set a title's text, but a .mogrt is a zip whose
// definition.json holds the default text, so each subtitle gets its own copy.
(function () {
  const ST = (globalThis.ST = globalThis.ST || {});
  const fs = require("fs");
  const uxp = require("uxp");

  const TEMPLATE_DIR = "plugin:/assets/template/";
  const NAME_PREFIX = "Sub - ";

  let cache = null; // { definitionText, parts: [{name, data}] }

  function load() {
    if (cache) return cache;
    const definitionText = fs.readFileSync(TEMPLATE_DIR + "definition.json", { encoding: "utf-8" });
    const parts = [];
    for (const name of ["project.aegraphic", "thumb.png"]) {
      try {
        parts.push({ name, data: new Uint8Array(fs.readFileSync(TEMPLATE_DIR + name)) });
      } catch (e) {
        if (name === "project.aegraphic") throw e; // required
      }
    }
    cache = { definitionText, parts };
    return cache;
  }

  function uuid() {
    const hex = [];
    for (let i = 0; i < 16; i++) hex.push(Math.floor(Math.random() * 256));
    hex[6] = (hex[6] & 0x0f) | 0x40;
    hex[8] = (hex[8] & 0x3f) | 0x80;
    const h = hex.map((b) => b.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Clip names become folder names on disk, so keep them filesystem-safe.
  function clipName(text) {
    const safe = text.replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 48);
    return NAME_PREFIX + (safe || "subtitle");
  }

  function bakedDefinition(text, font) {
    const def = JSON.parse(load().definitionText);
    const textIds = new Set();
    for (const control of def.clientControls || []) {
      if (control.type !== 6) continue; // 6 = text
      textIds.add(control.id);
      for (const entry of (control.value && control.value.strDB) || []) entry.str = text;
      if (font && control.fonteditinfo) control.fonteditinfo.fontEditValue = font;
    }
    for (const info of Object.values(def.sourceInfoLocalized || {})) {
      for (const p of (info.capsuleparams && info.capsuleparams.capParams) || []) {
        if (!textIds.has(p.capPropMatchName) && p.capPropType !== 0) continue;
        p.capPropDefault = text;
        p.textEditValue = text;
        p.fontTextRunLength = [text.length];
        if (font && p.fontEditValue) p.fontEditValue = [font];
      }
    }
    // A fresh capsule ID so Premiere never reuses a cached copy of another subtitle.
    def.capsuleID = uuid();
    const name = clipName(text);
    def.capsuleName = name;
    for (const entry of (def.capsuleNameLocalized && def.capsuleNameLocalized.strDB) || []) entry.str = name;
    return def;
  }

  // UXP's fs has no mkdirSync, so each run's files share the temp folder with a run prefix.
  async function newRunFolder() {
    const tmp = await uxp.storage.localFileSystem.getTemporaryFolder();
    return { url: "plugin-temp:/", nativePath: tmp.nativePath.replace(/\/$/, "") + "/", prefix: "run-" + Date.now() + "-" };
  }

  // Writes one .mogrt for `text` and returns its native path.
  function bake(folder, index, text, font) {
    const { parts } = load();
    const def = bakedDefinition(text, font);
    const entries = [{ name: "definition.json", data: ST.zip.utf8(JSON.stringify(def)) }].concat(parts);
    const file = folder.prefix + "sub-" + String(index).padStart(4, "0") + ".mogrt";
    fs.writeFileSync(folder.url + file, ST.zip.makeZip(entries));
    return folder.nativePath + file;
  }

  // Old run files are only needed until Premiere has copied the templates into the project.
  function cleanOldRuns() {
    try {
      for (const name of fs.readdirSync("plugin-temp:/")) {
        if (name.startsWith("run-") || name.startsWith("probe")) {
          try { fs.unlinkSync("plugin-temp:/" + name); } catch (e) { /* folder or in use */ }
        }
      }
    } catch (e) { /* nothing to clean */ }
  }

  ST.template = { load, bake, newRunFolder, cleanOldRuns, clipName, NAME_PREFIX };
})();
