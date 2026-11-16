# The Weight of the Crown

Módulo independente de administração de reinos para **Pathfinder 2e**, em português, para Foundry VTT.

## Instalação no Sqyre / Foundry

Use o endereço abaixo na instalação por **Manifest URL**:

```text
https://github.com/No991-GDEV/weight-of-the-crown/releases/latest/download/module.json
```

O manifesto aponta para o ZIP da versão publicada. Depois de instalar, ative **The Weight of the Crown** na administração de módulos do mundo PF2e.

- [Baixar o módulo](https://github.com/No991-GDEV/weight-of-the-crown/releases/latest/download/weight-of-the-crown.zip)
- [Versões publicadas](https://github.com/No991-GDEV/weight-of-the-crown/releases)

**Versão 0.11.0:** validada em Foundry **14.367** e PF2e **8.6.0**. O manifesto mantém os limites declarados de Foundry 14.365–14.367 e PF2e 8.4.0–8.6.0; os alvos anteriores não foram testados.

## Recursos

- Ficha de reino com atributos, perícias, recursos, calendário semanal e estações.
- Criação guiada, Carta, Heartland, Governo e progressão do reino.
- Cargos e responsáveis vinculados a personagens/NPCs por arrastar e soltar.
- Quests e construções recolhíveis, duração, repetição, recursos positivos/negativos e efeitos configurados pelo Mestre.
- Biblioteca de 17 talentos adaptados e modificadores no diálogo nativo PF2e.
- Administração de tropas por referência a Actors army do PF2e, táticas e treino.
- Histórico e notas do Mestre em diário separado; importação/exportação JSON pelo menu da ficha.
- Operações pendentes retomáveis, sem repetir cobrança ou dado de talento.

Abra **Atores → Reinos · The Weight of the Crown**. O Mestre cria o reino e concede as permissões desejadas aos jogadores.

## Quests e conclusões

O editor possui textos separados para Sucesso crítico, Sucesso, Falha e Falha crítica. Ao concluir, o Mestre escolhe o resultado: Concluídas mostra o grau e somente o relato correspondente. O texto fica registrado naquela execução; editar a definição depois não reescreve o histórico. Alterar resultado permite corrigir uma conclusão sem repetir recursos ou tempo.

Cada personagem/NPC pode ter até duas Quests abertas por reino. Pendentes e em andamento contam; concluídas, construções e cargos não contam. Jogadores podem arrastar os Actors que controlam para os slots no resumo, inclusive com permissão de observador do reino. O retrato e a contagem de vagas ficam à esquerda da CD. A autoatribuição não concede acesso aos demais campos do reino.

Quests anteriores sem grau aparecem como Resultado não informado. O Mestre pode preencher os quatro textos e usar Alterar resultado para registrar o grau. Ao repetir uma Quest, a execução anterior permanece em Concluídas.

## Versão 0.11.0 — Táticas e Hero Points

O formulário **Aprender tática** mostra a descrição completa do Item original Kingmaker do PF2e, filtrado para a tropa correspondente. A troca de seleção atualiza a consulta na mesma janela, sem copiar descrições para outra base, aprender uma tática ou cobrar Comida. Modificadores estruturados disponíveis aparecem junto do texto. A confirmação aguarda o carregamento, e o registro é conferido novamente antes do treino.

Jogadores com **OWNER no reino** também confirmam treinos e o consumo de Comida. Observadores usam **Consultar táticas**, em modo de leitura, desde que possam visualizar a ficha militar. Criação e edição administrativa das tropas continuam com o Mestre.

A barra lateral oferece **Kingdom Hero Points**, reserva independente dos personagens e dos recursos armazenados. Só o Mestre adiciona e gasta pontos, com sincronização, histórico e persistência no JSON do reino. Valores são inteiros não negativos, sem teto de regra; cliques repetidos e comandos com saldo desatualizado não duplicam operações. Fichas antigas mostram 0 sem gravação automática durante a leitura. Não altera Hero Points de personagens nem acrescenta rerrolagens automáticas.

Validação: **266 testes automatizados** e **10 cenários no Foundry 14.367 / PF2e 8.6.0**, incluindo treino confirmado por jogador, consulta de observador, sincronização e reinício real do servidor. Reinos existentes preservados.

## Versão 0.10.0 — Armazéns e limite de reservas

O Mestre pode configurar **Limite de reservas** como alvo de um efeito do reino ou de **Efeitos ao concluir** de uma construção/Quest. Exemplo: um Armazém com modificador **+10** amplia a capacidade em 10 ao ser concluído, sem gerar recursos. O teto passa a **5 × nível + ajustes ativos**, mínimo 0. Ajustes distintos somam, independentemente do tipo de teste, e a mesma origem nunca duplica.

O ícone de armazém junto ao contador abre os efeitos do reino; passar o ponteiro sobre o contador mostra a base e as origens. Se um efeito expirar ou uma obra voltar a pendente, os recursos são preservados e o excesso é sinalizado, bloqueando novas entradas até resolver a situação. Uma conclusão com ampliação e recursos usa o novo teto na mesma operação, sem aplicação parcial. Os ajustes aceitam inteiros de −100 a +100 por efeito.

Os efeitos sazonais seguem a estação ativa e os efeitos de talentos exigem uma escolha disponível no nível atual. Ajustes de reserva não entram no diálogo de rolagem. Jogadores visualizam o teto, e só o Mestre administra os efeitos.

Validação: **245 testes automatizados** e **8 cenários adicionais no cliente Foundry 14.367 / PF2e 8.6.0**, incluindo persistência, soma de origens, permissões e preservação dos reinos existentes.

## Versões anteriores

Corrige sincronização de consumo e nome das tropas, retomada de publicação/exclusão, recibos de treino e reassociação de fichas órfãs. A melhor contribuição de construção acompanha a ativação dos talentos no diálogo de rolagem. Jogadores usam Progressão para melhorar perícias. Atualizações passivas preservam o foco das janelas e pedidos RPC expirados são limpos sem reproduzir comandos antigos.

A versão 0.9.0 foi validada com 232 testes automatizados e 13 cenários no cliente Foundry.

Finalize operações pendentes antes de transportar o JSON da ficha para outro mundo; os recibos são documentos do mundo de origem. Notas do Mestre têm a proteção normal da interface do Foundry, conforme a configuração deste projeto.

## Desenvolvimento

```sh
npm ci
npm test
python tools/package-release.py
```

O código-fonte está em `src/`; o JavaScript compilado, em `scripts/`. O pacote de instalação é gerado em `dist/`. O empacotador usa uma lista explícita de arquivos do módulo.

A publicação contém somente o módulo e seus testes. Foundry VTT, o sistema PF2e, o Kingmaker comercial, mundos e dados de campanha não fazem parte do pacote. Referências técnicas e procedência estão em [PROCEDENCIA.md](PROCEDENCIA.md).
