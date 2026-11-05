// Quick check of the word grouping using a real Premiere transcript.
const chunk = require("../premiere-panel/src/chunk.js");
const metrics = require("../premiere-panel/assets/font-metrics.json");
const t = require("./fixtures/transcript-test-talking.json");
const words = [];
for (const s of t.segments) for (const w of s.words) if (w.type === "word") words.push({ text: w.text, start: w.start, end: w.start + w.duration, eos: w.eos });
for (const allCaps of [false, true]) {
  const subs = chunk.build(words, { allCaps }, metrics);
  console.log(`\nallCaps=${allCaps}: ${subs.length} subtitles`);
  for (const s of subs) console.log(`${s.start.toFixed(2).padStart(6)} - ${s.end.toFixed(2).padStart(6)}  [${s.words}w ${String(s.width).padStart(4)}px]  ${s.text}`);
  const bad = subs.filter((s) => s.width > 1920 * 0.88);
  console.log("too wide:", bad.length, " overlaps:", subs.filter((s, i) => i && subs[i - 1].end > s.start).length);
}
