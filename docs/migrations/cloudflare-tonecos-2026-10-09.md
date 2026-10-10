# Migração Cloudflare — Tonecos Studio — 2026-10-09

## Objetivo

Mover a infraestrutura do Catálogo da conta Cloudflare Washington para a conta Tonecos Studio sem alterar a identidade lógica dos recursos, sem perda de dados e mantendo rollback disponível até o fechamento do cutover.

## Destino canônico ativo

- Conta Cloudflare: Tonecos Studio
- Account ID: `8827c547d6def5ee5b9ca550fdd5680a`
- Worker: `tonecos-catalogo-api`
- API: `https://tonecos-catalogo-api.tonecosstudio.workers.dev`
- D1: `tonecos-catalogo`
- D1 ID: `87006366-60f3-4937-af73-2ef5a5f901fb`
- R2: `tonecos-catalogo-media`
- Mídia pública: `https://pub-bc7ed3247d8d4391946761221e77e6b9.r2.dev`
- Turnstile sitekey: `0x4AAAAAAFSpOhaAFp6Gsjqd`

Este documento registra evidência histórica da migração. Para configuração operacional corrente, o binding D1 de produção tem `wrangler.jsonc` como SSOT; não criar uma segunda autoridade em Repository Variable.

## Evidências de integridade

Migração de dados concluída e validada antes do cutover público:

- 2.596 modelos;
- 1.063 pastas;
- 250 franquias;
- 6 categorias;
- 12.717 objetos R2;
- 512.294.967 bytes no R2;
- inventário `key + size + ETag` idêntico entre origem e destino;
- FTS5, índices e triggers reconstruídos e comparados;
- buscas de controle e fingerprints lógicos equivalentes.

Inventário R2 validado: SHA-256 `7f6730…d76d`.

## Smoke pós-reset do D1

Após o reset diário do D1 Free em 2026-10-10 00:00 UTC, foi executado smoke interno na própria Cloudflare contra o Worker Tonecos:

- `/api/health` — OK;
- `/api/categories` — OK;
- `/api/recent?limit=3` — OK;
- `/api/catalog?q=naruto&limit=3` — OK.

O D1 confirmou novamente as contagens canônicas de 2.596 modelos, 1.063 pastas, 250 franquias e 6 categorias.

Uma revalidação read-only posterior confirmou também 2.596 imagens lógicas e que a produção permanece em `0010_recent_models_index.sql` enquanto o primeiro deploy automatizado pós-cutover aguarda a credencial de CI.

## Estado do cutover

O cutover público foi concluído.

- Repository Variables do `washingtonmsdj/catalogo` apontam para Account ID, API, mídia e Turnstile da Tonecos Studio;
- o binding D1 de produção é versionado no `wrangler.jsonc` e derivado pelo workflow, sem Repository Variable concorrente;
- o GitHub Pages foi recompilado e o bundle publicado foi conferido com os endpoints/sitekey Tonecos;
- a PR `washingtonmsdj/acheguese#661` foi mergeada, movendo o proxy first-party `/catalogo-api` para `tonecos-catalogo-api.tonecosstudio.workers.dev`;
- o deploy Vercel correspondente ficou `READY` nos aliases `acheguese.com.br` e `www.acheguese.com.br`;
- health, recentes, busca e a superfície `/tonecosstudios/` responderam `200` depois do corte;
- os Workers/Workflows temporários de migração foram removidos;
- a conta Washington preserva a infraestrutura antiga do Catálogo somente como rollback.

O runtime público não depende mais da conta Washington. O rollback antigo não deve ser apagado até o encerramento formal da janela de reversão.

O CI/CD do Worker permanece deliberadamente fail-closed: `CLOUDFLARE_ACCOUNT_ID` e `TURNSTILE_SECRET_KEY` estão configurados, mas `CLOUDFLARE_API_TOKEN` continua sendo o gate externo restante. As conexões OAuth disponíveis não têm autorização para criar API Tokens na Cloudflare. Nenhuma credencial deve ser adicionada ao repositório.

A PR #145 já integrou à `main` a política `migrate-before-worker` e o gate que classifica `0011`–`0019` como migrations `expand` e rejeita operações destrutivas antes da promoção. A PR #144 concentra a promoção final: binding D1 canônico, derivação do ID a partir do Wrangler SSOT e execução desse gate imediatamente antes das migrations remotas. Ela deve permanecer draft enquanto o token de CI não puder ser provado.

## Regra operacional pós-cutover

1. manter D1, R2, Worker e Turnstile da Tonecos como produção canônica;
2. manter `wrangler.jsonc` como única autoridade versionada do binding D1;
3. manter a infraestrutura Washington somente para rollback até a janela ser encerrada formalmente;
4. configurar `CLOUDFLARE_API_TOKEN` como Actions Secret por canal seguro, com escopo mínimo para a conta Tonecos;
5. promover a #144 somente após o secret existir e o CI permanecer verde;
6. exigir **Deploy Cloudflare API** verde, migrations protegidas pelo gate migration-first e smoke público pós-deploy;
7. somente depois declarar o CI/CD Cloudflare totalmente fechado;
8. qualquer domínio customizado para API/mídia deve ser tratado separadamente, sem hardcode ou mudança de DNS oportunista.
