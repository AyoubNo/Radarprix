# PrixRadar Maroc

Comparateur local autonome qui classe les meilleures promotions de sept enseignes marocaines dans deux univers : **PC & Gaming** et **Maison & Électroménager**.

## Projet autonome

Ce dépôt contient tout ce qui est nécessaire :

- l’interface RadarPrix ;
- l’API locale ;
- les collecteurs des sept enseignes ;
- une base SQLite locale avec l’historique quotidien ;
- une copie locale de plus de 34 000 produits dans `data/`.

Il ne dépend pas des anciens dépôts `comparateur-pc-maroc` ou `comparateur-electromenager-maroc`, ni de leurs serveurs sur les ports 3300 et 3400.

## Installation Windows

1. Clonez ou téléchargez uniquement ce dépôt.
2. Double-cliquez sur `INSTALLER.bat`.
3. Le script vérifie Node.js 22+, l’installe avec `winget` si nécessaire, puis installe les dépendances.
4. Double-cliquez sur `LANCER-PRIXRADAR.bat`.

La fenêtre de lancement doit rester ouverte. Sa fermeture arrête PrixRadar.

Application : [http://localhost:3220/#classement](http://localhost:3220/#classement)

## Données

Au démarrage, RadarPrix charge immédiatement les snapshots inclus dans `data/`.
Lors du premier lancement sur une nouvelle machine, il crée automatiquement
`data/radarprix.sqlite.db` et l’initialise depuis ces snapshots.

Après le démarrage, l’API vérifie automatiquement si la collecte du jour a déjà
été effectuée (date du Maroc). Si elle manque, elle lance la mise à jour en
arrière-plan. Cette vérification est répétée toutes les 30 minutes tant que
l’application reste ouverte.

Le bouton **Actualiser les données** permet aussi d’exécuter directement les collecteurs intégrés pour :

- TechSpace ;
- UltraPC ;
- NextLevelPC ;
- Electroplanet ;
- Electro Bousfiha ;
- Biougnach ;
- Brands Corners.

Chaque enseigne est mise à jour indépendamment. Si une enseigne est temporairement inaccessible, ses données précédentes sont conservées et les autres mises à jour continuent.

Pour chaque produit réellement observé, la base enregistre un relevé quotidien
avec le prix, l’ancien prix, la remise et la disponibilité. Plusieurs
actualisations le même jour mettent à jour le relevé du jour au lieu de créer
des doublons. La base reste locale et n’a besoin d’aucun serveur PostgreSQL.

Pour garantir une capture chaque jour, PrixRadar doit rester lancé au moins le
temps de la collecte quotidienne. S’il était arrêté, le relevé manquant est
rattrapé automatiquement au prochain démarrage.

Une connexion Internet est nécessaire pour actualiser les prix et afficher les images. Le catalogue local reste consultable sans nouvelle collecte.

## Commandes utiles

```powershell
npm run dev       # lance l’interface et l’API RadarPrix
npm run build     # compile et vérifie l’application
npm test          # lance la compilation et les tests
npm run snapshot  # actualise les sept enseignes et remplace les snapshots
```

## Ports locaux

- `3220` : interface web ;
- `3500` : API RadarPrix.

L’historique est accessible par l’API locale `/api/history` avec la clé du
produit, ou avec son enseigne et son URL.

## Classement

Le score tient compte de la remise réelle, du montant économisé, de la disponibilité et de la fraîcheur du relevé. Les produits identiques sont regroupés afin d’afficher un seul article et plusieurs vendeurs comparables.
