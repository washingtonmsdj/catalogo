# R22 — Acesso rápido às coleções durante a navegação

A R21 removeu os atalhos flutuantes abaixo de 1500 px para impedir sobreposição com cards. A R22 adiciona um botão compacto Minhas coleções ao cabeçalho sticky, permitindo abrir o mesmo painel sem percorrer a página inteira.

## Estado canônico

O componente CollectionActionsProvider possui o único estado em memória de abertura do painel CollectionsDock, compartilhado com CatalogHome. Não há duplicação de dados de coleção, eventos globais ou persistência adicional. O compartilhamento por link permanece independente.

## Layout e validação

- Até 1499 px: acesso por botão do cabeçalho, inclusive após rolagem e em páginas de resultados; alvo de pelo menos 44 px, nome acessível e foco visível.
- Entre 1300 e 1499 px o rótulo Minhas coleções aparece com o ícone; em larguras menores utiliza um ícone com nome acessível.
- Em 1500 px ou mais: mantém o dock flutuante na área reservada, sem botão duplicado no cabeçalho.
- O dock no fim da página continua disponível em layouts compactos, com os dois diálogos e seus comportamentos originais.
- A auditoria Chromium continua cobrindo seis larguras, testa rolagem seguida de abertura do modal existente e impede regressões de responsividade e layout.

Build demo e testes de navegador rodam exclusivamente no GitHub Actions. A API, o Worker, D1, R2 e os dados de modelos não são modificados.
