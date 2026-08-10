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

En développement local uniquement, le bouton **Actualiser les données** permet aussi d’exécuter directement les collecteurs intégrés pour :

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
npm run refresh   # lance une collecte planifiée côté serveur
npm run db:backup # crée une sauvegarde cohérente de SQLite
```

## Ports locaux

- `3220` : interface web ;
- `3500` : API RadarPrix.

L’historique est accessible par l’API locale `/api/history` avec la clé du
produit, ou avec son enseigne et son URL.

## Classement

Le score tient compte de la remise réelle, du montant économisé, de la disponibilité et de la fraîcheur du relevé. Les produits identiques sont regroupés afin d’afficher un seul article et plusieurs vendeurs comparables.

## Production

L’architecture de production reste volontairement simple :

```text
Vinext / frontend web
        │ HTTPS
        ▼
API Node PrixRadar
        │
        ▼
volume SQLite persistant
        │
        ▼
collecteurs contrôlés ou planifiés
```

Le Worker Cloudflare reste limité au frontend, aux ressources statiques et à l’optimisation d’images. Il ne charge ni `node:sqlite` ni les collecteurs. La liaison D1 présente dans le scaffolding Vinext n’est pas la base PrixRadar et aucune migration D1 n’est effectuée.

### Frontend web

Construire l’application avec `npm run build`, puis lancer le serveur Vinext de production avec `npm run start:web`. Le frontend requiert une origine publique explicite, une URL interne pour ses composants serveur et, lorsque le navigateur contacte directement l’API, une URL publique distincte :

```text
PRIXRADAR_SITE_URL
PRIXRADAR_API_INTERNAL_URL
NEXT_PUBLIC_PRIXRADAR_API_URL
```

En production, les valeurs absentes ou pointant vers localhost provoquent une erreur claire. Le secret de collecte ne doit jamais être fourni au build frontend ou à une variable `NEXT_PUBLIC_*`.

### API Node

Lancer uniquement l’API avec :

```powershell
npm run start:api
```

`npm run start:production` lance l’API et le serveur Vinext compilé dans deux processus sans watcher. Cette commande convient à un hôte unique ; sur deux services, utiliser `start:api` et `start:web` séparément. `npm run dev` reste l’orchestrateur local avec HMR et proxy `/api` vers `127.0.0.1:3500` ; il ne doit pas être utilisé comme commande de production.

Variables de l’API :

```text
NODE_ENV
PRIXRADAR_SITE_URL
PRIXRADAR_DATA_DIR ou PRIXRADAR_DB_PATH
PRIXRADAR_REFRESH_SECRET
PRIXRADAR_API_HOST
PRIXRADAR_API_PORT ou PORT
PRIXRADAR_STARTUP_COLLECTION
PRIXRADAR_SHUTDOWN_GRACE_MS
CHROMIUM_PATH
```

Copier `.env.example` pour le développement seulement. Les valeurs de production et les secrets doivent être injectés par la plateforme et ne doivent jamais être commités.

### Base persistante et snapshots

SQLite est la source de vérité en exécution. Monter un disque ou volume persistant et définir par exemple `PRIXRADAR_DATA_DIR=/data`. Le fichier devient `/data/radarprix.sqlite.db`; un redémarrage ne le remplace ni ne le recrée s’il est déjà peuplé.

Les fichiers `data/*-products.json` sont des snapshots de bootstrap, de récupération et de référence. Ils ne sont importés que lorsque l’univers correspondant est réellement vide. Avec un répertoire de données externe, les snapshots générés après collecte y restent, tandis que les snapshots livrés avec l’application restent disponibles pour initialiser un volume neuf. Le site en production ne revient donc pas aux JSON à chaque redémarrage.

### Collecteurs et planification

Les collecteurs ne sont jamais lancés par un visiteur en production. Deux entrées serveur sont disponibles :

```powershell
npm run refresh
```

ou :

```http
POST /api/admin/refresh
Authorization: Bearer <PRIXRADAR_REFRESH_SECRET>
```

Planifier `npm run refresh` une fois par jour avec le cron de l’hôte, ou faire appeler la route protégée par un ordonnanceur de confiance. Le contrôle quotidien utilise toujours `Africa/Casablanca`. Le rattrapage au démarrage est conservé et la vérification toutes les 30 minutes ne relance rien lorsqu’une collecte réussie existe déjà pour la date marocaine.

Un verrou mémoire et un fichier de verrou atomique dans le volume de données empêchent les doublons entre requête admin, démarrage et commande planifiée sur le même volume. Une réponse concurrente contient `status: "already_running"`. Le verrou n’est pas présenté comme un ordonnanceur distribué pour plusieurs régions indépendantes.

TechSpace, UltraPC, NextLevelPC, Electro Bousfiha, Biougnach et Brands Corners utilisent des requêtes HTTP. Electroplanet essaie Chromium via Puppeteer puis conserve son repli HTTP. Le conteneur installe Chromium, définit `CHROMIUM_PATH=/usr/bin/chromium` et utilise les arguments `--no-sandbox` et `--disable-dev-shm-usage` déjà prévus par le collecteur.

### Santé, cache et exposition API

`GET /api/health` effectue uniquement une lecture SQLite minimale et renvoie HTTP 503 si la base est inaccessible. `GET /api/refresh-status` fournit l’état public non sensible de la collecte. Les erreurs client sont nettoyées ; les détails restent dans les journaux serveur.

Les origines CORS sont limitées à `PRIXRADAR_SITE_URL` (et aux origines loopback en développement), jamais à `*`. CORS ne remplace pas l’authentification admin. Les endpoints de lecture ont un cache court de 60 secondes, ou 5 minutes pour les produits et historiques. Les composants serveur utilisent un délai maximal de 5 secondes pour un produit et 8 secondes pour l’index. Une collecte terminée reconstruit le cache applicatif ; les caches intermédiaires expirent naturellement en quelques minutes.

### Docker

Le `Dockerfile` construit un conteneur API Node 22 sans watcher de développement, exécuté par l’utilisateur non-root `node`, avec Chromium et un healthcheck. Exemple :

```powershell
$env:PRIXRADAR_SITE_URL='https://prixradar.example'
$env:PRIXRADAR_REFRESH_SECRET='replace-with-a-long-random-secret'
docker compose up --build -d
docker compose restart api
docker compose exec api npm run db:backup
```

Le volume nommé `radarprix-data` conserve SQLite pendant les redémarrages et remplacements du conteneur. Le frontend est déployé séparément.

### Sauvegarde et restauration

`npm run db:backup` utilise l’API de sauvegarde en ligne de SQLite et écrit par défaut dans `<data-dir>/backups`. `PRIXRADAR_BACKUP_DIR` permet de choisir un autre disque.

Pour restaurer : arrêter l’API et toute collecte, conserver une copie du fichier actuel, copier la sauvegarde choisie vers le chemin `PRIXRADAR_DB_PATH` (ou `<PRIXRADAR_DATA_DIR>/radarprix.sqlite.db`), vérifier les droits du compte de service, puis redémarrer et appeler `/api/health`.

### Notes de sécurité

- `/api/admin/refresh` exige un secret comparé en temps constant.
- `/api/refresh` est absent en production et reste limité au loopback en développement.
- Le secret ne doit jamais entrer dans JavaScript navigateur, les journaux ou une URL.
- La base de production doit résider sur un stockage persistant et être sauvegardée régulièrement.
- Les collecteurs ne doivent être lancés que par des contextes serveur de confiance.
- La limitation d’abus admin actuelle est le verrou de travail coûteux ; une limite distribuée nécessiterait une infrastructure partagée et n’est pas simulée ici.

Ces mesures durcissent l’exploitation initiale mais ne constituent pas un audit de sécurité complet.
