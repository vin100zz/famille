"""
website_to_json.py
Extrait les documents des pages HTML du site "website" et enrichit carle.json.

Pour chaque page HTML sous website/pages/ qui référence un ou plusieurs couples
[N/M] (numéros Sosa), le script :
  1. Identifie les sections par couple grâce aux titres contenant [N/M]
  2. Extrait les blocs <div class="conteneur1"> comme documents structurés
  3. Met à jour le champ "documents" des familles correspondantes dans carle.json

Usage (depuis la racine du projet) :
    python data/converter/website_to_json.py [--dry-run] [--verbose]
"""

import json
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WEBSITE_ROOT = Path("website/pages")
JSON_PATH = Path("data/carle.json")
OUTPUT_PATH = Path("data/carle.json")

RE_COUPLE = re.compile(r"\[(\d+)/(\d+)\]")
RE_YEAR = re.compile(r"\b(1[0-9]{3}|20[0-2][0-9])\b")
RE_SOSA_IN_FILENAME = re.compile(r"^(\d+)")
# Images décoratives à ignorer
RE_SKIP_IMG = re.compile(
    r"(armes\.png|100\.jpg|armes_\w+\.jpg|fond\.|logo\.)", re.IGNORECASE
)

HEADING_TAGS = {"h1", "h2", "h3", "h4"}


# ---------------------------------------------------------------------------
# Helpers JSON
# ---------------------------------------------------------------------------


def build_sosa_to_family(data: dict) -> dict:
    """Retourne {(sosa_min, sosa_max): family_id} pour toutes les familles."""
    indis = data["individus"]
    fams = data["familles"]
    result = {}
    for fid, fam in fams.items():
        mari_id = fam.get("mari")
        epouse_id = fam.get("epouse")
        if not (mari_id and epouse_id):
            continue
        sm = indis.get(mari_id, {}).get("sosa")
        sf = indis.get(epouse_id, {}).get("sosa")
        if sm and sf:
            result[(min(sm, sf), max(sm, sf))] = fid
    return result


# ---------------------------------------------------------------------------
# Helpers HTML
# ---------------------------------------------------------------------------


def get_year_from_text(text: str) -> int | None:
    m = RE_YEAR.search(text)
    return int(m.group(1)) if m else None


def sosa_to_couple(sosa: int) -> tuple:
    """Numéro Sosa individuel → clé de couple (sosa_pair, sosa_impair)."""
    return (sosa, sosa + 1) if sosa % 2 == 0 else (sosa - 1, sosa)


def get_sosa_from_src(src: str) -> int | None:
    """Extrait le numéro Sosa du début d'un nom de fichier image."""
    name = Path(src).name
    m = RE_SOSA_IN_FILENAME.match(name)
    return int(m.group(1)) if m else None


def is_conteneur(tag) -> bool:
    """Vérifie si un tag est un div.conteneur1."""
    if not isinstance(tag, Tag) or tag.name != "div":
        return False
    classes = tag.get("class") or []
    id_ = tag.get("id") or ""
    return any("conteneur1" in c.lower() for c in classes) or "conteneur1" in id_.lower()


def extract_html_text(tag) -> str:
    """
    Extrait le texte d'un tag en transformant les <br> en '<br/>'
    pour les conserver dans le JSON (fidèle au format 168/169).
    """
    parts = []
    for item in tag.descendants:
        if isinstance(item, NavigableString):
            s = str(item)
            if s.strip():
                parts.append(s.strip())
        elif isinstance(item, Tag) and item.name == "br":
            parts.append("<br/>")
    text = "".join(parts).strip()
    # Supprimer les <br/> en fin de texte
    text = re.sub(r"(<br/>|\s)+$", "", text).strip()
    return text


def process_conteneur(conteneur: Tag, rel_dir: str) -> dict | None:
    """
    Extrait le contenu d'un div.conteneur1.
    Retourne {'contenu': [[...], ...]} ou None.
    Chaque sous-liste correspond à une 'box'.
    """
    boxes = conteneur.find_all("div", class_="box", recursive=False)

    # Parfois les box ne sont pas des enfants directs
    if not boxes:
        boxes = conteneur.find_all("div", class_="box")

    if not boxes:
        # Pas de boxes : traiter les images directes
        imgs = [
            img
            for img in conteneur.find_all("img")
            if not RE_SKIP_IMG.search(img.get("src", ""))
        ]
        if not imgs:
            return None
        contenu = [
            [{"type": "IMAGE", "fichier": f'{rel_dir}/{img["src"].lstrip("./")}'}]
            for img in imgs
        ]
        return {"contenu": contenu}

    contenu = []
    for box in boxes:
        box_items = []
        # Images dans cette box
        for img in box.find_all("img"):
            src = img.get("src", "").strip()
            if src and not RE_SKIP_IMG.search(src):
                fichier = f'{rel_dir}/{src.lstrip("./")}'
                box_items.append({"type": "IMAGE", "fichier": fichier})
        # Texte dans cette box (<p> ou <q>)
        p = box.find("p")
        if p:
            text = extract_html_text(p)
            if text:
                box_items.append({"type": "TEXTE", "fichier": text})
        elif not box_items:
            # Box sans image : chercher du texte direct
            text = box.get_text(" ", strip=True)
            if text:
                box_items.append({"type": "TEXTE", "fichier": text})

        if box_items:
            contenu.append(box_items)

    return {"contenu": contenu} if contenu else None


# ---------------------------------------------------------------------------
# Extraction de l'événement précédant un conteneur
# ---------------------------------------------------------------------------


def extract_event_before(conteneur: Tag) -> tuple[int | None, str]:
    """
    Remonte les frères précédents pour trouver la description de l'événement.
    Retourne (annee|None, label).
    """
    year = None
    label_parts = []

    prev = conteneur.find_previous_sibling()
    steps = 0
    while prev is not None and steps < 6:
        steps += 1
        if isinstance(prev, NavigableString):
            prev = prev.find_previous_sibling()
            continue
        tag_name = getattr(prev, "name", "") or ""
        # Stop si on atteint un titre de section ou une ligne horizontale
        if tag_name in ("hr", "br") and steps > 1:
            break
        text = prev.get_text(" ", strip=True)
        # Stop si ce frère est lui-même un titre avec [N/M]
        if tag_name in HEADING_TAGS and RE_COUPLE.search(text):
            break

        if tag_name in HEADING_TAGS or tag_name == "p":
            if text and len(text) > 2:
                label_parts.insert(0, text)
                # Chercher cadregris
                cadre = prev.find("a", class_="cadregris") if isinstance(prev, Tag) else None
                if cadre:
                    yr_text = cadre.get_text(strip=True)
                    if yr_text.isdigit():
                        year = int(yr_text)
                elif year is None:
                    year = get_year_from_text(text)

        prev = prev.find_previous_sibling()

    label = " ".join(label_parts).strip()
    label = re.sub(r"\s+", " ", label)
    # Supprimer l'année si elle apparaît en début de label (ex : "1692 : Baptême...")
    if year:
        label = re.sub(rf"^{year}\s*[:\.]\s*", "", label).strip()
    return year, label


# ---------------------------------------------------------------------------
# Parse d'une page HTML complète
# ---------------------------------------------------------------------------


def parse_html_page(html_path: Path) -> dict[tuple, list]:
    """
    Parse une page HTML et retourne {couple_key: [documents]}.
    couple_key = (sosa_min, sosa_max)
    """
    try:
        content = html_path.read_text(encoding="latin-1")
    except Exception as e:
        print(f"  ERREUR lecture {html_path}: {e}")
        return {}

    soup = BeautifulSoup(content, "html.parser")

    # Supprimer les éléments non pertinents
    for tag in soup(["script", "style"]):
        tag.decompose()

    rel_dir = str(html_path.parent.relative_to(WEBSITE_ROOT)).replace("\\", "/")

    # ------------------------------------------------------------------
    # 1. Identifier tous les couples référencés dans la page
    # ------------------------------------------------------------------
    page_couples: list[tuple] = []  # ordre d'apparition, sans doublons
    seen_couples: set[tuple] = set()
    for m in RE_COUPLE.finditer(str(soup)):
        a, b = int(m.group(1)), int(m.group(2))
        ck = (min(a, b), max(a, b))
        if ck not in seen_couples:
            seen_couples.add(ck)
            page_couples.append(ck)

    if not page_couples:
        return {}

    result: dict[tuple, list] = {ck: [] for ck in page_couples}

    # ------------------------------------------------------------------
    # 2. Construire la liste ordonnée des "marqueurs de section"
    #    (headings avec [N/M]) dans le document
    # ------------------------------------------------------------------
    # On parcourt tous les éléments dans l'ordre du document
    # en cherchant les headings qui contiennent [N/M].
    # On note l'index dans la liste flat de tous les Tags.
    all_tags_flat = list(soup.find_all(True))
    tag_to_index = {id(t): i for i, t in enumerate(all_tags_flat)}

    section_markers: list[tuple[int, tuple]] = []  # (index, couple_key)
    for tag in soup.find_all(HEADING_TAGS):
        text = tag.get_text(" ", strip=True)
        m = RE_COUPLE.search(text)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            ck = (min(a, b), max(a, b))
            idx = tag_to_index.get(id(tag), -1)
            section_markers.append((idx, ck))
    section_markers.sort()

    def couple_at(elem_index: int) -> tuple | None:
        """Retourne le couple actif à la position donnée (dernier marqueur avant)."""
        current = None
        for m_idx, ck in section_markers:
            if m_idx <= elem_index:
                current = ck
            else:
                break
        return current

    def infer_couple_from_imgs(conteneur: Tag) -> tuple | None:
        """Infère le couple depuis les noms de fichiers image."""
        for img in conteneur.find_all("img"):
            sosa = get_sosa_from_src(img.get("src", ""))
            if sosa is not None:
                ck = sosa_to_couple(sosa)
                if ck in result:
                    return ck
        return None

    # ------------------------------------------------------------------
    # 3. Traiter chaque conteneur1
    # ------------------------------------------------------------------
    processed_ids: set[int] = set()

    for conteneur in soup.find_all(is_conteneur):
        # Éviter de traiter un conteneur imbriqué dans un autre conteneur
        if id(conteneur) in processed_ids:
            continue
        # Marquer ce conteneur et ses enfants conteneurs comme traités
        for sub in conteneur.find_all(is_conteneur):
            processed_ids.add(id(sub))
        processed_ids.add(id(conteneur))

        # Déterminer le couple
        elem_idx = tag_to_index.get(id(conteneur), -1)
        couple_key = couple_at(elem_idx)

        if couple_key is None:
            # Pas de marqueur de section avant : inférer depuis les images
            couple_key = infer_couple_from_imgs(conteneur)

        if couple_key is None:
            # Fallback : premier couple de la page (si unique ou premier trouvé)
            couple_key = page_couples[0]

        if couple_key not in result:
            continue

        # Extraire la description de l'événement
        year, label = extract_event_before(conteneur)

        # Construire le document
        doc = process_conteneur(conteneur, rel_dir)
        if not doc or not doc.get("contenu"):
            continue

        titre: dict = {"label": label}
        if year:
            titre["annee"] = year
        doc["titre"] = titre

        result[couple_key].append(doc)

    # Retourner seulement les couples avec des documents
    return {ck: docs for ck, docs in result.items() if docs}


# ---------------------------------------------------------------------------
# Mise à jour du JSON
# ---------------------------------------------------------------------------


def enrich_json(
    data: dict,
    sosa_to_family: dict,
    page_docs: dict[tuple, list],
    overwrite: bool = False,
) -> int:
    """
    Ajoute les documents extraits aux familles correspondantes.
    Retourne le nombre de familles mises à jour.
    """
    updated = 0
    for ck, docs in page_docs.items():
        fam_id = sosa_to_family.get(ck)
        if not fam_id:
            continue
        fam = data["familles"].get(fam_id)
        if not fam:
            continue
        if "documents" in fam and not overwrite:
            continue  # Ne pas écraser les documents existants
        if docs:
            fam["documents"] = docs
            updated += 1
    return updated


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------


def main():
    dry_run = "--dry-run" in sys.argv
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    overwrite = "--overwrite" in sys.argv

    print("Chargement de", JSON_PATH)
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    sosa_to_family = build_sosa_to_family(data)
    print(f"  {len(sosa_to_family)} familles avec numéros Sosa identifiés.")

    html_files = sorted(WEBSITE_ROOT.rglob("*.html"))
    print(f"\nAnalyse de {len(html_files)} pages HTML sous {WEBSITE_ROOT}...\n")

    total_pages = 0
    total_couples = 0
    total_docs = 0
    total_families_updated = 0
    skipped_no_family = []

    for html_path in html_files:
        page_docs = parse_html_page(html_path)
        if not page_docs:
            continue

        total_pages += 1
        n_docs = sum(len(v) for v in page_docs.values())
        total_docs += n_docs

        for ck in page_docs:
            if ck not in sosa_to_family:
                skipped_no_family.append((ck, html_path.relative_to(WEBSITE_ROOT)))
            else:
                total_couples += 1

        if verbose:
            rel = html_path.relative_to(WEBSITE_ROOT)
            for ck, docs in page_docs.items():
                fam_id = sosa_to_family.get(ck, "?")
                print(f"  [{ck[0]}/{ck[1]}] fam={fam_id} -> {len(docs)} doc(s)  ({rel})")

        if not dry_run:
            n = enrich_json(data, sosa_to_family, page_docs, overwrite=overwrite)
            total_families_updated += n

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Résumé :")
    print(f"  Pages traitées    : {total_pages}")
    print(f"  Couples trouvés   : {total_couples} (avec famille JSON connue)")
    print(f"  Documents extraits: {total_docs}")
    print(f"  Familles mises à jour: {total_families_updated}")

    if skipped_no_family:
        print(f"\n  Couples sans famille JSON ({len(skipped_no_family)}) :")
        for ck, path in skipped_no_family[:20]:
            print(f"    [{ck[0]}/{ck[1]}]  {path}")
        if len(skipped_no_family) > 20:
            print(f"    ... et {len(skipped_no_family) - 20} autres")

    if not dry_run:
        print(f"\nÉcriture de {OUTPUT_PATH}...")
        OUTPUT_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("Terminé.")
    else:
        print("\n(Aucune écriture en mode dry-run)")


if __name__ == "__main__":
    main()





