#!/usr/bin/env python3
"""Quick inspection of /world/snapshot/full structure."""

import json
import sys
import urllib.request
import ssl
from collections import Counter

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
with urllib.request.urlopen("https://drupal-three-js-theme.ddev.site/world/snapshot/full", context=ctx) as r:
    snapshot = json.load(r)

print(f"snapshot version: {snapshot['version']}, generatedAt: {snapshot['generatedAt']}")
print(f"sectors: {len(snapshot['sectors'])}, entities: {len(snapshot['entities'])}")

print("\n=== sectors ===")
for sid, sec in sorted(snapshot["sectors"].items()):
    centroid = sec.get("centroid", {})
    print(f"  {sid}: name={sec.get('displayName')} centroid=({centroid.get('x', '?'):.1f},{centroid.get('z', '?'):.1f})")

print("\n=== entities by sector ===")
counter = Counter()
for eid, ent in snapshot["entities"].items():
    counter[ent.get("sector", "NONE")] += 1
for sid, n in sorted(counter.items()):
    print(f"  sector {sid}: {n} entities")

print("\n=== entity ids ===")
print(" ", sorted(snapshot["entities"].keys()))
