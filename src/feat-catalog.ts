import type { KingdomFeat } from "./management.js";
import type { SkillId, AbilityId } from "./core.js";
export const CATALOG_VERSION = "1.1";
export const CATALOG_TAGS = [
  {id:"leadership",label:"Nomeação / reorganização de liderança"}, {id:"fealty",label:"Juramento de lealdade política"},
  {id:"internal_conflict",label:"Evento perigoso de conflito interno"}, {id:"fortification",label:"Fortificação / estrutura militar elegível"},
  {id:"defense_event",label:"Evento perigoso contra defesas do assentamento"}, {id:"work_site",label:"Estabelecer local de trabalho"},
  {id:"trade_agreement",label:"Estabelecer acordo comercial"}, {id:"commodities",label:"Negociar mercadorias"},
  {id:"commercial",label:"Quest comercial (recompensa de Informações privilegiadas)"}, {id:"civil_maintenance",label:"Manutenção preventiva / pequenos reparos civis"},
  {id:"cultural_relief",label:"Artes / entretenimento contra crise interna"}, {id:"end_harmful_event",label:"Encerrar evento nocivo em curso"},
  {id:"civil_supplies",label:"Obter bens de consumo / suprimentos civis"}
] as const;
export type CatalogTag = typeof CATALOG_TAGS[number]["id"];
export const CATALOG_DATA = [
  {
    "key": "T01",
    "id": "kingdom_civil_service",
    "name": "Serviço público",
    "level": 1,
    "rule": "Ao escolher, indique um cargo do reino. A penalidade de vacância desse cargo deixa de se aplicar enquanto o talento estiver ativo; outras vacâncias permanecem. Concede +2 de estado em testes das Quests específicas de reorganização/nomeação de liderança. Para trocar o cargo protegido, realize uma atividade de reorganização de liderança na abertura semanal, definida pelo Mestre. O talento não exige teste em toda nomeação comum, não preenche o cargo e não concede os efeitos de ocupação.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3908",
    "skill": null,
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T02",
    "id": "kingdom_cooperative_leadership",
    "name": "Liderança cooperativa",
    "level": 1,
    "rule": "Quando um líder do conselho usa a ação Aid pessoal para ajudar outro líder numa atividade do reino, aumente em +1 apenas o bônus positivo concedido. Assim, sucesso +1 passa a +2; crítico +2/+3/+4 passa a +3/+4/+5 conforme a proficiência pessoal. Falha continua 0 e falha crítica continua −1. O ajuste integra o próprio bônus de Aid, não uma origem somada à parte. Entre ajudantes, permanece o maior bônus e a pior penalidade. Preparação e disponibilidade semanal continuam exigidas. Não há melhoria automática de graus no nível 11.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3909",
    "skill": null,
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T03",
    "id": "origin_crush_dissent",
    "name": "Reprimir dissidência",
    "level": 1,
    "rule": "Concede +1 de estado nos testes para resolver eventos perigosos de conflito interno. Uma vez por semana, quando esse conflito fosse impor um novo efeito de crise com penalidade numérica em testes, pode tentar Guerra contra a CD definida pelo Mestre. Sucesso ou crítico cancela esse efeito; falha o mantém; falha crítica dobra apenas o valor da penalidade, com a duração original. O Mestre identifica o efeito elegível antes do teste. Não altera apoio político, mortes, perdas já ocorridas, custos ou recursos. Não cria Inquietação.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3910",
    "skill": "skill_warfare",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T04",
    "id": "origin_fortified_fiefs",
    "name": "Feudos fortificados",
    "level": 1,
    "rule": "Concede +2 de circunstância nos testes de Quests/etapas para fortificar território ou construir/reparar quartel, castelo, guarnição, fortaleza e muralha de pedra ou madeira. Concede +1 de estado nos testes de eventos perigosos que atinjam diretamente as defesas dos assentamentos. O Mestre identifica as definições elegíveis. O benefício atua no teste da obra/atividade, não melhora permanentemente o bônus que a construção concede depois. Não reduz custos, cria hexágonos ou altera combate militar.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3913",
    "skill": "skill_defense",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T05",
    "id": "origin_insider_trading",
    "name": "Informações privilegiadas",
    "level": 1,
    "rule": "Concede +1 de estado nos testes de Quests para estabelecer locais de trabalho, firmar acordos comerciais ou negociar mercadorias. A primeira Quest comercial concluída com sucesso em cada semana concede +1 Tesouro, respeitando o teto de reservas e a informação dos estoques. Não recebe por cada rolagem ou etapa, nem por Quest fracassada. Não há renda passiva universal nem conversão de dado de recursos em Tesouro. A classificação comercial e a condição de sucesso pertencem à definição do Mestre.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3915",
    "skill": "skill_industry",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T06",
    "id": "kingdom_assurance",
    "name": "Garantia do reino",
    "level": 1,
    "rule": "Escolha uma perícia treinada do reino. Uma vez por semana para essa escolha, antes de rolar, pode substituir o teste por 10 + a proficiência do reino nessa perícia. Não soma atributo, adequação, Aid, cargos, talentos, construções, estação ou qualquer outro bônus/penalidade. Requisitos, responsáveis, meios e custos da atividade continuam exigidos. Compare o total com a CD normalmente, sem ajustes de 20/1 natural porque não houve d20. Possui Fortuna. Pode escolher novamente para outra perícia, nunca repetir a mesma. Não garante sucesso.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3917",
    "skill": null,
    "ability": null,
    "repeatable": true
  },
  {
    "key": "T07",
    "id": "origin_muddle_through",
    "name": "Improvisação coletiva",
    "level": 1,
    "rule": "Concede +2 de circunstância nos testes de Quests de manutenção preventiva e pequenos reparos civis, identificadas pelo Mestre. Tempo, responsáveis, recursos, custos e requisitos continuam normais. Não concede reparos gratuitos, recuperação de tropas, provisões ou frentes extras; não reduz consumo.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3919",
    "skill": "skill_wilderness",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T08",
    "id": "origin_practical_magic",
    "name": "Magia prática",
    "level": 1,
    "rule": "Concede +1 de estado em testes de Magia do reino. Pode usar Magia no lugar de Engenharia nas atividades correspondentes, usando a proficiência e os modificadores válidos de Magia. Não soma também o bônus completo de Engenharia. Mantém requisitos materiais e narrativos da atividade.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3920",
    "skill": "skill_magic",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T09",
    "id": "origin_pull_together",
    "name": "União de esforços",
    "level": 1,
    "rule": "Uma vez por semana, após obter falha crítica em teste de perícia do reino, pode tentar um teste simples, sem modificadores, inicialmente CD 11. Sucesso transforma somente essa falha crítica em falha. Cada utilização posterior aumenta a CD em 5; cada semana sem usar reduz a CD em 1, mínimo 11. Registre uso e CD. Não transforma falha em sucesso, não exige outra frente nem altera resultados anteriores já resolvidos.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3921",
    "skill": "skill_politics",
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T10",
    "id": "kingdom_skill_training",
    "name": "Treinamento em perícia",
    "level": 1,
    "rule": "Escolha uma das 16 perícias em que o reino está destreinado: ela passa a treinada. Pode escolher este talento novamente, sempre para outra perícia ainda destreinada. Não aumenta uma treinada para especialista. O treino é adicional aos seis iniciais e aos dois treinos governamentais que já integram esses seis; não consome outro aumento de perícia. Não altera a distribuição inicial registrada. Graus avançados continuam seguindo a progressão normal.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3924",
    "skill": null,
    "ability": null,
    "repeatable": true
  },
  {
    "key": "T11",
    "id": "kingdom_endure_anarchy",
    "name": "Resistir à anarquia",
    "level": 3,
    "rule": "Uma vez por semana, antes de rolar um teste do reino, pode escolher e ignorar a penalidade numérica de um efeito de agitação interna nesse único teste. O efeito continua existindo, com sua duração e demais consequências. Outras penalidades não são canceladas. Não ignora vacância comum, inverno, fome ou custo de atividade por serem problemas diferentes; precisa ser um efeito identificado de agitação interna. Não cria Inquietação nem um limite de anarquia.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3911",
    "skill": null,
    "ability": "ability_community",
    "repeatable": false
  },
  {
    "key": "T12",
    "id": "kingdom_inspiring_entertainment",
    "name": "Entretenimento inspirador",
    "level": 3,
    "rule": "Concede +2 de estado em Artes nas Quests que usam arte, festivais ou entretenimento para enfrentar crises internas. O Mestre identifica a adequação desse caminho à crise. Custos, meios e disponibilidade continuam exigidos. Não dá +2 em todas as perícias de Comunidade, não altera apoio político automaticamente e não usa Inquietação.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3916",
    "skill": null,
    "ability": "ability_community",
    "repeatable": false
  },
  {
    "key": "T13",
    "id": "kingdom_liquidate_resources",
    "name": "Liquidar recursos",
    "level": 3,
    "rule": "Uma vez por semana, pode reduzir em 1 Tesouro uma despesa extraordinária imposta por falha ou evento, com mínimo 0. Não reduz a parte planejada do orçamento, materiais, Comida ou manutenção universal. Não gera Tesouro, não permite começar ações sem a reserva exigida e não cria empréstimo ou dívida. A despesa precisa ser identificada como extraordinária pelo Mestre.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3918",
    "skill": null,
    "ability": "ability_economy",
    "repeatable": false
  },
  {
    "key": "T14",
    "id": "kingdom_quick_recovery",
    "name": "Recuperação rápida",
    "level": 3,
    "rule": "Concede +4 de estado em testes do reino feitos para encerrar um evento nocivo ainda em curso, representado por uma crise/efeito definido pelo Mestre. Não é um bônus a qualquer atividade de reparo depois que o evento terminou, nem cura automática de soldados. Não encerra estações normais como o inverno. Mantém custos e requisitos da resolução.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3923",
    "skill": null,
    "ability": "ability_defense",
    "repeatable": false
  },
  {
    "key": "T15",
    "id": "kingdom_free_and_fair",
    "name": "Livre e justo",
    "level": 7,
    "rule": "Concede +2 de circunstância nos testes das Quests de nomeação/troca de liderança ou obtenção de lealdade política, inclusive quando usarem Política/Governo. Uma vez por semana, após falha ou falha crítica nesse teste, pode pagar 1 Tesouro para rerrolar sem esse +2. É Fortuna; deve aceitar o segundo resultado, mesmo pior. O pagamento é adicional e exige Tesouro disponível. Não torna nomeações simples testes obrigatórios, não melhora toda diplomacia nem concede apoio político automático.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3914",
    "skill": null,
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T16",
    "id": "kingdom_quality_of_life",
    "name": "Qualidade de vida",
    "level": 7,
    "rule": "Concede +2 de estado em Comércio nas Quests para obter bens de consumo e suprimentos civis, identificadas pelo Mestre. Custos, quantidades, responsáveis e requisitos continuam normais. Não cria Luxos, nível de mercado, itens mágicos gratuitos ou renda passiva. Não reduz o consumo de Comida.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3922",
    "skill": null,
    "ability": null,
    "repeatable": false
  },
  {
    "key": "T17",
    "id": "kingdom_fame_and_fortune",
    "name": "Fama e fortuna",
    "level": 11,
    "rule": "A primeira Quest real concluída em cada semana cujo teste decisivo tenha sido sucesso crítico gera direito a receber +2 Tesouro no início da semana seguinte, respeitando o teto e a informação das reservas. O Mestre identifica a Quest e seu teste decisivo. Não recebe por testes avulsos, Aid, repetição do mesmo resultado ou cada etapa de uma mesma conclusão. Não entrega o Tesouro antecipadamente para financiar atividades da semana atual. Não converte dado de recursos numa taxa universal.",
    "source": "https://2e.aonprd.com/Feats.aspx?ID=3912",
    "skill": null,
    "ability": null,
    "repeatable": false
  }
] as const;
export type CatalogKey = typeof CATALOG_DATA[number]["key"];
export function catalogKey(id: string | undefined): CatalogKey | null { return CATALOG_DATA.find(f=>f.id===id)?.key ?? null; }
export function catalogFeats(): Record<string, KingdomFeat> {
  return Object.fromEntries(CATALOG_DATA.map(f=>[f.id, {id:f.id,name:f.name,description:f.rule, minimumLevel:f.level,repeatable:f.repeatable,retired:false,
    prerequisites:{feats:[], skills:f.skill?[{id:f.skill as SkillId,rank:1 as const}]:[], abilities:f.ability?[{id:f.ability as AbilityId,minimum:2}]:[]},
    effects:f.key==="T08"?{practical_magic:{id:"practical_magic",name:"Magia prática",description:"+1 de estado em Magia",type:"status" as const,value:1,target:{kind:"skill" as const,id:"skill_magic"},enabled:true}}:{}
  } as KingdomFeat]));
}
