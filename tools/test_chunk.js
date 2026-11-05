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

// Every Size, with up to 6 words: a line must fit inside the 1920-wide After Effects comp (which clips before
// Premiere scales it) and, once scaled by Size, inside the frame. A single word can't be split, so one that is
// too big for the frame at a huge Size is only reported.
console.log("\nSize check (maxWords 6, both cases):");
let failures = 0;
for (const size of [40, 60, 80, 100, 150, 250]) {
  let widest = 0;
  const lone = new Set();
  for (const allCaps of [false, true]) {
    const subs = chunk.build(words, { allCaps, maxWords: 6, maxWidth: chunk.lineLimit(size) }, metrics);
    for (const s of subs) {
      const tooWide = s.width > 1920 * 0.88 || s.width * (size / 100) > 1920 * 0.88;
      if (tooWide && s.words === 1) lone.add(s.text);
      else if (tooWide) failures++;
      else widest = Math.max(widest, s.width);
    }
  }
  const note = lone.size ? `  (single words too big for the frame: ${[...lone].join(", ")})` : "";
  console.log(`  size ${String(size).padStart(3)}%: widest line ${widest}px in the comp, ${Math.round(widest * size / 100)}px on screen${note}`);
}
console.log("lines cut off or off screen:", failures);
process.exitCode = failures ? 1 : 0;
