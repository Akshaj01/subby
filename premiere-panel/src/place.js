// Puts baked subtitle templates on the timeline and removes them again.
(function () {
  const ST = (globalThis.ST = globalThis.ST || {});
  const ppro = require("premierepro");

  const TEMPLATE_WIDTH = 1920; // the After Effects template's comp width

  function transact(project, name, build) {
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction((compound) => build(compound), name);
    });
    return ok;
  }

  async function clipsOn(track) {
    return track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  }

  // Inserting a template pushes later clips on that track down the timeline, so the
  // target track must be empty from the first subtitle onward. Prefer the top one.
  async function pickTrack(sequence, firstStart) {
    const count = await sequence.getVideoTrackCount();
    for (let t = count - 1; t >= 0; t--) {
      const items = await clipsOn(await sequence.getVideoTrack(t));
      let free = true;
      for (const it of items) {
        if ((await it.getEndTime()).seconds > firstStart + 1e-6) { free = false; break; }
      }
      if (free) return t;
    }
    return -1;
  }

  function hexToColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  async function motionParams(item) {
    const chain = await item.getComponentChain();
    for (let i = 0; i < chain.getComponentCount(); i++) {
      const comp = chain.getComponentAtIndex(i);
      if ((await comp.getMatchName()) === "AE.ADBE Motion") {
        return { position: comp.getParam(0), scale: comp.getParam(1), rotation: comp.getParam(4) };
      }
    }
    return null;
  }

  // Tint maps white to the chosen color and keeps the black outline black.
  async function addTint(project, item, color) {
    const tint = await ppro.VideoFilterFactory.createComponent("AE.ADBE Tint");
    const chain = await item.getComponentChain();
    transact(project, "Subby: color", (c) => c.addAction(chain.createAppendComponentAction(tint)));
    const after = await item.getComponentChain();
    const comp = after.getComponentAtIndex(after.getComponentCount() - 1);
    for (let i = 0; i < comp.getParamCount(); i++) {
      const p = comp.getParam(i);
      if (p.displayName === "Map White To") {
        const kf = p.createKeyframe(new ppro.Color(color.r, color.g, color.b, 1));
        transact(project, "Subby: color", (c) => c.addAction(p.createSetValueAction(kf, true)));
      }
    }
  }

  // subs: [{text, start, end}] in sequence seconds.
  async function placeAll(project, sequence, subs, opts, log, progress) {
    if (!subs.length) throw new Error("No subtitles to place");
    const trackIndex = await pickTrack(sequence, subs[0].start);
    if (trackIndex < 0) {
      throw new Error("No free video track. Add an empty video track at the top (Sequence > Add Tracks) and run again.");
    }
    log("Placing " + subs.length + " subtitles on V" + (trackIndex + 1));

    let frameWidth = TEMPLATE_WIDTH;
    try { frameWidth = (await sequence.getFrameSize()).width || TEMPLATE_WIDTH; } catch (e) { /* default */ }
    const scale = (100 * frameWidth / TEMPLATE_WIDTH) * ((opts.size || 100) / 100);
    const y = (opts.heightPercent || 82) / 100;
    const rotation = Number(opts.rotation) || 0;
    const color = hexToColor(opts.color);
    const tint = color && !(color.r === 1 && color.g === 1 && color.b === 1) ? color : null;

    const editor = ppro.SequenceEditor.getEditor(sequence);
    const folder = await ST.template.newRunFolder();
    const started = Date.now();
    let placed = 0;

    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const path = ST.template.bake(folder, i + 1, s.text, opts.font);
      let items = [];
      project.lockedAccess(() => {
        items = editor.insertMogrtFromPath(path, ppro.TickTime.createWithSeconds(s.start), trackIndex, 0) || [];
      });
      const item = items.find((it) => it instanceof ppro.VideoClipTrackItem) || items[0];
      if (!item) {
        log("Could not insert subtitle " + (i + 1) + ": " + s.text);
        continue;
      }
      const motion = await motionParams(item);
      transact(project, "Subby: subtitle", (c) => {
        c.addAction(item.createSetEndAction(ppro.TickTime.createWithSeconds(s.end)));
        if (motion) {
          c.addAction(motion.position.createSetValueAction(motion.position.createKeyframe(new ppro.PointF(0.5, y)), true));
          if (Math.abs(scale - 100) > 0.01) c.addAction(motion.scale.createSetValueAction(motion.scale.createKeyframe(scale), true));
          if (rotation) c.addAction(motion.rotation.createSetValueAction(motion.rotation.createKeyframe(rotation), true));
        }
      });
      if (tint) await addTint(project, item, tint);
      placed++;
      if (progress) progress(placed, subs.length);
    }
    log("Placed " + placed + " subtitles in " + ((Date.now() - started) / 1000).toFixed(1) + "s");
    return { placed, track: trackIndex + 1 };
  }

  // Every subtitle clip this tool made (names start with "Sub - ").
  async function findGenerated(sequence) {
    const count = await sequence.getVideoTrackCount();
    const found = [];
    for (let t = 0; t < count; t++) {
      for (const it of await clipsOn(await sequence.getVideoTrack(t))) {
        if ((await it.getName()).indexOf(ST.template.NAME_PREFIX) === 0) found.push(it);
      }
    }
    return found;
  }

  async function removeAll(project, sequence) {
    const targets = await findGenerated(sequence);
    if (!targets.length) return 0;
    const editor = ppro.SequenceEditor.getEditor(sequence);
    let ok = false;
    ppro.TrackItemSelection.createEmptySelection((sel) => {
      for (const it of targets) sel.addItem(it, true);
      ok = transact(project, "Subby: remove subtitles", (c) =>
        c.addAction(editor.createRemoveItemsAction(sel, false, ppro.Constants.MediaType.ANY, false)));
    });
    if (!ok) throw new Error("Premiere refused to remove the subtitles");
    return targets.length;
  }

  ST.place = { placeAll, removeAll, findGenerated, pickTrack, hexToColor };
})();
