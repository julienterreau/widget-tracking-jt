# Visitor Tracker — édition Terre plate

Un tableau de bord Node.js/Express (même hébergement qu'avant) redessiné dans le style « Nocturnal Gazette » de Rusty James News : mêmes couleurs, mêmes polices (EB Garamond / Montserrat), même carte polaire que `components/visits/reader-map.tsx`.

> Les données d'exemple ne sont pas intégrées. Le tableau ne montre des données réelles qu'après déploiement et authentification administrateur.

## 1. Prérequis
- Node.js 20 ou plus récent
- Un hébergeur qui accepte une application Node.js (Render, Railway, Fly.io, VPS, serveur mutualisé Node, etc.)
- Un stockage persistant pour le dossier `data/` (important : certains hébergements effacent les fichiers locaux au redémarrage).

## 2. Installation locale
```bash
npm install
cp .env.example .env
```
Modifiez `.env` :
- `ADMIN_TOKEN` : remplacez par une longue chaîne secrète aléatoire (au moins 32 caractères).
- `PORT` : laissez `3000` en local.
- `PROXY_HOPS` : généralement `1` derrière un seul proxy/reverse proxy. Sur un serveur directement exposé, mettez `0`.
- `TRACKING_ENABLED` : active ou désactive la collecte.

Puis :
```bash
npm start
```
Ouvrez `http://localhost:3000`. Le tableau d'administration demande le `ADMIN_TOKEN`.

## 3. Déploiement sur un hébergeur Node
1. Envoyez le contenu du dossier sur votre dépôt Git (ou téléversez le ZIP).
2. Choisissez une application Node.js.
3. Commande d'installation : `npm install`
4. Commande de démarrage : `npm start`
5. Définissez les variables d'environnement dans le panneau de l'hébergeur : `ADMIN_TOKEN`, `TRACKING_ENABLED=true`, `PROXY_HOPS=1`.
6. Activez un disque/volume persistant monté sur le dossier du projet `data/`, ou remplacez le stockage JSON par une base de données managée si votre hébergeur ne conserve pas les fichiers locaux.
7. Ouvrez l'URL publique, puis saisissez le jeton dans « Jeton administrateur ».

## 4. Branchement sur rustyjamesblog.link
Le site possède déjà son propre suivi : `components/visit-tracker.tsx` envoie les visites à `/api/visites` (stockées dans Sanity), et la page `/visiteurs` les lit. Ce serveur reprend **le même contrat** pour pouvoir fonctionner à côté ou à la place :

| Route du site | Ici | Remarque |
|---|---|---|
| `POST /api/visites` `{ path, referrer, utm }` → `201 { id }` ou `204` | identique | mêmes filtres : robots, préchargement, chemins `/studio` et `/api` |
| `POST /api/visites/duree` `{ id, seconds }` → `204` | identique | accepte aussi `text/plain` (`sendBeacon` entre domaines) |
| `GET /api/visites/direct` → `{ online, visits[] }` | identique | « en ligne » = lecteurs uniques sur 5 min |

Choix possibles :
1. **En parallèle (le plus simple).** Gardez `VisitTracker` tel quel et ajoutez le widget sur le site : `<Script src="https://VOTRE-SERVEUR/widget.js" strategy="afterInteractive" />`. Les deux collectent, ce serveur sert de tableau de bord indépendant de Sanity. Les visites faites pendant que vous êtes connecté au panneau ne sont pas comptées.
2. **À la place de Sanity.** Retirez `<VisitTracker />` du layout et gardez le widget. La page `/visiteurs` du site continuera de lire Sanity et ne recevra plus de nouvelles visites : à ne faire que si vous la remplacez aussi par ce tableau de bord.
3. **Sans widget.** Dans `next.config.ts`, ajoutez une réécriture `{ source: "/api/visites/:path*", destination: "https://VOTRE-SERVEUR/api/visites/:path*" }` : `VisitTracker` parle alors à ce serveur sans autre modification (les en-têtes `CF-*` ne sont pas garantis d'être relayés : testez avant d'activer `USE_CLOUDFLARE`, et seulement si ce serveur n'accepte que le trafic de Cloudflare ou du site).

Ne mettez JAMAIS `ADMIN_TOKEN` dans le code public du site.

## 5. API
- `POST /api/visites` (alias `/api/visit`), `POST /api/visites/duree`, `GET /api/visites/direct` : voir ci-dessus.
- `GET /api/admin/summary?range=24h|7j|30j|tout|1h&q=&country=&city=` : synthèse (pays, villes, lecteurs, sources, appareils, `points` de la carte, dernières visites). Anciennes valeurs `7d` et `30d` acceptées.
- `GET /api/admin/stats`, `GET /api/admin/export` : bruts. Tous les `/api/admin/*` demandent l'en-tête `x-admin-token`.
- `GET /api/health` : état du service.

## 6. Carte et compatibilité avec le site
- `public/earth-disk.webp` est le même fichier que celui du site.
- `lib/projection.js` reprend `lib/visits/projection.ts` et `map-metrics.ts` (MAP_SIZE 760, rayon 300, disque visible 0,86) : azimutale équidistante, pôle Nord au centre, 0° en bas, est à droite.
- `/api/admin/summary` renvoie `points` au format `MapPoint` du site : `{ city, country, code, count, x, y }`. Les classes `.readers-*` de `public/styles.css` sont celles de `gazette.css`.
- Widget sur le site : ajouter `https://rustyjamesblog.link` (et `www`) dans `ALLOWED_ORIGINS`. Avec Next.js : `<Script src="https://VOTRE-SERVEUR/widget.js" strategy="afterInteractive" />`.

## 7. Vie privée et conformité
Comme le site (« l'adresse IP n'est jamais stockée »), ce serveur **n'écrit pas l'IP sur disque** par défaut : il garde un hash quotidien salé (`VISITOR_SALT`, même formule que `visitorHash()` du site, donc des identifiants identiques si vous utilisez le même sel). L'IP ne sert que le temps de la requête (limitation de débit, géolocalisation de secours). `STORE_IP=true` la conserve et l'affiche, uniquement si vous avez une base légale. Durée de conservation : `RETENTION_DAYS` (90 par défaut), `MAX_ROWS` (20 000). Protégez `data/visitors.json` et ses sauvegardes. La géolocalisation est approximative (VPN, réseau mobile).

Le secours `ipwho.is` n'est appelé que si Cloudflare ne fournit pas les coordonnées ; consultez ses conditions avant mise en production.

## 8. Widget « panneau de contrôle des visiteurs »
Ajoutez cette ligne dans n'importe quelle page de votre site :
```html
<script src="https://VOTRE-SERVEUR/widget.js" defer></script>
```
- Le script enregistre la visite (désactivable avec `data-track="false"`).
- Le panneau est **invisible pour vos visiteurs** : ouvrez votre site avec `#visitors` à la fin de l'URL (ex. `https://monsite.fr/#visitors`), un bouton « N en ligne » apparaît, puis saisissez votre `ADMIN_TOKEN`.
- Suit les pages comme le site : navigation interne de Next.js, referrer, UTM, durée de lecture.
- Onglets **Pays / Villes / Lecteurs**, période (1 h, 24 h, 7 j, 30 j, Tout), recherche libre, clic sur une ligne pour filtrer, export CSV.
- Si le widget est sur un autre domaine que le serveur, renseignez `ALLOWED_ORIGINS=https://monsite.fr` dans `.env`.
- Démo locale : `http://localhost:3000/widget-demo.html#visitors`

## 9. Cloudflare (optionnel)
Avec `USE_CLOUDFLARE=true`, le serveur lit `CF-Connecting-IP` (IP réelle) et `CF-IPCountry` (pays). Si la transformation « en-têtes de localisation des visiteurs » est active dans Cloudflare, `CF-IPCity`, `CF-IPLatitude` et `CF-IPLongitude` placent aussi le point sur la carte, sans appel à ipwho.is. Sans elle, ipwho.is fournit la ville, mais seulement si son pays est le même que celui de Cloudflare. Ces en-têtes n'existent que si **ce serveur** passe par Cloudflare (ou si une réécriture du site les lui relaie : à vérifier) ; celui de votre blog n'a pas d'effet sur lui.
