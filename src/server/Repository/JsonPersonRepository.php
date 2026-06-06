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
            'naissance_date' => isset($p['naissance']['date']) ? $p['naissance']['date'] : null,
            'deces_year'     => $this->extractYear(
                isset($p['deces']['date']) ? $p['deces']['date'] : null
            ),
            'deces_date'     => isset($p['deces']['date']) ? $p['deces']['date'] : null,
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
                'documents'        => isset($this->data['familles'][$familleId]['documents'])
                                        ? $this->data['familles'][$familleId]['documents']
                                        : array(),
            );
        }

        return $result;
    }

    public function getSosaTree($sosa)
    {
        $sosa = (int) $sosa;
        if ($sosa < 2) {
            return null;
        }

        // Couple Sosa : pair = mâle, impair = femelle
        $sEven = ($sosa % 2 === 0) ? $sosa : $sosa - 1;
        $sOdd  = $sEven + 1;

        $maleEntry   = $this->findBySosa($sEven);
        $femaleEntry = $this->findBySosa($sOdd);

        if (!$maleEntry && !$femaleEntry) {
            return null;
        }

        $maleSummary   = $maleEntry   ? $this->buildSummary($maleEntry['id'],   $maleEntry['raw'])   : null;
        $femaleSummary = $femaleEntry ? $this->buildSummary($femaleEntry['id'], $femaleEntry['raw']) : null;

        $maleParents   = $maleEntry   ? $this->getParentsSorted($maleEntry['id'])   : array(null, null);
        $femaleParents = $femaleEntry ? $this->getParentsSorted($femaleEntry['id']) : array(null, null);

        $children = $this->findChildrenOfCouple(
            $maleEntry   ? $maleEntry['id']   : null,
            $femaleEntry ? $femaleEntry['id'] : null
        );

        // Chaîne d'ancêtres de floor(sosa/2) jusqu'à 1
        $ancestors = array();
        $cur = (int) floor($sosa / 2);
        while ($cur >= 1) {
            $entry       = $this->findBySosa($cur);
            $ancestors[] = $entry ? $this->buildSummary($entry['id'], $entry['raw']) : null;
            if ($cur === 1) {
                break;
            }
            $cur = (int) floor($cur / 2);
        }

        return array(
            'sosa'           => $sosa,
            'couple'         => array('male' => $maleSummary, 'female' => $femaleSummary),
            'male_parents'   => $maleParents,
            'female_parents' => $femaleParents,
            'children'       => $children,
            'ancestors'      => $ancestors,
        );
    }

    // ── Écriture ───────────────────────────────────────────────────────────

    public function savePerson($id, $data)
    {
        if (!isset($this->data['individus'][$id])) {
            throw new RuntimeException('Individu introuvable : ' . $id);
        }
        $p = &$this->data['individus'][$id];

        $fields = array('nom', 'prenom', 'sexe', 'naissance', 'bapteme',
                        'deces', 'sepulture', 'professions', 'residences', 'commentaires');
        foreach ($fields as $f) {
            if (array_key_exists($f, $data)) {
                if ($data[$f] === null || $data[$f] === '' ||
                    (is_array($data[$f]) && count($data[$f]) === 0)) {
                    unset($p[$f]);
                } else {
                    $p[$f] = $data[$f];
                }
            }
        }

        // Mise à jour des parents dans les liens
        if (isset($data['parents'])) {
            if (!isset($p['liens'])) $p['liens'] = array();
            if (empty($data['parents'])) {
                unset($p['liens']['parents']);
            } else {
                $p['liens']['parents'] = array_values(array_unique($data['parents']));
            }
        }

        $this->persist();
    }

    public function saveFamily($id, $data)
    {
        if (!isset($this->data['familles'][$id])) {
            throw new RuntimeException('Famille introuvable : ' . $id);
        }
        $fam = &$this->data['familles'][$id];

        $fields = array('mariage', 'documents');
        foreach ($fields as $f) {
            if (array_key_exists($f, $data)) {
                if ($data[$f] === null || (is_array($data[$f]) && count($data[$f]) === 0)) {
                    unset($fam[$f]);
                } else {
                    $fam[$f] = $data[$f];
                }
            }
        }

        // Enfants : mettre à jour la liste ET les liens des individus
        if (isset($data['enfants'])) {
            $newChildren  = array_values(array_unique($data['enfants']));
            $prevChildren = isset($fam['enfants']) ? $fam['enfants'] : array();

            // Retirer les enfants supprimés
            foreach (array_diff($prevChildren, $newChildren) as $childId) {
                if (isset($this->data['individus'][$childId]['liens']['parents'])) {
                    $parents = $this->data['individus'][$childId]['liens']['parents'];
                    $newParents = array();
                    foreach ($parents as $pid) {
                        if ($pid !== $fam['mari'] && $pid !== $fam['epouse']) {
                            $newParents[] = $pid;
                        }
                    }
                    if (empty($newParents)) {
                        unset($this->data['individus'][$childId]['liens']['parents']);
                    } else {
                        $this->data['individus'][$childId]['liens']['parents'] = $newParents;
                    }
                }
            }

            // Ajouter les nouveaux enfants
            foreach (array_diff($newChildren, $prevChildren) as $childId) {
                if (isset($this->data['individus'][$childId])) {
                    $child = &$this->data['individus'][$childId];
                    if (!isset($child['liens'])) $child['liens'] = array();
                    $parents = isset($child['liens']['parents']) ? $child['liens']['parents'] : array();
                    if (!empty($fam['mari'])   && !in_array($fam['mari'],   $parents)) $parents[] = $fam['mari'];
                    if (!empty($fam['epouse']) && !in_array($fam['epouse'], $parents)) $parents[] = $fam['epouse'];
                    $child['liens']['parents'] = array_values($parents);
                }
            }

            if (empty($newChildren)) {
                unset($fam['enfants']);
            } else {
                $fam['enfants'] = $newChildren;
            }
        }

        $this->persist();
    }

    private function persist()
    {
        $path = JSON_DATA_PATH;
        $json = json_encode($this->data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        if ($json === false) {
            throw new RuntimeException('Erreur d\'encodage JSON : ' . json_last_error_msg());
        }
        $fp = fopen($path, 'c+');
        if (!$fp) {
            throw new RuntimeException('Impossible d\'ouvrir : ' . $path);
        }
        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            throw new RuntimeException('Impossible de verrouiller le fichier JSON');
        }
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, $json);
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }

    // ── Sauvegarde groupée ────────────────────────────────────────────────────

    public function saveAll($payload)
    {
        $idMap = array(); // tempId → realId

        // 1. Créer les nouvelles personnes
        $newPersons = isset($payload['newPersons']) ? $payload['newPersons'] : array();
        foreach ($newPersons as $tempId => $pData) {
            $realId = $this->generatePersonId();
            $person = array();
            $fields = array('nom','prenom','sexe','naissance','bapteme','deces',
                            'sepulture','professions','residences','commentaires','sosa');
            foreach ($fields as $f) {
                if (isset($pData[$f]) && $pData[$f] !== null) {
                    $person[$f] = $pData[$f];
                }
            }
            if (!empty($pData['liens'])) {
                $person['liens'] = $pData['liens'];
            }
            $this->data['individus'][$realId] = $person;
            $idMap[$tempId] = $realId;
        }

        $self = $this;
        $resolve = function ($id) use (&$idMap) {
            return isset($idMap[$id]) ? $idMap[$id] : $id;
        };

        // 2. Créer les nouvelles familles
        $newFamilies = isset($payload['newFamilies']) ? $payload['newFamilies'] : array();
        foreach ($newFamilies as $tempId => $fData) {
            $realId   = $this->generateFamilyId();
            $mariId   = $resolve(isset($fData['mari'])   ? $fData['mari']   : null);
            $epoUseId = $resolve(isset($fData['epouse']) ? $fData['epouse'] : null);
            $enfants  = array_map($resolve, isset($fData['enfants']) ? $fData['enfants'] : array());

            $fam = array();
            if ($mariId)          $fam['mari']    = $mariId;
            if ($epoUseId)        $fam['epouse']  = $epoUseId;
            if (!empty($enfants)) $fam['enfants'] = array_values($enfants);
            $this->data['familles'][$realId] = $fam;

            // Mettre à jour liens.unions des deux époux
            if ($mariId && isset($this->data['individus'][$mariId])) {
                if (!isset($this->data['individus'][$mariId]['liens'])) {
                    $this->data['individus'][$mariId]['liens'] = array();
                }
                $this->data['individus'][$mariId]['liens']['unions'][] = array(
                    'famille' => $realId, 'conjoint' => $epoUseId
                );
            }
            if ($epoUseId && isset($this->data['individus'][$epoUseId])) {
                if (!isset($this->data['individus'][$epoUseId]['liens'])) {
                    $this->data['individus'][$epoUseId]['liens'] = array();
                }
                $this->data['individus'][$epoUseId]['liens']['unions'][] = array(
                    'famille' => $realId, 'conjoint' => $mariId
                );
            }
            // Mettre à jour liens.parents des enfants
            foreach ($enfants as $childId) {
                if (isset($this->data['individus'][$childId])) {
                    if (!isset($this->data['individus'][$childId]['liens'])) {
                        $this->data['individus'][$childId]['liens'] = array();
                    }
                    $existing = isset($this->data['individus'][$childId]['liens']['parents'])
                        ? $this->data['individus'][$childId]['liens']['parents'] : array();
                    if ($mariId   && !in_array($mariId,   $existing)) $existing[] = $mariId;
                    if ($epoUseId && !in_array($epoUseId, $existing)) $existing[] = $epoUseId;
                    $this->data['individus'][$childId]['liens']['parents'] = array_values($existing);
                }
            }
            $idMap[$tempId] = $realId;
        }

        // 3. Supprimer des familles
        $deleteFamilies = isset($payload['deleteFamilies']) ? $payload['deleteFamilies'] : array();
        foreach ($deleteFamilies as $fid) {
            $fid = $resolve($fid);
            if (!isset($this->data['familles'][$fid])) continue;
            $fam = $this->data['familles'][$fid];
            foreach (array('mari', 'epouse') as $role) {
                $pid = isset($fam[$role]) ? $fam[$role] : null;
                if ($pid && isset($this->data['individus'][$pid]['liens']['unions'])) {
                    $filtered = array();
                    foreach ($this->data['individus'][$pid]['liens']['unions'] as $u) {
                        if ((isset($u['famille']) ? $u['famille'] : '') !== $fid) {
                            $filtered[] = $u;
                        }
                    }
                    $this->data['individus'][$pid]['liens']['unions'] = array_values($filtered);
                }
            }
            unset($this->data['familles'][$fid]);
        }

        // 4. Mettre à jour les personnes existantes
        $updatePersons = isset($payload['updatePersons']) ? $payload['updatePersons'] : array();
        foreach ($updatePersons as $pid => $pData) {
            $pid = $resolve($pid);
            if (isset($pData['parents'])) {
                $pData['parents'] = array_map($resolve, $pData['parents']);
            }
            if (isset($this->data['individus'][$pid])) {
                $this->savePerson($pid, $pData);
            }
        }

        // 5. Mettre à jour les familles existantes
        $updateFamilies = isset($payload['updateFamilies']) ? $payload['updateFamilies'] : array();
        foreach ($updateFamilies as $fid => $fData) {
            $fid = $resolve($fid);
            if (isset($fData['enfants'])) {
                $fData['enfants'] = array_map($resolve, $fData['enfants']);
            }
            if (isset($this->data['familles'][$fid])) {
                $this->saveFamily($fid, $fData);
            }
        }

        $this->persist();
        return array('idMap' => $idMap);
    }

    private function generatePersonId()
    {
        $max = 0;
        foreach (array_keys($this->data['individus']) as $id) {
            if (preg_match('/^I(\d+)$/', $id, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'I' . ($max + 1);
    }

    private function generateFamilyId()
    {
        $max = 0;
        foreach (array_keys($this->data['familles']) as $id) {
            if (preg_match('/^F(\d+)$/', $id, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'F' . ($max + 1);
    }

    // ── Utilitaires ────────────────────────────────────────────────────────

    private function findBySosa($sosa)
    {
        foreach ($this->data['individus'] as $id => $p) {
            if (isset($p['sosa']) && (int) $p['sosa'] === $sosa) {
                return array('id' => $id, 'raw' => $p);
            }
        }
        return null;
    }

    private function getParentsSorted($id)
    {
        $summaries = $this->getParentSummaries($id);
        $father    = null;
        $mother    = null;
        foreach ($summaries as $s) {
            if ($s['sexe'] === 'M' && $father === null) {
                $father = $s;
            } elseif ($s['sexe'] === 'F' && $mother === null) {
                $mother = $s;
            }
        }
        return array($father, $mother);
    }

    private function findChildrenOfCouple($maleId, $femaleId)
    {
        foreach ($this->data['familles'] as $fam) {
            $mari   = isset($fam['mari'])   ? $fam['mari']   : null;
            $epouse = isset($fam['epouse']) ? $fam['epouse'] : null;
            if ($mari !== $maleId || $epouse !== $femaleId) {
                continue;
            }
            $children = array();
            if (!empty($fam['enfants'])) {
                foreach ($fam['enfants'] as $childId) {
                    $s = $this->buildSummaryById($childId);
                    if ($s !== null) {
                        $children[] = $s;
                    }
                }
            }
            return $children;
        }
        return array();
    }

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
