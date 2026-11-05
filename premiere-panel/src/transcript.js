// Gets timed words for a sequence using Premiere's own speech-to-text.
// Each clip on the chosen audio track is transcribed once (Premiere caches it),
// then its words are mapped from media time to sequence time, so cuts are respected.
(function () {
  const ST = (globalThis.ST = globalThis.ST || {});
  const ppro = require("premierepro");

  function countWords(transcript) {
    return (transcript.segments || []).reduce((n, s) => n + ((s.words && s.words.length) || 0), 0);
  }

  async function readTranscript(clip) {
    if (!ppro.Transcript.hasTranscript(clip)) return null;
    try {
      const t = JSON.parse(await ppro.Transcript.exportToJSON(clip));
      return countWords(t) > 0 ? t : null; // an empty placeholder counts as missing
    } catch (e) {
      return null;
    }
  }

  async function ensureTranscript(clip, name, language, log) {
    let t = await readTranscript(clip);
    if (t) {
      log("Using existing transcript for " + name);
      return t;
    }
    log("Transcribing " + name + " (Premiere speech to text; longer clips take a while)…");
    const started = Date.now();
    const ok = await ppro.Transcript.transcribeClipProjectItem(clip, language ? { language } : undefined);
    if (!ok) throw new Error("Premiere could not transcribe " + name);
    t = await readTranscript(clip);
    if (!t) throw new Error("Transcription of " + name + " found no speech");
    log("Transcribed " + name + " in " + ((Date.now() - started) / 1000).toFixed(1) + "s");
    return t;
  }

  // Returns { words: [{text, start, end, eos}], clips: n } in sequence seconds.
  async function sequenceWords(sequence, opts, log) {
    const trackIndex = Math.max(0, (opts.audioTrack || 1) - 1);
    const trackCount = await sequence.getAudioTrackCount();
    if (trackIndex >= trackCount) throw new Error("Audio track A" + (trackIndex + 1) + " doesn't exist in this sequence");
    const track = await sequence.getAudioTrack(trackIndex);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    if (!items.length) throw new Error("No clips on audio track A" + (trackIndex + 1));

    const cache = new Map();
    const words = [];
    let used = 0;
    for (const item of items) {
      const projectItem = await item.getProjectItem();
      const name = projectItem ? projectItem.name : "clip";
      let clip;
      try {
        clip = ppro.ClipProjectItem.cast(projectItem);
      } catch (e) {
        log("Skipping " + name + " (not a media clip)");
        continue;
      }
      if (await clip.isSequence()) {
        log("Skipping " + name + ": nested sequences can't be transcribed. Put the source clip on the audio track instead.");
        continue;
      }
      const key = (await clip.getMediaFilePath()) || name;
      if (!cache.has(key)) cache.set(key, await ensureTranscript(clip, name, opts.language, log));
      const transcript = cache.get(key);

      const inPoint = (await item.getInPoint()).seconds;
      const outPoint = (await item.getOutPoint()).seconds;
      const start = (await item.getStartTime()).seconds;
      let speed = 1;
      try { speed = (await item.getSpeed()) || 1; } catch (e) { /* default */ }
      if (await item.isSpeedReversed()) {
        log("Skipping reversed clip " + name);
        continue;
      }
      const toSeq = (t) => start + (t - inPoint) / speed;
      used++;

      for (const seg of transcript.segments || []) {
        for (const w of seg.words || []) {
          if (w.type && w.type !== "word") continue;
          if (opts.removeFillers && (w.tags || []).indexOf("filler") !== -1) continue;
          const mid = w.start + w.duration / 2;
          if (mid < inPoint || mid > outPoint) continue; // word was cut out
          words.push({ text: w.text, start: toSeq(Math.max(w.start, inPoint)), end: toSeq(Math.min(w.start + w.duration, outPoint)), eos: !!w.eos });
        }
      }
    }
    words.sort((a, b) => a.start - b.start);
    return { words, clips: used };
  }

  ST.transcript = { sequenceWords };
})();
