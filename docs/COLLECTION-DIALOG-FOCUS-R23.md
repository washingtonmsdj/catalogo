# R23 — Teclado e foco em Coleções / Compartilhamento

A R22 tornou o painel de coleções acessível pelo cabeçalho fixo e pela faixa ao fim do catálogo. A R23 fecha o contrato de foco dos dois diálogos relacionados.

O hook único \`useCollectionDialogFocus\` (sem persistência e sem eventos globais de negócio) controla somente a interação modal:
- ao abrir, coloca o foco no botão de fechamento identificado;
- \`Tab\` e \`Shift+Tab\` circulam somente entre controles utilizáveis dentro do diálogo;
- \`Escape\` fecha o painel sem propagar a tecla para atalhos gerais da aplicação;
- ao fechar, devolve o foco ao botão real que abriu o painel, seja ele do cabeçalho ou da faixa inferior;
- quando o link compartilhado abre o painel diretamente e não existe acionador anterior, mantém o fechamento normal sem inventar um alvo de retorno.

Não modifica os estados, itens, links públicos ou persistência das coleções. O estado de abertura do painel principal continua no \`CollectionActionsProvider\` da R22. O compartilhamento continua com sua máquina de estados própria.

O CI executa cenários reais de Chrome/Chromium com foco inicial, ciclo reverso de Tab, Escape, retorno de foco e fechamento por botão. O build de demonstração é isolado do deploy público, como nas R19–R22.
