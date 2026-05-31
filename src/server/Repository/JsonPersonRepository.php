<?php
/**
 * Implémentation du dépôt lisant le fichier carlé.json.
 *
 * Le JSON est chargé une seule fois en mémoire lors de la construction.
 * Pour passer à SQLite, créer SqlitePersonRepository avec la même interface.
 */
class JsonPersonRepository implements IPersonRepository
{
    /** @var array  Structure : { individus: {...}, familles: {...} } */
    private $data;

    public function __construct($jsonPath)
    {
        $raw = file_get_contents($jsonPath);
        if ($raw === false) {
            throw new RuntimeException('Impossible de lire : ' . $jsonPath);
        }
        $this->data = json_decode($raw, true);
        if ($this->data === null) {
            throw new RuntimeException('JSON invalide : ' . $jsonPath);
        }
    }

    // ── Interface publique ────────────────────────────────────────────────

    public function search($query, $limit = 20)
    {
        $q = $this->normalize($query);
        if ($q === '') {
            return array();
        }

        // Recherche par numéro Sosa si la requête est purement numérique
        $sosaNum = ctype_digit(trim($query)) ? (int) trim($query) : null;

        $results = array();
        foreach ($this->data['individus'] as $id => $p) {
            $nom    = $this->normalize(isset($p['nom'])    ? $p['nom']    : '');
            $prenom = $this->normalize(isset($p['prenom']) ? $p['prenom'] : '');

            $nameMatch = ($nom !== '' || $prenom !== '') && (
                strpos($nom, $q) !== false
                || strpos($prenom, $q) !== false
                || strpos($prenom . ' ' . $nom, $q) !== false
            );

            $sosaMatch = $sosaNum !== null
                && isset($p['sosa'])
                && (int) $p['sosa'] === $sosaNum;

            if ($nameMatch || $sosaMatch) {
                $results[] = $this->buildSummary($id, $p);
                if (count($results) >= $limit) {
                    break;
                }
            }
        }

        return $results;
    }

    public function getPerson($id)
    {
        if (!isset($this->data['individus'][$id])) {
            return null;
        }

        return array(
            'person'  => $this->buildPersonData($id),
            'parents' => $this->getParentSummaries($id),
            'unions'  => $this->buildUnions($id),
        );
    }

    // ── Construction des structures de données ────────────────────────────

    /**
     * Données complètes d'un individu (sans ses liens familiaux).
     */
    private function buildPersonData($id)
    {
        if (!isset($this->data['individus'][$id])) {
            return null;
        }
        $p = $this->data['individus'][$id];

        return array(
            'id'           => $id,
            'nom'          => isset($p['nom'])          ? $p['nom']          : null,
            'prenom'       => isset($p['prenom'])       ? $p['prenom']       : null,
            'sexe'         => isset($p['sexe'])         ? $p['sexe']         : null,
            'sosa'         => isset($p['sosa'])         ? (int) $p['sosa']   : null,
            'naissance'    => isset($p['naissance'])    ? $p['naissance']    : null,
            'bapteme'      => isset($p['bapteme'])      ? $p['bapteme']      : null,
            'deces'        => isset($p['deces'])        ? $p['deces']        : null,
            'sepulture'    => isset($p['sepulture'])    ? $p['sepulture']    : null,
            'professions'  => isset($p['professions'])  ? $p['professions']  : array(),
            'residences'   => isset($p['residences'])   ? $p['residences']   : array(),
            'commentaires' => isset($p['commentaires']) ? $p['commentaires'] : array(),
        );
    }

    /**
     * Résumé d'un individu pour les boîtes parents/enfants.
     */
    private function buildSummary($id, $p)
    {
        return array(
            'id'             => $id,
            'nom'            => isset($p['nom'])    ? $p['nom']    : null,
            'prenom'         => isset($p['prenom']) ? $p['prenom'] : null,
            'sexe'           => isset($p['sexe'])   ? $p['sexe']   : null,
            'sosa'           => isset($p['sosa'])   ? (int) $p['sosa'] : null,
            'naissance_year' => $this->extractYear(
                isset($p['naissance']['date']) ? $p['naissance']['date'] : null
            ),
            'deces_year'     => $this->extractYear(
                isset($p['deces']['date']) ? $p['deces']['date'] : null
            ),
        );
    }

    private function buildSummaryById($id)
    {
        if (!isset($this->data['individus'][$id])) {
            return null;
        }
        return $this->buildSummary($id, $this->data['individus'][$id]);
    }

    /**
     * Résumés des parents d'un individu.
     */
    private function getParentSummaries($id)
    {
        if (!isset($this->data['individus'][$id]['liens']['parents'])) {
            return array();
        }
        $summaries = array();
        foreach ($this->data['individus'][$id]['liens']['parents'] as $parentId) {
            $s = $this->buildSummaryById($parentId);
            if ($s !== null) {
                $summaries[] = $s;
            }
        }
        return $summaries;
    }

    /**
     * Construit la liste des unions d'un individu.
     * Pour chaque union : conjoint (données complètes), ses parents, les enfants.
     */
    private function buildUnions($id)
    {
        $individu  = $this->data['individus'][$id];
        $liens     = isset($individu['liens']) ? $individu['liens'] : array();
        $rawUnions = isset($liens['unions'])   ? $liens['unions']   : array();

        $result = array();
        foreach ($rawUnions as $union) {
            $conjointId = isset($union['conjoint']) ? $union['conjoint'] : null;
            $familleId  = isset($union['famille'])  ? $union['famille']  : null;

            $conjoint        = $conjointId ? $this->buildPersonData($conjointId)   : null;
            $conjointParents = $conjointId ? $this->getParentSummaries($conjointId) : array();

            $enfants = array();
            if ($familleId && isset($this->data['familles'][$familleId]['enfants'])) {
                foreach ($this->data['familles'][$familleId]['enfants'] as $childId) {
                    $child = $this->buildSummaryById($childId);
                    if ($child !== null) {
                        $enfants[] = $child;
                    }
                }
            }

            $result[] = array(
                'famille_id'       => $familleId,
                'mariage'          => isset($union['mariage'])      ? $union['mariage']      : null,
                'commentaires'     => isset($union['commentaires']) ? $union['commentaires'] : array(),
                'conjoint'         => $conjoint,
                'conjoint_parents' => $conjointParents,
                'enfants'          => $enfants,
            );
        }

        return $result;
    }

    // ── Utilitaires ────────────────────────────────────────────────────────

    /**
     * Extrait la première année trouvée dans une chaîne de date GEDCOM.
     * "BET 1718 AND 1722" → 1718 ; "20 FEB 1834" → 1834 ; null → null
     */
    private function extractYear($dateStr)
    {
        if (!$dateStr) {
            return null;
        }
        preg_match('/\b(\d{4})\b/', $dateStr, $m);
        return isset($m[1]) ? (int) $m[1] : null;
    }

    /**
     * Normalise une chaîne pour la recherche : minuscules + suppression des accents.
     */
    private function normalize($str)
    {
        if (!$str) {
            return '';
        }
        $str = mb_strtolower($str, 'UTF-8');
        // iconv translitère les caractères accentués en ASCII
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $str);
        return $ascii !== false ? $ascii : $str;
    }
}
