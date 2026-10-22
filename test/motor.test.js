// Confere o motor contra as fórmulas da planilha BZO usada no orçamento atual.
const test = require('node:test');
const assert = require('node:assert');
const Motor = require('../public/js/motor');

const perto = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
const colab = (extra = {}) => ({ id: 1, nome: 'Teste', regional: 'CENTRO OESTE', filial: 'CUIABA', cargo: '14-Operação - Apoio', cc_cod: '17151', salario: 4858.04, mes_inicio: 1, mes_fim: 12, ...extra });
const total = (res, rub, i = 0) => { let s = 0; for (let m = 0; m < 12; m++) s += res.valor(i, Motor.IDX[rub], m); return s; };

test('opção de 11 meses (Rafael de Melo): 11 salários + férias e 1/3 + 13º; encargos sobre salário + grupo OUTROS', () => {
  // Salário 4.858,04 · dissídio 4,22% · periculosidade 30% · insalubridade 0 · HE 193,81 (sem dissídio)
  const c = colab({ salario: 4858.04, excecoes: { horas_extras: { metodo: 'fixo', valor: 193.81, origem: 'base' } } });
  // HE da pessoa (regra da filial que não é "Total da filial")
  const res = Motor.calcular({ colaboradores: [c], filiais: { CUIABA: { dissidio_pct: 4.22, dissidio_mes: 1 } }, premissas: { '*': { horas_extras: { metodo: 'nao', periodo: 'mensal' } } }, mesesSalario: 11 });
  const v = rub => res.valor(0, Motor.IDX[rub], 0);
  const cheio = 5063.049288 + 1518.9147864 + 193.81 * 1.0422; // 6.783,95 = K + L + M + N
  perto(v('salario'), 5063.049288 * 11 / 12);
  perto(v('periculosidade'), 1518.9147864 * 11 / 12);
  perto(v('ferias'), 753.77);                                 // (K+L+M+N)/12 + ((K+L+M+N)/12)/3
  perto(v('decimo'), cheio / 12);
  perto(v('fgts'), cheio * 11 / 12 * 0.08);                   // sobre o que foi pago como salário
  perto(v('inss'), cheio * 11 / 12 * 0.29);
  perto(v('fgts_ferias'), v('ferias') * 0.08);                // o mês de férias entra pelos encargos de férias
  perto(v('inss_ferias'), v('ferias') * 0.29);
  perto(v('fgts_13'), v('decimo') * 0.08);
  // No ano: 11 salários + 1 de férias (com 1/3) + 13º
  perto(total(res, 'salario') + total(res, 'periculosidade') + total(res, 'horas_extras') + total(res, 'ferias'), cheio * (11 + 4 / 3));
});

test('dissídio só a partir do mês da data-base', () => {
  const res = Motor.calcular({ colaboradores: [colab({ salario: 1000 })], filiais: { CUIABA: { dissidio_pct: 10, dissidio_mes: 5 } }, premissas: {}, mesesSalario: 12 });
  perto(res.valor(0, 0, 3), 1000);
  perto(res.valor(0, 0, 4), 1100);
  perto(total(res, 'salario'), 4 * 1000 + 8 * 1100);
});

test('dois dissídios: o do ano anterior vale o ano todo e o do ano entra por cima na data-base (Holding)', () => {
  // Base 10.000 sem o dissídio 2026 (5%); dissídio 2027 de 4,5% em agosto
  const filiais = { CUIABA: { dissidio_ant_pct: 5, dissidio_ant_mes: 1, dissidio_pct: 4.5, dissidio_mes: 8 } };
  const premissas = { '*': { ppr: { metodo: 'multiplo', valor: 1, periodo: 'anual_mes', mes: 3 } } };
  const res = Motor.calcular({ colaboradores: [colab({ salario: 10000 })], filiais, premissas, mesesSalario: 12 });
  perto(res.valor(0, 0, 0), 10500);   // jan: só o de 2026
  perto(res.valor(0, 0, 6), 10500);   // jul
  perto(res.valor(0, 0, 7), 10972.5); // ago: 10.000 × 1,05 × 1,045
  perto(total(res, 'salario'), 7 * 10500 + 5 * 10972.5);
  perto(total(res, 'ppr'), 10972.5);  // PPR sobre o salário com os dois dissídios
  // a data-base de 2026 (ex.: agosto/26) não muda 2027: o dissídio 2026 já vale desde janeiro até a nova data-base
  const ago = Motor.calcular({ colaboradores: [colab({ salario: 13720.34 })], filiais: { CUIABA: { dissidio_ant_pct: 5, dissidio_ant_mes: 8, dissidio_pct: 4.22, dissidio_mes: 8 } }, premissas: {}, mesesSalario: 12 });
  perto(ago.valor(0, 0, 0), 14406.357);       // jan/27 = 13.720,34 × 1,05
  perto(ago.valor(0, 0, 6), 14406.357);       // jul/27
  perto(ago.valor(0, 0, 7), 15014.3053);      // ago/27 = × 1,0422
});

test('reajuste de benefícios em dois anos: o do ano anterior desde janeiro e o do ano por cima', () => {
  const filiais = { CUIABA: { reaj_benef_ant_pct: 4, reaj_benef_ant_mes: 1, reaj_benef_pct: 5, reaj_benef_mes: 8 } };
  const premissas = { '*': { va: { metodo: 'fixo', valor: 803 } } };
  const res = Motor.calcular({ colaboradores: [colab()], filiais, premissas });
  perto(res.valor(0, Motor.IDX.va, 0), 835.12);   // 803 × 1,04
  perto(res.valor(0, Motor.IDX.va, 7), 876.876);  // 803 × 1,04 × 1,05
});

test('promoções e méritos: % da folha em dois meses, somando e ficando no salário dos meses seguintes', () => {
  const premissas = { '*': { promocoes: { metodo: 'pct', valor: 0.4, base: 'folha', inicio: 4, inicio2: 10 }, periculosidade: { metodo: 'nao' }, horas_extras: { metodo: 'nao' } } };
  const res = Motor.calcular({ colaboradores: [colab({ salario: 10000 })], filiais: {}, premissas, mesesSalario: 12 });
  const v = m => res.valor(0, Motor.IDX.promocoes, m);
  perto(v(2), 0);        // mar: ainda não
  perto(v(3), 40);       // abr: 0,40% de 10.000
  perto(v(8), 40);       // set
  perto(v(9), 80);       // out: + 0,40% (0,80% no total)
  perto(v(11), 80);
  perto(res.valor(0, Motor.IDX.fgts, 9), (10000 + 80) * 0.08); // reflexo: FGTS sobre salário + promoção
});

test('provisão de aumento: promoções só em mar e set; nos meses seguintes o aumento vai para o salário da filial', () => {
  const premissas = { '*': { promocoes: { metodo: 'pct', valor: 0.4, base: 'folha', inicio: 3, inicio2: 9, provisao: true }, periculosidade: { metodo: 'nao' }, horas_extras: { metodo: 'nao' } } };
  const colaboradores = [colab({ id: 1, salario: 10000 }), colab({ id: 2, salario: 5000 })];
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas, mesesSalario: 12 });
  perto(res.valor(0, Motor.IDX.promocoes, 2), 0);              // nada no colaborador
  perto(res.valor(0, 0, 3), 10000);                              // salário dele não muda
  assert.strictEqual(res.n, 3);                                  // + 1 linha da filial
  const ag = Motor.agregar(res, () => 'x').get('x');
  const pr = m => ag.porRubrica[Motor.IDX.promocoes * 12 + m];
  const sal = m => ag.porRubrica[m];
  perto(pr(1), 0); perto(pr(2), 60); perto(pr(3), 0); perto(pr(8), 60); perto(pr(9), 0);  // 0,40% de 15.000 em mar e set
  perto(sal(2), 15000); perto(sal(3), 15060); perto(sal(7), 15060); perto(sal(8), 15060); perto(sal(9), 15120);
  perto(ag.porRubrica[Motor.IDX.fgts * 12 + 3], 15060 * 0.08); // reflexo no FGTS
  perto(ag.hc[3], 2);                                            // a linha da filial não conta como pessoa
});

test('rateio do total da filial por headcount e só entre quem recebe', () => {
  const premissas = { CUIABA: { horas_extras: { metodo: 'rateio', valor: 900, rateio: 'hc', periodo: 'mensal', quem: ['cc:17150'] } } };
  const colaboradores = [colab({ id: 1, cc_cod: '17150' }), colab({ id: 2, cc_cod: '17150' }), colab({ id: 3, cc_cod: '22153' })];
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.horas_extras, 0), 450);
  perto(res.valor(2, Motor.IDX.horas_extras, 0), 0);
});

test('vaga entra só a partir do mês de admissão e o rateio se redistribui', () => {
  const premissas = { '*': { horas_extras: { metodo: 'rateio', valor: 1000, periodo: 'mensal' }, va: { metodo: 'fixo', valor: 100 } } };
  const colaboradores = [colab({ id: 1 }), colab({ id: 2, vaga: true, mes_inicio: 7 })];
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.horas_extras, 0), 1000);
  perto(res.valor(0, Motor.IDX.horas_extras, 6), 500);
  perto(total(res, 'va', 1), 600);
});

test('herança: filial > regional > geral > padrão', () => {
  const premissas = { '*': { va: { metodo: 'fixo', valor: 100 } }, 'R:CENTRO OESTE': { va: { metodo: 'fixo', valor: 200 } }, CUIABA: { va: { metodo: 'fixo', valor: 300 } } };
  assert.equal(Motor.premissaDe(premissas, 'CUIABA', 'CENTRO OESTE', 'va').valor, 300);
  assert.equal(Motor.premissaDe(premissas, 'OUTRA', 'CENTRO OESTE', 'va').valor, 200);
  assert.equal(Motor.premissaDe(premissas, 'OUTRA', 'SUL', 'va').valor, 100);
  assert.equal(Motor.premissaDe({}, 'OUTRA', 'SUL', 'periculosidade').valor, 30);
});

test('anual no mês, anual diluído, teto e PPR pela tabela de nível', () => {
  const premissas = { '*': {
    cesta_natalina: { metodo: 'fixo', valor: 274, periodo: 'anual_mes', mes: 12 },
    ppr: { metodo: 'multiplo', valor: 2.4, periodo: 'anual_diluido', por_nivel: true },
    seguro_vida: { metodo: 'pct', valor: 0.282, teto: 10 },
  } };
  const res = Motor.calcular({ colaboradores: [colab({ salario: 1000, cargo: '05-Gerentes' })], filiais: {}, premissas, niveis: { '05-Gerentes': 5 } });
  perto(res.valor(0, Motor.IDX.cesta_natalina, 10), 0);
  perto(res.valor(0, Motor.IDX.cesta_natalina, 11), 274);
  perto(total(res, 'ppr'), 5000);
  perto(res.valor(0, Motor.IDX.seguro_vida, 0), 2.82);
});

test('reajuste de benefícios a partir do mês', () => {
  const res = Motor.calcular({ colaboradores: [colab()], filiais: { CUIABA: { reaj_benef_pct: 10, reaj_benef_mes: 3 } }, premissas: { '*': { va: { metodo: 'fixo', valor: 100 } } } });
  perto(res.valor(0, Motor.IDX.va, 1), 100);
  perto(res.valor(0, Motor.IDX.va, 2), 110);
});

test('horas extras: total do ano da filial vira média mensal igual por colaborador', () => {
  const premissas = { CUIABA: { horas_extras: { metodo: 'rateio', valor: 120000 } } };
  const res = Motor.calcular({ colaboradores: [colab({ id: 1 }), colab({ id: 2, salario: 9000 })], filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.horas_extras, 0), 5000);
  perto(res.valor(1, Motor.IDX.horas_extras, 5), 5000);
  perto(total(res, 'horas_extras', 0) + total(res, 'horas_extras', 1), 120000);
});

test('sucedido com benefício próprio: substitui a regra e sai do rateio', () => {
  const premissas = { '*': { va: { metodo: 'fixo', valor: 1000 }, assist_medica: { metodo: 'rateio', valor: 1200, periodo: 'mensal' }, farmacia: { metodo: 'nao' } } };
  const sucedido = colab({ id: 2, excecoes: { va: { metodo: 'fixo', valor: 1500 }, assist_medica: { metodo: 'fixo', valor: 900 }, farmacia: { metodo: 'fixo', valor: 300 } } });
  const res = Motor.calcular({ colaboradores: [colab({ id: 1 }), sucedido, colab({ id: 3 })], filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.va, 0), 1000);
  perto(res.valor(1, Motor.IDX.va, 0), 1500);
  perto(res.valor(1, Motor.IDX.assist_medica, 0), 900);
  perto(res.valor(0, Motor.IDX.assist_medica, 0), 600);
  perto(res.valor(1, Motor.IDX.farmacia, 0), 300);
  perto(res.valor(0, Motor.IDX.farmacia, 0), 0);
  const semVa = Motor.calcular({ colaboradores: [colab({ excecoes: { va: { metodo: 'nao' } } })], filiais: {}, premissas });
  perto(semVa.valor(0, Motor.IDX.va, 0), 0);
});

test('PPR: tabela de nível da própria regra (Holding) e outra regra nas filiais', () => {
  const premissas = {
    '*': { ppr: { metodo: 'multiplo', valor: 2.4, periodo: 'anual_diluido' } },
    HOLDING: { ppr: { metodo: 'multiplo', valor: 1, periodo: 'anual_diluido', por_nivel: true, niveis: { '09-Administrativo': 1, '08-Especialistas': 2, '05-Gerentes': 5 } } },
  };
  const colaboradores = [
    colab({ id: 1, filial: 'HOLDING', regional: 'SUDESTE', salario: 1000, cargo: '05-Gerentes' }),
    colab({ id: 2, filial: 'HOLDING', regional: 'SUDESTE', salario: 1000, cargo: '15-Operação - Produção' }),
    colab({ id: 3, filial: 'CUIABA', salario: 1000, cargo: '05-Gerentes' }),
  ];
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(total(res, 'ppr', 0), 5000);
  perto(total(res, 'ppr', 1), 1000);
  perto(total(res, 'ppr', 2), 2400);
});

test('PPR = novo salário (com dissídio) × target; sem dissídio fica salário × target', () => {
  const premissas = { '*': { ppr: { metodo: 'multiplo', valor: 2, periodo: 'anual_mes', mes: 3 } } };
  const semDiss = Motor.calcular({ colaboradores: [colab({ salario: 13780 })], filiais: {}, premissas });
  perto(total(semDiss, 'ppr'), 27560);
  // dissídio de 5% em setembro: o PPR (pago em março) já usa o novo salário
  const comDiss = Motor.calcular({ colaboradores: [colab({ salario: 13780 })], filiais: { CUIABA: { dissidio_pct: 5, dissidio_mes: 9 } }, premissas });
  perto(total(comDiss, 'ppr'), 13780 * 1.05 * 2);
  perto(comDiss.valor(0, Motor.IDX.ppr, 2), 13780 * 1.05 * 2);
  const ignorar = Motor.calcular({ colaboradores: [colab({ salario: 13780 })], filiais: { CUIABA: { dissidio_pct: 5, dissidio_mes: 9 } },
    premissas: { '*': { ppr: { metodo: 'multiplo', valor: 2, periodo: 'anual_mes', mes: 3, sem_dissidio: true } } } });
  perto(total(ignorar, 'ppr'), 27560);
});

test('valor diferente em cada mês: por colaborador e total da filial', () => {
  const meses = [0, 500, 0, 0, 1200, 0, 0, 0, 0, 0, 0, 3000];
  const premissas = { '*': {
    endomarketing: { metodo: 'fixo', periodo: 'por_mes', meses },
    treinamento: { metodo: 'rateio', periodo: 'por_mes', meses },
  } };
  const res = Motor.calcular({ colaboradores: [colab({ id: 1 }), colab({ id: 2 })], filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.endomarketing, 1), 500);
  perto(res.valor(0, Motor.IDX.endomarketing, 0), 0);
  perto(total(res, 'endomarketing', 0), 4700);
  perto(res.valor(0, Motor.IDX.treinamento, 11), 1500);
  perto(total(res, 'treinamento', 0) + total(res, 'treinamento', 1), 4700);
});

test('público por sexo: outubro rosa só mulheres, novembro azul só homens', () => {
  const meses = [0, 0, 0, 0, 0, 0, 0, 0, 0, 900, 600, 0];
  const publico_meses = ['', '', '', '', '', '', '', '', '', 'F', 'M', ''];
  const colaboradores = [colab({ id: 1, sexo: 'F' }), colab({ id: 2, sexo: 'F' }), colab({ id: 3, sexo: 'M' }), colab({ id: 4, sexo: '' })];
  const total = Motor.calcular({ colaboradores, filiais: {}, premissas: { '*': { endomarketing: { metodo: 'rateio', periodo: 'por_mes', meses, publico_meses } } } });
  perto(total.valor(0, Motor.IDX.endomarketing, 9), 450);   // outubro: 900 ÷ 2 mulheres
  perto(total.valor(2, Motor.IDX.endomarketing, 9), 0);
  perto(total.valor(2, Motor.IDX.endomarketing, 10), 600);  // novembro: só o homem
  perto(total.valor(3, Motor.IDX.endomarketing, 10), 0);    // sem sexo informado não entra
  const porColab = Motor.calcular({ colaboradores, filiais: {}, premissas: { '*': { endomarketing: { metodo: 'fixo', periodo: 'por_mes', meses: [0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 40, 0], publico_meses } } } });
  perto(porColab.valor(1, Motor.IDX.endomarketing, 9), 50);
  perto(porColab.valor(2, Motor.IDX.endomarketing, 9), 0);
  const item = Motor.calcular({ colaboradores, filiais: {}, premissas: { '*': { aux_creche: { metodo: 'fixo', valor: 300, publico: 'F' } } } });
  perto(item.valor(0, Motor.IDX.aux_creche, 0), 300);
  perto(item.valor(2, Motor.IDX.aux_creche, 0), 0);
});

test('função: aprendiz com valor próprio e "quem recebe" por função', () => {
  const colaboradores = [colab({ id: 1, funcao: 'Operador', salario: 5000 }), colab({ id: 2, funcao: 'Jovem Aprendiz', salario: 1000 })];
  const premissas = { '*': {
    va: { metodo: 'fixo', valor: 1480, por_funcao: { 'JOVEM APRENDIZ': 600 } },
    ppr: { metodo: 'multiplo', valor: 2.4, periodo: 'anual_mes', mes: 2, por_funcao: { 'Jovem Aprendiz': 1 } },
    fretado: { metodo: 'fixo', valor: 200, quem: ['funcao:Jovem Aprendiz'] },
  } };
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.va, 0), 1480);
  perto(res.valor(1, Motor.IDX.va, 0), 600);
  perto(res.valor(0, Motor.IDX.ppr, 1), 12000);
  perto(res.valor(1, Motor.IDX.ppr, 1), 1000);
  perto(res.valor(0, Motor.IDX.fretado, 0), 0);
  perto(res.valor(1, Motor.IDX.fretado, 0), 200);
});

test('valores da base: benefício com periodicidade do item e reajuste; remuneração com dissídio; 0 = não recebe', () => {
  const colaboradores = [
    colab({ id: 1, salario: 5000, excecoes: { va: { metodo: 'fixo', valor: 800, origem: 'base' }, cesta_natalina: { metodo: 'fixo', valor: 270, origem: 'base' },
      periculosidade: { metodo: 'fixo', valor: 1500, origem: 'base' }, horas_extras: { metodo: 'fixo', valor: 400, origem: 'base' }, vt: { metodo: 'nao', valor: 0, origem: 'base' } } }),
    colab({ id: 2, salario: 5000 }),
  ];
  const filiais = { F1: { dissidio_pct: 10, dissidio_mes: 5, reaj_benef_pct: 5, reaj_benef_mes: 1 } };
  const premissas = { '*': { va: { metodo: 'fixo', valor: 1000 }, vt: { metodo: 'fixo', valor: 300 }, horas_extras: { metodo: 'rateio', valor: 24000, periodo: 'anual_diluido' } } };
  const res = Motor.calcular({ colaboradores: colaboradores.map(c => ({ ...c, filial: 'F1' })), filiais, premissas, mesesSalario: 12 });
  const v = (i, r, m) => res.valor(i, Motor.IDX[r], m);
  perto(v(0, 'va', 0), 840);                 // 800 da base + 5% de reajuste
  perto(v(1, 'va', 0), 1050);                // regra da filial
  perto(v(0, 'cesta_natalina', 11), 283.5);  // 1x em dezembro, como a regra do item
  perto(v(0, 'cesta_natalina', 5), 0);
  perto(v(0, 'periculosidade', 0), 1500);
  perto(v(0, 'periculosidade', 5), 1650);    // sobe com o dissídio de maio
  perto(v(0, 'horas_extras', 0), 1000);      // com "Total da filial", o total vale para todos (24.000 ÷ 12 ÷ 2)
  perto(v(1, 'horas_extras', 0), 1000);
  perto(v(0, 'vt', 0), 0);
});

test('auxílio óculos da base: valor do ano dividido em 12', () => {
  const c = colab({ excecoes: { aux_oculos: { metodo: 'fixo', valor: 3000, origem: 'base' } } });
  const res = Motor.calcular({ colaboradores: [c], filiais: {}, premissas: {} });
  perto(res.valor(0, Motor.IDX.aux_oculos, 0), 250);
  perto(total(res, 'aux_oculos'), 3000);
});

test('12 meses de remuneração (padrão): Rafael de Melo', () => {
  const c = colab({ salario: 4858.04, excecoes: { horas_extras: { metodo: 'fixo', valor: 193.81, origem: 'base' } } });
  const res = Motor.calcular({ colaboradores: [c], filiais: { CUIABA: { dissidio_pct: 4.22, dissidio_mes: 1 } }, premissas: { '*': { horas_extras: { metodo: 'nao', periodo: 'mensal' } } } });
  const v = rub => res.valor(0, Motor.IDX[rub], 0);
  const cheio = 5063.049288 + 1518.9147864 + 193.81 * 1.0422;
  perto(v('salario'), 5063.049288);
  perto(v('periculosidade'), 1518.9147864);
  perto(v('ferias'), 753.77);
  perto(v('decimo'), cheio / 12);
  perto(v('fgts'), cheio * 0.08);
  perto(v('inss'), cheio * 0.29);
  perto(total(res, 'salario'), 5063.049288 * 12);
});

test('total da regional toda: treinamento de 8.293,08 por mês dividido entre as filiais da regional', () => {
  const colaboradores = [
    colab({ id: 1, regional: 'SUL', filial: 'A' }), colab({ id: 2, regional: 'SUL', filial: 'A' }),
    colab({ id: 3, regional: 'SUL', filial: 'B' }), colab({ id: 4, regional: 'SUL', filial: 'C' }),
    colab({ id: 5, regional: 'SUL', filial: 'D' }), colab({ id: 6, regional: 'NORTE', filial: 'E' }),
  ];
  const regra = { metodo: 'rateio', valor: 8293.08, periodo: 'mensal', dividir: 'escopo' };
  const premissas = { 'R:SUL': { treinamento: regra }, D: { treinamento: { metodo: 'rateio', valor: 1000, periodo: 'mensal' } } };
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  const v = i => res.valor(i, Motor.IDX.treinamento, 0);
  perto(v(0) + v(1) + v(2) + v(3), 8293.08);   // filiais A, B e C dividem o total da regional
  perto(v(0), 8293.08 / 4);
  perto(v(4), 1000);                          // D tem regra própria
  perto(v(5), 0);                             // outra regional
  // sem "da regional toda": cada filial tem o total
  const cada = Motor.calcular({ colaboradores, filiais: {}, premissas: { 'R:SUL': { treinamento: { ...regra, dividir: '' } } } });
  perto(cada.valor(2, Motor.IDX.treinamento, 0), 8293.08);
});

test('promoções e méritos: 2% do salário a partir de abril, entrando na base de férias, 13º e encargos', () => {
  const premissas = { '*': { periculosidade: { metodo: 'nao' }, promocoes: { metodo: 'pct', valor: 2, base: 'salario', inicio: 4 } } };
  const res = Motor.calcular({ colaboradores: [colab({ salario: 5000 })], filiais: {}, premissas });
  const v = (r, m) => res.valor(0, Motor.IDX[r], m);
  perto(v('promocoes', 2), 0);
  perto(v('promocoes', 3), 100);
  perto(total(res, 'promocoes'), 900);
  perto(v('fgts', 3), 5100 * 0.08);
  perto(v('decimo', 3), 5100 / 12);
});

test('outros lançamentos: valor de cada mês direto no item, sem contar como pessoa nem entrar em rateios', () => {
  const colaboradores = [
    colab({ id: 1, salario: 5000 }),
    { id: -1, nome: 'Gupy', regional: 'CENTRO OESTE', filial: 'CUIABA', cc_cod: '17093', salario: 0, mes_inicio: 1, mes_fim: 12, avulso: { rubrica: 'outras', meses: [0, 0, 15000, 0, 0, 0, 0, 0, 15000, 0, 0, 0] } },
    { id: -2, nome: 'Rescisão', regional: 'CENTRO OESTE', filial: 'CUIABA', cc_cod: '17150', salario: 0, mes_inicio: 1, mes_fim: 12, avulso: { rubrica: 'rescisao', meses: [0, 0, 0, 0, 0, 0, 25000, 0, 0, 0, 0, 0] } },
  ];
  const premissas = { '*': { treinamento: { metodo: 'rateio', valor: 1200, periodo: 'mensal' } } };
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(1, Motor.IDX.outras, 2), 15000);
  perto(total(res, 'outras', 1), 30000);
  perto(res.valor(2, Motor.IDX.rescisao, 6), 25000);
  perto(res.valor(0, Motor.IDX.treinamento, 0), 1200);   // o total da filial fica todo com a pessoa
  perto(res.valor(1, Motor.IDX.salario, 0), 0);
  const ag = Motor.agregar(res, c => c.filial).get('CUIABA');
  perto(ag.hc[0], 1);                                       // lançamentos não contam no headcount
});

test('Total da filial vale sobre os valores da planilha da base (ex.: rescisão anual da filial)', () => {
  const colaboradores = [
    colab({ id: 1, excecoes: { rescisao: { metodo: 'fixo', valor: 500, origem: 'base' } } }),
    colab({ id: 2, excecoes: { rescisao: { metodo: 'fixo', valor: 700, origem: 'base' } } }),
    colab({ id: 3, excecoes: { rescisao: { metodo: 'fixo', valor: 100 } } }), // ajuste manual: continua
  ];
  const premissas = { CUIABA: { rescisao: { metodo: 'rateio', valor: 240000, periodo: 'anual_diluido' } } };
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.rescisao, 0), 10000);   // 240.000 ÷ 12 ÷ 2 pessoas
  perto(res.valor(1, Motor.IDX.rescisao, 0), 10000);
  perto(res.valor(2, Motor.IDX.rescisao, 0), 100);
  perto(total(res, 'rescisao', 0) + total(res, 'rescisao', 1), 240000);
  // sem regra de total, vale o valor da base
  const semTotal = Motor.calcular({ colaboradores, filiais: {}, premissas: {} });
  perto(semTotal.valor(0, Motor.IDX.rescisao, 0), 500);
});

test('histórico do ano anterior: salário de cada mês, ativo só nos meses pagos; dissídio ainda não pago a partir da data-base', () => {
  const sal = [4000, 4000, 4000, 4000, 4200, 4200, 0, 0, 0, 0, 0, 0]; // desligado em julho
  const c = colab({ salarios: sal });
  const premissas = { '*': { periculosidade: { metodo: 'nao' } } };
  const res = Motor.calcular({ colaboradores: [c], filiais: { CUIABA: {} }, premissas });
  perto(res.valor(0, 0, 0), 4000);            // sem dissídio: o salário pago
  perto(res.valor(0, 0, 4), 4200);
  // dissídio daquele ano que a folha não tinha (provisão), a partir da data-base (maio)
  const prov = Motor.calcular({ colaboradores: [c], filiais: { CUIABA: { dissidio_pct: 10, dissidio_mes: 5 } }, premissas });
  perto(prov.valor(0, 0, 3), 4000);
  perto(prov.valor(0, 0, 4), 4620);
  perto(res.valor(0, 0, 7), 0);
  perto(res.valor(0, Motor.IDX.decimo, 4), 4200 / 12);
  perto(res.valor(0, Motor.IDX.va, 7), 0);    // fora da empresa: sem benefícios
  const ag = Motor.agregar(res, () => 'x').get('x');
  perto(ag.hc[5], 1); perto(ag.hc[6], 0);
});
