# Subby

Source: https://github.com/Akshaj01/subby (private).

A Premiere Pro panel that transcribes the active sequence and drops a **Boil Text**
subtitle clip (Thunderman, white, black outline, line boil) on the timeline for every
few words. Built and tested on Premiere Pro 2026 (26.5.2).

## Using it

1. Open the panel: **Window › UXP Plugins › Subby**. Drag its tab to dock it anywhere.
2. Open your sequence. Your voice should be on **A1**. You can pick another track under Voice track.
3. Make sure the **top video track is empty** from where the talking starts. If every track is
   in use, add one first (Sequence › Add Tracks).
4. Press **Generate subtitles**. A progress bar shows while it works, then a ✓ line with the count.

The **preview** at the top of the panel shows sample words with your word count, caps, position,
size and color. Lines that would be too wide lose words, just like the real subtitles. The angle
isn't drawn there, because Premiere's plugin panels can't rotate text.

The first run on a clip runs Premiere's speech to text: about 4 seconds for 80 seconds of
speech in testing. After that the transcript is reused. Placing roughly 100 subtitles takes about 2 seconds.

**Fixing a typo:** select the subtitle clip, then edit **TEXT** in the Essential Graphics panel.
**Starting over:** press **Remove**. It only removes clips Subby made (their
names start with `Sub - `), and Cmd+Z undoes it.

### Settings

| Setting | Default | What it does |
|---|---|---|
| Voice track | A1 | Which track's speech is transcribed. Cuts and trims are respected. |
| Language | English (US) | Premiere's transcription language |
| Words per subtitle (max) | 4 | Buttons 1–6. Lines that would be too wide drop to fewer words, and a lone leftover word is rebalanced (4+1 becomes 3+2). |
| ALL CAPS | off | |
| Drop periods and commas | on | `?` and `!` are kept |
| Drop filler words | on | Words Premiere tags as filler (um, uh) |
| Position / Height | Bottom (82%) | Top, Middle and Bottom presets, or drag the Height slider. It's the vertical position of the subtitle's center. |
| Size | 100% | Slider, 40–250%. Also scales automatically for non-1080p sequences |
| Angle | 0° | Slider, −45° to 45° |
| Color | #FFFFFF | Click a swatch or type a hex code. Anything other than white adds a Tint effect, which keeps the outline black |

Settings are remembered between sessions.

Subtitles start on their first word and stay up until the next one, or briefly after
the last word when you pause. They never cross a sentence end or a pause longer than 0.6s.

## Installing

The plugin ID is still `com.akshaj.subtitletool` from before the rename, so settings and panel layout carry over.

Subby is installed as a normal plugin, so you don't need the Developer Tool. Open it from
**Window › UXP Plugins › Subby**. After installing or updating, restart Premiere once.

- **Update after code changes:** run `python3 tools/package.py`, then double-click
  `dist/Subby.ccx`. Creative Cloud asks you to confirm, because the plugin
  isn't from the Adobe marketplace.
- **Uninstall:** Creative Cloud app › Plugins › Manage plugins › ••• › Uninstall.
- Keep Premiere › Settings › Plugins › **Enable developer mode** switched on. Adobe lists it as required
  for plugins installed from a file.

**Development copy:** `premiere-panel/` loaded through Adobe UXP Developer Tools appears as
**Subby Dev**. It has a different plugin ID, so it can sit next to the installed one. Only the dev
copy includes the bridge Claude uses for testing.

## How it works (and why)

Premiere 26.5's plugin API can't change a title's text. The code for that exists inside
Premiere but isn't switched on until version 27. A `.mogrt` is a zip file whose
`definition.json` holds the default text, so for each subtitle the panel writes a copy of the
Boil Text template with the words and font baked in, inserts it, and trims it to the timing.

- Each subtitle becomes its own item in the project's **Motion Graphics Template Media** bin,
  with a small folder next to the project file. That's normal for templates.
- Inserting a template pushes later clips *on that track* down the timeline, which is why it
  needs an empty track.
- Nested sequences on the audio track can't be transcribed. Put the source clip there instead.

## Files

- `CLAUDE.md`: developer handover covering purpose, architecture, data formats, tested Premiere API limits and the
  dev workflow. Claude reads it automatically when working in this folder.
- `premiere-panel/`: the plugin (`main.js` for the panel, `src/` for transcript, word grouping,
  template baking, placement, and a zip writer)
- `premiere-panel/assets/`: font widths and the template parts. Rebuild after changing the
  template or font with `python3 tools/prepare_assets.py [font.ttf] [template.mogrt]`.
- `tools/package.py` → `dist/`: builds the installable `.ccx` (release ID, no dev bridge).
- `tools/test_chunk.js`: checks the word grouping against a saved transcript (`node tools/test_chunk.js`).
- `dev-bridge/`: lets Claude drive the panel during development (`python3 dev-bridge/send.py ping`).
  It only edits the "SubtitleTool Test" project. Switch it off with `ENABLED = false` in
  `premiere-panel/src/devbridge.js`.
- `test-project/`: the test project, media and exported frames. Kept out of git (`.gitignore`), so a fresh
  clone doesn't have it.
