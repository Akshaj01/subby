// Subby panel: settings, live preview, Generate and Remove.
(function () {
  const ST = (globalThis.ST = globalThis.ST || {});
  const ppro = require("premierepro");
  const fs = require("fs");

  const DEFAULT_SETTINGS = {
    audioTrack: 1,
    language: "en-us",
    maxWords: 4,
    allCaps: false,
    stripPunctuation: true,
    removeFillers: true,
    heightPercent: 82,
    size: 100,
    rotation: 0,
    color: "#FFFFFF",
    font: "Thunderman",
  };
  const STORAGE_KEY = "subtitletool-settings"; // old name kept so saved settings carry over
  const TEMPLATE_WIDTH = 1920;
  const TEMPLATE_FONT_PX = 150; // text size in the After Effects template
  const MAX_LINE = 0.88; // share of the frame width a line may use

  const WORD_CHOICES = [1, 2, 3, 4, 5, 6];
  const POSITIONS = [{ label: "Top", value: 15 }, { label: "Middle", value: 50 }, { label: "Bottom", value: 82 }];
  const SWATCHES = ["#FFFFFF", "#FFE14D", "#FF9F1C", "#FF4D4D", "#FF7AD9", "#4DE1FF", "#7CFF6B"];
  const SAMPLE = "hey guys welcome back to my channel".split(" "); // the preview shows the first N words

  const $ = (id) => document.getElementById(id);
  const logEl = $("log");
  let running = false;
  let metrics = null;
  let maxWords = DEFAULT_SETTINGS.maxWords; // the segmented control's state

  // ---------- log, status, progress ----------
  const listeners = [];
  function log(msg, cls) {
    const div = document.createElement("div");
    div.textContent = String(msg);
    if (cls) div.className = cls;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    for (const fn of listeners) fn(String(msg), cls);
  }
  function status(msg, kind) {
    const el = $("status");
    el.textContent = msg || "";
    el.className = kind || "";
  }
  // fraction 0..1 shows the bar; null hides it.
  function progress(fraction) {
    const bar = $("progress");
    if (fraction === null || fraction === undefined) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "block";
    bar.value = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }
  function showDetails(open) {
    logEl.style.display = open ? "block" : "none";
    $("detailsToggle").textContent = (open ? "▾ Hide details" : "▸ Show details");
  }

  // ---------- settings ----------
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (e) { saved = {}; }
    return Object.assign({}, DEFAULT_SETTINGS, saved);
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* not critical */ }
  }
  function num(id, fallback) {
    const v = Number($(id).value);
    return Number.isFinite(v) ? v : fallback;
  }
  function normalizeHex(text) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(text || "").trim());
    return m ? "#" + m[1].toUpperCase() : null;
  }
  function readForm() {
    return {
      audioTrack: parseInt($("audioTrack").value, 10) || 1,
      language: $("language").value || DEFAULT_SETTINGS.language,
      maxWords,
      allCaps: !!$("allCaps").checked,
      stripPunctuation: !!$("stripPunctuation").checked,
      removeFillers: !!$("removeFillers").checked,
      heightPercent: num("heightPercent", DEFAULT_SETTINGS.heightPercent),
      size: num("size", DEFAULT_SETTINGS.size),
      rotation: num("rotation", DEFAULT_SETTINGS.rotation),
      color: normalizeHex($("color").value) || DEFAULT_SETTINGS.color,
      font: DEFAULT_SETTINGS.font,
    };
  }
  function fillForm(s) {
    maxWords = Math.max(1, Math.round(s.maxWords || DEFAULT_SETTINGS.maxWords));
    $("allCaps").checked = !!s.allCaps;
    $("stripPunctuation").checked = !!s.stripPunctuation;
    $("removeFillers").checked = !!s.removeFillers;
    $("heightPercent").value = s.heightPercent;
    $("size").value = s.size;
    $("rotation").value = s.rotation;
    $("color").value = normalizeHex(s.color) || DEFAULT_SETTINGS.color;
    syncControls();
  }

  // ---------- custom controls ----------
  function buildSegments(container, options, onPick) {
    container.innerHTML = "";
    options.forEach((o, i) => {
      const d = document.createElement("div");
      d.setAttribute("data-value", String(o.value));
      d.setAttribute("data-base", i ? "opt sep" : "opt");
      d.className = d.getAttribute("data-base");
      d.textContent = o.label;
      d.addEventListener("click", () => onPick(o.value));
      container.appendChild(d);
    });
  }
  function markSelected(container, value) {
    for (const d of container.children) {
      d.className = d.getAttribute("data-base") + (d.getAttribute("data-value") === String(value) ? " on" : "");
    }
  }
  function buildSwatches() {
    const box = $("swatches");
    box.innerHTML = "";
    for (const hex of SWATCHES) {
      const d = document.createElement("div");
      d.className = "swatch";
      d.setAttribute("data-value", hex);
      d.style.backgroundColor = hex;
      d.addEventListener("click", () => {
        $("color").value = hex;
        changed();
      });
      box.appendChild(d);
    }
  }
  // Highlights the segment buttons and swatch that match the current values, and redraws the preview.
  function syncControls() {
    markSelected($("maxWords"), maxWords);
    const h = num("heightPercent", DEFAULT_SETTINGS.heightPercent);
    const preset = POSITIONS.find((p) => p.value === h);
    markSelected($("positions"), preset ? preset.value : "none");
    const color = normalizeHex($("color").value);
    for (const d of $("swatches").children) d.className = "swatch" + (d.getAttribute("data-value") === color ? " on" : "");
    renderPreview();
  }
  function changed() {
    syncControls();
    saveSettings(readForm());
  }

  // ---------- preview ----------
  // A 16:9 stand-in for the frame: sample text in Thunderman at the chosen height, size and color.
  // The outline is faked with eight black copies, since UXP has no text-shadow or stroke.
  function renderPreview() {
    const box = $("preview");
    const s = readForm();
    const w = box.clientWidth || 256;
    const h = Math.round((w * 9) / 16);
    box.style.height = h + "px";
    // Same rule as the real subtitles: drop words until the line fits the frame.
    let words = SAMPLE.slice(0, Math.max(1, Math.min(SAMPLE.length, s.maxWords)));
    if (s.allCaps) words = words.map((x) => x.toUpperCase());
    const m = loadMetricsSafe();
    const limit = (TEMPLATE_WIDTH * MAX_LINE) / ((s.size || 100) / 100);
    while (m && words.length > 1 && ST.chunk.measure(words.join(" "), m, TEMPLATE_FONT_PX) > limit) words.pop();
    const text = words.join(" ");
    const fontPx = Math.max(6, (w * TEMPLATE_FONT_PX) / TEMPLATE_WIDTH * (s.size / 100));
    const lineH = Math.round(fontPx * 1.25);
    const top = Math.round((h * s.heightPercent) / 100 - lineH / 2);
    const o = Math.max(1, Math.round(fontPx * 0.06));
    const layer = $("previewLayer");
    layer.innerHTML = "";
    const add = (dx, dy, color) => {
      const d = document.createElement("div");
      d.className = "ptext";
      d.textContent = text;
      d.style.width = w + "px";
      d.style.left = dx + "px";
      d.style.top = top + dy + "px";
      d.style.fontSize = fontPx + "px";
      d.style.lineHeight = lineH + "px";
      d.style.color = color;
      layer.appendChild(d);
    };
    for (const [dx, dy] of [[-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [0, o], [o, o]]) add(dx, dy, "#000000");
    add(0, 0, s.color);
    $("previewNote").textContent = s.rotation ? "angle " + s.rotation + "° not shown" : "";
  }

  // ---------- choices from Premiere ----------
  function setOptions(select, options, value) {
    select.innerHTML = "";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = String(o.value);
      opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      select.appendChild(opt);
    }
  }

  async function refreshChoices(s) {
    let languages = [{ value: "en-us", label: "English (US)" }];
    try {
      languages = ppro.Transcript.querySupportedLanguages().map((l) => ({ value: l.languageCode, label: l.displayString || l.languageCode }));
    } catch (e) { /* keep default */ }
    setOptions($("language"), languages, s.language);

    let tracks = 3;
    try {
      const project = await ppro.Project.getActiveProject();
      const seq = project && (await project.getActiveSequence());
      if (seq) tracks = await seq.getAudioTrackCount();
    } catch (e) { /* default */ }
    const opts = [];
    for (let i = 1; i <= Math.max(tracks, s.audioTrack); i++) opts.push({ value: i, label: "A" + i });
    setOptions($("audioTrack"), opts, s.audioTrack);
  }

  function loadMetricsSafe() {
    try { return loadMetrics(); } catch (e) { return null; }
  }

  function loadMetrics() {
    if (!metrics) metrics = JSON.parse(fs.readFileSync("plugin:/assets/font-metrics.json", { encoding: "utf-8" }));
    return metrics;
  }

  async function frameRate(sequence) {
    try {
      const settings = await sequence.getSettings();
      const fr = await settings.getVideoFrameRate();
      const v = fr && fr.value;
      if (v > 1) return v;
      if (v > 0) return 1 / v;
    } catch (e) { /* fall back */ }
    return 30;
  }

  // ---------- actions ----------
  async function activeContext(requireProjectName) {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Open a project first.");
    if (requireProjectName && project.name.indexOf(requireProjectName) === -1) {
      throw new Error('Active project is "' + project.name + '", expected "' + requireProjectName + '".');
    }
    const sequence = await project.getActiveSequence();
    if (!sequence) throw new Error("Open the sequence you want subtitles on.");
    return { project, sequence };
  }

  async function generate(overrides, requireProjectName) {
    const fromForm = readForm();
    saveSettings(fromForm); // only what's in the panel is remembered, never test overrides
    const s = Object.assign({}, fromForm, overrides || {});
    const started = Date.now();
    const { project, sequence } = await activeContext(requireProjectName);
    const existing = (await ST.place.findGenerated(sequence)).length;
    if (existing) {
      throw new Error(sequence.name + " already has " + existing + " subtitles from this tool. Press Remove first (this also clears any text fixes you made), then Generate again.");
    }
    log("Generating subtitles for " + sequence.name);
    ST.template.cleanOldRuns();
    status("Listening to A" + s.audioTrack + "…");
    progress(0.05);

    const { words, clips } = await ST.transcript.sequenceWords(sequence, s, log);
    if (!words.length) throw new Error("No speech found on A" + s.audioTrack + ".");
    const fps = await frameRate(sequence);
    const subs = ST.chunk.build(words, {
      maxWords: s.maxWords,
      allCaps: s.allCaps,
      stripPunctuation: s.stripPunctuation,
      fps,
      maxWidth: (TEMPLATE_WIDTH * MAX_LINE) / ((s.size || 100) / 100),
    }, loadMetrics());
    log(words.length + " words from " + clips + " clip(s) → " + subs.length + " subtitles (" + fps.toFixed(2) + " fps)");

    status("Placing subtitles…");
    progress(0.1);
    const result = await ST.place.placeAll(project, sequence, subs, s, log, (n, total) => {
      status("Placing " + n + " of " + total + "…");
      progress(0.1 + 0.9 * (n / total));
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log("Done: " + result.placed + " subtitles on V" + result.track + " in " + secs + "s", "ok");
    status("✓ " + result.placed + " subtitles on V" + result.track + " in " + secs + "s", "ok");
    return { subtitles: subs, placed: result.placed, track: result.track, seconds: Number(secs) };
  }

  async function remove(requireProjectName) {
    const { project, sequence } = await activeContext(requireProjectName);
    status("Removing…");
    const n = await ST.place.removeAll(project, sequence);
    log(n ? "Removed " + n + " subtitles from " + sequence.name : "No Subby subtitles found in " + sequence.name, n ? "ok" : undefined);
    status(n ? "Removed " + n + " subtitles" : "No subtitles from this tool here", n ? "ok" : undefined);
    return { removed: n };
  }

  function setBusy(busy) {
    for (const id of ["btnGenerate", "btnRemove"]) {
      if (busy) $(id).setAttribute("disabled", "");
      else $(id).removeAttribute("disabled");
    }
  }

  async function run(label, fn) {
    if (running) return;
    running = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      log(label + " failed: " + msg, "bad");
      status(label + " failed: " + msg, "bad");
      showDetails(true);
      const main = $("main");
      if (main) main.scrollTop = main.scrollHeight; // the log sits at the end of the scrolling area
    } finally {
      running = false;
      progress(null);
      setBusy(false);
    }
  }

  // ---------- init ----------
  buildSegments($("maxWords"), WORD_CHOICES.map((n) => ({ label: String(n), value: n })), (n) => { maxWords = n; changed(); });
  buildSegments($("positions"), POSITIONS, (v) => { $("heightPercent").value = v; changed(); });
  buildSwatches();

  const settings = loadSettings();
  fillForm(settings);
  refreshChoices(settings);
  for (const id of ["heightPercent", "size", "rotation"]) {
    $(id).addEventListener("input", syncControls); // live while dragging
    $(id).addEventListener("change", changed);
  }
  for (const id of ["allCaps", "stripPunctuation", "removeFillers"]) $(id).addEventListener("change", changed);
  $("color").addEventListener("input", () => { if (normalizeHex($("color").value)) changed(); });
  $("audioTrack").addEventListener("change", changed);
  $("language").addEventListener("change", changed);
  $("audioTrack").addEventListener("focus", () => refreshChoices(readForm()));
  $("detailsToggle").addEventListener("click", () => showDetails(logEl.style.display !== "block"));
  $("btnGenerate").addEventListener("click", () => run("Generate", () => generate()));
  $("btnRemove").addEventListener("click", () => run("Remove", () => remove()));
  try {
    new ResizeObserver(() => renderPreview()).observe($("preview"));
  } catch (e) { /* the preview keeps its first size */ }
  showDetails(false);
  progress(null);
  log("Ready. Open a sequence and press Generate subtitles.");

  function resetSettings() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    fillForm(DEFAULT_SETTINGS);
    return readForm();
  }

  ST.app = { generate, remove, log, status, listeners, readForm, loadSettings, resetSettings, isRunning: () => running };
})();
