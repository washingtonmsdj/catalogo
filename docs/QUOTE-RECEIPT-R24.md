# R24 — Continuidade comercial: comprovante do último orçamento

## Estado efetivamente comprovado

O POST /api/quotes já usa validação Turnstile, resolve os modelos públicos e grava o orçamento e seus itens no D1. Sua resposta contém um protocolo e o status **técnico** \`received\`. Esse status indica apenas registro no backend. **Não indica que o lojista leu, orçou, respondeu, ou enviou e-mail**.

## Entrega R24

Após **somente** uma resposta real válida (\`mode=live\` e protocolo TCS-...), o navegador guarda em \`tonecos:last-live-quote-receipt\` um registro com \`version:1\`, protocolo, número de modelos e data de recebimento. Não armazena nome, e-mail, telefone, anotações, token Turnstile ou IDs dos modelos nesse registro.

Em "Minha lista", o cliente pode consultar novamente o comprovante mesmo depois de atualizar a página, ou apagá-lo localmente. Se o navegador bloquear o armazenamento, a confirmação continua visível e avisa para anotar o protocolo. Falha de envio mantém a seleção intacta. Pedidos fictícios do build demo nunca geram comprovante persistente real.

## Confirmação fail-closed na interface

O serviço público de orçamento só apresenta **Solicitação registrada** após HTTP de sucesso **e** JSON com `status: received` e protocolo exato `TCS-` + cinco blocos de quatro caracteres hexadecimais. A validação é compartilhada com `quoteReceipt.ts`, única fonte da sintaxe do comprovante. Ausência de status, resposta inválida, referência demo, protocolo malformado ou falha de comunicação não limpam a seleção nem geram comprovante de produção. Um HTTP 2xx isolado não prova que o backend registrou o pedido.

No modo demonstração, o código de exemplo deve ser identificado explicitamente como ilustrativo, jamais como confirmação de produção. O CI verifica ambos os contratos sem enviar orçamentos nem acessar D1.

## Envio atômico e preservação da seleção

A interface possui um bloqueio síncrono de envio em andamento, além do estado visual do botão: dois eventos `submit` no mesmo ciclo do React não produzem duas solicitações. Enquanto há requisição pendente, o formulário informa `aria-busy`, desabilita edição e remoção de modelos e impede fechamento do modal por clique ou Escape. O payload sempre utiliza uma cópia imutável da seleção na hora do envio.

A requisição possui um prazo máximo de 20 segundos para não manter o formulário bloqueado indefinidamente por falha de rede. Em falha, expiração desse prazo ou resposta inconclusiva, a seleção permanece intacta, o bloqueio é liberado para uma nova decisão consciente do visitante e a interface orienta a não reenviar repetidamente, pois o servidor pode ter recebido um pedido cuja resposta se perdeu. Após confirmação **live** válida, somente os IDs realmente enviados são retirados da lista, preservando qualquer outro item que tenha entrado por atualização concorrente. Essa proteção da interface complementa, mas não substitui, a deduplicação real do Worker. O teste de navegador utiliza exclusivamente o build demo isolado: simula uma falha e dois eventos de envio no mesmo ciclo, sem contato com a API nem gravação de orçamento de produção.

## Limites explícitos

Essa etapa **não cria** caixa de entrada do lojista nem status de atendimento, autenticação administrativa, notificações, consulta pública por protocolo ou confirmação automática por e-mail. Essas capacidades precisam de autorização, privacidade e operação definidas antes de serem publicadas. O CI protege o contrato de privacidade e o isolamento entre demo e produção.
