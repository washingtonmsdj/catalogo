# R21 — Ações de coleções sem sobreposição

Os botões **Coleções** e **Compartilhar** eram atalhos fixos renderizados acima dos cards no celular e no tablet. A R21 mantém ambos os controles e seus respectivos diálogos, mas os agrupa em uma faixa de ações após o conteúdo no layout até 1499 px.

- Até 1499 px: ambos os botões ficam no fluxo do documento, com nome visível, alvos de toque de pelo menos 44 px, foco visível e margem inferior respeitando a área segura do dispositivo. Nenhum card fica coberto ao rolar.
- A partir de 1500 px: os dois atalhos flutuantes originais permanecem, sem mudança nas APIs ou na lógica das coleções.
- Removido o espaço inferior de 78 px do conteúdo mobile que existia para contornar os antigos botões flutuantes.
- A auditoria Chromium continua gerando capturas em seis larguras e agora verifica a posição computada dos dois botões, colisões com os cards, presença dentro da tela, tamanho de toque e abertura/fechamento dos diálogos em 390 e 1024 px.

A faixa fica depois do catálogo para não ocupar espaço no topo. O acesso às listas e ao compartilhamento permanece disponível no final dos resultados; um atalho contextual no cabeçalho pode ser considerado em outra rodada.

A auditoria roda no build demo isolado do GitHub Actions. Não substitui validação do serviço público, que possui workflow Pages separado. Nenhum Worker, D1, R2 ou schema foi modificado.

O CI inicial confirmou que 1440 px ainda apresentava colisão com cards quando os botões eram fixos. Por isso o corte foi alinhado ao início do painel lateral reservado (1500 px), protegendo também desktops intermediários.
