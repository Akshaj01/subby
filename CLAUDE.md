# Subby: notes for Claude

Read this before changing anything. [README.md](README.md) is the user-facing guide; this file is
the developer handover: what the tool is for, how the pieces fit, the data shapes, and what
Premiere's plugin API can and can't do (tested on the user's machine, not taken from Adobe docs).

## Purpose

The user makes YouTube videos in Premiere Pro and After Effects. Their subtitle style is
"line boil" text (wiggly, re-randomised a few times a second, similar to anthpo's subtitles).
Before this tool they typed every subtitle in After Effects and exported templates by hand.
Subby (called SubtitleTool until 2026-11-04) is a Premiere panel that does it in one click: it transcribes the active sequence
and places one Boil Text subtitle clip per few words. It must be fast. An 83s clip takes about 6s.

### Style rules (from the user, don't change without asking)

- Font **Thunderman** (PostScript name `Thunderman`), white fill, black outline, the boil from
  their AE template. Bottom center by default.
- Up to **4 words** per subtitle. Use 3 (or fewer) when 4 would be too wide for the screen.
- Text just **appears and disappears**: no pop, scale or animation. The user adds their own effects.
- **No** highlighting of the word being spoken.
- **Each subtitle is its own clip**, so the user can move or restyle one. Color, angle and
  position are adjustable.

## Status (2026-11-04)

- v1 is built and verified through the dev bridge in the test project: right words at the right
  times, cuts and trims respected, color/angle/caps, Remove, and the duplicate guard.
- The installed release was checked in Premiere after a restart (1.0.0 on Cut Test: Generate placed 13 correct
  subtitles, Remove cleared them). 1.0.1 fixed the layout: UXP panels don't scroll the body, so `index.html` now uses
  `html, body { height: 100% }`, a flex-column body, a scrolling `#main` (settings and log), and a pinned `#footer`
  (buttons and status). Checked at 300px tall and with mouse-wheel scrolling.
- Background `app_*` clicks and scrolls don't reach floating UXP panels or the macOS file picker. Use full-screen
  control for those, or measure layout through the bridge (`document.getElementById(...).getBoundingClientRect()`
  in `eval`; `window.innerHeight` is null in UXP, and `h` is taken by the helpers argument).
- **Paper redesign (2026-11-05), shipped as 1.3.0:** the user asked for a much cuter
  UI with a crumpled paper background and picked light paper over dark. The design: cream crumpled paper (`assets/paper.jpg`),
  white paper cards with a thick bottom-right "sticker" edge and a washi-tape heading each, ink-brown text in Chalkboard
  SE, Thunderman for the title/headings/buttons, pastel pink/yellow/blue accents, a Polaroid-framed preview, a wiggling
  outlined "Subby" title, and custom divs replacing every Spectrum/native control that stayed dark (buttons, checkboxes,
  progress bar, track/language pickers). Verified live: screenshots at the floating panel's ~280px width and squeezed to
  210px, picker/checkbox state saving, and Generate/Remove through the new buttons on Cut Test (13 subtitles, correct text).
  Not verified: hover/press colors (needs a real mouse) and other panel sizes. Installed with UPIA on 2026-11-05;
  the release copy's saved settings (maxWords 6) were backed up and restored around the upgrade.
- The user has **not** run it on real footage yet. Also unchecked: playback smoothness with many
  AE templates on the timeline, and editing text in Essential Graphics.
- **Two copies, two IDs** (since 2026-11-04):
  - **Installed release:** `com.akshaj.subtitletool` "Subby" 1.3.1 (the paper design plus the line-width fix). Built by `tools/package.py` and
    installed with Adobe's UPIA into `~/Library/Application Support/Adobe/UXP/Plugins/External/com.akshaj.subtitletool_<version>`
    (registered in `~/Library/Application Support/Adobe/UXP/PluginsInfo/v1/premierepro.json`). No dev bridge.
  - **Dev copy:** `premiere-panel/` = `com.akshaj.subtitletool.dev` "Subby Dev", loaded through UXP Developer
    Tools (UDT), with the dev bridge. The separate ID lets both load at once. Each has its own saved settings.
- **Source:** private GitHub repo https://github.com/Akshaj01/subby (branch `main`). `.gitignore` leaves out `dist/`,
  `test-project/` and the bridge's runtime JSON files.
- **Name vs. IDs:** the user renamed the tool to **Subby** on 2026-11-04. Only display names changed. The plugin IDs,
  the `localStorage` key, the local folder (`CodingProjects/SubtitleTool`) and the test project name ("SubtitleTool Test",
  which the dev bridge checks) keep the old name on purpose: a new ID makes Premiere treat it as a different plugin.
- Environment: macOS, Premiere Pro 26.5.2. Premiere developer mode is on (Settings › Plugins).

## How it works

```
Generate (main.js)
  ├─ transcript.sequenceWords   clips on the chosen audio track → Premiere speech-to-text
  │                             → words mapped from media time to sequence time
  ├─ chunk.build                words → subtitle groups (max words, width, sentence, pause)
  └─ place.placeAll             for each subtitle:
       template.bake            copy the .mogrt with the text baked into definition.json (zip.js)
       insertMogrtFromPath      insert at the start time on a free video track
       transaction              trim end, Motion position/scale/rotation
       addTint                  only when the color isn't white
```

**Why baking:** Premiere 26.5's UXP API can't read or write any title text (see API facts
below). A `.mogrt` is a zip whose `definition.json` holds the *default* text, so each subtitle
gets its own copy of the template with its words as the default, and a fresh `capsuleID`.
Premiere copies each one into `<project folder>/Motion Graphics Template Media/<capsuleID>/` and
into a project bin. That's one project item per subtitle, which is the main cost of this design.

## Files

| Path | What it is |
|---|---|
| `premiere-panel/manifest.json` | UXP manifest v5 for the **dev** copy: id `com.akshaj.subtitletool.dev`, name "Subby Dev", version 1.3.1, host `premierepro` ≥ 25.6.0, `localFileSystem: fullAccess` |
| `tools/package.py` | Builds `dist/Subby.ccx`: rewrites the id/name/label to the release values, drops `src/devbridge.js` and its `<script>` tag, checks that every loaded script is included |
| `premiere-panel/index.html` | Panel UI (paper design, 2026-11-05): wiggling title, Polaroid preview, Audio/Words/Look paper cards, a hidden-by-default log, and a pinned footer with progress bar, Generate, Remove and the status line. All CSS is inline here. Script load order: zip, template, chunk, transcript, place, main, devbridge |
| `premiere-panel/main.js` | Controls (pickers, segmented pills, checkboxes, swatches, sliders), the boiling title, the preview, saving settings on every change, Generate/Remove with progress and status, exports `ST.app` |
| `premiere-panel/src/transcript.js` | `ST.transcript.sequenceWords(sequence, opts, log)` |
| `premiere-panel/src/chunk.js` | `ST.chunk.build(words, options, metrics)`. Also a Node module for tests |
| `premiere-panel/src/template.js` | `ST.template.bake(...)` and helpers. `NAME_PREFIX = "Sub - "` |
| `premiere-panel/src/zip.js` | Tiny STORED-only zip writer (`ST.zip.makeZip`, `utf8`, `crc32`) |
| `premiere-panel/src/place.js` | `ST.place.placeAll / removeAll / findGenerated / pickTrack / hexToColor` |
| `premiere-panel/src/devbridge.js` | Dev-only file bridge so Claude can drive Premiere (see below) |
| `premiere-panel/assets/font-metrics.json` | Thunderman advance widths, for fitting lines on screen |
| `premiere-panel/assets/template/` | Parts of the user's `Boil Text.mogrt`: `definition.json`, `project.aegraphic`, `thumb.png` |
| `premiere-panel/assets/paper.jpg` | The panel's crumpled paper background (900×1600, ~170 KB) |
| `tools/prepare_assets.py` | Regenerates both assets from the font `.ttf` and the `.mogrt` |
| `tools/make_paper.py` | Regenerates `paper.jpg` (pure-Python crease shading, then ffmpeg for grain, cream tint and JPEG). Optional seed argument |
| `tools/test_chunk.js` + `tools/fixtures/` | Node check of grouping against a real Premiere transcript |
| `dev-bridge/send.py` | Sends one bridge command and prints the result |
| `dev-bridge/make_mogrt.py` | The original Python proof that baking works (not used by the panel) |
| `test-project/` | `SubtitleTool Test.prproj`, test media, `frames/` (exported PNGs), `generated/` (experiment .mogrts). Not in git: it only exists on the user's Mac |

Code conventions: plain browser scripts, no bundler or npm. Each file is an IIFE that hangs its
module on `globalThis.ST`. Keep transcription and grouping independent of placement so placement
can be swapped out when Premiere 27 arrives.

## Data shapes

**Settings** (`main.js` `DEFAULT_SETTINGS`, saved in `localStorage["subtitletool-settings"]`; only
form values are saved, never overrides passed by the bridge):

| Field | Default | Meaning |
|---|---|---|
| `audioTrack` | `1` | 1-based audio track to transcribe |
| `language` | `"en-us"` | Code from `Transcript.querySupportedLanguages()` |
| `maxWords` | `4` | Maximum words per subtitle |
| `allCaps` | `false` | Uppercase display text |
| `stripPunctuation` | `true` | Strip leading quotes/brackets and trailing `. , ; : " ) ]`. Keeps `?` and `!` |
| `removeFillers` | `true` | Drop words Premiere tags `filler` |
| `heightPercent` | `82` | Vertical center of the subtitle, % from the top |
| `size` | `100` | % of the template's size (also auto-scaled for non-1920-wide sequences) |
| `rotation` | `0` | Degrees |
| `color` | `"#FFFFFF"` | Hex. Not white → Tint effect (Map White To = color, black outline stays black) |
| `font` | `"Thunderman"` | PostScript name baked into the template (not in the form) |

**Premiere transcript** (`Transcript.exportToJSON(clipProjectItem)`; times in *media* seconds;
punctuation is attached to `text`; sample in `tools/fixtures/transcript-test-talking.json`):

```json
{ "language": "en-us",
  "speakers": [{ "id": "uuid", "name": "Unknown" }],
  "segments": [{ "start": 0.02, "duration": 3.1, "language": "en-us", "speaker": "uuid",
                 "words": [{ "text": "Hey,", "start": 0.02, "duration": 0.2, "eos": false,
                             "tags": [], "type": "word", "confidence": 1 }] }] }
```

`eos` marks a sentence end. `tags` can contain `"filler"`. Skip any `type` other than `"word"`.

**Word** (output of `sequenceWords`, *sequence* seconds, sorted): `{ text, start, end, eos }`.
A word belongs to a clip when its midpoint is inside the clip's in/out. Mapping:
`seq = clipStart + (mediaTime - inPoint) / speed`. Each media file is transcribed once per run
(cache keyed by media path), and Premiere keeps the transcript after that.

**Subtitle** (output of `chunk.build`): `{ text, start, end, words, width }`. `start`/`end` are
sequence seconds snapped to frames. `width` is in template pixels at 150pt.

**font-metrics.json**: `{ font, unitsPerEm: 2048, widths: { "<char>": advanceUnits }, lowercaseSameAsUppercase }`.
Line width = Σ advance / unitsPerEm × 150. Unknown characters use the width of `n`.

**Template `definition.json`** (fields `template.js` patches per subtitle):
- `clientControls[]` with `type === 6` (the text control, id `dd1f880d-5e99-4fd9-b015-18a5f90edb86`, "TEXT"):
  `value.strDB[].str = text`, `fonteditinfo.fontEditValue = font`.
- `sourceInfoLocalized.*.capsuleparams.capParams[]` matching that id or `capPropType === 0`:
  `capPropDefault`, `textEditValue = text`, `fontTextRunLength = [text.length]`, `fontEditValue = [font]`.
- `capsuleID` = new UUID v4. `capsuleName` and `capsuleNameLocalized.strDB[].str` = clip name.
- The other exposed controls are Turbulent Displace Size (`f77ceb5f-…`) and Amount (`d0d96434-…`).
  There is no color control.
- The baked `.mogrt` is a STORED zip: `definition.json`, `project.aegraphic`, `thumb.png`. It's written to
  `plugin-temp:/run-<timestamp>-sub-NNNN.mogrt`, and old `run-*` files are deleted at the start of each Generate.

**Timeline result**: one clip per subtitle on a single video track, named `Sub - <text>` (filesystem-safe,
≤48 characters of text). The name prefix is how `findGenerated`/`removeAll` recognise the tool's clips, so
keep it. Motion: position `PointF(0.5, heightPercent/100)` (normalised), scale
`100 × frameWidth/1920 × size/100`, rotation in degrees.

**Template look** (made in AE; source `~/Documents/Youtube/PresetsImade/Wiggle Text (converted).aep`, installed
as `~/Library/Application Support/Adobe/Common/Motion Graphics Templates/Boil Text.mogrt`): 1920-wide comp,
150pt text centered, Turbulent Displace Amount 9.9 / Size 30, Random Seed expression `posterizeTime(4); random(100)`.

## Grouping rules (`chunk.js`)

- A group closes when: the previous word has `eos` ("sentence"), the silence before the next word is
  > `pauseBreak` 0.6s ("pause"), or the group reaches `maxWords` or adding the word would exceed
  `maxWidth` ("limit"). `maxWidth` = `ST.chunk.lineLimit(size)` = 1920 × 0.88 / **max(1, size/100)**.
  Never more than 1920 × 0.88: the AE comp is 1920 wide and clips text outside it *before* Premiere's Motion scale
  shrinks the clip, so a Size below 100% can't make room for longer lines. (Until 1.3.1 it divided by size/100 alone,
  which at Size 60% allowed 2816 px lines; the user saw "because I had to type every" cut off at both ends.) At 60%
  a line therefore fills at most ~53% of the frame; longer lines at small sizes would need a wider comp in the
  template. A single word wider than the limit still becomes its own subtitle (it can't be split).
- Rebalance: a 1-word group right after a "limit" group of ≥3 words takes that group's last word
  (4+1 → 3+2) if it still fits.
- Timing: start on the first word. End at the next subtitle's start when the gap is ≤ 0.6s (no flicker),
  otherwise last word end + `hold` 0.25s. Minimum 0.3s, never overlapping the next one, snapped to frames.
- Known gap: groups don't know where cuts are, so one subtitle can span a cut (two characters' lines in a
  skit). The proposed fix: tag each word with its track item in `transcript.js` and close the group when it changes.

## Panel UI in Premiere's UXP (tested 2026-11-04)

- Works: flexbox, `overflow-y: auto`, `position: absolute`, `border-radius`, the Thunderman font (installed
  fonts can be used by name), `ResizeObserver`, and the built-in Spectrum widgets `sp-button` (`variant="cta"`
  is the blue button), `sp-checkbox` (`.checked`), `sp-slider` (`.value`, with "input" and "change" events and
  a `<sp-label slot="label">`), `sp-progressbar` (`.value`) and `sp-picker`. Native `<select>` works.
  Since the paper redesign only `sp-slider` and the color `<input>` are still used; the rest are divs (below).
- Doesn't work: CSS `transform` (so the preview can't show the angle), `text-shadow` (the preview's outline is
  eight black copies of the text), `aspect-ratio` (the preview's height is set from its width in JS),
  `text-transform` (the section labels are written in capitals), the `selected` look of `sp-action-button`
  (the segmented pills are plain divs with an `.on` class), and `window.innerWidth`/`innerHeight` (null).
- A text `<input>` placed directly inside a flex row stretches. Wrap it in a `<span>` to keep its width.
- The body never scrolls by itself. Keep the `#main` (scrolls) + `#footer` (pinned) layout.
- Test the UI live with the dev copy (UDT Watch reloads on save). `eval` can read the DOM, for example
  `getBoundingClientRect()` and `ST.app.readForm()`. Real mouse clicks in the floating panel need full-screen control,
  but `el.dispatchEvent(new Event("click"))` in `eval` runs the panel's click handlers (used to test the pickers,
  checkboxes and the Generate/Remove buttons).
- Images and styling (tested 2026-11-05 for the paper idea): `background-image` with `background-size: cover`
  works on `body` and any div, and so does `<img>`, for JPEG and PNG. URL forms that load: `plugin:/assets/x.jpg`,
  a relative `assets/x.jpg` and `data:` URIs. **`plugin://assets/...` (the form in Adobe's docs) fails.**
  `linear-gradient`, `radial-gradient`, `rgba()` colors, dashed borders and a `<style>` element added from JS work.
  `box-shadow` doesn't, and `opacity: 0.5` showed no visible change. Installed fonts by name all work: Chalkboard SE,
  Ditty, Bradley Hand, Comic Sans MS, Marker Felt, Noteworthy, Chalkduster. `sp-checkbox` text takes `color`,
  but the box stays in Premiere's dark theme. `sp-slider` looks fine on a light background once its `sp-label` is
  recolored, but its number stays light gray.
- Native controls ignore CSS colors and stay in Premiere's dark theme: `<select>` (background ignored) and text
  `<input>` (always a dark frame; the paper UI styles it as black label tape). They are also drawn above all HTML,
  so a floating menu would end up under them, and that's why the pickers open as an inline list.
- `sp-slider` hides its light-grey number with `show-value="false"` (it also shows none without a label slot).
- Sizes are **border-box**: `width`/`height` include the border.
- `position: relative` with `top`/`left` moves an element without moving its neighbours (the title wiggle uses it).
- `getBoundingClientRect()` right after adding an element returns 0. Wait ~300ms (layout is asynchronous).
- Background `app_zoom`/`app_screenshot` of Premiere's window does show the floating panel, so the panel can be
  checked by eye without full-screen control. Scroll it with `eval` (`#main.scrollTop = N`).

## Premiere 26.5.2 UXP API facts (tested live)

Cannot:
- Read or set any title text. The MOGRT "TEXT" param and native "Source Text" return null, and
  `createKeyframe(string)` throws "Illegal Parameter type". `ppro.MogrtText`, `isMogrt` and
  `getMogrtComponent` exist inside the binary but aren't exposed. Adobe's docs list them for **27.0**.
- Add tracks (no API). `fs.mkdirSync` doesn't exist. `getInterpolationAtKeyframe` doesn't exist.
- Place an imported `.srt` on the timeline (import works, placing doesn't).

Can (and how):
- `SequenceEditor.getEditor(seq).insertMogrtFromPath(nativePath, TickTime, videoTrackIndex, audioTrackIndex)`
  inside `project.lockedAccess`. It returns the new track items. It's a **ripple insert on that track only**
  (later clips on that track move, other tracks don't), the default length is 30s, and a track index past
  the last track gives "Invalid parameter". That's why `pickTrack` needs a track that's empty from the first
  subtitle onward. The MOGRT's "Graphic Parameters" component (`AE.ADBE Capsule`) appears only seconds after insert.
- Edits go through `project.lockedAccess(() => project.executeTransaction(compound => compound.addAction(...), name))`.
  Many actions in one transaction are fine.
- `item.createSetEndAction(TickTime)`. `param.createSetValueAction(param.createKeyframe(value), true)` for numbers,
  `new ppro.PointF(x, y)` and `new ppro.Color(r, g, b, a)`. Motion component (`AE.ADBE Motion`) params: 0 position,
  1 scale, 4 rotation.
- `VideoFilterFactory.createComponent("AE.ADBE Tint")` (or `"AE.ADBE Turbulent Displace"`), then
  `chain.createAppendComponentAction(component)`.
- `Transcript.hasTranscript / transcribeClipProjectItem(clip, { language }) / exportToJSON / querySupportedLanguages`.
  An empty transcript counts as missing.
- Remove: `TrackItemSelection.createEmptySelection(sel => …)`. Use `sel` **inside** the callback (outside it,
  "The script object is no longer valid"), then `editor.createRemoveItemsAction(sel, false, MediaType.ANY, false)`.
- `createOverwriteItemAction` wants the raw `ProjectItem`, not `ClipProjectItem.cast(...)` ("Invalid parameter").
- `Exporter.exportSequenceFrame(seq, TickTime, fileName, folderPath, width, height)` for visual checks.
- Nested and multicam sequences on the audio track can't be transcribed (`clip.isSequence()`), so they're skipped
  with a log line. Reversed clips are skipped too.
- File URLs in UXP: `plugin:/` (read-only plugin folder), `plugin-temp:/`, `file:/abs/path`.

When the user updates Premiere, check `typeof require("premierepro").MogrtText` first. If it exists, set text
directly and stop baking per-subtitle templates.

## Development workflow

1. **Load the dev panel:** open Adobe UXP Developer Tools, find Subby Dev (or Add Plugin →
   `premiere-panel/manifest.json`), then **Load** and **Watch**. With Watch on, saving a file reloads the panel.
   After a Premiere restart it may need Load again. The panel lives in Window › UXP Plugins › Subby Dev.
2. **Drive it with the dev bridge** (needs the panel open and **"SubtitleTool Test" as the active project**.
   Every editing action refuses to run in any other project, so it can't touch the user's real videos):
   ```bash
   python3 -I dev-bridge/send.py ping
   python3 -I dev-bridge/send.py useSequence '{"name": "Talking Test"}'
   python3 -I dev-bridge/send.py generate '{"settings": {"allCaps": true}}' --timeout 300
   python3 -I dev-bridge/send.py exportFrame '{"time": 3.5, "name": "check.png"}'
   python3 -I dev-bridge/send.py remove
   python3 -I dev-bridge/send.py eval '{"code": "const {sequence} = await h.context(); return sequence.name;"}'
   python3 -I dev-bridge/send.py save
   ```
   Protocol: `send.py` writes `dev-bridge/command.json` `{id, action, args}`. The panel polls it every 0.5s and
   writes `result.json` `{id, action, ok, data | error, ms, lines}`, where `lines` is the panel log during the
   command. `status.json` is a heartbeat `{alive, lastId, busy, host}` every 3s. A stale `alive` time means the
   panel isn't running. `eval` code runs as an async function with `(ppro, ST, h, args)`, where
   `h = { context, log }`. Exit codes: 0 ok, 1 command failed, 2 timeout.
3. **Check the result by looking:** frames land in `test-project/frames/`. Read the PNG, or tile several with
   ffmpeg (`vstack=inputs=N`) to see many subtitles at once.
4. **Grouping without Premiere:** `node tools/test_chunk.js` should report 0 too wide and 0 overlaps, and its Size
   check (40–250%, 6 words) 0 lines cut off or off screen (it exits 1 otherwise).
5. **Changed the template or font?** Run `python3 tools/prepare_assets.py [font.ttf] [template.mogrt]`.
6. **Ship a change to the installed copy:** bump `version` in `premiere-panel/manifest.json`, run
   `python3 -I tools/package.py`, then install. Either double-click the `.ccx` (Creative Cloud asks to confirm) or run
   ```bash
   "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "$PWD/dist/Subby.ccx"
   ```
   Check with `--list all`. Remove with `--remove Subby` (`--list all` shows the current name).
   **Upgrades:** normally `--install` marks the old version "uninstalling" and the new one "enabled" in
   `premierepro.json`, and keeps the saved settings (1.3.0 → 1.3.1 went like that). Check `premierepro.json` after
   installing. **Quirk (2026-11-05, 1.2.0 → 1.3.0, while an old 1.1.0 "uninstalling" entry was still there):**
   `--install` left the old version registered too, so both showed as "Enabled". `--remove <name>` takes out one
   entry per call, oldest first (folder included), so run it until only the new version is left, checking
   `premierepro.json` after each call. `--remove` also **deletes the plugin's saved settings**
   (`~/Library/Application Support/Adobe/UXP/PluginsStorage/PPRO/26/External/com.akshaj.subtitletool`), so copy
   that folder first and put it back afterwards. Premiere loads newly installed plugins at
   startup, so restart it. `require("uxp").pluginManager` is undefined in Premiere, so you can't list plugins
   from code. Look at Window › UXP Plugins (`app_menu` list works even when the screen is locked) or at `premierepro.json`.
   UDT has two rows: the dev copy (shown as "SubtitleTool Dev" or "Subby Dev"; use this one, Load & Watch) and a stale
   "SubtitleTool" row with the release ID, left over from before the ID split. Don't load the stale row.
   To restart Premiere: save the test project (`send.py save`), then use Premiere › Quit Premiere through `app_menu`.
   Relaunch with `open -g -a "Adobe Premiere Pro 2026"` and then File › Open Recent through `app_menu`. Passing the
   `.prproj` to `open` seemed to leave an extra empty `test-project/test.prproj` open, which then asked to be saved on quit.

Test project sequences: *Talking Test* (20s computer-voice speech, 19 subtitles), *Cut Test* (clip trimmed to
in 5.7s and moved to 7.7s, 13 subtitles with the current grouping), *Long Test* (83s; the last full run made 104 subtitles in 5.9s,
transcription included), *Baked Text Test* and
*SubtitleTool Test Sequence* (early experiments). Media is in `test-project/media/`
(made with macOS `say` + ffmpeg; each mp4 has video and audio, like camera footage).

If computer control is needed (UDT clicks, file dialogs), the background `app_*` tools didn't work in macOS
open panels. Full-screen control was needed once and then released.

## Ideas and open items (none started)

- **Break subtitles at cuts**, for skits with back-and-forth dialogue (proposed to the user, not answered yet).
- Read **several audio tracks** (dialogue split across A1/A2), breaking groups when the source changes.
- **Premiere 27:** use `MogrtText` to set text on one template instead of baking a copy per subtitle.
- Expose a **color control** in the AE template instead of using a Tint effect.
- The transcript has **speaker** labels, which could give per-character colors (untested whether Premiere
  tells apart one person doing different voices).
- Paper UI second pass (left out of the first one on purpose): tilted washi tape or doodle stickers as pre-rotated PNGs
  (no CSS rotation), and custom paper-style sliders instead of `sp-slider`.
