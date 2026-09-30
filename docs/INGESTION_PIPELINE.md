# Pipeline de ingestão do acervo

## Objetivo

Receber lotes grandes de imagens, associar corretamente cada arquivo ao modelo/personagem, remover repetição visual e publicar somente a melhor versão de cada vista.

## Etapas

1. **Descoberta** — ler arquivos novos sem alterar os originais.
2. **Integridade** — validar formato, dimensões e arquivo corrompido/zerado.
3. **SHA-256** — eliminar duplicatas binárias exatas.
4. **Hash perceptual** — agrupar imagens visualmente iguais ou quase iguais.
5. **Pontuação de qualidade** — escolher a melhor candidata de cada grupo.
6. **Classificação** — associar categoria, franquia, personagem/modelo e tags.
7. **Variantes web** — gerar `thumb`, `card` e `detail`, preservando o original.
8. **Publicação** — enviar variantes ao object storage e metadados ao banco.
9. **Índice de busca** — atualizar somente registros afetados.

## Duplicatas

Duplicatas exatas usam SHA-256. Duplicatas visuais usam pHash/dHash com tolerância controlada; o sistema nunca deve apagar automaticamente um original apenas por similaridade perceptual.

Cada grupo de duplicatas mantém rastreabilidade dos candidatos e aponta uma imagem principal.

## Prioridade de qualidade

A seleção automática deve favorecer, nesta ordem geral:

1. imagem íntegra;
2. maior área útil em pixels;
3. melhor nitidez;
4. menor incidência de artefatos de compressão;
5. enquadramento mais completo da peça;
6. formato/fonte com menos perdas quando o conteúdo for equivalente.

Resolução maior sozinha não é suficiente: uma imagem ampliada artificialmente não deve vencer um original menor e mais nítido.

## Publicação segura

O arquivo mestre não é sobrescrito. As imagens públicas são derivadas e podem ser regeneradas a qualquer momento.

As operações devem ser idempotentes: executar o pipeline novamente sobre o mesmo lote não pode criar modelos ou imagens duplicadas.

## Escala

O pipeline deve funcionar por lote e checkpoint. Com 100 mil+ modelos, nenhuma etapa pode exigir reprocessar todo o acervo apenas porque uma pasta recebeu novas imagens.
