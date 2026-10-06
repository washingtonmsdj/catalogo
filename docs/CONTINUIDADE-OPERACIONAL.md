# Continuidade operacional do Catálogo

> **SSOT de continuidade.** Leia este arquivo antes de continuar o projeto em outra conversa, máquina ou sessão.
>
> Atualizado em **2026-10-06**. O objetivo é evitar reprocessamento, perda de checkpoints e decisões divergentes.

## Estado confirmado

### GitHub / frontend

- Branch autoritativa: `main`.
- Commit de referência deste checkpoint: `7eb0840c8d9bb6ff5c550ec91a7a38fe95975020`.
- CI do commit: **verde**.
- Deploy do preview GitHub Pages: **verde**.
- Preview público: `https://washingtonmsdj.github.io/catalogo/`.
- O frontend já suporta galeria paginada, lightbox, múltiplas imagens por modelo, navegação por teclado e carregamento separado da mídia.
- A arquitetura de dialogs usa um controlador global para focus trap, restauração de foco e scroll lock.
- O CI protege essa arquitetura com `npm run dialog:a11y`.

### Cloudflare

Recursos confirmados na conta conectada:

- Worker: `tonecos-catalogo-api`;
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

O deploy automático do backend continua fail-closed enquanto o GitHub Actions não possuir o secret `CLOUDFLARE_API_TOKEN`. Não criar fallback de autenticação e não colocar token em código, arquivo ou commit.

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

A ingestão do site já possui a fronteira correta em `tools/ingest_catalog.py`: somente estas seis categorias são públicas:

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

1. centralizar a definição das raízes públicas no helper local;
2. atualizar os consumidores do inventário/portão para essa definição;
3. migrar o inventário/cache existente para o novo escopo;
4. reutilizar hashes já válidos dos arquivos que continuam no escopo;
5. recalcular apenas inventário/fingerprint e o delta realmente necessário;
6. só fazer reset total se houver prova técnica de que a migração é impossível.

O usuário explicitamente não quer refazer trabalho já concluído.

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
   - para modelos já existentes, comparar galeria existente × imagens da fonte;
   - SHA igual → ignorar cópia;
   - nova vista → adicionar;
   - candidato visual → revisão de qualidade;
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
   - publicar delta no R2;
   - somente depois publicar/upsert no D1.

7. **Validar produção**
   - modelos novos e modelos atualizados;
   - contagem real de imagens por galeria;
   - capas;
   - slugs/códigos;
   - buscas/FTS;
   - categorias/franquias/pastas;
   - smoke e auditoria pública.

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

- `tools/ingest_catalog.py` — fronteira pública, hashes, qualidade e manifesto;
- `tools/plan_gallery_merge.py` — plano não destrutivo para mesclar galerias;
- `tools/build_media_bundle.py` — galeria, variantes e identidade estável;
- `tools/publish_r2.py` — upload incremental de mídia;
- `tools/publish_d1.py` — upsert idempotente após gate R2;
- `tools/verify_public_catalog.py` — validação pública;
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
