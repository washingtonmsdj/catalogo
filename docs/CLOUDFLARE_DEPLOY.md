# Deploy Cloudflare

O Catálogo usa `https://acheguese.com.br/tonecosstudios/` como URL pública canônica. O frontend é publicado no GitHub Pages e montado sob o Achegue-se por reverse proxy. A Cloudflare é responsável pela API, D1, R2 e Turnstile.

## Recursos canônicos de produção

Conta: **Tonecos Studio**.

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- D1 ID: `87006366-60f3-4937-af73-2ef5a5f901fb`
- R2: `tonecos-catalogo-media`
- binding D1: `DB`
- binding R2: `MEDIA`
- segredo obrigatório: `TURNSTILE_SECRET_KEY`

`wrangler.jsonc` é a SSOT versionada para nome do Worker, D1, R2, CORS, compatibility, observability e contrato de segredo. O UUID do D1 é configuração de infraestrutura, não segredo, e não deve ser duplicado como Repository Variable de produção.

O CORS de produção contém somente origens públicas autorizadas:

- `https://washingtonmsdj.github.io`
- `https://acheguese.com.br`
- `https://www.acheguese.com.br`

`localhost` e `127.0.0.1` não pertencem ao SSOT de produção; desenvolvimento local deve usar configuração de desenvolvimento separada.

## GitHub

### Repository Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

### Repository Secrets

- `CLOUDFLARE_API_TOKEN`
- `TURNSTILE_SECRET_KEY`

O workflow deriva `CLOUDFLARE_D1_DATABASE_ID` do `wrangler.jsonc` somente para o processo em execução. Esse valor derivado não é outra fonte de verdade.

## Token Cloudflare

O token de CI deve ser dedicado ao Catálogo, restrito à conta Tonecos e usar o menor privilégio suportado:

- Workers Editor no Worker `tonecos-catalogo-api`;
- D1 Edit;
- Workers R2 Storage Read.

Não conceder Workers Admin, Workers Routes Write, R2 Write, Billing ou administração de API Tokens apenas por conveniência.

## Gate de drift remoto

Antes de qualquer write no Worker, `tools/check_remote_worker_config.mjs` consulta a configuração remota da Cloudflare e compara somente propriedades que existem e são semanticamente gerenciadas pelo SSOT:

- `compatibility_date`;
- `compatibility_flags`;
- `observability.enabled`;
- conjunto exato de bindings esperados;
- `CORS_ORIGINS`;
- ID físico do D1;
- bucket R2;
- presença do binding secreto `TURNSTILE_SECRET_KEY`.

Qualquer divergência falha fechado antes do upload.

### Por que o upload remoto não usa `wrangler --strict`

No primeiro deploy automatizado pós-cutover, Wrangler `4.147.0` bloqueou `versions upload --strict` embora os recursos físicos estivessem corretos. A comparação remota tratou metadados locais do binding D1 — como `database_name` e `migrations_dir` — como conflito, embora esses campos não façam parte do binding remoto retornado pela API. O mesmo run também revelou `localhost` no CORS local de produção, que foi removido do SSOT.

Não removemos a proteção contra drift. O `--strict` remoto foi substituído pelo gate semântico acima, que compara explicitamente o estado que a Cloudflare realmente persiste. Isso evita tanto falso positivo quanto upload sobre drift real.

O CI de PR **continua** executando:

```text
wrangler versions upload --dry-run --strict --secrets-file <segredo-sintetico>
```

Esse dry-run valida localmente schema/configuração, empacotamento e secret binding sem acessar ou alterar produção.

## Fluxo de produção

`Deploy Cloudflare API` é fail-closed. A ordem é obrigatória:

1. preflight de `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY` e `VITE_API_BASE_URL`;
2. typecheck do Worker;
3. derivação do D1 ID canônico e render da configuração de deploy;
4. gate semântico contra a configuração remota do Worker;
5. captura do Version ID que está efetivamente servindo 100% do tráfego;
6. validação read-only do bucket R2;
7. criação de arquivo efêmero `0600` em `$RUNNER_TEMP` com `TURNSTILE_SECRET_KEY`, removido por `trap`;
8. `wrangler versions upload --secrets-file`, criando uma versão sem tráfego;
9. captura do Version ID staged pelo output NDJSON oficial do Wrangler;
10. gate `tools/check_migration_deploy_policy.py`;
11. aplicação somente das migrations D1 ainda pendentes;
12. deployment explícito `previous@100% + staged@0%`;
13. smoke completo da versão staged via `Cloudflare-Workers-Version-Overrides`;
14. retry bounded do smoke staged enquanto o deployment 0% propaga; nenhuma mutação é repetida;
15. promoção explícita de `staged@100%`;
16. confirmação bounded, via API Cloudflare, de que o deployment ativo é exatamente o Version ID staged em 100%;
17. retry bounded do **contrato público completo** sem override: health/schema, categorias, recentes, galeria e shared collections precisam convergir juntos;
18. se qualquer gate falhar depois do deployment 100/0 e antes de concluir o contrato público, `wrangler rollback <PREVIOUS_WORKER_VERSION_ID>`;
19. somente depois do Worker público saudável: auditoria D1 e manutenções opcionais.

A versão anterior continua atendendo usuários durante o staged smoke. A versão nova recebe 0% de tráfego normal até passar pelos gates.

## Contrato único de release

`tools/worker_release_smoke.mjs` é a autoridade do smoke de release e valida em conjunto:

- `/api/health` com schema contract;
- `/api/categories`;
- `/api/recent`;
- `/api/catalog` + endpoint de imagens/galeria;
- shared collections com contrato 404 esperado para um ID inexistente.

O mesmo contrato é usado em dois contextos:

- **staged**: com Version Override apontando explicitamente para a versão nova em 0%;
- **promovido**: sem override, depois que o plano de controle já reporta a versão nova em 100%.

Isso evita divergência entre “o que testamos antes” e “o que aceitamos depois” e elimina uma sequência de probes independentes que poderia misturar respostas de edges em estados diferentes.

## Retry bounded: somente leitura

`tools/bounded_retry.mjs` centraliza a política de retry. Ela é usada apenas em verificações read-only:

- smoke staged completo por Version Override;
- confirmação do Version ID ativo após promoção;
- smoke público completo após promoção.

Upload, migrations, criação de deployment, promoção, rollback e qualquer outra mutação **não** são repetidos automaticamente.

Os rollouts reais de 2026-10-10 mostraram por que o gate precisa cobrir o contrato inteiro:

1. logo após uma promoção, `/api/health` ainda respondeu pelo contrato antigo em alguns edges;
2. depois que health, categorias e recentes já tinham convergido, um request seguinte de `/api/catalog?limit=1` ainda respondeu sem `gallery_version`, embora a mesma versão staged já tivesse passado o contrato de galeria por Version Override.

Nos dois casos o rollback explícito funcionou. Portanto a correção não adiciona `sleep` cego nem retry isolado por rota: ela repete, por janela limitada e somente leitura, o **pacote completo de release** até todos os contratos responderem coerentemente.

## Segredo Turnstile

`wrangler secret put` é proibido no pipeline. Esse comando cria uma versão e pode implantá-la imediatamente, antecipando uma mutação antes dos gates.

Código + `TURNSTILE_SECRET_KEY` entram juntos na versão staged através de `--secrets-file`. O arquivo efêmero nunca é artifact, commit ou output do workflow.

## Migration-first

O schema D1 pode avançar antes da promoção do Worker somente enquanto as migrations pendentes forem **expand/backward-compatible**.

- `config/catalog-schema-contract.json` define as migrations exigidas pelo Worker;
- `config/migration-deploy-policy.json` define a estratégia permitida;
- `tools/check_migration_deploy_policy.py` exige cobertura exata e rejeita padrões destrutivos no fluxo migration-first.

Rollback restaura o Worker, não o D1. Por isso uma migration destrutiva futura exige estratégia própria; não pode ser incluída silenciosamente neste pipeline.

## Staged smoke e rollback

Version Override só pode selecionar versões que pertencem ao deployment atual. Por isso o workflow registra primeiro `previous@100% + staged@0%` e só então envia o header de override.

O checker staged exige o mesmo contrato completo que será usado depois da promoção. Se o override for ignorado e a versão antiga responder, o gate falha em vez de aceitar um falso-verde.

Após a promoção, `tools/check_promoted_worker_version.mjs` combina duas provas independentes:

1. o plano de controle da Cloudflare precisa reportar o Version ID staged como deployment ativo em 100%;
2. `tools/worker_release_smoke.mjs` precisa passar integralmente sem override dentro da janela bounded.

O staged smoke já prova diretamente a versão específica via override. Não é necessário adicionar binding de version metadata apenas para observabilidade de deploy; o runtime permanece enxuto e o plano de controle continua sendo a autoridade da promoção.

O rollback usa sempre o Version ID capturado antes de qualquer write. Não usa “versão anterior por ordem de upload”, pois upload recente não implica que aquela versão era a que atendia produção.

## R2 e conteúdo

O workflow de deploy do Worker só precisa de leitura do bucket para provar que o recurso canônico existe. Publicação de mídia é outro pipeline e não é motivo para conceder R2 Write ao token do deploy da API.

## Frontend e proxy público

- `/tonecosstudios/*` → origem GitHub Pages do Catálogo;
- `/catalogo-api/*` → Worker do Catálogo na Tonecos;
- no domínio Achegue-se a API é first-party;
- no GitHub Pages o preview usa `VITE_API_BASE_URL`.

O frontend recebe no build apenas valores públicos:

- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

O secret Turnstile nunca vai para o navegador.

## Verificação pública

Smoke rápido:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2>
```

Auditoria completa:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive
```

Após integração de galerias, validar todas as galerias multi-imagem:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive --all-galleries
```

## Segurança

- Segredos ficam somente em GitHub Secrets/Cloudflare.
- Nunca colocar token Cloudflare, Turnstile secret ou credencial em Git, chat, `.env.example` ou `wrangler.jsonc`.
- Não criar fallback de autenticação.
- Não enfraquecer gates para “fazer o deploy passar”.
- Divergência entre dashboard e SSOT deve ser reconciliada conscientemente; não deve ser ocultada por upload forçado.
