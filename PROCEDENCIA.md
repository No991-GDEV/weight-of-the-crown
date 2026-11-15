# Procedência técnica

Implementação do protótipo criada neste projeto, sob autorização F5-001 e decisões da Fase 4. Reuso pertinente para uso pessoal é permitido por 97B; nesta entrega não foi necessário incorporar arquivos do Tools, imagens, texturas ou fontes de terceiros.

- Kingmaker Tools: referência de organização de janela, abas e resumo lateral. Repositório BernhardPosselt/pf2e-kingmaker-tools, revisão consultada 78708c750d8f308e7b28263a8eb05caa33772934.
- PF2e 8.4.0: referência de paleta, template e estrutura de reino. Cores bordô #5e0000, azul #171f69, dourado #e9d7a1 e fundo #f8f4f1; desenho e CSS próprios, sem assets copiados.
- Foundry v14: API ApplicationV2, HandlebarsApplicationMixin, DialogV2, Actor, JournalEntry/Page e Roll. Contratos também conferidos nos fontes da instalação local 14.367 durante os ensaios; sem redistribuir arquivos do aplicativo.
- Desenvolvimento: TypeScript 5.9.3 e Handlebars 4.7.9, registrados no package-lock. Os pacotes npm não entram no ZIP de instalação; o Handlebars de execução é fornecido pelo Foundry.

Este pacote é para uso pessoal na mesa. Não contém PF2e, o Foundry, licenças de software, dados de campanha, cookies de sessão ou as cópias de segurança dos mundos.


## Revisão UI 0.2.0

Referências de interação consultadas novamente em 14/11/2026:

- PF2e 8.6.0: https://github.com/foundryvtt/pf2e/blob/pf2e-8.6.0/src/module/actor/party/kingdom/sheet.ts e https://github.com/foundryvtt/pf2e/blob/pf2e-8.6.0/static/templates/actors/party/kingdom/tabs/main.hbs — slots de líder com UUID, retrato, abertura e remoção; o teste continua do reino.
- Tools: https://github.com/BernhardPosselt/pf2e-kingmaker-tools/blob/78708c750d8f308e7b28263a8eb05caa33772934/src/jsMain/resources/applications/kingdom/sections/character-sheet/creation.hbs e KingdomSheet.kt em src/jsMain/kotlin/at/posselt/pfrpg2e/kingdom/sheet — alvos de drop por função, UUID persistente, abrir/limpar Actor.
- Foundry v14 TextEditor.getDragEventData e Actor.fromDropData: payload nativo de arrastar e soltar.

Aplicado o padrão de vínculo por atividade e construção, com código e estilos do projeto. Não foram importados cargos, Invested/Vacancy ou bônus pessoais de Kingmaker. Nenhum arquivo de arte ou fonte da referência foi incorporado.


## Parte 1 — Cargos, 0.3.0

Implementação própria baseada na especificação anexada pelo usuário (Texto colado.txt, attachment 867422e2-28ec-4f3d-adf2-70b794e591be, referida como kingdom.md) e nas aprovações F5-008/F5-009. Reutiliza os slots UUID, APIs nativas e estilo já documentados acima. A vacância agora é automática por autorização explícita; a afirmação histórica da revisão 0.2.0 sobre ausência de vacância não descreve a 0.3.0. Nenhum código, arte ou regra adicional de módulos externos foi incorporado nesta parte.


## Partes 2–5 — 0.4.0

Implementação própria da especificação anexada e autorização para os quatro prompts restantes (F5-011). O teto global substitui o armazém separado por escolha expressa F5-012. Não foi copiado catálogo de talentos, arte ou código de outro módulo.

Integração conferida no PF2e 8.6.0 instalado e nas fontes primárias da mesma tag:

- [Check.roll](https://github.com/foundryvtt/pf2e/blob/pf2e-8.6.0/src/module/system/check/check.ts): diálogo, graus, Fortuna/Infortúnio, visibilidade e mensagem única.
- [CheckModifiersDialog](https://github.com/foundryvtt/pf2e/blob/pf2e-8.6.0/src/module/system/check/dialog.ts): contexto público e hook de renderização; extensão restrita aos testes iniciados pelo módulo.
- [Modifier e CheckModifier](https://github.com/foundryvtt/pf2e/blob/pf2e-8.6.0/src/module/actor/modifiers.ts): construtores expostos em game.pf2e, tipos e empilhamento.
- Foundry 14.367 local: backend cliente em client/data/client-backend.mjs confirma userId no evento de atualização; Users/getDesignatedUser e User.update foram conferidos. A implementação não usa socket com remetente declarado pelo solicitante. Usa documentos e APIs públicas do Foundry.

A janela PF2e recebe apenas estilo e um campo de CD, com os controles administrados protegidos para jogadores; não foi substituída sua classe nem seu motor de rolagem. Os estilos são do projeto.


## Expansão 0.5.0 — Origem e cadastro militar

Fontes solicitadas pelo usuário e consultadas em 14/11/2026:

- [Carta / Charter](https://2e.aonprd.com/Rules.aspx?ID=1749): opções e aumentos/limitação.
- [Heartland](https://2e.aonprd.com/Rules.aspx?ID=1750): quatro categorias de território e aumento associado.
- [Governo](https://2e.aonprd.com/Rules.aspx?ID=1751): seis opções, atributos, perícias e talento.
- Talentos: [Crush Dissent](https://2e.aonprd.com/Feats.aspx?ID=3910), [Fortified Fiefs](https://2e.aonprd.com/Feats.aspx?ID=3913), [Insider Trading](https://2e.aonprd.com/Feats.aspx?ID=3915), [Pull Together](https://2e.aonprd.com/Feats.aspx?ID=3921), [Practical Magic](https://2e.aonprd.com/Feats.aspx?ID=3920), [Muddle Through](https://2e.aonprd.com/Feats.aspx?ID=3919).

Adaptação dos quatro atributos oficiais aos cinco do projeto e composição aprovadas em F5-014/F5-015. Os textos são resumos próprios; não se reproduz a ambientação das páginas. Mecânicas ausentes permanecem para adaptação do Mestre; não há conversão de dados de recursos em Tesouro ou implementação fictícia de Ruína/Inquietação. O +1 de Magia prática usa o efeito reconhecido do módulo.

A aba militar implementa a administração simples aprovada em ARMY-001 a ARMY-004, sem incorporar combate de massas, arte, código ou packs externos. População e sobreviventes de Arx não foram inferidos. Interface, assistente e automações são código próprio.


## Talentos e referência militar — 0.6.0

Catálogo de 17 talentos, seis adaptações diretas e onze aprovadas expressamente pelo usuário; textos e fontes individuais no catálogo documental v0.2.0 e em src/feat-catalog.ts. Implementação própria, baseada no sistema de modificadores do PF2e e documentos do Foundry 14.367. Flags auxiliares de uso não guardam os números de testes privados. A renderização de ajustes usa o hook renderChatMessageHTML do Foundry 14.

O usuário forneceu pf2e-kingmaker 2.3.1 em pasta local. Foi consultada uma cópia de leitura do compêndio Adventure, que contém 11 Actors do tipo army. Campos conferidos: tipo, nível, CA, PV/debandada, reconhecimento, Manobra/Moral, consumo, armas, potência, munição e poções. Esses Actors especiais não foram tratados como tabela universal de tropas básicas. Nenhum código, arte, mapa, áudio ou compêndio desse módulo é incluído no pacote The Weight of the Crown; o módulo continua independente, exigindo apenas PF2e.


## Tropas 0.7.0

Inspecionados ArmyPF2e, templates/actors/army/sheet.hbs e o modelo army do PF2e 8.6.0 instalado. Integração usa Actor army, campaignFeature com category army-tactic, effect com FlatModifier e compêndio pf2e.kingmaker-features. Não redistribui pacotes ou imagens do Kingmaker pago. As táticas são copiadas do sistema instalado somente para o mundo do usuário ao confirmar o treino. Arquearia reutiliza o tipo nativo infantry, identificado separadamente no cadastro do módulo. A pasta exclusiva e os Actors possuem marcadores próprios de propriedade do módulo.
