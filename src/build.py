"""Rebuild the site: inlines engine.js and sim.js into each page template.
   src/template.html      -> index.html       (Logo to PES)
   src/draw-template.html -> draw/index.html  (Draw to PES)"""
import pathlib
src = pathlib.Path(__file__).parent
root = src.parent
eng = (src / 'engine.js').read_text()
sim = (src / 'sim.js').read_text()
pages = [('template.html', root / 'index.html'), ('draw-template.html', root / 'draw' / 'index.html')]
for tpl, out in pages:
    t = (src / tpl).read_text().replace('/*ENGINE*/', eng).replace('/*SIM*/', sim)
    out.parent.mkdir(exist_ok=True)
    out.write_text(t)
    print('wrote', out.relative_to(root), len(t), 'bytes')
