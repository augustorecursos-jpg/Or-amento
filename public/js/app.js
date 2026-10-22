// Orçamento de Pessoal · Âmbar Energia — aplicação (admin e coordenadores)
const { MESES, GRUPOS, RUBRICAS, METODOS, BASES, PERIODOS, IDX } = Motor;
const RN = RUBRICAS.length;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pctFmt = v => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const COR_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.id, g.cor]));
const NOME_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.id, g.nome]));
const STATUS = { aberta: ['Aberta', 'pend'], em_analise: ['Em análise', 'azul'], ajustada: ['Ajustada', 'ok'], recusada: ['Recusada', 'neutra'] };

const E = {
  eu: null,
  dados: null,
  res: null,          // cálculo com o rascunho do simulador aplicado
  resSalvo: null,     // cálculo só com o que está salvo (para medir o impacto do rascunho)
  resSemDissidio: null,
  rascunho: {},       // filial → { dissidio_ant_pct/_mes, dissidio_pct/_mes, reaj_benef_ant_pct/_mes, reaj_benef_pct/_mes }
  filtro: filtroMulti({ regional: [], uf: [], filial: [], cc: [], conta: [] }), // filtros do topo: cada um aceita vários itens
  aba: 'painel',
  sim: { visao: 'rubricas', mil: false, fechados: new Set(), busca: '', abertos: new Set(), abertosAg: new Set() },
  prem: { escopo: '*', uf: '', edits: {}, filial: {}, propagar: {}, busca: '', visao: 'filial', ocultarVazios: true, quadroReg: '' },
  base: { busca: '', soVagas: false, soProprias: false, fila: [] },
  conf: { filial: '', modo: 'mes', sel: new Set() },
  painelVisao: 'custo', // 'custo' ou 'hc' (headcount)
  comparar: false, // comparativo com o ano anterior (painel e simulação)
  hc: { dim: 'filial', busca: '', aberto: '', sub: 'funcao' },
  calc: { rub: 'promocoes', modo: 'regra', tipo: '', valor: '', periodo: '', inicio: '', inicio2: null, alvo: '', pct: '', substituir: false, incluirSem: false },
  solic: [],
  solicFiltro: 'pendentes',
  contabil: { cfg: null, zeradas: false, porFilial: true, formato: 'contabil' },
};

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const painel = id => $(`[data-painel="${id}"]`);
const fmtVal = v => (E.sim.mil ? num0.format(v / 1000) : num2.format(v));

// ---------- dados e cálculo ----------

function filiaisComRascunho() {
  const out = {};
  for (const [f, cfg] of Object.entries(E.dados.filiais)) out[f] = { ...cfg, ...(E.rascunho[f] || {}) };
  return out;
}

/** Outros lançamentos como linhas "avulsas" do cálculo: somam custo na filial/CC, mas não são pessoas. */
function lancamentosComoLinhas() {
  // linhasLanc já vem do servidor com os lançamentos "dividir pelo headcount" repartidos por filial
  return (E.dados.linhasLanc || E.dados.lancamentos || []).map((l, k) => ({
    id: -(k + 1), matricula: '', nome: l.descricao, regional: l.regional === '*' ? 'TODAS AS REGIONAIS' : l.regional,
    filial: l.filial || (l.regional === '*' ? '(empresa · Brasil)' : `(regional ${l.regional})`), situacao: 'Outro lançamento', funcao: 'Outro lançamento',
    cargo: '', cc_cod: l.cc_cod, cc_nome: l.cc_nome, salario: 0, mes_inicio: 1, mes_fim: 12, vaga: false, excecoes: {}, sexo: '', gestor: '',
    avulso: { rubrica: l.rubrica, meses: l.meses, conta: l.conta, pacote: l.pacote, cc_contabil: l.cc_contabil, id: l.id },
  }));
}

function recalcular() {
  const { premissas, niveis } = E.dados;
  const colaboradores = [...E.dados.colaboradores, ...lancamentosComoLinhas()];
  const b = {};
  b.res = Motor.calcular({ colaboradores, filiais: filiaisComRascunho(), premissas, niveis });
  b.resSalvo = Object.keys(E.rascunho).length ? Motor.calcular({ colaboradores, filiais: E.dados.filiais, premissas, niveis }) : b.res;
  const semDiss = {};
  const soAnt = {};
  for (const [f, cfg] of Object.entries(filiaisComRascunho())) {
    semDiss[f] = { ...cfg, dissidio_pct: 0, dissidio_ant_pct: 0 };
    soAnt[f] = { ...cfg, dissidio_pct: 0 };
  }
  b.resSemDissidio = Motor.calcular({ colaboradores, filiais: semDiss, premissas, niveis });
  // só com o dissídio do ano anterior: separa o impacto de cada dissídio
  b.resSoDissAnt = filiaisComDissAnt() ? Motor.calcular({ colaboradores, filiais: soAnt, premissas, niveis }) : b.resSemDissidio;
  // Ano anterior: salários pagos de cada mês + as regras atuais. O dissídio e o reajuste de benefícios daquele ano que a base
  // ainda não tem (os "ano anterior" da filial) entram a partir da data-base daquele ano; os do orçamento não.
  const ant = anteriorComoColaboradores();
  if (ant.length) {
    const semReaj = {};
    for (const [f, cfg] of Object.entries(filiaisComRascunho())) {
      semReaj[f] = { ...cfg, dissidio_ant_pct: 0, reaj_benef_ant_pct: 0,
        dissidio_pct: Number(cfg.dissidio_ant_pct) || 0, dissidio_mes: cfg.dissidio_ant_mes || cfg.dissidio_mes, reaj_benef_pct: Number(cfg.reaj_benef_ant_pct) || 0, reaj_benef_mes: cfg.reaj_benef_ant_mes || cfg.reaj_benef_mes };
    }
    b.resAnt = soGruposComparados(Motor.calcular({ colaboradores: ant, filiais: semReaj, premissas, niveis }));
    b.resCmp = soGruposComparados(b.res);
  } else b.resAnt = b.resCmp = null;
  if (!b.resAnt) E.comparar = false;
  E.bruto = b;
  aplicarFiltroConta();
}

/** Filtro de conta do topo: '' = todas; 'g:<grupo>' = um grupo; 'r:<rubrica>' = uma conta. */
function contaNoFiltro() {
  const ids = E.filtro.sel.conta;
  if (!ids.length) return null;
  return RUBRICAS.map((r, k) => (ids.includes(r.id) ? k : -1)).filter(k => k >= 0);
}
const nomeContaFiltro = () => {
  const ids = E.filtro.sel.conta;
  if (!ids.length) return '';
  // grupos inteiros pelo nome; o resto conta a conta
  const partes = [];
  const sobra = new Set(ids);
  for (const g of GRUPOS) {
    const doG = RUBRICAS.filter(r => r.grupo === g.id).map(r => r.id);
    if (doG.every(id => sobra.has(id))) { partes.push(`Grupo ${g.nome}`); doG.forEach(id => sobra.delete(id)); }
  }
  RUBRICAS.filter(r => sobra.has(r.id)).forEach(r => partes.push(r.nome));
  return partes.length <= 3 ? partes.join(' + ') : `${ids.length} contas`;
};
/** Cópia do cálculo só com algumas contas (índices das rubricas). */
function soRubricas(res, manter) {
  const fica = new Set(manter);
  const fora = RUBRICAS.map((_, k) => k).filter(k => !fica.has(k));
  const valores = Float64Array.from(res.valores);
  for (let i = 0; i < res.n; i++) for (const k of fora) valores.fill(0, (i * RN + k) * 12, (i * RN + k) * 12 + 12);
  return { ...res, valores, valor: (i, r, m) => valores[(i * RN + r) * 12 + m] };
}
/** Aplica o filtro de conta sobre os cálculos já feitos (sem recalcular). */
function aplicarFiltroConta() {
  const b = E.bruto;
  const ks = contaNoFiltro();
  const ap = r => (r && ks ? soRubricas(r, ks) : r);
  E.res = ap(b.res);
  E.resSalvo = b.resSalvo === b.res ? E.res : ap(b.resSalvo);
  E.resSemDissidio = ap(b.resSemDissidio);
  E.resSoDissAnt = b.resSoDissAnt === b.resSemDissidio ? E.resSemDissidio : ap(b.resSoDissAnt);
  E.resAnt = ap(b.resAnt);
  E.resCmp = ap(b.resCmp);
  _regras = new Map();
}

// O comparativo com o ano anterior vai até os encargos: remuneração, provisões, encargos e benefícios (sem "Demais").
const GRUPOS_CMP = new Set(['remuneracao', 'provisoes', 'encargos', 'beneficios']);
const GRUPOS_CMP_TXT = 'remuneração, provisões, encargos e benefícios';
/** Cópia do cálculo só com as contas dos grupos comparados. */
function soGruposComparados(res) {
  return soRubricas(res, RUBRICAS.map((r, k) => (GRUPOS_CMP.has(r.grupo) ? k : -1)).filter(k => k >= 0));
}
/** Meses do ano anterior que são realizados; os seguintes foram projetados com o salário do último mês. */
const mesesReaisAnt = () => Number(E.dados.config.anterior_meses_reais) || 12;
const rotulosAnt = () => MESES.map((m, i) => (i >= mesesReaisAnt() ? `${m}*` : m));
const notaProjecao = () => {
  const r = mesesReaisAnt();
  if (r >= 12) return '';
  return `${anoAnt()}: ${MESES[0]}–${MESES[r - 1]} realizado · ${MESES[r]}${r < 11 ? `–${MESES[11]}` : ''}* projetado com o salário de ${MESES[r - 1]}`;
};
/** Alguma filial com dissídio do ano anterior (ex.: data-base 2026) lançado? */
const filiaisComDissAnt = () => Object.values(filiaisComRascunho()).some(f => Number(f.dissidio_ant_pct));
/** Meses (0–11) em que entra algum dissídio nas filiais dadas (o do ano anterior só marca se começar depois de janeiro). */
function mesesDeDissidio(cfgs) {
  const out = new Set();
  cfgs.filter(Boolean).forEach(f => {
    if (Number(f.dissidio_pct)) out.add((Number(f.dissidio_mes) || 1) - 1);
  });
  return [...out].sort((a, b) => a - b);
}
/** "5% (data-base Ago/26) + 4,5% (data-base Ago/27)" */
function textoReajuste(f, pre = 'dissidio') {
  if (!f) return '';
  const partes = [];
  if (Number(f[`${pre}_ant_pct`])) partes.push(`${num2.format(f[`${pre}_ant_pct`])}% (data-base ${MESES[(f[`${pre}_ant_mes`] || 1) - 1]}/${String(anoAnt()).slice(-2)})`);
  if (Number(f[`${pre}_pct`])) partes.push(`${num2.format(f[`${pre}_pct`])}% (data-base ${MESES[(f[`${pre}_mes`] || 1) - 1]}/${String(E.dados.config.ano).slice(-2)})`);
  return partes.join(' + ') || (pre === 'dissidio' ? 'sem dissídio' : 'sem reajuste');
}
const textoDissidio = f => textoReajuste(f, 'dissidio');
/** Fator do reajuste de benefícios no mês (0–11): ano anterior × ano. */
const fatorBenefDe = (f, m) => (1 + (Number(f.reaj_benef_ant_pct) || 0) / 100)
  * (m + 1 >= (Number(f.reaj_benef_mes) || 1) ? 1 + (Number(f.reaj_benef_pct) || 0) / 100 : 1);
/** Nota do comparativo quando há dissídio/reajuste do ano anterior lançado (entra no lado do ano anterior como provisão). */
function notaProvisaoAnt() {
  const fils = filiaisVisiveis().map(f => filiaisComRascunho()[f]).filter(Boolean);
  const d = fils.some(f => Number(f.dissidio_ant_pct)), b = fils.some(f => Number(f.reaj_benef_ant_pct));
  if (!d && !b) return '';
  return `${anoAnt()}: salário pago${d ? ` + dissídio ${anoAnt()}` : ''}${b ? ` + reajuste de benefícios ${anoAnt()}` : ''} a partir da data-base de ${anoAnt()} (provisão); em ${E.dados.config.ano} ele vale o ano todo`;
}
const anoAnt = () => Number(E.dados.config.ano) - 1;
/** Histórico do ano anterior como colaboradores do cálculo. Quem ainda está na base herda dela as condições próprias
 * (benefícios da planilha, sucedidos), o sexo e o gestor — casando pela matrícula e nome. */
function anteriorComoColaboradores() {
  const atuais = new Map(E.dados.colaboradores.filter(c => c.matricula).map(c => [`${c.matricula}|${String(c.nome).trim().toUpperCase()}`, c]));
  // a mesma matrícula existe em empresas diferentes: sem o nome igual, só casa na mesma filial
  const porMat = new Map(E.dados.colaboradores.filter(c => c.matricula).map(c => [`${c.matricula}|${c.filial}`, c]));
  return (E.dados.anterior || []).map((a, k) => {
    const atual = atuais.get(`${a.matricula}|${String(a.nome).trim().toUpperCase()}`) || (a.matricula ? porMat.get(`${a.matricula}|${a.filial}`) : null);
    const meses = a.salarios.map(Number);
    const ini = meses.findIndex(v => v > 0) + 1;
    const fim = 12 - [...meses].reverse().findIndex(v => v > 0);
    return {
      id: -1000000 - k, matricula: a.matricula, nome: a.nome, regional: a.regional, filial: a.filial, situacao: 'Histórico',
      funcao: a.funcao || atual?.funcao || '', cargo: a.cargo || atual?.cargo || '', cc_cod: a.cc_cod || atual?.cc_cod || '', cc_nome: a.cc_nome || (a.cc_cod ? '' : atual?.cc_nome) || '',
      salario: meses[fim - 1] || 0, salarios: meses, mes_inicio: ini || 1, mes_fim: fim || 12, vaga: false,
      excecoes: atual?.excecoes || {}, sexo: atual?.sexo || '', gestor: atual?.gestor || '',
    };
  });
}

async function carregar() {
  E.dados = await api('/api/dados');
  recalcular();
  montarFiltros();
}

// Estado (UF) da filial; '_' = ainda não definido
const ufDe = filial => E.dados.filiais[filial]?.uf || '';
/** Estado da filial bate com um estado (texto) ou com algum de uma lista ([] / '' = todos). */
const bateUf = (filial, ufs = E.filtro.sel.uf) => {
  const lista = Array.isArray(ufs) ? ufs : ufs ? [ufs] : [];
  return !lista.length || lista.some(uf => (uf === '_' ? !ufDe(filial) : ufDe(filial) === uf));
};
/** O valor passa no filtro k do topo? (nada marcado = passa tudo) */
const noSel = (k, v) => !E.filtro.sel[k].length || E.filtro.sel[k].includes(v);
const noFiltro = c => noSel('regional', c.regional) && bateUf(c.filial) && noSel('filial', c.filial) && noSel('cc', String(c.cc_cod || ''));
const rotuloCc = c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}`;
const regionais = () => [...new Set(Object.values(E.dados.filiais).map(f => f.regional))].sort();
const filiaisDa = regional => Object.values(E.dados.filiais).filter(f => !regional || f.regional === regional).map(f => f.filial).sort();
/** Filiais que passam pelos filtros do topo (regional, estado e filial). */
const filiaisVisiveis = () => Object.values(E.dados.filiais).filter(f => noSel('regional', f.regional)).map(f => f.filial).sort()
  .filter(f => bateUf(f) && noSel('filial', f) && (!E.filtro.sel.cc.length || E.dados.colaboradores.some(c => c.filial === f && E.filtro.sel.cc.includes(String(c.cc_cod || '')))));
const UFS_BR = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
/** Opções de estado presentes nas filiais (mais "a definir" se houver). */
function opcoesUf(fils, sel, rotuloTodos = 'Todos os estados') {
  const ufs = [...new Set(fils.map(ufDe).filter(Boolean))].sort();
  const semUf = fils.some(f => !ufDe(f));
  return `<option value="">${rotuloTodos}</option>${ufs.map(u => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('')}${semUf ? `<option value="_" ${sel === '_' ? 'selected' : ''}>Estado a definir</option>` : ''}`;
}

function totalDe(res, filtro = noFiltro) {
  const ag = Motor.agregar(res, () => 'x', filtro).get('x');
  return ag || { porRubrica: new Float64Array(RN * 12), meses: new Float64Array(12), hc: new Float64Array(12), total: 0, n: 0 };
}

// ---------- estrutura (menu, filtros, modal) ----------

/** Filtros do topo com vários itens. regional/uf/filial/cc também respondem como texto: o item, quando só um está marcado. */
function filtroMulti(sel) {
  const f = { sel };
  for (const k of ['regional', 'uf', 'filial', 'cc']) {
    Object.defineProperty(f, k, { get: () => (sel[k].length === 1 ? sel[k][0] : ''), set: v => { sel[k] = v ? [v] : []; }, enumerable: true });
  }
  Object.defineProperty(f, 'conta', { get: () => sel.conta.join(','), enumerable: true });
  return f;
}
const temFiltroTopo = () => ['regional', 'uf', 'filial', 'cc'].some(k => E.filtro.sel[k].length);

function montarFiltros() {
  const sel = E.filtro.sel;
  const regs = regionais();
  sel.regional = sel.regional.filter(x => regs.includes(x));
  const doReg = Object.values(E.dados.filiais).filter(f => noSel('regional', f.regional)).map(f => f.filial).sort();
  const ufs = [...new Set(doReg.map(ufDe).filter(Boolean))].sort();
  const temSemUf = doReg.some(f => !ufDe(f));
  sel.uf = sel.uf.filter(u => (u === '_' ? temSemUf : ufs.includes(u)));
  const fils = doReg.filter(x => bateUf(x));
  sel.filial = sel.filial.filter(x => fils.includes(x));
  // Centros de custo das filiais que passam pelos filtros acima
  const ccs = new Map();
  E.dados.colaboradores.filter(c => fils.includes(c.filial) && noSel('filial', c.filial)).forEach(c => ccs.set(String(c.cc_cod || ''), rotuloCc(c)));
  sel.cc = sel.cc.filter(x => ccs.has(x));
  const depois = (k, rerender = true) => v => {
    sel[k] = v;
    if (k === 'conta') aplicarFiltroConta();
    montarFiltros(); // redesenha os botões (o da conta também), com a seleção nova
    if (rerender) renderAba();
  };
  montarMulti($('#f-regional'), { opcoes: regs.map(x => ({ v: x, rot: x })), sel: sel.regional, todos: E.eu.admin ? 'Todas as regionais' : 'Minhas regionais', plural: 'regionais', aplicar: depois('regional') });
  montarMulti($('#f-uf'), { opcoes: [...ufs.map(u => ({ v: u, rot: u })), ...(temSemUf ? [{ v: '_', rot: 'Estado a definir' }] : [])], sel: sel.uf, todos: 'Todos os estados', plural: 'estados', aplicar: depois('uf') });
  montarMulti($('#f-filial'), { opcoes: fils.map(x => ({ v: x, rot: x })), sel: sel.filial, todos: 'Todas as filiais', plural: 'filiais', aplicar: depois('filial') });
  montarMulti($('#f-cc'), {
    opcoes: [...ccs].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR', { numeric: true })).map(([v, rot]) => ({ v, rot })),
    sel: sel.cc, todos: 'Todos os centros de custo', plural: 'centros de custo', aplicar: depois('cc'),
  });
  montarMulti($('#f-conta'), {
    opcoes: RUBRICAS.map(r => ({ v: r.id, rot: r.nome, grupo: r.grupo })), grupos: GRUPOS,
    sel: sel.conta, todos: 'Todas as contas', plural: 'contas', aplicar: depois('conta'), nomeSel: nomeContaFiltro,
  });
}

/** Lista suspensa com caixinhas. Marcar nada = todos. Vale ao fechar (Aplicar, clique fora); Esc cancela. */
function montarMulti(el, cfg) {
  el._cfg = cfg;
  const n = cfg.sel.length;
  const rot = !n ? cfg.todos : cfg.nomeSel ? cfg.nomeSel() : n === 1 ? cfg.opcoes.find(o => o.v === cfg.sel[0])?.rot || cfg.sel[0] : `${n} ${cfg.plural}`;
  el.classList.add('multi');
  el.innerHTML = `<button type="button" class="campo multi-botao${n ? ' filtro-ativo' : ''}" aria-haspopup="listbox" title="${esc(n ? cfg.sel.map(v => cfg.opcoes.find(o => o.v === v)?.rot || v).join(' · ') : cfg.todos)}"><span>${esc(rot)}</span></button>`;
  el.querySelector('.multi-botao').addEventListener('click', e => { e.stopPropagation(); el.querySelector('.multi-painel') ? fecharMulti(el, true) : abrirMulti(el); });
}

function abrirMulti(el) {
  $$('.multi').forEach(o => { if (o !== el && o.querySelector('.multi-painel')) fecharMulti(o, true); });
  const cfg = el._cfg;
  const marcados = new Set(cfg.sel);
  const painelM = document.createElement('div');
  painelM.className = 'multi-painel';
  painelM.innerHTML = `${cfg.opcoes.length > 7 ? '<input class="campo multi-busca" placeholder="Buscar…">' : ''}
    <div class="multi-acoes"><button type="button" data-todos>Marcar todos</button><button type="button" data-limpar>Limpar</button></div>
    <div class="multi-lista" role="listbox" aria-multiselectable="true"></div>
    <div class="multi-rodape"><small></small><button type="button" class="btn btn-laranja btn-sm" data-aplicar>Aplicar</button></div>`;
  el.appendChild(painelM);
  el._marcados = marcados;
  const busca = painelM.querySelector('.multi-busca');
  const visiveis = () => { const b = normCab(busca?.value || ''); return cfg.opcoes.filter(o => !b || normCab(o.rot).includes(b)); };
  const desenhar = () => {
    const vis = visiveis();
    const linha = o => `<label class="multi-item"><input type="checkbox" value="${esc(o.v)}" ${marcados.has(o.v) ? 'checked' : ''}><span>${esc(o.rot)}</span></label>`;
    painelM.querySelector('.multi-lista').innerHTML = cfg.grupos
      ? cfg.grupos.map(g => {
        const itens = vis.filter(o => o.grupo === g.id);
        if (!itens.length) return '';
        const todosG = itens.every(o => marcados.has(o.v));
        const algum = itens.some(o => marcados.has(o.v));
        return `<label class="multi-item multi-grupo"><input type="checkbox" data-grupo="${g.id}" ${todosG ? 'checked' : ''} ${!todosG && algum ? 'data-meio="1"' : ''}><i class="bola" style="background:${g.cor}"></i><span>${esc(g.nome)}</span></label>${itens.map(linha).join('')}`;
      }).join('')
      : vis.map(linha).join('') || '<p class="multi-vazio">Nada encontrado.</p>';
    painelM.querySelectorAll('[data-meio]').forEach(c => { c.indeterminate = true; });
    painelM.querySelector('.multi-rodape small').textContent = marcados.size ? `${marcados.size} marcado(s)` : `nada marcado = ${cfg.todos.toLowerCase()}`;
  };
  desenhar();
  painelM.addEventListener('click', e => e.stopPropagation());
  painelM.querySelector('.multi-lista').addEventListener('change', e => {
    const c = e.target;
    if (c.dataset.grupo) visiveis().filter(o => o.grupo === c.dataset.grupo).forEach(o => (c.checked ? marcados.add(o.v) : marcados.delete(o.v)));
    else c.checked ? marcados.add(c.value) : marcados.delete(c.value);
    desenhar();
  });
  busca?.addEventListener('input', desenhar);
  painelM.querySelector('[data-todos]').addEventListener('click', () => { visiveis().forEach(o => marcados.add(o.v)); desenhar(); });
  // Limpar = volta para "todos" e já aplica
  painelM.querySelector('[data-limpar]').addEventListener('click', () => { marcados.clear(); fecharMulti(el, true); });
  painelM.querySelector('[data-aplicar]').addEventListener('click', () => fecharMulti(el, true));
  busca?.focus();
}

function fecharMulti(el, aplicar) {
  const painelM = el.querySelector('.multi-painel');
  if (!painelM) return;
  painelM.remove();
  const cfg = el._cfg;
  // tudo marcado = o mesmo que nada marcado (todos)
  let novo = cfg.opcoes.map(o => o.v).filter(v => el._marcados.has(v));
  if (novo.length === cfg.opcoes.length) novo = [];
  const mudou = novo.length !== cfg.sel.length || novo.some(v => !cfg.sel.includes(v));
  if (aplicar && mudou) cfg.aplicar(novo);
}
document.addEventListener('click', () => $$('.multi').forEach(o => fecharMulti(o, true)));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.multi').forEach(o => fecharMulti(o, false)); });

/** Texto do centro de custo filtrado no topo (para títulos). */
const ccFiltrado = () => {
  const sel = E.filtro.sel.cc;
  if (sel.length > 1) return `${sel.length} centros de custo`;
  const c = sel.length && E.dados.colaboradores.find(x => String(x.cc_cod || '') === sel[0]);
  return c ? rotuloCc(c) : '';
};
/** Título do escopo filtrado no topo (filiais, ou regionais + estados). */
function escopoFiltro(padrao) {
  const sel = E.filtro.sel;
  const um = (k, plural, nome = x => x) => (sel[k].length && sel[k].length <= 3 ? sel[k].map(nome).join(' + ') : sel[k].length ? `${sel[k].length} ${plural}` : '');
  return um('filial', 'filiais') || [um('regional', 'regionais'), um('uf', 'estados', u => (u === '_' ? 'estado a definir' : u))].filter(Boolean).join(' · ') || padrao;
}

const TITULOS = {
  painel: 'Painel', simulacao: 'Simulação mês a mês', calculadora: 'Calculadora de impacto', premissas: 'Premissas e regras', base: 'Base de colaboradores',
  conferencia: 'Conferência', contabil: 'Relatório contábil', lancamentos: 'Outros lançamentos', solicitacoes: 'Pedidos de ajuste', coordenadores: 'Acessos dos coordenadores', historico: 'Histórico',
};

function irPara(aba) {
  E.aba = aba;
  $$('.lateral-item[data-aba]').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  $$('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba; });
  $('#barra-pagina').textContent = TITULOS[aba];
  $('#barra-filtros').style.visibility = ['painel', 'simulacao', 'calculadora', 'base', 'conferencia', 'contabil', 'lancamentos'].includes(aba) ? '' : 'hidden';
  $('#lateral').classList.remove('aberta');
  history.replaceState(null, '', `#${aba}`);
  renderAba();
  window.scrollTo(0, 0);
}

function renderAba() {
  ({
    painel: renderPainel, simulacao: renderSimulacao, calculadora: renderCalculadora, premissas: renderPremissas, base: renderBase,
    conferencia: renderConferencia, contabil: renderContabil, lancamentos: renderLancamentos, solicitacoes: renderSolicitacoes, coordenadores: renderCoordenadores, historico: renderHistorico,
  })[E.aba]();
}

function abrirModal({ titulo, sup = '', corpo, rodape = '', largo = false }) {
  const d = $('#modal');
  d.className = `modal${largo ? ' largo' : ''}`;
  d.innerHTML = `
    <header><div>${sup ? `<small>${esc(sup)}</small>` : ''}<h3>${esc(titulo)}</h3></div><button class="btn-ic" data-fechar aria-label="Fechar">✕</button></header>
    <div class="modal-corpo">${corpo}</div>
    ${rodape ? `<footer>${rodape}</footer>` : ''}`;
  d.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal();
  return d;
}

function opcoesMes(sel, comVazio = false) {
  return (comVazio ? '<option value="">—</option>' : '') + MESES.map((m, i) => `<option value="${i + 1}" ${Number(sel) === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
}

function faixaRascunho() {
  const n = Object.keys(E.rascunho).length;
  if (!n) return '';
  const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
  return `<div class="faixa-rascunho"><span>🧪 <b>Simulação não salva</b> · reajuste alterado em ${n} filial(is) · impacto no ano de <b>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</b></span>
    <span style="margin-left:auto;display:flex;gap:.5rem"><button class="btn btn-claro btn-sm" data-descartar>Descartar</button><button class="btn btn-laranja btn-sm" data-aplicar>Aplicar ao orçamento</button></span></div>`;
}

function ligarFaixa(raiz) {
  raiz.querySelector('[data-descartar]')?.addEventListener('click', descartarRascunho);
  raiz.querySelector('[data-aplicar]')?.addEventListener('click', aplicarRascunho);
}

function descartarRascunho() {
  E.rascunho = {};
  recalcular();
  renderAba();
}

async function aplicarRascunho() {
  const filiais = Object.entries(E.rascunho).map(([filial, r]) => ({ filial, ...r }));
  if (!filiais.length) return;
  try {
    await api('/api/filiais', { method: 'PUT', body: { filiais } });
    E.rascunho = {};
    await carregar();
    renderAba();
    toast(`Dissídio aplicado em ${filiais.length} filial(is).`);
  } catch (e) { toast(e.message, 'erro'); }
}

// ---------- Painel ----------

function renderPainel() {
  const el = painel('painel');
  const ano = E.dados.config.ano;
  const col = E.dados.colaboradores.filter(noFiltro);
  if (!E.dados.colaboradores.length) {
    el.innerHTML = `<div class="cartao vazio"><span>📥</span><h3>Nenhum colaborador na base ainda</h3>
      <p>${E.eu.admin ? 'Comece importando a base em <b>Base de colaboradores</b> (até a coluna salário).' : 'O time de orçamento ainda não carregou a base da sua regional.'}</p>
      ${E.eu.admin ? '<button class="btn btn-laranja" data-ir="base">Importar base</button>' : ''}</div>`;
    el.querySelector('[data-ir]')?.addEventListener('click', () => irPara('base'));
    return;
  }
  const ag = totalDe(E.res);
  const semD = totalDe(E.resSemDissidio);
  const grupos = Motor.porGrupo(ag);
  const somaG = id => grupos[id].reduce((a, b) => a + b, 0);
  const hcMedio = ag.hc.reduce((a, b) => a + b, 0) / 12;
  const colabMes = ag.hc.reduce((a, b) => a + b, 0);
  const vagas = col.filter(c => c.vaga).length;
  const impacto = ag.total - semD.total;
  const impactoAnt = totalDe(E.resSoDissAnt).total - semD.total; // parte do dissídio do ano anterior
  const fil = filiaisComRascunho();
  const mesesDiss = mesesDeDissidio([...new Set(col.map(c => c.filial))].map(f => fil[f]));
  const encBen = (somaG('encargos') + somaG('beneficios')) / (ag.total || 1);
  const escopo = [escopoFiltro(E.eu.admin ? 'Todas as regionais' : E.eu.regionais.join(' · ')), ccFiltrado(), nomeContaFiltro()].filter(Boolean).join(' · ');
  const nivelCards = E.filtro.filial ? 'cc' : E.filtro.regional ? 'filial' : 'regional';
  const tituloCards = { regional: 'Custo por regional', filial: `Filiais da regional ${E.filtro.regional}`, cc: `Centros de custo · ${E.filtro.filial}` }[nivelCards];

  // Ponte: salário → adicionais e HE → provisões → encargos → benefícios → demais = total
  const salAno = [...ag.porRubrica.slice(0, 12)].reduce((a, b) => a + b, 0);
  const passos = [
    { nome: 'Salários', valor: salAno, cor: '#164d74' },
    { nome: 'Adicionais e HE', valor: somaG('remuneracao') - salAno, cor: COR_GRUPO.remuneracao },
    { nome: 'Provisões', valor: somaG('provisoes'), cor: COR_GRUPO.provisoes },
    { nome: 'Encargos', valor: somaG('encargos'), cor: COR_GRUPO.encargos },
    { nome: 'Benefícios', valor: somaG('beneficios'), cor: COR_GRUPO.beneficios },
    { nome: 'Demais', valor: somaG('demais'), cor: COR_GRUPO.demais },
  ];

  const kpi = (ic, cor, rotulo, valor, nota, id = '') => `<div class="kpi2"><span class="kpi2-ic" style="--c:${cor}">${ic}</span><div><span>${rotulo}</span><strong${id ? ` id="${id}"` : ''}>${valor}</strong><small>${nota}</small></div></div>`;

  const topo = `
    ${faixaRascunho()}
    <div class="painel-topo">
      <div><small>ORÇAMENTO DE PESSOAL · ${esc(ano)}</small><h1>${esc(escopo)}</h1></div>
      <div class="painel-acoes">
        <div class="segmentos" id="painel-visao"><button data-v="custo" class="${E.painelVisao === 'custo' ? 'ativo' : ''}">💰 Custo</button><button data-v="hc" class="${E.painelVisao === 'hc' ? 'ativo' : ''}">👥 Headcount</button></div>
        ${E.resAnt ? `<div class="segmentos" id="painel-comp" title="Compare o orçamento com o realizado de ${anoAnt()}"><button data-c="0" class="${E.comparar ? '' : 'ativo'}">Só ${esc(ano)}</button><button data-c="1" class="${E.comparar ? 'ativo' : ''}">${anoAnt()} × ${esc(ano)}</button></div>` : ''}
        <button class="btn btn-marinho" id="btn-apresentar">▶ Modo apresentação</button>
      </div>
    </div>`;
  const ligarTopo = () => {
    ligarFaixa(el);
    $('#btn-apresentar', el).addEventListener('click', alternarApresentacao);
    $$('#painel-visao button', el).forEach(b => b.addEventListener('click', () => { E.painelVisao = b.dataset.v; renderPainel(); }));
    $$('#painel-comp button', el).forEach(b => b.addEventListener('click', () => { E.comparar = b.dataset.c === '1'; renderPainel(); }));
    ligarLegenda(el);
  };
  if (E.painelVisao === 'hc') {
    el.innerHTML = topo + '<div id="painel-hc"></div>';
    ligarTopo();
    desenharHeadcount($('#painel-hc', el), col);
    return;
  }
  if (E.comparar && E.resAnt) {
    el.innerHTML = `${topo}<div id="painel-comparativo"></div>${legendaPremissasHtml()}`;
    ligarTopo();
    desenharComparativo($('#painel-comparativo', el));
    return;
  }

  el.innerHTML = `
    ${topo}
    <section class="hero2">
      <div class="pontilhado"></div>
      <div class="hero2-num">
        <small>${E.filtro.conta ? `CUSTO ANUAL · ${esc(nomeContaFiltro().toUpperCase())}` : 'CUSTO ANUAL DE PESSOAL'}</small>
        <div class="hero2-total" id="hero-total">${brl0.format(ag.total)}</div>
        <p>média de <b>${brl0.format(ag.total / 12)}</b> por mês · <b>${num0.format(hcMedio)}</b> colaboradores em média</p>
        <div class="hero2-chips">
          ${impacto ? `<span class="chip-claro">📈 dissídio <b>+${Graficos.curto(impacto)}</b> no ano</span>` : ''}
          ${vagas ? `<span class="chip-claro">🧑‍💼 <b>${vagas}</b> vaga(s) prevista(s)</span>` : ''}
          <span class="chip-claro">🏢 <b>${new Set(col.map(c => c.filial)).size}</b> filiais</span>
        </div>
      </div>
      <div class="hero2-graf"><small>EVOLUÇÃO MÊS A MÊS</small><div id="g-area"></div></div>
    </section>
    <div class="kpis2">
      ${kpi('👥', '#2f6fa3', 'Headcount médio', num0.format(hcMedio), vagas ? `${vagas} vaga(s) no ano` : 'sem vagas previstas')}
      ${kpi('💼', '#8b5fbf', 'Custo médio por colaborador', brl0.format(colabMes ? ag.total / colabMes : 0), 'por mês, com encargos e benefícios')}
      ${kpi('📈', '#ec6b24', 'Impacto do dissídio', `${impacto >= 0 ? '+' : ''}${brl0.format(impacto)}`, semD.total ? `${pctFmt(impacto / semD.total)} sobre o custo sem reajuste${impactoAnt ? ` · ${anoAnt()} +${Graficos.curto(impactoAnt)} · ${esc(ano)} +${Graficos.curto(impacto - impactoAnt)}` : ''}` : '–')}
      ${kpi('🧾', '#2a9d8f', 'Encargos + benefícios', pctFmt(encBen), 'do custo total')}
    </div>
    <div class="grade-2">
      <section class="cartao"><h3>Custo mês a mês <small>· por grupo${mesesDiss.length ? ' · meses de dissídio em laranja' : ''}</small></h3><div id="g-meses"></div></section>
      <section class="cartao"><h3>Para onde vai o custo</h3><div id="g-comp"></div></section>
    </div>
    <section class="cartao" style="margin-top:1.2rem"><h3>Do salário ao custo total <small>· quanto cada grupo soma ao ano</small></h3><div id="g-ponte"></div></section>
    <section style="margin-top:1.4rem">
      <h2 class="titulo-bloco">${esc(tituloCards)}</h2>
      <div class="cards-escopo" id="g-cards"></div>
    </section>
    <section class="cartao" style="margin-top:1.2rem" id="g-conf"></section>
    ${legendaPremissasHtml()}`;
  ligarTopo();
  Graficos.contar($('#hero-total', el), ag.total, v => brl0.format(v));

  Graficos.areaAno($('#g-area', el), [...ag.meses], MESES, { destaque: mesesDiss });
  Graficos.colunasEmpilhadas($('#g-meses', el), {
    rotulos: MESES,
    series: GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valores: [...grupos[g.id]] })),
    destaque: mesesDiss,
  });
  Graficos.rosca($('#g-comp', el), GRUPOS.map(g => ({ nome: g.nome, cor: g.cor, valor: somaG(g.id) })), { centro: Graficos.curto(ag.total), sub: 'no ano' });
  Graficos.ponte($('#g-ponte', el), passos, { total: ag.total });

  // Cards por regional / filial / centro de custo, com minigráfico do ano
  const chave = { regional: c => c.regional, filial: c => c.filial, cc: c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}` }[nivelCards];
  const itens = [...Motor.agregar(E.res, chave, noFiltro)].sort((a, b) => b[1].total - a[1].total);
  $('#g-cards', el).innerHTML = itens.map(([k, a], i) => {
    const hc = a.hc.reduce((x, y) => x + y, 0);
    const clicavel = nivelCards !== 'cc';
    return `<${clicavel ? 'button' : 'div'} class="card-escopo" ${clicavel ? `data-ir="${esc(k)}"` : ''}>
      <div class="card-escopo-topo"><span class="card-pos">${i + 1}</span><strong title="${esc(k)}">${esc(k)}</strong></div>
      <div class="card-escopo-valor">${brl0.format(a.total)}</div>
      <div class="card-escopo-barra"><i style="width:${(a.total / (ag.total || 1)) * 100}%"></i></div>
      <div class="card-escopo-info"><span>${pctFmt(a.total / (ag.total || 1))} do total</span><span>${num0.format(hc / 12)} colab. · ${brl0.format(hc ? a.total / hc : 0)}/mês</span></div>
      ${Graficos.minilinha([...a.meses], '#ec6b24')}
    </${clicavel ? 'button' : 'div'}>`;
  }).join('');
  $$('#g-cards [data-ir]', el).forEach(b => b.addEventListener('click', () => {
    if (nivelCards === 'regional') { E.filtro.regional = b.dataset.ir; E.filtro.filial = ''; }
    else E.filtro.filial = b.dataset.ir;
    montarFiltros();
    renderPainel();
    desenharBarraApresentacao();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // Conferência das filiais
  const fils = filiaisVisiveis();
  const abertas = E.solic.filter(s => s.status === 'aberta' || s.status === 'em_analise');
  const conferidas = fils.filter(f => E.dados.filiais[f].conferencia === 'conferida').length;
  const frac = fils.length ? conferidas / fils.length : 0;
  const C = 2 * Math.PI * 34;
  $('#g-conf', el).innerHTML = `
    <div class="conf-resumo">
      <svg viewBox="0 0 84 84" class="conf-anel"><circle cx="42" cy="42" r="34" class="trilho"/><circle cx="42" cy="42" r="34" class="carga" stroke-dasharray="${C * frac} ${C}" transform="rotate(-90 42 42)"/>
        <text x="42" y="47" text-anchor="middle">${Math.round(frac * 100)}%</text></svg>
      <div><h3>Conferência pelos coordenadores</h3><p><b>${conferidas}</b> de <b>${fils.length}</b> filiais conferidas · <b>${abertas.filter(s => fils.includes(s.filial)).length}</b> pedido(s) de ajuste em aberto</p></div>
    </div>
    <div class="conf-chips">${fils.map(f => {
      const cfg = E.dados.filiais[f];
      const n = abertas.filter(s => s.filial === f).length;
      const ok = cfg.conferencia === 'conferida';
      return `<span class="conf-chip ${ok ? 'ok' : ''}" title="${ok ? `Conferida por ${esc(cfg.conferida_por || '')}` : 'Pendente'}">${ok ? '✓' : '○'} ${esc(f)}${n ? ` <b>${n}</b>` : ''}</span>`;
    }).join('')}</div>`;
}

// ----- Comparativo com o ano anterior (realizado × orçado) -----

const COR_ANT = '#f08a3c';
const COR_ATUAL = '#2f6fa3';
const somaRub = (ag, k) => { let s = 0; for (let m = 0; m < 12; m++) s += ag.porRubrica[k * 12 + m]; return s; };
const sinal = v => (v > 0 ? '+' : v < 0 ? '−' : '');
const deltaFmt = v => `${sinal(v)}${brl0.format(Math.abs(v))}`;
const deltaPct = (d, base) => (base ? `${sinal(d)}${(Math.abs(d / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(d / base) < 0.01 ? 2 : 1 })}%` : '–');
const clsDelta = v => (v > 0.5 ? 'delta-sobe' : v < -0.5 ? 'delta-desce' : '');

function desenharComparativo(box) {
  const ano = E.dados.config.ano;
  const ant = anoAnt();
  const a1 = totalDe(E.resCmp);
  const a0 = totalDe(E.resAnt);
  const d = a1.total - a0.total;
  const hcSoma = ag => ag.hc.reduce((x, y) => x + y, 0);
  const hc1 = hcSoma(a1), hc0 = hcSoma(a0);
  const medio1 = hc1 ? a1.total / hc1 : 0, medio0 = hc0 ? a0.total / hc0 : 0;
  // Variação de cada conta
  const contas = RUBRICAS.map((r, k) => ({ r, k, v0: somaRub(a0, k), v1: somaRub(a1, k) }))
    .map(x => ({ ...x, d: x.v1 - x.v0 })).filter(x => Math.abs(x.v0) + Math.abs(x.v1) >= 0.5);
  const porDelta = [...contas].sort((x, y) => y.d - x.d);
  const maior = porDelta[0];
  const aumentoBruto = contas.filter(x => x.d > 0).reduce((s, x) => s + x.d, 0);
  // Outros lançamentos só existem no orçamento
  const avulso = E.resCmp.colaboradores.reduce((s, c, i) => {
    if (!c.avulso || !noFiltro(c)) return s;
    for (let r = 0; r < RN; r++) for (let m = 0; m < 12; m++) s += E.resCmp.valor(i, r, m);
    return s;
  }, 0);
  const kpi = (ic, cor, rotulo, valor, nota) => `<div class="kpi2"><span class="kpi2-ic" style="--c:${cor}">${ic}</span><div><span>${rotulo}</span><strong>${valor}</strong><small>${nota}</small></div></div>`;
  const nivel = E.filtro.filial ? 'cc' : E.filtro.regional ? 'filial' : 'regional';
  const chaveNivel = { regional: c => c.regional, filial: c => c.filial, cc: c => rotuloCc(c) }[nivel];
  const nomeNivel = { regional: 'Regional', filial: 'Filial', cc: 'Centro de custo' }[nivel];

  box.innerHTML = `
    <section class="hero2 hero-comp">
      <div class="pontilhado"></div>
      <div class="hero2-num">
        <small>CUSTO ANUAL DE PESSOAL · ${ant} × ${esc(ano)}</small>
        <p class="comp-escopo">Remuneração, provisões, encargos e benefícios · o grupo Demais (treinamento, viagens, serviços…) fica fora do comparativo${notaProjecao() ? `<br>${notaProjecao()}` : ''}${notaProvisaoAnt() ? `<br>${notaProvisaoAnt()}` : ''}</p>
        <div class="comp-totais">
          <div><span style="--c:${COR_ANT}">${ant} · realizado</span><b>${brl0.format(a0.total)}</b></div>
          <div class="comp-seta">→</div>
          <div><span style="--c:#9cc3e4">${esc(ano)} · orçado</span><b>${brl0.format(a1.total)}</b></div>
        </div>
        <p>variação de <b>${deltaFmt(d)}</b> (<b>${deltaPct(d, a0.total)}</b>) no ano</p>
        <div class="hero2-chips">
          ${maior && maior.d > 0 ? `<span class="chip-claro">🔺 maior aumento: <b>${esc(maior.r.nome)}</b> ${deltaFmt(maior.d)}</span>` : ''}
          ${avulso ? `<span class="chip-claro" title="Outros lançamentos não têm correspondente no realizado de ${ant}">📌 outros lançamentos <b>${Graficos.curto(avulso)}</b> só em ${esc(ano)}</span>` : ''}
        </div>
      </div>
      <div class="hero2-graf"><small>CUSTO POR MÊS</small><div id="gc-mini"></div></div>
    </section>
    <div class="kpis2 kpis-comp" style="margin-bottom:1.2rem">
      ${kpi('💰', '#164d74', `Custo comparado ${esc(ano)}`, brl0.format(a1.total), `${deltaPct(d, a0.total)} sobre ${ant} (${brl0.format(a0.total)})`)}
      ${kpi('📈', '#ec6b24', 'Aumento no ano', deltaFmt(d), aumentoBruto ? `contas que sobem somam ${deltaFmt(aumentoBruto)}` : 'nenhuma conta sobe')}
      ${kpi('👥', COR_ATUAL, 'Headcount médio', `${num0.format(hc0 / 12)} → ${num0.format(hc1 / 12)}`, `${sinal(hc1 - hc0)}${num0.format(Math.abs(hc1 - hc0) / 12)} pessoa(s) em média`)}
      ${kpi('💼', '#8b5fbf', 'Custo médio por colaborador', brl0.format(medio1), `por mês · ${ant}: ${brl0.format(medio0)} (${deltaPct(medio1 - medio0, medio0)})`)}
      ${kpi('🔺', '#c2410c', 'Maior aumento', maior && maior.d > 0 ? esc(maior.r.nome) : '–', maior && maior.d > 0 ? `${deltaFmt(maior.d)} · ${pctFmt(d > 0 ? maior.d / d : 0)} da variação` : 'nenhuma conta sobe')}
    </div>
    <section class="cartao"><h3>Custo mês a mês <small>· ${ant} realizado × ${esc(ano)} orçado${notaProjecao() ? ` · * ${notaProjecao()}` : ''}</small></h3><div id="gc-meses"></div>
      <div class="tabela-wrap" style="margin-top:.6rem"><table class="tabela tabela-comp-mes"><thead><tr><th></th>${rotulosAnt().map(m => `<th class="n"${m.endsWith('*') ? ` title="${esc(notaProjecao())}"` : ''}>${m}</th>`).join('')}<th class="n">Ano</th></tr></thead><tbody>
        <tr><td><i class="bola" style="background:${COR_ANT}"></i>${ant}</td>${[...a0.meses].map(v => `<td class="n">${Graficos.curto(v)}</td>`).join('')}<td class="n"><b>${Graficos.curto(a0.total)}</b></td></tr>
        <tr><td><i class="bola" style="background:${COR_ATUAL}"></i>${esc(ano)}</td>${[...a1.meses].map(v => `<td class="n">${Graficos.curto(v)}</td>`).join('')}<td class="n"><b>${Graficos.curto(a1.total)}</b></td></tr>
        <tr class="linha-delta"><td>Δ R$</td>${MESES.map((_, m) => { const x = a1.meses[m] - a0.meses[m]; return `<td class="n ${clsDelta(x)}">${sinal(x)}${Graficos.curto(Math.abs(x))}</td>`; }).join('')}<td class="n ${clsDelta(d)}"><b>${sinal(d)}${Graficos.curto(Math.abs(d))}</b></td></tr>
        <tr class="linha-delta"><td>Δ %</td>${MESES.map((_, m) => { const x = a1.meses[m] - a0.meses[m]; return `<td class="n ${clsDelta(x)}">${deltaPct(x, a0.meses[m])}</td>`; }).join('')}<td class="n ${clsDelta(d)}"><b>${deltaPct(d, a0.total)}</b></td></tr>
      </tbody></table></div></section>
    <div class="grade-2" style="margin-top:1.2rem">
      <section class="cartao"><h3>De ${ant} para ${esc(ano)} <small>· o que mais explica a variação, por conta</small></h3><div id="gc-ponte"></div></section>
      <section class="cartao"><h3>Variação por grupo</h3><div id="gc-grupos"></div></section>
    </div>
    <section class="cartao" style="margin-top:1.2rem">
      <h3>Ranking de aumento por conta <small>· clique numa conta para ver as filiais</small></h3>
      <div class="tabela-wrap"><table class="tabela tabela-ranking" id="gc-ranking"></table></div>
    </section>
    <section class="cartao" style="margin-top:1.2rem"><h3>${nomeNivel} <small>· ${ant} × ${esc(ano)}</small></h3>
      <div class="tabela-wrap"><table class="tabela tabela-ranking" id="gc-escopo"></table></div></section>`;

  Graficos.linhas($('#gc-mini', box), { rotulos: rotulosAnt(), series: [{ nome: String(ant), cor: COR_ANT, valores: [...a0.meses] }, { nome: String(ano), cor: '#9cc3e4', valores: [...a1.meses] }], formato: v => Graficos.curto(v), titulo: 'Custo por mês' });
  Graficos.colunasAgrupadas($('#gc-meses', box), { rotulos: rotulosAnt(), series: [{ nome: `${ant} realizado`, cor: COR_ANT, valores: [...a0.meses] }, { nome: `${ano} orçado`, cor: COR_ATUAL, valores: [...a1.meses] }], titulo: `Custo por mês ${ant} × ${ano}` });
  // Ponte: as 7 contas que mais mexem no total; o resto junto
  const porImpacto = [...contas].sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const top = porImpacto.slice(0, 7).sort((x, y) => y.d - x.d);
  const resto = porImpacto.slice(7).reduce((s, x) => s + x.d, 0);
  Graficos.ponteVariacao($('#gc-ponte', box), {
    inicio: a0.total, fim: a1.total, nomeInicio: String(ant), nomeFim: String(ano),
    passos: [...top.map(x => ({ nome: x.r.nome, valor: x.d })), ...(Math.abs(resto) >= 0.5 ? [{ nome: 'Outras contas', valor: resto }] : [])],
  });
  const grupos = GRUPOS.map(g => {
    const cs = contas.filter(x => x.r.grupo === g.id);
    return { g, v0: cs.reduce((s, x) => s + x.v0, 0), v1: cs.reduce((s, x) => s + x.v1, 0) };
  }).filter(x => x.v0 || x.v1);
  const maxG = Math.max(...grupos.map(x => Math.abs(x.v1 - x.v0)), 1);
  $('#gc-grupos', box).innerHTML = `<div class="comp-grupos">${grupos.map(x => {
    const dg = x.v1 - x.v0;
    return `<div class="comp-grupo"><span><i class="bola" style="background:${x.g.cor}"></i>${esc(x.g.nome)}</span>
      <div class="comp-barra"><i class="${dg >= 0 ? 'sobe' : 'desce'}" style="width:${(Math.abs(dg) / maxG) * 100}%"></i></div>
      <b class="${clsDelta(dg)}">${deltaFmt(dg)}</b><small>${brl0.format(x.v0)} → ${brl0.format(x.v1)} · ${deltaPct(dg, x.v0)}</small></div>`;
  }).join('')}</div>`;

  // Ranking por conta, com abertura por filial
  const fil0 = Motor.agregar(E.resAnt, c => c.filial, noFiltro);
  const fil1 = Motor.agregar(E.resCmp, c => c.filial, noFiltro);
  let aberta = null;
  const maxD = Math.max(...contas.map(x => Math.abs(x.d)), 1);
  const desenharRanking = () => {
    $('#gc-ranking', box).innerHTML = `<thead><tr><th>#</th><th>Conta</th><th>Grupo</th><th class="n">${ant}</th><th class="n">${esc(ano)}</th><th class="n">Δ R$</th><th class="n">Δ %</th><th style="min-width:140px">Peso na variação</th></tr></thead>
      <tbody>${porDelta.map((x, i) => {
        const linha = `<tr class="rk-linha${aberta === x.k ? ' aberto' : ''}" data-k="${x.k}" title="${esc(regraDaRubrica(x.r.id))}"><td>${i + 1}</td><td><span class="hc-seta">${aberta === x.k ? '▾' : '▸'}</span>${esc(x.r.nome)}</td><td><i class="bola" style="background:${COR_GRUPO[x.r.grupo]}"></i>${esc(NOME_GRUPO[x.r.grupo])}</td>
          <td class="n">${brl0.format(x.v0)}</td><td class="n">${brl0.format(x.v1)}</td><td class="n ${clsDelta(x.d)}"><b>${deltaFmt(x.d)}</b></td><td class="n ${clsDelta(x.d)}">${x.v0 ? deltaPct(x.d, x.v0) : 'novo'}</td>
          <td><div class="comp-barra"><i class="${x.d >= 0 ? 'sobe' : 'desce'}" style="width:${(Math.abs(x.d) / maxD) * 100}%"></i></div></td></tr>`;
        if (aberta !== x.k) return linha;
        const fs = [...new Set([...fil0.keys(), ...fil1.keys()])].map(f => {
          const v0 = fil0.has(f) ? somaRub(fil0.get(f), x.k) : 0;
          const v1 = fil1.has(f) ? somaRub(fil1.get(f), x.k) : 0;
          return { f, v0, v1, d: v1 - v0 };
        }).filter(y => Math.abs(y.v0) + Math.abs(y.v1) >= 0.5).sort((p, q) => q.d - p.d);
        return linha + fs.map(y => `<tr class="rk-filial"><td></td><td colspan="2">${esc(y.f)}</td><td class="n">${brl0.format(y.v0)}</td><td class="n">${brl0.format(y.v1)}</td><td class="n ${clsDelta(y.d)}">${deltaFmt(y.d)}</td><td class="n ${clsDelta(y.d)}">${y.v0 ? deltaPct(y.d, y.v0) : 'novo'}</td><td></td></tr>`).join('');
      }).join('') || '<tr><td colspan="8" class="vazio">Nada para comparar.</td></tr>'}</tbody>
      <tfoot><tr><td></td><td colspan="2">Total</td><td class="n">${brl0.format(a0.total)}</td><td class="n">${brl0.format(a1.total)}</td><td class="n">${deltaFmt(d)}</td><td class="n">${deltaPct(d, a0.total)}</td><td></td></tr></tfoot>`;
    $$('#gc-ranking tr.rk-linha', box).forEach(tr => tr.addEventListener('click', () => { const k = Number(tr.dataset.k); aberta = aberta === k ? null : k; desenharRanking(); }));
  };
  desenharRanking();

  // Regional / filial / centro de custo
  const n0 = Motor.agregar(E.resAnt, chaveNivel, noFiltro);
  const n1 = Motor.agregar(E.resCmp, chaveNivel, noFiltro);
  const itens = [...new Set([...n0.keys(), ...n1.keys()])].map(k => {
    const x0 = n0.get(k), x1 = n1.get(k);
    return { k, v0: x0?.total || 0, v1: x1?.total || 0, h0: x0 ? x0.hc[11] : 0, h1: x1 ? x1.hc[11] : 0 };
  }).sort((p, q) => (q.v1 - q.v0) - (p.v1 - p.v0));
  $('#gc-escopo', box).innerHTML = `<thead><tr><th>${nomeNivel}</th><th class="n">HC dez/${String(ant).slice(-2)}</th><th class="n">HC dez/${String(ano).slice(-2)}</th><th class="n">${ant}</th><th class="n">${esc(ano)}</th><th class="n">Δ R$</th><th class="n">Δ %</th></tr></thead>
    <tbody>${itens.map(x => `<tr><td>${esc(x.k)}</td><td class="n">${num0.format(x.h0)}</td><td class="n">${num0.format(x.h1)}</td><td class="n">${brl0.format(x.v0)}</td><td class="n">${brl0.format(x.v1)}</td><td class="n ${clsDelta(x.v1 - x.v0)}"><b>${deltaFmt(x.v1 - x.v0)}</b></td><td class="n ${clsDelta(x.v1 - x.v0)}">${x.v0 ? deltaPct(x.v1 - x.v0, x.v0) : 'novo'}</td></tr>`).join('')}</tbody>`;
}

/** Regra efetiva de uma conta nas filiais visíveis: o texto da premissa, ou "varia por filial". */
let _regras = new Map(); // memória por render (zerada em recalcular)
function regraDaRubrica(rid, fils = filiaisVisiveis()) {
  const chave = `${rid}|${E.filtro.sel.cc.join(',')}|${fils.join(',')}`;
  if (!_regras.has(chave)) _regras.set(chave, montarRegra(rid, fils));
  return _regras.get(chave);
}
function montarRegra(rid, fils) {
  const fixas = {
    salario: `salário da base, com o dissídio ${anoAnt()} (que a base ainda não tem) e o de ${E.dados.config.ano} na data-base · ${anoAnt()}: salário pago em cada mês (histórico) + dissídio ${anoAnt()} a partir da data-base, se lançado`,
  };
  if (fixas[rid]) return fixas[rid];
  const rub = RUBRICAS.find(r => r.id === rid);
  if (!rub) return '';
  if (rub?.soLancamento) return 'só pelos Outros lançamentos (valor e mês lançados)';
  const textos = new Map();
  for (const f of fils) {
    const t = descreverComQuem(Motor.premissaDe(E.dados.premissas, f, E.dados.filiais[f]?.regional, rid));
    if (!textos.has(t)) textos.set(t, []);
    textos.get(t).push(f);
  }
  if (!textos.size) return '';
  const regra = textos.size === 1 ? [...textos.keys()][0] : `varia por filial: ${[...textos].map(([t, fs]) => `${t} (${fs.length} filial${fs.length > 1 ? 'is' : ''})`).join(' · ')}`;
  // Valores próprios de cada colaborador (planilha da base ou lançados à mão) valem sobre a regra
  const set = new Set(fils);
  const colabs = E.dados.colaboradores.filter(c => set.has(c.filial) && noFiltro(c));
  const daBase = colabs.filter(c => c.excecoes?.[rid]?.origem === 'base').length;
  const manuais = colabs.filter(c => c.excecoes?.[rid] && c.excecoes[rid].origem !== 'base').length;
  const proprios = [daBase ? `${num0.format(daBase)} colaborador(es) com o valor da planilha da base` : '', manuais ? `${num0.format(manuais)} com valor próprio lançado` : ''].filter(Boolean).join(' · ');
  return proprios ? `${regra} · ${proprios} (vale sobre a regra)` : regra;
}

const BASE_FOLHA = 'salário + todo o grupo Remuneração (adicionais, HE, promoções)';
const NOTAS_LEGENDA = {
  ferias: `remuneração ÷ 12 + 1/3 (= ÷ 9) · remuneração = ${BASE_FOLHA}`,
  decimo: `remuneração ÷ 12 · remuneração = ${BASE_FOLHA}`,
  fgts: `remuneração = ${BASE_FOLHA}`,
  inss: `remuneração = ${BASE_FOLHA}`,
};

/** Legenda com a premissa de cada conta que tem custo no escopo filtrado (recolhível). */
function legendaPremissasHtml() {
  const ag = totalDe(E.res);
  const ag0 = E.resAnt ? totalDe(E.resAnt) : null;
  const fils = filiaisVisiveis();
  const linhas = RUBRICAS.map((r, k) => ({ r, k })).filter(({ k }) => somaRub(ag, k) || (ag0 && somaRub(ag0, k)));
  if (!linhas.length) return '';
  const reaj = [...new Set(fils.map(f => Number(E.dados.filiais[f]?.reaj_benef_pct) || 0))];
  const reajAnt = [...new Set(fils.map(f => Number(E.dados.filiais[f]?.reaj_benef_ant_pct) || 0))];
  const diss = [...new Set(fils.map(f => Number(E.dados.filiais[f]?.dissidio_pct) || 0))];
  const dissAnt = [...new Set(fils.map(f => Number(E.dados.filiais[f]?.dissidio_ant_pct) || 0))];
  const lista = v => (v.length === 1 ? `${fmtN(v[0])}%` : `de ${fmtN(Math.min(...v))}% a ${fmtN(Math.max(...v))}% conforme a filial`);
  return `<details class="cartao legenda-premissas" id="legenda-premissas"${E.legendaAberta ? ' open' : ''}>
    <summary><h3 style="display:inline">📖 Legenda das premissas <small>· como cada conta é calculada${E.comparar && E.resAnt ? ` em ${esc(E.dados.config.ano)} e em ${anoAnt()}` : ''}</small></h3></summary>
    <p class="subtitulo" style="margin:.4rem 0 .8rem">${dissAnt.some(Boolean) ? `Dissídio ${anoAnt()} ${lista(dissAnt)} · ` : ''}Dissídio ${esc(E.dados.config.ano)} ${lista(diss)} · ${reajAnt.some(Boolean) ? `reajuste de benefícios ${anoAnt()} ${lista(reajAnt)} · ` : ''}reajuste de benefícios ${esc(E.dados.config.ano)} ${lista(reaj)}.
      ${E.resAnt ? `<br>${anoAnt()}: salário realmente pago em cada mês (histórico carregado${notaProjecao() ? `; ${notaProjecao().replace(/^\d+: /, '')}` : ''}) com as mesmas regras abaixo, <b>sem</b> o dissídio e o reajuste de benefícios de ${esc(E.dados.config.ano)}; o dissídio e o reajuste de benefícios de ${anoAnt()} lançados nas filiais entram a partir da data-base (provisão). Outros lançamentos só entram em ${esc(E.dados.config.ano)}. O comparativo considera ${GRUPOS_CMP_TXT}; o grupo Demais fica fora.` : ''}</p>
    <table class="tabela tabela-legenda"><thead><tr><th>Conta</th><th>Grupo</th><th>Premissa</th></tr></thead><tbody>
      ${linhas.map(({ r }) => `<tr><td><b>${esc(r.nome)}</b></td><td><i class="bola" style="background:${COR_GRUPO[r.grupo]}"></i>${esc(NOME_GRUPO[r.grupo])}</td>
        <td>${esc(regraDaRubrica(r.id, fils))}${NOTAS_LEGENDA[r.id] ? `<span class="sub">${esc(NOTAS_LEGENDA[r.id])}</span>` : ''}${r.dica ? `<span class="sub">${esc(r.dica)}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></details>`;
}
function ligarLegenda(raiz) {
  $('#legenda-premissas', raiz)?.addEventListener('toggle', e => { E.legendaAberta = e.target.open; });
}

// ----- Headcount: cadeiras (colaboradores + vagas) por filial, centro de custo, gestor, cargo e função -----

const COR_OCUPADA = '#2f6fa3';
const COR_VAGA = '#ec6b24';
const DIMS_HC = {
  regional: { nome: 'Regional', chave: c => c.regional || '—' },
  filial: { nome: 'Filial', chave: c => c.filial || '—' },
  cc: { nome: 'Centro de custo', chave: c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}` },
  gestor: { nome: 'Gestor', chave: c => c.gestor || '(sem gestor na base)' },
  cargo: { nome: 'Nível do cargo', chave: c => c.cargo || '(sem nível)' },
  funcao: { nome: 'Função', chave: c => c.funcao || '(sem função)' },
};
const ativoNoMes = (c, m) => m + 1 >= (Number(c.mes_inicio) || 1) && m + 1 <= (Number(c.mes_fim) || 12);

/** Números de headcount de uma lista de colaboradores/vagas. */
function numerosHc(lista) {
  const ocupadas = MESES.map((_, m) => lista.filter(c => !c.vaga && ativoNoMes(c, m)).length);
  const vagasMes = MESES.map((_, m) => lista.filter(c => c.vaga && ativoNoMes(c, m)).length);
  return {
    cadeiras: lista.length,
    ocupadas: lista.filter(c => !c.vaga).length,
    vagas: lista.filter(c => c.vaga).length,
    deslig: lista.filter(c => !c.vaga && (Number(c.mes_fim) || 12) < 12).length,
    jan: ocupadas[0] + vagasMes[0],
    dez: ocupadas[11] + vagasMes[11],
    ocupadasMes: ocupadas,
    vagasMes,
  };
}

function desenharHeadcount(el, col) {
  const n = numerosHc(col);
  const dimsVisiveis = Object.entries(DIMS_HC).filter(([k]) => !(k === 'regional' && E.filtro.regional));
  if (!dimsVisiveis.some(([k]) => k === E.hc.dim)) E.hc.dim = 'filial';
  const dim = DIMS_HC[E.hc.dim];
  const semGestor = col.filter(c => !c.gestor).length;
  const kpi = (ic, cor, rotulo, valor, nota) => `<div class="kpi2"><span class="kpi2-ic" style="--c:${cor}">${ic}</span><div><span>${rotulo}</span><strong>${valor}</strong><small>${nota}</small></div></div>`;
  const varAno = n.dez - n.jan;
  // Comparativo: headcount do ano anterior (quem teve salário pago no mês)
  const comp = Boolean(E.comparar && E.resAnt);
  const antCol = comp ? E.resAnt.colaboradores.filter(noFiltro) : [];
  const hcAntMes = lista => MESES.map((_, m) => lista.filter(c => Number(c.salarios?.[m]) > 0).length);
  const antMes = hcAntMes(antCol);
  const a2 = String(anoAnt()).slice(-2), a1 = String(E.dados.config.ano).slice(-2);
  el.innerHTML = `
    <div class="kpis2 kpis-hc">
      ${kpi('🪑', '#164d74', 'Cadeiras no orçamento', num0.format(n.cadeiras), 'colaboradores + vagas previstas')}
      ${kpi('👤', COR_OCUPADA, 'Ocupadas', num0.format(n.ocupadas), `${pctFmt(n.ocupadas / (n.cadeiras || 1))} das cadeiras`)}
      ${kpi('🧑‍💼', COR_VAGA, 'Vagas previstas', num0.format(n.vagas), n.vagas ? 'novas posições no ano' : 'nenhuma vaga prevista')}
      ${kpi('🚪', '#8b5fbf', 'Desligamentos previstos', num0.format(n.deslig), 'saídas antes de dezembro')}
      ${kpi('📅', '#2a9d8f', 'HC janeiro → dezembro', `${num0.format(n.jan)} → ${num0.format(n.dez)}`, varAno ? `${varAno > 0 ? '+' : ''}${num0.format(varAno)} no ano` : 'estável no ano')}
    </div>
    ${comp ? `<section class="cartao" style="margin-bottom:1.2rem"><h3>Evolução do headcount <small>· ${anoAnt()} realizado × ${esc(E.dados.config.ano)} orçado (ocupadas + vagas) · dez/${a2} ${num0.format(antMes[11])} → dez/${a1} ${num0.format(n.dez)} (${sinal(n.dez - antMes[11])}${num0.format(Math.abs(n.dez - antMes[11]))})${notaProjecao() ? ` · * ${notaProjecao()}` : ''}</small></h3><div id="g-hc-comp"></div></section>` : ''}
    <section class="cartao"><h3>Headcount mês a mês <small>· pessoas ativas em cada mês, ocupadas e vagas</small></h3><div id="g-hc-meses"></div></section>
    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas" style="margin-bottom:.8rem">
        <h3 style="margin:0">Cadeiras por</h3>
        <div class="segmentos" id="hc-dim">${dimsVisiveis.map(([k, d]) => `<button data-d="${k}" class="${k === E.hc.dim ? 'ativo' : ''}">${d.nome}</button>`).join('')}</div>
        <input class="campo" id="hc-busca" placeholder="Buscar…" value="${esc(E.hc.busca)}" style="min-width:180px">
        <span class="direita"><button class="btn btn-marinho btn-sm" id="hc-excel">⬇ Excel</button></span>
      </div>
      ${E.hc.dim === 'gestor' && semGestor ? `<p class="aviso-ajuste" style="margin:0 0 .8rem">ℹ️ ${num0.format(semGestor)} cadeira(s) sem gestor: inclua a coluna <b>GESTOR</b> na base (opcional) para ver a distribuição por gestor.</p>` : ''}
      <div class="legenda" style="margin-bottom:.4rem"><span><i style="background:${COR_OCUPADA}"></i>Ocupadas</span><span><i style="background:${COR_VAGA}"></i>Vagas</span></div>
      <div class="tabela-wrap alta" id="hc-tabela"></div>
    </section>`;

  if (comp) {
    Graficos.linhas($('#g-hc-comp', el), {
      rotulos: rotulosAnt(), titulo: 'Headcount por mês nos dois anos', formato: v => num0.format(v),
      series: [{ nome: `${anoAnt()} realizado`, cor: COR_ANT, valores: antMes }, { nome: `${E.dados.config.ano} orçado`, cor: COR_ATUAL, valores: MESES.map((_, m) => n.ocupadasMes[m] + n.vagasMes[m]) }],
    });
  }
  Graficos.colunasEmpilhadas($('#g-hc-meses', el), {
    rotulos: MESES, titulo: 'Headcount por mês',
    series: [{ nome: 'Ocupadas', cor: COR_OCUPADA, valores: n.ocupadasMes }, { nome: 'Vagas', cor: COR_VAGA, valores: n.vagasMes }],
    formato: v => `${num0.format(v)} pessoa(s)`, curtoFmt: v => num0.format(v),
  });

  // Custo de cada cadeira no ano (todas as contas), para separar o custo das ocupadas e das vagas.
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const custoDe = c => {
    const i = idx.get(c.id);
    if (i == null) return 0;
    let t = 0;
    for (let r = 0; r < RUBRICAS.length; r++) for (let m = 0; m < 12; m++) t += E.res.valor(i, r, m);
    return t;
  };
  const custoId = new Map(col.map(c => [c.id, custoDe(c)]));
  const resumo = (k, lista) => {
    const n2 = numerosHc(lista);
    const custoOcup = lista.filter(c => !c.vaga).reduce((a, c) => a + (custoId.get(c.id) || 0), 0);
    const custoVaga = lista.filter(c => c.vaga).reduce((a, c) => a + (custoId.get(c.id) || 0), 0);
    const hcMeses = n2.ocupadasMes.reduce((a, x) => a + x, 0) + n2.vagasMes.reduce((a, x) => a + x, 0);
    return { k, lista, ...n2, filiais: new Set(lista.map(c => c.filial)).size, custoOcup, custoVaga, custo: custoOcup + custoVaga, medio: hcMeses ? (custoOcup + custoVaga) / hcMeses : 0 };
  };
  const agrupar = (lista, chave) => {
    const g = new Map();
    lista.forEach(c => { const k = chave(c); if (!g.has(k)) g.set(k, []); g.get(k).push(c); });
    return [...g].map(([k, l]) => resumo(k, l)).sort((x, y) => y.cadeiras - x.cadeiras || x.k.localeCompare(y.k));
  };
  const filtrados = () => { const b = E.hc.busca.trim().toLowerCase(); return col.filter(c => !b || dim.chave(c).toLowerCase().includes(b)); };
  const antDe = k => antCol.filter(c => dim.chave(c) === k);
  const linhasHc = () => {
    const ls = agrupar(filtrados(), dim.chave);
    if (comp) {
      // chaves que só existem no ano anterior (ex.: função que deixou de existir)
      const b = E.hc.busca.trim().toLowerCase();
      const tem = new Set(ls.map(l => l.k));
      [...new Set(antCol.map(dim.chave))].filter(k => !tem.has(k) && (!b || k.toLowerCase().includes(b))).forEach(k => ls.push(resumo(k, [])));
      ls.forEach(l => { l.antMes = hcAntMes(antDe(l.k)); });
    }
    return ls;
  };
  const mini24 = l => {
    const v = [...l.antMes, ...MESES.map((_, m) => l.ocupadasMes[m] + l.vagasMes[m])];
    const L = 120, A = 30, max = Math.max(...v, 1), min = Math.min(...v);
    const pt = (x, i) => `${(L * i) / 23},${A - 4 - ((x - min) / (max - min || 1)) * (A - 8)}`;
    return `<svg class="minilinha" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${v.slice(0, 12).map((x, i) => pt(x, i)).join(' ')}" fill="none" stroke="${COR_ANT}" stroke-width="2" vector-effect="non-scaling-stroke"/><polyline points="${v.slice(11).map((x, i) => pt(x, i + 11)).join(' ')}" fill="none" stroke="${COR_ATUAL}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const colsComp = l => (comp ? `<td class="n">${num0.format(l.antMes[11])}</td><td class="n ${clsDelta(l.dez - l.antMes[11])}"><b>${l.dez - l.antMes[11] ? `${sinal(l.dez - l.antMes[11])}${num0.format(Math.abs(l.dez - l.antMes[11]))}` : '='}</b></td><td style="min-width:110px" title="${anoAnt()} em laranja, ${esc(E.dados.config.ano)} em azul">${mini24(l)}</td>` : '');
  const colFiliais = E.hc.dim !== 'filial' && E.hc.dim !== 'regional';
  const barraHc = (l, max) => `<div class="hc-barra" title="${l.ocupadas} ocupada(s) · ${l.vagas} vaga(s)"><i style="width:${(l.ocupadas / max) * 100}%;background:${COR_OCUPADA}"></i><i style="width:${(l.vagas / max) * 100}%;background:${COR_VAGA}"></i><b>${num0.format(l.cadeiras)}</b></div>`;
  const zero = v => (v ? num0.format(v) : '–');
  const custoVagaCel = v => `<td class="n${v ? ' custo-vaga' : ' zero'}">${v ? brl0.format(v) : '–'}</td>`;

  // Detalhe de uma linha: quebra por outra dimensão + a lista das cadeiras
  const detalheHc = l => {
    const subs = Object.entries(DIMS_HC).filter(([k]) => k !== E.hc.dim && !(k === 'regional' && (E.filtro.regional || E.hc.dim === 'filial')));
    if (!subs.some(([k]) => k === E.hc.sub)) E.hc.sub = 'funcao';
    const sub = DIMS_HC[E.hc.sub];
    const sl = agrupar(l.lista, sub.chave);
    const max = Math.max(...sl.map(x => x.cadeiras), 1);
    const pessoas = [...l.lista].sort((a, b) => (a.vaga - b.vaga) || String(a.funcao).localeCompare(String(b.funcao)) || a.nome.localeCompare(b.nome));
    const periodo = c => (c.mes_inicio > 1 || c.mes_fim < 12 ? `${MESES[(c.mes_inicio || 1) - 1]}–${MESES[(c.mes_fim || 12) - 1]}` : 'Ano todo');
    return `<div class="hc-det-caixa">
      <div class="ferramentas" style="margin-bottom:.6rem"><b style="color:var(--marinho)">${esc(l.k)} · por</b>
        <div class="segmentos" id="hc-sub">${subs.map(([k, d]) => `<button data-s="${k}" class="${k === E.hc.sub ? 'ativo' : ''}">${d.nome}</button>`).join('')}</div></div>
      <table class="tabela tabela-hc tabela-hc-sub"><thead><tr><th>${sub.nome}</th><th style="min-width:150px">Cadeiras</th><th class="n">Ocupadas</th><th class="n">Vagas</th><th class="n">Desligam.</th><th class="n">Custo ocupadas</th><th class="n">Custo vagas</th><th class="n">Custo no ano</th><th class="n">Custo médio / mês</th></tr></thead>
        <tbody>${sl.map(x => `<tr><td title="${esc(x.k)}">${esc(x.k)}</td><td>${barraHc(x, max)}</td><td class="n">${num0.format(x.ocupadas)}</td><td class="n${x.vagas ? '' : ' zero'}">${zero(x.vagas)}</td><td class="n${x.deslig ? '' : ' zero'}">${zero(x.deslig)}</td>
          <td class="n">${brl0.format(x.custoOcup)}</td>${custoVagaCel(x.custoVaga)}<td class="n"><b>${brl0.format(x.custo)}</b></td><td class="n">${brl0.format(x.medio)}</td></tr>`).join('')}</tbody></table>
      <details class="hc-pessoas"><summary>Ver as ${num0.format(l.cadeiras)} cadeira(s) de ${esc(l.k)}</summary>
        <div class="tabela-wrap" style="max-height:360px"><table class="tabela tabela-hc"><thead><tr><th>Colaborador / vaga</th><th>Situação</th><th>Função</th><th>Nível do cargo</th><th>Centro de custo</th>${E.hc.dim !== 'gestor' ? '<th>Gestor</th>' : ''}${E.hc.dim !== 'filial' ? '<th>Filial</th>' : ''}<th>Período</th><th class="n">Salário</th><th class="n">Custo no ano</th></tr></thead>
        <tbody>${pessoas.map(c => `<tr class="${c.vaga ? 'vaga' : ''}"><td>${esc(c.nome)}${c.matricula ? `<span class="sub">${esc(c.matricula)}</span>` : ''}</td><td>${c.vaga ? '<span class="etiqueta pend">vaga</span>' : (c.mes_fim < 12 ? '<span class="etiqueta neutra">desligamento</span>' : 'Ocupada')}</td>
          <td>${esc(c.funcao || '')}</td><td>${esc(c.cargo || '')}</td><td>${esc(rotuloCc(c))}</td>${E.hc.dim !== 'gestor' ? `<td>${esc(c.gestor || '—')}</td>` : ''}${E.hc.dim !== 'filial' ? `<td>${esc(c.filial)}</td>` : ''}<td>${periodo(c)}</td>
          <td class="n">${brl.format(c.salario)}</td><td class="n">${brl0.format(custoId.get(c.id) || 0)}</td></tr>`).join('')}</tbody></table></div></details>
    </div>`;
  };

  const desenharTabela = () => {
    const linhas = linhasHc();
    const max = Math.max(...linhas.map(l => l.cadeiras), 1);
    const tot = resumo('Total', filtrados());
    const nCols = 12 + (colFiliais ? 1 : 0) + (comp ? 3 : 0);
    if (comp) tot.antMes = hcAntMes(antCol);
    $('#hc-tabela', el).innerHTML = `<table class="tabela tabela-hc"><thead><tr>
        <th>${dim.nome}</th><th style="min-width:170px">Cadeiras</th><th class="n">Ocupadas</th><th class="n">Vagas</th><th class="n">Desligam.</th>
        <th class="n">HC jan</th><th class="n">HC dez${comp ? `/${a1}` : ''}</th>${comp ? `<th class="n">HC dez/${a2}</th><th class="n">Δ HC</th><th>${anoAnt()} → ${esc(E.dados.config.ano)}</th>` : ''}${colFiliais ? '<th class="n">Filiais</th>' : ''}<th class="n">Custo ocupadas</th><th class="n">Custo vagas</th><th class="n">Custo no ano</th><th class="n">Custo médio / mês</th></tr></thead>
      <tbody>${linhas.map(l => `<tr class="hc-linha${E.hc.aberto === l.k ? ' aberto' : ''}" data-hc="${esc(l.k)}" title="Clique para ${E.hc.aberto === l.k ? 'fechar' : 'ver cargos, funções, custos e as cadeiras'}">
        <td title="${esc(l.k)}"><span class="hc-seta">${E.hc.aberto === l.k ? '▾' : '▸'}</span>${esc(l.k)}</td>
        <td>${barraHc(l, max)}</td>
        <td class="n">${num0.format(l.ocupadas)}</td><td class="n${l.vagas ? '' : ' zero'}">${zero(l.vagas)}</td><td class="n${l.deslig ? '' : ' zero'}">${zero(l.deslig)}</td>
        <td class="n">${num0.format(l.jan)}</td><td class="n">${num0.format(l.dez)}</td>${colsComp(l)}${colFiliais ? `<td class="n">${l.filiais}</td>` : ''}
        <td class="n">${brl0.format(l.custoOcup)}</td>${custoVagaCel(l.custoVaga)}<td class="n"><b>${brl0.format(l.custo)}</b></td><td class="n">${brl0.format(l.medio)}</td></tr>
        ${E.hc.aberto === l.k ? `<tr class="hc-det"><td colspan="${nCols}">${detalheHc(l)}</td></tr>` : ''}`).join('') || `<tr><td colspan="${nCols}" class="vazio">Nada para mostrar.</td></tr>`}</tbody>
      <tfoot><tr><td>Total · ${linhas.length} ${dim.nome.toLowerCase()}(s)</td><td><b>${num0.format(tot.cadeiras)}</b></td><td class="n">${num0.format(tot.ocupadas)}</td><td class="n">${num0.format(tot.vagas)}</td><td class="n">${num0.format(tot.deslig)}</td>
        <td class="n">${num0.format(tot.jan)}</td><td class="n">${num0.format(tot.dez)}</td>${comp ? `<td class="n">${num0.format(tot.antMes[11])}</td><td class="n ${clsDelta(tot.dez - tot.antMes[11])}">${sinal(tot.dez - tot.antMes[11])}${num0.format(Math.abs(tot.dez - tot.antMes[11]))}</td><td></td>` : ''}${colFiliais ? '<td></td>' : ''}<td class="n">${brl0.format(tot.custoOcup)}</td><td class="n">${brl0.format(tot.custoVaga)}</td><td class="n">${brl0.format(tot.custo)}</td><td class="n">${brl0.format(tot.medio)}</td></tr></tfoot></table>`;
    $$('#hc-tabela tr.hc-linha', el).forEach(tr => tr.addEventListener('click', () => { E.hc.aberto = E.hc.aberto === tr.dataset.hc ? '' : tr.dataset.hc; desenharTabela(); }));
    $$('#hc-sub button', el).forEach(b2 => b2.addEventListener('click', () => { E.hc.sub = b2.dataset.s; desenharTabela(); }));
    return linhas;
  };
  desenharTabela();
  $$('#hc-dim button', el).forEach(b => b.addEventListener('click', () => { E.hc.dim = b.dataset.d; E.hc.busca = ''; E.hc.aberto = ''; desenharHeadcount(el, col); }));
  $('#hc-busca', el).addEventListener('input', e => { E.hc.busca = e.target.value; desenharTabela(); });
  $('#hc-excel', el).addEventListener('click', () => {
    if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
    const linhas = linhasHc();
    const aoa = [[dim.nome, 'Cadeiras', 'Ocupadas', 'Vagas', 'Desligamentos previstos', 'HC jan', 'HC dez', ...MESES.map(m => `HC ${m}`), 'Custo ocupadas', 'Custo vagas', 'Custo no ano', 'Custo médio / mês',
      ...(comp ? [...MESES.map(m => `HC ${m}/${a2}`), `Δ HC dez/${a2} → dez/${a1}`] : [])],
      ...linhas.map(l => [l.k, l.cadeiras, l.ocupadas, l.vagas, l.deslig, l.jan, l.dez, ...MESES.map((_, m) => l.ocupadasMes[m] + l.vagasMes[m]),
        Math.round(l.custoOcup * 100) / 100, Math.round(l.custoVaga * 100) / 100, Math.round(l.custo * 100) / 100, Math.round(l.medio * 100) / 100,
        ...(comp ? [...l.antMes, l.dez - l.antMes[11]] : [])])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 40 }, ...aoa[0].slice(1).map(() => ({ wch: 11 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Headcount');
    // Uma linha por cadeira (colaborador ou vaga), para tabela dinâmica
    const cad = [['Regional', 'Filial', 'Matrícula', 'Colaborador / vaga', 'Situação', 'Função', 'Nível do cargo', 'Cód. C. Custo', 'Centro de custo', 'Gestor', 'Mês início', 'Mês fim', 'Salário', 'Custo no ano'],
      ...filtrados().map(c => [c.regional, c.filial, c.matricula, c.nome, c.vaga ? 'Vaga' : c.mes_fim < 12 ? 'Desligamento previsto' : 'Ocupada', c.funcao, c.cargo, c.cc_cod, c.cc_nome, c.gestor || '', c.mes_inicio, c.mes_fim, c.salario, Math.round((custoId.get(c.id) || 0) * 100) / 100])];
    const wsCad = XLSX.utils.aoa_to_sheet(cad);
    wsCad['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: cad.length - 1, c: cad[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, wsCad, 'Cadeiras');
    const nome = [E.dados.config.ano, E.filtro.regional, E.filtro.uf, E.filtro.filial, dim.nome].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
    XLSX.writeFile(wb, `Headcount-${nome}.xlsx`);
  });
}

// ----- Modo apresentação: tela cheia, sem menus; setas trocam de regional -----

function alternarApresentacao() {
  const ligado = document.body.classList.toggle('apresentacao');
  if (ligado) {
    if (E.aba !== 'painel') irPara('painel');
    document.documentElement.requestFullscreen?.().catch(() => {});
    let barra = $('#barra-apresentacao');
    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'barra-apresentacao';
      document.body.appendChild(barra);
    }
    desenharBarraApresentacao();
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    $('#barra-apresentacao')?.remove();
  }
  renderPainel();
}

function desenharBarraApresentacao() {
  const barra = $('#barra-apresentacao');
  if (!barra) return;
  const opcoes = ['', ...regionais()];
  const i = opcoes.indexOf(E.filtro.regional);
  barra.innerHTML = `<button data-dir="-1" aria-label="Anterior">◀</button><span>${esc(E.filtro.filial || E.filtro.regional || 'Todas as regionais')}</span><button data-dir="1" aria-label="Próxima">▶</button><small>use ← → para navegar</small><button data-sair aria-label="Sair da apresentação">✕</button>`;
  barra.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => navegarApresentacao(Number(b.dataset.dir))));
  barra.querySelector('[data-sair]').addEventListener('click', alternarApresentacao);
  barra.dataset.pos = i;
}

function navegarApresentacao(dir) {
  const opcoes = ['', ...regionais()];
  const i = opcoes.indexOf(E.filtro.regional);
  E.filtro.regional = opcoes[(i + dir + opcoes.length) % opcoes.length];
  E.filtro.filial = '';
  montarFiltros();
  renderPainel();
  desenharBarraApresentacao();
  window.scrollTo(0, 0);
}

document.addEventListener('keydown', e => {
  if (!document.body.classList.contains('apresentacao')) return;
  if (e.key === 'ArrowRight') navegarApresentacao(1);
  else if (e.key === 'ArrowLeft') navegarApresentacao(-1);
  else if (e.key === 'Escape' && !document.fullscreenElement) alternarApresentacao();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('apresentacao')) alternarApresentacao();
});

// ---------- Calculadora de impacto ----------
// Simula outra regra/valor para uma conta nas filiais do filtro do topo (ou na empresa toda) e mostra o impacto no ano,
// já com os reflexos (férias, 13º, FGTS, INSS…). Não grava nada; o administrador pode aplicar às premissas.

/** Regra com todos os valores multiplicados por k (valor, meses, tabela de níveis, valor por função). */
function escalarRegra(p, k) {
  if (!p || p.metodo === 'nao') return p;
  const mult = o => Object.fromEntries(Object.entries(o || {}).map(([a, v]) => [a, (Number(v) || 0) * k]));
  return { ...p, valor: (Number(p.valor) || 0) * k, ...(p.meses ? { meses: p.meses.map(v => (Number(v) || 0) * k) } : {}),
    ...(p.niveis ? { niveis: mult(p.niveis) } : {}), ...(p.por_funcao ? { por_funcao: mult(p.por_funcao) } : {}) };
}

/** Monta e calcula o cenário da calculadora. Devolve o cálculo simulado e as regras novas por filial. */
function cenarioCalculadora(k = 1) {
  const c = E.calc;
  const fils = filiaisVisiveis();
  const premissas = JSON.parse(JSON.stringify(E.dados.premissas));
  const regras = {};
  for (const f of fils) {
    const p = Motor.premissaDe(E.dados.premissas, f, E.dados.filiais[f].regional, c.rub);
    let novo;
    if (c.modo === 'regra' && p.metodo === 'nao' && !c.incluirSem) continue; // filial sem a conta fica como está
    if (c.modo === 'regra') {
      novo = regraDoTipo(c.tipo || tipoDe(p), { ...p, metodo: p.metodo === 'nao' ? metodoAoLigar(c.rub, p) : p.metodo });
      novo.valor = Number(c.valor) || 0;
      if (c.periodo && !String(c.tipo).startsWith('pct') && c.tipo !== 'nivel') novo.periodo = c.periodo;
      if (novo.periodo === 'por_mes') novo.periodo = 'mensal';
      if (String(c.tipo).startsWith('pct')) { novo.inicio = Number(c.inicio) || 1; novo.inicio2 = Number(c.inicio2) || 0; }
      if (c.substituir) novo.vale_todos = true; // vale também para quem tem valor da planilha da base
    } else novo = escalarRegra(p, k);
    regras[f] = novo;
    premissas[f] = { ...(premissas[f] || {}), [c.rub]: novo };
  }
  const set = new Set(fils);
  // Valores próprios (planilha da base / ajustados à mão): na variação % e no novo total sobem junto; na regra nova,
  // só mudam se a opção "aplicar também a quem tem valor próprio" estiver marcada.
  const colaboradores = [...E.dados.colaboradores.map(col => {
    const ex = col.excecoes?.[c.rub];
    if (!ex || !set.has(col.filial)) return col;
    if (c.modo === 'regra') {
      if (!c.substituir) return col;
      const { [c.rub]: _, ...resto } = col.excecoes;
      return { ...col, excecoes: resto };
    }
    return { ...col, excecoes: { ...col.excecoes, [c.rub]: escalarRegra(ex, k) } };
  }), ...lancamentosComoLinhas()];
  const res = Motor.calcular({ colaboradores, filiais: filiaisComRascunho(), premissas, niveis: E.dados.niveis });
  return { res, regras, fils };
}

function calcularCalculadora() {
  const c = E.calc;
  const k0 = IDX[c.rub];
  const atual = totalDe(E.bruto.res);
  const contaAtual = somaRub(atual, k0);
  // campo vazio = ainda sem simulação: mostra o de hoje
  const vazio = { regra: c.valor, total: c.alvo, pct: c.pct }[c.modo] === '' || { regra: c.valor, total: c.alvo, pct: c.pct }[c.modo] == null;
  if (vazio) return { atual, sim: atual, contaAtual, contaSim: contaAtual, res: E.bruto.res, regras: {}, fils: filiaisVisiveis(), vazio: true };
  let cen;
  if (c.modo === 'total') {
    // novo total no ano: ajusta a escala até bater (teto e arredondamentos deixam a relação quase linear)
    const alvo = Number(c.alvo) || 0;
    let k = contaAtual ? alvo / contaAtual : 1;
    for (let it = 0; it < 4; it++) {
      cen = cenarioCalculadora(k);
      const obtido = somaRub(totalDe(cen.res), k0);
      if (!obtido || Math.abs(obtido - alvo) < 0.5) break;
      k *= alvo / obtido;
    }
  } else cen = cenarioCalculadora(c.modo === 'pct' ? 1 + (Number(c.pct) || 0) / 100 : 1);
  const sim = totalDe(cen.res);
  return { atual, sim, contaAtual, contaSim: somaRub(sim, k0), ...cen };
}

function renderCalculadora() {
  const el = painel('calculadora');
  if (!E.dados.colaboradores.length) { el.innerHTML = '<div class="cartao vazio"><span>📥</span>Importe a base de colaboradores primeiro.</div>'; return; }
  const c = E.calc;
  const rubs = RUBRICAS.filter(r => !r.fixa && !r.soLancamento);
  if (!rubs.some(r => r.id === c.rub)) c.rub = 'promocoes';
  const r = RUBRICAS[IDX[c.rub]];
  const fils = filiaisVisiveis();
  const efetivas = fils.map(f => Motor.premissaDe(E.dados.premissas, f, E.dados.filiais[f].regional, c.rub));
  // tipo/valor sugeridos: os da regra mais comum no escopo
  const comTem = efetivas.filter(p => p.metodo !== 'nao');
  const comum = (() => { const m = new Map(); (comTem.length ? comTem : efetivas).forEach(p => { const k = JSON.stringify([tipoDe(p), p.valor, p.periodo]); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0]; })();
  const [tipoComum, valorComum, periodoComum] = comum ? JSON.parse(comum) : ['fixo', 0, 'mensal'];
  if (!c.tipo || c.tipo === 'nao' || c.tipo === 'nivel') c.tipo = tipoComum === 'nao' ? metodoAoLigar(c.rub, RUBRICAS[IDX[c.rub]].padrao) : tipoComum === 'nivel' ? 'multiplo' : tipoComum;
  const valorHoje = tipoComum === 'nao' ? '' : valorComum; // sugestão no campo; vazio = sem mudança
  if (!c.periodo) c.periodo = periodoComum === 'por_mes' ? 'mensal' : periodoComum || 'mensal';
  if (!c.inicio) c.inicio = Math.min(...(comTem.length ? comTem : efetivas).map(p => Number(p.inicio) || 1), 12) || 1;
  if (c.inicio2 == null) c.inicio2 = (comTem.find(p => Number(p.inicio2) > 1) || {}).inicio2 || '';
  const semConta = efetivas.filter(p => p.metodo === 'nao').length;
  const tipos = r.adicional ? { pct: TIPOS.pct, fixo: TIPOS.fixo, rateio: TIPOS.rateio } : Object.fromEntries(Object.entries(TIPOS).filter(([k]) => k !== 'nivel'));
  const quandos = { mensal: QUANDO_ROTULO.mensal, anual_mes: QUANDO_ROTULO.anual_mes, anual_diluido: QUANDO_ROTULO.anual_diluido };
  const proprios = E.dados.colaboradores.filter(x => fils.includes(x.filial) && noFiltro(x) && x.excecoes?.[c.rub]).length;
  const escopo = [escopoFiltro(E.eu.admin ? 'Empresa toda' : E.eu.regionais.join(' · ')), ccFiltrado()].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Calculadora de <em>impacto</em></h1>
      <p class="subtitulo">Escolha a conta e simule outro valor: o impacto no ano aparece na hora, já com os reflexos (férias, 13º, FGTS, INSS…). Vale para o que está nos filtros do topo — sem filtro, para a empresa toda. <b>Nada é salvo.</b></p></div></div>
    <div class="calc-grade">
      <section class="cartao calc-entrada">
        <small class="calc-escopo">📍 ${esc(escopo)} · ${fils.length} filial(is)</small>
        <label class="rotulo">Conta<select class="campo" id="calc-rub">${GRUPOS.map(g => `<optgroup label="${esc(g.nome)}">${rubs.filter(x => x.grupo === g.id).map(x => `<option value="${x.id}" ${x.id === c.rub ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <div class="calc-hoje"><span>Hoje</span><b>${esc(regraDaRubrica(c.rub, fils) || '—')}</b></div>
        <div class="rotulo">Como simular
          <div class="segmentos" id="calc-modo" style="margin-top:.35rem">${[['regra', 'Novo valor da regra'], ['total', 'Novo total no ano'], ['pct', 'Variação %']].map(([k, v]) => `<button data-m="${k}" class="${c.modo === k ? 'ativo' : ''}">${v}</button>`).join('')}</div></div>
        ${c.modo === 'regra' ? `
          <label class="rotulo">Como é calculado<select class="campo" id="calc-tipo">${Object.entries(tipos).map(([k, v]) => `<option value="${k}" ${k === c.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="rotulo">Novo valor <small>(${esc(unidadeValor(c.tipo, c.periodo) || '')})</small><input class="campo" id="calc-valor" type="number" step="any" value="${esc(c.valor)}" placeholder="${valorHoje !== '' ? `hoje: ${fmtN(valorHoje)}` : 'digite o novo valor'}"></label>
          ${String(c.tipo).startsWith('pct') ? `<label class="rotulo">A partir de<select class="campo" id="calc-inicio">${opcoesMes(c.inicio)}</select></label>
          <label class="rotulo">2º aumento a partir de <small>(opcional · soma o mesmo %)</small><select class="campo" id="calc-inicio2">${opcoesMes(c.inicio2, true)}</select></label>` : ''}
          ${semConta ? `<label class="check"><input type="checkbox" id="calc-incluir" ${c.incluirSem ? 'checked' : ''}> <span>Incluir as <b>${semConta}</b> filial(is) que hoje não têm esta conta</span></label>` : ''}
          ${!String(c.tipo).startsWith('pct') ? `<label class="rotulo">Quando é pago<select class="campo" id="calc-periodo">${Object.entries(quandos).map(([k, v]) => `<option value="${k}" ${k === c.periodo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
          ${proprios ? `<label class="check"><input type="checkbox" id="calc-subst" ${c.substituir ? 'checked' : ''}> <span>Aplicar também aos <b>${num0.format(proprios)}</b> colaborador(es) com valor próprio <small>(planilha da base ou ajustado à mão; sem marcar, eles ficam com o valor deles)</small></span></label>` : ''}`
        : c.modo === 'total' ? `
          <label class="rotulo">Total da conta no ano (R$)<input class="campo" id="calc-alvo" type="number" step="any" value="${esc(c.alvo)}" placeholder="ex.: 500000"></label>
          <p class="calc-nota">A regra de cada filial é ajustada na mesma proporção para chegar nesse total.</p>`
        : `
          <label class="rotulo">Variação sobre o valor de hoje (%)<input class="campo" id="calc-pct" type="number" step="any" value="${esc(c.pct)}" placeholder="ex.: 10 ou -5"></label>
          <p class="calc-nota">Todos os valores da conta (regras e valores próprios) sobem ou descem nessa proporção.</p>`}
      </section>
      <div id="calc-resultado"></div>
    </div>`;
  const re = () => renderCalculadora();
  $('#calc-rub', el).addEventListener('change', e => { Object.assign(c, { rub: e.target.value, tipo: '', valor: '', periodo: '', inicio: '', inicio2: null, alvo: '', pct: '', substituir: false, incluirSem: false }); re(); });
  $$('#calc-modo button', el).forEach(b => b.addEventListener('click', () => { c.modo = b.dataset.m; re(); }));
  $('#calc-tipo', el)?.addEventListener('change', e => { c.tipo = e.target.value; re(); });
  $('#calc-periodo', el)?.addEventListener('change', e => { c.periodo = e.target.value; re(); });
  $('#calc-subst', el)?.addEventListener('change', e => { c.substituir = e.target.checked; desenharResultadoCalc(); });
  $('#calc-incluir', el)?.addEventListener('change', e => { c.incluirSem = e.target.checked; desenharResultadoCalc(); });
  $('#calc-inicio', el)?.addEventListener('change', e => { c.inicio = e.target.value; desenharResultadoCalc(); });
  $('#calc-inicio2', el)?.addEventListener('change', e => { c.inicio2 = e.target.value; desenharResultadoCalc(); });
  let t;
  const digitar = (campo, id) => $(id, el)?.addEventListener('input', e => { c[campo] = e.target.value; clearTimeout(t); t = setTimeout(desenharResultadoCalc, 250); });
  digitar('valor', '#calc-valor'); digitar('alvo', '#calc-alvo'); digitar('pct', '#calc-pct');
  desenharResultadoCalc();
}

function desenharResultadoCalc() {
  const box = $('#calc-resultado');
  if (!box) return;
  const c = E.calc;
  const r = RUBRICAS[IDX[c.rub]];
  const k0 = IDX[c.rub];
  const x = calcularCalculadora();
  const dConta = x.contaSim - x.contaAtual;
  const dTotal = x.sim.total - x.atual.total;
  const dReflexo = dTotal - dConta;
  // reflexos: as outras contas que mudaram
  const reflexos = RUBRICAS.map((rr, k) => ({ rr, d: k === k0 ? 0 : somaRub(x.sim, k) - somaRub(x.atual, k) })).filter(y => Math.abs(y.d) >= 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const card = (rot, a, b, nota = '') => `<div class="calc-card"><span>${rot}</span><div><small>hoje</small><b>${brl0.format(a)}</b></div><div class="calc-seta">→</div><div><small>simulado</small><b>${brl0.format(b)}</b></div><em class="${clsDelta(b - a)}">${deltaFmt(b - a)}${a ? ` (${deltaPct(b - a, a)})` : ''}</em>${nota}</div>`;
  const porF = new Map();
  const ag0 = Motor.agregar(E.bruto.res, col => col.filial, noFiltro);
  const ag1 = Motor.agregar(x.res, col => col.filial, noFiltro);
  for (const f of new Set([...ag0.keys(), ...ag1.keys()])) {
    const a = ag0.get(f), b = ag1.get(f);
    const ca = a ? somaRub(a, k0) : 0, cb = b ? somaRub(b, k0) : 0;
    const ta = a?.total || 0, tb = b?.total || 0;
    if (Math.abs(ca) + Math.abs(cb) + Math.abs(tb - ta) >= 0.5) porF.set(f, { ca, cb, dc: cb - ca, dr: (tb - ta) - (cb - ca), dt: tb - ta, regra: x.regras[f] });
  }
  const linhasF = [...porF].sort((a, b) => Math.abs(b[1].dt) - Math.abs(a[1].dt));
  box.innerHTML = `
    ${x.vazio ? '<p class="aviso-ajuste" style="margin:0 0 1rem">👈 Digite o novo valor ao lado para ver o impacto.</p>' : ''}
    <div class="calc-cards">
      ${card(esc(r.nome), x.contaAtual, x.contaSim)}
      <div class="calc-card"><span>Reflexos <small>(férias, 13º, FGTS, INSS…)</small></span><b class="${clsDelta(dReflexo)}">${deltaFmt(dReflexo)}</b><small>${reflexos.length ? reflexos.slice(0, 4).map(y => `${esc(y.rr.nome)} ${deltaFmt(y.d)}`).join(' · ') : 'esta conta não gera reflexos'}</small></div>
      <div class="calc-card destaque"><span>Impacto total no ano</span><b class="${clsDelta(dTotal)}">${deltaFmt(dTotal)}</b><small>${deltaPct(dTotal, x.atual.total)} sobre o custo de pessoal do escopo (${brl0.format(x.atual.total)} → ${brl0.format(x.sim.total)}) · média de ${deltaFmt(dTotal / 12)} por mês</small></div>
    </div>
    <section class="cartao"><h3>${esc(r.nome)} mês a mês <small>· hoje × simulado</small></h3><div id="calc-graf"></div></section>
    <section class="cartao" style="margin-top:1rem">
      <div class="ferramentas" style="margin-bottom:.6rem"><h3 style="margin:0">Por filial</h3>
        <span class="direita"><button class="btn btn-claro btn-sm" id="calc-excel">⬇ Excel</button>${E.eu.admin ? `<button class="btn btn-laranja btn-sm" id="calc-aplicar" ${Math.abs(dConta) >= 0.5 ? '' : 'disabled'}>Aplicar às premissas</button>` : ''}</span></div>
      <div class="tabela-wrap"><table class="tabela tabela-ranking"><thead><tr><th>Filial</th><th>Regra simulada</th><th class="n">${esc(r.nome)} hoje</th><th class="n">Simulado</th><th class="n">Δ conta</th><th class="n">Δ reflexos</th><th class="n">Δ total</th></tr></thead>
        <tbody>${linhasF.map(([f, v]) => `<tr><td>${esc(f)}</td><td><small>${v.regra ? esc(`${textoCurto(v.regra)} · ${resumoDetalhes(v.regra)}`) : '—'}</small></td><td class="n">${brl0.format(v.ca)}</td><td class="n">${brl0.format(v.cb)}</td><td class="n ${clsDelta(v.dc)}">${deltaFmt(v.dc)}</td><td class="n ${clsDelta(v.dr)}">${deltaFmt(v.dr)}</td><td class="n ${clsDelta(v.dt)}"><b>${deltaFmt(v.dt)}</b></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nada para mostrar.</td></tr>'}</tbody>
        <tfoot><tr><td>Total</td><td></td><td class="n">${brl0.format(x.contaAtual)}</td><td class="n">${brl0.format(x.contaSim)}</td><td class="n">${deltaFmt(dConta)}</td><td class="n">${deltaFmt(dReflexo)}</td><td class="n">${deltaFmt(dTotal)}</td></tr></tfoot></table></div>
    </section>`;
  const meses = ag => MESES.map((_, m) => ag.porRubrica[k0 * 12 + m]);
  Graficos.colunasAgrupadas($('#calc-graf', box), { rotulos: MESES, titulo: `${r.nome} hoje × simulado`, series: [{ nome: 'Hoje', cor: '#9fb6c9', valores: meses(x.atual) }, { nome: 'Simulado', cor: '#ec6b24', valores: meses(x.sim) }] });
  $('#calc-excel', box).addEventListener('click', () => {
    if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
    const r2 = v => Math.round(v * 100) / 100;
    const resumo = [['Calculadora de impacto', r.nome], ['Escopo', escopoFiltro('Empresa toda')], ['Hoje', regraDaRubrica(c.rub)], ['Simulação', { regra: 'Novo valor da regra', total: 'Novo total no ano', pct: 'Variação %' }[c.modo]], [],
      ['', ...MESES, 'Total ano'], [`${r.nome} hoje`, ...meses(x.atual).map(r2), r2(x.contaAtual)], [`${r.nome} simulado`, ...meses(x.sim).map(r2), r2(x.contaSim)],
      ['Custo total hoje', ...[...x.atual.meses].map(r2), r2(x.atual.total)], ['Custo total simulado', ...[...x.sim.meses].map(r2), r2(x.sim.total)], ['Impacto total', ...MESES.map((_, m) => r2(x.sim.meses[m] - x.atual.meses[m])), r2(dTotal)]];
    const fil = [['Filial', 'Regra simulada', `${r.nome} hoje`, 'Simulado', 'Δ conta', 'Δ reflexos', 'Δ total'], ...linhasF.map(([f, v]) => [f, v.regra ? `${textoCurto(v.regra)} · ${resumoDetalhes(v.regra)}` : '', r2(v.ca), r2(v.cb), r2(v.dc), r2(v.dr), r2(v.dt)])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fil), 'Por filial');
    XLSX.writeFile(wb, `Calculadora-${r.nome}-${E.dados.config.ano}.xlsx`.replace(/[^\w.-]+/g, '_'));
  });
  $('#calc-aplicar', box)?.addEventListener('click', async () => {
    const itens = Object.entries(x.regras).map(([f, novo]) => {
      const herdada = premHerdadaDe(f, E.dados.filiais[f].regional, c.rub);
      const propria = E.dados.premissas[f]?.[c.rub];
      if (mesmaRegra(novo, herdada)) return propria ? { escopo: f, rubricas: { [c.rub]: null } } : null;
      return { escopo: f, rubricas: { [c.rub]: novo } };
    }).filter(Boolean);
    const aviso = c.modo !== 'regra' || c.substituir ? '\n\nValores próprios de colaboradores (planilha da base) não são alterados por aqui — só as regras das filiais.' : '';
    if (!confirm(`Gravar a nova regra de ${r.nome} em ${itens.length} filial(is)? Impacto no ano: ${deltaFmt(dTotal)}.${aviso}`)) return;
    try {
      await api('/api/premissas/lote', { method: 'PUT', body: { itens } });
      await carregar();
      Object.assign(c, { tipo: '', valor: '', periodo: '', inicio: '', inicio2: null, alvo: '', pct: '' });
      renderCalculadora();
      toast(`${r.nome}: regra gravada em ${itens.length} filial(is).`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ---------- Simulação ----------

/** Chave para casar a mesma pessoa nos dois anos (matrícula + nome; sem matrícula, o próprio id). */
const chaveCmp = c => (c.matricula ? `${c.matricula}|${String(c.nome).trim().toUpperCase()}` : `id|${c.id}`);

function linhasSimulacao(res = E.res) {
  const v = E.sim.visao;
  const ant = res === E.resAnt;
  if (v === 'rubricas') {
    const ag = totalDe(res);
    const linhas = [];
    for (const g of GRUPOS) {
      const filhos = RUBRICAS.map((r, i) => ({ r, i })).filter(x => x.r.grupo === g.id)
        .map(({ r, i }) => ({ rotulo: r.nome, meses: [...ag.porRubrica.slice(i * 12, i * 12 + 12)] }))
        .filter(l => l.meses.some(x => x));
      const meses = MESES.map((_, m) => filhos.reduce((s, f) => s + f.meses[m], 0));
      if (E.filtro.conta && !filhos.length) continue; // com filtro de conta, só os grupos que têm valor
      linhas.push({ grupo: g.id, rotulo: g.nome, meses, cor: g.cor });
      if (!E.sim.fechados.has(g.id)) filhos.forEach(f => linhas.push({ ...f, filho: true }));
    }
    return { linhas, total: [...ag.meses], comHc: false };
  }
  const chave = {
    filiais: c => c.filial,
    cc: c => `${c.cc_cod || '—'} · ${c.cc_nome || 'Sem centro de custo'}`,
    colaboradores: c => c.id,
  }[v];
  const busca = E.sim.busca.toLowerCase();
  const filtro = c => noFiltro(c) && (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome}`.toLowerCase().includes(busca));
  const mapa = Motor.agregar(res, chave, filtro);
  const porId = new Map(res.colaboradores.map(c => [c.id, c]));
  // No ano anterior, a pessoa aberta na tela (id do orçamento) abre também a linha dela do histórico
  const idAtual = ant ? new Map(E.res.colaboradores.map(c => [chaveCmp(c), c.id])) : null;
  const estaAberto = id => E.sim.abertos.has(id) || (ant && E.sim.abertos.has(idAtual.get(chaveCmp(porId.get(id)))));
  const linhas = [...mapa].map(([k, a]) => {
    const c = v === 'colaboradores' ? porId.get(k) : null;
    return {
      rotulo: c ? c.nome : k,
      sub: c ? (c.avulso ? `${c.avulso.provisao ? 'Provisão de aumento (total da filial)' : 'Outro lançamento'} · ${c.filial || c.regional} · ${rotuloCc(c)}` : `${c.funcao || ''} · ${c.filial}${c.cc_nome ? ` · ${c.cc_nome}` : ''}`) : `${a.n} colaborador(es)`,
      hc: v === 'colaboradores' ? null : Math.max(...a.hc),
      meses: [...a.meses],
      vaga: c?.vaga,
      colab: c ? c.id : null,
      cmp: c ? chaveCmp(c) : `${v}|${k}`,
      proprias: c ? temManuais(c) : false,
      avulso: Boolean(c?.avulso),
      provisao: Boolean(c?.avulso?.provisao),
      ag: c ? null : k,
      porRubrica: c ? null : a.porRubrica,
    };
  }).sort((a, b) => b.meses.reduce((s, x) => s + x, 0) - a.meses.reduce((s, x) => s + x, 0));
  const total = MESES.map((_, m) => linhas.reduce((s, l) => s + l.meses[m], 0));
  if (v !== 'colaboradores') {
    // Filial / centro de custo: clique abre as contas lançadas, por grupo
    if (linhas.length === 1 && !ant) E.sim.abertosAg.add(`${v}|${linhas[0].ag}`);
    const comContas = [];
    for (const l of linhas) {
      l.aberto = E.sim.abertosAg.has(`${v}|${l.ag}`);
      comContas.push(l);
      if (l.aberto) comContas.push(...detalheAgregado(l.porRubrica));
    }
    return { linhas: comContas, total, comHc: true };
  }
  // Uma pessoa só na busca: já abre o detalhe dela.
  if (linhas.length === 1 && !ant) E.sim.abertos.add(linhas[0].colab);
  const comDetalhe = [];
  for (const l of linhas) {
    l.aberto = estaAberto(l.colab);
    comDetalhe.push(l);
    if (l.aberto) comDetalhe.push(...detalheColaborador(l.colab, res));
  }
  return { linhas: comDetalhe, total, comHc: false };
}

/** Contas lançadas de uma filial / centro de custo: subtotal por grupo e cada rubrica, mês a mês. */
function detalheAgregado(porRubrica) {
  const out = [];
  for (const g of GRUPOS) {
    const filhos = RUBRICAS.map((r, k) => ({ r, k })).filter(x => x.r.grupo === g.id)
      .map(({ r, k }) => ({ rotulo: r.nome, meses: [...porRubrica.slice(k * 12, k * 12 + 12)] }))
      .filter(f => f.meses.some(x => x));
    if (!filhos.length) continue;
    out.push({ rotulo: g.nome, cor: g.cor, meses: MESES.map((_, m) => filhos.reduce((s, f) => s + f.meses[m], 0)), det: 'grupo' });
    filhos.forEach(f => out.push({ ...f, det: 'rubrica' }));
  }
  return out;
}

/** Linhas com o que está orçado para um colaborador: subtotal por grupo e cada rubrica, mês a mês. */
function detalheColaborador(id, res = E.res) {
  const i = res.colaboradores.findIndex(c => c.id === id);
  if (i < 0) return [];
  const c = res.colaboradores[i];
  const out = [];
  for (const g of GRUPOS) {
    const filhos = RUBRICAS.map((r, k) => ({ r, k })).filter(x => x.r.grupo === g.id).map(({ r, k }) => ({
      rotulo: r.nome, meses: MESES.map((_, m) => res.valor(i, k, m)), propria: excecaoEfetiva(c, r.id) ? (c.excecoes[r.id].origem === 'base' ? 'base' : 'manual') : '', conta: contaDoItem(c, r),
    })).filter(f => f.meses.some(x => x));
    if (!filhos.length) continue;
    out.push({ rotulo: g.nome, cor: g.cor, meses: MESES.map((_, m) => filhos.reduce((s, f) => s + f.meses[m], 0)), det: 'grupo' });
    filhos.forEach(f => out.push({ ...f, det: 'rubrica' }));
  }
  return out;
}

/** Exceção do colaborador que vale de fato (a da planilha da base perde para "Total da filial" e para regra "vale para todos"). */
function excecaoEfetiva(c, rid) {
  const e = c.excecoes?.[rid];
  if (!e || e.origem !== 'base') return e;
  const p = Motor.premissaDe(E.dados.premissas, c.filial, c.regional, rid);
  return p.metodo === 'rateio' || p.vale_todos ? undefined : e;
}

/** Explica a conta do item no detalhe do colaborador: PPR (salário × target) e benefício em R$ com reajuste. */
function contaDoItem(c, rub) {
  if (c.avulso) return c.avulso.conta ? `conta ${c.avulso.conta}` : 'outro lançamento';
  // Com 11 meses de salário, a remuneração do mês entra em 11/12 (o 12º mês é pago como férias + 1/3).
  const onze = Motor.MESES_SALARIO < 12 ? `${Motor.MESES_SALARIO}/12` : '';
  const notaMeses = onze ? `mês cheio × ${onze} · 1 mês do ano é pago como férias + 1/3` : '';
  if (rub.fixa || (rub.grupo === 'remuneracao' && rub.adicional)) return notaMeses;
  if (rub.id === 'horas_extras') {
    const p = Motor.aplicarExcecao(Motor.premissaDe(E.dados.premissas, c.filial, c.regional, rub.id), excecaoEfetiva(c, rub.id));
    return p.metodo === 'rateio' ? '' : notaMeses;
  }
  if (rub.id === 'ferias') return '(salário + adicionais + HE) ÷ 12 + 1/3 · provisão de férias';
  if (rub.id === 'decimo') return '(salário + adicionais + HE) ÷ 12';
  if (rub.id === 'fgts' || rub.id === 'inss') return `sobre salário + adicionais + HE${onze ? ` pagos no mês (${onze})` : ''}`;
  const p = Motor.aplicarExcecao(Motor.premissaDe(E.dados.premissas, c.filial, c.regional, rub.id), excecaoEfetiva(c, rub.id));
  if (p.metodo === 'fixo' && rub.grupo === 'beneficios' && p.periodo !== 'por_mes') {
    // Benefício em R$: mostra o reajuste de benefícios da filial, que entra por cima do valor lançado.
    const f = filiaisComRascunho()[c.filial] || {};
    const fim = fatorBenefDe(f, 11);
    const daBase = excecaoEfetiva(c, rub.id)?.origem === 'base';
    if (fim === 1) return daBase ? `${brl.format(p.valor)} da planilha da base` : '';
    const reaj = `reajuste de benefícios da filial de ${textoReajuste(f, 'reaj_benef')}`;
    if (daBase) return `${brl.format(p.valor)} da planilha da base + ${reaj} = ${brl.format(p.valor * fim)} em Dez`;
    const v = Motor.valorDe(p, c.funcao);
    const deFuncao = !excecaoEfetiva(c, rub.id) && Motor.valorDe(p, c.funcao) !== Number(p.valor) ? ` (${c.funcao})` : '';
    return `${brl.format(v)}${deFuncao} + ${reaj} = ${brl.format(v * fim)} em Dez`;
  }
  if (p.metodo !== 'multiplo') return '';
  const mult = Motor.multiploDe(p, c.cargo, E.dados.niveis, c.funcao);
  const quando = p.periodo === 'anual_mes' ? `pago em ${MESES[p.mes - 1]}` : p.periodo === 'anual_diluido' ? 'diluído em 12 meses' : 'todo mês';
  const alvo = `${fmtN(mult)} salário${mult === 1 ? '' : 's'}${p.por_nivel && c.cargo ? ` (${c.cargo})` : ''}`;
  const f = filiaisComRascunho()[c.filial] || {};
  const fator = p.sem_dissidio ? 1 : (1 + (Number(f.dissidio_ant_pct) || 0) / 100) * (1 + (Number(f.dissidio_pct) || 0) / 100);
  const sal = c.salario * fator;
  const base = fator !== 1 ? `${brl.format(sal)} (salário com dissídio de ${textoDissidio(f)})` : brl.format(sal);
  return `${base} × ${alvo} = ${brl.format(sal * mult)} no ano · ${quando}`;
}

/** Linhas do orçamento com as do ano anterior ao lado (casadas pela chave da linha e a dos pais). */
function linhasComparadas() {
  const atual = linhasSimulacao(E.resCmp);
  const anterior = linhasSimulacao(E.resAnt);
  const S = '\u0001';
  const chaves = ls => {
    let pai = '', grupo = '';
    return ls.map(l => {
      if (l.det === 'grupo') grupo = l.rotulo;
      else if (!l.det && !l.filho) { pai = l.cmp || `g|${l.rotulo}`; grupo = ''; }
      const k = l.det === 'rubrica' ? [pai, grupo, l.rotulo].join(S) : l.det || l.filho ? [pai, l.rotulo].join(S) : pai;
      return { k, pai, l };
    });
  };
  const vazio = () => MESES.map(() => 0);
  const kb = chaves(anterior.linhas);
  const antDe = new Map(kb.map(x => [x.k, x.l]));
  // Blocos: cada linha de topo com as linhas abertas abaixo dela
  const blocos = new Map();
  for (const { k, pai, l } of chaves(atual.linhas)) {
    if (!blocos.has(pai)) blocos.set(pai, []);
    blocos.get(pai).push({ k, l: { ...l, ant: antDe.get(k)?.meses || vazio() } });
  }
  const usados = new Set([...blocos.values()].flat().map(x => x.k));
  // O que só existe no ano anterior (quem saiu, uma conta que deixou de ter custo) entra com o orçamento zerado
  for (const { k, pai, l } of kb) {
    if (usados.has(k)) continue;
    const linha = { k, l: { ...l, meses: vazio(), ant: l.meses, soAnt: !l.det && !l.filho, aberto: l.aberto } };
    if (!blocos.has(pai)) { blocos.set(pai, [linha]); continue; }
    const b = blocos.get(pai);
    const prefixo = k.split(S).slice(0, -1).join(S);
    let pos = -1;
    b.forEach((x, i) => { if (x.k === prefixo || x.k.startsWith(prefixo + S)) pos = i; });
    b.splice(pos >= 0 ? pos + 1 : b.length, 0, linha);
  }
  const linhas = [...blocos.values()].flat().map(x => x.l).filter(l => !(l.grupo && !GRUPOS_CMP.has(l.grupo)));
  return { linhas, total: atual.total, totalAnt: anterior.total, comHc: atual.comHc };
}

function tabelaComparadaHtml() {
  const { linhas, total, totalAnt } = linhasComparadas();
  if (!linhas.length) return '<div class="vazio"><span>🔍</span>Nada encontrado com esses filtros.</div>';
  const ano = E.dados.config.ano, ant = anoAnt();
  const soma = a => a.reduce((x, y) => x + y, 0);
  const so = E.sim.soDelta;
  const cel = (v1, v0) => {
    if (so) { const d = v1 - v0; return `<td class="n ${clsDelta(d)}">${Math.abs(d) >= 0.5 ? `${sinal(d)}${fmtVal(Math.abs(d))}` : '–'}</td>`; }
    return `<td class="n${v1 || v0 ? '' : ' zero'}">${v1 || v0 ? `${fmtVal(v1)}<span class="sub-ant">${fmtVal(v0)}</span>` : '–'}</td>`;
  };
  const fim = (t1, t0) => `<td class="n">${fmtVal(t0)}</td><td class="n"><b>${fmtVal(t1)}</b></td><td class="n ${clsDelta(t1 - t0)}"><b>${sinal(t1 - t0)}${fmtVal(Math.abs(t1 - t0))}</b></td><td class="n ${clsDelta(t1 - t0)}">${t0 ? deltaPct(t1 - t0, t0) : t1 ? 'novo' : '–'}</td>`;
  const rotulo = l => `${l.grupo || l.det === 'grupo' ? `<i class="bola" style="background:${l.cor}"></i>` : ''}${esc(l.rotulo)}${l.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${l.avulso ? (l.provisao ? ' <span class="etiqueta azul">📈 provisão</span>' : ' <span class="etiqueta neutra">📌 lançamento</span>') : ''}${l.soAnt ? ` <span class="etiqueta neutra">só em ${ant}</span>` : ''}${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ''}`;
  const regra = l => { const r = (l.filho || l.det === 'rubrica') && RUBRICAS.find(x => x.nome === l.rotulo); return r ? ` title="${esc(regraDaRubrica(r.id))}"` : ` title="${esc(l.rotulo)}"`; };
  return `<table class="tabela tabela-sim-comp">
    <thead><tr><th class="fixa">${{ rubricas: 'Rubrica', filiais: 'Filial', cc: 'Centro de custo', colaboradores: 'Colaborador' }[E.sim.visao]}<span class="sub">${so ? `Δ ${ant} → ${esc(ano)} por mês` : `${esc(ano)} <span class="sub-ant" style="display:inline">· ${ant} abaixo</span>`} · ${GRUPOS_CMP_TXT}</span></th>
      ${rotulosAnt().map(m => `<th class="n"${m.endsWith('*') ? ` title="${esc(notaProjecao())}"` : ''}>${m}</th>`).join('')}<th class="n">Total ${ant}</th><th class="n">Total ${esc(ano)}</th><th class="n">Δ R$</th><th class="n">Δ %</th></tr></thead>
    <tbody>${linhas.map(l => {
      const cls = l.det ? `det-${l.det}` : l.grupo ? `grupo${E.sim.fechados.has(l.grupo) ? ' fechado' : ''}` : l.filho ? 'filho' : l.colab != null || l.ag != null ? `colab${l.aberto ? ' aberto' : ''}${l.vaga ? ' vaga' : ''}` : '';
      const attrs = l.det ? '' : `${l.grupo ? ` data-grupo="${l.grupo}"` : ''}${l.colab != null ? ` data-colab="${l.colab}"` : ''}${l.ag != null ? ` data-ag="${esc(l.ag)}"` : ''}`;
      return `<tr class="${cls}"${attrs}><td class="fixa"${regra(l)}>${rotulo(l)}</td>${l.meses.map((v, m) => cel(v, l.ant[m])).join('')}${fim(soma(l.meses), soma(l.ant))}</tr>`;
    }).join('')}</tbody>
    <tfoot><tr class="total"><td class="fixa">Total</td>${total.map((v, m) => cel(v, totalAnt[m])).join('')}${fim(soma(total), soma(totalAnt))}</tr></tfoot>
  </table>`;
}

function tabelaSimulacaoHtml() {
  if (E.comparar && E.resAnt) return tabelaComparadaHtml();
  const { linhas, total, comHc } = linhasSimulacao();
  const totAno = total.reduce((a, b) => a + b, 0) || 1;
  const fil = filiaisComRascunho();
  const fils = filiaisVisiveis();
  const mesesDiss = new Set(mesesDeDissidio(fils.map(f => fil[f])).filter(m => m > 0));
  if (!linhas.length) return '<div class="vazio"><span>🔍</span>Nada encontrado com esses filtros.</div>';
  const cel = v => `<td class="n${v ? '' : ' zero'}">${v ? fmtVal(v) : '–'}</td>`;
  return `<table class="tabela">
    <thead><tr><th class="fixa">${{ rubricas: 'Rubrica', filiais: 'Filial', cc: 'Centro de custo', colaboradores: 'Colaborador' }[E.sim.visao]}</th>${comHc ? '<th class="n">HC</th>' : ''}
      ${MESES.map((m, i) => `<th class="n"${mesesDiss.has(i) ? ' style="color:var(--laranja)" title="Mês do dissídio"' : ''}>${m}${mesesDiss.has(i) ? ' ▲' : ''}</th>`).join('')}<th class="n">Total ano</th><th class="n">%</th></tr></thead>
    <tbody>${(() => {
      let totColab = 1;
      return linhas.map(l => {
        const t = l.meses.reduce((a, b) => a + b, 0);
        if (l.colab != null || l.ag != null) totColab = t || 1;
        if (l.det) {
          // Detalhe do colaborador: % é sobre o custo dele
          return `<tr class="det-${l.det}">
            <td class="fixa" title="${esc(l.det === 'rubrica' ? `${l.rotulo}: ${regraDaRubrica(RUBRICAS.find(x => x.nome === l.rotulo)?.id)}` : l.rotulo)}">${l.det === 'grupo' ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${l.cor};margin-right:.4rem"></i>` : ''}${esc(l.rotulo)}${l.propria === 'manual' ? ' <span class="etiqueta azul">valor próprio</span>' : l.propria === 'base' ? ' <span class="etiqueta neutra">da base</span>' : ''}${l.conta ? `<span class="sub conta">${esc(l.conta)}</span>` : ''}</td>
            ${comHc ? '<td></td>' : ''}${l.meses.map(cel).join('')}<td class="n"><b>${fmtVal(t)}</b></td><td class="n">${pctFmt(t / totColab)}</td></tr>`;
        }
        const cls = l.grupo ? `grupo${E.sim.fechados.has(l.grupo) ? ' fechado' : ''}` : l.filho ? 'filho' : l.colab != null || l.ag != null ? `colab${l.aberto ? ' aberto' : ''}${l.vaga ? ' vaga' : ''}` : l.vaga ? 'vaga' : '';
        return `<tr class="${cls}" ${l.grupo ? `data-grupo="${l.grupo}"` : ''}${l.colab != null ? ` data-colab="${l.colab}" title="Clique para ${l.aberto ? 'fechar' : 'ver'} o detalhe"` : ''}${l.ag != null ? ` data-ag="${esc(l.ag)}" title="Clique para ${l.aberto ? 'fechar' : 'ver'} as contas por grupo"` : ''}>
          <td class="fixa" title="${esc(l.filho ? `${l.rotulo}: ${regraDaRubrica(RUBRICAS.find(x => x.nome === l.rotulo)?.id)}` : l.rotulo)}">${l.grupo ? `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${l.cor};margin-right:.4rem"></i>` : ''}${esc(l.rotulo)}${l.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${l.avulso ? (l.provisao ? ' <span class="etiqueta azul">📈 provisão</span>' : ' <span class="etiqueta neutra">📌 lançamento</span>') : ''}${l.proprias ? ' <span class="etiqueta azul">condições próprias</span>' : ''}${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ''}</td>
          ${comHc ? `<td class="n">${l.hc ?? ''}</td>` : ''}${l.meses.map(cel).join('')}<td class="n"><b>${fmtVal(t)}</b></td><td class="n">${pctFmt(t / totAno)}</td></tr>`;
      }).join('');
    })()}</tbody>
    <tfoot><tr class="total"><td class="fixa">Total</td>${comHc ? `<td class="n">${linhas.reduce((s, l) => s + (l.hc || 0), 0) || ''}</td>` : ''}${total.map(v => `<td class="n">${fmtVal(v)}</td>`).join('')}<td class="n">${fmtVal(totAno)}</td><td class="n">100%</td></tr></tfoot>
  </table>`;
}

function simuladorHtml() {
  const fils = filiaisVisiveis();
  const fil = filiaisComRascunho();
  const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
  const n = Object.keys(E.rascunho).length;
  const benef = E.sim.reaj === 'benef';
  const pre = benef ? 'reaj_benef' : 'dissidio';
  const nome = benef ? 'Reajuste de benefícios' : 'Dissídio';
  const ano = esc(E.dados.config.ano);
  return `
    <h3>Simulador de reajustes</h3>
    <div class="segmentos" id="sim-reaj" style="margin-bottom:.6rem"><button data-r="diss" class="${benef ? '' : 'ativo'}">📈 Dissídio</button><button data-r="benef" class="${benef ? 'ativo' : ''}">🎁 Benefícios</button></div>
    <p>${benef ? 'Dois reajustes de benefícios' : 'Dois dissídios'} por filial: o de <b>${anoAnt()}</b>, que ${benef ? 'os valores lançados' : 'o salário da base'} ainda não ${benef ? 'têm' : 'tem'}: entra na data-base de ${anoAnt()} (lado ${anoAnt()} do comparativo) e vale o ano todo de ${ano}; e o de <b>${ano}</b>, na data-base de ${ano}, por cima do primeiro. Nada é salvo até você aplicar.</p>
    <div class="sim-todas">Todas: <select class="campo" id="sim-todas-qual" style="width:70px"><option value="ant">${anoAnt()}</option><option value="atual" selected>${ano}</option></select><input class="campo" id="sim-todas-pct" type="number" step="0.01" placeholder="%"> <select class="campo" id="sim-todas-mes" style="width:76px">${opcoesMes(5)}</select><button class="btn btn-claro btn-sm" id="sim-todas">Aplicar</button></div>
    <div class="sim-cab"><span>Ano</span><span>${benef ? 'Reajuste %' : 'Dissídio %'}</span><span>Data-base</span></div>
    <div class="sim-lista">${fils.map(f => `
      <div class="sim-filial${E.rascunho[f] ? ' alterada' : ''}" data-filial="${esc(f)}">
        <span class="sim-nome" title="${esc(f)}">${esc(f)}<small>salvo: ${esc(textoReajuste(E.dados.filiais[f], pre))}</small></span>
        <em>${anoAnt()}</em>
        <input class="campo" type="number" step="0.01" data-campo="${pre}_ant_pct" value="${fil[f][`${pre}_ant_pct`] || 0}" aria-label="${nome} ${anoAnt()} ${esc(f)}">
        <select class="campo" data-campo="${pre}_ant_mes" aria-label="Mês ${nome} ${anoAnt()} ${esc(f)}">${opcoesMes(fil[f][`${pre}_ant_mes`] || 1)}</select>
        <em>${ano}</em>
        <input class="campo" type="number" step="0.01" data-campo="${pre}_pct" value="${fil[f][`${pre}_pct`] || 0}" aria-label="${nome} ${ano} ${esc(f)}">
        <select class="campo" data-campo="${pre}_mes" aria-label="Mês ${nome} ${ano} ${esc(f)}">${opcoesMes(fil[f][`${pre}_mes`] || 1)}</select>
      </div>`).join('')}</div>
    <div class="sim-impacto${n ? '' : ' neutro'}" id="sim-impacto">${n ? `Impacto da simulação no ano<strong>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</strong>${n} filial(is) alterada(s)` : 'Sem alterações<strong>Orçamento salvo</strong>'}</div>
    <div class="sim-acoes"><button class="btn btn-claro btn-sm" data-descartar ${n ? '' : 'disabled'}>Descartar</button><button class="btn btn-laranja btn-sm" data-aplicar ${n ? '' : 'disabled'}>Aplicar ao orçamento</button></div>`;
}

function renderSimulacao() {
  const el = painel('simulacao');
  const admin = E.eu.admin;
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Simulação <em>mês a mês</em></h1>
      <p class="subtitulo">Custo de pessoal por mês com as premissas de cada filial. ${admin ? 'Use o simulador ao lado para testar o dissídio e o reajuste de benefícios.' : ''}</p></div></div>
    <div id="sim-faixa">${faixaRascunho()}</div>
    <div class="sim-grade${admin ? '' : ' sem-painel'}">
      <div>
        <div class="ferramentas">
          <div class="segmentos" id="sim-visao">${[['rubricas', 'Rubricas'], ['filiais', 'Filiais'], ['cc', 'Centros de custo'], ['colaboradores', 'Colaboradores']].map(([v, r]) => `<button data-v="${v}" class="${E.sim.visao === v ? 'ativo' : ''}">${r}</button>`).join('')}</div>
          ${E.sim.visao !== 'rubricas' ? `<input class="campo" id="sim-busca" placeholder="${E.sim.visao === 'colaboradores' ? 'Buscar nome, matrícula, função…' : 'Buscar…'}" value="${esc(E.sim.busca)}">` : ''}
          ${E.sim.visao === 'colaboradores' ? `<button class="btn btn-claro btn-sm" id="sim-abrir-todos">${E.sim.abertos.size ? 'Fechar detalhes' : 'Abrir detalhe de todos'}</button>` : ''}
          ${E.sim.visao === 'filiais' || E.sim.visao === 'cc' ? `<button class="btn btn-claro btn-sm" id="sim-abrir-ag">${[...E.sim.abertosAg].some(k => k.startsWith(E.sim.visao + '|')) ? 'Fechar contas' : 'Abrir contas de todos'}</button>` : ''}
          <div class="direita">
            ${E.resAnt ? `<div class="segmentos" id="sim-comp" title="Compare com o realizado de ${anoAnt()}"><button data-c="0" class="${E.comparar ? '' : 'ativo'}">Só ${esc(E.dados.config.ano)}</button><button data-c="1" class="${E.comparar ? 'ativo' : ''}">${anoAnt()} × ${esc(E.dados.config.ano)}</button></div>` : ''}
            ${E.comparar && E.resAnt ? `<label class="check" title="Mostra nos meses só a diferença"><input type="checkbox" id="sim-sodelta" ${E.sim.soDelta ? 'checked' : ''}> Só Δ</label>` : ''}
            <div class="segmentos" id="sim-unid"><button data-u="0" class="${E.sim.mil ? '' : 'ativo'}">R$</button><button data-u="1" class="${E.sim.mil ? 'ativo' : ''}">R$ mil</button></div>
            <button class="btn btn-marinho btn-sm" id="sim-excel">⬇ Exportar Excel</button>
          </div>
        </div>
        <div class="tabela-wrap alta" id="sim-tabela">${tabelaSimulacaoHtml()}</div>
      </div>
      ${admin ? `<aside class="cartao simulador" id="simulador">${simuladorHtml()}</aside>` : ''}
    </div>`;
  ligarFaixa($('#sim-faixa', el));
  $$('#sim-visao button', el).forEach(b => b.addEventListener('click', () => { E.sim.visao = b.dataset.v; renderSimulacao(); }));
  $$('#sim-unid button', el).forEach(b => b.addEventListener('click', () => { E.sim.mil = b.dataset.u === '1'; renderSimulacao(); }));
  $$('#sim-comp button', el).forEach(b => b.addEventListener('click', () => { E.comparar = b.dataset.c === '1'; renderSimulacao(); }));
  $('#sim-sodelta', el)?.addEventListener('change', e => { E.sim.soDelta = e.target.checked; atualizarTabelaSim(); });
  $('#sim-excel', el).addEventListener('click', exportarExcel);
  const busca = $('#sim-busca', el);
  if (busca) busca.addEventListener('input', () => { E.sim.busca = busca.value; atualizarTabelaSim(); });
  $('#sim-abrir-todos', el)?.addEventListener('click', () => {
    if (E.sim.abertos.size) E.sim.abertos.clear();
    else {
      const busca = E.sim.busca.toLowerCase();
      const lista = E.dados.colaboradores.filter(c => noFiltro(c) && (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome}`.toLowerCase().includes(busca)));
      if (lista.length > 150) return toast(`São ${lista.length} colaboradores. Filtre por filial ou busque um nome para abrir o detalhe de todos (máx. 150).`, 'erro');
      lista.forEach(c => E.sim.abertos.add(c.id));
    }
    renderSimulacao();
  });
  $('#sim-abrir-ag', el)?.addEventListener('click', () => {
    const v = E.sim.visao;
    const abertos = [...E.sim.abertosAg].filter(k => k.startsWith(v + '|'));
    if (abertos.length) abertos.forEach(k => E.sim.abertosAg.delete(k));
    else linhasSimulacao().linhas.filter(l => l.ag != null).forEach(l => E.sim.abertosAg.add(`${v}|${l.ag}`));
    renderSimulacao();
  });
  ligarTabelaSim();
  if (admin) ligarSimulador();
}

function ligarTabelaSim() {
  $$('#sim-tabela tr[data-ag]').forEach(tr => tr.addEventListener('click', () => {
    const k = `${E.sim.visao}|${tr.dataset.ag}`;
    E.sim.abertosAg.has(k) ? E.sim.abertosAg.delete(k) : E.sim.abertosAg.add(k);
    atualizarTabelaSim();
  }));
  $$('#sim-tabela tr[data-colab]').forEach(tr => tr.addEventListener('click', () => {
    const id = Number(tr.dataset.colab);
    E.sim.abertos.has(id) ? E.sim.abertos.delete(id) : E.sim.abertos.add(id);
    atualizarTabelaSim();
  }));
  $$('#sim-tabela tr.grupo').forEach(tr => tr.addEventListener('click', () => {
    const g = tr.dataset.grupo;
    E.sim.fechados.has(g) ? E.sim.fechados.delete(g) : E.sim.fechados.add(g);
    atualizarTabelaSim();
  }));
}

function atualizarTabelaSim() {
  $('#sim-tabela').innerHTML = tabelaSimulacaoHtml();
  ligarTabelaSim();
}

let _timerSim;
function ligarSimulador() {
  const box = $('#simulador');
  const atualizar = () => {
    clearTimeout(_timerSim);
    _timerSim = setTimeout(() => {
      recalcular();
      atualizarTabelaSim();
      const n = Object.keys(E.rascunho).length;
      const dif = totalDe(E.res).total - totalDe(E.resSalvo).total;
      const imp = $('#sim-impacto');
      imp.className = `sim-impacto${n ? '' : ' neutro'}`;
      imp.innerHTML = n ? `Impacto da simulação no ano<strong>${dif >= 0 ? '+' : ''}${brl0.format(dif)}</strong>${n} filial(is) alterada(s)` : 'Sem alterações<strong>Orçamento salvo</strong>';
      $$('.sim-acoes button', box).forEach(b => { b.disabled = !n; });
      $('#sim-faixa').innerHTML = faixaRascunho();
      ligarFaixa($('#sim-faixa'));
    }, 120);
  };
  const marcar = (f, campo, valor) => {
    const salvo = E.dados.filiais[f];
    const CAMPOS = ['dissidio_ant_pct', 'dissidio_ant_mes', 'dissidio_pct', 'dissidio_mes', 'reaj_benef_ant_pct', 'reaj_benef_ant_mes', 'reaj_benef_pct', 'reaj_benef_mes'];
    const r = { ...Object.fromEntries(CAMPOS.map(k => [k, Number(salvo[k]) || 0])), ...(E.rascunho[f] || {}), [campo]: Number(valor) || 0 };
    if (CAMPOS.every(k => r[k] === (Number(salvo[k]) || 0))) delete E.rascunho[f];
    else E.rascunho[f] = r;
    box.querySelector(`.sim-filial[data-filial="${CSS.escape(f)}"]`)?.classList.toggle('alterada', Boolean(E.rascunho[f]));
  };
  $$('.sim-filial', box).forEach(linha => {
    linha.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('input', () => { marcar(linha.dataset.filial, inp.dataset.campo, inp.value); atualizar(); }));
  });
  $('#sim-todas', box).addEventListener('click', () => {
    const pct = $('#sim-todas-pct', box).value;
    const mes = $('#sim-todas-mes', box).value;
    const base = E.sim.reaj === 'benef' ? 'reaj_benef_' : 'dissidio_';
    const pre = $('#sim-todas-qual', box).value === 'ant' ? `${base}ant_` : base;
    if (pct === '') return toast('Informe o % de dissídio.', 'erro');
    $$('.sim-filial', box).forEach(linha => {
      linha.querySelector(`[data-campo="${pre}pct"]`).value = pct;
      linha.querySelector(`[data-campo="${pre}mes"]`).value = mes;
      marcar(linha.dataset.filial, `${pre}pct`, pct);
      marcar(linha.dataset.filial, `${pre}mes`, mes);
    });
    atualizar();
  });
  $$('#sim-reaj button', box).forEach(b => b.addEventListener('click', () => { E.sim.reaj = b.dataset.r; box.innerHTML = simuladorHtml(); ligarSimulador(); }));
  box.querySelector('[data-descartar]').addEventListener('click', descartarRascunho);
  box.querySelector('[data-aplicar]').addEventListener('click', aplicarRascunho);
}

function exportarExcel() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo em instantes.', 'erro');
  const wb = XLSX.utils.book_new();
  const r2 = v => Math.round(v * 100) / 100;
  const ag = totalDe(E.res);

  const resumo = [['Grupo', 'Rubrica', ...MESES, 'Total ano']];
  RUBRICAS.forEach((r, i) => {
    const meses = [...ag.porRubrica.slice(i * 12, i * 12 + 12)].map(r2);
    resumo.push([NOME_GRUPO[r.grupo], r.nome, ...meses, r2(meses.reduce((a, b) => a + b, 0))]);
  });
  resumo.push(['', 'TOTAL', ...[...ag.meses].map(r2), r2(ag.total)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo mensal');

  const porChave = (chave, titulo) => {
    const linhas = [[titulo, 'HC máx.', ...MESES, 'Total ano']];
    for (const [k, a] of Motor.agregar(E.res, chave, noFiltro)) linhas.push([k, Math.max(...a.hc), ...[...a.meses].map(r2), r2(a.total)]);
    return XLSX.utils.aoa_to_sheet(linhas);
  };
  XLSX.utils.book_append_sheet(wb, porChave(c => `${c.regional} · ${c.filial}`, 'Regional · Filial'), 'Por filial');
  XLSX.utils.book_append_sheet(wb, porChave(c => `${c.filial} · ${c.cc_cod || ''} ${c.cc_nome || ''}`.trim(), 'Filial · Centro de custo'), 'Por centro de custo');
  // Contas por grupo em cada filial e centro de custo (uma linha por conta lançada)
  const contas = [['Regional', 'Filial', 'Cód. C. Custo', 'Centro de custo', 'Grupo', 'Conta', ...MESES, 'Total ano']];
  const sep = '\u0000';
  for (const [k, a] of Motor.agregar(E.res, c => [c.regional, c.filial, c.cc_cod || '', c.cc_nome || ''].join(sep), noFiltro)) {
    const [regional, filial, cod, nome] = k.split(sep);
    RUBRICAS.forEach((r, i) => {
      const meses = [...a.porRubrica.slice(i * 12, i * 12 + 12)].map(r2);
      const t = meses.reduce((x, y) => x + y, 0);
      if (Math.abs(t) >= 0.005) contas.push([regional, filial, cod, nome, NOME_GRUPO[r.grupo], r.nome, ...meses, r2(t)]);
    });
  }
  const wsContas = XLSX.utils.aoa_to_sheet(contas);
  wsContas['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: contas.length - 1, c: contas[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, wsContas, 'Contas por filial e CC');

  // Formato próximo da planilha BZO: uma linha por colaborador, com o total anual de cada rubrica.
  const fil = filiaisComRascunho();
  const cab = ['Matrícula', 'Funcionário', 'Regional', 'UF', 'Filial', 'Situação', 'Função', 'Cargo', 'Cód. C. Custo', 'Centro de custo', 'Salário base', `Dissídio ${anoAnt()} %`, `Data-base dissídio ${anoAnt()}`, `Dissídio ${E.dados.config.ano} %`, `Mês dissídio ${E.dados.config.ano}`, 'Mês início', 'Mês fim', ...RUBRICAS.map(r => `${r.nome} (ano)`), 'Total ano'];
  const linhas = [cab];
  E.res.colaboradores.forEach((c, i) => {
    if (!noFiltro(c)) return;
    const vals = RUBRICAS.map((_, r) => { let s = 0; for (let m = 0; m < 12; m++) s += E.res.valor(i, r, m); return r2(s); });
    linhas.push([c.matricula, c.nome, c.regional, ufDe(c.filial), c.filial, c.situacao, c.funcao, c.cargo, c.cc_cod, c.cc_nome, c.salario,
      fil[c.filial]?.dissidio_ant_pct ?? 0, fil[c.filial]?.dissidio_ant_mes ?? '', fil[c.filial]?.dissidio_pct ?? 0, fil[c.filial]?.dissidio_mes ?? '', c.mes_inicio, c.mes_fim, ...vals, r2(vals.reduce((a, b) => a + b, 0))]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Por colaborador');

  // Comparativo com o ano anterior: por conta (mês a mês) e por filial · conta
  if (E.resAnt) {
    const ano = E.dados.config.ano, ant = anoAnt();
    const ag0 = totalDe(E.resAnt);
    const ag = totalDe(E.resCmp);
    const cmp = [['Grupo', 'Conta', ...MESES.map((m, i) => `${m}/${ant}${i >= mesesReaisAnt() ? ' (projetado)' : ''}`), `Total ${ant}`, ...MESES.map(m => `${m}/${ano}`), `Total ${ano}`, 'Δ R$', 'Δ %', 'Premissa']];
    RUBRICAS.forEach((r, i) => {
      const m0 = [...ag0.porRubrica.slice(i * 12, i * 12 + 12)].map(r2), m1 = [...ag.porRubrica.slice(i * 12, i * 12 + 12)].map(r2);
      const t0 = m0.reduce((a, b) => a + b, 0), t1 = m1.reduce((a, b) => a + b, 0);
      if (Math.abs(t0) + Math.abs(t1) >= 0.005) cmp.push([NOME_GRUPO[r.grupo], r.nome, ...m0, r2(t0), ...m1, r2(t1), r2(t1 - t0), t0 ? r2(((t1 - t0) / t0) * 100) : '', regraDaRubrica(r.id)]);
    });
    cmp.push(['', 'TOTAL', ...[...ag0.meses].map(r2), r2(ag0.total), ...[...ag.meses].map(r2), r2(ag.total), r2(ag.total - ag0.total), ag0.total ? r2(((ag.total - ag0.total) / ag0.total) * 100) : '', '']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), `Comparativo ${ant}x${ano}`.slice(0, 31));
    const f0 = Motor.agregar(E.resAnt, c => `${c.regional}${sep}${c.filial}`, noFiltro), f1 = Motor.agregar(E.resCmp, c => `${c.regional}${sep}${c.filial}`, noFiltro);
    const pf = [['Regional', 'Filial', 'Grupo', 'Conta', `Total ${ant}`, `Total ${ano}`, 'Δ R$', 'Δ %']];
    for (const k of new Set([...f0.keys(), ...f1.keys()])) {
      const [regional, filial] = k.split(sep);
      RUBRICAS.forEach((r, i) => {
        const t0 = f0.has(k) ? somaRub(f0.get(k), i) : 0, t1 = f1.has(k) ? somaRub(f1.get(k), i) : 0;
        if (Math.abs(t0) + Math.abs(t1) >= 0.005) pf.push([regional, filial, NOME_GRUPO[r.grupo], r.nome, r2(t0), r2(t1), r2(t1 - t0), t0 ? r2(((t1 - t0) / t0) * 100) : '']);
      });
    }
    const wsPf = XLSX.utils.aoa_to_sheet(pf);
    wsPf['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: pf.length - 1, c: pf[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, wsPf, `Comparativo por filial`);
  }

  const nome = [E.dados.config.ano, E.filtro.regional, E.filtro.uf, E.filtro.filial].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Orcamento-Pessoal-${nome}.xlsx`);
}

// ---------- Premissas ----------

const premEscopoRegional = escopo => (escopo.startsWith('R:') ? escopo.slice(2) : E.dados.filiais[escopo]?.regional);

/** Premissa herdada (o que vale se o escopo atual não tiver regra própria). */
function premHerdada(escopo, rub) {
  const P = E.dados.premissas;
  const padrao = RUBRICAS[IDX[rub]].padrao;
  if (escopo === '*') return { p: { ...padrao }, origem: 'padrão do sistema' };
  if (escopo.startsWith('R:')) return P['*']?.[rub] ? { p: { ...padrao, ...P['*'][rub] }, origem: 'regra geral' } : { p: { ...padrao }, origem: 'padrão do sistema' };
  const reg = premEscopoRegional(escopo);
  if (P['R:' + reg]?.[rub]) return { p: { ...padrao, ...P['R:' + reg][rub] }, origem: `regional ${reg}` };
  if (P['*']?.[rub]) return { p: { ...padrao, ...P['*'][rub] }, origem: 'regra geral' };
  return { p: { ...padrao }, origem: 'padrão do sistema' };
}

function premEfetiva(escopo, rub) {
  const ed = E.prem.edits;
  if (rub in ed) return ed[rub] ? { p: ed[rub], propria: true } : { ...premHerdada(escopo, rub), propria: false };
  const propria = E.dados.premissas[escopo]?.[rub];
  if (propria) return { p: { ...RUBRICAS[IDX[rub]].padrao, ...propria }, propria: true };
  return { ...premHerdada(escopo, rub), propria: false };
}

function colabsDoEscopo(escopo) {
  if (escopo === '*') return () => true;
  if (escopo.startsWith('R:')) return c => c.regional === escopo.slice(2);
  return c => c.filial === escopo;
}

/** Recalcula só com as edições pendentes aplicadas, para mostrar o custo de cada rubrica antes de salvar. */
function calcularPrevia() {
  const escopo = E.prem.escopo;
  const premissas = JSON.parse(JSON.stringify(E.dados.premissas));
  premissas[escopo] ||= {};
  for (const [rub, p] of Object.entries(E.prem.edits)) {
    if (p) premissas[escopo][rub] = p;
    else delete premissas[escopo][rub];
  }
  const filiais = { ...E.dados.filiais };
  if (E.dados.filiais[escopo]) filiais[escopo] = { ...filiais[escopo], ...E.prem.filial };
  // Calcula com todos (o total de uma regional/geral é dividido entre todas as filiais) e mostra só os do escopo.
  const filtro = colabsDoEscopo(escopo);
  const res = Motor.calcular({ colaboradores: E.dados.colaboradores, filiais, premissas, niveis: E.dados.niveis });
  const idx = res.colaboradores.map((c, i) => (filtro(c) ? i : -1)).filter(i => i >= 0);
  return { n: idx.length, colaboradores: idx.map(i => res.colaboradores[i]), valor: (i, r, m) => res.valor(idx[i], r, m) };
}

function renderPremissas() {
  const el = painel('premissas');
  const { escopo } = E.prem;
  const regs = regionais();
  const proprias = esc => Object.keys(E.dados.premissas[esc] || {}).length;
  const marca = esc => (proprias(esc) ? ' ●' : '');
  const regAtual = escopo === '*' ? '*' : premEscopoRegional(escopo);
  const filtrosHtml = `
    <div class="prem-filtros cartao">
      <label class="rotulo">Regional<select class="campo" id="prem-reg">
        <option value="*" ${regAtual === '*' ? 'selected' : ''}>★ Regra geral (todas as filiais)${marca('*')}</option>
        ${regs.map(r => `<option value="${esc(r)}" ${regAtual === r ? 'selected' : ''}>${esc(r)}${marca('R:' + r)}</option>`).join('')}
      </select></label>
      <label class="rotulo">Estado<select class="campo" id="prem-uf" ${regAtual === '*' ? 'disabled' : ''}>${regAtual === '*' ? '<option>—</option>' : opcoesUf(filiaisDa(regAtual), E.prem.uf)}</select></label>
      <label class="rotulo">Filial<select class="campo" id="prem-fil" ${regAtual === '*' ? 'disabled' : ''}>
        ${regAtual === '*' ? '<option>— escolha uma regional —</option>' : `<option value="R:${esc(regAtual)}" ${escopo === 'R:' + regAtual ? 'selected' : ''}>Toda a regional ${esc(regAtual)}${marca('R:' + regAtual)}</option>
        ${filiaisDa(regAtual).filter(f => bateUf(f, E.prem.uf) || f === escopo).map(f => `<option value="${esc(f)}" ${escopo === f ? 'selected' : ''}>${esc(f)}${ufDe(f) ? ` (${ufDe(f)})` : ''}${marca(f)}</option>`).join('')}`}
      </select></label>
      <p>● = tem regras próprias. A filial herda da regional, que herda da regra geral.<br><button class="btn-link" id="prem-estados">🗺 Estado de cada filial</button></p>
    </div>`;

  const ehFilial = Boolean(E.dados.filiais[escopo]);
  const nomeEscopo = escopo === '*' ? 'Regra geral' : escopo.startsWith('R:') ? `Regional ${escopo.slice(2)}` : escopo;
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(escopo));
  const cfgF = ehFilial ? { ...E.dados.filiais[escopo], ...E.prem.filial } : null;

  const cabecalho = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Premissas e <em>regras</em></h1>
      <p class="subtitulo">Para cada filial, diga se ela <b>tem</b> o item (Sim/Não), <b>como é calculado</b> (% ou R$) e o <b>valor</b>. O que for igual para todas pode ficar na <b>regra geral</b> ou na <b>regional</b> — a filial herda e só muda o que for diferente.</p></div>
      <div class="segmentos" id="prem-visao"><button data-v="filial" class="${E.prem.visao === 'filial' ? 'ativo' : ''}">Editar por filial</button><button data-v="quadro" class="${E.prem.visao === 'quadro' ? 'ativo' : ''}">Quadro de todas as filiais</button></div></div>`;
  const ligarVisao = () => $$('#prem-visao button', el).forEach(b => b.addEventListener('click', () => {
    const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
    if (pend && !confirm('Há alterações não salvas nesta tela. Descartar?')) return;
    E.prem.edits = {}; E.prem.filial = {};
    E.prem.visao = b.dataset.v;
    renderPremissas();
  }));
  if (E.prem.visao === 'quadro') {
    el.innerHTML = `${cabecalho}<div id="prem-conteudo"></div>`;
    ligarVisao();
    renderQuadro();
    return;
  }

  el.innerHTML = `${cabecalho}
    ${filtrosHtml}
    <div>
      <div>
        <div class="prem-cab">
          <div><small>${escopo === '*' ? 'TODAS AS FILIAIS' : escopo.startsWith('R:') ? 'REGIONAL' : `FILIAL · ${esc(cfgF.regional)} · ${esc(cfgF.uf || 'ESTADO A DEFINIR')}`}</small>
            <h2>${esc(nomeEscopo)}</h2>
            <p>${colabs.length} colaborador(es) · custo anual <b id="prem-total"></b></p></div>
          ${escopo === '*' ? `<label class="rotulo" style="width:150px">Ano do orçamento<input class="campo" id="cfg-ano" type="number" value="${esc(E.dados.config.ano)}"></label>` : ''}
        </div>
        ${ehFilial ? `
        <div class="reajustes">
          <div class="reajuste"><h4>📈 Reajuste salarial (dissídio)</h4>
            <div class="linha-campos"><b style="width:44px">${anoAnt()}</b><input class="campo" type="number" step="0.01" data-fcampo="dissidio_ant_pct" value="${cfgF.dissidio_ant_pct || 0}"> % data-base <select class="campo" data-fcampo="dissidio_ant_mes">${opcoesMes(cfgF.dissidio_ant_mes || 1)}</select></div>
            <div class="linha-campos" style="margin-top:.4rem"><b style="width:44px">${esc(E.dados.config.ano)}</b><input class="campo" type="number" step="0.01" data-fcampo="dissidio_pct" value="${cfgF.dissidio_pct}"> % data-base <select class="campo" data-fcampo="dissidio_mes">${opcoesMes(cfgF.dissidio_mes)}</select></div>
            <p><b>${anoAnt()}</b>: dissídio que o salário da base ainda não tem — entra na data-base de ${anoAnt()} e vale o ano todo de ${esc(E.dados.config.ano)}. <b>${esc(E.dados.config.ano)}</b>: entra na data-base de ${esc(E.dados.config.ano)}, por cima do primeiro. Ex.: 5% (ago/${String(anoAnt()).slice(-2)}) e 4,22% (ago/${String(E.dados.config.ano).slice(-2)}): jan–jul × 1,05; ago–dez × 1,05 × 1,0422. Adicionais, provisões e encargos acompanham.</p></div>
          <div class="reajuste"><h4>🎁 Reajuste de benefícios</h4>
            <div class="linha-campos"><b style="width:44px">${anoAnt()}</b><input class="campo" type="number" step="0.01" data-fcampo="reaj_benef_ant_pct" value="${cfgF.reaj_benef_ant_pct || 0}"> % data-base <select class="campo" data-fcampo="reaj_benef_ant_mes">${opcoesMes(cfgF.reaj_benef_ant_mes || 1)}</select></div>
            <div class="linha-campos" style="margin-top:.4rem"><b style="width:44px">${esc(E.dados.config.ano)}</b><input class="campo" type="number" step="0.01" data-fcampo="reaj_benef_pct" value="${cfgF.reaj_benef_pct}"> % data-base <select class="campo" data-fcampo="reaj_benef_mes">${opcoesMes(cfgF.reaj_benef_mes)}</select></div>
            <p>Soma-se aos benefícios em R$ lançados abaixo (por colaborador ou total da filial): com 4,5%, R$ 803 viram R$ 839,14. <b>${anoAnt()}</b>: reajuste que os valores lançados ainda não têm (data-base de ${anoAnt()}, vale o ano todo de ${esc(E.dados.config.ano)}); <b>${esc(E.dados.config.ano)}</b>: o da data-base do ano, por cima. <b>Se os valores lançados já estão reajustados, deixe 0.</b></p></div>
        </div>` : `
        <div class="reajuste" style="margin-bottom:1rem"><h4>📈 Dissídio em lote</h4>
          <div class="linha-campos">Aplicar o reajuste <select class="campo" id="lote-qual" style="width:auto"><option value="dissidio_ant_">salarial ${anoAnt()}</option><option value="dissidio_" selected>salarial ${esc(E.dados.config.ano)}</option><option value="reaj_benef_ant_">de benefícios ${anoAnt()}</option><option value="reaj_benef_">de benefícios ${esc(E.dados.config.ano)}</option></select> de <input class="campo" type="number" step="0.01" id="lote-pct" placeholder="%"> % a partir de <select class="campo" id="lote-mes">${opcoesMes(5)}</select> em todas as filiais ${escopo === '*' ? 'da empresa' : 'da regional'} <button class="btn btn-claro btn-sm" id="lote-aplicar">Aplicar</button></div>
          <p>Grava direto em cada filial. Depois é possível ajustar filial por filial.</p></div>`}
        <div class="tabela-wrap"><table class="tabela tabela-prem" id="tabela-prem"></table></div>
        <div class="prem-rodape">
          <span class="info" id="prem-info"></span>
          ${ehFilial ? '<button class="btn btn-claro btn-sm" id="prem-copiar">Copiar regras desta filial para…</button>' : ''}
          <button class="btn btn-claro btn-sm" id="prem-descartar">Descartar</button>
          <button class="btn btn-laranja btn-sm" id="prem-salvar">Salvar premissas</button>
        </div>
      </div>
    </div>`;

  ligarVisao();
  $('#prem-reg', el).addEventListener('change', e => trocarEscopo(e.target.value === '*' ? '*' : `R:${e.target.value}`));
  $('#prem-fil', el).addEventListener('change', e => trocarEscopo(e.target.value));
  $('#prem-uf', el)?.addEventListener('change', e => { E.prem.uf = e.target.value; renderPremissas(); });
  $('#prem-estados', el).addEventListener('click', editarEstados);
  $$('[data-fcampo]', el).forEach(i => i.addEventListener('input', () => { E.prem.filial[i.dataset.fcampo] = Number(i.value) || 0; atualizarPrevia(); }));
  $('#prem-salvar', el).addEventListener('click', salvarPremissas);
  $('#prem-descartar', el).addEventListener('click', () => { E.prem.edits = {}; E.prem.filial = {}; E.prem.propagar = {}; renderPremissas(); });
  $('#prem-copiar', el)?.addEventListener('click', copiarPremissas);
  $('#lote-aplicar', el)?.addEventListener('click', async () => {
    const pct = $('#lote-pct').value;
    if (pct === '') return toast('Informe o %.', 'erro');
    const alvo = escopo === '*' ? filiaisDa('') : filiaisDa(escopo.slice(2));
    const pre = $('#lote-qual').value;
    const qual = $('#lote-qual').selectedOptions[0].textContent;
    if (!confirm(`Aplicar reajuste ${qual} de ${pct}% a partir de ${MESES[$('#lote-mes').value - 1]} em ${alvo.length} filial(is)?`)) return;
    await api('/api/filiais', { method: 'PUT', body: { filiais: alvo.map(filial => ({ filial, [`${pre}pct`]: pct, [`${pre}mes`]: $('#lote-mes').value })) } });
    await carregar();
    toast('Reajuste aplicado.');
    renderPremissas();
  });
  $('#cfg-ano', el)?.addEventListener('change', async e => {
    try { await api('/api/config', { method: 'PUT', body: { ano: e.target.value } }); E.dados.config.ano = e.target.value; atualizarAno(); toast('Ano do orçamento atualizado.'); } catch (err) { toast(err.message, 'erro'); }
  });
  desenharTabelaPrem();
}

function trocarEscopo(escopo) {
  const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
  if (pend && !confirm('Há alterações não salvas nesta tela. Descartar e trocar?')) { renderPremissas(); return; }
  E.prem.escopo = escopo;
  E.prem.propagar = {};
  E.prem.edits = {};
  E.prem.filial = {};
  renderPremissas();
  window.scrollTo(0, 0);
}

const TIPOS = { pct: '% sobre base', pct_folha: '% da folha (remuneração)', fixo: 'R$ por colaborador', rateio: 'Total da filial (média por colab.)', multiplo: 'Nº de salários', nivel: 'Nº de salários por nível do cargo' };
// "Por nível do cargo" é o método nº de salários com a tabela de níveis ligada.
// "% da folha" é o % com a base folha (salário + todo o grupo Remuneração), em destaque para PPR, bônus etc.
const tipoDe = p => (p.metodo === 'multiplo' && p.por_nivel ? 'nivel' : p.metodo === 'pct' && p.base === 'folha' ? 'pct_folha' : p.metodo);
/** Regra a partir do tipo escolhido na tela ("nivel" e "pct_folha" são atalhos de outros métodos). */
function regraDoTipo(tipo, p) {
  if (tipo === 'nivel') return { ...p, metodo: 'multiplo', por_nivel: true };
  if (tipo === 'pct_folha') return { ...p, metodo: 'pct', base: 'folha', por_nivel: false };
  if (tipo === 'pct') return { ...p, metodo: 'pct', por_nivel: false, base: p.base === 'folha' && p.metodo === 'pct' ? 'salario' : p.base || 'salario' };
  return { ...p, metodo: tipo, por_nivel: false };
}
const fmtN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

function unidadeValor(metodo, periodo) {
  if (periodo === 'por_mes' && (metodo === 'fixo' || metodo === 'rateio')) return '';
  if (metodo === 'rateio') return { anual_diluido: 'R$ total no ano', mensal: 'R$ total por mês', anual_mes: 'R$ no mês' }[periodo] || 'R$ total';
  if (metodo === 'fixo' && periodo === 'anual_mes') return 'R$ / colab. (1x)';
  if (metodo === 'fixo' && periodo === 'anual_diluido') return 'R$ / colab. no ano';
  return { pct: '%', pct_folha: '% da folha do mês', fixo: 'R$ / colab. / mês', multiplo: 'salários' }[metodo] || '';
}

/** Tipo de cobrança usado quando a filial passa de "Não tem" para "Tem". */
function metodoAoLigar(rub, p) {
  if (p.ultimo_metodo && p.ultimo_metodo !== 'nao') return p.ultimo_metodo;
  const padrao = RUBRICAS[IDX[rub]].padrao.metodo;
  if (padrao !== 'nao') return padrao;
  return RUBRICAS[IDX[rub]].adicional ? 'pct' : 'fixo';
}

/** Resumo curto dos detalhes (base, periodicidade, rateio, teto). */
function resumoDetalhes(p) {
  if (p.metodo === 'pct') return `s/ ${BASES[p.base].toLowerCase()}${p.teto ? ` · teto ${brl0.format(p.teto)}` : ''}${p.inicio > 1 ? ` · a partir de ${MESES[p.inicio - 1]}` : ''}${p.inicio2 > 1 ? ` · + ${fmtN(p.valor)}% a partir de ${MESES[p.inicio2 - 1]}` : ''}${p.provisao ? ' · provisão (depois vai para o salário)' : ''}`;
  const per = { mensal: 'todo mês', anual_mes: `1x no ano · ${MESES[p.mes - 1]}`, anual_diluido: 'anual ÷ 12', por_mes: 'valor por mês' }[p.periodo];
  if (p.metodo === 'rateio') return `${{ mensal: 'total do mês', anual_mes: `total em ${MESES[p.mes - 1]}`, anual_diluido: 'total do ano ÷ 12', por_mes: 'total de cada mês' }[p.periodo]}${p.dividir === 'escopo' ? ' · dividido entre as filiais' : ''} · ${p.rateio === 'salario' ? 'proporcional ao salário' : 'média por colaborador'}`;
  if (p.metodo === 'multiplo') return per;
  return per;
}

/** Valor curto para o quadro de filiais e para o Excel de premissas. */
function textoCurto(p) {
  if (p.periodo === 'por_mes' && (p.metodo === 'fixo' || p.metodo === 'rateio')) return 'por mês';
  switch (p.metodo) {
    case 'pct': return `${fmtN(p.valor)}%${p.base === 'folha' ? ' folha' : ''}`;
    case 'fixo': return `R$ ${fmtN(p.valor)}`;
    case 'rateio': return `R$ ${fmtN(p.valor)} total${p.periodo === 'anual_diluido' ? '/ano' : p.periodo === 'mensal' ? '/mês' : ''}`;
    case 'multiplo': return p.por_nivel ? 'nível' : `${fmtN(p.valor)} sal`;
    default: return 'Não';
  }
}

/** Na filial com reajuste de benefícios, mostra quanto o valor lançado vira depois do reajuste. */
function notaReajuste(rub, tipo, p) {
  const { escopo } = E.prem;
  if (rub.grupo !== 'beneficios' || (tipo !== 'fixo' && tipo !== 'rateio') || !E.dados.filiais[escopo]) return '';
  const cfg = { ...E.dados.filiais[escopo], ...E.prem.filial };
  const fim = fatorBenefDe(cfg, 11);
  if (fim === 1 || !Number(p.valor)) return '';
  return `<small class="nota-reajuste" title="Reajuste de benefícios da filial: ${esc(textoReajuste(cfg, 'reaj_benef'))}">+${esc(textoReajuste(cfg, 'reaj_benef'))} → ${brl.format(Number(p.valor) * fim)}</small>`;
}

/** Quantos colaboradores do escopo têm valor personalizado (ajustado à mão) neste item. */
const personalizados = rid => E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo)).filter(c => c.excecoes?.[rid] && c.excecoes[rid].origem !== 'base').length;

function linhaPremHtml(rub, previa) {
  const { escopo } = E.prem;
  const { p, propria, origem } = premEfetiva(escopo, rub.id);
  const r = IDX[rub.id];
  let anual = 0;
  for (let i = 0; i < previa.n; i++) for (let m = 0; m < 12; m++) anual += previa.valor(i, r, m);
  const tem = p.metodo !== 'nao';
  const tipo = tem ? tipoDe(p) : metodoAoLigar(rub.id, p);
  const tipos = rub.adicional ? { pct: TIPOS.pct, fixo: TIPOS.fixo, rateio: TIPOS.rateio } : TIPOS;
  const nNiveis = Object.keys(p.niveis || {}).length;
  const totalMeses = (p.meses || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const valorHtml = (tipo === 'fixo' || tipo === 'rateio') && p.periodo === 'por_mes'
    ? `<button class="btn-detalhe btn-niveis" data-detalhes2 title="Valores de cada mês">📅 12 meses · ${brl0.format(totalMeses)} no ano</button>`
    : tipo === 'nivel'
    ? `<button class="btn-detalhe btn-niveis" data-niveis title="Target de salários por nível do cargo">📋 Tabela por nível · ${nNiveis ? `${nNiveis} nível(is)` : 'preencher'}</button>`
    : `<span class="valor-un"><input class="campo" type="number" step="any" data-campo="valor" value="${p.valor ?? 0}"><small>${unidadeValor(tipo, p.periodo).replace('R$ total', tipo === 'rateio' && p.dividir === 'escopo' ? `R$ total ${E.prem.escopo === '*' ? 'da empresa' : 'da regional'}` : 'R$ total')}</small></span>${notaReajuste(rub, tipo, p)}`;
  const desab = tem ? '' : ' desab';
  // Quem tem valor da planilha da base para este item: por padrão fica com o valor dele; marcando, a regra vale para todos.
  const daBase = tem && tipo !== 'rateio' ? E.dados.colaboradores.filter(colabsDoEscopo(escopo)).filter(c => c.excecoes?.[rub.id]?.origem === 'base').length : 0;
  const valeTodos = daBase ? `<label class="vale-todos${p.vale_todos ? ' ligado' : ''}" title="Estes colaboradores têm o valor deste item na planilha da base, que vale no lugar da regra"><input type="checkbox" data-vale-todos ${p.vale_todos ? 'checked' : ''}> Usar esta regra também para os <b>${num0.format(daBase)}</b> com valor da planilha da base</label>` : '';
  return `<tr class="${propria ? 'propria' : 'herdada'}${tem ? '' : ' nao-tem'}" data-rub="${rub.id}">
    <td class="rub fixa">${esc(rub.nome)}<small>${propria ? (escopo === '*' ? 'regra geral' : escopo.startsWith('R:') ? 'regra da regional' : 'regra desta filial') : `herdada · ${esc(origem)}`}</small></td>
    <td><label class="chave" title="A filial tem este item?"><input type="checkbox" data-tem ${tem ? 'checked' : ''}><span></span><b>${tem ? 'Sim' : 'Não'}</b></label></td>
    <td class="${desab}"><select class="campo" data-campo="metodo">${Object.entries(tipos).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td class="${desab}">${valorHtml}${valeTodos}</td>
    <td class="${desab}"><button class="btn-detalhe" data-detalhes title="Base, periodicidade, rateio e teto">⚙ ${esc(resumoDetalhes(regraDoTipo(tipo, p)))}</button></td>
    <td><button class="btn-detalhe" data-quem title="Quem recebe esta rubrica e valor personalizado por colaborador">${personalizados(rub.id) ? `<b class="qtd-pessoas">${personalizados(rub.id)} personalizado(s)</b> · ` : ''}👥 ${[p.publico === 'F' ? '♀ Mulheres' : p.publico === 'M' ? '♂ Homens' : '', p.quem?.length ? `${p.quem.length} grupo(s)` : ''].filter(Boolean).join(' · ') || 'Todos'}${Object.keys(p.por_funcao || {}).length ? ' · valor por função' : ''}${p.periodo === 'por_mes' && p.publico_meses?.some(Boolean) ? ' · público por mês' : ''}</button></td>
    <td class="n" data-anual>${anual ? brl0.format(anual) : '–'}</td>
    <td><span class="acoes">${anual ? '<button class="btn-ic" data-ver title="Ver distribuição por centro de custo e colaborador">🔍</button>' : ''}${propria ? `<button class="btn-ic" data-reset title="${escopo === '*' ? 'Voltar ao padrão do sistema' : 'Remover regra própria (volta a herdar)'}">↺</button>` : ''}</span></td>
  </tr>`;
}

function desenharTabelaPrem() {
  const previa = calcularPrevia();
  const t = $('#tabela-prem');
  t.innerHTML = `<thead><tr><th class="fixa">Item</th><th>Tem?</th><th>Como é calculado</th><th>Valor</th><th>Detalhes</th><th>Quem recebe</th><th class="n">Custo anual</th><th></th></tr></thead>
    <tbody>${GRUPOS.map(g => `<tr class="grupo"><td class="fixa" colspan="8"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${g.cor};margin-right:.4rem"></i>${g.nome}</td></tr>
      ${RUBRICAS.filter(r => r.grupo === g.id && !r.fixa && !r.soLancamento).map(r => linhaPremHtml(r, previa)).join('')}`).join('')}</tbody>`;
  $$('tr[data-rub]', t).forEach(tr => {
    const rub = tr.dataset.rub;
    const atual = () => ({ ...premEfetiva(E.prem.escopo, rub).p });
    tr.querySelector('[data-tem]').addEventListener('change', e => {
      const p = atual();
      E.prem.edits[rub] = e.target.checked
        ? { ...p, metodo: metodoAoLigar(rub, p) }
        : { ...p, metodo: 'nao', ultimo_metodo: p.metodo !== 'nao' ? p.metodo : p.ultimo_metodo };
      desenharTabelaPrem();
    });
    tr.querySelector('[data-campo="metodo"]').addEventListener('change', e => {
      const v = e.target.value;
      E.prem.edits[rub] = regraDoTipo(v, atual());
      // Total da filial costuma ser o valor do ano: passa de "todo mês" para "total do ano ÷ 12" (dá para trocar no ⚙)
      if (v === 'rateio' && E.prem.edits[rub].periodo === 'mensal') {
        E.prem.edits[rub].periodo = 'anual_diluido';
        toast('Total da filial: valor do ano dividido em 12 meses. Para outro período, use o ⚙.');
      }
      desenharTabelaPrem();
      if (v === 'nivel' && !Object.keys(E.prem.edits[rub].niveis || {}).length) editarNiveis(rub);
    });
    tr.querySelector('[data-niveis]')?.addEventListener('click', () => editarNiveis(rub));
    tr.querySelector('[data-detalhes2]')?.addEventListener('click', () => editarDetalhes(rub));
    tr.querySelector('[data-campo="valor"]')?.addEventListener('input', e => {
      E.prem.edits[rub] = { ...atual(), valor: Number(e.target.value) || 0 };
      atualizarPrevia();
    });
    tr.querySelector('[data-detalhes]').addEventListener('click', () => editarDetalhes(rub));
    tr.querySelector('[data-quem]').addEventListener('click', () => escolherQuem(rub));
    tr.querySelector('[data-reset]')?.addEventListener('click', () => { E.prem.edits[rub] = null; desenharTabelaPrem(); });
    tr.querySelector('[data-vale-todos]')?.addEventListener('change', e => { E.prem.edits[rub] = { ...atual(), vale_todos: e.target.checked }; desenharTabelaPrem(); });
    tr.querySelector('[data-ver]')?.addEventListener('click', () => verDistribuicao(rub));
  });
  atualizarRodapePrem(previa);
}

/** Detalhes da regra: base do %, teto, periodicidade, mês, forma de rateio e PPR por nível. */
function editarDetalhes(rub) {
  const p = { ...premEfetiva(E.prem.escopo, rub).p };
  const rubrica = RUBRICAS[IDX[rub]];
  const m = p.metodo === 'nao' ? metodoAoLigar(rub, p) : p.metodo;
  const sel = (nome, opcoes, valor) => `<select class="campo" name="${nome}">${Object.entries(opcoes).map(([k, v]) => `<option value="${k}" ${String(k) === String(valor) ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const bases = rubrica.adicional ? { salario: BASES.salario } : BASES;
  const d = abrirModal({
    titulo: rubrica.nome, sup: `DETALHES · ${TIPOS[tipoDe({ ...p, metodo: m })].toUpperCase()}`,
    corpo: `<form class="form-grade" id="form-detalhes">
      ${m === 'pct' ? `
        <label class="rotulo">% calculado sobre${sel('base', bases, p.base)}<small>Remuneração = salário + adicionais. Folha = remuneração + horas extras.</small></label>
        <label class="rotulo">Teto mensal (R$) <small>opcional</small><input class="campo" name="teto" type="number" step="any" value="${p.teto ?? ''}" placeholder="sem teto"></label>
        <label class="rotulo">A partir de<select class="campo" name="inicio">${opcoesMes(p.inicio || 1)}</select><small>Mês em que o % passa a valer (ex.: méritos de 2% a partir de abril). Janeiro = o ano todo.</small></label>
        <label class="rotulo">2º aumento a partir de <small>(opcional)</small><select class="campo" name="inicio2">${opcoesMes(p.inicio2 || '', true)}</select><small>Mais o mesmo % a partir deste mês, somado ao 1º (ex.: 0,40% da folha em abril e mais 0,40% em outubro). O aumento fica no salário dos meses seguintes.</small></label>
        <label class="check inteiro"><input type="checkbox" name="provisao" ${p.provisao ? 'checked' : ''}><span><b>Provisão de aumento</b>: o valor aparece nesta conta <b>só no(s) mês(es) do aumento</b> e, nos meses seguintes, é somado ao <b>salário da filial</b> (no total da filial/centro de custo, sem distribuir por colaborador). Férias, 13º, FGTS e INSS acompanham.</span></label>`
      : `
        <label class="rotulo">Quando é pago${sel('periodo', m === 'multiplo' ? Object.fromEntries(Object.entries(PERIODOS).filter(([k]) => k !== 'por_mes')) : PERIODOS, p.periodo)}<small>“Uma vez no ano” lança o valor inteiro no mês escolhido (ex.: PPR em fevereiro). “Valor diferente em cada mês” serve para gastos que variam (ex.: ações de endomarketing).</small></label>
        <label class="rotulo" id="box-mes">Mês do pagamento<select class="campo" name="mes">${opcoesMes(p.mes)}</select></label>
        <div class="inteiro meses-box" id="box-meses">
          <b>${m === 'rateio' ? 'Total da filial em cada mês (R$)' : 'Valor por colaborador em cada mês (R$)'}</b>
          <div class="meses-grade">${MESES.map((nm, i) => `<label>${nm}<input class="campo" type="number" step="any" data-mesv="${i}" value="${p.meses?.[i] || ''}" placeholder="0">
            <select class="campo publico-mes" data-pubm="${i}" title="Público deste mês"><option value="">Todos</option><option value="F" ${p.publico_meses?.[i] === 'F' ? 'selected' : ''}>♀ Mulher</option><option value="M" ${p.publico_meses?.[i] === 'M' ? 'selected' : ''}>♂ Homem</option></select></label>`).join('')}</div>
          <small class="dica-publico">Público de cada mês: ex.: outubro rosa só para mulheres, novembro azul só para homens. ${avisoSemSexo()}</small>
          <div class="meses-colar"><input class="campo" id="meses-colar" placeholder="Ou cole aqui a linha do Excel com os 12 valores (Jan a Dez)"><small id="meses-total"></small></div>
        </div>`}
      ${m === 'multiplo' ? `<label class="check inteiro"><input type="checkbox" name="sem_dissidio" ${p.sem_dissidio ? 'checked' : ''}> Ignorar o dissídio (usar o salário da base)</label>
        <p class="inteiro" style="margin:0;font-size:.8rem;color:var(--texto-suave)">Padrão: novo salário (com o dissídio da filial) × nº de salários. Ex.: R$ 13.780 com dissídio de 5% = R$ 14.469 × 2 = R$ 28.938 no ano, lançado inteiro no mês escolhido ou diluído em 12 meses.</p>` : ''}
      ${outrosEscopos(rub).length && m !== 'pct' ? `<label class="check inteiro propagar"><input type="checkbox" name="propagar"><span>Aplicar esta forma de pagamento também às <b>${outrosEscopos(rub).length} regra(s) própria(s)</b> de ${E.prem.escopo === '*' ? 'regionais e filiais' : 'filiais desta regional'} para este item <small>${esc(outrosEscopos(rub).map(e => e.replace(/^R:/, 'Regional ')).join(', ').slice(0, 160))} — cada uma mantém os seus valores${m === 'multiplo' ? ' e targets' : ''}</small></span></label>` : ''}
      ${m === 'rateio' && !E.dados.filiais[E.prem.escopo] ? `<label class="rotulo inteiro">De quem é este total${sel('dividir', { '': 'De cada filial (cada filial tem este valor)', escopo: E.prem.escopo === '*' ? 'Da empresa toda (dividido entre todas as filiais)' : 'Da regional toda (dividido entre todas as filiais da regional)' }, p.dividir || '')}<small>Ex.: treinamento de R$ 8.293,08 por mês para a regional inteira → “da regional toda”. Filiais com regra própria ficam fora da divisão.</small></label>` : ''}
      ${m === 'rateio' ? `<label class="rotulo inteiro">Como dividir o total entre os colaboradores${sel('rateio', { hc: 'Igual por pessoa (headcount)', salario: 'Proporcional ao salário' }, p.rateio)}</label>` : ''}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-detalhes">Aplicar</button>',
  });
  const f0 = $('#form-detalhes', d);
  const mostrar = () => {
    if (!f0.periodo) return;
    $('#box-mes', d).hidden = f0.periodo.value !== 'anual_mes';
    $('#box-meses', d).hidden = f0.periodo.value !== 'por_mes';
  };
  const somaMeses = () => {
    const t = $$('[data-mesv]', d).reduce((s, i) => s + (Number(i.value) || 0), 0);
    if ($('#meses-total', d)) $('#meses-total', d).textContent = `Total no ano: ${brl.format(t)}${m === 'fixo' ? ' por colaborador' : ' por filial'}`;
  };
  f0.periodo?.addEventListener('change', mostrar);
  $$('[data-mesv]', d).forEach(i => i.addEventListener('input', somaMeses));
  $('#meses-colar', d)?.addEventListener('input', e => {
    const nums = e.target.value.trim().split(/\t|;|\s{2,}/).map(x => Number(String(x).replace(/R\$|\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))).filter(x => !Number.isNaN(x));
    if (nums.length < 2) return;
    $$('[data-mesv]', d).forEach((i, k) => { i.value = nums[k] ?? ''; });
    e.target.value = '';
    somaMeses();
  });
  mostrar();
  somaMeses();
  $('#ok-detalhes', d).addEventListener('click', () => {
    const f = $('#form-detalhes', d);
    const novo = { ...p };
    if (f.base) novo.base = f.base.value;
    if (f.teto) novo.teto = f.teto.value === '' ? null : Number(f.teto.value);
    if (f.inicio) novo.inicio = Number(f.inicio.value);
    if (f.inicio2) novo.inicio2 = Number(f.inicio2.value) || 0;
    if (f.provisao) novo.provisao = f.provisao.checked;
    if (f.periodo) novo.periodo = f.periodo.value;
    if (f.mes) novo.mes = Number(f.mes.value);
    if (f.rateio) novo.rateio = f.rateio.value;
    if (f.dividir) novo.dividir = f.dividir.value;
    if (f.sem_dissidio) novo.sem_dissidio = f.sem_dissidio.checked;
    if (f.periodo?.value === 'por_mes') {
      novo.meses = $$('[data-mesv]', d).map(i => Number(i.value) || 0);
      novo.publico_meses = $$('[data-pubm]', d).map(i => i.value);
    }
    if (f.propagar?.checked) E.prem.propagar[rub] = { escopos: outrosEscopos(rub), periodo: novo.periodo, mes: novo.mes, meses: novo.meses };
    else delete E.prem.propagar[rub];
    E.prem.edits[rub] = novo;
    d.close();
    desenharTabelaPrem();
  });
}

/** Estado (UF) de cada filial: sugerido pelo nome da unidade; aqui o admin confirma ou corrige. */
function editarEstados() {
  const fils = Object.values(E.dados.filiais).sort((a, b) => a.regional.localeCompare(b.regional) || a.filial.localeCompare(b.filial));
  const semUf = fils.filter(f => !f.uf).length;
  const d = abrirModal({
    titulo: 'Estado de cada filial', sup: 'FILTRO POR ESTADO', largo: true,
    corpo: `<p class="subtitulo" style="margin:0">O estado foi sugerido pelo nome da unidade quando o nome indica a cidade (ex.: Cuiabá → MT, Candiota → RS). ${semUf ? `<b style="color:#b54d12">${semUf} filial(is) ainda sem estado</b> — o nome não indica onde ficam; escolha abaixo.` : 'Todas as filiais têm estado.'}</p>
      <div class="tabela-wrap" style="max-height:55vh"><table class="tabela"><thead><tr><th>Regional</th><th>Filial</th><th class="n">Colab.</th><th>Estado</th></tr></thead>
      <tbody>${fils.map(f => `<tr class="${f.uf ? '' : 'sem-vinculo'}"><td>${esc(f.regional)}</td><td>${esc(f.filial)}</td><td class="n">${E.dados.colaboradores.filter(c => c.filial === f.filial).length}</td>
        <td><select class="campo" data-uf-filial="${esc(f.filial)}" style="width:150px"><option value="">— a definir —</option>${UFS_BR.map(u => `<option ${u === f.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-estados">Salvar estados</button>',
  });
  $('#salvar-estados', d).addEventListener('click', async () => {
    const filiais = $$('[data-uf-filial]', d).filter(s => s.value !== (E.dados.filiais[s.dataset.ufFilial].uf || '')).map(s => ({ filial: s.dataset.ufFilial, uf: s.value || null }));
    if (filiais.length) await api('/api/filiais', { method: 'PUT', body: { filiais } });
    d.close();
    await carregar();
    renderAba();
    toast(filiais.length ? `Estado atualizado em ${filiais.length} filial(is).` : 'Nada para alterar.');
  });
}

/** Regras próprias abaixo do escopo atual para o item (geral → regionais e filiais; regional → filiais dela). */
function outrosEscopos(rub) {
  const esc = E.prem.escopo;
  if (esc !== '*' && !esc.startsWith('R:')) return [];
  const reg = esc.slice(2);
  return Object.keys(E.dados.premissas).filter(e => e !== esc && e !== '*' && E.dados.premissas[e]?.[rub]
    && (esc === '*' || (E.dados.filiais[e] && E.dados.filiais[e].regional === reg)));
}

/** Tabela de nº de salários (target) por nível do cargo, guardada na própria regra — ex.: Holding/matriz. */
function editarNiveis(rub) {
  const p = { ...premEfetiva(E.prem.escopo, rub).p };
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo));
  const tabela = { ...(p.niveis || {}) };
  const todos = () => [...new Set([...E.dados.colaboradores.map(c => c.cargo).filter(Boolean), ...Object.keys(tabela)])].sort();
  const nomeEscopo = E.prem.escopo === '*' ? 'Regra geral' : E.prem.escopo.startsWith('R:') ? `Regional ${E.prem.escopo.slice(2)}` : E.prem.escopo;
  const d = abrirModal({
    titulo: `${RUBRICAS[IDX[rub]].nome} por nível do cargo · ${nomeEscopo}`, sup: 'TARGET DE SALÁRIOS', largo: true,
    corpo: `
      <div class="niveis-grade">
        <div>
          <div class="tabela-wrap" style="max-height:52vh"><table class="tabela"><thead><tr><th>Nível do cargo</th><th class="n">Colaboradores aqui</th><th>Nº de salários</th></tr></thead><tbody id="niveis-corpo"></tbody></table></div>
          <label class="rotulo" style="margin-top:.8rem;max-width:340px">Níveis sem valor na tabela recebem<span class="valor-un"><input class="campo" type="number" step="any" id="niveis-padrao" value="${p.valor ?? 1}"><small>salário(s)</small></span></label>
        </div>
        <div class="niveis-colar">
          <h4>📋 Colar do Excel</h4>
          <p>Copie as duas colunas da sua planilha (<b>NÍVEL CARGO</b> e <b>TARGET</b>) e cole aqui. Pode incluir o cabeçalho.</p>
          <textarea class="campo" id="niveis-texto" rows="9" placeholder="07-Supervisores&#9;2&#10;09-Administrativo&#9;1&#10;06-Coordenação&#9;3&#10;05-Gerentes&#9;5"></textarea>
          <button type="button" class="btn btn-marinho btn-sm" id="niveis-aplicar-colado">Preencher a tabela</button>
          <small id="niveis-msg"></small>
        </div>
      </div>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-niveis">Aplicar</button>',
  });
  const desenhar = () => {
    $('#niveis-corpo', d).innerHTML = todos().map(n => `<tr><td>${esc(n)}</td><td class="n">${colabs.filter(c => c.cargo === n).length}</td>
      <td><input class="campo" style="width:90px;padding:.35rem .5rem" type="number" step="any" data-nivel="${esc(n)}" value="${tabela[n] ?? ''}" placeholder="${esc($('#niveis-padrao', d)?.value ?? '')}"></td></tr>`).join('')
      || '<tr><td colspan="3" class="vazio">Importe a base ou cole a tabela ao lado.</td></tr>';
    $$('[data-nivel]', d).forEach(i => i.addEventListener('input', () => { if (i.value === '') delete tabela[i.dataset.nivel]; else tabela[i.dataset.nivel] = Number(i.value); }));
  };
  desenhar();
  $('#niveis-padrao', d).addEventListener('input', () => $$('[data-nivel]', d).forEach(i => { i.placeholder = $('#niveis-padrao', d).value; }));
  $('#niveis-aplicar-colado', d).addEventListener('click', () => {
    const existentes = new Map(todos().map(n => [normCab(n), n]));
    let ok = 0;
    for (const linha of $('#niveis-texto', d).value.split(/\r?\n/)) {
      const m = linha.trim().match(/^(.+?)[\t;]+\s*([\d.,]+)\s*$/) || linha.trim().match(/^(.+?)\s+([\d.,]+)\s*$/);
      if (!m) continue;
      const nome = existentes.get(normCab(m[1])) || m[1].trim();
      tabela[nome] = Number(m[2].replace(',', '.')) || 0;
      ok++;
    }
    $('#niveis-msg', d).textContent = ok ? `✓ ${ok} nível(is) preenchido(s).` : 'Não reconheci nenhuma linha. Use “nível” e “target” separados por tabulação.';
    desenhar();
  });
  $('#ok-niveis', d).addEventListener('click', () => {
    E.prem.edits[rub] = { ...p, metodo: 'multiplo', por_nivel: true, niveis: { ...tabela }, valor: Number($('#niveis-padrao', d).value) || 0 };
    d.close();
    desenharTabelaPrem();
  });
}

// ----- Quadro de todas as filiais -----

function renderQuadro() {
  const el = $('#prem-conteudo');
  const fils = Object.values(E.dados.filiais).filter(f => (!E.prem.quadroReg || f.regional === E.prem.quadroReg) && bateUf(f.filial, E.prem.uf))
    .sort((a, b) => a.regional.localeCompare(b.regional) || a.filial.localeCompare(b.filial));
  const rubs = RUBRICAS.filter(r => !r.fixa && !r.soLancamento);
  const efet = (f, r) => Motor.premissaDe(E.dados.premissas, f.filial, f.regional, r.id);
  const visiveis = E.prem.ocultarVazios ? rubs.filter(r => fils.some(f => efet(f, r).metodo !== 'nao')) : rubs;
  el.innerHTML = `
    <div class="ferramentas">
      <select class="campo" id="q-reg" aria-label="Regional"><option value="">Todas as regionais</option>${regionais().map(r => `<option ${r === E.prem.quadroReg ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <select class="campo" id="q-uf" aria-label="Estado">${opcoesUf(filiaisDa(E.prem.quadroReg), E.prem.uf)}</select>
      <label class="check"><input type="checkbox" id="q-ocultar" ${E.prem.ocultarVazios ? 'checked' : ''}> Ocultar itens que nenhuma filial tem</label>
      <span class="legenda-quadro"><span class="propria">desta filial</span><span>herdado (regional/geral)</span><span class="nao">não tem</span></span>
      <span class="direita">
        <button class="btn btn-sm ${E.prem.quadroEditar ? 'btn-marinho' : 'btn-claro'}" id="q-editar" title="Clique numa célula do quadro para mudar a regra da filial ali mesmo">✏️ ${E.prem.quadroEditar ? 'Editando — clique numa célula' : 'Editar manualmente'}</button>
        <button class="btn btn-laranja btn-sm" id="q-modelo">📝 Modelo para preenchimento</button>
        <button class="btn btn-claro btn-sm" id="q-exportar">⬇ Exportar quadro (Excel)</button>
        <label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar quadro<input type="file" id="q-importar" accept=".xlsx,.xls" hidden></label>
      </span>
    </div>
    ${fils.length ? `<div class="tabela-wrap alta"><table class="tabela quadro">
      <thead><tr><th class="fixa">Filial</th><th>UF</th><th>Dissídio</th>${visiveis.map(r => `<th title="${esc(NOME_GRUPO[r.grupo])}" style="box-shadow:inset 0 3px 0 ${COR_GRUPO[r.grupo]}">${esc(r.nome)}</th>`).join('')}</tr></thead>
      <tbody>${fils.map((f, k) => `${k === 0 || fils[k - 1].regional !== f.regional ? `<tr class="grupo"><td class="fixa" colspan="${visiveis.length + 3}">${esc(f.regional)}</td></tr>` : ''}
        <tr><td class="fixa"><button class="btn-link" data-ir="${esc(f.filial)}">${esc(f.filial)}</button></td>
        <td>${esc(f.uf || '—')}</td>
        <td title="${esc(textoDissidio(f))}">${Number(f.dissidio_ant_pct) ? `${fmtN(f.dissidio_ant_pct)}% · ${MESES[(f.dissidio_ant_mes || 1) - 1]}/${String(anoAnt()).slice(-2)} + ` : ''}${fmtN(f.dissidio_pct)}% · ${MESES[f.dissidio_mes - 1]}</td>
        ${visiveis.map(r => {
          const p = efet(f, r);
          const propria = Boolean(E.dados.premissas[f.filial]?.[r.id]);
          return `<td class="${p.metodo === 'nao' ? 'nao' : ''}${propria ? ' propria' : ''}${E.prem.quadroEditar ? ' editavel' : ''}" data-ir="${esc(f.filial)}" data-rub="${r.id}" title="${esc(r.nome)} · ${esc(f.filial)}${p.metodo !== 'nao' ? ` · ${esc(resumoDetalhes(p))}` : ''}">${p.metodo === 'nao' ? '—' : esc(textoCurto(p))}${p.quem?.length && p.metodo !== 'nao' ? ' 👥' : ''}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="cartao vazio"><span>📥</span>Importe a base de colaboradores para listar as filiais.</div>'}`;
  $('#q-reg', el).addEventListener('change', e => { E.prem.quadroReg = e.target.value; renderQuadro(); });
  $('#q-uf', el).addEventListener('change', e => { E.prem.uf = e.target.value; renderQuadro(); });
  $('#q-ocultar', el).addEventListener('change', e => { E.prem.ocultarVazios = e.target.checked; renderQuadro(); });
  $$('[data-ir]', el).forEach(c => c.addEventListener('click', () => {
    if (E.prem.quadroEditar && c.dataset.rub) return editarCelulaQuadro(c.dataset.ir, c.dataset.rub, fils.map(f => f.filial));
    E.prem.visao = 'filial';
    trocarEscopo(c.dataset.ir);
  }));
  $('#q-editar', el).addEventListener('click', () => { E.prem.quadroEditar = !E.prem.quadroEditar; renderQuadro(); });
  $('#q-exportar', el).addEventListener('click', exportarQuadro);
  $('#q-importar', el).addEventListener('change', e => { if (e.target.files[0]) importarQuadro(e.target.files[0]); e.target.value = ''; });
  $('#q-modelo', el).addEventListener('click', pedirModeloPremissas);
}

// DISSÍDIO ANO ANTERIOR = o que a base ainda não tem (ex.: 2026); DISSÍDIO = o do ano do orçamento (data-base)
const COLS_FIXAS = ['REGIONAL', 'UF', 'FILIAL', 'DISSÍDIO ANO ANTERIOR %', 'MÊS DISSÍDIO ANO ANTERIOR', 'DISSÍDIO %', 'MÊS DISSÍDIO', 'REAJ. BENEFÍCIOS ANO ANTERIOR %', 'MÊS REAJ. BENEFÍCIOS ANO ANTERIOR', 'REAJ. BENEFÍCIOS %', 'MÊS REAJ. BENEFÍCIOS'];

function exportarQuadro() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const rubs = RUBRICAS.filter(r => !r.fixa && !r.soLancamento);
  const fils = Object.values(E.dados.filiais).sort((a, b) => a.regional.localeCompare(b.regional) || a.filial.localeCompare(b.filial));
  const linhas = [[...COLS_FIXAS, ...rubs.map(r => r.nome)]];
  for (const f of fils) {
    linhas.push([f.regional, f.uf || '', f.filial, Number(f.dissidio_ant_pct) || 0, MESES[(f.dissidio_ant_mes || 1) - 1], f.dissidio_pct, MESES[f.dissidio_mes - 1], Number(f.reaj_benef_ant_pct) || 0, MESES[(f.reaj_benef_ant_mes || 1) - 1], f.reaj_benef_pct, MESES[f.reaj_benef_mes - 1],
      ...rubs.map(r => {
        const p = Motor.premissaDe(E.dados.premissas, f.filial, f.regional, r.id);
        return p.metodo === 'fixo' ? Number(p.valor) : textoCurto(p);
      })]);
  }
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws['!cols'] = linhas[0].map((_, i) => ({ wch: i === 1 ? 6 : i < 3 ? 24 : 14 }));
  ws['!freeze'] = { xSplit: 3, ySplit: 1 };
  const ajuda = XLSX.utils.aoa_to_sheet([
    ['Como preencher o quadro de premissas'],
    [''],
    ['Uma linha por filial e uma coluna por item. Em cada célula escreva o que a filial tem:'],
    ['Exemplo na célula', 'Significa'],
    ['30%', 'Percentual (sobre o salário, ou a base definida na ferramenta)'],
    ['1480  ou  R$ 1480', 'Valor em R$ por colaborador'],
    ['96000 total/ano', 'Custo total do ano da filial; vira média mensal por colaborador (ex.: horas extras)'],
    ['8000 total/mês', 'Custo total por mês da filial, dividido entre os colaboradores'],
    ['2,4 sal', 'Número de salários (ex.: PPR)'],
    ['nível', 'PPR pela tabela de nível do cargo'],
    ['Não', 'A filial não tem este item'],
    ['(vazio)', 'Usa a regra da regional / regra geral'],
    [''],
    ['Periodicidade (todo mês, uma vez no ano, anual ÷ 12), base do %, teto, rateio e "quem recebe" continuam valendo como estão na ferramenta.'],
    ['Os meses podem ser escritos como número (5) ou nome (Mai).'],
  ]);
  ajuda['!cols'] = [{ wch: 22 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Premissas');
  XLSX.utils.book_append_sheet(wb, ajuda, 'Como preencher');
  XLSX.writeFile(wb, `Premissas-por-filial-${E.dados.config.ano}.xlsx`);
}

const chaveNome = s => normCab(s).replace(/[^A-Z0-9%]/g, '');
// Nomes das colunas nas planilhas antigas (BZO), para aceitar também esses cabeçalhos.
const APELIDOS = {
  va: ['VA/VR', 'VA', 'VR'], va_natal: ['VA NATAL (DEZEMBRO)', '13° VR', '13º VR'], vt: ['VT', 'VALE-TRANSPORTE', 'VALE TRANSPORTE', 'MOBILIDADE', 'VALE MOBILIDADE'], assist_medica: ['ASSIST. MÉDICA', 'ASSIST. MÉDICA (EMPRESA)'],
  assist_odonto: ['ASSIST. ODONTO', 'ASSIST. ODONTO (EMPRESA)'], aux_creche: ['AUXÍLIO CRECHÊ', 'AUXÍLIO CRECHE'], adic_turno: ['ADICIONAIS DE TURNO (INCLUSOS ADIC. INTRAJORNADA E PASSAGEM DE TURNO)'], adic_noturno: ['ADIC. NOTURNO'],
  decimo: ['13° SALÁRIO'], coparticipacao: ['COPARTICIPAÇÃO CONVÊNIO MÉDICO'], educacional: ['EDUCACIONAL', 'AUXÍLIO EDUCAÇÃO'], farmacia: ['FARMACIA'],
  previdencia: ['PREVIDÊNCIA', 'PREVIDÊNCIA PRIVADA (EMPRESA)'], aux_dependente: ['AUXÍLIO DEPENDENTE PORTADOR', 'AUXÍLIO FILHO EXCEPCIONAL'],
};

function lerCelulaPremissa(v) {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v ? { metodo: 'fixo', valor: v } : { metodo: 'nao' };
  const t = String(v).trim().toLowerCase();
  if (/^(n|nao|não|-|—|0)$/.test(t)) return { metodo: 'nao' };
  if (/^(nivel|nível)/.test(t)) return { metodo: 'multiplo', por_nivel: true };
  if (/^por m[eê]s$/.test(t)) return { sim: true }; // valores de cada mês continuam como estão na ferramenta
  const n = Number((t.match(/-?[\d.,]+/) || ['0'])[0].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
  if (t.includes('%')) return { metodo: 'pct', valor: n };
  if (t.includes('sal')) return { metodo: 'multiplo', valor: n, por_nivel: false };
  if (t.includes('total') || t.includes('rateio')) {
    const periodo = /ano/.test(t) ? 'anual_diluido' : /m[eê]s/.test(t) ? 'mensal' : undefined;
    return periodo ? { metodo: 'rateio', valor: n, periodo } : { metodo: 'rateio', valor: n };
  }
  if (/^sim$/.test(t)) return { sim: true };
  return n ? { metodo: 'fixo', valor: n } : { metodo: 'nao' };
}

const mesDe = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (n >= 1 && n <= 12) return n;
  const i = MESES.findIndex(m => normCab(m) === normCab(v).slice(0, 3));
  return i >= 0 ? i + 1 : null;
};

const CAMPOS_REGRA = ['metodo', 'valor', 'base', 'periodo', 'mes', 'rateio', 'teto', 'por_nivel', 'quem', 'inicio', 'inicio2', 'provisao', 'vale_todos'];
// inicio/inicio2 vazios, 0 ou janeiro são o mesmo (vale o ano todo / sem 2º aumento)
const normCampo = (k, v) => ((k === 'inicio' || k === 'inicio2') && (!v || Number(v) <= 1) ? null : k === 'provisao' || k === 'vale_todos' ? Boolean(v) || null : v ?? null);
const mesmaRegra = (a, b) => CAMPOS_REGRA.every(k => JSON.stringify(normCampo(k, a[k])) === JSON.stringify(normCampo(k, b[k])));

// ----- Modelo de preenchimento das premissas (uma linha por filial e item, com listas de seleção) -----

const COMO_ROTULO = { pct: '% sobre a base', pct_folha: '% da folha', fixo: 'R$ por colaborador', rateio: 'Total da filial', multiplo: 'Nº de salários', nivel: 'Nº de salários por nível do cargo' };
const QUANDO_ROTULO = { mensal: 'Todo mês', anual_mes: 'Uma vez no ano', anual_diluido: 'Anual dividido em 12', por_mes: 'Valor diferente por mês' };
const COL_MODELO = ['Regional', 'UF', 'Filial', 'Grupo', 'Item', 'Tem?', 'Como é calculado', 'Valor', 'Quando é pago', 'Mês (se 1x no ano)', ...MESES, 'Observação', 'código'];

function carregarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'vendor/exceljs.min.js';
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => falha(new Error('Não foi possível carregar o gerador de Excel.'));
    document.head.appendChild(s);
  });
}

function pedirModeloPremissas() {
  const fils = Object.values(E.dados.filiais).filter(f => (!E.prem.quadroReg || f.regional === E.prem.quadroReg) && bateUf(f.filial, E.prem.uf));
  const d = abrirModal({
    titulo: 'Modelo para preenchimento das premissas', sup: 'EXCEL',
    corpo: `<p style="margin:0">Gera um Excel com <b>uma linha por filial e item</b>, já preenchido com o que está na ferramenta, e com <b>listas de seleção</b> nas colunas amarelas. Envie para quem vai preencher e depois use <b>⬆ Importar quadro</b> para carregar.</p>
      <p style="margin:0"><b>${fils.length}</b> filial(is) — ${esc([E.prem.quadroReg || 'todas as regionais', E.prem.uf && (E.prem.uf === '_' ? 'estado a definir' : E.prem.uf)].filter(Boolean).join(' · '))} (use os filtros do quadro para mudar).</p>
      <div class="rotulo">Itens que entram no modelo
        <div class="regionais-check" style="margin-top:.4rem">${GRUPOS.map(g => `<label class="check"><input type="checkbox" name="grupo" value="${g.id}" ${['provisoes', 'encargos'].includes(g.id) ? '' : 'checked'}> ${g.nome}</label>`).join('')}</div>
        <small>Provisões e encargos (férias, 13º, FGTS, INSS) costumam ser iguais para todos — por isso vêm desmarcados.</small></div>
      <label class="check"><input type="checkbox" name="reajustes" checked> Incluir dissídio e reajuste de benefícios de cada filial</label>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="gerar-modelo">⬇ Gerar Excel</button>',
  });
  $('#gerar-modelo', d).addEventListener('click', async e => {
    const grupos = $$('input[name=grupo]:checked', d).map(i => i.value);
    if (!grupos.length) return toast('Marque ao menos um grupo de itens.', 'erro');
    e.target.disabled = true;
    e.target.textContent = 'Gerando…';
    try {
      await gerarModeloPremissas(fils.map(f => f.filial), grupos, $('input[name=reajustes]', d).checked);
      d.close();
    } catch (err) { toast(err.message, 'erro'); e.target.disabled = false; e.target.textContent = '⬇ Gerar Excel'; }
  });
}

async function gerarModeloPremissas(filiais, grupos, comReajustes) {
  const ExcelJS = await carregarExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Orçamento de Pessoal · Âmbar';
  const ano = E.dados.config.ano;
  const ws = wb.addWorksheet('Premissas', { views: [{ state: 'frozen', xSplit: 5, ySplit: 3 }] });
  const listas = wb.addWorksheet('Listas', { state: 'veryHidden' });
  const opcoes = { tem: ['Sim', 'Não'], como: Object.values(COMO_ROTULO), quando: Object.values(QUANDO_ROTULO), mes: MESES };
  Object.values(opcoes).forEach((lista, c) => lista.forEach((v, r) => { listas.getCell(r + 1, c + 1).value = v; }));
  const ref = (c, n) => `Listas!$${String.fromCharCode(65 + c)}$1:$${String.fromCharCode(65 + c)}$${n}`;

  ws.mergeCells(1, 1, 1, 12);
  ws.getCell(1, 1).value = `Premissas do orçamento de pessoal ${ano} — preencha as colunas amarelas (use as listas). Não altere as colunas cinzas.`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF0E3B5C' } };
  ws.getRow(3).values = COL_MODELO;
  ws.getRow(3).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E3B5C' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.getRow(3).height = 32;
  const larguras = [16, 6, 26, 14, 30, 8, 30, 13, 24, 12, ...MESES.map(() => 10), 30, 4];
  larguras.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(COL_MODELO.length).hidden = true;

  const efet = (f, rid) => Motor.premissaDe(E.dados.premissas, f, E.dados.filiais[f].regional, rid);
  let r = 4;
  const amarelo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6D6' } };
  const cinza = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F7' } };
  const linha = (vals, editaveis) => {
    const row = ws.getRow(r);
    row.values = vals;
    for (let c = 1; c <= COL_MODELO.length - 1; c++) row.getCell(c).fill = editaveis.includes(c) ? amarelo : cinza;
    row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(0, 2)] };
    row.getCell(7).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(1, opcoes.como.length)] };
    row.getCell(9).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(2, opcoes.quando.length)] };
    row.getCell(10).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(3, 12)] };
    row.getCell(8).numFmt = '#,##0.00##';
    for (let m = 0; m < 12; m++) row.getCell(11 + m).numFmt = '#,##0.00';
    r++;
  };
  for (const f of [...filiais].sort()) {
    const cfg = E.dados.filiais[f];
    const id = [cfg.regional, cfg.uf || '', f];
    if (comReajustes) {
      linha([...id, 'Reajustes', `Dissídio ${anoAnt()} % (a base ainda não tem; mês = data-base ${anoAnt()})`, '', '', Number(cfg.dissidio_ant_pct) || 0, '', MESES[(cfg.dissidio_ant_mes || 1) - 1], ...MESES.map(() => null), '', 'dissidio_ant'], [8, 10, 23]);
      linha([...id, 'Reajustes', `Dissídio ${E.dados.config.ano} % (data-base)`, '', '', cfg.dissidio_pct, '', MESES[cfg.dissidio_mes - 1], ...MESES.map(() => null), '', 'dissidio'], [8, 10, 23]);
      linha([...id, 'Reajustes', `Reajuste de benefícios ${anoAnt()} % (os valores ainda não têm; mês = data-base ${anoAnt()})`, '', '', Number(cfg.reaj_benef_ant_pct) || 0, '', MESES[(cfg.reaj_benef_ant_mes || 1) - 1], ...MESES.map(() => null), '', 'reaj_benef_ant'], [8, 10, 23]);
      linha([...id, 'Reajustes', `Reajuste de benefícios ${E.dados.config.ano} %`, '', '', cfg.reaj_benef_pct, '', MESES[cfg.reaj_benef_mes - 1], ...MESES.map(() => null), '', 'reaj_benef'], [8, 10, 23]);
    }
    for (const rub of RUBRICAS.filter(x => !x.fixa && grupos.includes(x.grupo))) {
      const p = efet(f, rub.id);
      const tem = p.metodo !== 'nao';
      const tipo = tem ? tipoDe(p) : metodoAoLigar(rub.id, p);
      const porMes = p.periodo === 'por_mes' && (tipo === 'fixo' || tipo === 'rateio');
      linha([...id, NOME_GRUPO[rub.grupo], rub.nome, tem ? 'Sim' : 'Não', COMO_ROTULO[tipo], tipo === 'nivel' || porMes ? null : Number(p.valor) || 0,
        tipo.startsWith('pct') ? '' : QUANDO_ROTULO[p.periodo], !tipo.startsWith('pct') && p.periodo === 'anual_mes' ? MESES[p.mes - 1] : '',
        ...MESES.map((_, m) => (porMes ? Number(p.meses?.[m]) || 0 : null)), '', rub.id], [6, 7, 8, 9, 10, ...MESES.map((_, m) => 11 + m), 23]);
    }
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: r - 1, column: COL_MODELO.length - 1 } };

  const ajuda = wb.addWorksheet('Como preencher');
  [
    ['Como preencher o modelo de premissas'],
    [''],
    ['Coluna', 'O que colocar'],
    ['Tem?', 'Sim ou Não — a filial tem este item?'],
    ['Como é calculado', '% sobre a base (ex.: periculosidade 30% do salário) · R$ por colaborador (ex.: VA) · Total da filial (valor da unidade, dividido igualmente entre os colaboradores — ex.: horas extras) · Nº de salários (ex.: PPR) · Nº de salários por nível do cargo (a tabela de níveis é ajustada na ferramenta)'],
    ['Valor', 'O número: 30 para 30%, 1480 para R$ 1.480,00, 2,4 para 2,4 salários. Em "Total da filial" + "Anual dividido em 12", informe o total do ano.'],
    ['Quando é pago', 'Todo mês · Uma vez no ano (escolha o mês na coluna seguinte) · Anual dividido em 12 · Valor diferente por mês (preencha os 12 meses, Jan a Dez, e deixe "Valor" em branco)'],
    ['Reajustes', 'Linhas de dissídio e reajuste de benefícios: só "Valor" (%) e o mês em que passa a valer.'],
    ['Observação', 'Livre, para comentários. Não é lido pela ferramenta.'],
    [''],
    ['Não altere as colunas cinzas (regional, filial, item). Linhas apagadas não mudam nada na ferramenta.'],
  ].forEach((l, i) => { ajuda.getRow(i + 1).values = l; });
  ajuda.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF0E3B5C' } };
  ajuda.getRow(3).font = { bold: true };
  ajuda.getColumn(1).width = 22;
  ajuda.getColumn(2).width = 120;

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Modelo-premissas-${ano}${E.prem.quadroReg ? `-${E.prem.quadroReg}` : ''}${E.prem.uf && E.prem.uf !== '_' ? `-${E.prem.uf}` : ''}.xlsx`.replace(/\s+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Modelo gerado: ${filiais.length} filial(is), ${r - 4} linha(s).`);
}

/** Lê o modelo de preenchimento (formato em linhas) e devolve os itens para /api/premissas/lote. */
function lerModeloPremissas(linhas, h) {
  const cab = linhas[h].map(c => chaveNome(c));
  const col = nome => cab.indexOf(chaveNome(nome));
  const ic = { filial: col('Filial'), regional: col('Regional'), uf: col('UF'), item: col('Item'), tem: col('Tem?'), como: col('Como é calculado'), valor: col('Valor'),
    quando: col('Quando é pago'), mes: col('Mês (se 1x no ano)'), cod: col('código') };
  const iMeses = MESES.map(m => col(m));
  const porNome = new Map();
  RUBRICAS.filter(r => !r.fixa).forEach(r => [r.nome, ...(APELIDOS[r.id] || [])].forEach(n => porNome.set(chaveNome(n), r.id)));
  const comoDe = Object.fromEntries(Object.entries(COMO_ROTULO).map(([k, v]) => [chaveNome(v), k]));
  const quandoDe = Object.fromEntries(Object.entries(QUANDO_ROTULO).map(([k, v]) => [chaveNome(v), k]));
  const num = v => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(String(v).replace(/[R$%\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
  const porFilial = new Map();
  const avisos = [];
  let mudancas = 0;
  for (const l of linhas.slice(h + 1)) {
    const filial = String(l?.[ic.filial] ?? '').trim().toUpperCase();
    if (!filial) continue;
    const cfg = E.dados.filiais[filial];
    const regional = cfg?.regional || String(l[ic.regional] ?? '').trim().toUpperCase();
    if (!porFilial.has(filial)) porFilial.set(filial, { escopo: filial, rubricas: {}, filial: {}, existe: Boolean(cfg) });
    const it = porFilial.get(filial);
    const uf = String(l[ic.uf] ?? '').trim().toUpperCase();
    if (cfg && UFS_BR.includes(uf) && uf !== (cfg.uf || '')) it.filial.uf = uf;
    const cod = String(l[ic.cod] ?? '').trim();
    if (['dissidio', 'dissidio_ant', 'reaj_benef', 'reaj_benef_ant'].includes(cod)) {
      const v = num(l[ic.valor]);
      const m = mesDe(l[ic.mes]);
      const pref = cod;
      if (v != null && !Number.isNaN(v) && (!cfg || Number(cfg[`${pref}_pct`]) !== v)) it.filial[`${pref}_pct`] = v;
      if (m && (!cfg || Number(cfg[`${pref}_mes`]) !== m)) it.filial[`${pref}_mes`] = m;
      continue;
    }
    const rub = RUBRICAS_IDS.has(cod) ? cod : porNome.get(chaveNome(l[ic.item]));
    if (!rub) { if (l[ic.item]) avisos.push(`Item não reconhecido: “${l[ic.item]}” (${filial}).`); continue; }
    const tem = normCab(l[ic.tem]);
    if (!tem) continue; // linha sem resposta: não mexe
    let lido;
    if (tem.startsWith('N')) lido = { metodo: 'nao' };
    else {
      const tipo = comoDe[chaveNome(l[ic.como])] || null;
      const periodo = quandoDe[chaveNome(l[ic.quando])] || undefined;
      lido = {};
      if (tipo === 'nivel') Object.assign(lido, { metodo: 'multiplo', por_nivel: true });
      else if (tipo === 'pct_folha') Object.assign(lido, { metodo: 'pct', base: 'folha', por_nivel: false });
      else if (tipo) Object.assign(lido, { metodo: tipo, por_nivel: false });
      const v = num(l[ic.valor]);
      if (v != null && !Number.isNaN(v)) lido.valor = v;
      if (periodo && !String(tipo).startsWith('pct')) lido.periodo = periodo;
      const m = mesDe(l[ic.mes]);
      if (m) lido.mes = m;
      if (periodo === 'por_mes') lido.meses = iMeses.map(i => num(l[i]) || 0);
      if (!lido.metodo) lido.sim = true;
    }
    const decisao = decidirRegra(filial, regional, rub, lido);
    if (decisao !== undefined) { it.rubricas[rub] = decisao; mudancas++; }
  }
  const itens = [...porFilial.values()].map(({ escopo, rubricas, filial, existe }) => {
    const temFilial = existe && Object.keys(filial).length;
    if (temFilial) mudancas += Object.keys(filial).length;
    return { escopo, rubricas, filial: temFilial ? filial : null };
  });
  return { itens, mudancas, avisos, novas: [...porFilial.values()].filter(x => !x.existe).map(x => x.escopo) };
}

/** Edição manual de uma célula do quadro (filial × item), com a opção de aplicar a mesma regra em outras filiais. */
function editarCelulaQuadro(filial, rub, filsQuadro) {
  const r = RUBRICAS[IDX[rub]];
  const cfg = E.dados.filiais[filial];
  const p = Motor.premissaDe(E.dados.premissas, filial, cfg.regional, rub);
  const tem = p.metodo !== 'nao';
  const tipo0 = tem ? tipoDe(p) : metodoAoLigar(rub, p);
  const tipos = r.adicional ? { pct: TIPOS.pct, fixo: TIPOS.fixo, rateio: TIPOS.rateio } : TIPOS;
  const quandos = { mensal: QUANDO_ROTULO.mensal, anual_mes: QUANDO_ROTULO.anual_mes, anual_diluido: QUANDO_ROTULO.anual_diluido };
  const outras = filsQuadro.filter(f => f !== filial);
  const propria = Boolean(E.dados.premissas[filial]?.[rub]);
  const d = abrirModal({
    titulo: `${r.nome} · ${filial}`, sup: `PREMISSA · ${cfg.regional}`,
    corpo: `<form class="form-grade" id="form-celula">
      <p class="inteiro subtitulo" style="margin:0">Hoje: <b>${esc(tem ? `${textoCurto(p)} · ${resumoDetalhes(p)}` : 'não tem')}</b> · ${propria ? 'regra desta filial' : 'herdada da regional/geral'}</p>
      <label class="rotulo">Tem?<select class="campo" name="tem"><option value="1" ${tem ? 'selected' : ''}>Sim</option><option value="0" ${tem ? '' : 'selected'}>Não</option></select></label>
      <label class="rotulo" data-so-tem>Como é calculado<select class="campo" name="tipo">${Object.entries(tipos).map(([k, v]) => `<option value="${k}" ${k === tipo0 ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="rotulo" data-so-tem>Valor <small data-unidade></small><input class="campo" name="valor" type="number" step="any" value="${Number(p.valor) || 0}"></label>
      <label class="rotulo" data-so-tem data-quando>Quando é pago<select class="campo" name="periodo">${Object.entries(quandos).map(([k, v]) => `<option value="${k}" ${k === (p.periodo === 'por_mes' ? 'mensal' : p.periodo) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="rotulo" data-so-tem data-mes>Mês<select class="campo" name="mes">${opcoesMes(p.mes || 12)}</select></label>
      <label class="rotulo" data-so-tem data-sopct>A partir de<select class="campo" name="inicio">${opcoesMes(p.inicio || 1)}</select></label>
      <label class="rotulo" data-so-tem data-sopct>2º aumento a partir de <small>(opcional)</small><select class="campo" name="inicio2">${opcoesMes(p.inicio2 || '', true)}</select></label>
      <label class="check inteiro" data-so-tem><input type="checkbox" name="vale_todos" ${p.vale_todos ? 'checked' : ''}> <span>Usar também para quem tem valor deste item na <b>planilha da base</b> (sem marcar, essas pessoas ficam com o valor delas)</span></label>
      ${p.periodo === 'por_mes' || (p.quem || []).length || Object.keys(p.por_funcao || {}).length ? `<p class="inteiro aviso-ajuste" style="margin:0">ℹ Esta regra tem detalhes (valor por mês, quem recebe ou valor por função) que só aparecem em <b>Editar por filial</b>; o que não mudar aqui fica como está.</p>` : ''}
      ${outras.length ? `<div class="inteiro rotulo">Aplicar a mesma regra também em
        <div style="display:flex;gap:.8rem;margin:.3rem 0"><button type="button" class="btn-link" data-todas>Marcar todas</button><button type="button" class="btn-link" data-nenhuma>Nenhuma</button></div>
        <div class="regionais-check" style="max-height:180px;overflow:auto">${outras.map(f => `<label class="check"><input type="checkbox" name="outras" value="${esc(f)}"> ${esc(f)}</label>`).join('')}</div></div>` : ''}
    </form>`,
    rodape: `<button class="btn btn-claro" data-abrir>Abrir a filial completa</button><span style="flex:1"></span><button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-celula">Salvar</button>`,
  });
  const f = $('#form-celula', d);
  const ajustar = () => {
    const sim = f.tem.value === '1';
    $$('[data-so-tem]', f).forEach(x => { x.hidden = !sim; });
    if (!sim) return;
    const tipo = f.tipo.value;
    $('[data-quando]', f).hidden = tipo.startsWith('pct') || tipo === 'nivel';
    $('[data-mes]', f).hidden = $('[data-quando]', f).hidden || f.periodo.value !== 'anual_mes';
    $$('[data-sopct]', f).forEach(x => { x.hidden = !tipo.startsWith('pct'); });
    f.valor.closest('label').hidden = tipo === 'nivel';
    $('[data-unidade]', f).textContent = `(${unidadeValor(tipo === 'nivel' ? 'multiplo' : tipo, f.periodo.value) || ''})`;
  };
  ajustar();
  f.addEventListener('change', ajustar);
  $('[data-todas]', f)?.addEventListener('click', () => $$('input[name=outras]', f).forEach(i => { i.checked = true; }));
  $('[data-nenhuma]', f)?.addEventListener('click', () => $$('input[name=outras]', f).forEach(i => { i.checked = false; }));
  $('[data-abrir]', d).addEventListener('click', () => { d.close(); E.prem.visao = 'filial'; trocarEscopo(filial); });
  $('#salvar-celula', d).addEventListener('click', async () => {
    let lido;
    if (f.tem.value !== '1') lido = { metodo: 'nao' };
    else {
      const tipo = f.tipo.value;
      lido = tipo === 'nivel' ? { metodo: 'multiplo', por_nivel: true }
        : tipo === 'pct_folha' ? { metodo: 'pct', base: 'folha', por_nivel: false, valor: Number(f.valor.value) || 0 }
        : { metodo: tipo, por_nivel: false, valor: Number(f.valor.value) || 0, ...(tipo === 'pct' && p.base === 'folha' ? { base: 'salario' } : {}) };
      if (!tipo.startsWith('pct') && tipo !== 'nivel') lido.periodo = f.periodo.value;
      if (lido.periodo === 'anual_mes') lido.mes = Number(f.mes.value);
      if (tipo.startsWith('pct')) { lido.inicio = Number(f.inicio.value) || 1; lido.inicio2 = Number(f.inicio2.value) || 0; }
      lido.vale_todos = f.vale_todos.checked;
    }
    const alvo = [filial, ...$$('input[name=outras]:checked', f).map(i => i.value)];
    const itens = alvo.map(fil => {
      const decisao = decidirRegra(fil, E.dados.filiais[fil].regional, rub, lido);
      return decisao === undefined ? null : { escopo: fil, rubricas: { [rub]: decisao } };
    }).filter(Boolean);
    if (!itens.length) { d.close(); return toast('Nada mudou.'); }
    try {
      await api('/api/premissas/lote', { method: 'PUT', body: { itens } });
      d.close();
      await carregar();
      renderPremissas();
      toast(`${r.nome}: regra salva em ${itens.length} filial(is).`);
      if (lido.por_nivel) toast('Preencha a tabela por nível em Editar por filial.', 'erro');
    } catch (e) { toast(e.message, 'erro'); }
  });
}

/** Compara o que veio do Excel com a regra atual: undefined = sem mudança, null = volta a herdar, objeto = regra própria. */
function decidirRegra(filial, regional, rub, lido) {
  const padrao = RUBRICAS[IDX[rub]].padrao;
  const propriaAtual = E.dados.premissas[filial]?.[rub];
  const herdada = premHerdadaDe(filial, regional, rub);
  const efetiva = propriaAtual ? { ...padrao, ...propriaAtual } : herdada;
  let novo;
  if (lido.sim) novo = efetiva.metodo !== 'nao' ? efetiva : { ...efetiva, metodo: metodoAoLigar(rub, efetiva) };
  else if (lido.metodo === 'nao') novo = { ...efetiva, metodo: 'nao', ultimo_metodo: efetiva.metodo !== 'nao' ? efetiva.metodo : efetiva.ultimo_metodo };
  else novo = { ...(efetiva.metodo === lido.metodo ? efetiva : herdada.metodo === lido.metodo ? herdada : padrao), ...lido };
  if (mesmaRegra(novo, herdada)) return propriaAtual ? null : undefined;
  if (propriaAtual && mesmaRegra(novo, { ...padrao, ...propriaAtual })) return undefined;
  return novo;
}
const RUBRICAS_IDS = new Set(RUBRICAS.filter(r => !r.fixa && !r.soLancamento).map(r => r.id));

async function importarQuadro(arquivo) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const aba = wb.SheetNames.find(n => normCab(n) === 'PREMISSAS') || wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null });
  const h = linhas.findIndex(l => (l || []).some(c => normCab(c) === 'FILIAL'));
  if (h < 0) return toast('Não encontrei a coluna FILIAL na planilha.', 'erro');
  if (linhas[h].some(c => normCab(c) === 'ITEM') && linhas[h].some(c => normCab(c) === 'TEM?')) {
    const lido = lerModeloPremissas(linhas, h);
    return confirmarImportacaoPremissas(arquivo.name, lido.itens, lido.mudancas, lido.novas, lido.avisos, 'modelo de preenchimento');
  }
  const cab = linhas[h].map(c => chaveNome(c));
  const col = nome => cab.indexOf(chaveNome(nome));
  const rubCol = {};
  for (const r of RUBRICAS.filter(x => !x.fixa && !x.soLancamento)) {
    const i = [r.nome, ...(APELIDOS[r.id] || [])].map(col).find(x => x >= 0);
    if (i != null) rubCol[r.id] = i;
  }
  const iFil = col('FILIAL');
  const iReg = col('REGIONAL');
  const itens = [];
  const novas = [];
  let mudancas = 0;
  for (const l of linhas.slice(h + 1)) {
    const filial = String(l?.[iFil] ?? '').trim().toUpperCase();
    if (!filial) continue;
    const cfg = E.dados.filiais[filial];
    const regional = cfg?.regional || String(l[iReg] ?? '').trim().toUpperCase();
    if (!cfg) novas.push(filial);
    const rubricas = {};
    for (const [rub, i] of Object.entries(rubCol)) {
      const lido = lerCelulaPremissa(l[i]);
      const padrao = RUBRICAS[IDX[rub]].padrao;
      const propriaAtual = E.dados.premissas[filial]?.[rub];
      const herdada = premHerdadaDe(filial, regional, rub);
      if (!lido) { if (propriaAtual) { rubricas[rub] = null; mudancas++; } continue; }
      const efetiva = propriaAtual ? { ...padrao, ...propriaAtual } : herdada;
      let novo;
      if (lido.sim) novo = efetiva.metodo !== 'nao' ? efetiva : { ...efetiva, metodo: metodoAoLigar(rub, efetiva) };
      else if (lido.metodo === 'nao') novo = { ...efetiva, metodo: 'nao', ultimo_metodo: efetiva.metodo !== 'nao' ? efetiva.metodo : efetiva.ultimo_metodo };
      else novo = { ...(efetiva.metodo === lido.metodo ? efetiva : herdada.metodo === lido.metodo ? herdada : padrao), ...lido };
      if (mesmaRegra(novo, herdada)) { if (propriaAtual) { rubricas[rub] = null; mudancas++; } }
      else if (!propriaAtual || !mesmaRegra(novo, { ...padrao, ...propriaAtual })) { rubricas[rub] = novo; mudancas++; }
    }
    const filialCfg = {};
    const val = nome => { const i = col(nome); return i >= 0 ? l[i] : null; };
    if (val('DISSÍDIO ANO ANTERIOR %') != null && val('DISSÍDIO ANO ANTERIOR %') !== '') filialCfg.dissidio_ant_pct = Number(String(val('DISSÍDIO ANO ANTERIOR %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS DISSÍDIO ANO ANTERIOR'))) filialCfg.dissidio_ant_mes = mesDe(val('MÊS DISSÍDIO ANO ANTERIOR'));
    if (val('DISSÍDIO %') != null && val('DISSÍDIO %') !== '') filialCfg.dissidio_pct = Number(String(val('DISSÍDIO %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS DISSÍDIO'))) filialCfg.dissidio_mes = mesDe(val('MÊS DISSÍDIO'));
    if (val('REAJ. BENEFÍCIOS ANO ANTERIOR %') != null && val('REAJ. BENEFÍCIOS ANO ANTERIOR %') !== '') filialCfg.reaj_benef_ant_pct = Number(String(val('REAJ. BENEFÍCIOS ANO ANTERIOR %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS REAJ. BENEFÍCIOS ANO ANTERIOR'))) filialCfg.reaj_benef_ant_mes = mesDe(val('MÊS REAJ. BENEFÍCIOS ANO ANTERIOR'));
    if (val('REAJ. BENEFÍCIOS %') != null && val('REAJ. BENEFÍCIOS %') !== '') filialCfg.reaj_benef_pct = Number(String(val('REAJ. BENEFÍCIOS %')).replace('%', '').replace(',', '.')) || 0;
    if (mesDe(val('MÊS REAJ. BENEFÍCIOS'))) filialCfg.reaj_benef_mes = mesDe(val('MÊS REAJ. BENEFÍCIOS'));
    const ufLida = String(val('UF') ?? val('ESTADO') ?? '').trim().toUpperCase();
    if (UFS_BR.includes(ufLida)) filialCfg.uf = ufLida;
    // Só o que mudou em dissídio / reajuste / estado conta como alteração
    for (const k of Object.keys(filialCfg)) if (!cfg || String(filialCfg[k]) === String(cfg[k] ?? '')) delete filialCfg[k];
    mudancas += Object.keys(filialCfg).length;
    itens.push({ escopo: filial, rubricas, filial: cfg && Object.keys(filialCfg).length ? filialCfg : null });
  }
  const faltando = RUBRICAS.filter(r => !r.fixa && !r.soLancamento && !(r.id in rubCol)).map(r => r.nome);
  const avisos = faltando.length ? [`Colunas não encontradas (continuam como estão): ${faltando.join(', ')}.`] : [];
  confirmarImportacaoPremissas(arquivo.name, itens, mudancas, novas, avisos, `quadro · ${Object.keys(rubCol).length} itens reconhecidos`);
}

/** Prévia e confirmação da importação de premissas (quadro ou modelo de preenchimento). */
function confirmarImportacaoPremissas(nome, itens, mudancas, novas, avisos, tipo) {
  const d = abrirModal({
    titulo: nome, sup: 'IMPORTAR PREMISSAS',
    corpo: `<p style="margin:0"><b>${itens.length}</b> filial(is) na planilha · <b>${mudancas}</b> alteração(ões) · ${esc(tipo)}.</p>
      ${!mudancas ? '<p style="margin:0;color:var(--texto-suave)">Nada diferente do que já está na ferramenta.</p>' : ''}
      ${novas.length ? `<p style="margin:0;color:#b54d12">⚠ ${novas.length} filial(is) ainda não estão na base de colaboradores: ${esc(novas.join(', '))}. As regras ficam guardadas e passam a valer quando a base for importada (o dissídio e o estado delas são ignorados).</p>` : ''}
      ${avisos.slice(0, 8).map(a => `<p style="margin:0;color:var(--texto-suave)">${esc(a)}</p>`).join('')}
      <p style="margin:0;color:var(--texto-suave)">Valores iguais à regra da regional/geral ficam como herdados, sem criar exceção na filial.</p>`,
    rodape: `<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="ok-quadro" ${mudancas ? '' : 'disabled'}>Importar</button>`,
  });
  $('#ok-quadro', d).addEventListener('click', async () => {
    try {
      await api('/api/premissas/lote', { method: 'PUT', body: { itens } });
      d.close();
      await carregar();
      renderPremissas();
      toast(`Premissas importadas: ${mudancas} alteração(ões).`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

/** Regra herdada por uma filial (regional → geral → padrão), sem olhar a regra própria dela. */
function premHerdadaDe(filial, regional, rub) {
  const P = E.dados.premissas;
  const padrao = RUBRICAS[IDX[rub]].padrao;
  return { ...padrao, ...(P['R:' + regional]?.[rub] || P['*']?.[rub] || {}) };
}

let _timerPrev;
function atualizarPrevia() {
  clearTimeout(_timerPrev);
  _timerPrev = setTimeout(() => {
    const previa = calcularPrevia();
    $$('#tabela-prem tr[data-rub]').forEach(tr => {
      const r = IDX[tr.dataset.rub];
      let anual = 0;
      for (let i = 0; i < previa.n; i++) for (let m = 0; m < 12; m++) anual += previa.valor(i, r, m);
      tr.querySelector('[data-anual]').textContent = anual ? brl0.format(anual) : '–';
      tr.classList.add('propria');
      if (!(tr.dataset.rub in E.prem.edits) && !E.dados.premissas[E.prem.escopo]?.[tr.dataset.rub]) tr.classList.remove('propria');
    });
    atualizarRodapePrem(previa);
  }, 150);
}

function atualizarRodapePrem(previa) {
  let total = 0;
  for (let i = 0; i < previa.n; i++) for (let r = 0; r < RUBRICAS.length; r++) for (let m = 0; m < 12; m++) total += previa.valor(i, r, m);
  $('#prem-total').textContent = brl0.format(total);
  const salvo = totalDe(E.bruto.resSalvo, colabsDoEscopo(E.prem.escopo)).total; // premissas: sempre todas as contas
  const pend = Object.keys(E.prem.edits).length + Object.keys(E.prem.filial).length;
  const dif = total - salvo;
  $('#prem-info').innerHTML = pend ? `<b>${pend}</b> alteração(ões) não salva(s) · impacto <b style="color:${dif > 0 ? '#b54d12' : '#177a44'}">${dif >= 0 ? '+' : ''}${brl0.format(dif)}</b> no ano` : 'Tudo salvo';
}

/** Aviso quando há colaboradores sem sexo informado (eles ficam fora das ações por público). */
function avisoSemSexo(colabs = E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo))) {
  const n = colabs.filter(c => !c.sexo && !c.vaga).length;
  return n ? `⚠ ${num0.format(n)} colaborador(es) sem sexo informado na base não entram nas ações por público — inclua a coluna SEXO na base.` : '';
}

/** Tipo do valor próprio de uma pessoa para a regra do item: % / nº de salários / R$. */
const metodoProprio = p => (p.metodo === 'pct' ? 'pct' : p.metodo === 'multiplo' ? 'multiplo' : 'fixo');

/** Lista de colaboradores do escopo na tela "Quem recebe": valor de hoje e campo para valor personalizado. */
function quemColaboradoresHtml(rub, atual, colabs) {
  const k = IDX[rub];
  const res = E.bruto.res; // sem o filtro de conta do topo
  const idx = new Map(res.colaboradores.map((c, i) => [c.id, i]));
  const met = metodoProprio(atual);
  const un = met === 'pct' ? '%' : met === 'multiplo' ? 'salários' : unidadeValor('fixo', atual.periodo === 'por_mes' ? 'mensal' : atual.periodo);
  const linhas = [...colabs].sort((a, b) => a.nome.localeCompare(b.nome)).map(c => {
    const i = idx.get(c.id);
    let ano = 0, meses = 0;
    if (i != null) for (let m = 0; m < 12; m++) { const v = res.valor(i, k, m); ano += v; if (v) meses++; }
    const e = c.excecoes?.[rub];
    const manual = e && e.origem !== 'base' ? (e.metodo === 'nao' ? 0 : e.valor) : '';
    const daBase = e?.origem === 'base' ? (e.metodo === 'nao' ? 'não recebe' : fmtN(e.valor)) : '';
    return `<tr data-pessoa="${c.id}" data-busca="${esc(`${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome}`.toUpperCase())}">
      <td>${esc(c.nome)}<span class="sub">${esc([c.funcao, rotuloCc(c)].filter(Boolean).join(' · '))}${c.vaga ? ' · vaga' : ''}</span></td>
      <td class="n">${ano ? `${brl.format(ano / (meses || 1))}<span class="sub">/mês · ${brl0.format(ano)} no ano</span>` : '<span class="sub" style="display:inline">não recebe</span>'}${daBase ? `<span class="sub" title="Valor da planilha da base">planilha: ${esc(daBase)}</span>` : ''}</td>
      <td><input type="number" step="any" class="campo valor-pessoa" value="${esc(manual)}" data-orig="${esc(manual)}" placeholder="segue a regra"></td></tr>`;
  }).join('');
  return `<div class="quem-pessoas">
    <div class="ferramentas" style="margin:0 0 .5rem"><b style="color:var(--marinho)">Colaboradores (${colabs.length})</b>
      <input class="campo" id="quem-busca" placeholder="Buscar nome, matrícula, função…" style="max-width:280px">
      <small class="sub" style="display:inline">Valor personalizado em <b>${esc(un)}</b> · vazio = segue a regra · 0 = não recebe · vale sobre a regra e sobre a planilha da base</small></div>
    <div class="tabela-wrap" style="max-height:320px"><table class="tabela"><thead><tr><th>Colaborador</th><th class="n">Hoje</th><th style="width:150px">Personalizado (${esc(un)})</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="3" class="vazio">Nenhum colaborador neste escopo.</td></tr>'}</tbody></table></div></div>`;
}

/** Liga a busca da lista e devolve a função que grava os valores personalizados alterados (true = ok). */
function ligarQuemColaboradores(d, rub, atual, colabs) {
  $('#quem-busca', d)?.addEventListener('input', e => {
    const b = e.target.value.trim().toUpperCase();
    $$('tr[data-pessoa]', d).forEach(tr => { tr.hidden = b && !tr.dataset.busca.includes(b); });
  });
  return async () => {
    const met = metodoProprio(atual);
    const itens = $$('tr[data-pessoa]', d).map(tr => {
      const inp = $('.valor-pessoa', tr);
      if (inp.value === inp.dataset.orig) return null;
      const id = Number(tr.dataset.pessoa);
      if (inp.value === '') return { id, excecao: null };
      const v = Number(inp.value);
      return { id, excecao: v ? { metodo: met, valor: v } : { metodo: 'nao', valor: 0 } };
    }).filter(Boolean);
    if (!itens.length) return true;
    // Quem tinha só o valor da planilha e foi apagado aqui não muda (o campo começa vazio para eles).
    try {
      const r = await api('/api/colaboradores/excecoes', { method: 'PUT', body: { rubrica: rub, itens } });
      await carregar();
      toast(`${RUBRICAS[IDX[rub]].nome}: valor personalizado salvo para ${r.atualizados} colaborador(es).`);
      return true;
    } catch (e) { toast(e.message, 'erro'); return false; }
  };
}

/** Filtro "quem recebe": marca centros de custo, níveis de cargo e/ou funções do escopo atual; valor próprio por função. */
function escolherQuem(rub) {
  const atual = { ...premEfetiva(E.prem.escopo, rub).p };
  const marcados = new Set(atual.quem || []);
  const colabs = E.dados.colaboradores.filter(colabsDoEscopo(E.prem.escopo));
  const contar = (campo, v) => colabs.filter(c => (c[campo] || '') === v).length;
  const ccs = [...new Map(colabs.map(c => [c.cc_cod || '', c.cc_nome || ''])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cargos = [...new Set(colabs.map(c => c.cargo || ''))].sort();
  const funcoes = [...new Set(colabs.map(c => c.funcao || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // Valor próprio por função: só faz sentido quando o valor é por colaborador (%, R$ por colaborador, nº de salários).
  const unidade = { pct: '%', fixo: 'R$', multiplo: 'salários' }[atual.metodo];
  const comValor = unidade && atual.periodo !== 'por_mes';
  const proprios = atual.por_funcao || {};
  const valorProprio = f => { const k = Object.keys(proprios).find(x => x.trim().toUpperCase() === f.trim().toUpperCase()); return k == null ? '' : proprios[k]; };
  // Também mantém marcações que não aparecem neste escopo (vindas de outra filial), para não perdê-las ao salvar.
  const lista = (titulo, itens, extra = '') => `<div><b style="color:var(--marinho)">${titulo}</b>${extra}<div style="display:grid;gap:.3rem;margin-top:.5rem;max-height:260px;overflow-y:auto">${itens || '<small class="sub">Nenhum na base deste escopo.</small>'}</div></div>`;
  const d = abrirModal({
    titulo: `Quem recebe: ${RUBRICAS[IDX[rub]].nome}`, sup: 'PREMISSA', largo: true,
    corpo: `<div class="publico-item"><b>Público</b>
        <label class="check"><input type="radio" name="publico" value="" ${!atual.publico ? 'checked' : ''}> Todos</label>
        <label class="check"><input type="radio" name="publico" value="F" ${atual.publico === 'F' ? 'checked' : ''}> ♀ Só mulheres <small>(${colabs.filter(c => c.sexo === 'F').length})</small></label>
        <label class="check"><input type="radio" name="publico" value="M" ${atual.publico === 'M' ? 'checked' : ''}> ♂ Só homens <small>(${colabs.filter(c => c.sexo === 'M').length})</small></label>
        <small>${avisoSemSexo(colabs)}</small></div>
      <p class="subtitulo" style="margin:0">Sem nada marcado, a rubrica vale para <b>todos</b>. Marcando centros de custo, níveis de cargo e/ou funções, vale só para quem estiver em algum deles — inclusive no rateio do total da filial (ex.: horas extras só para Operação e Manutenção).</p>
      <div class="grade-3-quem">
        ${lista('Centros de custo', ccs.map(([cod, nome]) => `<label class="check"><input type="checkbox" value="cc:${esc(cod)}" ${marcados.has('cc:' + cod) ? 'checked' : ''}> ${esc(cod)} · ${esc(nome || 'Sem nome')} <small class="sub" style="display:inline">(${contar('cc_cod', cod)})</small></label>`).join(''))}
        ${lista('Níveis de cargo', cargos.map(c => `<label class="check"><input type="checkbox" value="cargo:${esc(c)}" ${marcados.has('cargo:' + c) ? 'checked' : ''}> ${esc(c || 'Sem nível')} <small class="sub" style="display:inline">(${contar('cargo', c)})</small></label>`).join(''))}
        ${lista('Funções', funcoes.map(f => `<div class="linha-funcao"><label class="check"><input type="checkbox" value="funcao:${esc(f)}" ${marcados.has('funcao:' + f) ? 'checked' : ''}> ${esc(f)} <small class="sub" style="display:inline">(${contar('funcao', f)})</small></label>${comValor ? `<input type="number" step="any" class="valor-funcao" data-funcao="${esc(f)}" value="${esc(valorProprio(f))}" placeholder="geral" title="Valor próprio desta função (vazio = valor geral)">` : ''}</div>`).join(''),
          comValor ? `<small class="sub" style="display:block">Valor diferente por função (${unidade}): deixe vazio para usar o valor geral (${esc(fmtN(Number(atual.valor) || 0))}). Ex.: VA do aprendiz.</small>` : '')}
      </div>
      ${quemColaboradoresHtml(rub, atual, colabs)}`,
    rodape: '<button class="btn btn-claro" id="quem-todos">Todos recebem</button><button class="btn btn-laranja" id="quem-ok">Aplicar</button>',
  });
  const lerProprios = () => {
    // Mantém valores de funções que não aparecem neste escopo.
    const visiveis = new Set(funcoes.map(f => f.toUpperCase()));
    const novo = Object.fromEntries(Object.entries(proprios).filter(([f]) => !visiveis.has(f.trim().toUpperCase())));
    $$('.valor-funcao', d).forEach(i => { if (i.value !== '') novo[i.dataset.funcao] = Number(i.value); });
    return novo;
  };
  const salvarPessoas = ligarQuemColaboradores(d, rub, atual, colabs);
  const aplicar = async quem => {
    E.prem.edits[rub] = { ...atual, quem, publico: $('input[name=publico]:checked', d)?.value || '', ...(comValor ? { por_funcao: lerProprios() } : {}) };
    if (!(await salvarPessoas())) return;
    d.close(); desenharTabelaPrem();
  };
  $('#quem-todos', d).addEventListener('click', () => { $('input[name=publico][value=""]', d).checked = true; aplicar([]); });
  $('#quem-ok', d).addEventListener('click', () => {
    const visiveis = new Set($$('input[type=checkbox]', d).map(i => i.value));
    const fora = [...marcados].filter(q => !visiveis.has(q));
    aplicar([...fora, ...$$('input[type=checkbox]:checked', d).map(i => i.value)]);
  });
}

function verDistribuicao(rub) {
  const previa = calcularPrevia();
  const r = IDX[rub];
  const porCC = new Map();
  const pessoas = [];
  for (let i = 0; i < previa.n; i++) {
    const c = previa.colaboradores[i];
    let anual = 0;
    let mesesAtivos = 0;
    for (let m = 0; m < 12; m++) { anual += previa.valor(i, r, m); if (m + 1 >= c.mes_inicio && m + 1 <= c.mes_fim) mesesAtivos++; }
    if (!anual) continue;
    const k = `${c.filial} · ${c.cc_cod || '—'} ${c.cc_nome || ''}`;
    const a = porCC.get(k) || { hc: 0, anual: 0 };
    a.hc++; a.anual += anual;
    porCC.set(k, a);
    pessoas.push({ c, anual, media: anual / (mesesAtivos || 1) });
  }
  pessoas.sort((a, b) => b.anual - a.anual);
  abrirModal({
    titulo: RUBRICAS[r].nome, sup: 'DISTRIBUIÇÃO DA RUBRICA', largo: true,
    corpo: `
      <h4>Por centro de custo</h4>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Filial · Centro de custo</th><th class="n">HC</th><th class="n">Total ano</th><th class="n">Média / mês</th><th class="n">Média / colab. / mês</th></tr></thead>
      <tbody>${[...porCC].sort((a, b) => b[1].anual - a[1].anual).map(([k, a]) => `<tr><td>${esc(k)}</td><td class="n">${a.hc}</td><td class="n">${brl.format(a.anual)}</td><td class="n">${brl.format(a.anual / 12)}</td><td class="n">${brl.format(a.anual / 12 / a.hc)}</td></tr>`).join('')}</tbody></table></div>
      <h4>Por colaborador</h4>
      <div class="tabela-wrap" style="max-height:340px"><table class="tabela"><thead><tr><th>Colaborador</th><th>Centro de custo</th><th class="n">Média / mês</th><th class="n">Total ano</th></tr></thead>
      <tbody>${pessoas.map(p => `<tr><td>${esc(p.c.nome)}<span class="sub">${esc(p.c.funcao || '')}</span></td><td>${esc(p.c.cc_nome || '')}</td><td class="n">${brl.format(p.media)}</td><td class="n">${brl.format(p.anual)}</td></tr>`).join('')}</tbody></table></div>`,
  });
}

async function salvarPremissas() {
  const { escopo, edits, filial } = E.prem;
  try {
    if (Object.keys(edits).length) await api('/api/premissas', { method: 'PUT', body: { escopo, rubricas: edits } });
    if (Object.keys(filial).length) await api('/api/filiais', { method: 'PUT', body: { filiais: [{ filial: escopo, ...filial }] } });
    let propagadas = 0;
    for (const [rubrica, pr] of Object.entries(E.prem.propagar)) {
      const r = await api('/api/premissas/propagar', { method: 'PUT', body: { rubrica, ...pr } });
      propagadas += r.atualizadas;
    }
    E.prem.propagar = {};
    if (propagadas) toast(`Premissas salvas · forma de pagamento aplicada também em ${propagadas} regra(s) própria(s).`);
    E.prem.edits = {};
    E.prem.filial = {};
    await carregar();
    renderPremissas();
    if (!propagadas) toast('Premissas salvas.');
  } catch (e) { toast(e.message, 'erro'); }
}

function copiarPremissas() {
  if (Object.keys(E.prem.edits).length) return toast('Salve as alterações antes de copiar.', 'erro');
  const de = E.prem.escopo;
  const d = abrirModal({
    titulo: `Copiar regras de ${de}`, sup: 'PREMISSAS',
    corpo: `<p class="subtitulo" style="margin:0">As regras próprias de <b>${esc(de)}</b> substituirão as regras próprias das filiais marcadas. O dissídio não é copiado.</p>
      ${regionais().map(r => `<div><b style="color:var(--marinho)">${esc(r)}</b><div class="regionais-check" style="margin-top:.4rem">${filiaisDa(r).filter(f => f !== de).map(f => `<label class="check"><input type="checkbox" value="${esc(f)}"> ${esc(f)}</label>`).join('')}</div></div>`).join('')}`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="confirmar-copia">Copiar</button>',
  });
  $('#confirmar-copia', d).addEventListener('click', async () => {
    const para = $$('input:checked', d).map(i => i.value);
    if (!para.length) return toast('Marque ao menos uma filial.', 'erro');
    await api('/api/premissas/copiar', { method: 'POST', body: { de, para } });
    d.close();
    await carregar();
    renderPremissas();
    toast(`Regras copiadas para ${para.length} filial(is).`);
  });
}

// ---------- Base de colaboradores ----------

const ALIASES = {
  matricula: ['CHAPA', 'MATRICULA', 'MATRICULA/CHAPA'],
  nome: ['FUNCIONARIO', 'NOME', 'COLABORADOR'],
  regional: ['REGIONAL'],
  filial: ['FILIAL'],
  situacao: ['DSITUACAO', 'SITUACAO'],
  funcao: ['FUNCAO'],
  cargo: ['CARGO', 'GP. FUNCAO', 'NIVEL CARGO', 'NIVEL DO CARGO', 'GP. CARGO', 'GRUPO CARGO', 'GRUPO DE CARGO'],
  cc_cod: ['CODCCUSTORED', 'COD. C. CUSTO', 'COD. CENTRO DE CUSTO', 'CODIGO CENTRO DE CUSTO'],
  cc_nome: ['NOMECCUSTO', 'DESCRICAO CENTRO DE CUSTO', 'DESCRICAO - CENTRO DE CUSTO', 'CENTRO DE CUSTO'],
  salario: ['SALARIO S/PROV DISSIDIO', 'SALARIO S/ PROV DISSIDIO', 'SALARIO BASE', 'SALARIO'],
  mes_inicio: ['MES INICIO', 'MES DE INICIO', 'MES ADMISSAO', 'MES DE ADMISSAO'],
  mes_fim: ['MES FIM', 'MES DESLIGAMENTO', 'MES DE DESLIGAMENTO'],
  sexo: ['SEXO', 'GENERO'],
  gestor: ['GESTOR', 'GESTOR IMEDIATO', 'NOME DO GESTOR', 'GESTOR DIRETO', 'SUPERIOR IMEDIATO', 'LIDER', 'LIDER IMEDIATO', 'COORDENADOR'],
};
const ROTULO_CAMPO = { matricula: 'Matrícula', nome: 'Funcionário', regional: 'Regional', filial: 'Filial', situacao: 'Situação', funcao: 'Função', cargo: 'Cargo / nível', cc_cod: 'Cód. centro de custo', cc_nome: 'Centro de custo', salario: 'Salário', mes_inicio: 'Mês início', mes_fim: 'Mês fim', sexo: 'Sexo', gestor: 'Gestor' };
const normCab = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Lê as planilhas: acha a linha de cabeçalho (com FUNCIONÁRIO/NOME e SALÁRIO) e mapeia as colunas até o salário. */
function lerPlanilha(wb) {
  const nomes = [...wb.SheetNames].sort((a, b) => (normCab(b) === 'BZO') - (normCab(a) === 'BZO'));
  for (const nomeAba of nomes) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null });
    for (let h = 0; h < Math.min(linhas.length, 60); h++) {
      const cab = (linhas[h] || []).map(normCab);
      const achar = campo => {
        for (const a of ALIASES[campo]) { const i = cab.indexOf(a); if (i >= 0) return i; }
        return -1;
      };
      const mapa = Object.fromEntries(Object.keys(ALIASES).map(k => [k, achar(k)]));
      if (mapa.nome < 0 || mapa.salario < 0 || mapa.filial < 0) continue;
      if (mapa.cc_nome === mapa.cc_cod) mapa.cc_nome = -1;
      const colunas = colunasValores(linhas[h] || []);
      const iSalD = cab.findIndex(c => /^SALARIO C\/ ?DISSIDIO/.test(c));
      const comDiss = remuneracaoComDissidio(linhas, h, mapa.salario, iSalD, colunas);
      const out = [];
      for (let i = h + 1; i < linhas.length; i++) {
        const l = linhas[i] || [];
        const v = k => (mapa[k] >= 0 ? l[mapa[k]] : null);
        if (!v('nome') || !v('filial')) continue;
        const situacao = String(v('situacao') ?? '').trim();
        out.push({
          matricula: v('matricula') != null ? String(v('matricula')).trim() : '',
          nome: String(v('nome')).trim(), regional: String(v('regional') ?? '').trim(), filial: String(v('filial')).trim(),
          situacao, funcao: v('funcao') ?? '', cargo: v('cargo') ?? '', cc_cod: v('cc_cod') != null ? String(v('cc_cod')).trim() : '', cc_nome: v('cc_nome') ?? '',
          salario: typeof v('salario') === 'number' ? v('salario') : Number(String(v('salario') ?? '0').replace(/\./g, '').replace(',', '.')) || 0,
          mes_inicio: v('mes_inicio') ?? 1, mes_fim: v('mes_fim') ?? 12, sexo: v('sexo') ?? '', gestor: String(v('gestor') ?? '').trim(),
          vaga: /vaga/i.test(situacao) || /vaga/i.test(String(v('nome'))),
          ...valoresDaLinha(l, colunas, comDiss && Number(l[iSalD]) > 0 && Number(l[mapa.salario]) > 0 ? Number(l[mapa.salario]) / Number(l[iSalD]) : 1),
        });
      }
      return { aba: nomeAba, mapa, colunas, comDiss, linhas: out };
    }
  }
  return null;
}

// Itens que podem vir preenchidos por colaborador na base: adicionais, rescisão e benefícios. Horas extras não: são lançadas
// como total do ano de cada filial e distribuídas pela ferramenta.
// Ficam de fora o PPR (salário × target), a cesta natalina e o grupo Demais, que seguem as premissas; férias, 13º e
// encargos seguem calculados sobre esses valores.
const RUBS_BASE = RUBRICAS.filter(r => !r.fixa && r.id !== 'ppr' && r.id !== 'cesta_natalina' && r.id !== 'horas_extras' && r.id !== 'promocoes' && (r.grupo === 'remuneracao' || r.grupo === 'beneficios' || r.id === 'rescisao'));
const APELIDOS_BASE = { adic_turno: ['ADICIONAIS DE TURNO'], adic_noturno: ['ADIC. NOTURNO', 'ADICIONAL NOTURNO', 'ADIC NOTURNO'] };

/** Colunas da planilha com o valor de cada item por colaborador: [{ rub, col }]. */
function colunasValores(cab) {
  const porNome = new Map();
  RUBS_BASE.forEach(r => [r.nome, ...(APELIDOS[r.id] || []), ...(APELIDOS_BASE[r.id] || [])].forEach(n => porNome.set(chaveNome(n), r.id)));
  const vistos = new Set();
  const out = [];
  cab.forEach((c, col) => {
    const rub = porNome.get(chaveNome(c));
    if (rub && !vistos.has(rub)) { vistos.add(rub); out.push({ rub, col }); }
  });
  return out;
}

const numeroCelula = v => (typeof v === 'number' ? v : Number(String(v).replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));

/**
 * A remuneração da planilha foi calculada sobre o salário com dissídio? (planilhas com coluna SALÁRIO C/ DISSÍDIO)
 * Compara a periculosidade com os dois salários: o % "redondo" (ex.: 30%) indica sobre qual ela foi calculada.
 */
function remuneracaoComDissidio(linhas, h, iSal, iSalD, colunas) {
  const iPer = colunas.find(c => c.rub === 'periculosidade')?.col;
  if (iSalD < 0 || iPer == null) return false;
  const torto = x => Math.abs(x * 100 - Math.round(x * 100));
  let comD = 0, semD = 0;
  for (const l of linhas.slice(h + 1)) {
    const per = Number(l?.[iPer]), sal = Number(l?.[iSal]), salD = Number(l?.[iSalD]);
    if (!(per > 0 && sal > 0 && salD > sal)) continue;
    if (torto(per / salD) < torto(per / sal)) comD++; else semD++;
  }
  return comD > semD;
}

/** Periodicidade do item na regra geral, para lembrar como o valor da planilha será lido (ex.: cesta 1x em dezembro). */
function quandoGeral(rub) {
  const p = Motor.premissaDe(E.dados.premissas, '', '', rub);
  return p.periodo === 'anual_mes' ? ` · 1x em ${MESES[p.mes - 1]}` : p.periodo === 'anual_diluido' && p.metodo !== 'rateio' ? ' · anual ÷ 12' : '';
}

/** Valores da linha: número > 0 = R$ do colaborador; 0 = não recebe; vazio = segue a regra da filial. */
function valoresDaLinha(l, colunas, deflator) {
  if (!colunas.length) return {};
  const vals = {};
  for (const { rub, col } of colunas) {
    const v = l[col];
    if (v == null || String(v).trim() === '') continue;
    let n = numeroCelula(v);
    if (!Number.isFinite(n)) { if (/^(-|—|n|nao|não)$/i.test(String(v).trim())) n = 0; else continue; }
    // Remuneração e rescisão entram sem dissídio (como o salário): a ferramenta aplica o dissídio da filial no mês da data-base.
    if (RUBRICAS[IDX[rub]].grupo !== 'beneficios') n *= deflator;
    vals[rub] = n > 0 ? { metodo: 'fixo', valor: Math.round(n * 100) / 100, origem: 'base' } : { metodo: 'nao', valor: 0, origem: 'base' };
  }
  return { valores_base: vals, colunas_arq: colunas.map(c => c.rub) };
}

function renderBase() {
  const el = painel('base');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Base de <em>colaboradores</em></h1>
      <p class="subtitulo">Suba os dados cadastrais e o <b>salário</b> (sem dissídio) de cada colaborador. Adicionais, rescisão e benefícios podem vir com o <b>valor de cada colaborador</b> em colunas opcionais (0 = não recebe; vazio = segue a regra da filial). Horas extras (total do ano de cada filial), PPR, cesta natalina, o grupo Demais, férias, 13º e encargos seguem as premissas.</p></div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-claro" id="nova-vaga">+ Nova vaga</button><button class="btn btn-claro" id="novo-colab">+ Colaborador</button></div></div>
    <section class="cartao importar">
      <h3>Importar base <small>· .xlsx ou .csv · pode ser uma planilha por regional ou todas juntas</small></h3>
      <div class="passos-modelo">
        <div><b>1</b><span>Baixe o modelo — <b>14 colunas</b> até o salário e, se quiser, os valores de adicionais e <b>benefícios</b> de cada colaborador.</span><button class="btn btn-marinho btn-sm" id="baixar-modelo">⬇ Baixar modelo (Excel)</button></div>
        <div><b>2</b><span>Cole os colaboradores (uma linha por pessoa). Vagas: situação “Nova Vaga” e o mês de admissão em <i>Mês início</i>.</span></div>
        <div><b>3</b><span>Suba o arquivo aqui embaixo e confira a prévia antes de importar.</span></div>
      </div>
      <label class="zona-arquivo" id="zona"><input type="file" id="arquivo" accept=".xlsx,.xls,.csv" multiple hidden>
        <strong>Clique ou arraste as planilhas aqui</strong><span class="zona-dica">Pode adicionar uma de cada vez — elas vão se juntando numa lista e você importa todas juntas.</span>Matrícula · Funcionário · Regional · Filial · Situação · Função · Cargo · Cód. C. Custo · Centro de custo · Gestor (opcional) · Salário · Mês início · Mês fim
        <br><small>Colunas de adicionais, rescisão e benefícios (VA, VT, Assist. médica…) são lidas como valor do colaborador; as demais são ignoradas.</small></label>
      <div id="previa" class="previa"></div>
    </section>
    <section class="cartao base-situacao" style="margin-top:1.2rem" id="base-situacao"></section>
    <section class="cartao" style="margin-top:1.2rem" id="base-anterior"></section>
    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas">
        <input class="campo" id="base-busca" placeholder="Buscar nome, matrícula, função…" value="${esc(E.base.busca)}" style="min-width:260px">
        <label class="check"><input type="checkbox" id="base-vagas" ${E.base.soVagas ? 'checked' : ''}> só vagas</label>
        <label class="check"><input type="checkbox" id="base-proprias" ${E.base.soProprias ? 'checked' : ''}> só com condições próprias</label>
        <span class="direita" id="base-resumo"></span>
      </div>
      <div class="tabela-wrap alta" id="base-tabela"></div>
    </section>`;
  const inp = $('#arquivo', el);
  const zona = $('#zona', el);
  inp.addEventListener('change', () => { adicionarArquivos([...inp.files]); inp.value = ''; });
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('sobre'); adicionarArquivos([...e.dataTransfer.files]); });
  $('#base-busca', el).addEventListener('input', e => { E.base.busca = e.target.value; desenharBase(); });
  $('#base-vagas', el).addEventListener('change', e => { E.base.soVagas = e.target.checked; desenharBase(); });
  $('#base-proprias', el).addEventListener('change', e => { E.base.soProprias = e.target.checked; desenharBase(); });
  $('#baixar-modelo', el).addEventListener('click', baixarModeloBase);
  desenharAnoAnterior($('#base-anterior', el));
  if (E.base.fila.length) previaImportacao(E.base.fila);
  $('#nova-vaga', el).addEventListener('click', () => editarColaborador(null, { vaga: true }));
  $('#novo-colab', el).addEventListener('click', () => editarColaborador(null, {}));
  desenharBase();
}

/** Aba opcional "Condições próprias": MATRÍCULA | ITEM | VALOR → exceções por colaborador (ex.: sucedidos). */
function aplicarCondicoesProprias(wb, lido) {
  const aba = wb.SheetNames.find(n => /^(CONDICOES|EXCECOES|SUCEDIDOS)/.test(normCab(n).replace(/[^A-Z]/g, '')));
  if (!aba) return;
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null });
  const h = linhas.findIndex(l => (l || []).some(c => normCab(c).startsWith('MATRICULA') || normCab(c) === 'CHAPA'));
  if (h < 0) return;
  const cab = linhas[h].map(normCab);
  const iMat = cab.findIndex(c => c.startsWith('MATRICULA') || c === 'CHAPA');
  const iItem = cab.findIndex(c => c === 'ITEM' || c === 'BENEFICIO' || c === 'RUBRICA');
  const iVal = cab.findIndex(c => c === 'VALOR');
  const porNome = new Map();
  RUBRICAS.filter(r => !r.fixa).forEach(r => [r.nome, ...(APELIDOS[r.id] || [])].forEach(n => porNome.set(chaveNome(n), r.id)));
  const porMat = new Map(lido.linhas.filter(l => l.matricula).map(l => [String(l.matricula), l]));
  lido.avisosCond = [];
  for (const l of linhas.slice(h + 1)) {
    if (!l || l[iMat] == null || l[iMat] === '') continue;
    const mat = String(l[iMat]).trim();
    const rub = porNome.get(chaveNome(l[iItem]));
    const colab = porMat.get(mat);
    if (!colab) { lido.avisosCond.push(`Condições próprias: matrícula ${mat} não está na aba de colaboradores.`); continue; }
    if (!rub) { lido.avisosCond.push(`Condições próprias: item “${l[iItem]}” não reconhecido (matrícula ${mat}).`); continue; }
    const v = lerCelulaPremissa(l[iVal]);
    if (!v || v.sim) continue;
    (colab.excecoes ||= {})[rub] = { metodo: v.metodo === 'rateio' ? 'fixo' : v.metodo, valor: v.valor || 0 };
  }
  lido.avisosCond = lido.avisosCond.slice(0, 8);
}

function baixarModeloBase() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const cab = ['MATRÍCULA', 'FUNCIONÁRIO', 'SEXO', 'REGIONAL', 'FILIAL', 'SITUAÇÃO', 'FUNÇÃO', 'CARGO', 'CÓD. C. CUSTO', 'CENTRO DE CUSTO', 'GESTOR', 'SALÁRIO', 'MÊS INÍCIO', 'MÊS FIM',
    ...RUBS_BASE.map(r => r.nome.toUpperCase())];
  const exemplo = { periculosidade: 1252.68, va: 1480, vt: 0, assist_medica: 2339.18, assist_odonto: 27, seguro_vida: 83.9 };
  const ws = XLSX.utils.aoa_to_sheet([
    cab,
    ['10001', 'NOME DO COLABORADOR', 'F', 'NORTE', 'APARECIDA', 'Ativo', 'Operador I', '15-Operação - Produção', '17150', 'OPERAÇÃO', 'NOME DO GESTOR', 4175.6, 1, 12, ...RUBS_BASE.map(r => exemplo[r.id] ?? null)],
    ['', 'NOVA VAGA - OPERADOR I', '', 'NORTE', 'APARECIDA', 'Nova Vaga', 'Operador I', '15-Operação - Produção', '17150', 'OPERAÇÃO', 'NOME DO GESTOR', 4000, 4, 12],
  ]);
  ws['!cols'] = [12, 34, 7, 16, 22, 14, 28, 26, 14, 26, 26, 12, 11, 10, ...RUBS_BASE.map(() => 14)].map(wch => ({ wch }));
  const ajuda = XLSX.utils.aoa_to_sheet([
    ['Coluna', 'O que colocar'],
    ['MATRÍCULA', 'Chapa/matrícula (pode ficar vazia para vagas)'],
    ['FUNCIONÁRIO', 'Nome do colaborador ou descrição da vaga'],
    ['SEXO', 'Opcional. F ou M — usado em ações para públicos específicos (ex.: outubro rosa, novembro azul)'],
    ['REGIONAL / FILIAL', 'Iguais em todas as linhas da mesma unidade (ex.: NORTE / APARECIDA)'],
    ['SITUAÇÃO', 'Ativo, Férias, Afastado… Use "Nova Vaga" para vagas previstas'],
    ['FUNÇÃO / CARGO', 'Cargo = nível do cargo (ex.: 07-Supervisores), usado no PPR por nível. Função (ex.: Aprendiz) e cargo servem no filtro "quem recebe" e no valor diferente por função'],
    ['CÓD. C. CUSTO / CENTRO DE CUSTO', 'Código e nome do centro de custo'],
    ['GESTOR', 'Opcional. Nome do gestor imediato — usado na visão de headcount do Painel (cadeiras por gestor)'],
    ['SALÁRIO', 'Salário mensal atual, SEM o dissídio (o reajuste é aplicado pela ferramenta no mês da data-base)'],
    ['MÊS INÍCIO', 'Opcional. 1 a 12 — para vagas, o mês de admissão. Vazio = janeiro'],
    ['MÊS FIM', 'Opcional. 1 a 12 — desligamento previsto. Vazio = dezembro'],
    [''],
    ['PERICULOSIDADE … RESCISÃO', 'Opcional. Valor do colaborador em R$ por mês, SEM dissídio (como o salário): 0 = não recebe · vazio = segue a regra da filial. Sobem com o dissídio da filial; férias, 13º e encargos são calculados sobre eles.'],
    ['VA / VR … FRETADO (OVERALL)', 'Opcional. Valor de cada benefício do colaborador em R$: 0 = não recebe · vazio = segue a regra da filial. Cada valor segue a periodicidade do item nas premissas (todo mês, 1x no ano…) e recebe o reajuste de benefícios da filial. Pode apagar as colunas que não usar.'],
    [''],
    ['Horas extras (total do ano de cada filial), PPR, cesta natalina, férias, 13º, encargos e o grupo Demais (endomarketing, treinamento…) não vêm da planilha: seguem as premissas de cada filial.'],
    [''],
    ['ABA "Condições próprias" (opcional)', 'Só para quem tem benefício diferente da regra da filial (ex.: sucedidos). Uma linha por colaborador e item:'],
    ['MATRÍCULA', 'A mesma da aba Base'],
    ['ITEM', 'Nome do item como aparece na ferramenta (ex.: VA / VR, Assistência médica, Farmácia, Vale mobilidade, PPR)'],
    ['VALOR', '1850 = R$ por mês · 20% = percentual · 3 sal = nº de salários · Não = não recebe'],
  ]);
  ajuda['!cols'] = [{ wch: 34 }, { wch: 100 }];
  const cond = XLSX.utils.aoa_to_sheet([
    ['MATRÍCULA', 'ITEM', 'VALOR'],
    ['10001', 'VA / VR', 1850],
    ['10001', 'Farmácia', 300],
    ['10001', 'Vale mobilidade', 'Não'],
  ]);
  cond['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Base');
  XLSX.utils.book_append_sheet(wb, cond, 'Condições próprias');
  XLSX.utils.book_append_sheet(wb, ajuda, 'Como preencher');
  XLSX.writeFile(wb, 'Modelo-base-orcamento.xlsx');
}

/** Junta os arquivos escolhidos à lista (um de cada vez ou vários juntos); o mesmo nome substitui o anterior. */
function adicionarArquivos(novos) {
  for (const arq of novos) {
    if (!/\.(xlsx|xls|csv)$/i.test(arq.name)) { toast(`${arq.name}: use arquivos .xlsx, .xls ou .csv.`, 'erro'); continue; }
    E.base.fila = [...E.base.fila.filter(a => a.name !== arq.name), arq];
  }
  if (E.base.fila.length) previaImportacao(E.base.fila);
}

async function previaImportacao(arquivos) {
  const prev = $('#previa');
  if (!window.XLSX) return toast('Carregando leitor de Excel… tente de novo.', 'erro');
  prev.innerHTML = '<p>Lendo planilhas…</p>';
  const lidas = [];
  for (const arq of arquivos) {
    try {
      // CSV: lê como texto (UTF-8) e sem conversão automática, para não transformar "4175,60" em 417560.
      const wb = /\.csv$/i.test(arq.name)
        ? XLSX.read((await arq.text()).replace(/^\uFEFF/, ''), { type: 'string', raw: true })
        : XLSX.read(await arq.arrayBuffer(), { type: 'array' });
      const r = lerPlanilha(wb);
      if (r) aplicarCondicoesProprias(wb, r);
      lidas.push({ arquivo: arq.name, ...(r || { erro: true }) });
    } catch { lidas.push({ arquivo: arq.name, erro: true }); }
  }
  const linhas = lidas.flatMap(l => l.linhas || []);
  const semRegional = linhas.filter(l => !l.regional).length;
  const porReg = {};
  linhas.forEach(l => { (porReg[l.regional || '?'] ||= new Set()).add(l.filial); });
  const totalSal = linhas.reduce((s, l) => s + l.salario, 0);
  const comValores = RUBS_BASE.map(r => r.id).filter(r => lidas.some(l => (l.colunas || []).some(c => c.rub === r)));
  prev.innerHTML = `
    <div class="fila-cab"><b>${lidas.length} arquivo(s) na lista</b><button class="btn btn-claro btn-sm" id="add-arquivo">+ Adicionar outra planilha</button><button class="btn-link" id="limpar-fila">Limpar lista</button></div>
    ${lidas.map((l, i) => l.erro ? `<p class="fila-item">❌ <b>${esc(l.arquivo)}</b>: não encontrei uma linha de cabeçalho com Funcionário, Filial e Salário. <button class="btn-ic" data-tirar="${i}" title="Tirar da lista">✕</button></p>`
      : `<div class="fila-item"><b>📄 ${esc(l.arquivo)}</b> · aba “${esc(l.aba)}” · ${l.linhas.length} linha(s) <button class="btn-ic" data-tirar="${i}" title="Tirar da lista">✕</button><div class="chips" style="margin-top:.35rem">${Object.entries(l.mapa).map(([k, i]) => {
        const opcional = k === 'mes_inicio' || k === 'mes_fim' || k === 'matricula' || k === 'sexo' || k === 'gestor';
        return `<span class="chip ${i >= 0 ? 'ok' : opcional ? '' : 'falta'}">${i >= 0 ? '✓' : '–'} ${ROTULO_CAMPO[k]}${i < 0 && opcional ? ' (opcional)' : ''}</span>`;
      }).join('')}</div></div>`).join('')}
    ${linhas.length ? `
      <div><b>${linhas.length}</b> colaboradores · <b>${linhas.filter(l => l.vaga).length}</b> vaga(s) · folha base de <b>${brl0.format(totalSal)}</b>/mês${linhas.some(l => l.excecoes) ? ` · <b>${linhas.filter(l => l.excecoes).length}</b> com condições próprias` : ''}</div>
      ${lidas.flatMap(l => l.avisosCond || []).map(a => `<p style="color:#b54d12;margin:0">⚠ ${esc(a)}</p>`).join('')}
      ${comValores.length ? `<div class="benef-base">
        <b>Valores por colaborador encontrados na planilha</b> <small>marque os itens que devem vir da planilha · valor = R$ do colaborador · 0 = não recebe · vazio = segue a regra da filial</small>
        ${[['Remuneração e rescisão', 'entram sem dissídio, como o salário, e sobem com o dissídio da filial; férias, 13º e encargos são calculados sobre eles', r => RUBRICAS[IDX[r]].grupo !== 'beneficios'],
          ['Benefícios', 'cada valor segue a periodicidade do item nas premissas (todo mês, 1x no ano…) e recebe o reajuste de benefícios da filial', r => RUBRICAS[IDX[r]].grupo === 'beneficios']]
          .map(([titulo, dica, f]) => comValores.filter(f).length ? `<div class="benef-grupo"><span><b>${titulo}</b><small>${dica}</small></span><div class="chips">${comValores.filter(f).map(r => `<label class="chip ok"><input type="checkbox" data-usar="${r}" checked> ${esc(RUBRICAS[IDX[r]].nome)} <small>(${linhas.filter(l => l.valores_base?.[r]?.metodo === 'fixo').length})${quandoGeral(r)}</small></label>`).join('')}</div></div>` : '').join('')}
        ${lidas.filter(l => l.comDiss).map(l => `<p style="margin:.3rem 0 0;color:#b54d12">ℹ ${esc(l.arquivo)}: a remuneração está calculada sobre o salário com dissídio — a ferramenta tira o dissídio desses valores, porque aplica o da filial no mês da data-base.</p>`).join('')}
        <small>PPR, cesta natalina e o grupo Demais (endomarketing, treinamento…) continuam pelas premissas.</small></div>` : ''}
      <div class="chips">${Object.entries(porReg).map(([r, f]) => `<span class="chip">${esc(r)} · ${f.size} filiais</span>`).join('')}</div>
      ${semRegional ? `<p style="color:#b54d12">⚠ ${semRegional} linha(s) sem regional — serão ignoradas.</p>` : ''}
      <div class="linha">
        <div class="modos-import">
          <label class="check"><input type="radio" name="modo" value="tudo" checked> <span><b>Substituir toda a base</b> por estes arquivos <small>recomendado · a base fica só com o que está nos arquivos</small></span></label>
          <label class="check"><input type="radio" name="modo" value="substituir"> <span><b>Substituir só as regionais</b> que estão nos arquivos <small>as outras regionais ficam como estão</small></span></label>
          <label class="check"><input type="radio" name="modo" value="adicionar"> <span><b>Adicionar</b> à base atual <small>soma, não apaga nada · cuidado com duplicados</small></span></label>
        </div>
        <button class="btn btn-laranja" id="confirmar-import" style="margin-left:auto">Importar ${linhas.length} linhas</button>
      </div>` : ''}`;
  $('#add-arquivo')?.addEventListener('click', () => $('#arquivo').click());
  $('#limpar-fila')?.addEventListener('click', () => { E.base.fila = []; prev.innerHTML = ''; });
  $$('[data-tirar]', prev).forEach(b => b.addEventListener('click', () => {
    E.base.fila = E.base.fila.filter((_, i) => i !== Number(b.dataset.tirar));
    if (E.base.fila.length) previaImportacao(E.base.fila); else prev.innerHTML = '';
  }));
  $('#confirmar-import')?.addEventListener('click', async e => {
    const modo = $('input[name="modo"]:checked').value;
    e.target.disabled = true;
    e.target.textContent = 'Importando…';
    try {
      const usar = new Set($$('[data-usar]:checked', prev).map(i => i.dataset.usar));
      // Itens marcados vêm da planilha; os da aba "Condições próprias" (ajustados à mão) valem por cima deles.
      const enviar = linhas.filter(l => l.regional).map(({ valores_base, colunas_arq, ...l }) => {
        const vals = Object.fromEntries(Object.entries(valores_base || {}).filter(([r]) => usar.has(r)));
        return { ...l, excecoes: { ...vals, ...(l.excecoes || {}) }, colunas_base: (colunas_arq || []).filter(r => usar.has(r)) };
      });
      const r = await api('/api/colaboradores/importar', { method: 'POST', body: { modo, linhas: enviar } });
      E.base.fila = [];
      await carregar();
      toast(`${r.importados} colaboradores importados (${r.regionais.join(', ')}).`);
      renderBase();
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = `Importar ${linhas.length} linhas`;
      toast(`Não foi possível importar: ${err.message}`, 'erro');
    }
  });
}

/** Situação da base: total por regional, matrículas repetidas e ações de limpeza. */
// ----- Histórico do ano anterior (salário pago em cada mês), para o comparativo -----

const MESES_LONGOS = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function desenharAnoAnterior(box) {
  const ant = E.dados.anterior || [];
  const a = anoAnt();
  const folha = ant.reduce((t, x) => t + x.salarios.reduce((p, v) => p + (Number(v) || 0), 0), 0);
  const hcMes = MESES.map((_, m) => ant.filter(x => Number(x.salarios[m]) > 0).length);
  box.innerHTML = `
    <h3>Histórico ${a} <small>· salário pago em cada mês, para comparar ${a} × ${E.dados.config.ano}</small></h3>
    <p class="subtitulo" style="margin:0 0 .8rem">Uma linha por colaborador com o salário de cada mês de ${a}. A ferramenta aplica as regras das premissas (adicionais, férias + 1/3, 13º, FGTS, INSS, benefícios, PPR…) <b>sem o dissídio e sem o reajuste de benefícios de ${E.dados.config.ano}</b> (o dissídio e o reajuste de ${a} lançados nas filiais entram a partir da data-base, como provisão) e monta o custo de ${a} para o comparativo no Painel e na Simulação. Mês vazio ou 0 = a pessoa não estava na empresa naquele mês. Aceita também <b>uma linha por mês</b> (colunas Mês/Ano e Salário). Se o ano ainda não fechou, os meses que faltam são projetados com o salário do último mês de quem estava ativo nele.</p>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
      <button class="btn btn-claro btn-sm" id="ant-modelo">⬇ Modelo do histórico</button>
      <label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar histórico ${a}<input type="file" id="ant-arquivo" accept=".xlsx,.xls,.csv" hidden></label>
      ${ant.length ? `<button class="btn btn-claro btn-sm" id="ant-apagar" style="color:var(--vermelho)">Apagar histórico</button>
        <span class="chip ok">✓ ${num0.format(ant.length)} colaborador(es) · ${new Set(ant.map(x => x.filial)).size} filiais · folha ${a} ${brl0.format(folha)} · HC jan ${hcMes[0]} → dez ${hcMes[11]}</span>${notaProjecao() ? `<span class="chip">* ${esc(notaProjecao())}</span>` : ''}` : '<span class="chip falta">Sem histórico carregado</span>'}
    </div>`;
  $('#ant-modelo', box).addEventListener('click', baixarModeloAnterior);
  $('#ant-arquivo', box).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarAnoAnterior(f); });
  $('#ant-apagar', box)?.addEventListener('click', async () => {
    if (!confirm(`Apagar o histórico de ${a}? O comparativo deixa de aparecer.`)) return;
    try { await api('/api/ano-anterior', { method: 'DELETE' }); toast('Histórico apagado.'); await recarregarTudo(); } catch (e) { toast(e.message, 'erro'); }
  });
}

function baixarModeloAnterior() {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const a = String(anoAnt()).slice(-2);
  const cab = ['MATRÍCULA', 'FUNCIONÁRIO', 'REGIONAL', 'FILIAL', 'FUNÇÃO', 'CARGO', 'CÓD. C. CUSTO', 'CENTRO DE CUSTO', ...MESES.map(m => `${m.toUpperCase()}/${a}`)];
  const ws = XLSX.utils.aoa_to_sheet([cab,
    ['21000038', 'NOME DO COLABORADOR', 'CENTRO OESTE', 'CUIABA', 'Mecânico II', '14-Operação - Apoio', '17151', 'MANUTENÇÃO', ...Array(4).fill(4658.04), ...Array(8).fill(4858.04)],
    ['14000777', 'DESLIGADO EM JUNHO', 'NORTE', 'MAUA 3', 'Operador I', '15-Operação - Produção', '17150', 'OPERAÇÃO', ...Array(6).fill(4175.6), ...Array(6).fill(null)]]);
  ws['!cols'] = [12, 34, 16, 22, 26, 26, 14, 26, ...MESES.map(() => 11)].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Historico ${anoAnt()}`);
  XLSX.writeFile(wb, `Modelo-historico-${anoAnt()}.xlsx`);
}

/** Mês (0–11) de um rótulo de competência: "mar./2026", "MAR/26", "03/2026", "2026-03", data do Excel… (-1 se não for mês) */
function mesDaCompetencia(v) {
  if (v instanceof Date) return v.getMonth();
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).getUTCMonth(); // data serial do Excel
  const t = normCab(v).replace(/[^A-Z0-9/-]/g, '');
  const i = MESES.findIndex(m => t.startsWith(normCab(m)));
  if (i >= 0) return i;
  const l = MESES_LONGOS.findIndex(m => t.startsWith(m));
  if (l >= 0) return l;
  let n = t.match(/^(\d{1,2})[/-]\d{2,4}$/);
  if (n) return Number(n[1]) - 1;
  n = t.match(/^\d{4}-(\d{1,2})/);
  return n ? Number(n[1]) - 1 : -1;
}

/** Nome da filial como está na ferramenta ("NORTE FLUMINENSE" → "UTE NORTE FLUMINENSE"), quando dá para saber sem dúvida. */
function filialDaFerramenta(nome) {
  const f = normCab(nome);
  const todas = Object.keys(E.dados.filiais);
  const igual = todas.find(x => normCab(x) === f);
  if (igual || !f) return igual || nome.toUpperCase();
  const contem = todas.filter(x => { const n = normCab(x); return n.endsWith(` ${f}`) || n.startsWith(`${f} `) || n.includes(` ${f} `); });
  return contem.length === 1 ? contem[0] : nome.toUpperCase();
}

async function importarAnoAnterior(arquivo) {
  try {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
    const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0);
    let lido = null;
    let mesesReais = 12;
    for (const nomeAba of wb.SheetNames) {
      const l = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, raw: true, defval: null });
      for (let h = 0; h < Math.min(l.length, 40) && !lido; h++) {
        const cab = (l[h] || []).map(normCab);
        const achar = (campo, lista = ALIASES[campo]) => { for (const al of lista) { const i = cab.indexOf(al); if (i >= 0) return i; } return -1; };
        const col = Object.fromEntries(['matricula', 'nome', 'regional', 'filial', 'funcao', 'cargo', 'cc_cod', 'cc_nome'].map(k => [k, achar(k)]));
        if (col.nome < 0 || col.filial < 0) continue;
        const txt = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
        const linhas = l.slice(h + 1).filter(r => r && txt(r, 'nome') && txt(r, 'filial'));
        const pessoa = r => ({
          matricula: txt(r, 'matricula'), nome: txt(r, 'nome'), regional: txt(r, 'regional'), filial: txt(r, 'filial'), funcao: txt(r, 'funcao'),
          cargo: txt(r, 'cargo'), cc_cod: txt(r, 'cc_cod'), cc_nome: txt(r, 'cc_nome'),
        });
        // Formato "uma linha por mês": colunas Mês/Ano (competência) e Salário
        const cMes = achar('', ['MES/ANO', 'MES / ANO', 'MESANO', 'COMPETENCIA', 'MES COMPETENCIA', 'MES', 'PERIODO']);
        const cSal = achar('salario');
        if (cMes >= 0 && cSal >= 0) {
          const porPessoa = new Map();
          for (const r of linhas) {
            const m = mesDaCompetencia(r[cMes]);
            if (m < 0) continue;
            const p = pessoa(r);
            // a mesma matrícula existe em empresas diferentes: a pessoa é matrícula + nome + filial
            const k = `${p.matricula}|${normCab(p.nome)}|${normCab(p.filial)}`;
            if (!porPessoa.has(k)) porPessoa.set(k, { ...p, salarios: Array(12).fill(0) });
            const x = porPessoa.get(k);
            x.salarios[m] += num(r[cSal]);
            Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v))); // fica a função/cargo do mês mais recente
          }
          lido = [...porPessoa.values()];
        } else {
          // Formato "uma coluna por mês": JAN/26, JAN, JANEIRO, 01/2026…
          const colMes = Array(12).fill(-1);
          cab.forEach((c, i) => { if (Object.values(col).includes(i)) return; const m = mesDaCompetencia(c); if (m >= 0 && m < 12 && colMes[m] < 0) colMes[m] = i; });
          if (colMes.filter(i => i >= 0).length < 1) continue;
          lido = linhas.map(r => ({ ...pessoa(r), salarios: colMes.map(i => (i >= 0 ? num(r[i]) : 0)) }));
        }
      }
      if (lido) break;
    }
    if (!lido || !lido.length) return toast('Não encontrei as colunas Funcionário, Filial e os meses (JAN/26 … DEZ/26, ou Mês/Ano + Salário). Use o modelo.', 'erro');
    lido.forEach(x => {
      x.filial = filialDaFerramenta(x.filial);
      if (!x.regional) x.regional = E.dados.filiais[x.filial]?.regional || '';
    });
    // Meses que ainda não fecharam (ex.: só até outubro): projeta com o salário do último mês de quem estava ativo nele
    const ultimo = Math.max(...lido.map(x => x.salarios.reduce((u, v, m) => (v > 0 ? m : u), -1)));
    let proj = 0;
    if (ultimo >= 0 && ultimo < 11) {
      mesesReais = ultimo + 1;
      lido.forEach(x => {
        if (x.salarios[ultimo] > 0) { proj++; for (let m = ultimo + 1; m < 12; m++) x.salarios[m] = x.salarios[ultimo]; }
      });
    }
    const msgProj = proj ? `\n\nA planilha vai até ${MESES[ultimo]}/${anoAnt()}: ${MESES[ultimo + 1]}–Dez serão projetados com o salário de ${MESES[ultimo]} das ${proj} pessoas ativas em ${MESES[ultimo]}.` : '';
    if (!confirm(`${lido.length} colaborador(es) no histórico de ${anoAnt()}.${msgProj}\n\nSubstituir o histórico atual por este?`)) return;
    const r = await api('/api/ano-anterior/importar', { method: 'POST', body: { linhas: lido, meses_reais: mesesReais } });
    toast(`Histórico de ${anoAnt()} carregado: ${r.importados} colaborador(es)${proj ? ` · ${MESES[ultimo + 1]}–Dez projetados` : ''}.`);
    await recarregarTudo();
  } catch (e) { toast(e.message || 'Não consegui ler o arquivo.', 'erro'); }
}

function desenharSituacaoBase() {
  const el = $('#base-situacao');
  if (!el) return;
  const todos = E.dados.colaboradores;
  const porReg = {};
  todos.forEach(c => { porReg[c.regional] = (porReg[c.regional] || 0) + 1; });
  // Duplicado = mesma matrícula + nome + filial (a mesma matrícula existe em empresas diferentes); vagas não contam.
  const contMat = new Map();
  todos.forEach(c => {
    if (c.vaga) return;
    const k = `${c.matricula}|${String(c.nome).trim().toUpperCase()}|${c.filial}`;
    contMat.set(k, (contMat.get(k) || 0) + 1);
  });
  const repetidas = [...contMat.values()].filter(n => n > 1);
  const sobra = repetidas.reduce((s, n) => s + n - 1, 0);
  el.innerHTML = `
    <div class="ferramentas" style="margin:0">
      <h3 style="margin:0">Base atual: ${num0.format(todos.length)} registro(s)</h3>
      <span class="chip" title="Sexo informado na base (usado em ações por público)">♀ ${num0.format(todos.filter(c => c.sexo === 'F').length)} · ♂ ${num0.format(todos.filter(c => c.sexo === 'M').length)}${todos.some(c => !c.sexo && !c.vaga) ? ` · sem sexo ${num0.format(todos.filter(c => !c.sexo && !c.vaga).length)}` : ''}</span>
      <div class="chips">${Object.entries(porReg).sort().map(([r, n]) => `<span class="chip">${esc(r)} · ${num0.format(n)}</span>`).join('')}</div>
      <span class="direita"><button class="btn btn-perigo btn-sm" id="apagar-base" ${todos.length ? '' : 'disabled'}>🗑 Apagar toda a base</button></span>
    </div>
    ${sobra ? `<div class="alerta-dup">⚠ <b>${num0.format(repetidas.length)} colaborador(es) aparecem mais de uma vez</b> (mesma matrícula, nome e filial) (${num0.format(sobra)} registro(s) a mais) — provavelmente de uma importação somada à anterior.
      <button class="btn btn-laranja btn-sm" id="remover-dup">Remover duplicados</button><small>Fica só o registro mais recente de cada um.</small></div>` : ''}`;
  $('#remover-dup', el)?.addEventListener('click', async () => {
    if (!confirm(`Remover ${sobra} registro(s) duplicado(s)? Fica só o registro mais recente de cada colaborador.`)) return;
    const r = await api('/api/colaboradores/remover-duplicados', { method: 'POST' });
    await carregar();
    renderBase();
    toast(`${r.removidos} registro(s) duplicado(s) removido(s).`);
  });
  $('#apagar-base', el)?.addEventListener('click', async () => {
    const txt = prompt(`Isto apaga os ${todos.length} registros da base (as premissas continuam). Para confirmar, digite APAGAR:`);
    if (txt !== 'APAGAR') return;
    const r = await api('/api/colaboradores', { method: 'DELETE', body: { confirmar: 'APAGAR' } });
    await carregar();
    renderBase();
    toast(`Base apagada (${r.removidos} registros). Importe as planilhas de novo.`);
  });
}

function desenharBase() {
  desenharSituacaoBase();
  const busca = E.base.busca.toLowerCase();
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const lista = E.dados.colaboradores.filter(c => noFiltro(c) && (!E.base.soVagas || c.vaga) && (!E.base.soProprias || temManuais(c)) &&
    (!busca || `${c.nome} ${c.matricula} ${c.funcao} ${c.cc_nome} ${c.cc_cod}`.toLowerCase().includes(busca)));
  const anual = c => { const i = idx.get(c.id); let s = 0; for (let k = 0; k < RN * 12; k++) s += E.res.valores[i * RN * 12 + k]; return s; };
  $('#base-resumo').innerHTML = `<span class="etiqueta azul">${lista.length} registro(s)</span><span class="etiqueta pend">${lista.filter(c => c.vaga).length} vaga(s)</span>`;
  $('#base-tabela').innerHTML = lista.length ? `<table class="tabela">
    <thead><tr><th class="fixa">Colaborador</th><th>Filial</th><th>Função / cargo</th><th>Centro de custo</th><th class="n">Salário</th><th>Período</th><th class="n">Custo anual</th><th></th></tr></thead>
    <tbody>${lista.slice(0, 1500).map(c => `<tr class="${c.vaga ? 'vaga' : ''}">
      <td class="fixa">${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${etiquetaProprias(c)}<span class="sub">${esc(c.matricula || '')} · ${esc(c.situacao || '')}</span></td>
      <td>${esc(c.filial)}<span class="sub">${esc(c.regional)}</span></td>
      <td>${esc(c.funcao || '')}<span class="sub">${esc(c.cargo || '')}</span></td>
      <td>${esc(c.cc_cod || '')}<span class="sub">${esc(c.cc_nome || '')}</span></td>
      <td class="n">${brl.format(c.salario)}</td>
      <td>${c.mes_inicio === 1 && c.mes_fim === 12 ? 'Ano todo' : `${MESES[c.mes_inicio - 1]} – ${MESES[c.mes_fim - 1]}`}</td>
      <td class="n">${brl0.format(anual(c))}</td>
      <td><span class="acoes"><button class="btn-ic" data-editar="${c.id}" title="Editar">✎</button><button class="btn-ic" data-remover="${c.id}" title="Remover">🗑</button></span></td>
    </tr>`).join('')}</tbody></table>` : '<div class="vazio"><span>👥</span>Nenhum colaborador com esses filtros.</div>';
  $$('[data-editar]').forEach(b => b.addEventListener('click', () => editarColaborador(Number(b.dataset.editar))));
  $$('[data-remover]').forEach(b => b.addEventListener('click', async () => {
    const c = E.dados.colaboradores.find(x => x.id === Number(b.dataset.remover));
    if (!confirm(`Remover ${c.nome} da base do orçamento?`)) return;
    await api(`/api/colaboradores/${c.id}`, { method: 'DELETE' });
    await carregar();
    desenharBase();
    toast('Removido.');
  }));
}

function editarColaborador(id, padrao = {}) {
  const c = id ? E.dados.colaboradores.find(x => x.id === id) : { regional: E.filtro.regional, filial: E.filtro.filial, mes_inicio: 1, mes_fim: 12, salario: 0, ...padrao };
  if (!c) return toast('Colaborador não encontrado (pode ter sido removido).', 'erro');
  const campo = (k, rot, tipo = 'text', extra = '') => `<label class="rotulo">${rot}<input class="campo" name="${k}" type="${tipo}" value="${esc(c[k] ?? '')}" ${extra}></label>`;
  const dl = (idL, valores) => `<datalist id="${idL}">${[...new Set(valores.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const d = abrirModal({
    titulo: id ? c.nome : c.vaga ? 'Nova vaga' : 'Novo colaborador', sup: c.vaga ? 'VAGA PREVISTA' : 'COLABORADOR',
    corpo: `<form class="form-grade" id="form-colab">
      ${campo('nome', c.vaga ? 'Descrição da vaga' : 'Nome', 'text', 'required')}
      ${campo('matricula', 'Matrícula')}
      <label class="rotulo">Regional<input class="campo" name="regional" list="dl-reg" value="${esc(c.regional || '')}" required></label>
      <label class="rotulo">Filial<input class="campo" name="filial" list="dl-fil" value="${esc(c.filial || '')}" required></label>
      ${campo('funcao', 'Função')}
      <label class="rotulo">Cargo / nível<input class="campo" name="cargo" list="dl-cargo" value="${esc(c.cargo || '')}"></label>
      ${campo('cc_cod', 'Cód. centro de custo')}
      ${campo('cc_nome', 'Centro de custo')}
      ${campo('gestor', 'Gestor')}
      ${campo('salario', 'Salário (sem dissídio)', 'number', 'step="0.01" min="0" required')}
      ${campo('situacao', 'Situação')}
      <label class="rotulo">Sexo <small>(para ações por público)</small><select class="campo" name="sexo"><option value="">Não informado</option><option value="F" ${c.sexo === 'F' ? 'selected' : ''}>Feminino</option><option value="M" ${c.sexo === 'M' ? 'selected' : ''}>Masculino</option></select></label>
      <label class="rotulo">${c.vaga ? 'Mês de admissão' : 'Mês de início'}<select class="campo" name="mes_inicio">${opcoesMes(c.mes_inicio)}</select></label>
      <label class="rotulo">Mês de saída <small>(desligamento previsto)</small><select class="campo" name="mes_fim">${opcoesMes(c.mes_fim)}</select></label>
      <label class="check inteiro"><input type="checkbox" name="vaga" ${c.vaga ? 'checked' : ''}> É uma vaga prevista (ainda não preenchida)</label>
      <div class="inteiro proprias">
        <h4>Condições próprias deste colaborador <small>· ex.: sucedidos com benefício diferente da regra da filial</small></h4>
        <div id="lista-proprias"></div>
        <button type="button" class="btn btn-claro btn-sm" id="add-propria">+ Adicionar item com valor próprio</button>
      </div>
      ${dl('dl-reg', regionais())}${dl('dl-fil', filiaisDa(''))}${dl('dl-cargo', E.dados.colaboradores.map(x => x.cargo))}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-colab">Salvar</button>',
  });
  montarProprias(d, c);
  $('#salvar-colab', d).addEventListener('click', async () => {
    const f = $('#form-colab', d);
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    body.vaga = f.vaga.checked;
    body.excecoes = lerProprias(d);
    if (body.excecoes === null) return;
    if (Number(body.mes_fim) < Number(body.mes_inicio)) return toast('O mês de saída deve ser depois do início.', 'erro');
    try {
      await api(id ? `/api/colaboradores/${id}` : '/api/colaboradores', { method: id ? 'PUT' : 'POST', body });
      d.close();
      await carregar();
      renderAba();
      toast('Salvo.');
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ----- Condições próprias (exceções por colaborador) -----

const TIPOS_PROPRIA = { fixo: 'R$ por mês', pct: '%', multiplo: 'Nº de salários', nao: 'Não recebe' };
const temProprias = c => Boolean(c.excecoes && Object.keys(c.excecoes).length);
// Condições ajustadas à mão (sucedidos etc.), sem contar os valores que vieram da planilha da base.
const temManuais = c => Object.values(c.excecoes || {}).some(e => e.origem !== 'base');
const etiquetaProprias = c => {
  if (!temProprias(c)) return '';
  const itens = Object.entries(c.excecoes);
  const manuais = itens.filter(([, e]) => e.origem !== 'base');
  const dica = lista => esc(lista.map(([r, e]) => `${RUBRICAS[IDX[r]].nome}: ${textoCurto({ ...e, periodo: 'mensal' })}`).join(' · '));
  return `${manuais.length ? ` <span class="etiqueta azul" title="${dica(manuais)}">condições próprias</span>` : ''}${manuais.length < itens.length ? ` <span class="etiqueta neutra" title="${dica(itens.filter(([, e]) => e.origem === 'base'))}">benefícios da base</span>` : ''}`;
};

function montarProprias(d, c) {
  const box = $('#lista-proprias', d);
  const regra = rub => {
    if (!c.filial) return '';
    const p = Motor.premissaDe(E.dados.premissas, c.filial, c.regional || E.dados.filiais[c.filial]?.regional, rub);
    return p.metodo === 'nao' ? 'filial não tem' : `regra da filial: ${textoCurto(p)}`;
  };
  const linha = (rub = '', e = { metodo: 'fixo', valor: '' }) => {
    const div = document.createElement('div');
    div.className = 'propria-linha';
    div.dataset.origem = e.origem || '';
    div.addEventListener('change', () => { div.dataset.origem = ''; });
    div.innerHTML = `
      <select class="campo" data-p="rub"><option value="">Escolha o item…</option>${GRUPOS.filter(g => g.id !== 'provisoes' && g.id !== 'encargos').map(g => `<optgroup label="${g.nome}">${RUBRICAS.filter(r => r.grupo === g.id && !r.fixa && !r.soLancamento).map(r => `<option value="${r.id}" ${r.id === rub ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}</optgroup>`).join('')}</select>
      <select class="campo" data-p="metodo">${Object.entries(TIPOS_PROPRIA).map(([k, v]) => `<option value="${k}" ${k === e.metodo ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="campo" type="number" step="any" data-p="valor" value="${e.valor ?? ''}" placeholder="valor" ${e.metodo === 'nao' ? 'disabled' : ''}>
      <button type="button" class="btn-ic" data-p="rem" title="Remover">✕</button>
      <small data-p="regra">${e.origem === 'base' ? 'veio da planilha da base · ' : ''}${rub ? esc(regra(rub)) : ''}</small>`;
    div.querySelector('[data-p=rub]').addEventListener('change', ev => { div.querySelector('[data-p=regra]').textContent = ev.target.value ? regra(ev.target.value) : ''; });
    div.querySelector('[data-p=metodo]').addEventListener('change', ev => { div.querySelector('[data-p=valor]').disabled = ev.target.value === 'nao'; });
    div.querySelector('[data-p=rem]').addEventListener('click', () => div.remove());
    box.appendChild(div);
  };
  Object.entries(c.excecoes || {}).forEach(([rub, e]) => linha(rub, e));
  $('#add-propria', d).addEventListener('click', () => linha());
}

/** Lê as condições próprias do formulário; null se houver item repetido. */
function lerProprias(d) {
  const out = {};
  for (const div of $$('.propria-linha', d)) {
    const rub = div.querySelector('[data-p=rub]').value;
    if (!rub) continue;
    if (out[rub]) { toast(`O item ${RUBRICAS[IDX[rub]].nome} aparece duas vezes.`, 'erro'); return null; }
    const metodo = div.querySelector('[data-p=metodo]').value;
    out[rub] = { metodo, valor: metodo === 'nao' ? 0 : Number(div.querySelector('[data-p=valor]').value) || 0, ...(div.dataset.origem === 'base' ? { origem: 'base' } : {}) };
  }
  return out;
}

// ---------- Conferência (coordenadores) ----------

function descreverPremissa(p) {
  const v = Number(p.valor) || 0;
  const per = p.periodo === 'anual_mes' ? ` · em ${MESES[p.mes - 1]}` : p.periodo === 'anual_diluido' ? ' · anual ÷ 12' : '';
  if (p.periodo === 'por_mes' && (p.metodo === 'fixo' || p.metodo === 'rateio')) {
    return `valor diferente por mês · ${brl.format((p.meses || []).reduce((a, b) => a + (Number(b) || 0), 0))} no ano${p.metodo === 'rateio' ? ' (total da filial)' : ' por colaborador'}`;
  }
  switch (p.metodo) {
    case 'pct': return `${num2.format(v)}% s/ ${BASES[p.base].split(' (')[0].toLowerCase()}${p.teto ? ` · teto ${brl.format(p.teto)}` : ''}${p.inicio > 1 ? ` · a partir de ${MESES[p.inicio - 1]}` : ''}${p.inicio2 > 1 ? ` · + ${num2.format(v)}% a partir de ${MESES[p.inicio2 - 1]}` : ''}${p.provisao ? ` · provisão só em ${[p.inicio, p.inicio2].filter(x => x >= 1).map(x => MESES[x - 1]).join(' e ')}, depois no salário da filial` : ''}`;
    case 'fixo': return `${brl.format(v)} por colaborador${per}`;
    case 'rateio': return `${brl.format(v)} ${p.dividir === 'escopo' ? 'total único dividido entre as filiais' : 'total da filial'} · rateio ${p.rateio === 'salario' ? 'pelo salário' : 'por HC'}${per}`;
    case 'multiplo': return `${p.por_nivel ? 'pela tabela de nível' : `${num2.format(v)} salário(s)`}${per}`;
    default: return 'Não se aplica';
  }
}
const descreverComQuem = p => `${descreverPremissa(p)}${p.publico === 'F' ? ' · só mulheres' : p.publico === 'M' ? ' · só homens' : ''}${p.periodo === 'por_mes' && p.publico_meses?.some(Boolean) ? ` · ${p.publico_meses.map((x, i) => (x ? `${MESES[i]} só ${x === 'F' ? 'mulheres' : 'homens'}` : '')).filter(Boolean).join(', ')}` : ''}${p.quem?.length ? ' · só para alguns CCs/cargos/funções' : ''}${Object.keys(p.por_funcao || {}).length && ['pct', 'fixo', 'multiplo'].includes(p.metodo) ? ` · ${Object.entries(p.por_funcao).map(([f, v]) => `${f}: ${p.metodo === 'fixo' ? brl.format(v) : p.metodo === 'pct' ? `${num2.format(v)}%` : `${num2.format(v)} sal`}`).join(', ')}` : ''}`;

function renderConferencia() {
  const el = painel('conferencia');
  const fils = filiaisVisiveis();
  if (!fils.includes(E.conf.filial)) E.conf.filial = fils[0] || '';
  const porFilial = Motor.agregar(E.res, c => c.filial, c => fils.includes(c.filial));
  const abertas = E.solic.filter(s => s.status === 'aberta' || s.status === 'em_analise');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Conferência do <em>orçamento</em></h1>
      <p class="subtitulo">Confira colaboradores, salários, vagas e premissas de cada filial. Encontrou algo errado? Use os botões <b>✏️ Ajustar</b> nas premissas ou marque os colaboradores na tabela — o pedido vai direto para o time de orçamento.</p></div></div>
    ${fils.length ? `<div class="filiais-cards">${fils.map(f => {
      const a = porFilial.get(f);
      const cfg = E.dados.filiais[f];
      const n = abertas.filter(s => s.filial === f).length;
      return `<button class="filial-card${f === E.conf.filial ? ' ativo' : ''}" data-filial="${esc(f)}">
        <strong>${esc(f)}</strong><span class="valor">${brl0.format(a?.total || 0)}</span>
        <small>${a?.n || 0} colaborador(es) · dissídio ${esc(textoDissidio(cfg))}</small>
        <span>${cfg.conferencia === 'conferida' ? '<span class="etiqueta ok">✓ Conferida</span>' : '<span class="etiqueta neutra">Pendente</span>'} ${n ? `<span class="etiqueta pend">${n} pedido(s)</span>` : ''}</span>
      </button>`;
    }).join('')}</div><div id="conf-detalhe"></div>` : '<div class="cartao vazio"><span>📭</span>Nenhuma filial disponível para você.</div>'}`;
  $$('.filial-card', el).forEach(b => b.addEventListener('click', () => { E.conf.filial = b.dataset.filial; E.conf.sel.clear(); renderConferencia(); }));
  if (E.conf.filial) detalheConferencia();
}

function detalheConferencia() {
  const f = E.conf.filial;
  const cfg = E.dados.filiais[f];
  const el = $('#conf-detalhe');
  const idx = new Map(E.res.colaboradores.map((c, i) => [c.id, i]));
  const colabs = E.dados.colaboradores.filter(c => c.filial === f);
  const anualRub = (c, r) => { const i = idx.get(c.id); let s = 0; for (let m = 0; m < 12; m++) s += E.res.valor(i, r, m); return s; };
  const mesesAtivos = c => c.mes_fim - c.mes_inicio + 1;
  // Uma coluna por item que alguém da filial tem (como na planilha BZO); o salário base fica em coluna própria.
  const cols = RUBRICAS.map((r, k) => ({ r, k })).filter(({ k }) => colabs.some(c => anualRub(c, k)));
  const porMes = E.conf.modo === 'mes';
  const valorCel = (c, k) => { const a = anualRub(c, k); return porMes ? a / mesesAtivos(c) : a; };
  const totalColab = c => cols.reduce((s, { k }) => s + anualRub(c, k), 0);
  const somaCol = k => colabs.reduce((s, c) => s + (porMes ? anualRub(c, k) / 12 : anualRub(c, k)), 0);
  E.conf.valoresColab = c => Object.fromEntries([[RUBRICAS[0].nome, brl.format(anualRub(c, 0) / mesesAtivos(c))], ...cols.map(({ r, k }) => [r.nome, `${brl.format(anualRub(c, k) / mesesAtivos(c))} / mês`])]);
  const ativas = RUBRICAS.filter(r => !r.fixa).map(r => ({ r, p: Motor.premissaDe(E.dados.premissas, f, cfg.regional, r.id) })).filter(x => x.p.metodo !== 'nao');
  el.innerHTML = `
    <section class="cartao">
      <div class="prem-cab">
        <div><small>${esc(cfg.regional)}</small><h2>${esc(f)}</h2>
          <p>${cfg.conferencia === 'conferida' ? `✓ Conferida por ${esc(cfg.conferida_por || '')} em ${esc(dataBr(cfg.conferida_em))}` : 'Ainda não conferida'}</p></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-claro btn-sm" id="conf-geral">✏️ Outro ajuste</button>
          <button class="btn btn-claro btn-sm" id="conf-vaga">+ Solicitar vaga</button>
          ${cfg.conferencia === 'conferida' ? '<button class="btn btn-claro btn-sm" id="conf-status" data-s="pendente">Reabrir conferência</button>' : '<button class="btn btn-laranja btn-sm" id="conf-status" data-s="conferida">✓ Marcar como conferida</button>'}
        </div>
      </div>
      <h3 style="margin:.4rem 0 .7rem;font-size:.95rem">Premissas aplicadas</h3>
      <div class="resumo-prem">
        <div><span>Dissídio</span><b>${esc(textoDissidio(cfg))}</b><button class="btn-ajustar" data-pedir-prem="dissidio">✏️ Ajustar</button></div>
        <div><span>Reajuste de benefícios</span><b>${esc(textoReajuste(cfg, 'reaj_benef'))}</b><button class="btn-ajustar" data-pedir-prem="reaj_benef">✏️ Ajustar</button></div>
        ${ativas.map(({ r, p }) => `<div><span>${esc(r.nome)}</span><b>${esc(descreverComQuem(p))}</b><button class="btn-ajustar" data-pedir-prem="${r.id}">✏️ Ajustar</button></div>`).join('')}
      </div>
      <div class="ferramentas" style="margin:1.4rem 0 .7rem">
        <h3 style="margin:0;font-size:.95rem">Colaboradores e vagas <small>· ${colabs.length} · ${porMes ? 'valores por mês (média dos meses no ano)' : 'valores do ano'}</small></h3>
        <span class="direita">
          <div class="segmentos" id="conf-modo"><button data-m="mes" class="${porMes ? 'ativo' : ''}">Por mês</button><button data-m="ano" class="${porMes ? '' : 'ativo'}">No ano</button></div>
          <button class="btn btn-marinho btn-sm" id="conf-excel">⬇ Excel</button>
        </span>
      </div>
      <div class="aviso-ajuste">☑️ <b>Algo errado com algum colaborador?</b> Marque a caixa ao lado do nome (pode marcar vários) e clique em <b>Solicitar ajuste</b>.</div>
      <div class="tabela-wrap alta"><table class="tabela tabela-conf">
        <thead>
          <tr class="cab-grupos"><th class="fixa" rowspan="2"><label class="marcar"><input type="checkbox" id="conf-todos" title="Marcar todos"> Colaborador</label></th><th rowspan="2">Período</th><th class="n" rowspan="2">Salário base<br><small>(sem dissídio)</small></th>
            ${GRUPOS.map(g => { const n = cols.filter(x => x.r.grupo === g.id).length; return n ? `<th colspan="${n}" class="cab-grupo" style="--c:${g.cor}">${g.nome}</th>` : ''; }).join('')}
            <th class="n" rowspan="2">Total ${porMes ? '/ mês' : 'ano'}</th></tr>
          <tr>${cols.map(({ r }) => `<th class="n" style="box-shadow:inset 0 3px 0 ${COR_GRUPO[r.grupo]}">${esc(r.id === 'salario' ? 'Salário c/ dissídio' : r.nome)}</th>`).join('')}</tr>
        </thead>
        <tbody>${colabs.map(c => {
          const meses = mesesAtivos(c);
          const tot = totalColab(c);
          return `<tr class="linha-sel${c.vaga ? ' vaga' : ''}${E.conf.sel.has(c.id) ? ' marcada' : ''}" data-sel="${c.id}"><td class="fixa"><input type="checkbox" class="marca" data-marca="${c.id}" ${E.conf.sel.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(c.nome)} para ajuste"> ${esc(c.nome)}${c.vaga ? ' <span class="etiqueta pend">vaga</span>' : ''}${etiquetaProprias(c)}<span class="sub" title="${esc(`${[c.matricula, c.funcao, c.cargo].filter(Boolean).join(' · ')} — CC ${[c.cc_cod, c.cc_nome].filter(Boolean).join(' · ')}`)}">${esc([c.funcao, c.cc_cod ? `CC ${c.cc_cod} ${c.cc_nome || ''}` : ''].filter(Boolean).join(' · '))}</span></td>
            <td>${meses === 12 ? 'Ano todo' : `${MESES[c.mes_inicio - 1]} – ${MESES[c.mes_fim - 1]}`}</td>
            <td class="n">${brl.format(c.salario)}</td>
            ${cols.map(({ k }) => { const v = valorCel(c, k); return `<td class="n${v ? '' : ' zero'}${c.excecoes?.[RUBRICAS[k].id] && c.excecoes[RUBRICAS[k].id].origem !== 'base' ? ' propria-cel' : ''}">${v ? num2.format(v) : '–'}</td>`; }).join('')}
            <td class="n"><b>${num2.format(porMes ? tot / meses : tot)}</b></td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr class="total"><td class="fixa">Total da filial${porMes ? ' / mês' : ''}</td><td></td><td class="n">${num2.format(colabs.reduce((s, c) => s + c.salario, 0))}</td>
          ${cols.map(({ k }) => `<td class="n">${num2.format(somaCol(k))}</td>`).join('')}
          <td class="n">${num2.format(colabs.reduce((s, c) => s + totalColab(c), 0) / (porMes ? 12 : 1))}</td></tr></tfoot>
      </table></div>
      <p class="subtitulo" style="margin:.6rem 0 0;font-size:.8rem">“Salário c/ dissídio” já considera o reajuste a partir do mês da data-base${Motor.MESES_SALARIO < 12 ? ` e entra em ${Motor.MESES_SALARIO}/12 (1 mês do ano é pago como férias + 1/3)` : ''}; no modo “Por mês” é a média dos meses. Valores em azul são condições próprias do colaborador.</p>
      <div class="barra-selecao" id="barra-selecao" hidden></div>
    </section>`;
  $$('#conf-modo button', el).forEach(b => b.addEventListener('click', () => { E.conf.modo = b.dataset.m; detalheConferencia(); }));
  $('#conf-excel', el).addEventListener('click', () => {
    if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
    const cab = ['Matrícula', 'Colaborador', 'Função', 'Cargo', 'Cód. C. Custo', 'Centro de custo', 'Mês início', 'Mês fim', 'Salário base', ...cols.map(({ r }) => r.nome), `Total ${porMes ? '/ mês' : 'ano'}`];
    const r2 = v => Math.round(v * 100) / 100;
    const aoa = [cab, ...colabs.map(c => [c.matricula, c.nome, c.funcao, c.cargo, c.cc_cod, c.cc_nome, c.mes_inicio, c.mes_fim, c.salario,
      ...cols.map(({ k }) => r2(valorCel(c, k))), r2(porMes ? totalColab(c) / mesesAtivos(c) : totalColab(c))])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cab.map((_, i) => ({ wch: i === 1 ? 34 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, porMes ? 'Por mês' : 'No ano');
    XLSX.writeFile(wb, `Conferencia-${f.replace(/[^\w-]+/g, '_')}-${porMes ? 'mensal' : 'anual'}.xlsx`);
  });
  $('#conf-status', el).addEventListener('click', async e => {
    await api(`/api/filiais/${encodeURIComponent(f)}/conferencia`, { method: 'PUT', body: { status: e.target.dataset.s } });
    await carregar();
    renderConferencia();
    toast(e.target.dataset.s === 'conferida' ? 'Filial marcada como conferida.' : 'Conferência reaberta.');
  });
  $('#conf-geral', el).addEventListener('click', () => pedirAjuste({ tipo: 'geral', filial: f, regional: cfg.regional, alvo_desc: `Filial ${f}` }));
  $('#conf-vaga', el).addEventListener('click', () => pedirAjuste({ tipo: 'vaga', filial: f, regional: cfg.regional, alvo_desc: `Nova vaga · ${f}` }));
  $$('[data-pedir-prem]', el).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.pedirPrem;
    const nome = id === 'dissidio' ? 'Dissídio' : id === 'reaj_benef' ? 'Reajuste de benefícios' : RUBRICAS[IDX[id]].nome;
    const atual = b.parentElement.querySelector('b').textContent;
    pedirAjuste({ tipo: id === 'dissidio' || id === 'reaj_benef' ? 'dissidio' : 'premissa', filial: f, regional: cfg.regional, alvo_id: id, alvo_desc: `${nome} · ${f}`, campo: nome, valor_atual: atual });
  }));
  // Seleção de colaboradores para ajuste: caixa na linha (ou clique em qualquer ponto da linha) + barra com o botão.
  const atualizarBarra = () => {
    const n = E.conf.sel.size;
    const barra = $('#barra-selecao', el);
    barra.hidden = !n;
    barra.innerHTML = n ? `<span><b>${n}</b> colaborador${n > 1 ? 'es' : ''} selecionado${n > 1 ? 's' : ''}</span>
      <button class="btn btn-claro btn-sm" id="sel-limpar">Limpar seleção</button>
      <button class="btn btn-laranja" id="sel-ajustar">✏️ Solicitar ajuste</button>` : '';
    if (!n) return;
    $('#sel-limpar', barra).addEventListener('click', () => { E.conf.sel.clear(); detalheConferencia(); });
    $('#sel-ajustar', barra).addEventListener('click', () => pedirAjusteColaboradores(colabs.filter(c => E.conf.sel.has(c.id)), cfg));
  };
  const marcar = (id, on) => {
    on ? E.conf.sel.add(id) : E.conf.sel.delete(id);
    const tr = el.querySelector(`tr[data-sel="${id}"]`);
    tr?.classList.toggle('marcada', on);
    const cb = tr?.querySelector('[data-marca]');
    if (cb) cb.checked = on;
    $('#conf-todos', el).checked = colabs.length > 0 && colabs.every(c => E.conf.sel.has(c.id));
    atualizarBarra();
  };
  $$('tr[data-sel]', el).forEach(tr => tr.addEventListener('click', e => {
    const id = Number(tr.dataset.sel);
    if (e.target.matches('[data-marca]')) marcar(id, e.target.checked);
    else marcar(id, !E.conf.sel.has(id));
  }));
  $('#conf-todos', el).checked = colabs.length > 0 && colabs.every(c => E.conf.sel.has(c.id));
  $('#conf-todos', el).addEventListener('change', e => colabs.forEach(c => marcar(c.id, e.target.checked)));
  atualizarBarra();
}

/** Formulário de ajuste para os colaboradores marcados: um bloco por pessoa + explicação opcional para todos. */
function pedirAjusteColaboradores(lista, cfg) {
  const blocos = lista.map(c => {
    const campos = camposDoColab(c, E.conf.valoresColab(c));
    return `<fieldset class="ajuste-pessoa" data-id="${c.id}">
      <legend>${esc(c.nome)} <small>${esc([c.funcao, c.cc_cod && `CC ${c.cc_cod}`].filter(Boolean).join(' · '))}</small></legend>
      <div class="form-grade">
        <label class="rotulo">O que precisa mudar?<select class="campo" name="campo">${Object.keys(campos).map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
        <label class="rotulo">Como está hoje<input class="campo" name="valor_atual" readonly value="${esc(campos['Salário'])}"></label>
        <label class="rotulo">Como deveria ser<input class="campo" name="valor_sugerido" placeholder="ex.: R$ 5.300,00"></label>
        <label class="rotulo">Motivo <small>(se for diferente do geral)</small><input class="campo" name="mensagem" placeholder="ex.: promoção em setembro"></label>
      </div>
    </fieldset>`;
  }).join('');
  const d = abrirModal({
    titulo: lista.length === 1 ? lista[0].nome : `${lista.length} colaboradores`, sup: 'SOLICITAR AJUSTE', largo: lista.length > 1,
    corpo: `
      <p style="margin:0;color:var(--texto-suave);font-size:.9rem">Para cada pessoa, escolha <b>o que precisa mudar</b> e diga <b>como deveria ser</b>. O pedido vai para o time de orçamento, e a resposta aparece em <b>Meus pedidos</b>.</p>
      ${lista.length > 1 ? '<label class="rotulo">Motivo geral <small>(vale para todos que não tiverem um motivo próprio)</small><textarea class="campo" id="motivo-geral" rows="2" placeholder="ex.: dados desatualizados na base"></textarea></label>' : ''}
      ${blocos}`,
    rodape: `<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="enviar-ajustes">Enviar ${lista.length > 1 ? `${lista.length} pedidos` : 'pedido'}</button>`,
  });
  $$('.ajuste-pessoa', d).forEach(fs => {
    const c = lista.find(x => x.id === Number(fs.dataset.id));
    const campos = camposDoColab(c, E.conf.valoresColab(c));
    fs.querySelector('[name=campo]').addEventListener('change', e => { fs.querySelector('[name=valor_atual]').value = campos[e.target.value]; });
  });
  $('#enviar-ajustes', d).addEventListener('click', async () => {
    const geral = $('#motivo-geral', d)?.value.trim() || '';
    const pedidos = $$('.ajuste-pessoa', d).map(fs => {
      const c = lista.find(x => x.id === Number(fs.dataset.id));
      const v = n => fs.querySelector(`[name=${n}]`).value.trim();
      return { c, campo: v('campo'), valor_atual: v('valor_atual'), valor_sugerido: v('valor_sugerido'), mensagem: v('mensagem') || geral };
    });
    const faltando = pedidos.filter(p => !p.mensagem && !p.valor_sugerido);
    if (faltando.length) return toast(`Preencha "Como deveria ser" ou o motivo de: ${faltando.map(p => p.c.nome).join(', ')}.`, 'erro');
    const btn = $('#enviar-ajustes', d);
    btn.disabled = true;
    try {
      for (const p of pedidos) {
        await api('/api/solicitacoes', { method: 'POST', body: {
          tipo: 'colaborador', filial: p.c.filial, regional: cfg.regional, alvo_id: String(p.c.id), alvo_desc: `${p.c.nome} · ${p.c.funcao || ''}`,
          campo: p.campo, valor_atual: p.valor_atual, valor_sugerido: p.valor_sugerido, mensagem: p.mensagem || `${p.campo}: ${p.valor_sugerido}`,
        } });
      }
      d.close();
      E.conf.sel.clear();
      await carregarSolicitacoes();
      renderConferencia();
      toast(pedidos.length > 1 ? `${pedidos.length} pedidos enviados ao time de orçamento.` : 'Pedido enviado ao time de orçamento.');
    } catch (e) { btn.disabled = false; toast(e.message, 'erro'); }
  });
}

/** Opções de "o que precisa mudar" para um colaborador, com o valor atual de cada uma. */
function camposDoColab(c, itens = {}) {
  return {
    'Salário': brl.format(c.salario), 'Centro de custo': `${c.cc_cod || ''} ${c.cc_nome || ''}`.trim(), 'Função / cargo': `${c.funcao || ''} · ${c.cargo || ''}`,
    'Desligamento previsto': c.mes_fim === 12 ? 'Sem previsão' : MESES[c.mes_fim - 1], 'Transferência de filial': c.filial,
    ...Object.fromEntries(Object.entries(itens).filter(([k]) => k !== 'Salário')),
    'Excluir do orçamento': '', 'Outro': '',
  };
}

function pedirAjuste(ctx) {
  const c = ctx.colab;
  const camposColab = c ? camposDoColab(c, ctx.itens) : null;
  const d = abrirModal({
    titulo: ctx.alvo_desc, sup: 'SOLICITAR AJUSTE',
    corpo: `<form class="form-grade" id="form-pedido">
      ${camposColab ? `<label class="rotulo">O que precisa mudar?<select class="campo" name="campo">${Object.keys(camposColab).map(k => `<option>${k}</option>`).join('')}</select></label>
        <label class="rotulo">Valor atual<input class="campo" name="valor_atual" readonly value="${esc(camposColab['Salário'])}"></label>`
        : ctx.campo ? `<label class="rotulo">Item<input class="campo" name="campo" readonly value="${esc(ctx.campo)}"></label><label class="rotulo">Valor atual<input class="campo" name="valor_atual" readonly value="${esc(ctx.valor_atual || '')}"></label>` : ''}
      <label class="rotulo inteiro">${ctx.tipo === 'vaga' ? 'Vaga (função, salário, centro de custo e mês de admissão)' : 'Valor correto / sugestão'}<input class="campo" name="valor_sugerido" placeholder="${ctx.tipo === 'vaga' ? 'ex.: Operador I · R$ 4.200 · 17150 Operação · a partir de Mar' : 'ex.: R$ 5.300,00'}"></label>
      <label class="rotulo inteiro">Explique o ajuste<textarea class="campo" name="mensagem" rows="4" required placeholder="Descreva o que está errado e o motivo."></textarea></label>
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="enviar-pedido">Enviar pedido</button>',
  });
  const sel = $('select[name="campo"]', d);
  if (sel) sel.addEventListener('change', () => { $('input[name="valor_atual"]', d).value = camposColab[sel.value]; });
  $('#enviar-pedido', d).addEventListener('click', async () => {
    const f = $('#form-pedido', d);
    if (!f.reportValidity()) return;
    const body = { ...ctx, ...Object.fromEntries(new FormData(f)) };
    delete body.colab;
    try {
      await api('/api/solicitacoes', { method: 'POST', body });
      d.close();
      await carregarSolicitacoes();
      if (E.aba === 'conferencia') renderConferencia();
      toast('Pedido enviado ao time de orçamento.');
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ---------- Pedidos de ajuste ----------

const dataBr = s => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

async function carregarSolicitacoes() {
  E.solic = await api('/api/solicitacoes');
  const pend = E.solic.filter(s => (E.eu.admin ? s.status === 'aberta' : s.status === 'aberta' || s.status === 'em_analise')).length;
  const q = $('#qtd-solic');
  q.hidden = !pend;
  q.textContent = pend;
}

function renderSolicitacoes() {
  const el = painel('solicitacoes');
  const admin = E.eu.admin;
  const filtros = { pendentes: s => s.status === 'aberta' || s.status === 'em_analise', ajustada: s => s.status === 'ajustada', recusada: s => s.status === 'recusada', todas: () => true };
  const lista = E.solic.filter(filtros[E.solicFiltro]);
  const conta = k => E.solic.filter(filtros[k]).length;
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Pedidos de <em>ajuste</em></h1>
      <p class="subtitulo">${admin ? 'Pedidos enviados pelos coordenadores. Abra o item, ajuste e responda — o coordenador vê a resposta na hora.' : 'Acompanhe os pedidos que você enviou e as respostas do time de orçamento.'}</p></div></div>
    <div class="ferramentas"><div class="segmentos" id="solic-filtro">${[['pendentes', 'Em aberto'], ['ajustada', 'Ajustadas'], ['recusada', 'Recusadas'], ['todas', 'Todas']].map(([k, r]) => `<button data-f="${k}" class="${E.solicFiltro === k ? 'ativo' : ''}">${r} (${conta(k)})</button>`).join('')}</div></div>
    <div class="solic-lista">${lista.length ? lista.map(s => `
      <article class="solic ${s.status}" data-id="${s.id}">
        <div>
          <div class="solic-topo"><span class="etiqueta ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span><span>#${s.id}</span><span>·</span><span>${esc(s.regional)}${s.filial ? ` / ${esc(s.filial)}` : ''}</span><span>·</span><span>${esc(s.autor)}</span><span>·</span><span>${dataBr(s.criado_em)}</span></div>
          <h4>${esc(s.alvo_desc || 'Pedido geral')}</h4>
          ${s.campo || s.valor_sugerido ? `<div class="sugestao">${s.campo ? `<b>${esc(s.campo)}</b>: ` : ''}${s.valor_atual ? `${esc(s.valor_atual)} → ` : ''}<b>${esc(s.valor_sugerido || '—')}</b></div>` : ''}
          <p style="margin-top:.5rem">${esc(s.mensagem)}</p>
          ${s.resposta ? `<div class="resposta" style="margin-top:.5rem">💬 <b>Resposta:</b> ${esc(s.resposta)}</div>` : ''}
        </div>
        <div class="solic-acoes">${admin ? `
          <button class="btn btn-marinho btn-sm" data-abrir>Abrir item</button>
          <select class="campo" data-status>${Object.entries(STATUS).map(([k, [r]]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <textarea class="campo" data-resposta rows="2" placeholder="Resposta ao coordenador">${esc(s.resposta || '')}</textarea>
          <button class="btn btn-laranja btn-sm" data-salvar>Salvar</button>`
          : s.status === 'aberta' ? '<button class="btn btn-perigo btn-sm" data-cancelar>Cancelar pedido</button>' : ''}</div>
      </article>`).join('') : '<div class="cartao vazio"><span>✨</span>Nenhum pedido aqui.</div>'}</div>`;
  $$('#solic-filtro button', el).forEach(b => b.addEventListener('click', () => { E.solicFiltro = b.dataset.f; renderSolicitacoes(); }));
  $$('.solic', el).forEach(card => {
    const s = E.solic.find(x => x.id === Number(card.dataset.id));
    card.querySelector('[data-salvar]')?.addEventListener('click', async () => {
      await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: { status: card.querySelector('[data-status]').value, resposta: card.querySelector('[data-resposta]').value } });
      await carregarSolicitacoes();
      renderSolicitacoes();
      toast('Pedido atualizado.');
    });
    card.querySelector('[data-cancelar]')?.addEventListener('click', async () => {
      if (!confirm('Cancelar este pedido?')) return;
      await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: {} });
      await carregarSolicitacoes();
      renderSolicitacoes();
    });
    card.querySelector('[data-abrir]')?.addEventListener('click', async () => {
      if (s.status === 'aberta') {
        await api(`/api/solicitacoes/${s.id}`, { method: 'PUT', body: { status: 'em_analise' } });
        await carregarSolicitacoes();
      }
      abrirItem(s);
    });
  });
}

function abrirItem(s) {
  if (s.tipo === 'colaborador') return editarColaborador(Number(s.alvo_id));
  if (s.tipo === 'vaga') return editarColaborador(null, { vaga: true, regional: s.regional, filial: s.filial || '', nome: 'Nova vaga' });
  if (s.filial && E.dados.filiais[s.filial]) {
    E.prem.escopo = s.filial;
    E.prem.edits = {};
    E.prem.filial = {};
    irPara('premissas');
    const linha = s.alvo_id && $(`#tabela-prem tr[data-rub="${CSS.escape(s.alvo_id)}"]`);
    if (linha) { linha.scrollIntoView({ block: 'center' }); linha.style.outline = '2px solid var(--laranja)'; }
    return;
  }
  irPara('premissas');
}

// ---------- Relatório contábil ----------

// Vínculo sugerido item → conta contábil (pelo código da conta); pode ser trocado na tela.
const CONTA_SUGERIDA = {
  salario: '218 - SALÁRIOS E ORDENADOS', periculosidade: '1833725 - INSALUBRIDADE / PERICULOSIDADE', insalubridade: '1833725 - INSALUBRIDADE / PERICULOSIDADE',
  penosidade: '1833725 - INSALUBRIDADE / PERICULOSIDADE', adic_turno: '1833726 - ADICIONAL NOTURNO', adic_noturno: '1833726 - ADICIONAL NOTURNO', horas_extras: '219 - HORAS EXTRAS', promocoes: '218 - SALÁRIOS E ORDENADOS',
  ferias: '223 - PROV.TRABALHISTAS-FÉRIAS', decimo: '118516 - PROV.TRABALHISTAS-13º SALÁRIO', rescisao: '220 - DESPESAS COM RESCISÃO DE FUNCIONÁRIOS',
  fgts: '221 - F.G.T.S.', fgts_ferias: '118519 - PROV.TRABALHISTAS-FGTS S/FÉRIAS', fgts_13: '118520 - PROV.TRABALHISTAS-FGTS S/13º SALÁRIO',
  inss: '222 - I.N.S.S.', inss_ferias: '118517 - PROV.TRABALHISTAS-INSS S/FÉRIAS', inss_13: '118518 - PROV.TRABALHISTAS-INSS S/13º SALÁRIO',
  ppr: '2821595 - PROVISÃO PARA PARTICIPAÇÃO NOS RESULTADOS', va: '255 - PAT-PROGRAMA ALIMENTAÇÃO TRABALHADOR', va_natal: '247 - CESTAS BÁSICAS/TICKETS',
  vt: '236 - VALE TRANSPORTE', aux_creche: '67994 - DESPESAS COM CRECHES E LAZER', educacional: '3447914 - OUTROS BENEFICIOS SOCIAIS',
  material_escolar: '3447914 - OUTROS BENEFICIOS SOCIAIS', aux_oculos: '3447914 - OUTROS BENEFICIOS SOCIAIS', oftalmo: '67996 - DESPESAS MÉDICAS/HOSPITALARES/ODONTOLÓGICAS',
  assist_medica: '147480 - PLANO DE SAUDE', coparticipacao: '147480 - PLANO DE SAUDE', assist_odonto: '67996 - DESPESAS MÉDICAS/HOSPITALARES/ODONTOLÓGICAS',
  farmacia: '163562 - MEDICAMENTOS', seguro_vida: '78061 - SEGUROS DE FUNCIONÁRIOS', previdencia: '2909419 - PREVIDENCIA PRIVADA', aux_dependente: '206192 - AUXILIO FILHO EXCEPCIONAL', refeitorio: '1291020 - ALIMENTOS PARA REFEITÓRIO',
  fretado: '67975 - TRANSPORTE CONTRATADO/PRÓPRIO', fretado_overall: '67975 - TRANSPORTE CONTRATADO/PRÓPRIO', cesta_natalina: '67993 - CESTAS NATALINAS',
  saude_ocupacional: '67980 - EXAMES PERIÓDICOS', endomarketing: '105278 - ENDOMARKETING', treinamento: '246 - CURSOS E TREINAMENTOS DE PESSOAL',
  viagens: '68420 - DIÁRIAS', confraternizacoes: '251 - CONFRATERNIZAÇÕES',
};
// Itens lançados num centro de custo próprio, e não no do colaborador (editável na tela).
const CC_MOBILIDADE = '25506 - TRANSPORTE CONTRATADO/MOBILIDADE';
const CC_SUGERIDO = { fretado: CC_MOBILIDADE, fretado_overall: CC_MOBILIDADE };
// Pacote de cada item no arquivo da contabilidade (editável na tela).
const PROVISOES_TRAB = new Set(['ferias', 'decimo', 'fgts_ferias', 'fgts_13', 'inss_ferias', 'inss_13']);
function pacoteDoItem(cfg, rub) {
  if (cfg.mapa_pacotes?.[rub]) return cfg.mapa_pacotes[rub];
  const [pessoal, beneficios, provisoes] = cfg.pacotes;
  if (PROVISOES_TRAB.has(rub)) return provisoes;
  const terceiros = cfg.pacotes.find(p => /TERCEIR/i.test(p));
  if (rub === 'servicos' && terceiros) return terceiros;
  const grupo = RUBRICAS[IDX[rub]].grupo;
  if (grupo === 'beneficios' && rub !== 'ppr') return beneficios;
  if (grupo === 'demais') return beneficios;
  return pessoal;
}

const codigoDe = rotulo => String(rotulo || '').split(' - ')[0].trim();

/** Conta contábil de um item: escolhida na tela → sugerida (achando na lista pelo código). */
function contaDoItem2(cfg, rub) {
  if (cfg.mapa_rubricas[rub] === '-') return '';
  if (cfg.mapa_rubricas[rub]) return cfg.mapa_rubricas[rub];
  const sug = CONTA_SUGERIDA[rub];
  if (!sug) return '';
  return cfg.contas.find(c => codigoDe(c) === codigoDe(sug)) || sug;
}

// ----- Formato EPM -----
const semAcento = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const PALAVRAS_GENERICAS = new Set(['UTE', 'PCH', 'LTDA', 'SA', 'S', 'A', 'DE', 'DO', 'DA', 'E', 'GOM', 'UEG']);
const palavras = t => semAcento(t).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(p => p && !PALAVRAS_GENERICAS.has(p));
/** Empresa EPM sugerida para a filial pelo nome (ex.: CANDIOTA → EMP_2236 "UTE Candiota"). */
function empresaSugerida(cfg, filial) {
  const alvo = palavras(filial);
  if (!alvo.length) return '';
  let melhor = '', nota = 0;
  for (const linha of cfg.epm_empresas || []) {
    const [cod, nome = ''] = linha.split('|');
    const nomeEmp = palavras(nome.replace(/^\d+\s*-\s*/, '').split(' - ')[0]);
    const acertos = alvo.filter(p => nomeEmp.includes(p)).length;
    // pelo menos metade das palavras da filial no nome da empresa; vence quem acerta mais e tem menos palavras sobrando
    if (!acertos || acertos * 2 < alvo.length) continue;
    const n = (acertos === alvo.length ? 1000 : 0) + acertos * 10 - (nomeEmp.length - acertos);
    if (n > nota) { nota = n; melhor = cod; }
  }
  return melhor;
}
function empresaEpm(cfg, filial) {
  if (cfg.epm_unico) return cfg.epm_padrao || 'EMP_ANT_Input';
  return cfg.mapa_empresa?.[filial] || empresaSugerida(cfg, filial) || cfg.epm_padrao || 'EMP_ANT_Input';
}

/** Centro de custo fixo do item (ex.: fretado no 25506) ou '' para usar o do colaborador. */
function ccDoItem(cfg, rub) {
  const v = cfg.cc_rubricas?.[rub];
  if (v === '-') return '';
  const cc = v || CC_SUGERIDO[rub];
  if (!cc) return '';
  return cfg.ccs.find(c => codigoDe(c) === codigoDe(cc)) || cc;
}

/** Centro de custo contábil de um CÓD. C. CUSTO da base: escolhido → mesmo código na lista → padrão. */
function ccContabil(cfg, cod) {
  if (cfg.mapa_cc[cod]) return { cc: cfg.mapa_cc[cod], como: 'manual' };
  const achado = cod && cfg.ccs.find(c => codigoDe(c) === String(cod).trim());
  if (achado) return { cc: achado, como: 'auto' };
  return { cc: cfg.cc_padrao || 'N/A Centro de Custo', como: 'sem' };
}

/** Linhas do relatório: Pacote · Centro de custo contábil · Conta contábil · Terceiro · 12 meses. */
function linhasContabeis(cfg, epm = false) {
  const porChave = new Map();
  E.res.colaboradores.forEach((c, i) => {
    if (!noFiltro(c)) return;
    const ccColab = ccContabil(cfg, c.cc_cod).cc;
    const empresa = epm ? empresaEpm(cfg, c.filial) : '';
    // Com "regional e filial", cada filial tem as suas linhas (para conferência); sem, soma como a contabilidade recebe.
    const regional = E.contabil.porFilial ? c.regional : '';
    const filial = E.contabil.porFilial ? c.filial : '';
    RUBRICAS.forEach((r, k) => {
      const av = c.avulso;
      if (av && r.id !== (av.rubrica || 'outras')) return;
      // Outro lançamento: conta, pacote e centro de custo escolhidos no próprio lançamento (senão, os do item)
      const conta = (av && av.conta) || contaDoItem2(cfg, r.id);
      if (!conta) return;
      const pacote = (av && av.pacote) || pacoteDoItem(cfg, r.id);
      const cc = (av && av.cc_contabil) || ccDoItem(cfg, r.id) || ccColab;
      // EPM: Código Empresa · CC_<número do centro de custo> · DRE_<número da conta>
      const numCc = /^\d+$/.test(codigoDe(cc)) ? codigoDe(cc) : /^\d+$/.test(String(c.cc_cod || '').trim()) ? String(c.cc_cod).trim() : 'NA';
      const ccEpm = epm ? `CC_${numCc}` : '';
      const contaEpm = epm ? `DRE_${codigoDe(conta)}` : '';
      const chave = epm ? `${empresa}\u0000${ccEpm}\u0000${contaEpm}` : `${regional}\u0000${filial}\u0000${pacote}\u0000${cc}\u0000${conta}`;
      if (!porChave.has(chave)) porChave.set(chave, { regional, filial, pacote, cc, conta, empresa, ccEpm, contaEpm, meses: new Float64Array(12) });
      const l = porChave.get(chave);
      for (let m = 0; m < 12; m++) l.meses[m] += E.res.valor(i, k, m);
    });
  });
  const ordemConta = new Map(cfg.contas.map((c, i) => [c, i]));
  if (epm) {
    return [...porChave.values()].filter(l => E.contabil.zeradas || l.meses.some(v => Math.abs(v) >= 0.005))
      .sort((a, b) => a.empresa.localeCompare(b.empresa) || a.ccEpm.localeCompare(b.ccEpm, 'pt-BR', { numeric: true }) || a.contaEpm.localeCompare(b.contaEpm, 'pt-BR', { numeric: true }));
  }
  return [...porChave.values()]
    .filter(l => E.contabil.zeradas || l.meses.some(v => Math.abs(v) >= 0.005))
    .sort((a, b) => a.regional.localeCompare(b.regional, 'pt-BR') || a.filial.localeCompare(b.filial, 'pt-BR') || cfg.pacotes.indexOf(a.pacote) - cfg.pacotes.indexOf(b.pacote) || a.cc.localeCompare(b.cc, 'pt-BR', { numeric: true }) || (ordemConta.get(a.conta) ?? 999) - (ordemConta.get(b.conta) ?? 999) || a.conta.localeCompare(b.conta));
}

async function renderContabil() {
  const el = painel('contabil');
  if (!E.contabil.cfg) E.contabil.cfg = await api('/api/contabil');
  const cfg = E.contabil.cfg;
  const ano = String(E.dados.config.ano);
  const meses = MESES.map(m => `${m}/${ano.slice(-2)}`);
  const linhas = linhasContabeis(cfg);
  const colabs = E.dados.colaboradores.filter(noFiltro);
  const ccsBase = [...new Map(E.dados.colaboradores.map(c => [String(c.cc_cod || ''), c.cc_nome || ''])).entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  const semCc = ccsBase.filter(([cod]) => ccContabil(cfg, cod).como === 'sem');
  const opcoes = (lista, sel, vazio) => `<option value="">${vazio}</option>${[...new Set([...lista, sel].filter(Boolean))].map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
  const anualRub = k => { let s = 0; E.res.colaboradores.forEach((c, i) => { if (noFiltro(c)) for (let m = 0; m < 12; m++) s += E.res.valor(i, k, m); }); return s; };
  const escopo = [escopoFiltro('Todas as regionais'), ccFiltrado(), nomeContaFiltro()].filter(Boolean).join(' · ');

  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Relatório <em>contábil</em></h1>
      <p class="subtitulo">Gera o arquivo no formato da contabilidade (Pacote · Centro de Custo · Conta Contábil · Terceiro · meses). Cada item do orçamento vai para uma conta contábil e cada CÓD. C. CUSTO da base vai para o centro de custo contábil.</p></div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-laranja" id="ct-baixar">⬇ Baixar relatório (Excel)</button><button class="btn btn-marinho" id="ct-baixar-epm">⬇ Baixar EPM (Excel)</button></div></div>
    ${E.filtro.conta ? `<p class="aviso-ajuste">⚠ Filtro de conta ativo (<b>${esc(nomeContaFiltro())}</b>): o relatório e o EPM saem só com essa(s) conta(s). Escolha <b>Todas as contas</b> no topo para o relatório completo.</p>` : ''}

    <div class="contabil-passos">
      <section class="cartao">
        <h3>1 · Listas da contabilidade</h3>
        <p class="subtitulo" style="margin:0 0 .8rem">Suba a planilha com as abas <b>Conta contabil</b> e <b>Centro de Custo Contabil</b>.</p>
        <label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar listas (Excel)<input type="file" id="ct-listas" accept=".xlsx,.xls" hidden></label>
        <div class="chips" style="margin-top:.7rem"><span class="chip ${cfg.contas.length ? 'ok' : 'falta'}">${cfg.contas.length} contas contábeis</span><span class="chip ${cfg.ccs.length ? 'ok' : 'falta'}">${cfg.ccs.length} centros de custo</span></div>
        <div class="form-grade" style="margin-top:.9rem">
          <label class="rotulo inteiro">Pacotes <small>(separados por vírgula)</small><input class="campo" id="ct-pacotes" value="${esc(cfg.pacotes.join(', '))}"></label>
          <label class="rotulo">Terceiro<input class="campo" id="ct-terceiro" value="${esc(cfg.terceiro)}"></label>
        </div>
      </section>
      <section class="cartao">
        <h3>2 · Centros de custo <small>· ${ccsBase.length} na base · ${semCc.length ? `<b style="color:#b54d12">${semCc.length} sem vínculo</b>` : 'todos vinculados'}</small></h3>
        <p class="subtitulo" style="margin:0 0 .8rem">O vínculo é automático pelo código (ex.: 17093 → “17093 - RECURSOS HUMANOS”). Ajuste só o que não bater.</p>
        <div class="tabela-wrap" style="max-height:300px"><table class="tabela"><thead><tr><th>CÓD. C. CUSTO da base</th><th class="n">Colab.</th><th>Centro de custo contábil</th></tr></thead>
        <tbody>${ccsBase.map(([cod, nome]) => {
          const v = ccContabil(cfg, cod);
          return `<tr class="${v.como === 'sem' ? 'sem-vinculo' : ''}"><td>${esc(cod || '—')}<span class="sub">${esc(nome)}</span></td><td class="n">${E.dados.colaboradores.filter(c => String(c.cc_cod || '') === cod).length}</td>
            <td><select class="campo" data-cc="${esc(cod)}">${opcoes(cfg.ccs, cfg.mapa_cc[cod] || '', v.como === 'auto' ? `Automático: ${esc(v.cc)}` : `— ${esc(cfg.cc_padrao)} —`)}</select></td></tr>`;
        }).join('')}</tbody></table></div>
      </section>
    </div>

    <section class="cartao" style="margin-top:1.2rem">
      ${(() => {
        // Custo que depende da conta do item (lançamentos com conta própria não contam)
        const semConta = k => { let t = 0; E.res.colaboradores.forEach((c, i) => { if (noFiltro(c) && !(c.avulso && c.avulso.conta)) for (let m = 0; m < 12; m++) t += E.res.valor(i, k, m); }); return Math.abs(t) >= 0.5; };
        const sem = RUBRICAS.map((r, k) => ({ r, k })).filter(({ r, k }) => !contaDoItem2(cfg, r.id) && semConta(k));
        return sem.length ? `<p class="aviso-ajuste" style="margin:0 0 .8rem">⚠️ <b>${sem.length} item(ns) com custo e sem conta contábil</b> — não entram no arquivo: ${sem.map(({ r }) => esc(r.nome)).join(', ')}. Escolha a conta na tabela abaixo.</p>` : '';
      })()}
      <h3>3 · Item do orçamento → Conta contábil <small>· sugestão inicial pelo nome da conta; troque o que precisar. Centro de custo: o do colaborador ou um fixo para o item (fretado → 25506 Transporte Contratado/Mobilidade)</small></h3>
      <div class="tabela-wrap" style="max-height:420px"><table class="tabela contabil-itens"><thead><tr><th>Item</th><th class="n">Custo anual (${esc(escopo)})</th><th>Pacote</th><th>Conta contábil</th><th>Centro de custo</th></tr></thead>
      <tbody>${GRUPOS.map(g => `<tr class="grupo"><td colspan="5" style="cursor:default">${g.nome}</td></tr>${RUBRICAS.map((r, k) => ({ r, k })).filter(x => x.r.grupo === g.id).map(({ r, k }) => `
        <tr><td>${esc(r.nome)}</td><td class="n">${brl0.format(anualRub(k))}</td>
        <td><select class="campo" data-pacote="${r.id}">${cfg.pacotes.map(pc => `<option ${pc === pacoteDoItem(cfg, r.id) ? 'selected' : ''}>${esc(pc)}</option>`).join('')}</select></td>
        <td><select class="campo" data-rub="${r.id}">${opcoes(cfg.contas.length ? cfg.contas : Object.values(CONTA_SUGERIDA), contaDoItem2(cfg, r.id), '— não enviar —')}</select></td>
        <td><select class="campo" data-ccrub="${r.id}">${opcoes([...cfg.ccs, CC_MOBILIDADE], ccDoItem(cfg, r.id), '— o do colaborador —')}</select></td></tr>`).join('')}`).join('')}</tbody></table></div>
    </section>

    <section class="cartao" style="margin-top:1.2rem">
      <details ${E.contabil.formato === 'epm' ? 'open' : ''}><summary><h3 style="display:inline">4 · Formato EPM</h3> <small class="sub" style="display:inline">· Código Empresa · CC_… · DRE_… · meses</small></summary>
        <div class="form-grade" style="margin-top:.8rem">
          <div><label class="btn btn-marinho btn-sm" style="cursor:pointer">⬆ Importar códigos EPM (Excel)<input type="file" id="ct-epm" accept=".xlsx,.xls" hidden></label>
            <div class="chips" style="margin-top:.6rem"><span class="chip ${cfg.epm_empresas.length ? 'ok' : 'falta'}">${cfg.epm_empresas.length} empresas</span><span class="chip ${cfg.epm_ccs.length ? 'ok' : 'falta'}">${cfg.epm_ccs.length} centros de custo</span></div>
            <small class="sub">Planilha com as abas <b>Empresa</b> (EMP_2197 · 2197 - UTE Cuiaba) e <b>Centro de Custo</b> (CC_17093 · 17093 - RECURSOS HUMANOS).</small></div>
          <div><label class="rotulo">Código empresa padrão<input class="campo" id="ct-epm-padrao" value="${esc(cfg.epm_padrao)}"></label>
            <label class="check"><input type="checkbox" id="ct-epm-unico" ${cfg.epm_unico ? 'checked' : ''}> usar o código padrão para todas as filiais</label></div>
        </div>
        ${cfg.epm_unico ? '' : `<div class="tabela-wrap" style="max-height:300px;margin-top:.8rem"><table class="tabela"><thead><tr><th>Filial</th><th>Código empresa (EPM)</th></tr></thead><tbody>
          ${[...new Set(E.res.colaboradores.filter(noFiltro).map(c => c.filial))].sort().map(f => {
            const sug = empresaSugerida(cfg, f);
            return `<tr><td>${esc(f)}</td><td><select class="campo" data-emp="${esc(f)}"><option value="">${sug ? `Automático: ${esc((cfg.epm_empresas.find(x => x.startsWith(sug + '|')) || sug).replace('|', ' · '))}` : `— padrão: ${esc(cfg.epm_padrao)} —`}</option>
              ${cfg.epm_empresas.map(x => { const [cod, nome] = x.split('|'); return `<option value="${esc(cod)}" ${cfg.mapa_empresa[f] === cod ? 'selected' : ''}>${esc(cod)} · ${esc(nome || '')}</option>`; }).join('')}</select></td></tr>`;
          }).join('')}</tbody></table></div>`}
        ${(() => {
          if (!cfg.epm_ccs.length) return '';
          const conhecidos = new Set(cfg.epm_ccs);
          const fora = [...new Set(linhasContabeis(cfg, true).map(l => l.ccEpm))].filter(x => !conhecidos.has(x));
          return fora.length ? `<p class="aviso-ajuste" style="margin:.8rem 0 0">⚠️ ${fora.length} centro(s) de custo do relatório não estão na lista do EPM: ${fora.slice(0, 20).map(esc).join(', ')}${fora.length > 20 ? '…' : ''}</p>` : '';
        })()}
      </details>
    </section>

    <section class="cartao" style="margin-top:1.2rem">
      <div class="ferramentas" style="margin-bottom:.8rem"><h3 style="margin:0">Prévia · ${esc(escopo)} <small>· ${linhas.length} linha(s) · ${colabs.length} colaborador(es)</small></h3>
        <div class="segmentos" id="ct-formato"><button data-f="contabil" class="${E.contabil.formato !== 'epm' ? 'ativo' : ''}">Contabilidade</button><button data-f="epm" class="${E.contabil.formato === 'epm' ? 'ativo' : ''}">EPM</button></div>
        <span class="direita" style="display:flex;gap:1rem;flex-wrap:wrap"><label class="check" title="Desmarque para gerar no formato original da contabilidade (somado por centro de custo e conta)"><input type="checkbox" id="ct-filial" ${E.contabil.porFilial ? 'checked' : ''}> colunas de regional e filial</label><label class="check"><input type="checkbox" id="ct-zeradas" ${E.contabil.zeradas ? 'checked' : ''}> incluir linhas zeradas</label></span></div>
      ${E.contabil.formato === 'epm' ? (() => {
        const epm = linhasContabeis(cfg, true);
        const fy = `FY${ano.slice(-2)}`;
        return `<div class="tabela-wrap alta"><table class="tabela tabela-contabil"><thead>
          <tr><th>Código Empresa</th><th>Centro_Custo</th><th>Conta Contábil</th>${MESES.map(() => `<th class="n">${fy}</th>`).join('')}</tr>
          <tr><th></th><th></th><th></th>${MESES.map(m => `<th class="n">${m}</th>`).join('')}</tr>
          <tr><th></th><th></th><th></th>${MESES.map(() => `<th class="n">Budget_${ano}</th>`).join('')}</tr>
          <tr><th></th><th></th><th></th>${MESES.map(() => '<th class="n">Trabalho</th>').join('')}</tr></thead>
          <tbody>${epm.slice(0, 400).map(l => `<tr><td>${esc(l.empresa)}</td><td>${esc(l.ccEpm)}</td><td>${esc(l.contaEpm)}</td>${[...l.meses].map(v => `<td class="n">${Math.abs(v) >= 0.005 ? num2.format(v) : '-'}</td>`).join('')}</tr>`).join('')
            || '<tr><td colspan="15" class="vazio">Nada para mostrar com esses filtros.</td></tr>'}</tbody></table></div>
          ${epm.length > 400 ? `<p class="subtitulo" style="margin:.6rem 0 0">Mostrando 400 de ${epm.length} linhas — o Excel traz todas.</p>` : ''}`;
      })() : `
      <div class="tabela-wrap alta"><table class="tabela tabela-contabil"><thead><tr>${E.contabil.porFilial ? '<th>Regional</th><th>Filial</th>' : ''}<th>Pacote</th><th>Centro de Custo</th><th>Conta Contábil</th><th>Terceiro</th>${meses.map(m => `<th class="n">${m}</th>`).join('')}</tr></thead>
      <tbody>${linhas.slice(0, 400).map(l => `<tr>${E.contabil.porFilial ? `<td>${esc(l.regional)}</td><td>${esc(l.filial)}</td>` : ''}<td>${esc(l.pacote)}</td><td>${esc(l.cc)}</td><td>${esc(l.conta)}</td><td>${esc(cfg.terceiro)}</td>${[...l.meses].map(v => `<td class="n">${Math.round(v) ? num0.format(Math.round(v)) : '-'}</td>`).join('')}</tr>`).join('')
        || '<tr><td colspan="18" class="vazio">Nada para mostrar com esses filtros.</td></tr>'}</tbody></table></div>
      ${linhas.length > 400 ? `<p class="subtitulo" style="margin:.6rem 0 0">Mostrando 400 de ${linhas.length} linhas — o Excel traz todas.</p>` : ''}`}
    </section>`;

  const salvar = async parcial => {
    try { E.contabil.cfg = await api('/api/contabil', { method: 'PUT', body: parcial }); renderContabil(); } catch (e) { toast(e.message, 'erro'); }
  };
  $('#ct-pacotes', el).addEventListener('change', e => {
    const pacotes = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
    if (pacotes.length < 3) return toast('Informe pelo menos os pacotes de pessoal, benefícios e provisões trabalhistas (nessa ordem).', 'erro');
    salvar({ pacotes });
  });
  $$('[data-pacote]', el).forEach(s => s.addEventListener('change', () => salvar({ mapa_pacotes: { ...cfg.mapa_pacotes, [s.dataset.pacote]: s.value } })));
  $('#ct-terceiro', el).addEventListener('change', e => salvar({ terceiro: e.target.value }));
  $$('[data-ccrub]', el).forEach(s => s.addEventListener('change', () => salvar({ cc_rubricas: { ...cfg.cc_rubricas, [s.dataset.ccrub]: s.value || '-' } })));
  $('#ct-zeradas', el).addEventListener('change', e => { E.contabil.zeradas = e.target.checked; renderContabil(); });
  $('#ct-filial', el).addEventListener('change', e => { E.contabil.porFilial = e.target.checked; renderContabil(); });
  $$('[data-cc]', el).forEach(s => s.addEventListener('change', () => {
    const mapa = { ...cfg.mapa_cc };
    if (s.value) mapa[s.dataset.cc] = s.value; else delete mapa[s.dataset.cc];
    salvar({ mapa_cc: mapa });
  }));
  $$('[data-rub]', el).forEach(s => s.addEventListener('change', () => {
    const mapa = { ...cfg.mapa_rubricas };
    // "não enviar" fica guardado como '-' para não voltar à sugestão automática
    mapa[s.dataset.rub] = s.value || '-';
    salvar({ mapa_rubricas: mapa });
  }));
  $('#ct-listas', el).addEventListener('change', e => e.target.files[0] && importarListasContabeis(e.target.files[0]));
  $('#ct-baixar', el).addEventListener('click', () => baixarContabil(cfg));
  $('#ct-baixar-epm', el).addEventListener('click', () => baixarEpm(cfg));
  $$('#ct-formato button', el).forEach(b => b.addEventListener('click', () => { E.contabil.formato = b.dataset.f; renderContabil(); }));
  $('#ct-epm', el).addEventListener('change', e => e.target.files[0] && importarCodigosEpm(e.target.files[0]));
  $('#ct-epm-padrao', el).addEventListener('change', e => salvar({ epm_padrao: e.target.value.trim() }));
  $('#ct-epm-unico', el).addEventListener('change', e => salvar({ epm_unico: e.target.checked }));
  $$('[data-emp]', el).forEach(s => s.addEventListener('change', () => {
    const mapa = { ...cfg.mapa_empresa };
    if (s.value) mapa[s.dataset.emp] = s.value; else delete mapa[s.dataset.emp];
    salvar({ mapa_empresa: mapa });
  }));
}

/** Planilha do EPM: abas "Empresa" (EMP_2197 | 2197 - UTE Cuiaba) e "Centro de Custo" (CC_17093 | 17093 - RH). */
async function importarCodigosEpm(arquivo) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const ler = (teste, prefixo) => {
    const aba = wb.SheetNames.find(n => teste(normCab(n)));
    if (!aba) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: null })
      .map(l => [String(l?.[0] ?? '').trim(), String(l?.[1] ?? '').trim()]).filter(([cod]) => cod.toUpperCase().startsWith(prefixo));
  };
  const emp = ler(n => n.startsWith('EMPRESA'), 'EMP_');
  const ccs = ler(n => n.startsWith('CENTRO'), 'CC_');
  if (!emp && !ccs) return toast('Não encontrei as abas "Empresa" e "Centro de Custo" com códigos EMP_ e CC_.', 'erro');
  const body = {};
  if (emp) body.epm_empresas = emp.map(([c, n]) => `${c}|${n}`);
  if (ccs) body.epm_ccs = ccs.map(([c]) => c.toUpperCase());
  E.contabil.cfg = await api('/api/contabil', { method: 'PUT', body });
  E.contabil.formato = 'epm';
  toast(`Códigos EPM importados: ${emp?.length ?? 0} empresas e ${ccs?.length ?? 0} centros de custo.`);
  renderContabil();
}

/** Arquivo no formato EPM: Código Empresa · Centro_Custo (CC_…) · Conta Contábil (DRE_…) · Jan…Dez, com 4 linhas de cabeçalho. */
function baixarEpm(cfg) {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const ano = String(E.dados.config.ano);
  const fy = `FY${ano.slice(-2)}`;
  const linhas = linhasContabeis(cfg, true);
  const aoa = [
    ['Código Empresa', 'Centro_Custo', 'Conta Contábil', ...MESES.map(() => fy)],
    ['', '', '', ...MESES],
    ['', '', '', ...MESES.map(() => `Budget_${ano}`)],
    ['', '', '', ...MESES.map(() => 'Trabalho')],
    ...linhas.map(l => [l.empresa, l.ccEpm, l.contaEpm, ...[...l.meses].map(v => Math.round(v * 100) / 100)]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 4; r < aoa.length; r++) for (let c = 3; c < 15; c++) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = '#,##0.00';
  }
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 16 }, ...MESES.map(() => ({ wch: 13 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EPM');
  const nome = [ano, E.filtro.regional, E.filtro.uf, E.filtro.filial].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Orcamento-EPM-${nome}.xlsx`);
}

async function importarListasContabeis(arquivo) {
  if (!window.XLSX) return toast('Carregando o leitor de Excel… tente de novo.', 'erro');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  const coluna = teste => {
    const aba = wb.SheetNames.find(n => teste(normCab(n)));
    if (!aba) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: false, defval: null }).map(l => String(l?.[0] ?? '').trim())
      .filter(v => v && !/^(CONTA CONTABIL|CENTRO DE CUSTO)$/.test(normCab(v)));
  };
  const contas = coluna(n => n.startsWith('CONTA'));
  const ccs = coluna(n => n.startsWith('CENTRO'));
  if (!contas && !ccs) return toast('Não encontrei as abas "Conta contabil" e "Centro de Custo Contabil".', 'erro');
  const body = {};
  if (contas) body.contas = contas;
  if (ccs) {
    body.ccs = ccs;
    const na = ccs.find(c => /^N\/?A/i.test(c));
    if (na) body.cc_padrao = na;
  }
  E.contabil.cfg = await api('/api/contabil', { method: 'PUT', body });
  toast(`Listas importadas: ${contas?.length ?? 0} contas e ${ccs?.length ?? 0} centros de custo.`);
  renderContabil();
}

function baixarContabil(cfg) {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const ano = String(E.dados.config.ano);
  const meses = MESES.map(m => `${m}/${ano.slice(-2)}`);
  const linhas = linhasContabeis(cfg);
  const pf = E.contabil.porFilial;
  const ini = pf ? 6 : 4; // primeira coluna de mês
  const aoa = [[...(pf ? ['Regional', 'Filial'] : []), 'Pacote', 'Centro de Custo', 'Conta Contábil', 'Terceiro', ...meses],
    ...linhas.map(l => [...(pf ? [l.regional, l.filial] : []), l.pacote, l.cc, l.conta, cfg.terceiro, ...[...l.meses].map(v => Math.round(v * 100) / 100)])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Formato da contabilidade: milhar sem centavos e "-" no zero
  for (let r = 1; r < aoa.length; r++) for (let c = ini; c < ini + 12; c++) {
    const ref = XLSX.utils.encode_cell({ r, c });
    if (ws[ref]) ws[ref].z = '#,##0;-#,##0;"-"';
  }
  ws['!cols'] = [...(pf ? [{ wch: 16 }, { wch: 26 }] : []), { wch: 12 }, { wch: 46 }, { wch: 56 }, { wch: 14 }, ...meses.map(() => ({ wch: 12 }))];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: ini + 11 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pessoal');
  const nome = [ano, E.filtro.regional, E.filtro.uf, E.filtro.filial].filter(Boolean).join('-').replace(/[^\w-]+/g, '_');
  XLSX.writeFile(wb, `Orcamento-Contabil-${nome}.xlsx`);
}

// ---------- Outros lançamentos (custos fora dos colaboradores) ----------

const RUBS_LANC = RUBRICAS.filter(r => !r.fixa && r.grupo !== 'encargos');
const nomeItemLanc = id => (id === 'outras' ? 'Outra conta' : RUBRICAS[IDX[id]]?.nome || id);
const noFiltroLanc = l => (l.regional === '*' || noSel('regional', l.regional)) && noSel('filial', l.filial)
  && (!l.filial || bateUf(l.filial)) && noSel('cc', String(l.cc_cod || ''));
const regionalLanc = l => (l.regional === '*' ? 'Todas as regionais (Brasil)' : l.regional);
const filialLanc = l => l.filial || (l.dividir === 'hc' ? `Todas as filiais${l.regional === '*' ? '' : ' da regional'} · por headcount` : l.regional === '*' ? '— empresa (valor único) —' : '— só a regional —');
const somaMeses = l => (l.meses || []).reduce((a, b) => a + (Number(b) || 0), 0);
const ccDoLanc = l => l.cc_contabil || [l.cc_cod, l.cc_nome].filter(Boolean).join(' · ') || '—';

async function renderLancamentos() {
  const el = painel('lancamentos');
  if (!E.contabil.cfg) E.contabil.cfg = await api('/api/contabil');
  const cfg = E.contabil.cfg;
  const lista = (E.dados.lancamentos || []).filter(noFiltroLanc);
  const totMes = MESES.map((_, m) => lista.reduce((a, l) => a + (Number(l.meses?.[m]) || 0), 0));
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Outros <em>lançamentos</em></h1>
      <p class="subtitulo">Custos que não são de um colaborador: consultorias, Gupy, uma rescisão prevista num centro de custo em um mês, etc. Escolha a regional, a filial, o centro de custo, o item ou a conta contábil e o valor de cada mês. Os valores entram no Painel, na Simulação e no Relatório contábil.</p></div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn-claro" id="lanc-excel">⬇ Excel / modelo</button>
        <label class="btn btn-claro" style="cursor:pointer">⬆ Importar Excel<input type="file" id="lanc-importar" accept=".xlsx,.xls" hidden></label>
        <button class="btn btn-laranja" id="lanc-novo">+ Novo lançamento</button></div></div>
    <section class="cartao">
      ${lista.length ? `<div class="tabela-wrap alta"><table class="tabela tabela-lanc"><thead><tr><th class="fixa">Descrição</th><th>Filial</th><th>Centro de custo</th><th>Item / conta contábil</th><th>Pacote</th>
        ${MESES.map(m => `<th class="n">${m}</th>`).join('')}<th class="n">Total ano</th><th></th></tr></thead>
        <tbody>${lista.map(l => `<tr data-lanc="${l.id}">
          <td class="fixa" title="${esc(l.descricao)}">${esc(l.descricao)}<span class="sub">${esc(regionalLanc(l))}</span></td>
          <td>${esc(filialLanc(l))}</td><td>${esc(ccDoLanc(l))}</td>
          <td>${esc(nomeItemLanc(l.rubrica))}<span class="sub">${esc(l.conta || contaDoItem2(cfg, l.rubrica) || '— sem conta —')}</span></td>
          <td>${esc(l.pacote || pacoteDoItem(cfg, l.rubrica))}</td>
          ${MESES.map((_, m) => { const v = Number(l.meses?.[m]) || 0; return `<td class="n${v ? '' : ' zero'}">${v ? num2.format(v) : '–'}</td>`; }).join('')}
          <td class="n"><b>${num2.format(somaMeses(l))}</b></td>
          <td><span class="acoes"><button class="btn-ic" data-editar title="Editar">✏️</button><button class="btn-ic" data-apagar title="Remover">🗑</button></span></td></tr>`).join('')}</tbody>
        <tfoot><tr class="total"><td class="fixa">Total · ${lista.length} lançamento(s)</td><td></td><td></td><td></td><td></td>${totMes.map(v => `<td class="n">${num2.format(v)}</td>`).join('')}<td class="n">${num2.format(totMes.reduce((a, b) => a + b, 0))}</td><td></td></tr></tfoot></table></div>`
      : `<div class="vazio"><span>📌</span><h3>Nenhum lançamento${temFiltroTopo() ? ' com esses filtros' : ''}</h3><p>Use <b>+ Novo lançamento</b> ou importe vários de uma vez pelo Excel (o botão <b>⬇ Excel / modelo</b> baixa o modelo).</p></div>`}
    </section>`;
  $('#lanc-novo', el).addEventListener('click', () => editarLancamento(null));
  $('#lanc-excel', el).addEventListener('click', () => baixarLancamentos(cfg, lista));
  $('#lanc-importar', el).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarLancamentos(f); });
  $$('[data-lanc]', el).forEach(tr => {
    const l = E.dados.lancamentos.find(x => x.id === Number(tr.dataset.lanc));
    tr.querySelector('[data-editar]').addEventListener('click', () => editarLancamento(l));
    tr.querySelector('[data-apagar]').addEventListener('click', async () => {
      if (!confirm(`Remover o lançamento "${l.descricao}"?`)) return;
      try { await api(`/api/lancamentos/${l.id}`, { method: 'DELETE' }); toast('Lançamento removido.'); await recarregarTudo(); } catch (e) { toast(e.message, 'erro'); }
    });
  });
}

async function recarregarTudo() {
  await carregar();
  renderAba();
}

/** Centro de custo digitado/escolhido → { cc_cod, cc_nome, cc_contabil }. Aceita "17093 · NOME", "25506 - NOME" (lista contábil) ou só o código. */
function lerCcLanc(txt, cfg) {
  const t = String(txt || '').trim();
  if (!t) return { cc_cod: '', cc_nome: '', cc_contabil: '' };
  const contabil = cfg.ccs.find(c => c === t) || (/ - /.test(t) ? t : '');
  if (contabil) { const [cod, ...nome] = contabil.split(' - '); return { cc_cod: cod.trim(), cc_nome: nome.join(' - ').trim(), cc_contabil: contabil }; }
  const [cod, ...nome] = t.split(' · ');
  const daBase = E.dados.colaboradores.find(c => String(c.cc_cod || '') === cod.trim());
  return { cc_cod: cod.trim(), cc_nome: nome.join(' · ').trim() || daBase?.cc_nome || '', cc_contabil: '' };
}

function editarLancamento(l) {
  const cfg = E.contabil.cfg;
  const a = l || { descricao: '', regional: E.filtro.regional || regionais()[0] || '', filial: E.filtro.filial || '', cc_cod: E.filtro.cc || '', cc_nome: '', cc_contabil: '', rubrica: 'outras', conta: '', pacote: '', meses: Array(12).fill(0), dividir: 'hc' };
  const ccsBase = [...new Map(E.dados.colaboradores.map(c => [String(c.cc_cod || ''), rotuloCc(c)])).values()].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true }));
  const ccAtual = a.cc_contabil || (a.cc_cod ? [a.cc_cod, a.cc_nome].filter(Boolean).join(' · ') : '');
  const d = abrirModal({
    titulo: l ? 'Editar lançamento' : 'Novo lançamento', sup: 'OUTROS LANÇAMENTOS', largo: true,
    corpo: `<form class="form-grade" id="form-lanc">
      <label class="rotulo inteiro">Descrição<input class="campo" name="descricao" value="${esc(a.descricao)}" placeholder="ex.: Consultoria de cargos e salários · Gupy · Rescisão prevista" required></label>
      <label class="rotulo">Regional<select class="campo" name="regional"><option value="*" ${a.regional === '*' ? 'selected' : ''}>★ Todas as regionais (Brasil)</option>${regionais().map(r => `<option ${r === a.regional ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="rotulo">Filial<select class="campo" name="filial"></select></label>
      <label class="rotulo inteiro" id="box-dividir">Sem filial: como entra<select class="campo" name="dividir">
        <option value="hc" ${a.dividir === 'hc' ? 'selected' : ''}>Dividir entre as filiais pelo headcount (cada unidade fica com a sua parte)</option>
        <option value="" ${a.dividir !== 'hc' ? 'selected' : ''}>Valor único, sem filial (fica no nível da regional / empresa)</option></select>
        <small>Ex.: Gupy para o Brasil todo → "Todas as regionais" + "Dividir pelo headcount": cada filial recebe a parte proporcional às pessoas em cada mês.</small></label>
      <label class="rotulo">Centro de custo<input class="campo" name="cc" list="lanc-ccs" value="${esc(ccAtual)}" placeholder="digite o código ou escolha na lista">
        <datalist id="lanc-ccs">${[...ccsBase, ...cfg.ccs].map(c => `<option value="${esc(c)}">`).join('')}</datalist><small>Lista com os CCs da base e os da contabilidade (ex.: 25506).</small></label>
      <label class="rotulo">Item<select class="campo" name="rubrica"><option value="outras" ${a.rubrica === 'outras' ? 'selected' : ''}>Outra conta (escolha a conta contábil)</option>
        ${GRUPOS.filter(g => g.id !== 'encargos').map(g => `<optgroup label="${g.nome}">${RUBS_LANC.filter(r => r.grupo === g.id && !r.soLancamento).map(r => `<option value="${r.id}" ${r.id === a.rubrica ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="rotulo">Conta contábil<input class="campo" name="conta" list="lanc-contas" value="${esc(a.conta)}">
        <datalist id="lanc-contas">${(cfg.contas.length ? cfg.contas : Object.values(CONTA_SUGERIDA)).map(c => `<option value="${esc(c)}">`).join('')}</datalist><small id="lanc-conta-dica"></small></label>
      <label class="rotulo">Pacote<select class="campo" name="pacote"><option value="">— o do item —</option>${cfg.pacotes.map(p => `<option ${p === a.pacote ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      <div class="inteiro meses-box">
        <b>Valor de cada mês (R$)</b>
        <div class="lanc-preencher">Preencher: <input class="campo" id="lanc-v" type="number" step="any" placeholder="valor" style="width:130px">
          <select class="campo" id="lanc-modo" style="width:auto"><option value="mes">só no mês</option><option value="todos">em todos os meses</option><option value="ano">total do ano ÷ 12</option></select>
          <select class="campo" id="lanc-mes" style="width:90px">${opcoesMes(1)}</select><button type="button" class="btn btn-claro btn-sm" id="lanc-aplicar">Aplicar</button></div>
        <div class="meses-grade">${MESES.map((nm, i) => `<label>${nm}<input class="campo" type="number" step="any" data-mesl="${i}" value="${Number(a.meses?.[i]) || ''}" placeholder="0"></label>`).join('')}</div>
        <div class="meses-colar"><input class="campo" id="lanc-colar" placeholder="Ou cole aqui a linha do Excel com os 12 valores (Jan a Dez)"><small id="lanc-total"></small></div>
      </div></form>`,
    rodape: `<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="lanc-salvar">Salvar</button>`,
  });
  const f = $('#form-lanc', d);
  const montarFiliais = () => {
    const todas = f.regional.value === '*';
    f.filial.innerHTML = `<option value="">${todas ? '— todas as filiais —' : '— sem filial (regional) —'}</option>${todas ? '' : filiaisDa(f.regional.value).map(x => `<option ${x === a.filial ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
    $('#box-dividir', d).hidden = Boolean(f.filial.value);
  };
  montarFiliais();
  f.regional.addEventListener('change', () => { a.filial = ''; montarFiliais(); });
  f.filial.addEventListener('change', () => { $('#box-dividir', d).hidden = Boolean(f.filial.value); });
  const dicaConta = () => { $('#lanc-conta-dica', d).textContent = f.rubrica.value === 'outras' ? 'Obrigatória em "Outra conta".' : `Vazia = conta do item (${contaDoItem2(cfg, f.rubrica.value) || 'sem conta'}).`; };
  dicaConta();
  f.rubrica.addEventListener('change', dicaConta);
  const campos = $$('[data-mesl]', d);
  const total = () => { $('#lanc-total', d).textContent = `Total no ano: ${brl.format(campos.reduce((s2, i) => s2 + (Number(i.value) || 0), 0))}`; };
  campos.forEach(i => i.addEventListener('input', total));
  total();
  const modo = $('#lanc-modo', d);
  modo.addEventListener('change', () => { $('#lanc-mes', d).hidden = modo.value !== 'mes'; });
  $('#lanc-aplicar', d).addEventListener('click', () => {
    const v = Number($('#lanc-v', d).value) || 0;
    if (modo.value === 'mes') campos[Number($('#lanc-mes', d).value) - 1].value = v || '';
    else campos.forEach(i => { i.value = (modo.value === 'ano' ? Math.round((v / 12) * 100) / 100 : v) || ''; });
    total();
  });
  $('#lanc-colar', d).addEventListener('input', e => {
    const vals = e.target.value.trim().split(/\t|;|\s{2,}/).map(x => Number(String(x).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
    if (vals.length >= 12) { campos.forEach((i, k) => { i.value = vals[k] || ''; }); e.target.value = ''; total(); }
  });
  $('#lanc-salvar', d).addEventListener('click', async () => {
    const body = {
      descricao: f.descricao.value.trim(), regional: f.regional.value, filial: f.filial.value, ...lerCcLanc(f.cc.value, cfg),
      rubrica: f.rubrica.value, conta: f.conta.value.trim(), pacote: f.pacote.value, meses: campos.map(i => Number(i.value) || 0),
      dividir: f.filial.value ? '' : f.dividir.value,
    };
    if (!body.descricao) return toast('Informe a descrição.', 'erro');
    if (body.rubrica === 'outras' && !body.conta) return toast('Em "Outra conta", informe a conta contábil.', 'erro');
    if (!body.meses.some(Boolean)) return toast('Informe o valor de pelo menos um mês.', 'erro');
    try {
      await api(l ? `/api/lancamentos/${l.id}` : '/api/lancamentos', { method: l ? 'PUT' : 'POST', body });
      d.close(); toast('Lançamento salvo.'); await recarregarTudo();
    } catch (e) { toast(e.message, 'erro'); }
  });
}

const COL_LANC = ['Descrição', 'Regional', 'Filial', 'Distribuição', 'Cód. C. Custo', 'Centro de custo', 'CC contábil', 'Item', 'Conta contábil', 'Pacote', ...MESES, 'Total ano'];

function baixarLancamentos(cfg, lista) {
  if (!window.XLSX) return toast('Carregando o gerador de Excel… tente de novo.', 'erro');
  const linhas = lista.length ? lista.map(l => [l.descricao, l.regional === '*' ? 'TODAS' : l.regional, l.filial, l.dividir === 'hc' ? 'HC' : '', l.cc_cod, l.cc_nome, l.cc_contabil, nomeItemLanc(l.rubrica), l.conta, l.pacote, ...MESES.map((_, m) => Number(l.meses?.[m]) || 0), somaMeses(l)])
    : [['Consultoria de cargos e salários', regionais()[0] || 'SUDESTE', '', '', '17093', 'RECURSOS HUMANOS', '', 'Outra conta', cfg.contas[0] || '', '', 0, 0, 15000, 0, 0, 0, 0, 0, 15000, 0, 0, 0, 30000],
       ['Gupy (licença)', 'TODAS', '', 'HC', '17093', 'RECURSOS HUMANOS', '', 'Outra conta', cfg.contas[0] || '', '', ...Array(12).fill(2500), 30000],
       ['Rescisão prevista', regionais()[0] || 'SUDESTE', filiaisDa(regionais()[0])[0] || '', '', '17150', 'OPERAÇÃO', '', 'Rescisão', '', '', 0, 0, 0, 0, 0, 0, 25000, 0, 0, 0, 0, 0, 25000]];
  const ws = XLSX.utils.aoa_to_sheet([COL_LANC, ...linhas]);
  ws['!cols'] = [34, 16, 22, 13, 12, 24, 30, 20, 40, 16, ...MESES.map(() => 11), 12].map(wch => ({ wch }));
  const ajuda = XLSX.utils.aoa_to_sheet([
    ['Coluna', 'O que colocar'],
    ['Descrição', 'Obrigatória. Ex.: Consultoria X, Gupy, Rescisão prevista'],
    ['Regional', 'Obrigatória, igual à da base (ex.: NORTE). TODAS = todas as regionais (nível Brasil)'],
    ['Filial', 'Opcional. Vazio = sem filial (veja Distribuição)'],
    ['Distribuição', 'Só quando a Filial está vazia. HC = dividir entre as filiais (da regional, ou de todas se a Regional for TODAS) pelo headcount de cada mês. Vazio = valor único, sem filial'],
    ['Cód. C. Custo / Centro de custo', 'Código e nome do centro de custo da base (ex.: 17093 · RECURSOS HUMANOS)'],
    ['CC contábil', 'Opcional. Centro de custo da contabilidade, como está na lista (ex.: 25506 - TRANSPORTE CONTRATADO/MOBILIDADE). Se preenchido, vale no relatório contábil'],
    ['Item', `Um item da ferramenta (ex.: Rescisão, Treinamento, Viagens) ou "Outra conta". Itens: ${RUBS_LANC.filter(r => !r.soLancamento).map(r => r.nome).join(', ')}`],
    ['Conta contábil', 'Obrigatória em "Outra conta" (ex.: a conta de consultorias). Vazia nos demais = conta do item'],
    ['Pacote', `Opcional: ${cfg.pacotes.join(', ')}. Vazio = o do item`],
    ['Jan … Dez', 'Valor de cada mês em R$'],
  ]);
  ajuda['!cols'] = [{ wch: 30 }, { wch: 110 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos');
  XLSX.utils.book_append_sheet(wb, ajuda, 'Como preencher');
  XLSX.writeFile(wb, `Outros-lancamentos-${E.dados.config.ano}.xlsx`);
}

async function importarLancamentos(arquivo) {
  try {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const l = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const h = l.findIndex(r => (r || []).some(c => normCab(c) === 'DESCRICAO'));
    if (h < 0) return toast('Não encontrei a coluna "Descrição". Use o modelo do botão ⬇ Excel / modelo.', 'erro');
    const cab = l[h].map(normCab);
    const col = nome => cab.indexOf(normCab(nome));
    const porNome = new Map(RUBRICAS.filter(r => !r.fixa).map(r => [chaveNome(r.nome), r.id]));
    porNome.set(chaveNome('Outra conta'), 'outras');
    const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0);
    const txt = v => String(v ?? '').trim();
    const linhas = l.slice(h + 1).filter(r => r && txt(r[col('Descrição')])).map(r => ({
      descricao: txt(r[col('Descrição')]), regional: txt(r[col('Regional')]), filial: txt(r[col('Filial')]), dividir: col('Distribuição') >= 0 ? txt(r[col('Distribuição')]) : '',
      cc_cod: txt(r[col('Cód. C. Custo')]), cc_nome: txt(r[col('Centro de custo')]), cc_contabil: txt(r[col('CC contábil')]),
      rubrica: porNome.get(chaveNome(r[col('Item')])) || 'outras', conta: txt(r[col('Conta contábil')]), pacote: txt(r[col('Pacote')]),
      meses: MESES.map(m => num(r[col(m)])),
    }));
    if (!linhas.length) return toast('Nenhuma linha preenchida no arquivo.', 'erro');
    const substituir = confirm(`${linhas.length} lançamento(s) no arquivo.\n\nOK = substituir TODOS os lançamentos atuais por estes\nCancelar = adicionar aos que já existem`);
    const r = await api('/api/lancamentos/importar', { method: 'POST', body: { linhas, substituir } });
    toast(`${r.importados} lançamento(s) importado(s).${r.erros.length ? ` ${r.erros.length} linha(s) com erro.` : ''}`, r.erros.length ? 'erro' : undefined);
    await recarregarTudo();
  } catch (e) { toast(e.message || 'Não consegui ler o arquivo.', 'erro'); }
}

// ---------- Coordenadores ----------

async function renderCoordenadores() {
  const el = painel('coordenadores');
  const usuarios = await api('/api/usuarios');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Acessos dos <em>coordenadores</em></h1>
      <p class="subtitulo">Cada pessoa entra em <b>${esc(location.origin)}</b> com o login e a senha criados aqui e vê apenas as regionais liberadas, sem poder alterar valores. <b>Coordenador de RH</b>: painel, simulação, conferência e pedidos de ajuste. <b>Somente visualização</b> (ex.: gerente): painel e simulação, sem conferência nem pedidos.</p></div>
      <button class="btn btn-laranja" id="novo-usuario">+ Novo acesso</button></div>
    <section class="cartao"><div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Regionais</th><th>Último acesso</th><th>Status</th><th></th></tr></thead>
      <tbody>${usuarios.map(u => `<tr><td><b>${esc(u.nome)}</b></td><td>${esc(u.login)}</td><td>${u.perfil === 'leitura' ? '<span class="etiqueta azul">👁 Somente visualização</span>' : '<span class="etiqueta neutra">Coordenador de RH</span>'}</td><td>${u.regionais.map(r => `<span class="chip">${esc(r === '*' ? 'Todas as regionais' : r)}</span>`).join(' ')}</td>
        <td>${u.ultimo_acesso ? dataBr(u.ultimo_acesso) : '<span class="sub" style="display:inline">nunca</span>'}</td>
        <td>${u.ativo ? '<span class="etiqueta ok">Ativo</span>' : '<span class="etiqueta neutra">Bloqueado</span>'}</td>
        <td><span class="acoes"><button class="btn-ic" data-editar="${u.id}" title="Editar">✎</button><button class="btn-ic" data-remover="${u.id}" title="Remover">🗑</button></span></td></tr>`).join('')
        || '<tr><td colspan="7"><div class="vazio"><span>🔑</span>Nenhum coordenador cadastrado ainda.</div></td></tr>'}</tbody></table></div></section>`;
  $('#novo-usuario', el).addEventListener('click', () => editarUsuario(null));
  $$('[data-editar]', el).forEach(b => b.addEventListener('click', () => editarUsuario(usuarios.find(u => u.id === Number(b.dataset.editar)))));
  $$('[data-remover]', el).forEach(b => b.addEventListener('click', async () => {
    const u = usuarios.find(x => x.id === Number(b.dataset.remover));
    if (!confirm(`Remover o acesso de ${u.nome}? Os pedidos enviados por ele continuam no histórico.`)) return;
    await api(`/api/usuarios/${u.id}`, { method: 'DELETE' });
    renderCoordenadores();
  }));
}

function editarUsuario(u) {
  const regs = [...new Set([...regionais(), ...(u?.regionais || [])])].filter(r => r !== '*');
  const todas = Boolean(u?.regionais.includes('*'));
  const d = abrirModal({
    titulo: u ? u.nome : 'Novo acesso de coordenador', sup: 'ACESSO',
    corpo: `<form class="form-grade" id="form-usuario">
      <label class="rotulo">Nome<input class="campo" name="nome" required value="${esc(u?.nome || '')}"></label>
      <label class="rotulo">Login<input class="campo" name="login" required value="${esc(u?.login || '')}" ${u ? 'readonly' : ''} placeholder="ex.: joao.silva"></label>
      <label class="rotulo inteiro">${u ? 'Nova senha <small>(deixe em branco para manter)</small>' : 'Senha inicial <small>(mín. 6 caracteres)</small>'}<input class="campo" name="senha" type="text" ${u ? '' : 'required minlength="6"'} autocomplete="new-password"></label>
      <label class="rotulo inteiro">Perfil<select class="campo" name="perfil">
        <option value="coordenador" ${u?.perfil !== 'leitura' ? 'selected' : ''}>Coordenador de RH · painel, simulação, conferência e pedidos de ajuste</option>
        <option value="leitura" ${u?.perfil === 'leitura' ? 'selected' : ''}>Somente visualização (ex.: gerente) · painel e simulação, sem conferência</option></select></label>
      <div class="inteiro rotulo">Regionais que pode ver
        <label class="check"><input type="checkbox" name="todas" ${todas ? 'checked' : ''}> <b>Todas as regionais</b> <small>(inclusive as que entrarem depois)</small></label>
        <div class="regionais-check" id="regs-lista" ${todas ? 'hidden' : ''}>${regs.map(r => `<label class="check"><input type="checkbox" name="regionais" value="${esc(r)}" ${u?.regionais.includes(r) ? 'checked' : ''}> ${esc(r)}</label>`).join('') || '<small>Importe a base para listar as regionais.</small>'}</div></div>
      ${u ? `<label class="check inteiro"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Acesso ativo</label>` : ''}
    </form>`,
    rodape: '<button class="btn btn-claro" data-fechar>Cancelar</button><button class="btn btn-laranja" id="salvar-usuario">Salvar</button>',
  });
  $('input[name="todas"]', d).addEventListener('change', e => { $('#regs-lista', d).hidden = e.target.checked; });
  $('#salvar-usuario', d).addEventListener('click', async () => {
    const f = $('#form-usuario', d);
    if (!f.reportValidity()) return;
    const body = { nome: f.nome.value, login: f.login.value, senha: f.senha.value, perfil: f.perfil.value,
      regionais: f.todas.checked ? ['*'] : $$('input[name="regionais"]:checked', f).map(i => i.value) };
    if (!body.regionais.length) return toast('Marque ao menos uma regional.', 'erro');
    if (u) body.ativo = f.ativo.checked;
    try {
      await api(u ? `/api/usuarios/${u.id}` : '/api/usuarios', { method: u ? 'PUT' : 'POST', body });
      d.close();
      renderCoordenadores();
      toast(u ? 'Acesso atualizado.' : `Acesso criado. Envie: login “${body.login}” e a senha definida.`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}

// ---------- Histórico ----------

async function renderHistorico() {
  const el = painel('historico');
  const hist = await api('/api/historico');
  el.innerHTML = `
    <div class="cab-pagina"><div><h1 class="titulo-pagina">Histórico de <em>alterações</em></h1>
      <p class="subtitulo">Últimas 300 ações registradas na ferramenta.</p></div><a class="btn btn-claro" href="/api/backup">⬇ Backup do banco</a></div>
    <section class="cartao"><div class="tabela-wrap alta"><table class="tabela">
      <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>${hist.map(h => `<tr><td>${dataBr(h.quando)}</td><td>${esc(h.quem)}</td><td><b>${esc(h.acao)}</b></td><td style="white-space:normal">${esc(h.detalhe || '')}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

// ---------- início ----------

function atualizarAno() {
  const ano = E.dados.config.ano;
  $('#grupo-ano').textContent = `ORÇAMENTO ${ano}`;
  $('#barra-ano').textContent = `ORÇAMENTO DE PESSOAL · ${ano}`;
  document.title = `Orçamento ${ano} · Âmbar`;
}

async function iniciar() {
  try {
    E.eu = await api('/api/eu');
  } catch {
    location.replace('index.html');
    return;
  }
  $$('.so-admin').forEach(x => { x.hidden = !E.eu.admin; });
  $$('.so-coord').forEach(x => { x.hidden = E.eu.admin; });
  if (E.eu.leitura) $$('.so-confere').forEach(x => { x.hidden = true; }); // somente visualização: sem conferência nem pedidos
  $('#u-nome').textContent = E.eu.nome;
  $('#u-papel').textContent = E.eu.admin ? 'Administrador' : `${E.eu.leitura ? 'Visualização' : 'Coordenador'} · ${E.eu.todas ? 'todas as regionais' : E.eu.regionais.join(', ')}`;
  $('#u-avatar').textContent = E.eu.nome.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  if (!E.eu.admin) $('#rot-solic').textContent = 'Meus pedidos';

  await Promise.all([carregar(), carregarSolicitacoes()]);
  atualizarAno();

  $$('.lateral-item[data-aba]').forEach(b => b.addEventListener('click', () => irPara(b.dataset.aba)));
  $('#btn-menu').addEventListener('click', () => $('#lateral').classList.toggle('aberta'));
  $('#sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.replace('index.html'); });
  window.addEventListener('beforeunload', e => {
    if (Object.keys(E.rascunho).length || Object.keys(E.prem.edits).length) { e.preventDefault(); e.returnValue = ''; }
  });

  const inicial = location.hash.slice(1);
  const permitido = b => b && !b.hidden;
  irPara(permitido($(`.lateral-item[data-aba="${inicial}"]`)) ? inicial : 'painel');
}

iniciar();
