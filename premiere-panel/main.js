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

  // Widest allowed line for a Size (see ST.chunk.lineLimit: the comp clips before Premiere scales).
  const lineLimit = (size) => ST.chunk.lineLimit(size, TEMPLATE_WIDTH, MAX_LINE);

  const WORD_CHOICES = [1, 2, 3, 4, 5, 6];
  const POSITIONS = [{ label: "Top", value: 15 }, { label: "Middle", value: 50 }, { label: "Bottom", value: 82 }];
  const SWATCHES = ["#FFFFFF", "#FFE14D", "#FF9F1C", "#FF4D4D", "#FF7AD9", "#4DE1FF", "#7CFF6B"];
  const SAMPLE = "hey guys welcome back to my channel".split(" "); // the preview shows the first N words
  const CHECKS = ["allCaps", "stripPunctuation", "removeFillers"];
  const OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]; // fake text stroke
  const TITLE = "Subby";
  const BOIL_MS = 250; // the title re-wiggles 4 times a second, like the template's posterizeTime(4)
  const BOIL_PX = 1.3; // how far each letter can wander

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
    $("progressFill").style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + "%";
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
      audioTrack: parseInt(pickers.audioTrack.value, 10) || 1,
      language: pickers.language.value || DEFAULT_SETTINGS.language,
      maxWords,
      allCaps: isOn("allCaps"),
      stripPunctuation: isOn("stripPunctuation"),
      removeFillers: isOn("removeFillers"),
      heightPercent: num("heightPercent", DEFAULT_SETTINGS.heightPercent),
      size: num("size", DEFAULT_SETTINGS.size),
      rotation: num("rotation", DEFAULT_SETTINGS.rotation),
      color: normalizeHex($("color").value) || DEFAULT_SETTINGS.color,
      font: DEFAULT_SETTINGS.font,
    };
  }
  function fillForm(s) {
    maxWords = Math.max(1, Math.round(s.maxWords || DEFAULT_SETTINGS.maxWords));
    for (const id of CHECKS) setOn(id, !!s[id]);
    // Until refreshChoices has asked Premiere, the pickers only know the saved choice.
    const known = (id, fallback) => (pickers[id].options.length ? pickers[id].options : [fallback]);
    setOptions("audioTrack", known("audioTrack", { value: s.audioTrack, label: "A" + s.audioTrack }), s.audioTrack);
    setOptions("language", known("language", { value: s.language, label: s.language }), s.language);
    $("heightPercent").value = s.heightPercent;
    $("size").value = s.size;
    $("rotation").value = s.rotation;
    $("color").value = normalizeHex(s.color) || DEFAULT_SETTINGS.color;
    syncControls();
  }

  // ---------- custom controls ----------
  // Checkboxes are divs (Spectrum's sp-checkbox stays dark): data-on holds the state, .on draws it.
  function isOn(id) {
    return $(id).getAttribute("data-on") === "1";
  }
  function setOn(id, on) {
    $(id).setAttribute("data-on", on ? "1" : "0");
    $(id).className = "check" + (on ? " on" : "");
  }
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
    $("heightPercentValue").textContent = h + "%";
    $("sizeValue").textContent = num("size", DEFAULT_SETTINGS.size) + "%";
    $("rotationValue").textContent = num("rotation", DEFAULT_SETTINGS.rotation) + "°";
    renderPreview();
  }

  // ---------- title ----------
  // "Subby" in white Thunderman with a black outline, like the subtitles. Each letter is a wrapper holding an
  // invisible copy (for size) and nine stacked copies (eight black offsets, white on top); boil() nudges the
  // wrappers a little a few times a second. UXP has no transform or animation, but position: relative works.
  function buildTitle() {
    const box = $("title");
    box.innerHTML = "";
    const letters = [];
    for (const ch of TITLE) {
      const wrap = document.createElement("span");
      wrap.className = "letter";
      const ghost = document.createElement("span");
      ghost.className = "ghost";
      ghost.textContent = ch;
      wrap.appendChild(ghost);
      for (const [dx, dy, color] of OUTLINE.map(([x, y]) => [x * 2, y * 2, "#000000"]).concat([[0, 0, "#FFFFFF"]])) {
        const c = document.createElement("span");
        c.className = "copy";
        c.textContent = ch;
        c.style.left = dx + "px";
        c.style.top = dy + "px";
        c.style.color = color;
        wrap.appendChild(c);
      }
      box.appendChild(wrap);
      letters.push(wrap);
    }
    return letters;
  }
  function boil(letters) {
    const jiggle = () => (Math.random() * 2 - 1) * BOIL_PX;
    for (const l of letters) {
      l.style.left = jiggle().toFixed(1) + "px";
      l.style.top = jiggle().toFixed(1) + "px";
    }
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
    const limit = lineLimit(s.size);
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
    for (const [dx, dy] of OUTLINE) add(dx * o, dy * o, "#000000");
    add(0, 0, s.color);
    $("previewNote").textContent = s.rotation ? "angle " + s.rotation + "° not shown" : "";
  }

  // ---------- pickers (track and language) ----------
  // Premiere draws a native <select> dark whatever the CSS says, so these are divs: a box showing the choice
  // (#<id>Pick, text in #<id>Value) that opens an inline list (#<id>Menu). State lives in `pickers`.
  const pickers = { audioTrack: { options: [], value: "" }, language: { options: [], value: "" } };
  function setOptions(id, options, value) {
    const p = pickers[id];
    p.options = options.map((o) => ({ value: String(o.value), label: o.label }));
    const match = p.options.find((o) => o.value === String(value));
    p.value = match ? match.value : (p.options[0] ? p.options[0].value : "");
    const shown = p.options.find((o) => o.value === p.value);
    $(id + "Value").textContent = shown ? shown.label : "";
    if (isPickerOpen(id)) openPicker(id, true); // redraw the list with the new options
  }
  function isPickerOpen(id) {
    return $(id + "Menu").style.display === "block";
  }
  function openPicker(id, open) {
    const menu = $(id + "Menu");
    $(id + "Pick").className = "pick" + (open ? " open" : "");
    menu.innerHTML = "";
    menu.style.display = open ? "block" : "none";
    if (!open) return;
    const p = pickers[id];
    for (const o of p.options) {
      const d = document.createElement("div");
      d.className = "item" + (o.value === p.value ? " on" : "");
      d.textContent = o.label;
      d.addEventListener("click", () => {
        openPicker(id, false);
        setOptions(id, p.options, o.value);
        changed();
      });
      menu.appendChild(d);
    }
  }
  function setupPicker(id, beforeOpen) {
    $(id + "Pick").addEventListener("click", () => {
      const open = !isPickerOpen(id);
      for (const other of Object.keys(pickers)) if (other !== id) openPicker(other, false);
      openPicker(id, open);
      if (open && beforeOpen) beforeOpen(); // may refresh the options; setOptions redraws the open list
    });
  }

  // ---------- choices from Premiere ----------
  async function refreshChoices(s) {
    let languages = [{ value: "en-us", label: "English (US)" }];
    try {
      languages = ppro.Transcript.querySupportedLanguages().map((l) => ({ value: l.languageCode, label: l.displayString || l.languageCode }));
    } catch (e) { /* keep default */ }
    setOptions("language", languages, s.language);

    let tracks = 3;
    try {
      const project = await ppro.Project.getActiveProject();
      const seq = project && (await project.getActiveSequence());
      if (seq) tracks = await seq.getAudioTrackCount();
    } catch (e) { /* default */ }
    const opts = [];
    for (let i = 1; i <= Math.max(tracks, s.audioTrack); i++) opts.push({ value: i, label: "A" + i });
    setOptions("audioTrack", opts, s.audioTrack);
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
      maxWidth: lineLimit(s.size),
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

  // The buttons are divs, so "disabled" is only a look; run() ignores clicks while busy.
  function setBusy(busy) {
    $("btnGenerate").className = "btn main" + (busy ? " busy" : "");
    $("btnRemove").className = "btn quiet" + (busy ? " busy" : "");
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
  const titleLetters = buildTitle();
  boil(titleLetters);
  setInterval(() => boil(titleLetters), BOIL_MS);

  const settings = loadSettings();
  fillForm(settings);
  refreshChoices(settings);
  for (const id of ["heightPercent", "size", "rotation"]) {
    $(id).addEventListener("input", syncControls); // live while dragging
    $(id).addEventListener("change", changed);
  }
  for (const id of CHECKS) {
    $(id).addEventListener("click", () => {
      setOn(id, !isOn(id));
      changed();
    });
  }
  $("color").addEventListener("input", () => { if (normalizeHex($("color").value)) changed(); });
  setupPicker("audioTrack", () => refreshChoices(readForm())); // the active sequence may have changed
  setupPicker("language");
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
