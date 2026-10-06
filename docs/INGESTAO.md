# Ingestão do acervo

O importador foi desenhado para um acervo com 100 mil+ modelos/imagens e **nunca altera, move ou apaga os arquivos de origem**.

## Objetivo

Transformar a árvore de pastas auditada em um manifesto técnico reutilizável pelo backend e pelo futuro upload ao R2/D1.

```bash
python tools/ingest_catalog.py "G:\Meu Drive\Catalogo" --output ".catalog-ingest" \
  --audit-registry "G:\Meu Drive\Catalogo\00 - ESTATISTICAS - CATALOGO [2596] - NOVOS [0]\REGISTRO-AUDITORIA-IMAGENS.csv"
```

Na primeira execução cada imagem elegível é aberta e analisada. Nas execuções seguintes, arquivos cujo caminho, tamanho e `mtime_ns` não mudaram são reaproveitados do checkpoint.\n\n### Fronteira de publicação\n\nA raiz real também contém pastas operacionais de auditoria. Por segurança, a ingestão pública é **fail-closed**: somente as seis categorias canônicas entram no manifesto — `Pessoas`, `Animes & Desenhos`, `Filmes & Séries`, `Marvel & DC`, `Games` e `Tokusatsu & Cultura Japonesa`. O prefixo opcional `OK - ` e o sufixo de contagem `[N]` não alteram a identidade da categoria; assim a árvore histórica do Drive e as categorias já auditadas continuam compatíveis. Pastas como `00 - ESTATISTICAS...`, `Novos`, `99 - LOTES CONSOLIDADOS` e qualquer categoria desconhecida ficam fora mesmo que contenham imagens. Se nenhuma categoria canônica existir, o processo falha em vez de publicar conteúdo auxiliar.\n\nEm produção, prefira `--audit-registry` apontando para `REGISTRO-AUDITORIA-IMAGENS.csv`. Esse modo usa os caminhos já revisados como fonte de verdade, evita uma varredura recursiva lenta do Google Drive e ainda recalcula o SHA-256 de cada imagem: qualquer divergência entre o arquivo atual e o hash auditado interrompe a ingestão.

## Saídas

- `manifest.jsonl`: fonte técnica completa, uma linha por imagem;
- `manifest.csv`: visão humana para conferência;
- `duplicates.json`: grupos de duplicatas/candidatos visuais e a versão recomendada;
- `summary.json`: totais de imagens, erros, grupos, canônicas e modelos detectados.

## Integridade e identidade

Para cada arquivo são registrados:

- caminho relativo;
- tamanho e data técnica de modificação;
- SHA-256;
- dHash perceptual de 64 bits;
- largura, altura e megapixels;
- estimativa de nitidez;
- pontuação de qualidade;
- categoria, franquia e chave hierárquica do modelo.

Arquivos vazios, ilegíveis ou com formato inválido ficam com `status=ERRO` e permanecem intactos no acervo.

## Identidade de modelo e galerias

No modo `--audit-registry`, a coluna `modelo_publico` é a identidade estável do modelo dentro da sua hierarquia. **Todas as imagens que pertencem ao mesmo produto/modelo devem compartilhar o mesmo `modelo_publico`**. Assim, frente, costas, laterais e detalhes continuam como imagens distintas de uma única ficha pública.

Quando `modelo_publico` estiver vazio, o importador mantém o comportamento legado e usa o nome-base do arquivo como identidade, preservando compatibilidade com o catálogo já publicado. Esse fallback não deve ser usado para novos lotes do STL Forge.

Antes de publicar um lote novo ou complementar, use o planejador de galeria:

```bash
python tools/plan_gallery_merge.py ".catalog-ingest/manifest.jsonl" ".stlforge-ingest/manifest.jsonl" --output ".stlforge-ingest/gallery-merge-plan.json"
```

A política é fail-closed:

- SHA-256 igual: não republicar a mesma imagem;
- sem correspondência exata/perceptual: adicionar como nova vista;
- semelhança perceptual: apenas candidato de revisão, nunca remoção automática;
- quando o STL Forge tiver maior `quality_score`, o plano recomenda a imagem do STL Forge como vencedora da revisão;
- nenhuma decisão do planejador apaga ou move os mestres.

## Duplicatas exatas

Mesmo SHA-256 significa conteúdo binário idêntico. O grupo recebe `kind=exact` e somente um membro é marcado como `canonical=true`.

Nenhum arquivo é removido automaticamente.

## Imagens visualmente equivalentes

O dHash permite encontrar versões visualmente muito próximas mesmo quando resolução, compressão ou formato mudaram. A comparação é feita **somente dentro da mesma hierarquia de modelo**, evitando misturar personagens diferentes por semelhança de silhueta.

O padrão usa distância de Hamming `<= 6`. Esses grupos são `visual_candidate`, pois devem continuar auditáveis. O limiar pode ser alterado:

```bash
python tools/ingest_catalog.py "CAMINHO" --visual-threshold 4
```

Quanto menor o número, mais conservadora a comparação.

## Escolha da melhor versão

Dentro de um grupo equivalente, o arquivo recomendado considera:

1. resolução útil;
2. nitidez estimada;
3. formato da fonte;
4. dimensões e tamanho como desempate.

A versão vencedora vira a candidata a capa/original canônico. As variantes web (`thumb`, `card`, `detail`) serão geradas depois, sem substituir o original.

## Regra de segurança

O pipeline **não deve usar o resultado perceptual como autorização para deletar arquivos**. Deduplicação física, caso seja desejada no futuro, é uma operação separada e exige confirmação/relatório próprio.

## Próxima integração

Quando o acesso ao acervo local estiver disponível novamente, o fluxo será:

`Catálogo auditado → ingestão/checkpoint → revisão de duplicatas → variantes web → R2 → D1 → catálogo público`
