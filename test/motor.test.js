// Confere o motor contra as fórmulas da planilha BZO usada no orçamento atual.
const test = require('node:test');
const assert = require('node:assert');
const Motor = require('../public/js/motor');

const perto = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
const colab = (extra = {}) => ({ id: 1, nome: 'Teste', regional: 'CENTRO OESTE', filial: 'CUIABA', cargo: '14-Operação - Apoio', cc_cod: '17151', salario: 4858.04, mes_inicio: 1, mes_fim: 12, ...extra });
const total = (res, rub, i = 0) => { let s = 0; for (let m = 0; m < 12; m++) s += res.valor(i, Motor.IDX[rub], m); return s; };

test('reproduz as fórmulas da planilha (dissídio desde janeiro)', () => {
  const res = Motor.calcular({
    colaboradores: [colab()],
    filiais: { CUIABA: { dissidio_pct: 4.22, dissidio_mes: 1 } },
    premissas: {},
  });
  const v = rub => res.valor(0, Motor.IDX[rub], 0);
  perto(v('salario'), 5063.049288);
  perto(v('periculosidade'), 1518.9147864);
  perto(v('ferias'), (5063.049288 + 1518.9147864) / 36);
  perto(v('decimo'), 5063.049288 / 12);
  perto(v('fgts'), 405.04394304);
  perto(v('fgts_ferias'), v('ferias') * 0.08);
  perto(v('fgts_13'), 33.75366192);
});

test('dissídio só a partir do mês da data-base', () => {
  const res = Motor.calcular({ colaboradores: [colab({ salario: 1000 })], filiais: { CUIABA: { dissidio_pct: 10, dissidio_mes: 5 } }, premissas: {} });
  perto(res.valor(0, 0, 3), 1000);
  perto(res.valor(0, 0, 4), 1100);
  perto(total(res, 'salario'), 4 * 1000 + 8 * 1100);
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
