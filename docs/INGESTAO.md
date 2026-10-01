# Ingestão do acervo

O importador foi desenhado para um acervo com 100 mil+ modelos/imagens e **nunca altera, move ou apaga os arquivos de origem**.

## Objetivo

Transformar a árvore de pastas auditada em um manifesto técnico reutilizável pelo backend e pelo futuro upload ao R2/D1.

```bash
python tools/ingest_catalog.py "G:\Meu Drive\Catalogo" --output ".catalog-ingest" \
  --audit-registry "G:\Meu Drive\Catalogo\00 - ESTATISTICAS - CATALOGO [2596] - NOVOS [0]\REGISTRO-AUDITORIA-IMAGENS.csv"
```

Na primeira execução cada imagem elegível é aberta e analisada. Nas execuções seguintes, arquivos cujo caminho, tamanho e `mtime_ns` não mudaram são reaproveitados do checkpoint.\n\n### Fronteira de publicação\n\nA raiz real também contém pastas operacionais de auditoria. Por segurança, a ingestão pública é **fail-closed**: somente diretórios de primeiro nível com prefixo `OK - ` entram no manifesto. Pastas como `00 - ESTATISTICAS...`, `Novos` e `99 - LOTES CONSOLIDADOS` ficam fora mesmo que contenham imagens. Se nenhuma categoria auditada existir, o processo falha em vez de publicar conteúdo auxiliar.\n\nEm produção, prefira `--audit-registry` apontando para `REGISTRO-AUDITORIA-IMAGENS.csv`. Esse modo usa os caminhos já revisados como fonte de verdade, evita uma varredura recursiva lenta do Google Drive e ainda recalcula o SHA-256 de cada imagem: qualquer divergência entre o arquivo atual e o hash auditado interrompe a ingestão.

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
