<?php
/**
 * Contrat du dépôt de personnes.
 *
 * Toute implémentation (JSON, SQLite, MySQL…) doit respecter cette interface.
 * La couche API ne connaît que cette interface : remplacer le dépôt ne
 * nécessite aucune modification des endpoints.
 */
interface IPersonRepository
{
    /**
     * Recherche les individus dont le nom ou le prénom contient $query.
     * La recherche est insensible aux accents et à la casse.
     *
     * @param  string $query   Terme recherché (min. 2 caractères recommandés)
     * @param  int    $limit   Nombre maximum de résultats
     * @return array           Tableau de résumés : id, nom, prenom, sexe,
     *                         naissance_year, deces_year
     */
    public function search($query, $limit = 20);

    /**
     * Retourne la fiche complète d'une personne avec ses liens familiaux.
     *
     * @param  string $id  Identifiant GEDCOM (ex. "@I2@")
     * @return array|null  Structure :
     *   - person           : données complètes de l'individu
     *   - parents          : résumés des parents
     *   - unions[]         : mariage + conjoint (données complètes)
     *                        + conjoint_parents + enfants (résumés)
     */
    public function getPerson($id);
}
