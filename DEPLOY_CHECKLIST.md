# Deploy checklist — LLM Council (Node.js)

Checklist à dérouler après chaque déploiement sur `council.mesoutilsagile.com`.

## 1. DNS (uniquement au premier déploiement)

- [ ] Enregistrement A `council.mesoutilsagile.com` → `151.80.232.214`
- [ ] Propagation : `dig council.mesoutilsagile.com +short` retourne bien l'IP
- [ ] À faire **avant** de lancer `deploy-council.ps1 -Init` (sinon Certbot échoue)

## 2. Pré-requis VPS

```bash
ssh ubuntu@151.80.232.214 'node --version'   # >= 20 recommandé (>= 18 minimum pour fetch natif)
ssh ubuntu@151.80.232.214 'pm2 --version'
ssh ubuntu@151.80.232.214 'nginx -v'
ssh ubuntu@151.80.232.214 'sudo netstat -tlnp | grep -E ":(5700|5701|5702|5703|5704|5705|5706)"'
```

Le port **5706** ne doit pas apparaître avant le déploiement (sinon collision).

## 3. Pendant le déploiement

À surveiller dans la sortie du `.ps1` :

- [ ] `OK SSH operationnel`
- [ ] `Frontend build dans frontend/dist/` (>= 200 KB)
- [ ] `deploy.zip cree (X.X MB)` — vérifier qu'il fait < 1 MB (sinon des fichiers inutiles ont été inclus)
- [ ] `[OK] deps Node installees` (sans WARNING npm grave)
- [ ] `[OK] Backend repond sur le port 5706` — c'est le health 200 critique
- [ ] `OK Nginx vhost actif`
- [ ] `OK HTTPS actif sur https://council.mesoutilsagile.com`

## 4. Validation fonctionnelle

```bash
curl https://council.mesoutilsagile.com/health
curl https://council.mesoutilsagile.com/api/config
```

Le 2e doit renvoyer la liste des modèles council + le chairman.

Dans le navigateur :

- [ ] https://council.mesoutilsagile.com charge la SPA
- [ ] Clic "+ Nouvelle" crée une conversation (visible dans la sidebar)
- [ ] Envoi d'un message simple ("test") déclenche le pipeline
- [ ] Stage 1 affiche les onglets des modèles **un par un** (streaming SSE)
- [ ] Stage 2 affiche le tableau d'agrégat + les évaluations détaillées
- [ ] Stage 3 affiche la réponse finale avec fond vert
- [ ] Le bloc pricing en bas affiche tokens + coût USD
- [ ] Reload la page → la conversation est toujours là avec tout l'historique

## 5. Vérifications techniques

```bash
ssh ubuntu@151.80.232.214 'pm2 status'                              # llm-council "online"
ssh ubuntu@151.80.232.214 'pm2 logs llm-council --lines 50 --nostream'   # sans erreur
ssh ubuntu@151.80.232.214 'sudo nginx -t'                            # config valide
ssh ubuntu@151.80.232.214 'ls -la /home/ubuntu/llm-council/.env'     # permissions 600
curl -vI https://council.mesoutilsagile.com 2>&1 | grep -i 'subject\|expire\|verify'
```

## 6. Métriques de sanité (post-1ères requêtes)

- [ ] `data/conversations/` contient des fichiers `.json` avec les pipelines complets
- [ ] Chaque JSON contient `metadata.label_to_model` et `pricing.total` (vérifie la persistence)
- [ ] PM2 mémoire < 150 MB (Fastify + petites deps = très léger)
- [ ] Logs sans `ERROR` (les `WARN` sur retry sont OK)

## 7. En cas d'échec

| Symptôme | Première vérif |
|---|---|
| 502 Bad Gateway | `pm2 logs llm-council` — backend down ? |
| 504 Gateway Timeout | `REQUEST_TIMEOUT` trop court ? le modèle pris est-il lent ? (la valeur est en **ms**) |
| CORS dans la console JS | `CORS_ORIGINS` dans `.env` contient bien `https://council.mesoutilsagile.com` |
| Certbot fail | DNS pas propagé ? `dig council.mesoutilsagile.com +short` |
| SSE coupe au bout de 60s | Nginx `proxy_read_timeout` < 60s ? Devrait être 600s par le vhost |
| Coût USD `null` | OpenRouter n'a pas renvoyé `usage.cost` pour ce modèle (limite connue) |
| `Stage 2 fallback` partout | Modèles n'honorent pas `response_format: json_object` ; revoir les modèles ou rester en fallback regex |
| `fetch is not defined` | Node < 18 sur le VPS ; upgrade requis |

## 8. Rollback rapide

Le script ne fait pas de backup tar comme le pattern git-tag, mais le `.env` et `data/` sont préservés. En cas de bug critique :

```bash
ssh ubuntu@151.80.232.214 'pm2 stop llm-council'

# Ou re-déployer la version précédente depuis local
git checkout <previous-commit>
.\deploy-council.ps1
```

Pour du rollback automatique avec backup tar, migrer vers le pattern git-tag décrit dans le skill `deploy-vps`.
