# Deploy Cloudflare

O catálogo usa `acheguese.com.br/tonecosstudios/` como URL pública canônica. O frontend continua publicado no GitHub Pages como origem/preview e é montado sob o domínio Achegue-se por reverse proxy. Cloudflare continua responsável por API, banco, mídia e proteção dos fluxos públicos de gravação.
O deploy normal do backend é automatizado; somente o provisionamento inicial da conta é feito uma vez.

## Recursos de produção

- Worker: `tonecos-catalogo-api`
- D1: `tonecos-catalogo`
- R2: `tonecos-catalogo-media`
- Turnstile: widget Managed usado no orçamento e no compartilhamento de coleções
- Binding D1: `DB`
- Binding R2: `MEDIA`

## SSOT do binding D1 e Worker

`wrangler.jsonc` é a fonte versionada da identidade do Worker e do binding D1 de produção. O UUID do banco é um identificador de recurso, não um segredo; por isso ele fica associado ao binding `DB` no arquivo canônico em vez de ser duplicado em Repository Variable.

`tools/wrangler_config_contract.mjs` valida o nome canônico do Worker e exige exatamente um binding `DB` com UUID canônico. `tools/render_wrangler_config.mjs` lê esse valor e nunca o substitui por configuração paralela. Se `CLOUDFLARE_D1_DATABASE_ID` for fornecido manualmente, ele funciona somente como **asserção**: divergência contra `wrangler.jsonc` falha fechado.

No workflow de produção, `tools/read_wrangler_d1_id.mjs` deriva o mesmo valor e o exporta para `CLOUDFLARE_D1_DATABASE_ID` apenas como variável de runtime para scripts Python que chamam a API D1 diretamente. Essa variável derivada não é outra fonte de verdade.

## Bootstrap único

1. Criar o banco D1 `tonecos-catalogo` e registrar seu UUID no binding `DB` de `wrangler.jsonc`.
2. Criar o bucket R2 `tonecos-catalogo-media`.
3. Configurar uma origem pública/CDN para os objetos web do R2.
4. Criar um widget Cloudflare Turnstile em modo Managed. Autorizar `washingtonmsdj.github.io`, `acheguese.com.br` e `www.acheguese.com.br`.
5. Criar um API Token Cloudflare com somente as permissões necessárias para Worker, D1 e R2.
6. Configurar no GitHub as variáveis e secrets descritos abaixo.

`preview_urls` fica explicitamente desabilitado no `wrangler.jsonc`. O endpoint estável em `workers.dev` permanece ativo, mas versões de preview não são expostas por default implícito do Wrangler.

`wrangler.jsonc` também declara `TURNSTILE_SECRET_KEY` em `secrets.required`. No CI, o valor vem exclusivamente de GitHub Secrets e é anexado à versão staged com `wrangler versions upload --secrets-file`; ele não é gravado no repositório, em artifact ou em output do workflow.

## GitHub Repository Variables

- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_API_BASE_URL` — origem pública do Worker, sem barra final; obrigatória para smoke staged e pós-promoção
- `VITE_MEDIA_BASE_URL` — origem pública/CDN do R2, sem barra final
- `VITE_TURNSTILE_SITE_KEY` — chave pública do widget Turnstile

`CLOUDFLARE_D1_DATABASE_ID` **não é Repository Variable de produção**. O workflow deriva o ID do `wrangler.jsonc` e o exporta somente para o processo em execução.

O CORS do Worker também é versionado em `wrangler.jsonc`; não existe fallback paralelo hardcoded no runtime nem Repository Variable concorrente para a allowlist de produção.

## GitHub Repository Secrets

- `CLOUDFLARE_API_TOKEN`
- `TURNSTILE_SECRET_KEY` — segredo privado do widget Turnstile; nunca vai para o bundle do navegador

## Escopo mínimo do token Cloudflare

O token de CI deve ser dedicado ao Catálogo e restrito à conta Tonecos. Para o workflow atual, o menor conjunto conhecido é:

- **Workers Editor** no Worker existente `tonecos-catalogo-api` — necessário para consultar deployments, enviar/promover versões e executar rollback explícito;
- **D1 Edit** — necessário para aplicar migrations e executar as auditorias/queries D1 do pipeline;
- **Workers R2 Storage Read** — necessário para `wrangler r2 bucket info`, sem conceder escrita no bucket.

Não conceder por conveniência:

- Workers Admin — o Worker já existe e o pipeline não precisa criá-lo nem apagá-lo;
- Workers Routes Write — o workflow não cria nem altera rota ou domínio customizado;
- Workers R2 Storage Write — o workflow de deploy não publica objetos no R2;
- permissões de API Tokens, Billing ou administração geral da conta.

Se a UI da Cloudflare permitir escopo por recurso, preferir o Worker individual em vez de todos os Workers. D1/R2 devem permanecer no menor escopo suportado pelo painel para os recursos usados pelo Catálogo.

## Fluxo automático

Ao alterar `worker/`, `migrations/`, `wrangler.jsonc` ou os contratos/ferramentas de deploy Cloudflare na `main`, o workflow `Deploy Cloudflare API` executa primeiro um **preflight sempre visível**.

O preflight verifica `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY` e `VITE_API_BASE_URL`. Se qualquer item estiver ausente, o workflow registra no resumo exatamente o que falta e **falha fechado**. `VITE_MEDIA_BASE_URL` é exigida adicionalmente apenas quando o backfill R2 for solicitado. Em `main`, um deploy pulado por falta de credencial não pode aparecer como sucesso.

O binding D1 não é lido de variável do GitHub no preflight. Depois do checkout, o job valida o UUID diretamente do SSOT versionado e exporta o valor derivado para as ferramentas de runtime.

Quando o bootstrap está disponível, o job de produção:

1. valida credenciais e a URL pública usada nos smokes;
2. valida o Worker e o binding D1 canônico;
3. gera `.wrangler.deploy.jsonc` sem substituir o binding D1;
4. consulta a API Cloudflare e captura o **Version ID que está efetivamente servindo 100% do tráfego** antes de qualquer write; esse ID é o rollback target explícito;
5. confirma que o bucket R2 existe;
6. cria em `$RUNNER_TEMP` um JSON com `TURNSTILE_SECRET_KEY`, modo `0600`, e registra `trap` para apagá-lo ao sair do step;
7. envia código + segredo com `wrangler versions upload --strict --secrets-file`, sem direcionar tráfego. O output estruturado oficial do Wrangler é capturado em NDJSON e dele é extraído o Version ID staged;
8. executa `tools/check_migration_deploy_policy.py` e exige que a estratégia `migrate-before-worker` continue expand/backward-compatible;
9. aplica somente as migrations D1 ainda não aplicadas;
10. executa `tools/check_staged_worker_version.mjs` contra a versão staged usando `Cloudflare-Workers-Version-Overrides`. Health/schema, categorias, recentes, galeria e shared collections precisam passar **antes** de qualquer promoção;
11. promove a versão staged para 100% do tráfego com `wrangler versions deploy --version-tag ...@100% --yes`;
12. repete os gates públicos essenciais sem override, provando que o deployment ativo responde corretamente;
13. se qualquer gate público pós-promoção falhar, executa `wrangler rollback <PREVIOUS_WORKER_VERSION_ID>` para a versão capturada antes do deploy;
14. somente após o smoke público saudável executa auditorias e tarefas opcionais de manutenção, como backfill SHA e reparos de galerias legadas.

### Por que o segredo não usa `wrangler secret put`

`wrangler secret put` cria uma nova versão **e a implanta imediatamente**. Portanto ele não pode fazer parte deste pipeline antes do migration gate e do staged smoke. O deploy usa `--secrets-file` em `wrangler versions upload`, que associa o segredo à nova versão sem enviar tráfego para ela. O arquivo temporário existe somente no runner e é removido pelo próprio step.

### Smoke staged e rollback

O smoke staged usa o mecanismo oficial de Version Overrides da Cloudflare. A versão nova consulta o D1 já expandido, mas usuários continuam na versão anterior enquanto health, schema e rotas públicas são validados.

O rollback é deliberadamente explícito: `tools/cloudflare_deploy_state.mjs` consulta os deployments da Cloudflare, ordena por `created_on`, exige que o deployment ativo seja uma única versão a 100% e salva esse Version ID. Não usamos `wrangler rollback` sem ID, porque “a versão enviada anteriormente” pode não ser a mesma versão que estava efetivamente servindo produção.

Rollback restaura **o Worker**, não o schema D1. Isso é intencional e só é seguro porque `config/migration-deploy-policy.json` bloqueia migrations destrutivas no fluxo migration-first. A versão antiga precisa continuar compatível com o schema expandido.

Essa ordem reduz o raio de falha:

- falha de credencial, R2 ou configuração ocorre antes de D1;
- falha de upload deixa produção e D1 intactos;
- falha de migration deixa apenas uma versão staged e o Worker anterior continua servindo;
- falha do staged smoke impede promoção;
- falha imediatamente após promoção aciona rollback explícito do Worker;
- tarefas opcionais de manutenção só começam depois que o deployment público já provou saúde.

O CI usa `wrangler versions upload --dry-run --strict` para validar o mesmo caminho de empacotamento usado em produção e possui testes contratuais que proíbem reintroduzir `wrangler secret put`, promoção antes do staged smoke ou rollback implícito.

### Regra migration-first

A produção aplica migrations antes de promover o Worker novo. Essa ordem só pode continuar enquanto as migrations posteriores ao baseline forem do tipo **expand** e toleradas pelo Worker atualmente publicado.

- `config/migration-deploy-policy.json` é o SSOT dessa política;
- o baseline de produção permanece registrado até `0010_recent_models_index.sql` enquanto a primeira promoção automática não ocorrer;
- `tools/check_migration_deploy_policy.py` exige cobertura exata das migrations requeridas pelo schema contract;
- migrations `expand` não podem introduzir padrões destrutivos como `DROP`, `ALTER ... RENAME/DROP`, `DELETE FROM`, `REPLACE`, `TRUNCATE` ou `PRAGMA writable_schema`;
- uma futura migration de contrato/limpeza exige mudança explícita da estratégia de deploy, não exceção silenciosa.

Quando `CLOUDFLARE_API_TOKEN` for configurado pela primeira vez ou restaurado, execute manualmente **Deploy Cloudflare API** pela ação `workflow_dispatch`; não é necessário criar commit artificial. O mesmo deploy staged envia o valor atual de `TURNSTILE_SECRET_KEY` junto da versão sem promover nada antes dos gates.

## Estado de produção

O bootstrap inicial foi executado em 2026-09-30/2026-10-01 e a infraestrutura canônica foi posteriormente migrada para a conta Tonecos Studio:

- Worker `tonecos-catalogo-api` publicado em `workers.dev`;
- D1 `tonecos-catalogo` com as migrations `0001`–`0010` aplicadas e reconciliadas na tabela `d1_migrations`;
- R2 `tonecos-catalogo-media` com endpoint público `r2.dev` para as variantes web;
- widget Turnstile Managed próprio do catálogo, autorizado para `washingtonmsdj.github.io`, `acheguese.com.br` e `www.acheguese.com.br`.

O workflow do Pages exige as Repository Variables de produção para API, mídia, site key do Turnstile e URL pública. Ele não contém endpoints ou chaves públicas de produção como fallback: configuração ausente falha explicitamente antes do build. Segredos privados continuam fora do Git.

## Frontend

A URL pública canônica fica em `https://acheguese.com.br/tonecosstudios/`. O repositório Achegue-se mantém o catálogo como superfície pública temporária:

- `/tonecosstudios/*` → origem GitHub Pages do frontend;
- `/catalogo-api/*` → Worker do Catálogo.

Isso mantém a API first-party no navegador quando o cliente usa o domínio Achegue-se, sem exigir relaxar o CSP do projeto principal. O preview GitHub Pages continua funcional e usa o Worker diretamente.

O workflow do GitHub Pages injeta durante o build:

- `VITE_API_BASE_URL`
- `VITE_MEDIA_BASE_URL`
- `VITE_TURNSTILE_SITE_KEY`

Assim que API/mídia estiverem configuradas, o mesmo frontend muda de DEMO para LIVE sem alteração de código. A site key do Turnstile é pública por definição; o secret nunca é exposto ao frontend.

Após cada publicação, o workflow do Pages executa um smoke test HTTP no endereço publicado, confirma a presença da identidade definida em `config/brand.json` no HTML e valida o `site.webmanifest`. O workflow só termina com sucesso se a versão publicada estiver realmente acessível.

## Verificação pública

O verificador oficial possui dois níveis. O modo padrão é rápido e valida health, pelo menos um modelo publicado e uma capa real servida pela origem pública de mídia:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2>
```

Para auditorias completas após publicação, use `--exhaustive`:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive
```

Para validar também galerias com múltiplas imagens, há dois modos adicionais. Uma amostra determinística dos modelos com maior `image_count`:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive --gallery-sample 20
```

Após uma integração de galerias, o gate final recomendado é auditar **todas** as fichas multi-imagem:

```powershell
python tools/verify_public_catalog.py --api-base https://<worker> --media-base https://<origem-publica-r2> --exhaustive --all-galleries
```

Esse modo confere `total == image_count`, `version == gallery_version`, paginação sem ciclo, IDs de imagens únicos e uma única capa na primeira posição.

O modo exaustivo percorre todas as páginas do catálogo e falha se encontrar total divergente, paginação cíclica, ID/slug/código duplicado, modelo sem capa, modelo sem imagem, categoria desconhecida ou contagem por categoria incompatível com `/api/categories`. Ele não baixa todas as imagens; o smoke inicial continua provando que a origem pública de mídia serve uma capa real.

## Turnstile

O mesmo widget Managed pode proteger mais de um fluxo porque o servidor exige a `action` esperada para cada operação:

- orçamento: `quote`;
- criação de link de coleção: `collection-share`.

Em LIVE, o Worker trabalha em modo fail-closed:

- sem `TURNSTILE_SECRET_KEY`, não grava solicitação nem coleção compartilhada;
- token Turnstile é validado server-side via Siteverify;
- a action precisa corresponder ao fluxo;
- IDs enviados pelo navegador são conferidos contra modelos publicados no D1;
- Origin fora da allowlist é recusada;
- o navegador mantém os dados locais se a operação remota falhar.

O Turnstile usa `appearance: interaction-only`, mantendo a interface limpa para a maioria dos clientes.

## Segurança

Segredos ficam somente em GitHub Secrets/Cloudflare. Nunca colocar token Cloudflare, Turnstile secret, segredo de API ou credenciais em `.env.example`, `wrangler.jsonc`, commits ou arquivos do catálogo.

O UUID do D1 **não é segredo**; ele é configuração de infraestrutura versionada. Para evitar duas fontes concorrentes, o binding `DB` de `wrangler.jsonc` é sua autoridade de produção. Operações locais que definirem `CLOUDFLARE_D1_DATABASE_ID` o fazem de forma explícita para outro contexto e nunca substituem silenciosamente o SSOT do deploy.
