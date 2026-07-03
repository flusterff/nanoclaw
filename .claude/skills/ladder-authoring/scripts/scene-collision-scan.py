#!/usr/bin/env python3
"""scene-collision-scan.py — 씬 프레임별 텍스트 bbox 충돌 스캔 (원장 #12, v1).
사용: python3 scene-collision-scan.py <scene.html> [<scene2.html> ...]
프레임 키는 숫자(1..6,F)와 f-접두 둘 다 시도. 한계(v1): 텍스트-텍스트 충돌만 —
텍스트-오브젝트 충돌은 미검출(v2 후보). 눈 QA(절대 규칙 12)를 대체하지 않는 보조 신호."""
import sys, json
from playwright.sync_api import sync_playwright

JS = """
() => {
  const fr=[...document.querySelectorAll('.frame')].find(e=>e.style.display!=='none');
  const svg=fr?fr.querySelector('svg'):document.querySelector('svg');
  if(!svg) return null;
  const t=[...svg.querySelectorAll('text')].map(x=>({s:(x.textContent||'').trim().slice(0,14),r:x.getBoundingClientRect()}));
  const out=[];
  for(let i=0;i<t.length;i++) for(let j=i+1;j<t.length;j++){
    const a=t[i].r,b=t[j].r;
    const ox=Math.min(a.right,b.right)-Math.max(a.left,b.left), oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(ox>4&&oy>4) out.push(t[i].s+" × "+t[j].s);
  }
  return out;
}"""

def main():
    files = sys.argv[1:]
    if not files:
        print(__doc__); sys.exit(1)
    fail = False
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 980, "height": 620})
        for f in files:
            print(f"== {f.split('/')[-1]} ==")
            for base in ["1", "2", "3", "4", "5", "6", "F"]:
                hits = None
                for key in [base, "f" + base]:
                    pg.goto(f"file://{f}?frame={key}&embed"); pg.wait_for_timeout(280)
                    hits = pg.evaluate(JS)
                    if hits is not None: break
                if hits:
                    fail = True
                    print(f"  [FAIL] f{base}: {'; '.join(hits[:4])}")
            if not fail:
                print("  [PASS] 텍스트 충돌 0 (텍스트-오브젝트는 눈 QA 필요)")
        b.close()
    sys.exit(1 if fail else 0)

if __name__ == "__main__":
    main()
