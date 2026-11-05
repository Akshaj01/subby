"""Prepare the panel's assets from the user's font and After Effects template.

Writes into premiere-panel/assets/:
  font-metrics.json   advance widths for the subtitle font (used to keep subtitles on screen)
  template/           the .mogrt's parts (definition.json, project.aegraphic, thumb.png),
                      which the panel re-zips once per subtitle with the text baked in.

Usage: python3 tools/prepare_assets.py [FONT.ttf] [TEMPLATE.mogrt]
"""
import json
import os
import struct
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "premiere-panel", "assets")
DEFAULT_FONT = os.path.expanduser("~/Library/Fonts/Thunderman.ttf")
DEFAULT_TEMPLATE = os.path.expanduser(
    "~/Library/Application Support/Adobe/Common/Motion Graphics Templates/Boil Text.mogrt"
)


def read_tables(data):
    num_tables = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(num_tables):
        tag, _, offset, length = struct.unpack(">4sIII", data[12 + 16 * i: 28 + 16 * i])
        tables[tag.decode("latin1")] = (offset, length)
    return tables


def cmap_format4(data, offset):
    """Return {codepoint: glyph_id} from the first Unicode format-4 subtable."""
    num = struct.unpack(">H", data[offset + 2: offset + 4])[0]
    sub = None
    for i in range(num):
        pid, eid, sub_off = struct.unpack(">HHI", data[offset + 4 + 8 * i: offset + 12 + 8 * i])
        if (pid, eid) in ((3, 1), (0, 3), (0, 4), (0, 1), (3, 0)):
            if struct.unpack(">H", data[offset + sub_off: offset + sub_off + 2])[0] == 4:
                sub = offset + sub_off
                break
    if sub is None:
        raise ValueError("No format-4 cmap subtable")
    seg_x2 = struct.unpack(">H", data[sub + 6: sub + 8])[0]
    seg = seg_x2 // 2
    ends = struct.unpack(">%dH" % seg, data[sub + 14: sub + 14 + seg_x2])
    starts_off = sub + 16 + seg_x2
    starts = struct.unpack(">%dH" % seg, data[starts_off: starts_off + seg_x2])
    deltas = struct.unpack(">%dh" % seg, data[starts_off + seg_x2: starts_off + 2 * seg_x2])
    ro_off = starts_off + 2 * seg_x2
    range_offsets = struct.unpack(">%dH" % seg, data[ro_off: ro_off + seg_x2])
    mapping = {}
    for i in range(seg):
        for cp in range(starts[i], ends[i] + 1):
            if cp == 0xFFFF or cp > 0x24F:
                continue
            if range_offsets[i] == 0:
                gid = (cp + deltas[i]) & 0xFFFF
            else:
                addr = ro_off + 2 * i + range_offsets[i] + 2 * (cp - starts[i])
                gid = struct.unpack(">H", data[addr: addr + 2])[0]
                if gid:
                    gid = (gid + deltas[i]) & 0xFFFF
            if gid:
                mapping[cp] = gid
    return mapping


def font_metrics(path):
    data = open(path, "rb").read()
    t = read_tables(data)
    head = t["head"][0]
    units_per_em = struct.unpack(">H", data[head + 18: head + 20])[0]
    hhea = t["hhea"][0]
    n_hmetrics = struct.unpack(">H", data[hhea + 34: hhea + 36])[0]
    hmtx = t["hmtx"][0]
    advances = [struct.unpack(">H", data[hmtx + 4 * i: hmtx + 4 * i + 2])[0] for i in range(n_hmetrics)]
    cmap = cmap_format4(data, t["cmap"][0])
    widths = {}
    for cp, gid in cmap.items():
        widths[chr(cp)] = advances[gid] if gid < len(advances) else advances[-1]
    lower_is_caps = all(cmap.get(ord(c)) == cmap.get(ord(c.upper())) for c in "abcdefghijklmnopqrstuvwxyz")
    return {
        "font": os.path.splitext(os.path.basename(path))[0],
        "unitsPerEm": units_per_em,
        "widths": widths,
        "lowercaseSameAsUppercase": lower_is_caps,
    }


def extract_template(path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for name in names:
            if name == "thumb.mp4":
                continue  # 1 MB preview video; not needed for per-subtitle copies
            with open(os.path.join(out_dir, os.path.basename(name)), "wb") as f:
                f.write(z.read(name))
    definition = json.load(open(os.path.join(out_dir, "definition.json")))
    text_controls = [c["id"] for c in definition["clientControls"] if c.get("type") == 6]
    font_info = [c.get("fonteditinfo") for c in definition["clientControls"] if c.get("type") == 6]
    return {"files": [n for n in names if n != "thumb.mp4"], "textControls": text_controls, "fontInfo": font_info}


def main():
    font = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FONT
    template = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_TEMPLATE
    os.makedirs(ASSETS, exist_ok=True)

    metrics = font_metrics(font)
    with open(os.path.join(ASSETS, "font-metrics.json"), "w") as f:
        json.dump(metrics, f)
    print("font:", metrics["font"], "unitsPerEm", metrics["unitsPerEm"], "glyphs", len(metrics["widths"]),
          "lowercase==uppercase:", metrics["lowercaseSameAsUppercase"])

    info = extract_template(template, os.path.join(ASSETS, "template"))
    print("template:", info)


if __name__ == "__main__":
    main()
