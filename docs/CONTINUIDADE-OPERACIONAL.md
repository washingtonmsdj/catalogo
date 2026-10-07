# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-07**. O objetivo é evitar reprocessamento, perda de checkpoints e decisões divergentes.

## Estado confirmado

### GitHub / frontend

- Branch autoritativa: `main`.
- Base funcional do pipeline validada no CI: `35f016bfc6b217e9ca54a4dc9054364203961da4`. Commits posteriores podem ser apenas de documentação; sempre conferir a `main` antes de executar.
- CI do commit: **verde**.
- Deploy do preview GitHub Pages: **verde**.\n- URL pública canônica: `https://acheguese.com.br/catalogo/`.\n- Origem/preview independente: `https://washingtonmsdj.github.io/catalogo/`.
- O frontend já suporta galeria paginada, lightbox, múltiplas imagens por modelo, navegação por teclado e carregamento separado da mídia.
- Refresh de frontend validado em 2026-10-06:
  - hero orientado à descoberta, com métricas reais do acervo;
  - busca com limpar, feedback explícito para consultas abaixo do mínimo de 3 caracteres e sem fingir filtro ainda não aplicado;
  - cards preservam o enquadramento completo da peça com `object-fit: contain`, em vez de cortar frente/base;
  - cards mostram badge de quantidade quando um modelo possui mais de uma imagem;
  - a imagem principal da ficha abre a galeria diretamente e informa a quantidade de vistas;
  - filtros, busca resolvida, seleção de franquia/pasta e paginação entram em modo de resultados e levam o viewport diretamente à grade;
  - o modo de resultados exibe **todos os até 24 modelos já retornados pela API**, em vez de ocultar parte da página atrás do layout editorial;
  - resultado responsivo: 6 colunas desktop, 4 tablet amplo, 3 tablet, 2 mobile e 1 em telas muito estreitas;
  - durante carregamento, a grade anterior permanece estável para evitar layout shift, fica atenuada e sem cliques/paginação até o lote novo chegar;
  - busca com 1–2 caracteres mostra instrução explícita e não é apresentada como filtro aplicado;
  - favoritos continuam acessíveis no menu mobile;
  - filtros selecionados/removíveis expõem `aria-pressed`/rótulos de remoção adequados;
  - fallback visual cobre também cards e imagem principal da ficha quando uma mídia falha;
  - `src/lib/catalogHomeView.ts` centraliza o contrato editorial × resultados;
  - `tools/test_catalog_home_view.mjs` roda no CI e garante que 24 itens recebidos continuem 24 em resultados, enquanto a home editorial preserva 6 destaques;
  - a grade da galeria aceita setas esquerda/direita/cima/baixo com cálculo das colunas responsivas; `tools/test_gallery_grid_navigation.mjs` protege esse comportamento no CI;
  - ao trocar a página da galeria, a página já renderizada permanece visível até o lote novo chegar; erro de rede preserva a página anterior;
  - a galeria mantém altura estável durante paginação e o mobile usa melhor a altura disponível;
  - o lightbox de alta resolução mostra estado explícito de carregamento, usa prioridade alta apenas para a imagem aberta e mantém prefetch limitado às vistas vizinhas;
  - o comparador mantém a coluna de rótulos visível durante scroll horizontal, preserva a tabela durante atualização e usa fallback quando uma capa falha;
  - a busca da sidebar deixa de pesquisar apenas as 24 franquias carregadas: com 3+ caracteres usa o índice completo de franquias do backend;
  - `FRANCHISE_SEARCH_MIN_LENGTH` é o contrato único dessa busca no frontend e `listCatalogFranchises` não envia consultas curtas ao backend;
  - a busca da sidebar pode continuar no explorador completo sem apagar o termo digitado; quando o recorte excede a lista curta, “Ver mais resultados” abre o navegador já pesquisando o mesmo termo;
  - Favoritos deixou de ser um bloco de chips e virou `FavoritesDialog`: lista pesquisável, remoção individual, abertura de ficha e ação para enviar todos ao orçamento sem chamadas em massa à API;
  - “Minha lista / orçamento” usa `QuoteDialog`: revisão numerada dos modelos, remoção individual, formulário separado visualmente e preservação de Turnstile/protocolo;
  - durante a revisão de “Minha lista”, itens com slug conhecido podem abrir a ficha diretamente; o modal fecha, a seleção local é preservada e o usuário pode voltar ao orçamento sem perder modelos;
  - cards de modelo possuem ação rápida de Favoritos e de Minha lista; os estados usam `aria-pressed`, ficam discretos no desktop e sempre visíveis em touch;
  - em dispositivos coarse/touch os alvos dos atalhos dos cards aumentam e o badge de galeria se reposiciona para não sobrepor controles;
  - abaixo de 620 px a barra principal deixa de exigir rolagem horizontal e passa a distribuir Explorar, Coleções, Novos, Favoritos e Minha lista em cinco ações fixas, mantendo a busca acima;
  - o cabeçalho do modo de resultados identifica o recorte real: termo pesquisado, categoria, franquia e/ou pasta, além da página atual;
  - não existe seletor de ordenação falso: `/api/catalog` ainda ordena deterministicamente por nome + ID e não expõe parâmetro de sort.
- A arquitetura de dialogs usa um controlador global para focus trap, restauração de foco, scroll lock e isolamento da pilha modal.
- Quando há ficha → galeria → lightbox, apenas o dialog superior fica exposto; os inferiores recebem `inert` + `aria-hidden` temporários e são restaurados ao voltar ao topo.
- O CI protege essa arquitetura com `npm run dialog:a11y`.

### Integração pública com Achegue-se

A publicação web usa **dois repositórios independentes sob um único domínio**, sem copiar o Catálogo para o projeto Achegue-se:

- `washingtonmsdj/acheguese` continua dono de `https://acheguese.com.br/`;
- `washingtonmsdj/catalogo` continua dono do frontend e pipeline do Catálogo;
- Vercel no Achegue-se normaliza `/catalogo` → `/catalogo/`;
- `/catalogo/*` é encaminhado para a origem GitHub Pages do Catálogo;
- `/catalogo-api/*` é encaminhado para o Worker do Catálogo;
- no domínio Achegue-se, o frontend detecta o hostname e usa a API first-party `/catalogo-api`;
- no GitHub Pages, o preview continua usando o Worker configurado em `VITE_API_BASE_URL`;
- `config/public-runtime.json` é o SSOT versionado da URL pública canônica: `https://acheguese.com.br/catalogo/`;
- o widget Turnstile do Catálogo aceita `acheguese.com.br`, `www.acheguese.com.br` e `washingtonmsdj.github.io`.

A raiz `/` do Achegue-se **não redireciona para o Catálogo** e não pertence a este repositório. O projeto Achegue-se mantém sua Home própria e apenas oferece um acesso temporário ao Catálogo.

### Cloudflare

Recursos confirmados na conta conectada:

- Worker: `tonecos-catalogo-api`;
- API pública atual: `https://tonecos-catalogo-api.ordax-ac1ca1b50d09.workers.dev`;
- D1: `tonecos-catalogo`;
- R2: `tonecos-catalogo-media`.

Baseline online confirmado:

- **2.596 modelos publicados**;
- **2.596 imagens publicadas nas fichas**;
- todos os modelos atuais possuem exatamente **1 imagem**;
- 6 categorias;
- 250 franquias;
- 1.063 pastas;
- 0 modelos sem capa;
- 0 modelos sem galeria;
- 0 modelos sem imagem;
- 0 slugs duplicados;
- 0 códigos duplicados;
- FTS cobre 2.596 modelos e 250 franquias.
- baseline revalidado após a preparação do pipeline de galerias: produção permaneceu em **2.596 modelos / 2.596 imagens**, `max_images=1`, sem publicação prematura.

O deploy automático do backend continua fail-closed enquanto o GitHub Actions não possuir o secret `CLOUDFLARE_API_TOKEN`. O preflight mais recente confirmou que Account ID, D1 Database ID, API pública e `TURNSTILE_SECRET_KEY` estão configurados; **somente `CLOUDFLARE_API_TOKEN` está ausente**. O conector GitHub disponível não oferece escrita de Actions Secrets e a busca de plugins não encontrou alternativa específica para esse endpoint. Não criar fallback de autenticação, não gerar token sem destino seguro e não colocar token em chat, código, arquivo ou commit.

Consequência operacional: alterações recentes em `worker/` ficam validadas por CI/dry-run, porém o Worker público permanece na versão anteriormente implantada até esse secret ser configurado e o workflow Cloudflare terminar verde.

Depois que `CLOUDFLARE_API_TOKEN` for configurado em GitHub Actions Secrets, executar manualmente o workflow **Deploy Cloudflare API** por `workflow_dispatch`. Não criar commit artificial só para disparar deploy. Deixar `force_turnstile_secret_sync=false` salvo rotação real do segredo Turnstile.

O domínio comercial ainda não deve ser forçado no código sem a zona/DNS corretos na conta Cloudflare responsável.

## Regra de identidade: modelo não é imagem

Esta regra é obrigatória para qualquer integração nova.

- Um **produto/modelo 3D** é a entidade principal.
- Frente, costas, laterais, detalhes e outras vistas do mesmo produto pertencem à **galeria do mesmo modelo**.
- Produtos 3D diferentes do mesmo personagem continuam como **modelos distintos**.
- Nome do personagem, pasta ou franquia **não são suficientes** para juntar produtos.
- Novos lotes devem usar um identificador estável de produto em `modelo_publico`.
- Todas as vistas do mesmo produto compartilham esse identificador.
- Produtos diferentes recebem identificadores diferentes.

O bundle já possui testes garantindo:

- uma identidade pública compartilhada gera 1 modelo com N imagens;
- duas identidades de produto do mesmo personagem continuam separadas;
- trocar a imagem escolhida como capa não muda ID/nome/slug da galeria;
- o gate R2/D1 exige que `imageCount` e `galleryVersion` coincidam com o manifesto e que todas as variantes `thumb/card/detail` existam;
- as chaves R2 de capa, manifesto e variantes precisam pertencer ao mesmo `model_id`;
- a capa do D1 precisa ser exatamente a variante `card` da primeira imagem/capa do manifesto;
- o CI possui ensaio integrado que publica um produto sintético com 1 imagem, expande para 3 e prova que ID/slug/código permanecem estáveis e o D1 continua com apenas 1 modelo.

### Correção de vistas legadas — Android 18 (2026-10-07)

Foi reproduzido em produção o erro em que fotografias/ângulos do mesmo produto eram tratados como modelos independentes porque, quando `modelo_publico` estava vazio, a ingestão legada usava o nome do arquivo como identidade.

Contrato corrigido:

- `modelo_publico` explícito continua sendo a autoridade máxima;
- sem `modelo_publico`, somente sufixos conservadores de vista podem ser removidos para inferir uma galeria: frente, frontal, lateral, perfil, costas/traseira, corpo inteiro, em pé, close e variantes explicitamente reconhecidas;
- a inferência só agrupa quando **2 ou mais** imagens da mesma hierarquia resolvem para a mesma família;
- qualificadores semânticos como realista, chibi, diorama etc. **não** são descartados;
- o arquivo canônico é escolhido deterministicamente, priorizando frente/frontal/corpo inteiro, para preservar o ID público já existente;
- a ordem de entrada das imagens não pode alterar a identidade canônica.

Caso de regressão protegido no CI:

- Android 18 / traje casual: 4 vistas → **1 modelo com 4 imagens**;
- Android 18 / traje azul: 2 vistas → **1 modelo com 2 imagens**;
- bustos e outras esculturas semanticamente diferentes permanecem modelos separados.

Compatibilidade pública enquanto o Worker aguarda credencial de deploy:

- `src/services/catalogApi.ts` consolida somente registros legados com `image_count=1` e sufixos de vista reconhecidos;
- `src/hooks/useCatalogRuntime.ts` carrega as fontes legadas como uma única galeria;
- `CatalogSidebarTree` usa o total consolidado na pasta ativa quando o recorte inteiro está carregado;
- no recorte auditado de Android 18, 17 registros brutos passam a representar **11 produtos reais**: traje casual (4→1), modelo cinza (3→1) e traje azul (2→1);
- essa camada é conservadora e deixa de ser necessária quando a relação canônica de galerias estiver ativa no backend.

Backend preparado, mas **não promovido para produção enquanto o deploy do Worker estiver bloqueado**:

- migration `0011_model_gallery_members.sql`;
- agregação multi-manifest em `worker/galleryAggregation.ts`;
- Worker calcula `image_count` e `gallery_version` lógicos;
- o CI materializa e preserva por 1 dia o bundle verificado do Worker;
- não aplicar a migration nem despublicar as antigas fichas-vista antes de o Worker correspondente estar efetivamente publicado.

SHA validado da correção frontend inicial: `958f04f6e86a71de0877da367d9476602ece091d`. O pente-fino posterior substitui esse checkpoint; sempre usar a `main` atual e exigir CI + preview verdes.

### Dívida legada de identidade medida em produção

Auditoria read-only do D1 em 2026-10-07 confirmou:

- **2.596** modelos publicados e **2.596** imagens; produção ainda possui somente fichas de 1 imagem;
- **0** colisões de slug e **0** colisões de código;
- contadores materializados de categorias: **0 divergências** contra `models WHERE published=1`;
- contadores materializados de franquias: **0 divergências** contra `models WHERE published=1`;
- agrupar apenas por personagem/pasta seria incorreto: existem **345** grupos de mesmo nome/pasta e a maioria representa esculturas realmente distintas;
- a auditoria conservadora encontrou **17 grupos de alta confiança** fragmentados por vistas direcionais;
- somando o par Android 18 / traje azul confirmado visualmente, o registro explícito contém **18 galerias legadas**, **47 slugs** e **29 cards excedentes**;
- os 47 slugs registrados foram cruzados com o D1: **47/47 encontrados, 0 ausentes, 0 divergências** de categoria, franquia, pasta, publicação ou `image_count=1`;
- `config/catalog-legacy-gallery-overrides.json` é o registro versionado dessa dívida; o CI bloqueia slug em mais de um grupo, canônico fora dos membros, família incoerente, motivo vazio e crescimento acima do baseline auditado de **29 cards excedentes**;
- `src/services/catalogApi.ts` consegue hidratar o grupo registrado mesmo quando suas vistas caem em páginas diferentes da API; a camada é transitória e se desativa naturalmente quando o backend passar a entregar a galeria canônica.

Não aumentar esse registro para “resolver” ambiguidades. Casos novos devem primeiro passar por auditoria visual/identidade. O objetivo do número **29** é cair até zero, não crescer.

### Reconciliação segura de fichas obsoletas

`tools/publish_d1.py` continua sem exclusão física. Para evitar acumular cards históricos quando uma galeria é consolidada, existe agora o fluxo explícito `--retire-absent-approvals <csv>`:

- o publicador pagina o inventário completo de modelos publicados por chave, sem `OFFSET`;
- compara o snapshot candidato com o inventário D1;
- cada ficha publicada ausente precisa de aprovação exata `model_id,slug,code,reason`;
- aprovação faltante, sobrando ou com slug/código desatualizado bloqueia a publicação;
- a única mutação permitida é `published=0`; **não há DELETE**;
- uma ficha ainda presente no snapshot nunca pode ser aposentada por esse CSV.

Esse mecanismo **não deve ser usado ainda nos 29 cards legados**. Primeiro o Worker multi-galeria e as migrations correspondentes precisam estar efetivamente em produção e validados pela API pública.

### Estado de migrations da produção

O D1 público foi inspecionado diretamente e está aplicado somente até:

- `0001_catalog.sql` … `0010_recent_models_index.sql`.

Ainda pendentes na produção:

- `0011_model_gallery_members.sql` — relação canônico → fontes de galeria;
- `0012_folder_materialized_counts.sql` — contadores materializados `direct_model_count` e `subtree_model_count`.

Por isso `catalog_folders.direct_model_count` e `catalog_folders.subtree_model_count` ainda não existem no D1 público. A migration 0012 já possui triggers para INSERT, DELETE, mudança de pasta e `published: 1↔0`; os testes cobrem inclusive a aposentadoria lógica reduzindo a contagem da pasta e de todos os ancestrais. Não aplicar essas migrations manualmente fora do workflow apenas para contornar a credencial ausente; manter a ordem versionada e a tabela `d1_migrations` coerente.

## Política de imagens e qualidade

Ferramenta: `tools/plan_gallery_merge.py`.

A política é não destrutiva:

- SHA-256 igual: não republicar a mesma imagem;
- vista diferente: adicionar à galeria;
- similaridade perceptual: **somente revisão**, nunca exclusão automática;
- se a fonte nova tiver qualidade superior, recomendar a nova;
- se a imagem atual for superior, conservar a atual;
- arquivos mestres nunca são apagados pela ingestão;
- a origem não é modificada pelo pipeline web;
- para modelo já publicado, aumento de `imageCount` é permitido quando o manifesto/versão mudam de forma coerente;
- redução de `imageCount` é bloqueada por padrão e só pode avançar com CSV de aprovação explícita para aquele modelo e aquele delta exato;
- uma aprovação antiga não vale se contagem ou `gallery_version` tiverem mudado;
- o mesmo `galleryManifestKey` content-addressed nunca pode aparecer com contagem, capa ou versão divergentes.

Assim, uma fonte externa marcada anteriormente como “modelo já existente” **ainda precisa ter todas as imagens analisadas**: duplicidade de modelo não significa duplicidade de galeria.

## Checkpoint do catálogo local

O catálogo mestre utilizado pelo fluxo local fica no Google Drive do desktop. Antes de qualquer mutação, confirmar o caminho/mapeamento real no dispositivo em vez de assumir equivalência entre unidade sincronizada e cópia local.

Checkpoint técnico confirmado da auditoria SHA:

- SHA V4 concluído: **3.649 / 3.649**;
- `catalog_complete=true`;
- 0 caminhos duplicados no cache;
- 0 linhas com hash inválido;
- última auditoria: 0 duplicatas de `Novos` contra catálogo, 0 conflitos de caminho e 0 erros de hash;
- `Novos`: **56 imagens**;
- fila final: **40 aptas à promoção controlada** + **16 aptas à quarentena privada**;
- nenhuma das 16 deve ser apagada; quarentena é preservação fora da publicação.

### Problema estrutural identificado

O auditor SHA local antigo considerou como “catálogo público” uma raiz de referências/legado que não pertence às seis categorias públicas. Isso gerou **111 grupos falsos/ambíguos de duplicatas internas** no portão local.

A fronteira pública agora possui SSOT versionado em `config/public-catalog-roots.json`, carregado pelo módulo compartilhado `tools/catalog_scope.py`. `tools/ingest_catalog.py` usa esse contrato na entrada e `tools/publish_d1.py` valida novamente antes do D1. A automação local deve consumir o mesmo JSON, sem manter uma lista paralela. As seis categorias públicas são:

1. Animes & Desenhos
2. Games
3. Filmes & Séries
4. Marvel & DC
5. Tokusatsu & Cultura Japonesa
6. Pessoas

A correção local deve adotar a **mesma whitelist fail-closed**, não apenas acrescentar exclusões ad hoc.

### Não reiniciar o SHA V4

Não executar `-Reset` como primeira opção.

A correção profissional é:

1. fazer o helper local carregar `config/public-catalog-roots.json` como SSOT das raízes públicas;
2. atualizar os consumidores do inventário/portão para essa definição;
3. migrar o inventário/cache existente para o novo escopo;
4. reutilizar hashes já válidos dos arquivos que continuam no escopo;
5. recalcular apenas inventário/fingerprint e o delta realmente necessário;
6. só fazer reset total se houver prova técnica de que a migração é impossível.

O usuário explicitamente não quer refazer trabalho já concluído.

## Alterações locais já concluídas

Estas mudanças foram feitas no workspace operacional do desktop e **não devem ser refeitas do zero**:

- `catalogo-pastas-publicas.ps1`: corrigido o caso em que `Resolve-PublicCatalogFile -AllowMissingDirectories` recebia uma pasta existente mas um arquivo-folha ainda inexistente. Agora o helper retorna o caminho exato esperado quando não há correspondência física e falha fechado se houver ambiguidade.
- `testar-integridade-automacao.ps1`: adicionado teste de regressão para o caso acima.
- preflight local após a correção: **225 checks, 0 falhas críticas, 0 warnings**.
- `executar-consolidacao-novos.ps1`: dry-run voltou a avançar normalmente depois da correção do helper.
- fila final de `Novos`: 56 itens, todos com decisão preservada, 0 inconclusivos e 0 bloqueados; 40 promoção controlada e 16 quarentena privada.
- o portão local parou apenas pelo bloqueio de **111 grupos de SHA interno** no catálogo oficial, posteriormente diagnosticado como escopo público contaminado por material de referência/legado.
- seis destinos da fonte externa apresentavam nomes com mojibake no manifesto; os caminhos físicos corretos já usam grafia Unicode correta. Não criar árvores duplicadas para corrigir encoding.

Scripts/artefatos locais relevantes que uma nova sessão deve localizar pelo nome antes de criar alternativas:

- `auditar-sha-catalogo-novos.ps1`;
- `catalogo-pastas-publicas.ps1`;
- `testar-integridade-automacao.ps1`;
- `executar-consolidacao-novos.ps1`;
- `preparar-fila-revisao-novos-catalogo.ps1`;
- `verificar-portao-publicacao.ps1`;
- `planejar-correcao-catalogo-oficial.ps1`;
- `auditoria-sha-novos-catalogo-state.json`;
- `auditoria-sha-catalogo-cache.csv`;
- `auditoria-sha-novos-catalogo.csv`;
- `fila-revisao-novos-catalogo-resumo.json`;
- `portao-publicacao-resumo.json`.

Ao retomar no desktop, primeiro localizar e ler esses artefatos; não criar um pipeline paralelo se o existente puder ser evoluído de forma limpa.

Estado do acesso remoto em 2026-10-06: o dispositivo `DESKTOP-COHT67R` está online e responde a ping, porém operações de arquivo continuam bloqueadas pela cota mensal do Desktop Commander. O serviço instruiu explicitamente a não repetir/reconectar. Até a cota liberar, não tentar contornar por outro controlador do PC.

## Fonte externa privada: checkpoint

O nome comercial da fonte não deve ser gravado no repositório público; o pipeline deve permanecer neutro.

Inventário local previamente confirmado:

- aproximadamente **12.105 imagens**;
- aproximadamente **1.514 produtos/slugs**;
- **428 imagens principais** já passaram pela consolidação inicial;
- classificação V2 das principais: **353 modelos já representados** + **75 não duplicados**;
- dentro desses 75, **40 de alta confiança** já foram colocados em `Novos`;
- esses 40 já constam por SHA em `Novos`, portanto **não copiá-los novamente**.

Importante: os 353 “já representados” foram deduplicados em **nível de modelo**, não em nível de galeria. Eles ainda precisam de auditoria das imagens secundárias para aproveitar frente, costas, laterais, detalhes e versões de maior qualidade.

## Próxima sequência de trabalho

Executar nesta ordem, sem pular etapas:

1. **Corrigir o escopo público do auditor local**
   - usar as mesmas seis categorias canônicas do pipeline web;
   - preservar referências, lotes, estatísticas, `Novos` e material auxiliar fora do snapshot público;
   - não apagar nada para “resolver” duplicata de referência.

2. **Migrar/revalidar o checkpoint SHA**
   - reaproveitar cache;
   - recalcular fingerprint do escopo correto;
   - confirmar 0 erros;
   - recalcular os grupos de duplicatas internas reais.

3. **Revalidar a fila `Novos`**
   - confirmar os 40 de promoção;
   - confirmar as 16 de quarentena privada;
   - nenhum movimento em lote sem gate verde.

4. **Auditar a fonte externa por produto, não por imagem principal**
   - agrupar todas as imagens pelo identificador/slug do produto;
   - para modelos já existentes, criar um CSV explícito `incoming_model,target_model` e passar em `tools/plan_gallery_merge.py --mapping`;
   - nunca resolver correspondência apenas por nome de personagem/pasta;
   - o mapa deve falhar se origem/alvo não existirem ou se dois produtos diferentes apontarem para o mesmo modelo público;
   - comparar galeria existente × imagens da fonte;
   - SHA igual → ignorar cópia;
   - nova vista → adicionar;
   - candidato visual → revisão de qualidade;
   - registrar a decisão em CSV e executar `tools/resolve_gallery_merge.py`;
   - nenhuma promoção de candidato visual pode seguir sem o resolvedor retornar `ready=true`;
   - gerar `gallery-promotions.csv` com `tools/build_gallery_promotion_manifest.py`; cada linha fica vinculada ao `resolution_sha256` da revisão exata;
   - no desktop, executar `tools/verify_gallery_promotion_manifest.py ... --source-root <raiz> --existing-manifest <manifest-atual>`; só `ready=true` libera a cópia;
   - o verificador confere `resolution_sha256`, integridade do CSV, segurança do caminho, recalcula `source_sha256` e revalida todo `replace_existing` contra o manifesto atual;
   - resolver o destino somente pela árvore auditada atual;
   - `replace_existing` supersede a vista na publicação, mas não autoriza apagar o mestre antigo;
   - produto diferente do mesmo personagem → manter modelo separado.

5. **Promover conteúdo aprovado para o catálogo mestre**
   - preservar STL, GLB, 3MF, OBJ e demais fontes;
   - não mexer em fotos/arquivos pessoais;
   - não tocar em processos de outros projetos;
   - não apagar arquivos sem prova forte e fluxo explícito.

6. **Gerar publicação**
   - ingestão auditada;
   - `tools/plan_gallery_merge.py`;
   - `tools/build_media_bundle.py`;
   - validar variantes e manifestos;
   - executar `tools/publish_d1.py models.jsonl --check-production` em modo somente leitura **antes do R2**;
   - bloquear qualquer colisão de ID/slug/código ou mudança implícita de categoria/franquia/nome/coleção/pasta;
   - bloquear redução de galeria por padrão; quando realmente necessária, usar `--gallery-shrink-approvals <csv>` com contagem e versões exatas antes/depois e motivo explícito;
   - publicar delta no R2;
   - executar `tools/publish_d1.py ... --apply`, que revalida produção e o gate R2 antes dos upserts.

7. **Validar produção**
   - modelos novos e modelos atualizados;
   - contagem real de imagens por galeria;
   - capas;
   - slugs/códigos;
   - buscas/FTS;
   - categorias/franquias/pastas;
   - executar `verify_public_catalog.py --exhaustive --all-galleries`;
   - exigir `total == image_count`, `version == gallery_version`, paginação válida, IDs de imagens únicos e uma única capa;
   - só considerar a integração concluída depois desse gate público.

8. **Executar uma única auditoria pós-integração**
   - atualizar contadores `[N]` e prefixos `OK -` quando aplicável;
   - registrar novo fingerprint/checkpoint;
   - atualizar este arquivo com os novos totais.

## O que não fazer

- Não recomeçar o catálogo do zero.
- Não reprocessar pastas/imagens já concluídas sem motivo técnico.
- Não reiniciar SHA V4 por conveniência.
- Não copiar todas as imagens da fonte privada indiscriminadamente.
- Não interpretar “modelo duplicado” como “todas as imagens são duplicadas”.
- Não juntar modelos diferentes apenas porque são do mesmo personagem.
- Não criar árvores paralelas por causa de prefixo `OK -` ou sufixo `[N]`.
- Não deletar STL/GLB/3MF/OBJ/fontes.
- Não tocar em fotos pessoais.
- Não tocar em processos de outros projetos.
- Não criar fallback de Cloudflare, credencial hardcoded ou segredo no Git.

## Arquivos técnicos relevantes do repositório

- `config/public-catalog-roots.json` — SSOT versionado das categorias públicas;
- `tools/catalog_scope.py` — carregamento/validação compartilhada do SSOT;
- `tools/ingest_catalog.py` — aplica o SSOT na ingestão, além de hashes, qualidade e manifesto;
- `tools/publish_d1.py` — revalida o SSOT antes de publicar/upsert no D1;
- `tools/plan_gallery_merge.py` — plano não destrutivo para mesclar galerias e aplicar mapa explícito produto→modelo;
- `tools/resolve_gallery_merge.py` — gate fail-closed das decisões visuais antes da promoção;
- `tools/build_gallery_promotion_manifest.py` — gera CSV auditável de autorizações, sem copiar/apagar arquivos;
- `tools/verify_gallery_promotion_manifest.py` — valida resolução, CSV, caminhos e SHA dos arquivos antes da cópia;
- `tools/build_media_bundle.py` — galeria, variantes e identidade estável;
- `tools/publish_r2.py` — upload incremental de mídia;
- `tools/publish_d1.py` — preflight read-only de identidade em produção + upsert idempotente após revalidação e gate R2;
- `tools/verify_public_catalog.py` — validação pública, incluindo auditoria amostral ou completa das galerias multi-imagem;
- `tools/check_worker_gallery_contract.mjs` — smoke pós-deploy do Worker para `gallery_version`, `image_count`, total e capa;
- `tools/test_multi_image_release_contract.py` — ensaio integrado de expansão 1→3 imagens preservando identidade e um único registro D1;
- `docs/INGESTAO.md` — contrato da ingestão;
- `docs/MIDIA-R2.md` — contrato de mídia e galeria;
- `docs/DATA_MODEL.md` — modelo de dados;
- este arquivo — **checkpoint de continuidade**, não documentação conceitual.

## Regra para futuras sessões

Antes de trabalhar:

1. ler este arquivo;
2. conferir a `main` atual e o CI;
3. conferir se os totais registrados aqui ainda batem com produção/local;
4. continuar do próximo item pendente;
5. atualizar este checkpoint ao final de uma mudança operacional relevante.

Se houver divergência entre uma conversa antiga e o estado medido no repositório/produção, **o estado medido e este SSOT atualizado prevalecem**.
