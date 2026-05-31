"""
Convertisseur GEDCOM (.ged) vers JSON.

Gère l'encodage ANSEL (utilisé par Geneatique) et le convertit en UTF-8.
"""

import json
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Décodage ANSEL → Unicode
# ---------------------------------------------------------------------------

# Table de correspondance des caractères ANSEL non-ASCII vers Unicode.
# ANSEL utilise des séquences de deux octets : un octet de diacritique suivi
# de la lettre de base.  Les octets >= 0xE0 sont des diacritiques combinants.

# Table des diacritiques ANSEL (Z39.47 tel qu'utilisé par Geneatique).
# En ANSEL, le diacritique PRÉCÈDE la lettre de base.
# Les octets ci-dessous correspondent aux bytes réels du fichier (vérifiés
# empiriquement sur carlé.ged) :
#   0xE1 + 'e' → 'è'  (grave)
#   0xE2 + 'e' → 'é'  (aigu)
#   0xE3 + 'o' → 'ô'  (circonflexe)
#   0xF0 + 'c' → 'ç'  (cédille)
ANSEL_DIACRITICS = {
    0xE1: "̀",  # accent grave        (è, à, ù…)
    0xE2: "́",  # accent aigu         (é, á, ó…)
    0xE3: "̂",  # accent circonflexe  (ê, â, ô…)
    0xE4: "̃",  # tilde               (ñ, ã…)
    0xE5: "̄",  # macron              (ā, ō…)
    0xE6: "̆",  # brève               (ă, ŭ…)
    0xE7: "̇",  # point supérieur     (ż…)
    0xE8: "̈",  # tréma               (ë, ï, ü…)
    0xE9: "̌",  # caron (háček)       (š, č…)
    0xEA: "̊",  # rond supérieur      (å…)
    0xEB: "̧",  # cédille             (ç, ş…)  -- variante
    0xEC: "̣",  # point inférieur
    0xED: "̲",  # soulignement
    0xEE: "̋",  # double accent aigu  (ő, ű…)
    0xEF: "̐",  # candrabindu
    0xF0: "̧",  # cédille             (ç, ş…)
    0xF1: "̨",  # ogonek              (ą, ę…)
    0xF2: "̣",  # point inférieur (alt)
    0xF3: "̤",  # double point inférieur
    0xF4: "̥",  # rond inférieur
    0xF5: "̳",  # double soulignement
    0xF6: "̲",  # soulignement (alt)
    0xF9: "̈",  # tréma (alt)
    0xFA: "̋",  # double accent aigu (alt)
    0xFB: "̛",  # corne
    0xFE: "̕",  # virgule supérieure droite
}

# Caractères ANSEL à correspondance directe (non composés)
ANSEL_DIRECT = {
    0xA1: "Ł",  # Ł
    0xA2: "Ø",  # Ø
    0xA3: "Đ",  # Đ
    0xA4: "Þ",  # Þ
    0xA5: "Æ",  # Æ
    0xA6: "Œ",  # Œ
    0xA7: "ʹ",  # ʹ
    0xA8: "·",  # ·
    0xA9: "♭",  # ♭
    0xAA: "®",  # ®
    0xAB: "±",  # ±
    0xAC: "Ơ",  # Ơ
    0xAD: "Ư",  # Ư
    0xAE: "ʼ",  # ʼ
    0xB0: "ʻ",  # ʻ
    0xB1: "ł",  # ł
    0xB2: "ø",  # ø
    0xB3: "đ",  # đ
    0xB4: "þ",  # þ
    0xB5: "æ",  # æ
    0xB6: "œ",  # œ
    0xB7: "ʺ",  # ʺ
    0xB8: "ı",  # ı
    0xB9: "£",  # £
    0xBA: "ð",  # ð
    0xBC: "ơ",  # ơ
    0xBD: "ư",  # ư
    0xBE: "□",  # □
    0xBF: "■",  # ■
    0xC0: "°",  # °
    0xC1: "ℓ",  # ℓ
    0xC2: "℗",  # ℗
    0xC3: "©",  # ©
    0xC4: "♯",  # ♯
    0xC5: "¿",  # ¿
    0xC6: "¡",  # ¡
    0xC7: "ß",  # ß
    0xC8: "€",  # €
    0xCD: "e",  # ALA extended
    0xCE: "o",  # ALA extended
    0xCF: "ß",  # ß alternate
}


def decode_ansel(raw_bytes: bytes) -> str:
    """Décode une séquence d'octets ANSEL en chaîne Unicode normalisée."""
    import unicodedata

    result = []
    i = 0
    while i < len(raw_bytes):
        b = raw_bytes[i]
        if b < 0x80:
            result.append(chr(b))
            i += 1
        elif b in ANSEL_DIACRITICS:
            # Caractère combinant : il précède la lettre de base en ANSEL
            combining = ANSEL_DIACRITICS[b]
            i += 1
            if i < len(raw_bytes) and raw_bytes[i] < 0x80:
                base = chr(raw_bytes[i])
                i += 1
            else:
                base = ""
            # On place la lettre de base puis le combinant, puis on normalise
            composed = unicodedata.normalize("NFC", base + combining)
            result.append(composed)
        elif b in ANSEL_DIRECT:
            result.append(ANSEL_DIRECT[b])
            i += 1
        else:
            # Octet inconnu : on le remplace par son équivalent latin-1 si possible
            try:
                result.append(raw_bytes[i : i + 1].decode("latin-1"))
            except Exception:
                result.append("?")
            i += 1

    return "".join(result)


def read_ged_lines(path: Path) -> list[str]:
    """Lit le fichier .ged et retourne une liste de lignes décodées."""
    raw = path.read_bytes()

    # Détection de l'encodage déclaré dans l'en-tête
    # On cherche "1 CHAR " dans les premiers octets (ASCII-safe)
    header = raw[:2000]
    encoding_declared = "ANSEL"
    for line in header.split(b"\n"):
        if b"CHAR" in line:
            val = line.split(b"CHAR")[-1].strip().upper()
            if b"UTF" in val:
                encoding_declared = "UTF-8"
            elif b"ASCII" in val:
                encoding_declared = "ASCII"
            elif b"ANSEL" in val:
                encoding_declared = "ANSEL"
            elif b"CP1252" in val or b"WINDOWS" in val:
                encoding_declared = "CP1252"
            break

    if encoding_declared == "ANSEL":
        lines = []
        for raw_line in raw.split(b"\n"):
            raw_line = raw_line.rstrip(b"\r")
            lines.append(decode_ansel(raw_line))
    else:
        enc = "utf-8" if "UTF" in encoding_declared else encoding_declared.lower()
        text = raw.decode(enc, errors="replace")
        lines = text.splitlines()

    return lines


# ---------------------------------------------------------------------------
# Parsing GEDCOM
# ---------------------------------------------------------------------------

def parse_ged_lines(lines: list[str]) -> dict:
    """Parse les lignes GEDCOM et retourne un dict de records bruts."""
    records = {}  # xref_id -> {"tag": ..., "value": ..., "children": [...]}

    # Un record de niveau 0 : "0 @ID@ TAG [value]" ou "0 TAG [value]"
    # Les sous-lignes de niveau > 0 sont des enfants du record courant

    current_stack = []  # pile de (level, node)
    current_record_id = None
    root_nodes = []  # nodes de niveau 0 sans xref

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        # Découpage : niveau  [xref]  tag  [value...]
        parts = line.split(" ", 2)
        if not parts:
            continue
        try:
            level = int(parts[0])
        except ValueError:
            continue

        rest = parts[1] if len(parts) > 1 else ""
        value_part = parts[2] if len(parts) > 2 else ""

        # Détection xref (@ID@)
        xref = None
        tag = rest
        if rest.startswith("@") and rest.endswith("@") and len(rest) > 2:
            xref = rest
            tag_val = value_part.split(" ", 1)
            tag = tag_val[0]
            value_part = tag_val[1] if len(tag_val) > 1 else ""

        # CONC et CONT : on ne strippe pas — les espaces en tête/queue sont
        # intentionnels (séparateurs de mots entre segments).
        value = value_part if tag in ("CONC", "CONT") else value_part.strip()
        node = {"tag": tag, "value": value, "children": []}
        if xref:
            node["xref"] = xref

        if level == 0:
            current_stack = [(0, node)]
            if xref:
                records[xref] = node
                current_record_id = xref
            else:
                root_nodes.append(node)
                current_record_id = None
        else:
            # Trouver le parent : le dernier nœud de niveau < level
            while len(current_stack) > 1 and current_stack[-1][0] >= level:
                current_stack.pop()
            if current_stack:
                current_stack[-1][1]["children"].append(node)
            current_stack.append((level, node))

    return records


# ---------------------------------------------------------------------------
# Construction du JSON structuré
# ---------------------------------------------------------------------------

def get_child_value(node: dict, tag: str) -> str | None:
    """Retourne la valeur du premier enfant ayant le tag donné."""
    for child in node.get("children", []):
        if child["tag"] == tag:
            return child["value"] or None
    return None


def get_all_child_values(node: dict, tag: str) -> list[str]:
    """Retourne les valeurs de tous les enfants ayant le tag donné."""
    return [
        c["value"]
        for c in node.get("children", [])
        if c["tag"] == tag and c["value"]
    ]


def get_child_node(node: dict, tag: str) -> dict | None:
    """Retourne le premier nœud enfant ayant le tag donné."""
    for child in node.get("children", []):
        if child["tag"] == tag:
            return child
    return None


def get_all_child_nodes(node: dict, tag: str) -> list[dict]:
    """Retourne tous les nœuds enfants ayant le tag donné."""
    return [c for c in node.get("children", []) if c["tag"] == tag]


def parse_place(plac_value: str) -> dict | None:
    """Analyse un lieu GEDCOM en dict structuré."""
    if not plac_value:
        return None
    # Format typique : "ville, dept_num, dept_nom, région, pays, complément"
    parts = [p.strip() for p in plac_value.split(",")]
    # Retire les parties vides en fin de liste
    while parts and not parts[-1]:
        parts.pop()
    if not parts:
        return None

    result: dict = {"brut": plac_value}
    if len(parts) >= 1 and parts[0]:
        result["ville"] = parts[0]
    if len(parts) >= 2 and parts[1]:
        result["dept_num"] = parts[1]
    if len(parts) >= 3 and parts[2]:
        result["dept_nom"] = parts[2]
    if len(parts) >= 4 and parts[3]:
        result["region"] = parts[3]
    if len(parts) >= 5 and parts[4]:
        result["pays"] = parts[4]
    if len(parts) >= 6 and parts[5]:
        result["complement"] = parts[5]
    return result


def parse_event(event_node: dict, records: dict) -> dict:
    """Extrait date, lieu et notes d'un nœud d'événement."""
    result: dict = {}
    date_val = get_child_value(event_node, "DATE")
    if date_val:
        result["date"] = date_val
    plac_val = get_child_value(event_node, "PLAC")
    if plac_val:
        result["lieu"] = parse_place(plac_val)
    addr_val = get_child_value(event_node, "ADDR")
    if addr_val:
        result["adresse"] = addr_val
    note_refs = get_all_child_values(event_node, "NOTE")
    notes_text = resolve_notes(note_refs, records)
    if notes_text:
        result["notes"] = notes_text
    return result


_NOTE_PREFIX_RE = re.compile(r"^#[^#]+#")


def concat_note_text(note_node: dict) -> str:
    """Concatène CONC et CONT d'une note en reconstituant les espaces perdus.

    En GEDCOM, CONC indique une continuation sans séparateur : le logiciel
    source est censé préserver les espaces en fin/début de segment. Geneatique
    les supprime parfois, ce qui colle deux mots. On insère un espace quand
    les deux côtés sont des caractères non-blancs (mots consécutifs sans
    rupture de mot en cours).
    CONT introduit un saut de ligne explicite.
    """
    text = note_node.get("value", "")
    for child in node_children(note_node):
        segment = child.get("value", "")
        if child["tag"] == "CONC":
            # Concaténation directe : Geneatique place lui-même les espaces
            # inter-mots en tête de la ligne CONC suivante.
            text += segment
        elif child["tag"] == "CONT":
            text += "\n" + segment

    text = text.strip()
    # Supprime les tags de catégorie du type "#Générale#" en début de note
    text = _NOTE_PREFIX_RE.sub("", text).lstrip()
    return text


def node_children(node: dict):
    return node.get("children", [])


def resolve_notes(refs_or_values: list[str], records: dict) -> list[str]:
    """Résout les références @Nxx@ en texte complet."""
    texts = []
    for ref in refs_or_values:
        if ref.startswith("@") and ref.endswith("@"):
            note_node = records.get(ref)
            if note_node:
                texts.append(concat_note_text(note_node))
        elif ref:
            texts.append(ref)
    return texts


def parse_residences(indi_node: dict, records: dict) -> list[dict]:
    """Extrait les résidences (RESI) d'un individu."""
    result = []
    for resi in get_all_child_nodes(indi_node, "RESI"):
        ev = parse_event(resi, records)
        if ev:
            result.append(ev)
    return result


def parse_individual(indi_node: dict, records: dict) -> dict:
    """Convertit un nœud INDI en dict structuré."""
    person: dict = {}

    # --- État civil ---
    name_node = get_child_node(indi_node, "NAME")
    if name_node:
        raw_name = name_node.get("value", "")
        # Format : "Prénom/NOM/"
        m = re.match(r"^(.*?)/([^/]*)/(.*)$", raw_name)
        if m:
            prenom = m.group(1).strip()
            nom = m.group(2).strip()
            suffix = m.group(3).strip()
            person["nom"] = nom if nom else None
            person["prenom"] = prenom if prenom else None
            if suffix:
                person["prenom_suffix"] = suffix
        else:
            person["nom_complet"] = raw_name

        # Sous-tags NAME
        givn = get_child_value(name_node, "GIVN")
        if givn:
            person["prenom"] = givn
        surn = get_child_value(name_node, "SURN")
        if surn:
            person["nom"] = surn
        npfx = get_child_value(name_node, "NPFX")
        if npfx:
            person["prefix_nom"] = npfx
        nsfx = get_child_value(name_node, "NSFX")
        if nsfx:
            person["suffix_nom"] = nsfx

    sex = get_child_value(indi_node, "SEX")
    if sex:
        person["sexe"] = sex

    # --- Naissance ---
    birt = get_child_node(indi_node, "BIRT")
    if birt:
        ev = parse_event(birt, records)
        if ev:
            person["naissance"] = ev

    # --- Baptême ---
    chr_node = get_child_node(indi_node, "CHR")
    if chr_node:
        ev = parse_event(chr_node, records)
        if ev:
            person["bapteme"] = ev

    # --- Décès ---
    deat = get_child_node(indi_node, "DEAT")
    if deat:
        ev = parse_event(deat, records)
        if ev:
            person["deces"] = ev

    # --- Sépulture ---
    buri = get_child_node(indi_node, "BURI")
    if buri:
        ev = parse_event(buri, records)
        if ev:
            person["sepulture"] = ev

    # --- Professions ---
    occus = []
    for occu_node in get_all_child_nodes(indi_node, "OCCU"):
        val = occu_node.get("value", "").strip()
        if val:
            # Plusieurs professions séparées par " ; " ou ", "
            for p in re.split(r"\s*[;,]\s*", val):
                p = p.strip()
                if p and p not in occus:
                    occus.append(p)
    if occus:
        person["professions"] = occus

    # --- Résidences ---
    resis = parse_residences(indi_node, records)
    if resis:
        person["residences"] = resis

    # --- Notes ---
    note_refs = get_all_child_values(indi_node, "NOTE")
    notes_text = resolve_notes(note_refs, records)
    if notes_text:
        person["commentaires"] = notes_text

    # --- Famille (liens) remplis plus tard ---
    person["_fams"] = get_all_child_values(indi_node, "FAMS")  # familles comme époux
    person["_famc"] = get_all_child_values(indi_node, "FAMC")  # familles comme enfant

    return person


def parse_family(fam_node: dict, records: dict) -> dict:
    """Convertit un nœud FAM en dict structuré."""
    fam: dict = {}

    husb = get_child_value(fam_node, "HUSB")
    if husb:
        fam["mari"] = husb
    wife = get_child_value(fam_node, "WIFE")
    if wife:
        fam["epouse"] = wife
    children = get_all_child_values(fam_node, "CHIL")
    if children:
        fam["enfants"] = children

    # Mariage
    marr = get_child_node(fam_node, "MARR")
    if marr:
        ev = parse_event(marr, records)
        if ev:
            fam["mariage"] = ev

    # Divorce
    div = get_child_node(fam_node, "DIV")
    if div:
        ev = parse_event(div, records)
        if ev:
            fam["divorce"] = ev

    # Notes famille
    note_refs = get_all_child_values(fam_node, "NOTE")
    notes_text = resolve_notes(note_refs, records)
    if notes_text:
        fam["commentaires"] = notes_text

    return fam


def build_json(records: dict) -> dict:
    """Construit le JSON final à partir des records GEDCOM."""
    individus: dict = {}
    familles: dict = {}

    # Séparer individus et familles
    for xref, node in records.items():
        tag = node.get("tag", "")
        if tag == "INDI":
            individus[xref] = parse_individual(node, records)
        elif tag == "FAM":
            familles[xref] = parse_family(node, records)

    # Résolution des liens : parents et unions (les enfants sont accessibles
    # via familles[union.famille] et ne sont pas dupliqués ici).
    for xref, person in individus.items():
        parents = []
        conjoint_mariages = []

        # Famille où la personne est enfant → parents
        for famc_ref in person.get("_famc", []):
            fam = familles.get(famc_ref)
            if fam:
                if fam.get("mari"):
                    parents.append(fam["mari"])
                if fam.get("epouse"):
                    parents.append(fam["epouse"])

        # Familles où la personne est époux/épouse → conjoint(s)
        for fams_ref in person.get("_fams", []):
            fam = familles.get(fams_ref)
            if fam:
                conjoint = None
                if fam.get("mari") and fam["mari"] != xref:
                    conjoint = fam["mari"]
                elif fam.get("epouse") and fam["epouse"] != xref:
                    conjoint = fam["epouse"]

                entry: dict = {"famille": fams_ref}
                if conjoint:
                    entry["conjoint"] = conjoint
                if fam.get("mariage"):
                    entry["mariage"] = fam["mariage"]
                if fam.get("divorce"):
                    entry["divorce"] = fam["divorce"]
                if fam.get("commentaires"):
                    entry["commentaires"] = fam["commentaires"]
                conjoint_mariages.append(entry)

        liens: dict = {}
        if parents:
            liens["parents"] = parents
        if conjoint_mariages:
            liens["unions"] = conjoint_mariages
        if liens:
            person["liens"] = liens

        # Nettoyage des champs internes
        person.pop("_fams", None)
        person.pop("_famc", None)

    return {"individus": individus, "familles": familles}


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def convert(input_path: Path, output_path: Path) -> None:
    print(f"Lecture de {input_path}...")
    lines = read_ged_lines(input_path)
    print(f"  {len(lines)} lignes lues.")

    print("Parsing GEDCOM...")
    records = parse_ged_lines(lines)
    print(f"  {len(records)} records trouvés.")

    print("Construction du JSON...")
    data = build_json(records)
    nb_individus = len(data["individus"])
    nb_familles = len(data["familles"])
    print(f"  {nb_individus} individus, {nb_familles} familles.")

    print(f"Écriture de {output_path}...")
    output_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("Terminé.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Valeur par défaut : fichier d'exemple
        input_file = Path(__file__).parent.parent / "carlé.ged"
        output_file = Path(__file__).parent.parent / "carlé.json"
    elif len(sys.argv) == 2:
        input_file = Path(sys.argv[1])
        output_file = input_file.with_suffix(".json")
    else:
        input_file = Path(sys.argv[1])
        output_file = Path(sys.argv[2])

    if not input_file.exists():
        print(f"Erreur : fichier introuvable : {input_file}", file=sys.stderr)
        sys.exit(1)

    convert(input_file, output_file)
