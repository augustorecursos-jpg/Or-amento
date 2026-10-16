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
  const premissas = { CUIABA: { horas_extras: { metodo: 'rateio', valor: 900, rateio: 'hc', quem: ['cc:17150'] } } };
  const colaboradores = [colab({ id: 1, cc_cod: '17150' }), colab({ id: 2, cc_cod: '17150' }), colab({ id: 3, cc_cod: '22153' })];
  const res = Motor.calcular({ colaboradores, filiais: {}, premissas });
  perto(res.valor(0, Motor.IDX.horas_extras, 0), 450);
  perto(res.valor(2, Motor.IDX.horas_extras, 0), 0);
});

test('vaga entra só a partir do mês de admissão e o rateio se redistribui', () => {
  const premissas = { '*': { horas_extras: { metodo: 'rateio', valor: 1000 }, va: { metodo: 'fixo', valor: 100 } } };
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
