"""Experiment: bake subtitle text (and font) into a copy of an After Effects .mogrt.

Premiere 26.5 plugins cannot set a title's text, so this writes a new .mogrt whose
*default* text is the subtitle. Usage:
  python3 make_mogrt.py SOURCE.mogrt OUT.mogrt "SUBTITLE TEXT" [FontPostScriptName]
"""
import json
import sys
import uuid
import zipfile


def patch_text_control(control, text, font):
    """Update a text clientControl (type 6) in place."""
    for entry in control.get("value", {}).get("strDB", []):
        entry["str"] = text
    info = control.get("fonteditinfo")
    if info is not None and font:
        info["fontEditValue"] = font


def patch_capsule_param(param, text, font):
    """Update the matching capsuleparams entry (capPropType 0 = text)."""
    param["capPropDefault"] = text
    param["textEditValue"] = text
    param["fontTextRunLength"] = [len(text)]
    if font and "fontEditValue" in param:
        param["fontEditValue"] = [font]


def main():
    src, out, text = sys.argv[1], sys.argv[2], sys.argv[3]
    font = sys.argv[4] if len(sys.argv) > 4 else None

    with zipfile.ZipFile(src) as zin:
        definition = json.loads(zin.read("definition.json"))
        others = {n: zin.read(n) for n in zin.namelist() if n != "definition.json"}

    text_ids = set()
    for control in definition.get("clientControls", []):
        if control.get("type") == 6:
            patch_text_control(control, text, font)
            text_ids.add(control["id"])

    for info in definition.get("sourceInfoLocalized", {}).values():
        for param in info.get("capsuleparams", {}).get("capParams", []):
            if param.get("capPropMatchName") in text_ids or param.get("capPropType") == 0:
                patch_capsule_param(param, text, font)

    # A fresh capsule ID so Premiere doesn't reuse a cached copy of another subtitle.
    definition["capsuleID"] = str(uuid.uuid4())
    name = "Sub - " + text[:40]
    definition["capsuleName"] = name
    for entry in definition.get("capsuleNameLocalized", {}).get("strDB", []):
        entry["str"] = name

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("definition.json", json.dumps(definition))
        for n, data in others.items():
            zout.writestr(n, data)
    print(out)


if __name__ == "__main__":
    main()
