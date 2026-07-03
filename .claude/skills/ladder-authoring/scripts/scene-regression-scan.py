#!/usr/bin/env python3
"""탐구형 씬 기계 회귀 스캔 v0 — 실수 원장(mistake-ledger.md)의 기계 검사 가능 항목.

사용: python3 scene-regression-scan.py <scene.html> [<scene2.html> ...]
검사 (FAIL = 리뷰어 도달 전 자동 반려):
  R1 (규칙 6a) 차가운 회색/블루그레이 균일 테두리 hex — stroke 속성에서 검출
  R2 (규칙 6b) 그라디언트 밀도 — linearGradient+radialGradient 합계 0=FAIL, 1-2=WARN
  R3 (규칙 9)  씬 표준 규격 흔적 — viewBox 높이 470 존재 + 캡션 y=452 존재 (무대형 씬 대상)
  R4 (규칙 1)  스킨톤 hex 후보(보조 신호) — 사람 신체 SVG 의심 시 WARN (판정은 리뷰어 B)
종료코드: 0=전체 PASS(WARN 허용), 1=하나라도 FAIL.
v1 후보(원장 참조): 캡션 bbox 겹침(playwright)·접점 클로즈업 자동 크롭·프레임별 marker 위치 검사.
"""
import re
import sys
import pathlib

COLD_STROKES = [  # 2026-07-03 반려 4씬에서 실측된 회색 테두리 팔레트 (규칙 6a)
    "#aab6bf", "#b9c8cd", "#ccd6de", "#c3ccd3", "#9db0bc",
    "#b3bfca", "#8fc8e6", "#aab8c2", "#9aa7b1",
]
COLD_ALLOW_HINT = "cold-mark"  # 의미 있는 차가움 포인트는 해당 줄에 cold-mark 주석으로 면책 가능
SKIN_HEXES = ["#f5cba7", "#f0b27a", "#e8beac", "#ffd1b3", "#eaac8b"]  # 보조 신호

def scan(path: pathlib.Path):
    src = path.read_text(encoding="utf-8")
    lines = src.splitlines()
    findings = []

    # R1: cold gray strokes
    hits = []
    for i, ln in enumerate(lines, 1):
        if COLD_ALLOW_HINT in ln:
            continue
        for hx in COLD_STROKES:
            if re.search(rf'stroke="{hx}"', ln, re.IGNORECASE):
                hits.append((i, hx))
    if hits:
        findings.append(("FAIL", "R1-회색테두리(6a)", f"{len(hits)}건: " + ", ".join(f"L{i}:{h}" for i, h in hits[:6])))
    else:
        findings.append(("PASS", "R1-회색테두리(6a)", "0건"))

    # R2: gradient density
    n_grad = len(re.findall(r"<(?:linear|radial)Gradient", src))
    if n_grad == 0:
        findings.append(("FAIL", "R2-그라디언트밀도(6b)", "0개 — 플랫"))
    elif n_grad < 3:
        findings.append(("WARN", "R2-그라디언트밀도(6b)", f"{n_grad}개 — v4.2 캐논은 12개"))
    else:
        findings.append(("PASS", "R2-그라디언트밀도(6b)", f"{n_grad}개"))

    # R3: scene spec (stage scenes)
    has470 = bool(re.search(r'viewBox="0 0 \d+ 470"', src)) or "||H}" in src and "H=470" in src
    has_cap452 = 'y="452"' in src or "y:452" in src or 'y="${y||452}"' in src or "y||452" in src
    if has470 and has_cap452:
        findings.append(("PASS", "R3-표준규격(9)", "H=470 + cap y=452 확인"))
    else:
        findings.append(("WARN", "R3-표준규격(9)", f"H470={has470} cap452={has_cap452} — 카드형 전용 파일이면 무시"))

    # R4: skin-tone hint
    skin = [hx for hx in SKIN_HEXES if hx.lower() in src.lower()]
    if skin:
        findings.append(("WARN", "R4-스킨톤후보(1)", f"{skin} — 사람 신체 여부 리뷰어 B 확인"))
    else:
        findings.append(("PASS", "R4-스킨톤후보(1)", "0건"))

    return findings

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    any_fail = False
    for arg in sys.argv[1:]:
        p = pathlib.Path(arg).expanduser()
        print(f"\n== {p.name} ==")
        for level, rule, detail in scan(p):
            print(f"  [{level}] {rule}: {detail}")
            if level == "FAIL":
                any_fail = True
    sys.exit(1 if any_fail else 0)

if __name__ == "__main__":
    main()
