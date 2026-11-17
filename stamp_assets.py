"""Stamp docs/index.html's local script and stylesheet links with a content hash (?v=...).

Usage: python3 -I stamp_assets.py
Cloudflare tells browsers to keep JS/CSS for hours, so an updated page would otherwise run
yesterday's scripts. Run after changing anything under docs/js or docs/fonts.
"""
import hashlib, os, re

DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")
INDEX = os.path.join(DOCS, "index.html")


def stamp(match):
    attr, path = match[1], match[2]
    with open(os.path.join(DOCS, path), "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:10]
    return f'{attr}="{path}?v={digest}"'


html = open(INDEX).read()
new = re.sub(r'(src|href)="((?:js|fonts)/[^"?]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"', stamp, html)
open(INDEX, "w").write(new)
print("\n".join(re.findall(r'(?:src|href)="(?:js|fonts)/[^"]+"', new)))
