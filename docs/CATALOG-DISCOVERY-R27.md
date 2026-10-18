# R27 — Descoberta de modelos sem resultados obsoletos

## Problema observado

O navegador de milhares de modelos exibia temporariamente os resultados de um termo anterior após a pessoa modificar a busca ou a categoria. Como o debounce atualiza `loading` apenas após 220 ms, Enter podia selecionar o primeiro resultado antigo. Erros e indicação de truncamento também podiam refletir a pesquisa anterior.

## Contrato de UI implementado

- Cada resposta remota pertence ao par canônico `[categoria,termo.trim()]` serializado; modelo, franquia, erro e truncamento são **um único snapshot**, sem estados paralelos ou dados inventados.
- Quando o termo ou categoria muda, a UI marca o resultado como pendente **imediatamente**, antes dos 220 ms de debounce. Mostra o estado de busca em vez de um modelo antigo.
- Enter só abre um modelo/franquia após conclusão da consulta **da chave atual**. Durante carregamento, erro ou termo curto, não navega.
- Mudança rápida cancela a atualização das promessas antigas no `useEffect`, inclusive após resposta fora de ordem.
- Modo demo continua independente, alimentado pelo mesmo mock já existente; não há inventário/índice adicional, nem alteração nas APIs.
- A seleção do modelo continua sendo responsabilidade do hash já existente; nada passa a persistir localmente.

## Validação

`npm run test:catalog-home` inclui `tools/test_explorer_discovery.mjs` para testar isolamento por categoria/termo, resultado em debounce, erro/truncamento e equivalência de espaços. A CI executa também TypeScript, build e auditoria visual responsiva.

A etapa não depende da quota Cloudflare D1: usa apenas código do frontend e o contrato existente do backend. Administração privada de orçamentos continua não montada.
