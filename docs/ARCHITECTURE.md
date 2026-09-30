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

## Galerias extensas

Um personagem pode ter dezenas ou centenas de imagens sem que a tela principal receba todas elas.

- A grade da galeria usa páginas de 12 imagens.
- A interface trabalha com índice de página e permite acesso aleatório a qualquer página, inclusive início e fim.
- O cliente de API converte esse índice para o cursor já aceito pelo Worker; o contrato HTTP continua único.
- O frontend mantém cache curto e limitado de páginas de metadados já consultadas.
- Apenas o JSON da próxima página pode ser antecipado; imagens escondidas continuam `lazy` e não são pré-baixadas.
- A variante `card` é usada na grade e no destaque da capa; a variante `detail` só é solicitada ao ampliar a imagem.
- A interface mostra posição global, por exemplo `25–36 de 87`, e não apenas “página 3”.
- Navegação por teclado na galeria: `PageUp`/`PageDown` entre páginas e `Home`/`End` para primeira/última página.

Essa separação evita transformar um personagem com muitas vistas em uma página pesada e mantém previsível o custo de mídia.

## Estado público e histórico local

O estado de descoberta faz parte da URL pública do catálogo:

- `categoria` identifica o recorte de categoria;
- `franquia` identifica a franquia;
- `q` preserva o termo de busca;
- `#modelo=...` identifica um modelo específico.

Isso permite compartilhar um recorte ou modelo sem criar rotas estáticas para cada combinação e sem carregar dados adicionais. No modo LIVE, uma busca recebida pela URL já inicia o runtime filtrado, evitando uma consulta intermediária sem filtro.

Favoritos, lista de orçamento ainda não enviada e até 12 modelos vistos recentemente ficam em `localStorage`. Esses dados são locais ao navegador e não exigem login. Dados locais inválidos ou corrompidos devem ser ignorados com segurança, nunca impedir a abertura do catálogo.

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

O cliente monta uma lista de interesse e envia um formulário. Nenhum número de WhatsApp é necessário. O backend grava a solicitação, gera um protocolo público separado do UUID interno e poderá enviar notificação/e-mail para a administração.
