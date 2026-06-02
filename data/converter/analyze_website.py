import re
from pathlib import Path

root = Path('website/pages')
html_files = list(root.rglob('*.html'))

pattern_couple    = re.compile(r'\[(\d+)/(\d+)\]')
pattern_cadregris = re.compile(r'cadregris[^>]*>(\d{3,4})<')
pattern_img       = re.compile(r'<img\b[^>]+\bsrc\s*=\s*["\']?([^"\'> ]+)', re.IGNORECASE)
pattern_conteneur = re.compile(r'conteneur1', re.IGNORECASE)

stats = dict(total=len(html_files), with_couples=0, with_cadregris=0,
             with_images=0, with_conteneur=0, multi_couple=0, couples_found=set())

pages_without_couples = []

for f in html_files:
    try:
        content = f.read_text(encoding='latin-1')
    except Exception:
        continue
    couples = pattern_couple.findall(content)
    if couples:
        stats['with_couples'] += 1
        if len(set(couples)) > 1:
            stats['multi_couple'] += 1
        for c in couples:
            stats['couples_found'].add((int(c[0]), int(c[1])))
    else:
        pages_without_couples.append(f.relative_to(root))

    if pattern_cadregris.search(content): stats['with_cadregris'] += 1
    if pattern_img.search(content):       stats['with_images'] += 1
    if pattern_conteneur.search(content): stats['with_conteneur'] += 1

print('Total HTML              :', stats['total'])
print('Avec couples [N/M]      :', stats['with_couples'])
print('Dont multi-couples      :', stats['multi_couple'])
print('Avec cadregris (annee)  :', stats['with_cadregris'])
print('Avec images             :', stats['with_images'])
print('Avec conteneur1         :', stats['with_conteneur'])
print('Couples uniques         :', len(stats['couples_found']))
if stats['couples_found']:
    print('Sosa min/max            :', min(c[0] for c in stats['couples_found']),
          '/', max(c[0] for c in stats['couples_found']))
print()
print('Pages SANS reference [N/M] ({}) :'.format(len(pages_without_couples)))
for p in sorted(pages_without_couples)[:20]:
    print(' ', p)
if len(pages_without_couples) > 20:
    print('  ... et', len(pages_without_couples) - 20, 'autres')

