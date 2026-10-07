# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-07**. O objetivo é evitar reprocessamento, perda de checkpoints e decisões divergentes.

## Estado confirmado

### GitHub / frontend

- Branch autoritativa: `main`.
- Base funcional do pipeline validada no CI: `35f016bfc6b217e9ca54a4dc9054364203961da4`. Commits posteriores podem ser apenas de documentação; sempre conferir a `main` antes de executar.
- CI do commit: **verde**.
- Deploy do preview GitHub Pages: **verde**.\n- URL pública canônica: `https://acheguese.com.br/tonecosstudios/`.\n- Origem/preview independente: `https://washingtonmsdj.github.io/catalogo/`.
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
- Vercel no Achegue-se mantém `/catalogo` apenas como rota legada e redireciona para `/tonecosstudios/`;
- `/tonecosstudios/*` é encaminhado para a origem GitHub Pages do Catálogo;
- `/catalogo-api/*` é encaminhado para o Worker do Catálogo;
- no domínio Achegue-se, o frontend detecta o hostname e usa a API first-party `/catalogo-api`;
- no GitHub Pages, o preview continua usando o Worker configurado em `VITE_API_BASE_URL`;
- `config/public-runtime.json` é o SSOT versionado da URL pública canônica: `https://acheguese.com.br/tonecosstudios/`;
- o widget Turnstile do Catálogo aceita `acheguese.com.br`, `www.acheguese.com.br` e `washingtonmsdj.github.io`.

Temporariamente, a superfície pública do Achegue-se redireciona `/`, `/catalogo` e demais páginas de visitante para `/tonecosstudios/`. O aplicativo Achegue-se permanece intacto atrás desse roteamento de borda; esta medida é reversível e não altera suas páginas, componentes ou conteúdo.

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
- após a revisão visual de Kari e Tailmon, o registro explícito contém **21 galerias legadas**, **53 slugs** e **32 cards excedentes**;
- os 47 slugs do baseline anterior foram cruzados com o D1: **47/47 encontrados, 0 ausentes, 0 divergências**; os pares revisados adicionados após esse baseline devem passar pelo mesmo preflight antes de qualquer aplicação;
- `config/catalog-legacy-gallery-overrides.json` é o registro versionado dessa dívida e contém o resumo auditado (`auditedGroups`, `auditedMemberCards`, `auditedExtraCards`); validações bloqueiam sobreposição de slugs, canônico fora dos membros, modo de correspondência inválido, motivo vazio e divergência entre o resumo e os grupos registrados;
- `src/services/catalogApi.ts` consegue hidratar o grupo registrado mesmo quando suas vistas caem em páginas diferentes da API; a camada é transitória e se desativa naturalmente quando o backend passar a entregar a galeria canônica.

Não aumentar esse registro para “resolver” ambiguidades. Casos novos só entram após auditoria visual/identidade conclusiva, com atualização explícita do resumo auditado na mesma mudança. A meta operacional é reduzir os cards excedentes até zero por consolidações comprovadas; crescimento só pode representar dívida real recém-descoberta e revisada, nunca heurística automática.

### Reconciliação segura de fichas obsoletas

`tools/publish_d1.py` continua sem exclusão física. Para evitar acumular cards históricos quando uma galeria é consolidada, existe agora o fluxo explícito `--retire-absent-approvals <csv>`:

- o publicador pagina o inventário completo de modelos publicados por chave, sem `OFFSET`;
- compara o snapshot candidato com o inventário D1;
- cada ficha publicada ausente precisa de aprovação exata `model_id,slug,code,reason`;
- aprovação faltante, sobrando ou com slug/código desatualizado bloqueia a publicação;
- a única mutação permitida é `published=0`; **não há DELETE**;
- uma ficha ainda presente no snapshot nunca pode ser aposentada por esse CSV.

Esse mecanismo genérico continua disponível para snapshots futuros, mas **não é o caminho autorizado para os cards legados já revisados**. Para os grupos do registro canônico existe `tools/apply_legacy_gallery_repairs.py`, que só insere relações canônico→fonte; a migration 0015 aposenta cada fonte no mesmo statement, sem DELETE.

### Estado de migrations da produção

O D1 público foi inspecionado diretamente e está aplicado somente até:

- `0001_catalog.sql` … `0010_recent_models_index.sql`.

Ainda pendentes na produção:

- `0011_model_gallery_members.sql` — relação canônico → fontes de galeria;
- `0012_folder_materialized_counts.sql` — contadores materializados `direct_model_count` e `subtree_model_count`;
- `0013_model_image_sources.sql` — índice consultável de `source_sha256` por imagem/modelo/versão para auditoria exata em escala;
- `0014_gallery_member_integrity.sql` — bloqueia ciclos, cadeias e relações entre escopos incompatíveis;
- `0015_gallery_publication_invariant.sql` — ao anexar uma ficha-fonte à galeria canônica, aposenta a fonte no mesmo statement e impede republicação acidental;
- `0016_public_gallery_revision.sql` — separa versão física do manifest da revisão pública monotônica usada por API/cache;
- `0017_gallery_lifecycle_integrity.sql` — exige fonte ativa na consolidação e protege canônico/fonte contra aposentadoria, drift de escopo ou exclusão acidental enquanto ligados.

Por isso `catalog_folders.direct_model_count` e `catalog_folders.subtree_model_count` ainda não existem no D1 público. A migration 0012 já possui triggers para INSERT, DELETE, mudança de pasta e `published: 1↔0`; os testes cobrem inclusive a aposentadoria lógica reduzindo a contagem da pasta e de todos os ancestrais. Não aplicar essas migrations manualmente fora do workflow apenas para contornar a credencial ausente; manter a ordem versionada e a tabela `d1_migrations` coerente.

### Contrato de schema e promoção das galerias legadas

- `config/catalog-schema-contract.json` é a SSOT versionada das migrations exigidas pelo Worker;
- o CI compara esse contrato com **todos** os arquivos `migrations/NNNN_*.sql`; migration nova sem atualização do contrato quebra o gate;
- `/api/health` consulta `d1_migrations` e retorna 503 `schema_not_ready` se faltar qualquer migration;
- estado saudável é cacheado por instância do Worker; estado incompleto **não** é cacheado, permitindo recuperação imediata após a migration;
- o workflow Cloudflare só prossegue depois de `check_worker_health.mjs` confirmar contrato, última migration e zero pendências;
- todo deploy saudável executa `apply_legacy_gallery_repairs.py` em modo somente leitura para provar que o D1 ainda corresponde integralmente aos grupos revisados do registro versionado;
- aplicar as relações exige `workflow_dispatch` com `apply_legacy_gallery_repairs=true`; o padrão é **false**;
- a operação é idempotente: relações já corretas são ignoradas e progresso parcial pode ser retomado;
- inserir a relação aposenta a fonte automaticamente; contadores de categoria, franquia e pasta são atualizados pelos triggers existentes;
- uma fonte anexada não pode voltar a `published=1` enquanto a relação existir;
- alterar identidade canônico/fonte de uma relação existente é proibido; reestruturação exige operação explícita e auditada.

Não aplicar reparos registrados antes de 0011–0015 e o Worker correspondente estarem realmente implantados, o preflight do D1 confirmar todos os membros e o health estrutural retornar verde.

### Ciclo de vida protegido das galerias consolidadas

A migration `0017_gallery_lifecycle_integrity.sql` fecha mutações que poderiam recriar bagunça depois da consolidação:

- uma ficha-fonte precisa estar `published=1` no momento em que é anexada; a 0015 a aposenta logo em seguida;
- um canônico com fontes anexadas não pode virar `published=0` por acidente;
- nome público, franquia e pasta de canônico/fonte ficam imutáveis enquanto a relação existir;
- canônico e fonte não podem ser fisicamente apagados enquanto ligados;
- qualquer reorganização exige desmontar explicitamente a relação, executar a mudança auditada e reconstruir a relação de forma consciente.

Isso impede que um script futuro “limpe” o catálogo quebrando aliases, galerias ou referências históricas sem que o banco bloqueie a operação.

### Revisão pública monotônica da galeria

A versão física `models.gallery_version` continua sendo derivada do conteúdo do manifest e serve para validar exatamente aquele JSON do R2. Ela **não** é mais usada como versão pública de uma galeria composta.

A migration `0016_public_gallery_revision.sql` adiciona `models.public_gallery_version`, iniciada em 1 e incrementada quando qualquer conteúdo visível pode mudar:

- imagem/manifest/versão física do canônico muda;
- imagem/manifest/versão física de uma ficha-fonte anexada muda;
- uma fonte entra ou sai da galeria;
- a ordem das fontes muda.

Assim não existe mais o risco de duas composições diferentes produzirem a mesma “versão” apenas porque a soma das versões físicas coincidiu. `/api/catalog`, `/api/recent`, ficha e endpoint de imagens expõem a revisão pública; a validação dos manifests continua usando a versão física individual.

### Compatibilidade permanente de referências aposentadas

Despublicar uma ficha-vista **não invalida seu ID nem seu slug**. Enquanto existir a relação em `model_gallery_members`:

- `GET /api/models/<slug-antigo>` resolve para a ficha canônica publicada;
- `GET /api/models/<slug-antigo>/images` abre a galeria canônica;
- IDs antigos enviados por Favoritos/Minha lista/orçamento são resolvidos para o ID canônico;
- dois IDs antigos que apontam para o mesmo produto são deduplicados antes de criar orçamento ou coleção;
- coleções compartilhadas já gravadas com IDs antigos continuam carregando o produto canônico;
- o modelo-fonte permanece no banco e sua mídia permanece no R2; ele só deixa de ser uma ficha navegável independente;
- não apagar nem reciclar slug, código ou ID de uma ficha-fonte aposentada.

`worker/modelAliases.ts` centraliza esse contrato. A limpeza de duplicatas é, portanto, uma **consolidação de identidade**, não uma exclusão destrutiva.

### Auditoria de irmãos numerados e cópias explícitas

Auditoria read-only do D1 em 2026-10-07 acrescentou uma segunda classe de revisão de identidade:

- a produção contém **49 grupos-base** com **114 modelos irmãos numerados** no mesmo personagem/pasta (ex.: `modelo` + `modelo-02`);
- isso **não significa 114 duplicatas**: personagens como Cammy, Goro, Juri etc. possuem várias esculturas/modelos realmente diferentes;
- esses casos são classificados como `numbered-review` e nunca são mesclados automaticamente;
- `config/catalog-numbered-sibling-review.json` registra a fila auditada com estados explícitos: `pending` (aguarda revisão), `distinct` (produtos diferentes), `mixed` (parte consolidada e parte distinta) ou `gallery` (grupo integralmente consolidado em uma galeria), além de base, membros e motivo;
- o baseline versionado começou em **49 grupos / 114 irmãos**; testes permitem reduzir a dívida, mas não aumentá-la silenciosamente acima desse baseline;
- grupo numerado novo ou mudança na lista de irmãos de um grupo conhecido bloqueia `publish_d1.py` até a fila de revisão ser atualizada conscientemente;
- **0** modelos publicados usam hoje marcador explícito de cópia com base correspondente (`-copy`, `-copia`, `-duplicate`, `-duplicado`);
- novos marcadores explícitos de cópia com o modelo-base presente no mesmo escopo bloqueiam a publicação até revisão;
- `audit_model_identity.py` gera `sibling-suffix-candidates.csv` e mantém essa fila separada das galerias fragmentadas por vistas;
- comparação numérica/cópia é sempre limitada à mesma categoria, franquia, pasta e nome público; nunca cruza personagens ou hierarquias;
- usando o `image_id` determinístico presente em `cover_storage_key`, os **2.596/2.596** modelos publicados foram auditados sem baixar mídia: **0 grupos reutilizam o mesmo image_id entre fichas diferentes**. Portanto não há duplicata binária óbvia escondida nos cards atuais.

Regra operacional: números no fim do slug são **evidência de revisão**, não evidência de duplicata. Somente confirmação visual/identidade pode consolidar esses produtos. Se um grupo for confirmado como galeria única, ele sai desta fila e entra no contrato canônico de galeria; se for confirmado como produtos distintos, recebe `status=distinct`.

### Continuidade histórica de identidade de produto

O ID técnico de um produto não pode mudar silenciosamente porque um arquivo/pasta foi renomeado, porque a identidade auditada foi corrigida ou porque o bundle foi reconstruído em outra máquina.

Contrato:

- `config/catalog-model-identity-aliases.json` registra **somente renomes aprovados** de identidade;
- cada entrada exige uma identidade canônica histórica, um ou mais aliases atuais e motivo explícito;
- alias não pode pertencer a dois canônicos, canônico não pode também ser alias de outro produto e duas identidades atuais não podem resolver para o mesmo canônico no mesmo snapshot;
- `mdl_*` e `TS-*` continuam derivados da identidade canônica histórica;
- o bundle grava `identityKey` como identidade canônica e `sourceIdentityKey` como identidade encontrada no snapshot atual;
- o slug público continua derivado da folha histórica quando houver renome/mudança de hierarquia aprovada, evitando troca de URL por reorganização de pasta;
- `media-build-state.json` mantém `identityHistory` com `sourceSha256 -> identidade canônica`; esse histórico **não é podado** quando um produto sai temporariamente do snapshot;
- se uma imagem histórica reaparecer sob outra identidade sem alias aprovado, o build falha com `identity drift detectado`;
- o preflight de produção repete a prova contra `model_image_sources`: o mesmo SHA não pode aparecer sob outro produto efetivamente publicado, mesmo que o bundle tenha sido gerado em outro computador;
- o bundle candidato também bloqueia o mesmo SHA exato em dois produtos candidatos diferentes.

Não usar o arquivo de aliases para “forçar” agrupamentos duvidosos. Ele serve para continuidade de **um produto já identificado**, não para decidir se dois produtos são iguais. Essa decisão continua exigindo auditoria de identidade/visual.

### Auditoria estrutural automatizada do D1

Foi executada auditoria read-only no D1 público atual (ainda em schema 0010) e todos os checks aplicáveis retornaram **zero divergências**:

- raízes, filhos, profundidade e caminhos da árvore de **1.063 pastas**;
- vínculo modelo → pasta/franquia;
- coerência coleção ↔ existência de pasta;
- campos obrigatórios dos modelos publicados;
- formato de `mdl_*`, `TS-*` e slugs;
- `models_fts`: **2.596 modelos / 2.596 linhas**, sem ausentes nem órfãos;
- `franchises_fts`: **250 franquias / 250 linhas**, sem ausentes nem órfãos;
- nenhum `created_at` ou `updated_at` no futuro.

`tools/audit_d1_integrity.py` transforma essa checagem manual em gate somente leitura para o schema completo. Depois que 0011–0018 estiverem aplicadas, o workflow Cloudflare executará o auditor após o health e novamente depois de qualquer reparo legado. O gate inclui também contadores diretos/subárvore, estado das relações de galeria, ausência de cadeias e drift do índice SHA. Qualquer resultado diferente de zero interrompe a promoção.

A busca FTS pode manter fisicamente entradas de fichas-fonte aposentadas porque o modelo continua no banco para aliases/histórico; o contrato do Worker exige `m.published = 1` em busca, recentes e resolução pública. O CI possui teste específico para impedir que uma refatoração reexponha essas fichas.

### Índice de identidade de mídia para escala

O hash da imagem não deve ficar consultável apenas dentro de milhares de manifests no R2. A migration `0013_model_image_sources.sql` materializa no D1 somente os metadados necessários à auditoria:

- `model_id`, `image_id`, posição, role, `source_sha256` e `gallery_version`;
- R2 e o manifesto continuam sendo a fonte canônica da galeria; a tabela não armazena imagem;
- o publicador lê o manifesto já validado e sincroniza o índice somente depois do gate R2;
- SHA-256 repetido **dentro da mesma galeria** é erro bloqueante;
- SHA-256 repetido em **modelos diferentes** é permitido, mas aparece em `crossModelExactImageCandidates` para revisão;
- nunca há merge automático entre produtos apenas por SHA;
- consultas consideram somente a linha da `gallery_version` atualmente ativa do modelo, portanto metadados antigos não contaminam a auditoria;
- a limpeza remove somente metadados de versões antigas de `model_image_sources`, nunca mídia R2 nem registros de modelo.

Esse índice transforma a auditoria de duplicata exata em consulta SQL indexada e evita varrer todo o R2 quando o acervo chegar a centenas de milhares ou milhões de imagens.

Backfill do acervo já publicado:

- `tools/backfill_image_source_index.py` mede cobertura por padrão e só escreve com `--apply`;
- o escopo inclui modelos publicados **e** fichas-fonte aposentadas que alimentam um canônico publicado;
- paginação é por chave `id`, sem `OFFSET`;
- baixa somente os manifests JSON referenciados por `gallery_manifest_key`; **0 binários de imagem**;
- valida `modelId`, `gallery_version`, `image_count`, capa, IDs e SHA antes de indexar;
- processa somente modelos sem índice para a versão atual;
- escrita D1 é dividida em batches limitados e pode ser retomada;
- após o preenchimento exige cobertura total do escopo efetivamente público;
- a auditoria de SHA agrupa imagens por `COALESCE(canonical_model_id, source_model_id)`, então vistas aposentadas do mesmo produto não geram falso positivo entre produtos;
- `workflow_dispatch.backfill_image_source_index` é **false** por padrão. Todo deploy mede cobertura; o backfill real exige opt-in explícito e `VITE_MEDIA_BASE_URL`.

Os 2.596 modelos do baseline atual ainda não possuem esse índice em produção porque a migration 0013 não foi implantada. Não reconstruir SHA a partir dos binários locais para preencher essa tabela: o backfill usa os `sourceSha256` já versionados nos manifests publicados.

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
