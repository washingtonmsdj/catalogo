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
