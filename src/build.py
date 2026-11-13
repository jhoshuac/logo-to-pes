"""Rebuild the site: inlines engine.js (and the example logo) into each page template.
   src/template.html      -> index.html       (Logo to PES)
   src/draw-template.html -> draw/index.html  (Draw to PES)"""
import base64, pathlib
src = pathlib.Path(__file__).parent
root = src.parent
eng = (src / 'engine.js').read_text()
uri = 'data:image/jpeg;base64,' + base64.b64encode((src / 'example-logo.jpg').read_bytes()).decode()
pages = [('template.html', root / 'index.html'), ('draw-template.html', root / 'draw' / 'index.html')]
for tpl, out in pages:
    t = (src / tpl).read_text().replace('/*ENGINE*/', eng).replace('EXAMPLE_DATA_URI', uri)
    out.parent.mkdir(exist_ok=True)
    out.write_text(t)
    print('wrote', out.relative_to(root), len(t), 'bytes')
