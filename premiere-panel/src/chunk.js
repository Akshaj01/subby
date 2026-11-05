// Turns timed words into subtitle groups: up to `maxWords` words, fewer when the
// line would be too wide for the frame, and never across a sentence end or long pause.
(function () {
  const ST = (globalThis.ST = globalThis.ST || {});

  const DEFAULTS = {
    maxWords: 4,
    fontSize: 150, // template's text size, in template pixels
    maxWidth: 1920 * 0.88, // widest allowed line, in template pixels
    allCaps: false,
    stripPunctuation: true,
    pauseBreak: 0.6, // seconds of silence that forces a new subtitle
    hold: 0.25, // how long a subtitle stays up after its last word when nothing follows
    minDuration: 0.3,
    fps: 30,
  };

  function measure(text, metrics, fontSize) {
    if (!metrics) return 0;
    const fallback = metrics.widths["n"] || metrics.unitsPerEm / 2;
    let units = 0;
    for (const ch of text) units += metrics.widths[ch] !== undefined ? metrics.widths[ch] : fallback;
    return (units / metrics.unitsPerEm) * fontSize;
  }

  // Cleans one word for display. Returns "" when nothing printable is left.
  function cleanWord(text, opts) {
    let t = String(text).trim();
    if (opts.stripPunctuation) {
      t = t.replace(/^[\"“”'‘’(\[]+/, "").replace(/[.,;:\"“”)\]]+$/, "");
      t = t.replace(/^[.,;:]+/, "");
    }
    if (opts.allCaps) t = t.toUpperCase();
    return t;
  }

  function joinText(words) {
    return words.map((w) => w.display).join(" ");
  }

  // words: [{ text, start, end, eos }] in sequence seconds, sorted by start.
  function build(words, options, metrics) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const items = [];
    for (const w of words) {
      const display = cleanWord(w.text, opts);
      if (display) items.push(Object.assign({}, w, { display }));
    }

    const width = (list) => measure(joinText(list), metrics, opts.fontSize);
    const groups = [];
    let cur = [];
    const close = (reason) => {
      if (cur.length) groups.push({ words: cur, breakAfter: reason });
      cur = [];
    };

    for (const w of items) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        if (prev.eos) close("sentence");
        else if (w.start - prev.end > opts.pauseBreak) close("pause");
        else if (cur.length >= opts.maxWords || width(cur.concat([w])) > opts.maxWidth) close("limit");
      }
      cur.push(w);
    }
    close("end");

    // Avoid a lonely single word after a full line: move one word down (4+1 -> 3+2).
    for (let i = 1; i < groups.length; i++) {
      const prev = groups[i - 1];
      const g = groups[i];
      if (prev.breakAfter !== "limit" || g.words.length !== 1 || prev.words.length < 3) continue;
      const moved = [prev.words[prev.words.length - 1]].concat(g.words);
      if (width(moved) <= opts.maxWidth) {
        prev.words = prev.words.slice(0, -1);
        g.words = moved;
      }
    }

    // Timing, snapped to whole frames.
    const snap = (t) => Math.round(t * opts.fps) / opts.fps;
    const frame = 1 / opts.fps;
    const subs = groups.map((g) => ({
      text: joinText(g.words),
      start: g.words[0].start,
      lastEnd: g.words[g.words.length - 1].end,
      words: g.words.length,
    }));
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const next = subs[i + 1];
      let end = s.lastEnd + opts.hold;
      if (next) {
        if (next.start - s.lastEnd <= opts.pauseBreak) end = next.start; // continuous speech: no flicker
        end = Math.min(end, next.start);
      }
      end = Math.max(end, s.start + opts.minDuration);
      if (next) end = Math.min(end, next.start);
      s.start = snap(s.start);
      s.end = snap(end);
      if (s.end <= s.start) s.end = s.start + frame;
    }
    // Snapping can make neighbours overlap by a frame; clamp to the next start.
    for (let i = 0; i < subs.length - 1; i++) {
      if (subs[i].end > subs[i + 1].start) subs[i].end = subs[i + 1].start;
    }
    return subs.filter((s) => s.end > s.start).map((s) => ({ text: s.text, start: s.start, end: s.end, words: s.words, width: Math.round(measure(s.text, metrics, opts.fontSize)) }));
  }

  ST.chunk = { build, measure, cleanWord, DEFAULTS };
  if (typeof module !== "undefined") module.exports = ST.chunk;
})();
