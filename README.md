# PrixRadar Maroc

Comparateur local qui classe automatiquement les meilleures promotions de sept enseignes marocaines dans deux univers : **PC & Gaming** et **Maison & Électroménager**.

## Installation Windows

1. Double-cliquez sur `INSTALLER.bat` après le premier téléchargement ou `git pull`.
2. Le script vérifie Node.js 22+, l'installe avec `winget` si nécessaire, puis installe les dépendances.
3. Double-cliquez sur `LANCER-PRIXRADAR.bat` pour ouvrir l'application.

La fenêtre de lancement doit rester ouverte. Sa fermeture arrête PrixRadar.

Application : [http://localhost:3220/#classement](http://localhost:3220/#classement)

## Données

PrixRadar utilise les API locales des comparateurs PC et électroménager lorsqu'elles sont disponibles. Une copie locale récente des produits est incluse dans `data/`, ce qui permet à l'application de fonctionner immédiatement sur une nouvelle machine.

Le bouton **Actualiser les données** recharge explicitement les sources. La pagination reste instantanée grâce au cache : une actualisation automatique périmée s'effectue en arrière-plan sans bloquer le changement de page.

## Commandes utiles

```powershell
npm run dev       # lance l'interface et l'API PrixRadar
npm run build     # compile et vérifie l'application
npm test          # lance la compilation et les tests
npm run snapshot  # renouvelle les copies locales depuis les deux API sources
```

## Classement

Le score tient compte de la remise réelle, du montant économisé, de la disponibilité et de la fraîcheur du relevé. Les produits identiques sont regroupés afin d'afficher un seul article et plusieurs vendeurs comparables.
