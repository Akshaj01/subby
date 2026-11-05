"""Build the installable plugin (.ccx) from premiere-panel/.

The development copy (premiere-panel/) has its own ID and name ("Subby Dev") and
includes the dev bridge. The package gets the release ID and name and leaves the bridge out,
so both can be installed side by side without clashing.

Usage: python3 tools/package.py            -> dist/Subby.ccx
Install: double-click the .ccx (Creative Cloud asks to confirm), or
  "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install dist/Subby.ccx
"""
import json
import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "premiere-panel")
DIST = os.path.join(ROOT, "dist")

# The ID predates the "Subby" name. Keep it: changing it would make Premiere treat Subby as a new
# plugin (lost settings and panel layout, and the old copy would need uninstalling).
RELEASE_ID = "com.akshaj.subtitletool"
RELEASE_NAME = "Subby"
DEV_ONLY = {"src/devbridge.js"}


def release_manifest():
    with open(os.path.join(SRC, "manifest.json")) as f:
        manifest = json.load(f)
    manifest["id"] = RELEASE_ID
    manifest["name"] = RELEASE_NAME
    for entry in manifest.get("entrypoints", []):
        entry["label"] = {"default": RELEASE_NAME}
    return manifest


def release_html():
    with open(os.path.join(SRC, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for path in DEV_ONLY:
        html = re.sub(r'\s*<script src="%s"></script>' % re.escape(path), "", html)
    return html


def plugin_files():
    """Every file under premiere-panel/ except dev-only and hidden files, as relative paths."""
    out = []
    for folder, dirs, files in os.walk(SRC):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if name.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(folder, name), SRC).replace(os.sep, "/")
            if rel not in DEV_ONLY:
                out.append(rel)
    return out


def main():
    manifest = release_manifest()
    html = release_html()

    # Every script the page loads must be in the package, and no dev-only script may be referenced.
    files = plugin_files()
    scripts = re.findall(r'<script src="([^"]+)"', html)
    missing = [s for s in scripts if s not in files]
    leaked = [p for p in DEV_ONLY if p in html]
    if missing or leaked:
        sys.exit("Package check failed. Missing scripts: %s. Dev-only references: %s" % (missing, leaked))

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "%s.ccx" % RELEASE_NAME)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            if rel == "manifest.json":
                z.writestr(rel, json.dumps(manifest, indent=2) + "\n")
            elif rel == "index.html":
                z.writestr(rel, html)
            else:
                z.write(os.path.join(SRC, rel), rel)

    print("Built %s (%s %s, %d files, %.0f KB)" % (
        os.path.relpath(out, ROOT), manifest["id"], manifest["version"], len(files), os.path.getsize(out) / 1024))
    for rel in files:
        print("  " + rel)


if __name__ == "__main__":
    main()
