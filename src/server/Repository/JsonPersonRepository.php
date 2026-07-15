<?php
/**
 * Implémentation du dépôt lisant le fichier carlé.json.
 *
 * Le JSON est chargé une seule fois en mémoire lors de la construction.
 * `familles` est la seule source de vérité pour les relations (parents/enfants,
 * conjoints, mariage) : les individus ne stockent plus de liens dupliqués, ils
 * sont dérivés à la volée via deux index construits sur `familles`.
 *
 * Pour passer à SQLite, créer SqlitePersonRepository avec la même interface.
 */
class JsonPersonRepository implements IPersonRepository
{
    /** @var array  Structure : { individus: {...}, familles: {...} } */
    private $data;

    /** @var array|null  childId => familleId (famille de naissance) */
    private $childToFamily = null;

    /** @var array|null  personId => [familleId, ...] (familles où la personne est mari/epouse) */
    private $personToUnions = null;

    private $indexesDirty = true;

    public function __construct($jsonPath)
    {
        $t   = microtime(true);
        $raw = file_get_contents($jsonPath);
        Perf::mark('read_file', (microtime(true) - $t) * 1000);
        Perf::context('file_bytes', strlen($raw === false ? '' : $raw));
        if ($raw === false) {
            throw new RuntimeException('Impossible de lire : ' . $jsonPath);
        }

        $t = microtime(true);
        $this->data = json_decode($raw, true);
        Perf::mark('json_decode', (microtime(true) - $t) * 1000);
        if ($this->data === null) {
            throw new RuntimeException('JSON invalide : ' . $jsonPath);
        }
    }

    // ── Index dérivés de familles ────────────────────────────────────────────

    /**
     * (Re)construit childToFamily et personToUnions à partir de familles.
     * Appelé paresseusement : toute mutation de familles doit appeler
     * invalidateIndexes(), la reconstruction n'a lieu qu'à la prochaine lecture.
     */
    private function ensureIndexes()
    {
        if (!$this->indexesDirty && $this->childToFamily !== null) {
            return;
        }
        $this->childToFamily  = array();
        $this->personToUnions = array();
        foreach ($this->data['familles'] as $fid => $fam) {
            foreach ((isset($fam['enfants']) ? $fam['enfants'] : array()) as $childId) {
                $this->childToFamily[$childId] = $fid;
            }
            if (!empty($fam['mari'])) {
                $this->personToUnions[$fam['mari']][] = $fid;
            }
            if (!empty($fam['epouse'])) {
                $this->personToUnions[$fam['epouse']][] = $fid;
            }
        }
        $this->indexesDirty = false;
    }

    private function invalidateIndexes()
    {
        $this->indexesDirty = true;
    }

    /** Ids des parents (0 à 2) d'un individu, dérivés de sa famille de naissance. */
    private function getParentIds($id)
    {
        $this->ensureIndexes();
        if (!isset($this->childToFamily[$id])) {
            return array();
        }
        $fam = $this->data['familles'][$this->childToFamily[$id]];
        $ids = array();
        if (!empty($fam['mari']))   $ids[] = $fam['mari'];
        if (!empty($fam['epouse'])) $ids[] = $fam['epouse'];
        return $ids;
    }

    /** Ids des familles où la personne est mari ou épouse. */
    private function getUnionFamilyIds($id)
    {
        $this->ensureIndexes();
        return isset($this->personToUnions[$id]) ? $this->personToUnions[$id] : array();
    }

    /** Résumés des frères et sœurs d'un individu (autres enfants de sa famille de naissance). */
    private function getSiblingSummaries($id)
    {
        $this->ensureIndexes();
        if (!isset($this->childToFamily[$id])) {
            return array();
        }
        $fam = $this->data['familles'][$this->childToFamily[$id]];
        $summaries = array();
        foreach ((isset($fam['enfants']) ? $fam['enfants'] : array()) as $childId) {
            if ($childId === $id) {
                continue;
            }
            $s = $this->buildSummaryById($childId);
            if ($s !== null) {
                $summaries[] = $s;
            }
        }
        return $summaries;
    }

    // ── Interface publique ────────────────────────────────────────────────

    public function search($query, $limit = 50)
    {
        $q = $this->normalize($query);
        if ($q === '') {
            return array('results' => array(), 'total' => 0);
        }

        // Découpe en mots (tous doivent matcher, dans n'importe quel ordre)
        $words = array_filter(preg_split('/\s+/', $q));

        // Recherche par numéro Sosa si la requête est purement numérique
        $sosaNum = ctype_digit(trim($query)) ? (int) trim($query) : null;

        $matches = array();
        foreach ($this->data['individus'] as $id => $p) {
            $nom    = $this->normalize(isset($p['nom'])    ? $p['nom']    : '');
            $prenom = $this->normalize(isset($p['prenom']) ? $p['prenom'] : '');

            // Champ de recherche : "nom prenom" + "prenom nom" pour couvrir tous les ordres
            $haystack = $nom . ' ' . $prenom . ' ' . $prenom . ' ' . $nom;

            $nameMatch = ($nom !== '' || $prenom !== '');
            if ($nameMatch) {
                foreach ($words as $word) {
                    if (strpos($haystack, $word) === false) {
                        $nameMatch = false;
                        break;
                    }
                }
            }

            $sosaMatch = $sosaNum !== null
                && isset($p['sosa'])
                && (int) $p['sosa'] === $sosaNum;

            if ($nameMatch || $sosaMatch) {
                $matches[] = $this->buildSummary($id, $p);
            }
        }

        // Tri par année décroissante (naissance, sinon décès) ; sans date en dernier
        usort($matches, function ($a, $b) {
            $ya = $a['naissance_year'] !== null ? $a['naissance_year'] : $a['deces_year'];
            $yb = $b['naissance_year'] !== null ? $b['naissance_year'] : $b['deces_year'];
            if ($ya === null && $yb === null) return 0;
            if ($ya === null) return 1;
            if ($yb === null) return -1;
            return $yb - $ya;
        });

        return array(
            'results' => array_slice($matches, 0, $limit),
            'total'   => count($matches),
        );
    }

    public function getPerson($id)
    {
        if (!isset($this->data['individus'][$id])) {
            return null;
        }

        return array(
            'person'   => $this->buildPersonData($id),
            'parents'  => $this->getParentSummaries($id),
            'siblings' => $this->getSiblingSummaries($id),
            'unions'   => $this->buildUnions($id),
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

            'deces'        => isset($p['deces'])        ? $p['deces']        : null,
            'sepulture'    => isset($p['sepulture'])    ? $p['sepulture']    : null,
            'professions'  => isset($p['professions'])  ? $p['professions']  : array(),
            'residences'   => isset($p['residences'])   ? $p['residences']   : array(),
            'commentaires' => isset($p['commentaires']) ? $p['commentaires'] : array(),
            'documents'    => isset($p['documents'])    ? $p['documents']    : array(),
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
     * Résumés des parents d'un individu (dérivés de sa famille de naissance).
     */
    private function getParentSummaries($id)
    {
        $summaries = array();
        foreach ($this->getParentIds($id) as $parentId) {
            $s = $this->buildSummaryById($parentId);
            if ($s !== null) {
                $summaries[] = $s;
            }
        }
        return $summaries;
    }

    /**
     * Construit la liste des unions d'un individu à partir des familles où il
     * est mari ou épouse. mariage/commentaires/documents viennent directement
     * de la famille (source de vérité unique, plus de copie côté individu).
     */
    private function buildUnions($id)
    {
        $result = array();
        foreach ($this->getUnionFamilyIds($id) as $familleId) {
            $fam = isset($this->data['familles'][$familleId]) ? $this->data['familles'][$familleId] : array();

            $conjointId = null;
            if (isset($fam['mari']) && $fam['mari'] !== $id) {
                $conjointId = $fam['mari'];
            } elseif (isset($fam['epouse']) && $fam['epouse'] !== $id) {
                $conjointId = $fam['epouse'];
            }

            $conjoint         = $conjointId ? $this->buildPersonData($conjointId)     : null;
            $conjointParents  = $conjointId ? $this->getParentSummaries($conjointId)  : array();
            $conjointSiblings = $conjointId ? $this->getSiblingSummaries($conjointId) : array();

            $enfants = array();
            if (!empty($fam['enfants'])) {
                foreach ($fam['enfants'] as $childId) {
                    $child = $this->buildSummaryById($childId);
                    if ($child !== null) {
                        $enfants[] = $child;
                    }
                }
            }

            $result[] = array(
                'famille_id'        => $familleId,
                'mariage'           => isset($fam['mariage'])      ? $fam['mariage']      : null,
                'commentaires'      => isset($fam['commentaires']) ? $fam['commentaires'] : array(),
                'conjoint'          => $conjoint,
                'conjoint_parents'  => $conjointParents,
                'conjoint_siblings' => $conjointSiblings,
                'enfants'           => $enfants,
                'documents'         => isset($fam['documents']) ? $fam['documents'] : array(),
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
        $this->updatePersonFields($id, $data);
        $this->persist();
    }

    /**
     * Applique les champs d'un individu en mémoire, sans écrire sur disque.
     * Utilisé par savePerson() (écrit tout de suite) et saveAll() (écrit une
     * seule fois à la fin du lot, plutôt qu'une fois par personne/famille).
     */
    private function updatePersonFields($id, $data)
    {
        if (!isset($this->data['individus'][$id])) {
            throw new RuntimeException('Individu introuvable : ' . $id);
        }
        $p = &$this->data['individus'][$id];

        $fields = array('nom', 'prenom', 'sexe', 'naissance',
                        'deces', 'sepulture', 'professions', 'residences', 'commentaires', 'documents');
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

        // Parents : rattache l'individu à la famille correspondante (créée/
        // réutilisée si besoin) plutôt que d'écrire un tableau dupliqué.
        if (array_key_exists('parents', $data)) {
            $parentIds = is_array($data['parents']) ? array_values(array_unique($data['parents'])) : array();
            $this->applyParentsChange($id, $parentIds);
        }
    }

    /**
     * Rattache $childId à la famille correspondant à $parentIds (0 à 2 ids).
     * Réutilise, dans l'ordre : une famille existante avec exactement ce
     * couple, sinon la famille de naissance actuelle de l'enfant (mise à
     * jour), sinon en crée une nouvelle. Évite de recréer des familles vides
     * en double à chaque édition.
     */
    private function applyParentsChange($childId, $parentIds)
    {
        $this->ensureIndexes();
        $oldFamId = isset($this->childToFamily[$childId]) ? $this->childToFamily[$childId] : null;

        if (empty($parentIds)) {
            if ($oldFamId !== null) {
                $this->removeChildFromFamily($childId, $oldFamId);
                $this->invalidateIndexes();
            }
            return;
        }

        // Détermine mari/épouse à partir du sexe de chaque parent fourni
        // (par élimination si le sexe n'est pas renseigné).
        $mari = null;
        $epouse = null;
        foreach ($parentIds as $pid) {
            $sexe = isset($this->data['individus'][$pid]['sexe']) ? $this->data['individus'][$pid]['sexe'] : null;
            if ($sexe === 'F' && $epouse === null) {
                $epouse = $pid;
            } elseif ($sexe !== 'F' && $mari === null) {
                $mari = $pid;
            } else {
                $epouse = $pid;
            }
        }

        // 1. Une famille existante avec exactement ce couple ?
        $targetFamId = null;
        foreach ($this->data['familles'] as $fid => $fam) {
            $fMari   = isset($fam['mari'])   ? $fam['mari']   : null;
            $fEpouse = isset($fam['epouse']) ? $fam['epouse'] : null;
            if ($fMari === $mari && $fEpouse === $epouse) {
                $targetFamId = $fid;
                break;
            }
        }

        // 2. Sinon, réutiliser (et corriger) la famille de naissance actuelle
        if ($targetFamId === null && $oldFamId !== null) {
            $targetFamId = $oldFamId;
            if ($mari)   { $this->data['familles'][$targetFamId]['mari']   = $mari; }
            else         { unset($this->data['familles'][$targetFamId]['mari']); }
            if ($epouse) { $this->data['familles'][$targetFamId]['epouse'] = $epouse; }
            else         { unset($this->data['familles'][$targetFamId]['epouse']); }
        }

        // 3. Sinon, en créer une nouvelle
        if ($targetFamId === null) {
            $targetFamId = $this->generateFamilyId();
            $fam = array();
            if ($mari)   $fam['mari']   = $mari;
            if ($epouse) $fam['epouse'] = $epouse;
            $this->data['familles'][$targetFamId] = $fam;
        }

        // Déplace l'enfant : retire de l'ancienne famille si différente, ajoute à la nouvelle
        if ($oldFamId !== null && $oldFamId !== $targetFamId) {
            $this->removeChildFromFamily($childId, $oldFamId);
        }
        $enfants = isset($this->data['familles'][$targetFamId]['enfants'])
            ? $this->data['familles'][$targetFamId]['enfants'] : array();
        if (!in_array($childId, $enfants, true)) {
            $enfants[] = $childId;
        }
        $this->data['familles'][$targetFamId]['enfants'] = array_values($enfants);

        $this->invalidateIndexes();
    }

    /** Retire un enfant d'une famille ; supprime la famille si elle devient totalement vide. */
    private function removeChildFromFamily($childId, $famId)
    {
        if (!isset($this->data['familles'][$famId])) {
            return;
        }
        $fam = &$this->data['familles'][$famId];
        if (isset($fam['enfants'])) {
            $enfants = array_values(array_diff($fam['enfants'], array($childId)));
            if (empty($enfants)) {
                unset($fam['enfants']);
            } else {
                $fam['enfants'] = $enfants;
            }
        }
        if (empty($fam['mari']) && empty($fam['epouse']) && empty($fam['enfants'])) {
            unset($this->data['familles'][$famId]);
        }
    }

    public function saveFamily($id, $data)
    {
        $this->updateFamilyFields($id, $data);
        $this->persist();
    }

    /** Équivalent de updatePersonFields() pour une famille (voir son commentaire). */
    private function updateFamilyFields($id, $data)
    {
        if (!isset($this->data['familles'][$id])) {
            throw new RuntimeException('Famille introuvable : ' . $id);
        }
        $fam = &$this->data['familles'][$id];

        if (array_key_exists('documents', $data)) {
            if ($data['documents'] === null || (is_array($data['documents']) && count($data['documents']) === 0)) {
                unset($fam['documents']);
            } else {
                $fam['documents'] = $data['documents'];
            }
        }

        if (array_key_exists('mariage', $data)) {
            if ($data['mariage'] === null) {
                unset($fam['mariage']);
            } else {
                $fam['mariage'] = $data['mariage'];
            }
        }

        if (array_key_exists('commentaires', $data)) {
            if (empty($data['commentaires'])) {
                unset($fam['commentaires']);
            } else {
                $fam['commentaires'] = $data['commentaires'];
            }
        }

        if (isset($data['enfants'])) {
            $newChildren = array_values(array_unique($data['enfants']));
            if (empty($newChildren)) {
                unset($fam['enfants']);
            } else {
                $fam['enfants'] = $newChildren;
            }
            $this->invalidateIndexes();
        }
    }

    private function persist()
    {
        $path = JSON_DATA_PATH;

        $t = microtime(true);
        $json = json_encode($this->data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        Perf::mark('json_encode', (microtime(true) - $t) * 1000);
        if ($json === false) {
            throw new RuntimeException('Erreur d\'encodage JSON : ' . json_last_error_msg());
        }

        $fp = fopen($path, 'c+');
        if (!$fp) {
            throw new RuntimeException('Impossible d\'ouvrir : ' . $path);
        }

        // Chronométré séparément : un verrou pris par une autre requête concurrente
        // (un autre utilisateur qui enregistre en même temps) se verrait ici.
        $t = microtime(true);
        $locked = flock($fp, LOCK_EX);
        Perf::mark('flock_wait', (microtime(true) - $t) * 1000);
        if (!$locked) {
            fclose($fp);
            throw new RuntimeException('Impossible de verrouiller le fichier JSON');
        }

        $t = microtime(true);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, $json);
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        Perf::mark('file_write', (microtime(true) - $t) * 1000);
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
            $fields = array('nom','prenom','sexe','naissance','deces',
                            'sepulture','professions','residences','commentaires','documents','sosa');
            foreach ($fields as $f) {
                if (isset($pData[$f]) && $pData[$f] !== null) {
                    $person[$f] = $pData[$f];
                }
            }
            $this->data['individus'][$realId] = $person;
            $idMap[$tempId] = $realId;
        }

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

            // Un enfant peut déjà appartenir à une autre famille (ex : le
            // client recrée une famille depuis zéro en rouvrant l'édition
            // d'une fiche qui avait déjà un parent enregistré) : on l'en
            // retire pour ne pas le dupliquer dans deux familles à la fois.
            foreach ($enfants as $childId) {
                foreach (array_keys($this->data['familles']) as $fid) {
                    if ($fid === $realId || empty($this->data['familles'][$fid]['enfants'])) {
                        continue;
                    }
                    if (in_array($childId, $this->data['familles'][$fid]['enfants'], true)) {
                        $this->removeChildFromFamily($childId, $fid);
                    }
                }
            }

            $idMap[$tempId] = $realId;
        }
        if (!empty($newFamilies)) {
            $this->invalidateIndexes();
        }

        // 3. Supprimer des familles
        $deleteFamilies = isset($payload['deleteFamilies']) ? $payload['deleteFamilies'] : array();
        foreach ($deleteFamilies as $fid) {
            $fid = $resolve($fid);
            unset($this->data['familles'][$fid]);
        }
        if (!empty($deleteFamilies)) {
            $this->invalidateIndexes();
        }

        // 4. Mettre à jour les personnes existantes
        $updatePersons = isset($payload['updatePersons']) ? $payload['updatePersons'] : array();
        foreach ($updatePersons as $pid => $pData) {
            $pid = $resolve($pid);
            if (isset($pData['parents'])) {
                $pData['parents'] = array_map($resolve, $pData['parents']);
            }
            if (isset($this->data['individus'][$pid])) {
                $this->updatePersonFields($pid, $pData);
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
                $this->updateFamilyFields($fid, $fData);
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

    public function getSosaMap()
    {
        $map = array();
        foreach ($this->data['individus'] as $id => $p) {
            if (!is_array($p) || !isset($p['sosa'])) {
                continue;
            }
            $sosa = (int) $p['sosa'];

            // Naissance
            $naissance_date  = null;
            $naissance_ville = null;
            if (isset($p['naissance']) && is_array($p['naissance'])) {
                $naissance_date  = isset($p['naissance']['date']) ? $p['naissance']['date'] : null;
                $lieu = isset($p['naissance']['lieu']) && is_array($p['naissance']['lieu'])
                    ? $p['naissance']['lieu'] : array();
                $naissance_ville = isset($lieu['ville']) ? $lieu['ville'] : null;
            }

            // Décès
            $deces_date  = null;
            $deces_ville = null;
            if (isset($p['deces']) && is_array($p['deces'])) {
                $deces_date  = isset($p['deces']['date']) ? $p['deces']['date'] : null;
                $lieu = isset($p['deces']['lieu']) && is_array($p['deces']['lieu'])
                    ? $p['deces']['lieu'] : array();
                $deces_ville = isset($lieu['ville']) ? $lieu['ville'] : null;
            }

            // Mariage (première union, dérivée de familles)
            $mariage_date  = null;
            $mariage_ville = null;
            $unionFamIds = $this->getUnionFamilyIds($id);
            if (!empty($unionFamIds)) {
                $fam = $this->data['familles'][$unionFamIds[0]];
                if (isset($fam['mariage']) && is_array($fam['mariage'])) {
                    $mariage_date = isset($fam['mariage']['date']) ? $fam['mariage']['date'] : null;
                    $lieu = isset($fam['mariage']['lieu']) && is_array($fam['mariage']['lieu'])
                        ? $fam['mariage']['lieu'] : array();
                    $mariage_ville = isset($lieu['ville']) ? $lieu['ville'] : null;
                }
            }

            $map[$sosa] = array(
                'id'             => $id,
                'nom'            => isset($p['nom'])    ? $p['nom']    : null,
                'prenom'         => isset($p['prenom']) ? $p['prenom'] : null,
                'naissance_date' => $naissance_date,
                'naissance_ville'=> $naissance_ville,
                'deces_date'     => $deces_date,
                'deces_ville'    => $deces_ville,
                'mariage_date'   => $mariage_date,
                'mariage_ville'  => $mariage_ville,
            );
        }
        return $map;
    }

    private function generateFamilyId()    {
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

    /** Enfants d'un couple, lus directement dans familles (source de vérité unique). */
    private function findChildrenOfCouple($maleId, $femaleId)
    {
        $children = array();
        foreach ($this->data['familles'] as $fam) {
            $mari   = isset($fam['mari'])   ? $fam['mari']   : null;
            $epouse = isset($fam['epouse']) ? $fam['epouse'] : null;
            if ($mari !== $maleId || $epouse !== $femaleId) {
                continue;
            }
            if (!empty($fam['enfants'])) {
                foreach ($fam['enfants'] as $childId) {
                    $s = $this->buildSummaryById($childId);
                    if ($s !== null) {
                        $children[] = $s;
                    }
                }
            }
            break; // une seule famille pour ce couple
        }
        return $children;
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
     *
     * Utilise une table explicite plutôt que iconv//TRANSLIT, dont la
     * translittération dépend de la plateforme (peu fiable sous PHP Windows,
     * ex : "Ü" n'était pas ramené à "u").
     */
    private function normalize($str)
    {
        if (!$str) {
            return '';
        }
        static $map = array(
            'à'=>'a','á'=>'a','â'=>'a','ã'=>'a','ä'=>'a','å'=>'a','ā'=>'a',
            'ç'=>'c','ć'=>'c','č'=>'c',
            'è'=>'e','é'=>'e','ê'=>'e','ë'=>'e','ē'=>'e','ė'=>'e','ę'=>'e',
            'ì'=>'i','í'=>'i','î'=>'i','ï'=>'i','ī'=>'i',
            'ñ'=>'n','ń'=>'n',
            'ò'=>'o','ó'=>'o','ô'=>'o','õ'=>'o','ö'=>'o','ø'=>'o','ō'=>'o',
            'ù'=>'u','ú'=>'u','û'=>'u','ü'=>'u','ū'=>'u',
            'ý'=>'y','ÿ'=>'y',
            'ß'=>'ss','æ'=>'ae','œ'=>'oe',
        );
        return strtr(mb_strtolower($str, 'UTF-8'), $map);
    }
}
