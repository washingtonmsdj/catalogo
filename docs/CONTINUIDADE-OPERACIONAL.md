# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-06**. O objetivo é evitar reprocessamento, perda de checkpoints e decisões divergentes.

## Estado confirmado

### GitHub / frontend

- Branch autoritativa: `main`.
- Base funcional do pipeline validada no CI: `9e5738e6ddc776534296f26746af35b6ffe998b2`. Commits posteriores podem ser apenas de documentação; sempre conferir a `main` antes de executar.
- CI do commit: **verde**.
- Deploy do preview GitHub Pages: **verde**.
- Preview público: `https://washingtonmsdj.github.io/catalogo/`.
- O frontend já suporta galeria paginada, lightbox, múltiplas imagens por modelo, navegação por teclado e carregamento separado da mídia.
- A arquitetura de dialogs usa um controlador global para focus trap, restauração de foco e scroll lock.
- O CI protege essa arquitetura com `npm run dialog:a11y`.

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
- o gate R2/D1 exige que `imageCount` coincida com o manifesto e que todas as variantes `thumb/card/detail` existam.

## Política de imagens e qualidade

Ferramenta: `tools/plan_gallery_merge.py`.

A política é não destrutiva:

- SHA-256 igual: não republicar a mesma imagem;
- vista diferente: adicionar à galeria;
- similaridade perceptual: **somente revisão**, nunca exclusão automática;
- se a fonte nova tiver qualidade superior, recomendar a nova;
- se a imagem atual for superior, conservar a atual;
- arquivos mestres nunca são apagados pela ingestão;
- a origem não é modificada pelo pipeline web.

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

1. Pessoas
2. Animes & Desenhos
3. Filmes & Séries
4. Marvel & DC
5. Games
6. Tokusatsu & Cultura Japonesa

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
   - bloquear qualquer colisão de ID/slug/código ou mudança implícita de categoria/franquia;
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
