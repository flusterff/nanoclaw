#!/usr/bin/env python3
"""Render every frame of a scene HTML to PNG via ?frame=N&embed.

Usage: python3 shot_scene.py <scene.html> <outdir> [frame_keys...]
Frame keys default: 1 2 3 4 5 6 F  (router pattern: el.id !== 'f'+fr)
Captures the element #f{key}; falls back to full page ONLY with an explicit
warning (md5-identical fallback shots were a verified QA failure mode).
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

scene = pathlib.Path(sys.argv[1]).resolve()
outdir = pathlib.Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
keys = sys.argv[3:] or ["1", "2", "3", "4", "5", "6", "F"]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1000, "height": 900})
    for k in keys:
        url = f"file://{scene}?frame={k}&embed"
        pg.goto(url)
        pg.wait_for_timeout(250)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        el = pg.query_selector(f"#f{k}")
        out = outdir / f"f{k}.png"
        if el:
            el.screenshot(path=str(out))
            print(f"f{k}: element shot -> {out}")
        else:
            pg.screenshot(path=str(out), full_page=True)
            print(f"f{k}: WARNING element #f{k} NOT FOUND — full-page fallback (check frame keys!)")
    b.close()
