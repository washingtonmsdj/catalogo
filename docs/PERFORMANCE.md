# Performance do frontend

O catálogo foi desenhado para crescer para 100 mil+ modelos sem transferir o acervo inteiro para o navegador. A escala do banco e a leveza da interface são tratadas como problemas separados.

## Orçamento de bundle

O CI mede os arquivos JavaScript e CSS produzidos em `dist/`, incluindo o tamanho gzip, e bloqueia mudanças que ultrapassem os limites aprovados:

- JavaScript individual: até 180 KiB gzip
- JavaScript total: até 250 KiB gzip
- CSS total: até 60 KiB gzip
- JavaScript total sem compressão: até 650 KiB
- CSS total sem compressão: até 200 KiB

Os limites são deliberadamente folgados para permitir evolução controlada, mas baixos o bastante para sinalizar dependências pesadas, UI excessiva ou regressões acidentais.

## Princípios de escala

- listagens usam paginação por cursor;
- galerias são carregadas separadamente por personagem;
- imagens possuem variantes próprias para miniatura, card e detalhe;
- nenhum recurso deve depender de baixar todos os modelos;
- favoritos persistem somente metadados mínimos;
- mídias originais não entram no bundle do frontend;
- componentes visuais não devem incorporar bibliotecas grandes sem justificativa mensurável.

## Validação local

Após `npm run build`, execute:

```bash
npm run budget:frontend
```

O mesmo comando roda automaticamente em toda PR pelo GitHub Actions.

Quando um limite for atingido, primeiro deve-se investigar a regressão. Aumentar o limite é a última opção e precisa representar uma decisão arquitetural explícita.
