"""
images_to_json.py
Extrait les documents des pages HTML sous images/ et enrichit carle.json.

Dossiers scannés :
  images/0_2_a_6
  images/0b_au_dela_6e_paternel
  images/0c_au_dela_6e_maternel

Pour chaque page HTML, le script :
  1. Identifie le(s) couple(s) Sosa via plusieurs patterns de titres
  2. Extrait les blocs <div class="conteneur1"> comme documents structurés
  3. Met à jour le champ "documents" des familles dans carle.json

Usage (depuis la racine du projet) :
    python data/converter/images_to_json.py [--dry-run] [--verbose] [--overwrite]
"""

import json
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

IMAGES_BASE = Path("images")
SOURCE_DIRS = [
    IMAGES_BASE / "0_2_a_6",
    IMAGES_BASE / "0b_au_dela_6e_paternel",
    IMAGES_BASE / "0c_au_dela_6e_maternel",
]
JSON_PATH   = Path("data/carle.json")
OUTPUT_PATH = Path("data/carle.json")

# Patterns de couple Sosa dans les titres
RE_COUPLE_BRACKET = re.compile(r"\[(\d+)/(\d+)\]")          # [52/53]
RE_COUPLE_BARE    = re.compile(r"(?<!\[)\b(\d+)/(\d+)\b")   # 52/53 sans crochets
RE_SINGLE_BRACKET = re.compile(r"\[(\d+)\]")                 # [30] sosa unique
# Numéro Sosa en début de nom de fichier image (ex: 58D.jpg → 58)
RE_SOSA_IN_FILENAME = re.compile(r"^(\d+)")
RE_YEAR = re.compile(r"\b(1[0-9]{3}|20[0-2][0-9])\b")

# Images décoratives à ignorer
RE_SKIP_IMG = re.compile(
    r"(armes[\._]|100\.jpg|fond\.|logo\.|arbre\.(png|jpg)$)", re.IGNORECASE
)

HEADING_TAGS = {"h1", "h2", "h3", "h4"}


# ---------------------------------------------------------------------------
# Helpers JSON
# ---------------------------------------------------------------------------

def build_sosa_to_family(data: dict) -> dict:
    """Retourne {(sosa_min, sosa_max): family_id} pour toutes les familles."""
    indis = data["individus"]
    fams  = data["familles"]
    result = {}
    for fid, fam in fams.items():
        mari_id   = fam.get("mari")
        epouse_id = fam.get("epouse")
        if not (mari_id and epouse_id):
            continue
        sm = indis.get(mari_id,   {}).get("sosa")
        sf = indis.get(epouse_id, {}).get("sosa")
        if sm and sf:
            result[(min(sm, sf), max(sm, sf))] = fid
    return result


def build_sosa_to_individu(data: dict) -> dict:
    """Retourne {sosa: individu_id} pour tous les individus avec un numéro Sosa."""
    return {
        ind["sosa"]: iid
        for iid, ind in data["individus"].items()
        if ind.get("sosa")
    }


# ---------------------------------------------------------------------------
# Extraction de noms depuis un titre de heading
# ---------------------------------------------------------------------------

RE_COUPLE_NAME = re.compile(
    r'^(.*?)\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ\'\-]+(?:\s+[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ\'\-]+)*)'
    r'\s*[&]\s*'
    r'(.*?)\s+([A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ\'\-]+(?:\s+[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÆŒ\'\-]+)*)$'
)


def parse_couple_names(text: str) -> tuple | None:
    """
    Parse 'Prénom NOM & Prénom NOM' (ou 'et') depuis un heading.
    Retourne (prenom_mari, nom_mari, prenom_epouse, nom_epouse) ou None.
    """
    # Supprimer le préfixe [N/M] ou [N]
    text = RE_COUPLE_BRACKET.sub('', text)
    text = RE_SINGLE_BRACKET.sub('', text).strip()
    # Supprimer les précisions entre parenthèses : "(vers 1740-1780)"
    text = re.sub(r'\([^)]*\)', '', text).strip()

    # Trouver le séparateur & ou " et " (minuscule pour éviter "Etienne")
    sep = None
    if '&' in text:
        sep = '&'
    elif re.search(r'\s+et\s+', text):
        sep = ' et '

    if sep is None:
        return None

    def split_prenom_nom(s: str):
        """
        Sépare 'Prénom NOM' en (prenom, nom).
        NOM = mots entièrement majuscules, y compris avec particule ou préfixe abrégé.
        """
        words = s.strip().split()
        noms, prenoms = [], []
        for w in words:
            # Supprimer préfixes hagiographiques (St-, Ste-)
            clean = re.sub(r"^(Ste|St)['\-]", "", w)
            # Supprimer particule minuscule avant ' (d', l')
            clean = re.sub(r"^[a-zàâäéèêëîïôùûü]+'", "", clean)
            # Supprimer tirets et apostrophes restants
            clean = re.sub(r"['\-]", "", clean)
            # Extraire uniquement les caractères alpha pour le test majuscule
            alpha = re.sub(r"[^A-ZÀ-Ÿa-zà-ÿ]", "", clean)
            if alpha and alpha == alpha.upper() and len(alpha) > 1:
                noms.append(w)
            else:
                prenoms.append(w)
        return ' '.join(prenoms).strip(), ' '.join(noms).strip()

    parts = text.split(sep, 1) if sep == '&' else re.split(r'\s+et\s+', text, maxsplit=1)
    if len(parts) != 2:
        return None
    prenom1, nom1 = split_prenom_nom(parts[0])
    prenom2, nom2 = split_prenom_nom(parts[1])

    # Rejeter si l'épouse est inconnue ("?")
    if nom1 and nom2 and nom2 != '?':
        return prenom1, nom1, prenom2, nom2
    return None


def _next_individu_id(data: dict) -> str:
    nums = [int(iid[1:]) for iid in data["individus"] if iid.startswith("I") and iid[1:].isdigit()]
    return f"I{max(nums, default=0) + 1}"


def _next_famille_id(data: dict) -> str:
    nums = [int(fid[1:]) for fid in data["familles"] if fid.startswith("F") and fid[1:].isdigit()]
    return f"F{max(nums, default=0) + 1}"


def _create_individu(data: dict, sosa_to_individu: dict,
                     sosa: int, prenom: str, nom: str, sexe: str) -> str:
    """Crée un individu minimal et l'enregistre dans data et sosa_to_individu."""
    new_iid = _next_individu_id(data)
    data["individus"][new_iid] = {
        "nom": nom,
        "prenom": prenom,
        "sexe": sexe,
        "sosa": sosa,
        "liens": {"unions": []},
    }
    sosa_to_individu[sosa] = new_iid
    return new_iid


def ensure_family(data: dict, sosa_to_family: dict, sosa_to_individu: dict,
                  ck: tuple, heading_text: str = "") -> str | None:
    """
    Retourne l'id de famille pour le couple ck.
    Si la famille n'existe pas :
      - Si les individus existent, crée la famille.
      - Si des noms sont extraits du heading, crée aussi les individus manquants.
    Retourne None si impossible de compléter les informations.
    """
    if ck in sosa_to_family:
        return sosa_to_family[ck]

    s_mari, s_epouse = ck  # sosa pair = mari, sosa impair = épouse
    mari_id   = sosa_to_individu.get(s_mari)
    epouse_id = sosa_to_individu.get(s_epouse)

    if not mari_id or not epouse_id:
        names = parse_couple_names(heading_text) if heading_text else None
        if not names:
            return None
        prenom1, nom1, prenom2, nom2 = names
        if not mari_id:
            mari_id   = _create_individu(data, sosa_to_individu, s_mari,   prenom1, nom1, 'M')
        if not epouse_id:
            epouse_id = _create_individu(data, sosa_to_individu, s_epouse, prenom2, nom2, 'F')

    new_fid = _next_famille_id(data)
    data["familles"][new_fid] = {"mari": mari_id, "epouse": epouse_id}
    sosa_to_family[ck] = new_fid

    # Ajouter le lien union dans chaque individu
    for iid in (mari_id, epouse_id):
        ind = data["individus"].get(iid, {})
        liens = ind.setdefault("liens", {})
        unions = liens.setdefault("unions", [])
        if not any(u.get("famille") == new_fid for u in unions):
            unions.append({"famille": new_fid})

    return new_fid


# ---------------------------------------------------------------------------
# Helpers Sosa
# ---------------------------------------------------------------------------

def sosa_to_couple(sosa: int) -> tuple:
    """Numéro Sosa individuel → clé de couple (sosa_pair, sosa_impair)."""
    return (sosa, sosa + 1) if sosa % 2 == 0 else (sosa - 1, sosa)


def is_valid_couple(a: int, b: int) -> bool:
    """Vérifie qu'un couple Sosa est valide : consécutifs, le premier est pair."""
    lo, hi = min(a, b), max(a, b)
    return hi == lo + 1 and lo % 2 == 0 and lo >= 2


def find_couples_in_text(text: str) -> list:
    """
    Cherche tous les couples Sosa dans un texte.
    Ordre de priorité : [N/M] > N/M bare > [N] single.
    Seuls les vrais couples Sosa sont retenus (consécutifs, premier pair).
    """
    found = []
    seen  = set()

    def add(a, b):
        if not is_valid_couple(a, b):
            return
        ck = (min(a, b), max(a, b))
        if ck not in seen:
            seen.add(ck)
            found.append(ck)

    for m in RE_COUPLE_BRACKET.finditer(text):
        add(int(m.group(1)), int(m.group(2)))
    for m in RE_COUPLE_BARE.finditer(text):
        add(int(m.group(1)), int(m.group(2)))
    # Single sosa uniquement si aucun couple trouvé (évite faux-positifs)
    if not found:
        for m in RE_SINGLE_BRACKET.finditer(text):
            s = int(m.group(1))
            if s >= 2:
                ck = sosa_to_couple(s)
                if ck not in seen:
                    seen.add(ck)
                    found.append(ck)
    return found


def sosa_from_img_src(src: str) -> int | None:
    """Extrait le numéro Sosa du début d'un nom de fichier image."""
    name = Path(src).name
    m = RE_SOSA_IN_FILENAME.match(name)
    if m:
        n = int(m.group(1))
        return n if n >= 2 else None
    return None


# ---------------------------------------------------------------------------
# Helpers HTML
# ---------------------------------------------------------------------------

def is_conteneur(tag) -> bool:
    if not isinstance(tag, Tag) or tag.name != "div":
        return False
    classes = tag.get("class") or []
    id_     = tag.get("id") or ""
    return (
        any("conteneur1" in c.lower() for c in classes)
        or "conteneur1" in id_.lower()
    )


def get_year_from_text(text: str) -> int | None:
    m = RE_YEAR.search(text)
    return int(m.group(1)) if m else None


def extract_html_text(tag) -> str:
    parts = []
    for item in tag.descendants:
        if isinstance(item, NavigableString):
            s = str(item)
            if s.strip():
                parts.append(s.strip())
        elif isinstance(item, Tag) and item.name == "br":
            parts.append("<br/>")
    text = "".join(parts).strip()
    text = re.sub(r"(<br/>|\s)+$", "", text).strip()
    return text


def process_conteneur(conteneur: Tag, rel_dir: str) -> dict | None:
    boxes = conteneur.find_all("div", class_="box", recursive=False)
    if not boxes:
        boxes = conteneur.find_all("div", class_="box")

    if not boxes:
        imgs = [
            img for img in conteneur.find_all("img")
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
        for img in box.find_all("img"):
            src = img.get("src", "").strip()
            if src and not RE_SKIP_IMG.search(src):
                fichier = f'{rel_dir}/{src.lstrip("./")}'
                box_items.append({"type": "IMAGE", "fichier": fichier})
        # Texte : <p>, <q> (caption), ou texte brut si pas d'image
        text_tag = box.find("p") or box.find("q")
        if text_tag:
            text = extract_html_text(text_tag)
            if text:
                box_items.append({"type": "TEXTE", "fichier": text})
        elif not box_items:
            text = box.get_text(" ", strip=True)
            if text:
                box_items.append({"type": "TEXTE", "fichier": text})
        if box_items:
            contenu.append(box_items)

    return {"contenu": contenu} if contenu else None


# ---------------------------------------------------------------------------
# Helpers : extraction du titre d'un heading
# ---------------------------------------------------------------------------

def heading_to_titre(heading: Tag) -> tuple:
    """Extrait (annee|None, label) d'un tag heading."""
    cadre = heading.find("a", class_="cadregris")
    year  = None
    if cadre:
        yr = cadre.get_text(strip=True)
        if yr.isdigit():
            year = int(yr)
    text = heading.get_text(" ", strip=True)
    if year is None:
        year = get_year_from_text(text)
    label = re.sub(r"\s+", " ", text).strip()
    if year:
        label = re.sub(rf"^{year}\s*[:\.\-–]?\s*", "", label).strip()
    return year, label


def para_to_titre(p: Tag) -> tuple:
    """Extrait (annee|None, label) d'un tag <p> qui précède un conteneur."""
    cadre = p.find("a", class_="cadregris")
    year  = None
    if cadre:
        yr = cadre.get_text(strip=True)
        if yr.isdigit():
            year = int(yr)
    text = extract_html_text(p)
    if year is None:
        year = get_year_from_text(text)
    label = re.sub(r"\s+", " ", text).strip()
    if year:
        label = re.sub(rf"^{year}\s*[:\.\-–]?\s*", "", label).strip()
    return year, label


# ---------------------------------------------------------------------------
# Parse d'une page HTML — parcours linéaire
# ---------------------------------------------------------------------------

# Classes CSS de divs textuels à traiter comme paragraphes
TEXT_DIV_CLASSES = {"cadreblanc", "cadrebleu", "cadregris", "cadre", "center"}


def parse_html_page(html_path: Path) -> dict:
    """
    Parse une page HTML et retourne {couple_key: [documents]}.
    Parcours linéaire : capture images (conteneur1), textes standalone (<p>),
    et captions (<q>) dans leur contexte de section.
    """
    try:
        content = html_path.read_text(encoding="latin-1")
    except Exception as e:
        print(f"  ERREUR lecture {html_path}: {e}")
        return {}

    soup = BeautifulSoup(content, "html.parser")
    for tag in soup(["script", "style", "map", "area"]):
        tag.decompose()

    rel_dir = str(html_path.parent.relative_to(IMAGES_BASE)).replace("\\", "/")

    # ── Identifier les couples référencés ─────────────────────────────────
    page_couples: list = []
    seen_couples: set  = set()

    for heading in soup.find_all(HEADING_TAGS):
        for ck in find_couples_in_text(heading.get_text(" ", strip=True)):
            if ck not in seen_couples:
                seen_couples.add(ck); page_couples.append(ck)

    if not page_couples:
        counts: dict = {}
        for img in soup.find_all("img"):
            s = sosa_from_img_src(img.get("src", ""))
            if s is not None:
                ck = sosa_to_couple(s)
                counts[ck] = counts.get(ck, 0) + 1
        if counts:
            best = max(counts, key=lambda k: counts[k])
            page_couples.append(best); seen_couples.add(best)

    if not page_couples:
        return {}

    result: dict = {ck: [] for ck in page_couples}
    couple_headings: dict = {}  # {ck: heading_text} pour créer les individus manquants

    # ── Parcours linéaire ─────────────────────────────────────────────────
    # État courant
    current_couple: tuple = page_couples[0]
    cur_year:  int | None = None
    cur_label: str        = ""
    pending_texts: list   = []  # textes accumulés avant un conteneur
    inside_conteneur: set = {id(t) for t in soup.find_all(is_conteneur)
                             for t in t.find_all(is_conteneur)}  # sous-conteneurs

    def flush_pending_as_doc(couple_key: tuple):
        """Crée un document texte-only à partir des paragraphes en attente."""
        nonlocal cur_year, cur_label, pending_texts
        if not pending_texts:
            return
        col = [{"type": "TEXTE", "fichier": t} for t in pending_texts]
        titre: dict = {"label": cur_label}
        if cur_year:
            titre["annee"] = cur_year
        if couple_key not in result:
            result[couple_key] = []
        result[couple_key].append({"titre": titre, "contenu": [col]})
        pending_texts = []

    def is_text_div(tag: Tag) -> bool:
        classes = set(tag.get("class") or [])
        return bool(classes & TEXT_DIV_CLASSES) and not is_conteneur(tag)

    # Récupérer les éléments de premier niveau (le contenu peut être à plat
    # dans soup ou dans soup.body selon le parseur)
    root = soup.body or soup
    top_elems = [e for e in root.children if isinstance(e, Tag)]

    # Si le contenu est emballé dans un seul div wrapper, on descend d'un niveau
    if len(top_elems) == 1 and top_elems[0].name == "div":
        top_elems = [e for e in top_elems[0].children if isinstance(e, Tag)]

    for elem in top_elems:
        tag = elem.name.lower() if elem.name else ""

        # ── Heading ───────────────────────────────────────────────────────
        if tag in HEADING_TAGS:
            text = elem.get_text(" ", strip=True)
            couples = find_couples_in_text(text)
            if couples:
                # Nouveau couple → flush les textes en attente
                flush_pending_as_doc(current_couple)
                current_couple = couples[0]
                cur_year = None; cur_label = ""
                if current_couple not in result:
                    result[current_couple] = []
                # Mémoriser le heading pour extraction de noms si besoin
                if current_couple not in couple_headings:
                    couple_headings[current_couple] = text
            else:
                # Nouvelle section : flush les textes en attente comme doc standalone
                flush_pending_as_doc(current_couple)
                cur_year, cur_label = heading_to_titre(elem)
                # Heading sans [N/M] mais avec noms → mémoriser pour le couple courant
                if current_couple not in couple_headings:
                    if '&' in text or re.search(r'\s+et\s+', text):
                        couple_headings[current_couple] = text

        # ── Paragraphe ────────────────────────────────────────────────────
        elif tag == "p":
            cadre = elem.find("a", class_="cadregris")
            text  = extract_html_text(elem)
            if not text or len(text) <= 5:
                pass
            elif cadre and cadre.get_text(strip=True).isdigit():
                # <p> avec année cadregris = en-tête d'événement → flush + nouveau titre
                flush_pending_as_doc(current_couple)
                cur_year, cur_label = para_to_titre(elem)
            else:
                pending_texts.append(text)

        # ── Conteneur1 ────────────────────────────────────────────────────
        elif is_conteneur(elem) and id(elem) not in inside_conteneur:
            # Infère le couple depuis les images si pas de marqueur de section
            if current_couple is None:
                counts2: dict = {}
                for img in elem.find_all("img"):
                    s = sosa_from_img_src(img.get("src", ""))
                    if s:
                        ck = sosa_to_couple(s)
                        counts2[ck] = counts2.get(ck, 0) + 1
                if counts2:
                    current_couple = max(counts2, key=lambda k: counts2[k])

            doc = process_conteneur(elem, rel_dir)
            if doc and doc.get("contenu"):
                # Si des textes en attente → les ajouter en première colonne
                if pending_texts:
                    col0 = [{"type": "TEXTE", "fichier": t} for t in pending_texts]
                    doc["contenu"].insert(0, col0)
                    pending_texts = []
                titre: dict = {"label": cur_label}
                if cur_year:
                    titre["annee"] = cur_year
                doc["titre"] = titre
                if current_couple not in result:
                    result[current_couple] = []
                result[current_couple].append(doc)
                # Reset du titre après chaque conteneur (le suivant aura son propre heading)
                cur_year = None; cur_label = ""
            else:
                # Conteneur vide : les textes en attente restent pour le suivant
                pass

        # ── Div textuel (cadreblanc, cadrebleu…) ─────────────────────────
        elif tag == "div" and is_text_div(elem):
            text = elem.get_text(" ", strip=True)
            if text and len(text) > 5:
                pending_texts.append(text)

    # Flush final
    flush_pending_as_doc(current_couple)

    docs = {ck: d for ck, d in result.items() if d}
    return docs, couple_headings


# ---------------------------------------------------------------------------
# Mise à jour du JSON
# ---------------------------------------------------------------------------

def enrich_json(
    data: dict,
    sosa_to_family: dict,
    sosa_to_individu: dict,
    page_docs: dict,
    couple_headings: dict,
    overwrite: bool = False,
) -> tuple:
    """
    Applique les documents extraits dans data.
    Crée les individus et familles manquants si les noms sont dans le heading.
    Retourne (nb_familles_mises_à_jour, nb_familles_créées, nb_individus_créés).
    """
    updated = 0
    created_fam = 0
    created_ind = 0
    for ck, docs in page_docs.items():
        if not docs:
            continue
        existed_fam = ck in sosa_to_family
        ind_before  = len(data["individus"])
        heading     = couple_headings.get(ck, "")
        fam_id      = ensure_family(data, sosa_to_family, sosa_to_individu, ck, heading)
        if not fam_id:
            continue
        if not existed_fam:
            created_fam += 1
            created_ind += len(data["individus"]) - ind_before
        fam = data["familles"][fam_id]
        if "documents" in fam and not overwrite:
            continue
        fam["documents"] = docs
        updated += 1
    return updated, created_fam, created_ind


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def main():
    dry_run  = "--dry-run"  in sys.argv
    verbose  = "--verbose"  in sys.argv or "-v" in sys.argv
    overwrite = "--overwrite" in sys.argv

    print("Chargement de", JSON_PATH)
    raw = JSON_PATH.read_bytes()
    # Détecter les fins de ligne (CRLF ou LF) et l'indentation du fichier source
    newline   = '\r\n' if b'\r\n' in raw else '\n'
    src_text  = raw.decode('utf-8')
    # Indentation = nb d'espaces/tabs en tête de la 2e ligne
    second_line = src_text.split('\n')[1] if '\n' in src_text else '  '
    indent = len(second_line) - len(second_line.lstrip())

    data = json.loads(src_text)
    sosa_to_family   = build_sosa_to_family(data)
    sosa_to_individu = build_sosa_to_individu(data)
    print(f"  {len(sosa_to_family)} familles avec numéros Sosa identifiés.")
    print(f"  {len(sosa_to_individu)} individus avec numéros Sosa identifiés.")

    html_files = []
    for src_dir in SOURCE_DIRS:
        if src_dir.exists():
            html_files.extend(sorted(src_dir.rglob("*.html")))
        else:
            print(f"  AVERTISSEMENT : dossier introuvable : {src_dir}")

    print(f"\nAnalyse de {len(html_files)} pages HTML...\n")

    total_pages   = 0
    total_docs    = 0
    total_updated = 0
    total_created = 0
    total_individus_created = 0
    skipped_no_family = []

    for html_path in html_files:
        result = parse_html_page(html_path)
        if not result:
            continue
        page_docs, couple_headings = result
        if not page_docs:
            continue

        total_pages += 1
        total_docs  += sum(len(v) for v in page_docs.values())

        for ck in list(page_docs.keys()):
            fam_exists  = ck in sosa_to_family
            inds_exist  = sosa_to_individu.get(ck[0]) and sosa_to_individu.get(ck[1])
            has_names   = parse_couple_names(couple_headings.get(ck, "")) is not None
            if not fam_exists and not inds_exist and not has_names:
                skipped_no_family.append((ck, html_path.relative_to(IMAGES_BASE)))

        if verbose:
            rel = html_path.relative_to(IMAGES_BASE)
            for ck, docs in page_docs.items():
                fam_id = sosa_to_family.get(ck, "?")
                if fam_id != "?":
                    status = "OK"
                elif sosa_to_individu.get(ck[0]) and sosa_to_individu.get(ck[1]):
                    status = "A CREER (famille)"
                elif parse_couple_names(couple_headings.get(ck, "")):
                    status = "A CREER (individus+famille)"
                else:
                    status = "ABSENT (noms introuvables)"
                print(f"  [{ck[0]}/{ck[1]}] fam={fam_id} -> {len(docs)} doc(s)  {status}  ({rel})")

        if dry_run:
            for ck, docs in page_docs.items():
                if not docs:
                    continue
                fam_id    = sosa_to_family.get(ck)
                inds_ok   = sosa_to_individu.get(ck[0]) and sosa_to_individu.get(ck[1])
                names_ok  = parse_couple_names(couple_headings.get(ck, "")) is not None
                can_act   = fam_id or inds_ok or names_ok
                if not can_act:
                    continue
                if fam_id and "documents" in data["familles"].get(fam_id, {}) and not overwrite:
                    continue
                total_updated += 1
                if not fam_id:
                    total_created += 1
        else:
            n_upd, n_cre, n_ind = enrich_json(
                data, sosa_to_family, sosa_to_individu, page_docs, couple_headings,
                overwrite=overwrite,
            )
            total_updated += n_upd
            total_created += n_cre
            total_individus_created += n_ind

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}Résumé :")
    print(f"  Pages traitées         : {total_pages}")
    print(f"  Documents extraits     : {total_docs}")
    print(f"  Familles mises à jour  : {total_updated}")
    print(f"  Familles créées        : {total_created}")
    if not dry_run:
        print(f"  Individus créés        : {total_individus_created}")

    if skipped_no_family:
        unique = sorted(set(ck for ck, _ in skipped_no_family))
        print(f"\n  Couples sans noms dans les titres ({len(unique)}) :")
        for ck in unique[:30]:
            print(f"    [{ck[0]}/{ck[1]}]")
        if len(unique) > 30:
            print(f"    ... et {len(unique) - 30} autres")

    if not dry_run:
        print(f"\nÉcriture de {OUTPUT_PATH}...")
        output = json.dumps(data, ensure_ascii=False, indent=indent)
        if newline == '\r\n':
            output = output.replace('\n', '\r\n')
        OUTPUT_PATH.write_bytes(output.encode('utf-8'))
        print("Terminé.")
    else:
        print("\n(Aucune écriture en mode dry-run)")


if __name__ == "__main__":
    main()
