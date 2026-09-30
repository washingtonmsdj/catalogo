# Arquitetura do Catálogo Tonecos Studios

## Escala alvo

O projeto deve suportar 100.000+ modelos e centenas de milhares/milhões de arquivos de imagem sem colocar o acervo dentro do repositório Git.

## Entidades

### Modelo
Um modelo representa um personagem/peça vendável. Ele possui nome, franquia, categoria, código estável, tags, atributos e uma galeria própria.

### Imagem
Cada modelo pode possuir dezenas de imagens. As imagens ficam em object storage/CDN e o banco guarda somente metadados e URLs/keys.

Campos mínimos futuros: `id`, `model_id`, `sha256`, `phash`, `width`, `height`, `bytes`, `mime`, `role`, `quality_score`, `storage_key`, `created_at`.

## Duplicatas e qualidade

1. SHA-256 detecta duplicatas binárias exatas.
2. pHash/dHash detecta imagens visualmente iguais mesmo com compressão, recorte leve ou formato diferente.
3. Duplicatas não devem aparecer repetidas para o cliente.
4. Dentro de um grupo de duplicatas, a versão principal é escolhida por qualidade: resolução útil, integridade, nitidez, ausência de artefatos e tamanho coerente.
5. O original de melhor qualidade é preservado; o site entrega variantes web otimizadas.

A regra do produto é: **se duas imagens representam a mesma vista, priorizar a de melhor qualidade**.

## Imagens publicadas

O navegador nunca deve baixar o original de produção na grade. Gerar variantes como:

- thumb: 240–360 px
- card: 640–800 px
- detail: 1200–1600 px
- original: preservado fora da grade pública

Preferir AVIF/WebP quando suportado, mantendo dimensões e metadados do original no banco.

## Busca e navegação

A experiência visual imita um seletor de personagens de fliperama, mas tecnicamente funciona com paginação/cursor. Nunca renderizar 100.000 cards no DOM.

Fluxo:

`Categoria -> Franquia -> Personagem/Modelo -> Galeria de imagens`

Cada resposta da API deve retornar apenas uma página de modelos e os metadados necessários para a tela atual.

## Stack planejada

- Frontend: React + TypeScript + Vite
- Hosting: Cloudflare
- API: Cloudflare Workers
- Banco: D1 inicialmente, com camada de repositório para permitir migração se a escala exigir
- Imagens: Cloudflare R2 + CDN
- Proteção de formulários: Turnstile
- Login: camada de autenticação desacoplada do catálogo público

## Repositório

O GitHub armazena código, testes, documentação e dados de demonstração. Não armazenar o acervo de 100 mil+ imagens no Git.

## Orçamento

O cliente monta uma lista de interesse e envia um formulário. Nenhum número de WhatsApp é necessário. O backend futuro grava a solicitação e envia notificação/e-mail para a administração.
