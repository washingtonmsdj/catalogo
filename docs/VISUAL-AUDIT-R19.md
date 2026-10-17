# R19 — Evidência visual automatizada no GitHub

O CI executa um job independente chamado **Browser visual audit (demo)** com Chromium. Ele gera um build demo explícito, separado da publicação. Nenhum modelo fictício é enviado ao site público.

- Viewports: 320, 390, 768, 1024, 1440 e 1920 px.
- Capturas PNG da home editorial e do modo resultados (12 imagens, quando todas as etapas passam).
- Checks: overflow horizontal, cards fora da viewport, painel de orçamento em telas largas, navegação de coleções, link de pular ao catálogo e busca com Enter.
- Em 390 e 1920 px também testa seleção de um modelo para orçamento.
- Resultados e medidas por viewport em report.json.

O job é parte do workflow **CI**, executado em PRs e pushes à main. Se falhar, o CI fica vermelho. O upload de evidências usa always(), inclusive quando algum teste não passa.

No GitHub: Actions → CI → visual-audit → Artifacts → catalog-visual-(SHA).

As capturas permitem revisão humana do layout; o gate automatizado verifica geometria e interação, não equivalência pixel a pixel. Ele não substitui a validação do domínio público. O driver Playwright é instalado com versão fixa apenas no runner temporário; nem o computador local nem package-lock.json são alterados.

## R20 — Revisão das capturas e legibilidade em 320 px

A revisão do artifact CI `catalog-visual-3f0dc4c5622cfb96dd7e5e226e4cfb0eea1a28fa` encontrou resultados divididos em duas colunas na viewport de 320 px, que deixavam títulos e metadados truncados. O CSS canônico agora apresenta **uma coluna entre 0–359 px** apenas no modo de resultados, com cards de 212 px; 390 px mantém as duas colunas para navegação compacta. As demais larguras permanecem inalteradas.

O teste de navegador também restaura o topo e desfoca o link "Pular para o catálogo" **somente depois de testar a navegação pelo teclado**, antes de cada captura. Assim, os PNGs não mostram o foco/posição de rolagem deixados pela etapa de acessibilidade e representam a página desde o início.

`report.json` agora inclui `columns` por largura e o CI exige explicitamente 1 coluna em 320 px e 2 em 390 px, além das verificações existentes de overflow, quote rail e navegação. O CI não analisa automaticamente a qualidade estética das capturas.

### Verificação adicional do hero mobile

Ao abrir as capturas regeneradas, o título da chamada principal estava **visualmente cortado no topo** em 320 e 390 px. A causa era a combinação legada de `position:absolute;bottom` no conteúdo mobile com um hero de altura insuficiente e `overflow:hidden`. Em até 620 px, o conteúdo do hero voltou ao fluxo normal e a altura acompanha o texto. O browser agora exige que os limites verticais do `h1` permaneçam dentro do contêiner do hero em todas as seis larguras. Isso protege uma falha que as medições de overflow horizontal da R19 não conseguiam detectar.
