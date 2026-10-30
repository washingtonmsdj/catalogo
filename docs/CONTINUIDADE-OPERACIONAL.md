# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-29**. Este arquivo registra somente o estado operacional necessário para a próxima execução. Histórico detalhado pertence aos runbooks e documentos de migração; não acumular aqui gates encerrados, PRs antigas ou bloqueios expirados.

## Autoridade

- Repositório: `washingtonmsdj/catalogo`.
- Branch autoritativa: `main`.
- Antes de qualquer mutação, conferir novamente `main`, PRs/issues abertas, CI, Pages e estado Cloudflare.
- Nunca tratar SHA antigo gravado em documentação como autoridade de execução.
- `wrangler.jsonc` é o SSOT do Worker, D1, R2, CORS e segredo obrigatório.
- `config/public-runtime.json` é o SSOT versionado da superfície pública.
- O resolvedor de runtime do frontend deve continuar explícito/fail-closed; não recriar fallback implícito nem segunda origem paralela.
- Mudança de runtime só é concluída quando os gates do escopo realmente afetado ficam verdes.

## Estado reconciliado — integração de 2026-10-29

- **`main` observada:** `581341faa23174adb0c4eedf5628adf366a84c0f`. O contrato de schema da `main` exige a migration `0021_quote_admin_audit_events.sql` (versão 5). Esse é o estado do Git, não prova de migrations aplicadas no D1 de produção.
- **PR #174** (draft, `ingest/stlforge-physical-archive-20261013`): `138f3e045dae531eb71dd20fcbb894ecdca500b5`, base atualizada com os 94 commits que faltavam da `main`. A auditoria de dependências encontrou Wrangler anterior vulnerável; versão 4.155.0 e lockfile idêntico ao já homologado na frente #175 foram incorporados. Gates dessa nova revisão precisam ser consultados.
- **PR #175** (draft, `catalog-content-20261015`, base #174): a integração de `main` e #174 em `e972d6086843bcdb0bf71b411066283df256ae21` passou **13/13 workflows**. O presente checkpoint atualiza a continuidade e incorpora a correção de dependências da #174; validar o novo HEAD em vez de reutilizar o resultado anterior.
- Na reconciliação via árvores Git completas, a #174 não possuía arquivos conflitantes com a `main`; a #175 tinha apenas `package.json` e `.github/workflows/ci.yml` sobrepostos. Foram preservados tanto os testes de ingestão quanto os testes de administração, navegação e auditoria do CI principal, sem force-push.
- **Não houve merge das PRs em `main`, deploy nem alteração de registros D1/R2.** Ambas devem permanecer draft até os gates finais e autorização de publicação correspondentes.
- **Conteúdo:** a auditoria de cobertura da fonte externa e a fila de colisões trabalham em modo somente leitura, com identidade aprovada separada da elegibilidade de mídia. A cobertura integral de esculturas únicas não está comprovada.

O registro do Worker promovido na PR #161 e os respectivos smokes históricos continuam como **evidência conhecida boa, não substituto de medição atual**. Para decidir um deploy, medir novamente Worker, D1, R2 e estado dos workflows; não tomar IDs ou números deste checkpoint como estado vivo.

## Superfície pública

- URL pública canônica: `https://acheguese.com.br/tonecosstudios/`.
- Preview independente: `https://washingtonmsdj.github.io/catalogo/`.
- `/tonecosstudios/*` é a superfície pública do Catálogo dentro do Achegue-se.
- `/catalogo-api/*` é o boundary first-party usado no domínio Achegue-se.
- No GitHub Pages, o runtime explícito resolve a API a partir da configuração canônica.
- `/catalogo` permanece apenas como compatibilidade de rota para `/tonecosstudios/`.

O Catálogo não deve copiar o aplicativo Achegue-se nem assumir propriedade de `acheguese.com.br`.

## Cloudflare — recursos canônicos Tonecos Studio

- Account ID: `8827c547d6def5ee5b9ca550fdd5680a`.
- Worker: `tonecos-catalogo-api`.
- API: `https://tonecos-catalogo-api.tonecosstudio.workers.dev`.
- D1: `tonecos-catalogo` (`87006366-60f3-4937-af73-2ef5a5f901fb`).
- R2: `tonecos-catalogo-media`.
- Turnstile sitekey pública: `0x4AAAAAAFSpOhaAFp6Gsjqd`.
- `TURNSTILE_SECRET_KEY` é segredo obrigatório e não pertence ao Git.

A infraestrutura antiga da conta Washington é somente rollback histórico. Não mover DNS, zona ou recursos de outra conta para facilitar o Catálogo.

## Mídia — arquitetura atual obrigatória

A mídia **não possui origem pública separada**.

- O bucket `tonecos-catalogo-media` permanece privado.
- O Public Development URL do R2 deve permanecer **desabilitado**.
- Não existe variável pública separada para origem de mídia.
- O frontend monta mídia a partir do mesmo `apiBase` usado pela API.
- O Worker serve objetos por `/media/*` usando o binding privado `MEDIA`.
- `worker/entry.ts` resolve `/media/*` antes do handler principal da API; leitura de mídia não depende de D1.
- O gateway preserva metadata HTTP, ETag e Range, rejeita traversal/chaves inválidas e usa cache público explícito.

O deploy Cloudflare valida o Worker remoto contra o SSOT e também consulta o estado managed do bucket. Se a exposição pública direta do R2 voltar a ser habilitada, o deploy falha **antes de qualquer write**.

O Pages também deve rejeitar artefato que contenha endpoint público direto de R2.

## Runtime do frontend — regra fail-closed

A PR #166 tornou o runtime explícito e centralizado. Preservar estas invariantes:

- um único contrato/resolvedor de runtime;
- modo de execução explícito;
- preview e superfície Achegue-se resolvidos pelo mesmo SSOT;
- orçamento e demais consumidores usam o runtime canônico, sem resolvedor próprio;
- configuração ausente/inválida falha fechado;
- não criar fallback silencioso para hostname, localhost ou Worker hardcoded;
- proxy Achegue-se precisa continuar alinhado ao contrato do runtime.

Qualquer nova superfície deve estender o contrato central; não duplicar lógica de detecção por `window.location`, hostname ou pathname espalhada pela aplicação.

## Deploy Cloudflare

Fluxo canônico de `.github/workflows/cloudflare.yml`:

1. preflight fail-closed;
2. detectar mudança real de schema D1;
3. validar credenciais/configuração;
4. renderizar configuração de produção;
5. validar Worker remoto e estado privado do R2 contra o SSOT;
6. capturar a versão atualmente servindo produção;
7. validar o bucket R2;
8. enviar nova versão do Worker sem tráfego;
9. registrar staged em 0%;
10. aplicar somente migrations compatíveis quando houver mudança de schema;
11. executar staged smoke com version override;
12. promover para 100% somente após staged verde;
13. validar release público;
14. validar objeto R2 real por `/media/*`;
15. exigir Workers Cache `HIT` dentro de janela bounded;
16. restaurar a versão anterior se smoke staged ou pós-promoção falhar;
17. executar auditoria D1 somente quando o escopo de schema exigir.

Mudança apenas de frontend/orquestração que não toca Worker/schema não deve consumir deploy D1/Worker por hábito.

Runbook detalhado: `docs/CLOUDFLARE_DEPLOY.md`.

## Schema e migrations

O contrato versionado atual da `main` exige migrações até `0021_quote_admin_audit_events.sql` (versão 5); o estado de aplicação no D1 de produção deve ser aferido na conta Tonecos, não inferido por Git, CI ou por este documento.

Regras:

- `config/catalog-schema-contract.json` define estruturas exigidas pelo Worker;
- migrations novas passam por `config/migration-deploy-policy.json`;
- nenhuma migration destrutiva é aplicada para destravar deploy;
- mudança runtime-only não deve provocar leitura/auditoria D1 desnecessária;
- manutenção de dados pertence a `.github/workflows/catalog-maintenance.yml`, não ao deploy comum.

## Identidade de produto e galeria

Regra principal: **modelo não é imagem**.

- frente, costas, laterais e detalhes do mesmo produto pertencem à mesma galeria;
- produtos diferentes do mesmo personagem continuam modelos diferentes;
- nome, pasta ou franquia não bastam para unir produtos;
- `modelo_publico` explícito tem maior autoridade quando presente;
- troca de capa não muda ID/nome/slug;
- R2, manifests e D1 precisam concordar em identidade, `imageCount`, `galleryVersion` e variantes;
- redução automática de galeria é proibida;
- similaridade visual gera revisão, não exclusão automática.

## Galerias legadas já reconciliadas

`config/catalog-legacy-gallery-overrides.json` continua sendo o registro canônico dos grupos revisados.

Estado estrutural consolidado conhecido:

- 21 canônicos preservados;
- 32 fontes aposentadas por relação canônico→fonte;
- 32 relações de galeria;
- nenhuma exclusão destrutiva como mecanismo de consolidação;
- aliases antigos continuam resolvendo para o canônico;
- mídia histórica permanece no R2;
- IDs/slugs aposentados não podem ser reciclados.

`tools/apply_legacy_gallery_repairs.py` é o único caminho explícito de write para essa família e não deve ser reaplicado sem nova evidência de drift.

## Índice SHA e integridade

`model_image_sources` guarda metadados de auditoria; R2/manifests continuam sendo a fonte da galeria.

O backfill inicial foi concluído e não deve ser refeito por rotina. Novos backfills processam apenas versões ainda não indexadas e continuam sem baixar binários quando manifests já fornecem SHA suficiente.

Ferramentas centrais:

- `tools/backfill_image_source_index.py`;
- `tools/plan_gallery_merge.py`;
- `tools/resolve_gallery_merge.py`;
- `tools/build_gallery_promotion_manifest.py`;
- `tools/verify_gallery_promotion_manifest.py`;
- `tools/audit_d1_integrity.py`;
- `tools/verify_public_catalog.py`.

## Conteúdo local — checkpoint preservado

O catálogo mestre operacional permanece fora do repositório público. Antes de qualquer mutação local, localizar o caminho real no dispositivo e conferir o estado atual; não assumir equivalência entre unidade sincronizada e cópia local.

Checkpoint local histórico (2026-10-11), **não revalidado nesta reconciliação**:

- SHA V4: 3.649 / 3.649;
- `catalog_complete=true`;
- 0 caminhos duplicados no cache;
- 0 hashes inválidos;
- `Novos`: 56 imagens;
- fila: 40 promoção controlada + 16 quarentena privada;
- nenhuma das 16 de quarentena deve ser apagada.

`config/public-catalog-roots.json` é a fronteira pública canônica. Não voltar a auditar conteúdo privado/referência como catálogo publicável.

Não reiniciar SHA V4 por conveniência. Reaproveitar hashes válidos e migrar/revalidar estado existente.

## Próxima sequência de conteúdo e fechamento estrutural

1. Validar CI/coverage do HEAD atual nas PRs #174 e #175; não declarar gates anteriores como aprovados para um commit novo.
2. Executar auditorias somente leitura contra o D1 e a API da fonte na conta correta; conferir também schema `0021`, manifests e imagens publicadas no Worker/R2. Se o acesso à conta Tonecos estiver ausente, registrar o bloqueio e não simular sucesso.
3. Consumir a fila canônica `external-source-identity-triage.json` e a fila `published-collision-review-queue.json` dos artefatos da mesma execução, sem interpretar igualdade de nome, alias, dHash ou SHA isolados como escultura idêntica.
4. Reconciliar visualmente e com procedência os candidatos reais; registrar `map_existing` ou `new_model` somente com provas versionadas e sem conflitos. Uma identidade distinta não autoriza publicação de imagem.
5. Para publicação, exigir direitos, atribuição e cobertura integral de staging privado, SHA/tamanho, preflight de R2/D1 e verificação pública; promover apenas deltas explicitamente aprovados.
6. Só integrar as PRs empilhadas na `main` após análise do diff final e dos gates, sem force-push, duplicação de modelos, rebuild de mídia sem necessidade ou descarte de evidências.

O cache local e as filas do checkpoint de 11/10 são históricos, não autoridade para promover novos itens. Preservar invariantes de SSOT e nunca repetir ingestões completas para apenas atualizar status.

## O que não fazer

- não recomeçar o catálogo do zero;
- não reprocessar dados concluídos sem evidência técnica;
- não criar segunda origem de runtime ou mídia;
- não expor R2 diretamente ao público;
- não criar fallback de infraestrutura ou credencial hardcoded;
- não mover domínio de outra conta como atalho;
- não juntar produtos diferentes só por nome/personagem/pasta;
- não apagar STL/GLB/3MF/OBJ/fontes;
- não recriar árvore paralela por mojibake/prefixo/sufixo;
- não executar manutenção de dados automaticamente junto com mudança sem relação com dados/schema.

## Regra para futuras sessões

Antes de trabalhar:

1. ler este arquivo;
2. conferir estado atual de `main`, PRs/issues e workflows;
3. medir Cloudflare/produção em vez de assumir que IDs deste checkpoint ainda são atuais;
4. localizar o próximo problema concreto;
5. corrigir causa raiz e adicionar gate quando houver risco real de regressão;
6. atualizar este arquivo somente quando mudar uma decisão operacional relevante.

Sem gambiarras, sem paliativos, sem hardcoded concorrente, sem duplicação de SSOT e sem manter instrução obsoleta “por segurança”. O estado medido e os contratos versionados prevalecem.
