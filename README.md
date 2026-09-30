# Catálogo Tonecos Studios

Catálogo web escalável para uma coleção de 100 mil+ modelos, com navegação inspirada em seletores de personagens de fliperama.

## Arquitetura

- Frontend desacoplado do armazenamento de imagens.
- Imagens futuras em object storage/CDN (Cloudflare R2), não no GitHub.
- Metadados e busca via API/banco (Cloudflare Workers + D1 ou equivalente).
- Cada modelo/personagem pode possuir dezenas de imagens, com uma imagem principal escolhida por qualidade.
- Duplicatas visuais devem ser consolidadas, priorizando a versão de melhor resolução/qualidade.

## Desenvolvimento

A primeira versão entrega a experiência visual e a estrutura de dados local/mock. A camada de ingestão e publicação do acervo será adicionada em seguida.
