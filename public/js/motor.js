// Motor de cálculo do orçamento de pessoal · Âmbar Energia
// O mesmo arquivo roda no navegador (simulação instantânea) e no servidor (Node).
//
// Entrada:
//   colaboradores: [{ id, matricula, nome, regional, filial, cargo, cc_cod, cc_nome, salario, mes_inicio, mes_fim, vaga, excecoes }]
//                  excecoes: { [rubrica]: { metodo: 'nao' | 'fixo' | 'pct' | 'multiplo', valor, origem? } } — condições próprias do
//                  colaborador (ex.: sucedidos de outra empresa com benefício diferente). Valem no lugar da regra da filial.
//   filiais:       { [filial]: { regional, dissidio_pct, dissidio_mes, reaj_benef_pct, reaj_benef_mes } }
//   premissas:     { [escopo]: { [rubrica]: premissa } }  escopo = '*' (geral), 'R:<regional>' ou '<filial>'
//   niveis:        { [nível do cargo]: múltiplo de salários do PPR } — tabela geral, usada se a regra não tiver a sua
//
// Premissa: { metodo, valor, base, periodo, mes, rateio, teto, por_nivel, niveis, sem_dissidio, quem, por_funcao }
//   por_funcao { 'APRENDIZ': 900 } valor próprio por função (no lugar de `valor`, em %, R$ por colaborador e nº de salários)
//   quem    tokens 'cc:<cód>', 'cargo:<nível>' e 'funcao:<função>' (basta bater um)
//   metodo  'nao'      não se aplica
//           'pct'      % sobre uma base (salário, remuneração, folha, férias ou 13º), com teto opcional
//           'fixo'     R$ por colaborador
//           'rateio'   R$ total da filial, distribuído entre os colaboradores (por headcount ou proporcional ao salário)
//           'multiplo' N salários por colaborador (PPR) = salário × N, sobre o novo salário (com o dissídio da filial); sem_dissidio usa o salário da base; com por_nivel, usa a tabela `niveis` da própria regra
//                      ({ [nível do cargo]: nº de salários }) — ex.: a Holding com target por cargo e as filiais com outro
//   periodo 'mensal' (todo mês) · 'anual_mes' (valor do ano inteiro lançado no mês `mes`) · 'anual_diluido' (valor anual ÷ 12)
//           · 'por_mes' (R$ fixo ou total da filial com um valor para cada mês em `meses[12]`, ex.: ações de endomarketing)
//   publico 'F' / 'M' = só mulheres / só homens (colaborador.sexo); publico_meses[12] faz o mesmo mês a mês em 'por_mes'
//   quem    lista vazia = todos; senão só quem está em um dos centros de custo ('cc:<código>') ou níveis de cargo ('cargo:<nível>')
(function (raiz, fabrica) {
  const motor = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = motor;
  else raiz.Motor = motor;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const GRUPOS = [
    { id: 'remuneracao', nome: 'Remuneração', cor: '#2f6fa3' },
    { id: 'provisoes', nome: 'Provisões', cor: '#ec6b24' },
    { id: 'encargos', nome: 'Encargos', cor: '#2a9d8f' },
    { id: 'beneficios', nome: 'Benefícios', cor: '#8b5fbf' },
    { id: 'demais', nome: 'Demais', cor: '#b58a12' },
  ];

  const P = (metodo, extra = {}) => ({ metodo, valor: 0, base: 'salario', periodo: 'mensal', mes: 12, rateio: 'hc', teto: null, por_nivel: false, niveis: {}, quem: [], ...extra });

  // Catálogo único com todas as rubricas encontradas nas planilhas das regionais.
  // A ordem importa: uma rubrica só pode usar como base o que já foi calculado antes dela.
  const RUBRICAS = [
    { id: 'salario', nome: 'Salário', grupo: 'remuneracao', fixa: true },
    { id: 'periculosidade', nome: 'Periculosidade', grupo: 'remuneracao', adicional: true, padrao: P('pct', { valor: 30 }) },
    { id: 'insalubridade', nome: 'Insalubridade', grupo: 'remuneracao', adicional: true, padrao: P('nao') },
    { id: 'penosidade', nome: 'Penosidade', grupo: 'remuneracao', adicional: true, padrao: P('nao') },
    { id: 'adic_turno', nome: 'Adicionais de turno', grupo: 'remuneracao', adicional: true, dica: 'Inclui adicional intrajornada e passagem de turno', padrao: P('nao') },
    { id: 'horas_extras', nome: 'Horas extras', grupo: 'remuneracao', dica: 'Custo total do ano da filial; vira média mensal por colaborador', padrao: P('rateio', { periodo: 'anual_diluido' }) },

    // Férias, 13º, FGTS e INSS sobre salário + adicionais (periculosidade, insalubridade…) + horas extras (regra do ADM de pessoal).
    { id: 'ferias', nome: 'Férias (1/3)', grupo: 'provisoes', padrao: P('pct', { valor: 2.7778, base: 'folha' }) },
    { id: 'decimo', nome: '13º salário', grupo: 'provisoes', padrao: P('pct', { valor: 8.3333, base: 'folha' }) },
    { id: 'rescisao', nome: 'Rescisão', grupo: 'provisoes', padrao: P('nao') },

    { id: 'fgts', nome: 'FGTS', grupo: 'encargos', padrao: P('pct', { valor: 8, base: 'folha' }) },
    { id: 'fgts_ferias', nome: 'FGTS férias', grupo: 'encargos', padrao: P('pct', { valor: 8, base: 'ferias' }) },
    { id: 'fgts_13', nome: 'FGTS 13º', grupo: 'encargos', padrao: P('pct', { valor: 8, base: 'decimo' }) },
    { id: 'inss', nome: 'INSS', grupo: 'encargos', padrao: P('pct', { valor: 29, base: 'folha' }) },
    { id: 'inss_ferias', nome: 'INSS férias', grupo: 'encargos', padrao: P('nao', { base: 'ferias' }) },
    { id: 'inss_13', nome: 'INSS 13º', grupo: 'encargos', padrao: P('nao', { base: 'decimo' }) },

    { id: 'ppr', nome: 'PPR', grupo: 'beneficios', padrao: P('multiplo', { valor: 2.4, periodo: 'anual_diluido' }) },
    { id: 'va', nome: 'VA / VR', grupo: 'beneficios', padrao: P('fixo') },
    { id: 'va_natal', nome: 'VA natal / 13º VR', grupo: 'beneficios', padrao: P('nao', { periodo: 'anual_mes', mes: 12 }) },
    { id: 'vt', nome: 'Vale-transporte', grupo: 'beneficios', padrao: P('fixo') },
    { id: 'aux_creche', nome: 'Auxílio-creche', grupo: 'beneficios', padrao: P('nao') },
    { id: 'educacional', nome: 'Auxílio educacional', grupo: 'beneficios', padrao: P('nao') },
    { id: 'material_escolar', nome: 'Material escolar', grupo: 'beneficios', padrao: P('nao', { periodo: 'anual_mes', mes: 1 }) },
    { id: 'aux_oculos', nome: 'Auxílio óculos', grupo: 'beneficios', dica: 'Valor do ano, dividido em 12 meses', padrao: P('nao', { periodo: 'anual_diluido' }) },
    { id: 'oftalmo', nome: 'Oftalmo', grupo: 'beneficios', padrao: P('nao') },
    { id: 'assist_medica', nome: 'Assistência médica', grupo: 'beneficios', padrao: P('fixo') },
    { id: 'coparticipacao', nome: 'Coparticipação convênio médico', grupo: 'beneficios', padrao: P('nao') },
    { id: 'assist_odonto', nome: 'Assistência odontológica', grupo: 'beneficios', padrao: P('fixo') },
    { id: 'farmacia', nome: 'Farmácia', grupo: 'beneficios', padrao: P('nao') },
    { id: 'seguro_vida', nome: 'Seguro de vida', grupo: 'beneficios', padrao: P('fixo') },
    { id: 'refeitorio', nome: 'Refeitório', grupo: 'beneficios', padrao: P('nao') },
    { id: 'fretado', nome: 'Fretado', grupo: 'beneficios', padrao: P('nao') },
    { id: 'fretado_overall', nome: 'Fretado (overall)', grupo: 'beneficios', padrao: P('nao') },
    { id: 'cesta_natalina', nome: 'Cesta natalina', grupo: 'beneficios', padrao: P('fixo', { periodo: 'anual_mes', mes: 12 }) },

    { id: 'saude_ocupacional', nome: 'Saúde ocupacional', grupo: 'demais', padrao: P('nao') },
    { id: 'endomarketing', nome: 'Endomarketing', grupo: 'demais', padrao: P('fixo', { valor: 25 }) },
    { id: 'treinamento', nome: 'Treinamento', grupo: 'demais', padrao: P('rateio', { periodo: 'anual_diluido' }) },
    { id: 'viagens', nome: 'Viagens', grupo: 'demais', padrao: P('rateio', { periodo: 'anual_diluido' }) },
    { id: 'confraternizacoes', nome: 'Confraternizações', grupo: 'demais', padrao: P('fixo', { periodo: 'anual_mes', mes: 12 }) },
  ];

  const METODOS = {
    nao: 'Não se aplica',
    pct: '% sobre base',
    fixo: 'R$ por colaborador',
    rateio: 'Total da filial (rateio)',
    multiplo: 'Nº de salários',
  };
  const BASES = { salario: 'Salário', remuneracao: 'Remuneração', folha: 'Salário + adicionais + horas extras', ferias: 'Férias', decimo: '13º salário' };
  const PERIODOS = { mensal: 'Todo mês', anual_mes: 'Uma vez no ano (mês)', anual_diluido: 'Anual diluído (÷12)', por_mes: 'Valor diferente em cada mês' };

  const R = RUBRICAS.length;
  const IDX = Object.fromEntries(RUBRICAS.map((r, i) => [r.id, i]));
  const ADICIONAIS = RUBRICAS.map((r, i) => (r.adicional ? i : -1)).filter(i => i >= 0);

  /** O colaborador recebe a rubrica? (filtro "quem recebe" da premissa) */
  function elegivel(p, c, m) {
    const quemOk = !p.quem || !p.quem.length || p.quem.includes('cc:' + (c.cc_cod || '')) || p.quem.includes('cargo:' + (c.cargo || ''))
      || p.quem.includes('funcao:' + (c.funcao || ''));
    if (!quemOk) return false;
    // Público por sexo: do item inteiro e, nos valores por mês, de cada mês (ex.: outubro rosa só mulheres)
    if ((p.publico === 'F' || p.publico === 'M') && c.sexo !== p.publico) return false;
    if (m != null && p.periodo === 'por_mes') {
      const pm = p.publico_meses?.[m];
      if ((pm === 'F' || pm === 'M') && c.sexo !== pm) return false;
    }
    return true;
  }

  /** Regra do colaborador: a da filial, ou a condição própria dele (exceção) quando houver. */
  function aplicarExcecao(p, exc) {
    if (!exc || !METODOS[exc.metodo]) return p;
    // Valor vindo da planilha da base (origem 'base'): segue a periodicidade do item na premissa (todo mês, 1x no ano, anual ÷ 12).
    const daBase = exc.origem === 'base' && exc.metodo === 'fixo';
    const periodo = daBase ? (p.periodo === 'por_mes' || p.metodo === 'rateio' ? 'mensal' : p.periodo)
      : exc.metodo === p.metodo ? p.periodo : exc.metodo === 'multiplo' ? 'anual_diluido' : 'mensal';
    return { ...p, metodo: exc.metodo, valor: num(exc.valor), periodo, origem: daBase ? 'base' : undefined, quem: [], publico: '', publico_meses: [], por_nivel: false, por_funcao: {}, teto: exc.metodo === 'pct' ? p.teto : null };
  }

  /** Valor da regra para a função do colaborador: o valor próprio da função (ex.: VA do aprendiz) ou o valor geral. */
  const chaveFuncao = f => String(f || '').trim().toUpperCase();
  function valorDaFuncao(p, funcao) {
    if (!p.por_funcao || !funcao) return null;
    const k = chaveFuncao(funcao);
    for (const [f, v] of Object.entries(p.por_funcao)) if (chaveFuncao(f) === k && v !== '' && v != null) return num(v);
    return null;
  }
  const valorDe = (p, funcao) => valorDaFuncao(p, funcao) ?? num(p.valor);

  /** Nº de salários do PPR: valor próprio da função → tabela de nível da regra → tabela geral → valor da regra. */
  function multiploDe(p, nivel, niveis, funcao) {
    const proprio = valorDaFuncao(p, funcao);
    if (proprio != null) return proprio;
    if (p.por_nivel) {
      if (p.niveis && p.niveis[nivel] != null && p.niveis[nivel] !== '') return num(p.niveis[nivel]);
      if (niveis && niveis[nivel] != null) return num(niveis[nivel]);
    }
    return num(p.valor);
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Premissa efetiva da rubrica para a filial: filial → regional → geral → padrão do catálogo. */
  function premissaDe(premissas, filial, regional, rubricaId) {
    const rub = RUBRICAS[IDX[rubricaId]];
    const p = premissas?.[filial]?.[rubricaId] || premissas?.['R:' + regional]?.[rubricaId] || premissas?.['*']?.[rubricaId];
    return { ...rub.padrao, ...(p || {}) };
  }

  /** Origem da premissa efetiva (para mostrar na tela se é da filial, da regional, geral ou padrão). */
  function origemDe(premissas, filial, regional, rubricaId) {
    if (premissas?.[filial]?.[rubricaId]) return 'filial';
    if (premissas?.['R:' + regional]?.[rubricaId]) return 'regional';
    if (premissas?.['*']?.[rubricaId]) return 'geral';
    return 'padrao';
  }

  /**
   * Calcula o custo mensal de cada colaborador em cada rubrica.
   * Retorna { valores: Float64Array(n × R × 12), n, colaboradores } — use valor(i, r, m) para ler.
   */
  function calcular({ colaboradores = [], filiais = {}, premissas = {}, niveis = {} }) {
    const n = colaboradores.length;
    const valores = new Float64Array(n * R * 12);
    const at = (i, r, m) => (i * R + r) * 12 + m;

    // Premissas resolvidas por filial (evita resolver 12 × n vezes).
    const cachePrem = new Map();
    const premFilial = (filial, regional) => {
      if (!cachePrem.has(filial)) cachePrem.set(filial, RUBRICAS.map(r => (r.fixa ? null : premissaDe(premissas, filial, regional, r.id))));
      return cachePrem.get(filial);
    };

    const cfg = colaboradores.map(c => filiais[c.filial] || {});
    const premsFilial = colaboradores.map(c => premFilial(c.filial, c.regional));
    // Regra de cada colaborador (com as exceções dele) e quem tem exceção em cada rubrica (fica fora do rateio).
    const prems = colaboradores.map((c, i) => {
      const exc = c.excecoes;
      if (!exc || !Object.keys(exc).length) return premsFilial[i];
      return premsFilial[i].map((p, r) => (p && exc[RUBRICAS[r].id] ? aplicarExcecao(p, exc[RUBRICAS[r].id]) : p));
    });
    const temExcecao = (i, r) => Boolean(colaboradores[i].excecoes && colaboradores[i].excecoes[RUBRICAS[r].id]);
    const ativo = (i, m) => {
      const c = colaboradores[i];
      const ini = num(c.mes_inicio) || 1;
      const fim = num(c.mes_fim) || 12;
      return m + 1 >= ini && m + 1 <= fim;
    };
    const fatorDissidio = (i, m) => {
      const f = cfg[i];
      const mesDiss = num(f.dissidio_mes);
      return mesDiss && m + 1 >= mesDiss ? 1 + num(f.dissidio_pct) / 100 : 1;
    };
    const salario = (i, m) => num(colaboradores[i].salario) * fatorDissidio(i, m);
    const salarioPpr = (i, p) => {
      const f = cfg[i];
      const reaj = !p.sem_dissidio && num(f.dissidio_pct) && num(f.dissidio_mes) ? 1 + num(f.dissidio_pct) / 100 : 1;
      return num(colaboradores[i].salario) * reaj;
    };
    const fatorBenef = (i, m) => {
      const f = cfg[i];
      const mes = num(f.reaj_benef_mes);
      return mes && m + 1 >= mes ? 1 + num(f.reaj_benef_pct) / 100 : 1;
    };

    // Grupos de rateio: colaboradores de cada filial.
    const porFilial = new Map();
    colaboradores.forEach((c, i) => {
      if (!porFilial.has(c.filial)) porFilial.set(c.filial, []);
      porFilial.get(c.filial).push(i);
    });

    for (let m = 0; m < 12; m++) {
      const sal = new Float64Array(n);
      const ativos = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        ativos[i] = ativo(i, m) ? 1 : 0;
        if (ativos[i]) {
          sal[i] = salario(i, m);
          valores[at(i, 0, m)] = sal[i];
        }
      }

      const base = (i, nome) => {
        if (nome === 'salario') return sal[i];
        let rem = sal[i];
        for (const r of ADICIONAIS) rem += valores[at(i, r, m)];
        if (nome === 'remuneracao') return rem;
        if (nome === 'folha') return rem + valores[at(i, IDX.horas_extras, m)];
        if (nome === 'ferias') return valores[at(i, IDX.ferias, m)];
        if (nome === 'decimo') return valores[at(i, IDX.decimo, m)];
        return sal[i];
      };

      for (let r = 1; r < R; r++) {
        const rub = RUBRICAS[r];
        const ehBenef = rub.grupo === 'beneficios';

        // Rateio: o total da filial é dividido entre quem está ativo no mês.
        const rateados = new Set();
        for (const [, idxs] of porFilial) {
          const p = premsFilial[idxs[0]][r];
          if (p.metodo !== 'rateio') continue;
          idxs.forEach(i => { if (!temExcecao(i, r)) rateados.add(i); });
          let total = p.periodo === 'por_mes' ? num(p.meses?.[m]) : num(p.valor);
          if (p.periodo === 'anual_mes') total = m + 1 === num(p.mes) ? total : 0;
          else if (p.periodo === 'anual_diluido') total = total / 12;
          if (!total) continue;
          const elegiveis = idxs.filter(i => ativos[i] && !temExcecao(i, r) && elegivel(p, colaboradores[i], m));
          const pesos = elegiveis.map(i => (p.rateio === 'salario' ? sal[i] : 1));
          const soma = pesos.reduce((a, b) => a + b, 0);
          if (!soma) continue;
          const fator = ehBenef ? fatorBenef(elegiveis[0], m) : 1;
          elegiveis.forEach((i, k) => { valores[at(i, r, m)] = (total * fator * pesos[k]) / soma; });
        }

        for (let i = 0; i < n; i++) {
          if (!ativos[i] || rateados.has(i)) continue;
          const p = prems[i][r];
          if (p.metodo === 'nao' || !elegivel(p, colaboradores[i], m)) continue;
          let v = 0;
          switch (p.metodo) {
            case 'pct':
              v = (valorDe(p, colaboradores[i].funcao) / 100) * base(i, rub.adicional ? 'salario' : p.base);
              if (p.teto != null && p.teto !== '' && num(p.teto) > 0) v = Math.min(v, num(p.teto));
              break;
            case 'fixo':
              // Benefícios sobem com o reajuste de benefícios; remuneração vinda da base (sem dissídio) sobe com o dissídio.
              v = (p.periodo === 'por_mes' ? num(p.meses?.[m]) : valorDe(p, colaboradores[i].funcao))
                * (ehBenef ? fatorBenef(i, m) : p.origem === 'base' ? fatorDissidio(i, m) : 1);
              if (p.periodo === 'anual_mes') v = m + 1 === num(p.mes) ? v : 0;
              else if (p.periodo === 'anual_diluido') v = v / 12;
              break;
            case 'multiplo': {
              // PPR = salário × target. Com dissídio na filial, usa o salário reajustado (o novo salário) no ano todo;
              // sem_dissidio força o salário da base.
              v = multiploDe(p, colaboradores[i].cargo, niveis, colaboradores[i].funcao) * salarioPpr(i, p);
              if (p.periodo === 'anual_mes') v = m + 1 === num(p.mes) ? v : 0;
              else if (p.periodo === 'anual_diluido' || p.periodo === 'por_mes') v = v / 12;
              break;
            }
            default:
              v = 0;
          }
          valores[at(i, r, m)] = v;
        }
      }
    }

    return {
      n,
      colaboradores,
      valores,
      valor: (i, r, m) => valores[at(i, r, m)],
    };
  }

  /**
   * Soma o resultado por uma chave (ex.: filial, centro de custo, colaborador).
   * Retorna Map(chave → { porRubrica: Float64Array(R×12), meses: Float64Array(12), total, hc: Float64Array(12) }).
   */
  function agregar(res, chaveDe, filtro) {
    const out = new Map();
    for (let i = 0; i < res.n; i++) {
      const c = res.colaboradores[i];
      if (filtro && !filtro(c)) continue;
      const k = chaveDe(c);
      if (!out.has(k)) out.set(k, { porRubrica: new Float64Array(R * 12), meses: new Float64Array(12), hc: new Float64Array(12), total: 0, n: 0 });
      const ag = out.get(k);
      ag.n++;
      const ini = num(c.mes_inicio) || 1;
      const fim = num(c.mes_fim) || 12;
      for (let m = 0; m < 12; m++) if (m + 1 >= ini && m + 1 <= fim) ag.hc[m]++;
      const off = i * R * 12;
      for (let j = 0; j < R * 12; j++) {
        const v = res.valores[off + j];
        if (!v) continue;
        ag.porRubrica[j] += v;
        ag.meses[j % 12] += v;
        ag.total += v;
      }
    }
    return out;
  }

  /** Totais por grupo (Remuneração, Provisões...) a partir de um agregado: { [grupo]: Float64Array(12) }. */
  function porGrupo(ag) {
    const out = Object.fromEntries(GRUPOS.map(g => [g.id, new Float64Array(12)]));
    RUBRICAS.forEach((rub, r) => {
      for (let m = 0; m < 12; m++) out[rub.grupo][m] += ag.porRubrica[r * 12 + m];
    });
    return out;
  }

  return { MESES, GRUPOS, RUBRICAS, METODOS, BASES, PERIODOS, IDX, premissaDe, origemDe, elegivel, aplicarExcecao, multiploDe, valorDe, calcular, agregar, porGrupo };
});
