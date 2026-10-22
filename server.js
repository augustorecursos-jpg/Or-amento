// Orçamento de Pessoal · Âmbar Energia
// API do admin (RH / orçamento) e dos coordenadores regionais (conferência e pedidos de ajuste) + arquivos estáticos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, DATA_DIR, registrar, sincronizarFiliais } = require('./db');
const Motor = require('./public/js/motor');

const PORT = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PRODUCAO ? null : 'ambar-orcamento');

const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(SECRET_FILE, 'utf8');
})();

if (!ADMIN_PASSWORD) {
  console.error('[erro] Em produção é obrigatório definir ADMIN_PASSWORD (senha do usuário admin).');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD não definido — usando a senha padrão "ambar-orcamento". Defina antes de publicar.');
}

const RUBRICAS_VALIDAS = new Set(Motor.RUBRICAS.filter(r => !r.fixa).map(r => r.id));
const STATUS_SOLIC = ['aberta', 'em_analise', 'ajustada', 'recusada'];

// ---------- utilitários ----------

function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  return `${sal}:${crypto.scryptSync(String(senha), sal, 64).toString('hex')}`;
}

function conferirSenha(senha, hash) {
  const [sal, h] = String(hash).split(':');
  if (!sal || !h) return false;
  const calc = crypto.scryptSync(String(senha), sal, 64);
  const esperado = Buffer.from(h, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

function iguaisSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

function verificar(token) {
  if (!token) return null;
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return payload;
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

const HORAS_SESSAO = 10;
function definirSessao(res, payload) {
  const token = assinar({ ...payload, exp: Date.now() + HORAS_SESSAO * 3600e3 });
  res.cookie('sess_orc', token, { httpOnly: true, sameSite: 'lax', maxAge: HORAS_SESSAO * 3600e3, secure: PRODUCAO });
}

/** Usuário da sessão: { admin: true, nome } ou o coordenador com a lista de regionais que pode ver. */
function usuarioDaSessao(req) {
  const s = verificar(lerCookies(req).sess_orc);
  if (!s) return null;
  if (s.admin) return { admin: true, nome: 'Administrador', login: 'admin', regionais: null };
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(s.uid);
  if (!u) return null;
  let regionais = JSON.parse(u.regionais || '[]');
  const todas = regionais.includes('*'); // '*' = todas as regionais, inclusive as que entrarem depois
  if (todas) regionais = db.prepare('SELECT DISTINCT regional FROM filiais ORDER BY regional').all().map(r => r.regional);
  return { admin: false, id: u.id, nome: u.nome, login: u.login, regionais, todas, leitura: u.perfil === 'leitura' };
}

/** Acesso somente de visualização (ex.: gerente): não confere filial nem envia pedidos. */
function bloquearLeitura(req, res) {
  if (!req.usuario.leitura) return false;
  res.status(403).json({ erro: 'Acesso somente para visualização.' });
  return true;
}

function exigirLogin(req, res, next) {
  const u = usuarioDaSessao(req);
  if (!u) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  req.usuario = u;
  next();
}

function exigirAdmin(req, res, next) {
  const u = usuarioDaSessao(req);
  if (!u || !u.admin) return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
  req.usuario = u;
  next();
}

/** Coordenador só enxerga as regionais liberadas para ele. */
function podeVerRegional(usuario, regional) {
  return usuario.admin || usuario.regionais.includes(regional);
}

function texto(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function mes(v, padrao) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 12 ? n : padrao;
}

function limparPremissa(p) {
  if (!p || typeof p !== 'object') return null;
  const metodo = Motor.METODOS[p.metodo] ? p.metodo : 'nao';
  return {
    metodo,
    valor: numero(p.valor),
    base: Motor.BASES[p.base] ? p.base : 'salario',
    periodo: Motor.PERIODOS[p.periodo] ? p.periodo : 'mensal',
    mes: mes(p.mes, 12),
    inicio: mes(p.inicio, 1),
    inicio2: p.inicio2 ? mes(p.inicio2, 0) : 0, // 2º mês de aumento (soma ao 1º daí em diante)
    rateio: p.rateio === 'salario' ? 'salario' : 'hc',
    dividir: p.dividir === 'escopo' ? 'escopo' : '',
    teto: p.teto === '' || p.teto == null ? null : numero(p.teto),
    por_nivel: Boolean(p.por_nivel),
    sem_dissidio: Boolean(p.sem_dissidio),
    meses: Array.from({ length: 12 }, (_, i) => numero(Array.isArray(p.meses) ? p.meses[i] : 0)),
    publico: ['F', 'M'].includes(p.publico) ? p.publico : '',
    publico_meses: Array.from({ length: 12 }, (_, i) => (Array.isArray(p.publico_meses) && ['F', 'M'].includes(p.publico_meses[i]) ? p.publico_meses[i] : '')),
    niveis: Object.fromEntries(Object.entries(p.niveis && typeof p.niveis === 'object' ? p.niveis : {})
      .filter(([k, v]) => texto(k) && v !== '' && v != null).slice(0, 100).map(([k, v]) => [texto(k, 120), numero(v)])),
    quem: (Array.isArray(p.quem) ? p.quem : []).map(q => texto(q, 200)).filter(q => /^(cc|cargo|funcao):/.test(q)).slice(0, 300),
    por_funcao: Object.fromEntries(Object.entries(p.por_funcao && typeof p.por_funcao === 'object' ? p.por_funcao : {})
      .filter(([k, v]) => texto(k) && v !== '' && v != null).slice(0, 200).map(([k, v]) => [texto(k, 120), numero(v)])),
    // Ao marcar "Não tem", guarda como era cobrado, para voltar igual se marcar "Sim" de novo.
    ultimo_metodo: Motor.METODOS[p.ultimo_metodo] && p.ultimo_metodo !== 'nao' ? p.ultimo_metodo : null,
  };
}

/** Grava as premissas de um escopo: { rubrica: premissa } (null = remove a regra própria e volta a herdar). */
function gravarPremissas(escopo, rubricas) {
  const gravar = db.prepare('INSERT INTO premissas (escopo, rubrica, dados) VALUES (?, ?, ?) ON CONFLICT(escopo, rubrica) DO UPDATE SET dados = excluded.dados');
  const apagar = db.prepare('DELETE FROM premissas WHERE escopo = ? AND rubrica = ?');
  let n = 0;
  for (const [id, p] of Object.entries(rubricas || {})) {
    if (!RUBRICAS_VALIDAS.has(id)) continue;
    const limpa = limparPremissa(p);
    if (limpa) gravar.run(escopo, id, JSON.stringify(limpa));
    else apagar.run(escopo, id);
    n++;
  }
  return n;
}

// Limite simples de tentativas de login com falha por IP.
const falhasLogin = new Map();
function bloqueado(ip) {
  const f = falhasLogin.get(ip);
  return f && f.n >= 8 && Date.now() - f.desde < 15 * 60e3;
}
function falhou(ip) {
  const f = falhasLogin.get(ip);
  if (!f || Date.now() - f.desde > 15 * 60e3) falhasLogin.set(ip, { n: 1, desde: Date.now() });
  else f.n++;
}

// ---------- app ----------

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ----- sessão -----

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (bloqueado(ip)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  const login = texto(req.body?.login, 80).toLowerCase();
  const senha = String(req.body?.senha ?? '');
  if (login === 'admin') {
    if (!iguaisSeguro(senha, ADMIN_PASSWORD)) { falhou(ip); return res.status(401).json({ erro: 'Usuário ou senha inválidos.' }); }
    definirSessao(res, { admin: true });
    return res.json({ ok: true });
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE login = ? AND ativo = 1').get(login);
  if (!u || !conferirSenha(senha, u.senha_hash)) { falhou(ip); return res.status(401).json({ erro: 'Usuário ou senha inválidos.' }); }
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(u.id);
  definirSessao(res, { uid: u.id });
  registrar(u.nome, 'Entrou', '');
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('sess_orc');
  res.json({ ok: true });
});

app.get('/api/eu', exigirLogin, (req, res) => {
  const { admin, nome, login, regionais, todas, leitura } = req.usuario;
  res.json({ admin, nome, login, regionais, todas: Boolean(todas), leitura: Boolean(leitura) });
});

// ----- dados do orçamento (base + premissas) -----

app.get('/api/dados', exigirLogin, (req, res) => {
  const u = req.usuario;
  const filtro = u.admin ? '' : `WHERE regional IN (${u.regionais.map(() => '?').join(',') || "''"})`;
  const params = u.admin ? [] : u.regionais;
  const colaboradores = db.prepare(`SELECT * FROM colaboradores ${filtro} ORDER BY regional, filial, nome`).all(...params)
    .map(c => ({ ...c, vaga: Boolean(c.vaga), excecoes: lerExcecoes(c.excecoes) }));
  const filiais = {};
  const comGente = new Set(colaboradores.map(c => c.filial));
  for (const f of db.prepare(`SELECT * FROM filiais ${filtro} ORDER BY regional, filial`).all(...params)) if (comGente.has(f.filial)) filiais[f.filial] = f;
  const premissas = {};
  for (const p of db.prepare('SELECT * FROM premissas').all()) {
    const visivel = u.admin || p.escopo === '*' || (p.escopo.startsWith('R:') ? u.regionais.includes(p.escopo.slice(2)) : filiais[p.escopo]);
    if (!visivel) continue;
    (premissas[p.escopo] ||= {})[p.rubrica] = JSON.parse(p.dados);
  }
  const niveis = Object.fromEntries(db.prepare('SELECT * FROM niveis ORDER BY nivel').all().map(n => [n.nivel, n.multiplo]));
  const config = Object.fromEntries(db.prepare('SELECT * FROM config').all().map(c => [c.chave, c.valor]));
  const todosLanc = db.prepare('SELECT * FROM lancamentos ORDER BY regional, filial, descricao').all().map(lerLancamentoDb);
  const visivel = reg => u.admin || u.regionais.includes(reg);
  // lancamentos = os cadastrados (para a tela); linhasLanc = o que entra no cálculo, já dividido entre as filiais
  const lancamentos = todosLanc.filter(l => l.regional === '*' || visivel(l.regional));
  // (o valor único da empresa, sem regional, só entra na visão do administrador)
  const linhasLanc = expandirLancamentos(todosLanc).filter(l => visivel(l.regional) || (u.admin && l.regional === '*'));
  const anterior = db.prepare(`SELECT * FROM ano_anterior ${filtro} ORDER BY regional, filial, nome`).all(...params)
    .map(a => ({ ...a, salarios: (() => { try { return JSON.parse(a.salarios); } catch { return []; } })() }));
  res.json({ config, colaboradores, filiais, premissas, niveis, lancamentos, linhasLanc, anterior });
});

// ----- ano anterior (histórico de salários por mês, para o comparativo) -----

app.post('/api/ano-anterior/importar', exigirAdmin, (req, res) => {
  const linhas = (Array.isArray(req.body?.linhas) ? req.body.linhas : []).map(b => ({
    matricula: texto(b.matricula, 40), nome: texto(b.nome, 160), regional: texto(b.regional, 80).toUpperCase(), filial: texto(b.filial, 120).toUpperCase(),
    funcao: texto(b.funcao, 160), cargo: texto(b.cargo, 120), cc_cod: texto(b.cc_cod, 40), cc_nome: texto(b.cc_nome, 160),
    salarios: Array.from({ length: 12 }, (_, i) => numero(Array.isArray(b.salarios) ? b.salarios[i] : 0)),
  })).filter(l => l.nome && l.regional && l.filial && l.salarios.some(v => v > 0));
  if (!linhas.length) return res.status(400).json({ erro: 'Nenhuma linha válida (nome, regional, filial e ao menos um mês com salário).' });
  const campos = ['matricula', 'nome', 'regional', 'filial', 'funcao', 'cargo', 'cc_cod', 'cc_nome', 'salarios'];
  const ins = db.prepare(`INSERT INTO ano_anterior (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM ano_anterior');
    linhas.forEach(l => ins.run(...campos.map(k => (k === 'salarios' ? JSON.stringify(l.salarios) : l[k]))));
    // Meses realizados (os seguintes foram projetados com o salário do último mês)
    const reais = Math.min(12, Math.max(1, Math.round(numero(req.body?.meses_reais)) || 12));
    db.prepare("INSERT INTO config (chave, valor) VALUES ('anterior_meses_reais', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(String(reais));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar('Administrador', 'Importou o histórico do ano anterior', `${linhas.length} colaborador(es)${Number(req.body?.meses_reais) < 12 ? ` · realizado até o mês ${Number(req.body.meses_reais)}, demais meses projetados` : ''}`);
  res.json({ ok: true, importados: linhas.length });
});

app.delete('/api/ano-anterior', exigirAdmin, (req, res) => {
  db.exec('DELETE FROM ano_anterior');
  db.prepare("DELETE FROM config WHERE chave = 'anterior_meses_reais'").run();
  registrar('Administrador', 'Apagou o histórico do ano anterior');
  res.json({ ok: true });
});

// ----- outros lançamentos (custos fora dos colaboradores) -----

const lerLancamentoDb = l => ({ ...l, meses: (() => { try { return JSON.parse(l.meses); } catch { return []; } })() });
const CAMPOS_LANC = ['descricao', 'regional', 'filial', 'cc_cod', 'cc_nome', 'cc_contabil', 'rubrica', 'conta', 'pacote', 'meses', 'dividir'];

/**
 * Lançamentos sem filial com dividir = 'hc' (ex.: Gupy para o Brasil todo) viram uma linha por filial, com o valor de cada
 * mês proporcional ao headcount da filial naquele mês (colaboradores + vagas ativos). Usa a base inteira, para que cada
 * coordenador veja a parte certa da sua regional.
 */
function expandirLancamentos(lista) {
  if (!lista.some(l => l.dividir === 'hc' && !l.filial)) return lista.map(l => ({ ...l, parte: null }));
  const hc = new Map(); // filial → { regional, meses[12] }
  for (const c of db.prepare('SELECT regional, filial, mes_inicio, mes_fim FROM colaboradores').all()) {
    if (!hc.has(c.filial)) hc.set(c.filial, { regional: c.regional, meses: Array(12).fill(0) });
    const h = hc.get(c.filial);
    for (let m = 0; m < 12; m++) if (m + 1 >= (c.mes_inicio || 1) && m + 1 <= (c.mes_fim || 12)) h.meses[m]++;
  }
  const out = [];
  for (const l of lista) {
    if (l.dividir !== 'hc' || l.filial) { out.push({ ...l, parte: null }); continue; }
    const alvo = [...hc].filter(([, h]) => l.regional === '*' || h.regional === l.regional);
    const tot = Array.from({ length: 12 }, (_, m) => alvo.reduce((a, [, h]) => a + h.meses[m], 0));
    for (const [filial, h] of alvo) {
      const meses = (l.meses || []).map((v, m) => (tot[m] ? (Number(v) || 0) * h.meses[m] / tot[m] : 0));
      if (meses.some(v => Math.abs(v) >= 0.005)) out.push({ ...l, regional: h.regional, filial, meses, parte: l.id });
    }
  }
  return out;
}

function lerLancamento(b) {
  return {
    descricao: texto(b.descricao, 200),
    // '*' = todas as regionais (nível Brasil)
    regional: /^(\*|TODAS|TODAS AS REGIONAIS|BRASIL)$/i.test(texto(b.regional)) ? '*' : texto(b.regional, 80).toUpperCase(),
    filial: texto(b.filial, 120).toUpperCase(),
    cc_cod: texto(b.cc_cod, 40),
    cc_nome: texto(b.cc_nome, 160),
    cc_contabil: texto(b.cc_contabil, 160),
    rubrica: RUBRICAS_VALIDAS.has(b.rubrica) ? b.rubrica : 'outras',
    conta: texto(b.conta, 160),
    pacote: texto(b.pacote, 80),
    meses: JSON.stringify(Array.from({ length: 12 }, (_, i) => numero(Array.isArray(b.meses) ? b.meses[i] : 0))),
    // 'hc' = sem filial, dividido entre as filiais (da regional ou de todas) pelo headcount de cada mês
    dividir: /^(hc|headcount|dividir|sim)$/i.test(texto(b.dividir)) && !texto(b.filial) ? 'hc' : '',
  };
}
const lancValido = l => (!l.descricao || !l.regional ? 'Informe a descrição e a regional.' : '');

app.post('/api/lancamentos', exigirAdmin, (req, res) => {
  const l = lerLancamento(req.body || {});
  const erro = lancValido(l);
  if (erro) return res.status(400).json({ erro });
  const r = db.prepare(`INSERT INTO lancamentos (${CAMPOS_LANC.join(',')}) VALUES (${CAMPOS_LANC.map(() => '?').join(',')})`).run(...CAMPOS_LANC.map(k => l[k]));
  registrar('Administrador', 'Incluiu lançamento', `${l.descricao} · ${l.filial || l.regional} · ${l.cc_cod}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

app.put('/api/lancamentos/:id', exigirAdmin, (req, res) => {
  const l = lerLancamento(req.body || {});
  const erro = lancValido(l);
  if (erro) return res.status(400).json({ erro });
  const r = db.prepare(`UPDATE lancamentos SET ${CAMPOS_LANC.map(k => `${k} = ?`).join(', ')}, atualizado_em = datetime('now') WHERE id = ?`).run(...CAMPOS_LANC.map(k => l[k]), req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  registrar('Administrador', 'Alterou lançamento', `${l.descricao} · ${l.filial || l.regional} · ${l.cc_cod}`);
  res.json({ ok: true });
});

app.delete('/api/lancamentos/:id', exigirAdmin, (req, res) => {
  const l = db.prepare('SELECT descricao, filial, regional FROM lancamentos WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ erro: 'Lançamento não encontrado.' });
  db.prepare('DELETE FROM lancamentos WHERE id = ?').run(req.params.id);
  registrar('Administrador', 'Removeu lançamento', `${l.descricao} · ${l.filial || l.regional}`);
  res.json({ ok: true });
});

/** Importa várias linhas (Excel). substituir = apaga os lançamentos atuais antes. */
app.post('/api/lancamentos/importar', exigirAdmin, (req, res) => {
  const linhas = (Array.isArray(req.body?.linhas) ? req.body.linhas : []).map(lerLancamento);
  const erros = linhas.map((l, i) => (lancValido(l) ? `Linha ${i + 2}: ${lancValido(l)}` : '')).filter(Boolean);
  const validas = linhas.filter(l => !lancValido(l));
  if (!validas.length) return res.status(400).json({ erro: 'Nenhuma linha válida.', erros });
  const ins = db.prepare(`INSERT INTO lancamentos (${CAMPOS_LANC.join(',')}) VALUES (${CAMPOS_LANC.map(() => '?').join(',')})`);
  db.exec('BEGIN');
  try {
    if (req.body?.substituir) db.exec('DELETE FROM lancamentos');
    validas.forEach(l => ins.run(...CAMPOS_LANC.map(k => l[k])));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar('Administrador', `Importou lançamentos${req.body?.substituir ? ' (substituindo)' : ''}`, `${validas.length} linha(s)`);
  res.json({ ok: true, importados: validas.length, erros: erros.slice(0, 20) });
});

app.put('/api/config', exigirAdmin, (req, res) => {
  const ano = Math.round(Number(req.body?.ano));
  if (!(ano >= 2000 && ano <= 2100)) return res.status(400).json({ erro: 'Ano inválido.' });
  db.prepare("INSERT INTO config (chave, valor) VALUES ('ano', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(String(ano));
  registrar('Administrador', 'Alterou o ano do orçamento', ano);
  res.json({ ok: true });
});

// ----- colaboradores -----

function lerColaborador(b) {
  const vaga = Boolean(b.vaga);
  return {
    matricula: texto(b.matricula, 40),
    nome: texto(b.nome, 160) || (vaga ? 'Nova vaga' : ''),
    regional: texto(b.regional, 80).toUpperCase(),
    filial: texto(b.filial, 120).toUpperCase(),
    situacao: texto(b.situacao, 80) || (vaga ? 'Nova Vaga' : 'Ativo'),
    funcao: texto(b.funcao, 160),
    cargo: texto(b.cargo, 120),
    cc_cod: texto(b.cc_cod, 40),
    cc_nome: texto(b.cc_nome, 160),
    salario: numero(b.salario),
    mes_inicio: mes(b.mes_inicio, 1),
    mes_fim: mes(b.mes_fim, 12),
    vaga: vaga ? 1 : 0,
    excecoes: JSON.stringify(lerExcecoes(b.excecoes)),
    sexo: lerSexo(b.sexo),
    gestor: texto(b.gestor, 160),
  };
}

/** F, M ou vazio (aceita Feminino/Masculino, Mulher/Homem, F/M). */
function lerSexo(v) {
  const t = String(v ?? '').trim().toUpperCase();
  if (/^(F|FEM|FEMININO|MULHER)/.test(t)) return 'F';
  if (/^(M|MASC|MASCULINO|HOMEM)/.test(t)) return 'M';
  return '';
}

/** Condições próprias do colaborador por rubrica (ex.: sucedidos): { rubrica: { metodo, valor } }. */
function lerExcecoes(v) {
  let obj = v;
  if (typeof v === 'string') { try { obj = JSON.parse(v || '{}'); } catch { obj = {}; } }
  const out = {};
  for (const [rub, e] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    if (!RUBRICAS_VALIDAS.has(rub) || !e || !['nao', 'fixo', 'pct', 'multiplo'].includes(e.metodo)) continue;
    // Horas extras e promoções/méritos são só o total de cada filial: nunca aceitam valor vindo da planilha da base
    // (mesmo que a tela antiga, em cache no navegador, ainda leia a coluna).
    if (e.origem === 'base' && (rub === 'horas_extras' || rub === 'promocoes')) continue;
    out[rub] = { metodo: e.metodo, valor: e.metodo === 'nao' ? 0 : numero(e.valor), ...(e.origem === 'base' ? { origem: 'base' } : {}) };
  }
  return out;
}

/**
 * Junta as condições já cadastradas com as da nova planilha. O que foi ajustado à mão (sem origem) é mantido;
 * valores que vieram da base são trocados pelos da nova planilha nos itens que ela traz como coluna.
 */
function juntarExcecoes(velhas, novas, colunasBase) {
  const cols = new Set(colunasBase || []);
  // Adicional noturno e adicionais de turno já foram a mesma coluna: a planilha que traz um deles substitui os dois.
  if (cols.has('adic_noturno') || cols.has('adic_turno')) { cols.add('adic_noturno'); cols.add('adic_turno'); }
  const out = {};
  for (const [rub, e] of Object.entries(velhas)) if (e.origem !== 'base' || !cols.has(rub)) out[rub] = e;
  for (const [rub, e] of Object.entries(novas)) if (e.origem !== 'base' || !out[rub] || out[rub].origem === 'base') out[rub] = e;
  return out;
}

const CAMPOS_COLAB = ['matricula', 'nome', 'regional', 'filial', 'situacao', 'funcao', 'cargo', 'cc_cod', 'cc_nome', 'salario', 'mes_inicio', 'mes_fim', 'vaga', 'excecoes', 'sexo', 'gestor'];

app.post('/api/colaboradores/importar', exigirAdmin, (req, res) => {
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  // tudo = a base passa a ser só o que está nos arquivos · substituir = troca só as regionais dos arquivos · adicionar = soma
  const modo = ['tudo', 'substituir', 'adicionar'].includes(req.body?.modo) ? req.body.modo : 'substituir';
  const validos = [];
  const erros = [];
  linhas.forEach((l, i) => {
    const c = lerColaborador(l);
    // Itens que vieram como coluna da planilha (valores por colaborador): substituem os valores de base anteriores.
    c.colunas_base = (Array.isArray(l.colunas_base) ? l.colunas_base : []).filter(r => RUBRICAS_VALIDAS.has(r));
    if (!c.nome || !c.regional || !c.filial) erros.push(`Linha ${i + 1}: nome, regional e filial são obrigatórios.`);
    else validos.push(c);
  });
  if (!validos.length) return res.status(400).json({ erro: 'Nenhuma linha válida na planilha.', erros });

  const regionais = [...new Set(validos.map(c => c.regional))];
  const inserir = db.prepare(`INSERT INTO colaboradores (${CAMPOS_COLAB.join(',')}) VALUES (${CAMPOS_COLAB.map(() => '?').join(',')})`);
  db.exec('BEGIN');
  try {
    if (modo !== 'adicionar') {
      // Guarda as condições próprias (sucedidos) já cadastradas, para não perdê-las ao reimportar a base.
      const antigas = modo === 'tudo'
        ? db.prepare("SELECT matricula, nome, excecoes FROM colaboradores WHERE matricula <> '' AND excecoes <> '{}'").all()
        : db.prepare(`SELECT matricula, nome, excecoes FROM colaboradores WHERE matricula <> '' AND excecoes <> '{}' AND regional IN (${regionais.map(() => '?').join(',')})`).all(...regionais);
      // Mesma matrícula pode existir em empresas diferentes: casa por matrícula + nome.
      const chave = c => `${c.matricula}|${String(c.nome).trim().toUpperCase()}`;
      const porMatricula = new Map(antigas.map(a => [chave(a), lerExcecoes(a.excecoes)]));
      for (const c of validos) {
        const velhas = porMatricula.get(chave(c));
        if (velhas) c.excecoes = JSON.stringify(juntarExcecoes(velhas, lerExcecoes(c.excecoes), c.colunas_base));
      }
      if (modo === 'tudo') db.exec('DELETE FROM colaboradores');
      else {
        const del = db.prepare('DELETE FROM colaboradores WHERE regional = ?');
        regionais.forEach(r => del.run(r));
      }
    }
    for (const c of validos) inserir.run(...CAMPOS_COLAB.map(k => c[k]));
    sincronizarFiliais();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  registrar('Administrador', `Importou a base (${modo})`, `${validos.length} linhas · ${regionais.join(', ')}`);
  res.json({ ok: true, importados: validos.length, regionais, erros: erros.slice(0, 20) });
});

app.post('/api/colaboradores', exigirAdmin, (req, res) => {
  const c = lerColaborador(req.body || {});
  if (!c.nome || !c.regional || !c.filial) return res.status(400).json({ erro: 'Informe nome, regional e filial.' });
  const r = db.prepare(`INSERT INTO colaboradores (${CAMPOS_COLAB.join(',')}) VALUES (${CAMPOS_COLAB.map(() => '?').join(',')})`).run(...CAMPOS_COLAB.map(k => c[k]));
  sincronizarFiliais();
  registrar('Administrador', c.vaga ? 'Incluiu vaga' : 'Incluiu colaborador', `${c.nome} · ${c.filial}`);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

app.put('/api/colaboradores/:id', exigirAdmin, (req, res) => {
  const atual = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
  const c = lerColaborador({ ...atual, ...req.body, vaga: req.body?.vaga ?? atual.vaga });
  db.prepare(`UPDATE colaboradores SET ${CAMPOS_COLAB.map(k => `${k} = ?`).join(', ')}, atualizado_em = datetime('now') WHERE id = ?`)
    .run(...CAMPOS_COLAB.map(k => c[k]), atual.id);
  sincronizarFiliais();
  const mudou = CAMPOS_COLAB.filter(k => String(atual[k]) !== String(c[k])).map(k => `${k}: ${atual[k]} → ${c[k]}`).join('; ');
  registrar('Administrador', 'Alterou colaborador', `${c.nome} · ${mudou}`);
  res.json({ ok: true });
});

// Duplicado = mesma matrícula, mesmo nome e mesma filial (a mesma matrícula pode existir em empresas diferentes).
// Vagas não entram. Fica só o registro mais recente (maior id).
app.post('/api/colaboradores/remover-duplicados', exigirAdmin, (req, res) => {
  const r = db.prepare(`DELETE FROM colaboradores WHERE vaga = 0 AND EXISTS (
    SELECT 1 FROM colaboradores c2 WHERE c2.vaga = 0 AND c2.id > colaboradores.id AND c2.matricula = colaboradores.matricula
      AND c2.filial = colaboradores.filial AND upper(trim(c2.nome)) = upper(trim(colaboradores.nome)))`).run();
  registrar('Administrador', 'Removeu matrículas duplicadas', `${r.changes} registro(s)`);
  res.json({ ok: true, removidos: Number(r.changes) });
});

app.delete('/api/colaboradores', exigirAdmin, (req, res) => {
  if (req.body?.confirmar !== 'APAGAR') return res.status(400).json({ erro: 'Confirmação inválida.' });
  const r = db.prepare('DELETE FROM colaboradores').run();
  registrar('Administrador', 'Apagou toda a base de colaboradores', `${r.changes} registro(s)`);
  res.json({ ok: true, removidos: Number(r.changes) });
});

app.delete('/api/colaboradores/:id', exigirAdmin, (req, res) => {
  const atual = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
  db.prepare('DELETE FROM colaboradores WHERE id = ?').run(atual.id);
  registrar('Administrador', 'Removeu da base', `${atual.nome} · ${atual.filial}`);
  res.json({ ok: true });
});

// ----- filiais (dissídio e reajuste de benefícios) -----

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function salvarFilial(nome, b) {
  const atual = db.prepare('SELECT * FROM filiais WHERE filial = ?').get(nome);
  if (!atual) return false;
  const novo = {
    dissidio_pct: b.dissidio_pct != null ? numero(b.dissidio_pct) : atual.dissidio_pct,
    dissidio_mes: mes(b.dissidio_mes, atual.dissidio_mes),
    dissidio_ant_pct: b.dissidio_ant_pct != null ? numero(b.dissidio_ant_pct) : atual.dissidio_ant_pct,
    dissidio_ant_mes: mes(b.dissidio_ant_mes, atual.dissidio_ant_mes),
    reaj_benef_pct: b.reaj_benef_pct != null ? numero(b.reaj_benef_pct) : atual.reaj_benef_pct,
    reaj_benef_mes: mes(b.reaj_benef_mes, atual.reaj_benef_mes),
    reaj_benef_ant_pct: b.reaj_benef_ant_pct != null ? numero(b.reaj_benef_ant_pct) : atual.reaj_benef_ant_pct,
    reaj_benef_ant_mes: mes(b.reaj_benef_ant_mes, atual.reaj_benef_ant_mes),
    uf: b.uf !== undefined ? (UFS.includes(String(b.uf).toUpperCase()) ? String(b.uf).toUpperCase() : null) : atual.uf,
  };
  db.prepare('UPDATE filiais SET dissidio_pct = ?, dissidio_mes = ?, dissidio_ant_pct = ?, dissidio_ant_mes = ?, reaj_benef_pct = ?, reaj_benef_mes = ?, reaj_benef_ant_pct = ?, reaj_benef_ant_mes = ?, uf = ? WHERE filial = ?')
    .run(novo.dissidio_pct, novo.dissidio_mes, novo.dissidio_ant_pct, novo.dissidio_ant_mes, novo.reaj_benef_pct, novo.reaj_benef_mes, novo.reaj_benef_ant_pct, novo.reaj_benef_ant_mes, novo.uf, nome);
  return true;
}

app.put('/api/filiais', exigirAdmin, (req, res) => {
  const lista = Array.isArray(req.body?.filiais) ? req.body.filiais : [];
  db.exec('BEGIN');
  let n = 0;
  for (const f of lista) if (salvarFilial(texto(f.filial, 120), f)) n++;
  db.exec('COMMIT');
  registrar('Administrador', 'Alterou dissídio/reajuste', `${n} filial(is): ${lista.map(f => `${f.filial}${f.dissidio_ant_pct != null ? ` ant. ${f.dissidio_ant_pct}%` : ''} ${f.dissidio_pct ?? ''}%`).join(', ').slice(0, 400)}`);
  res.json({ ok: true, atualizadas: n });
});

app.put('/api/filiais/:filial/conferencia', exigirLogin, (req, res) => {
  if (bloquearLeitura(req, res)) return;
  const f = db.prepare('SELECT * FROM filiais WHERE filial = ?').get(req.params.filial);
  if (!f || !podeVerRegional(req.usuario, f.regional)) return res.status(404).json({ erro: 'Filial não encontrada.' });
  const status = req.body?.status === 'conferida' ? 'conferida' : 'pendente';
  db.prepare("UPDATE filiais SET conferencia = ?, conferida_por = ?, conferida_em = datetime('now') WHERE filial = ?")
    .run(status, req.usuario.nome, f.filial);
  registrar(req.usuario.nome, status === 'conferida' ? 'Marcou filial como conferida' : 'Reabriu a conferência da filial', f.filial);
  res.json({ ok: true });
});

// ----- premissas -----

app.put('/api/premissas', exigirAdmin, (req, res) => {
  const escopo = texto(req.body?.escopo, 140);
  const rubricas = req.body?.rubricas || {};
  if (!escopo) return res.status(400).json({ erro: 'Informe o escopo.' });
  db.exec('BEGIN');
  try { gravarPremissas(escopo, rubricas); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar('Administrador', 'Alterou premissas', `${escopo === '*' ? 'Geral' : escopo} · ${Object.keys(rubricas).length} rubrica(s)`);
  res.json({ ok: true });
});

// Leva a periodicidade (e o mês / os 12 valores) de uma rubrica para as regras próprias de regionais e filiais,
// mantendo o resto de cada regra (ex.: PPR em fevereiro em todas as unidades, cada uma com o seu target).
app.put('/api/premissas/propagar', exigirAdmin, (req, res) => {
  const rubrica = texto(req.body?.rubrica, 60);
  const escopos = (Array.isArray(req.body?.escopos) ? req.body.escopos : []).map(e => texto(e, 140)).filter(Boolean);
  if (!RUBRICAS_VALIDAS.has(rubrica)) return res.status(400).json({ erro: 'Item inválido.' });
  const periodo = Motor.PERIODOS[req.body?.periodo] ? req.body.periodo : null;
  if (!periodo) return res.status(400).json({ erro: 'Periodicidade inválida.' });
  const ler = db.prepare('SELECT dados FROM premissas WHERE escopo = ? AND rubrica = ?');
  const gravar = db.prepare('UPDATE premissas SET dados = ? WHERE escopo = ? AND rubrica = ?');
  let n = 0;
  db.exec('BEGIN');
  for (const esc of escopos) {
    const linha = ler.get(esc, rubrica);
    if (!linha) continue;
    const p = JSON.parse(linha.dados);
    const novo = limparPremissa({ ...p, periodo, mes: req.body.mes ?? p.mes, meses: req.body.meses ?? p.meses });
    gravar.run(JSON.stringify(novo), esc, rubrica);
    n++;
  }
  db.exec('COMMIT');
  registrar('Administrador', 'Aplicou periodicidade em regras próprias', `${rubrica} · ${periodo} · ${n} regra(s)`);
  res.json({ ok: true, atualizadas: n });
});

// Importação do quadro de premissas (Excel): várias filiais de uma vez, com dissídio opcional.
app.put('/api/premissas/lote', exigirAdmin, (req, res) => {
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  let rubricas = 0;
  let filiais = 0;
  db.exec('BEGIN');
  try {
    for (const it of itens) {
      const escopo = texto(it.escopo, 140);
      if (!escopo) continue;
      rubricas += gravarPremissas(escopo, it.rubricas);
      if (it.filial && salvarFilial(escopo, it.filial)) filiais++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  registrar('Administrador', 'Importou quadro de premissas', `${itens.length} filial(is) · ${rubricas} regra(s)`);
  res.json({ ok: true, rubricas, filiais });
});

app.post('/api/premissas/copiar', exigirAdmin, (req, res) => {
  const de = texto(req.body?.de, 140);
  const para = (Array.isArray(req.body?.para) ? req.body.para : []).map(p => texto(p, 140)).filter(p => p && p !== de);
  const origem = db.prepare('SELECT * FROM premissas WHERE escopo = ?').all(de);
  db.exec('BEGIN');
  for (const p of para) {
    db.prepare('DELETE FROM premissas WHERE escopo = ?').run(p);
    for (const o of origem) db.prepare('INSERT INTO premissas (escopo, rubrica, dados) VALUES (?, ?, ?)').run(p, o.rubrica, o.dados);
  }
  db.exec('COMMIT');
  registrar('Administrador', 'Copiou premissas', `${de} → ${para.join(', ')}`);
  res.json({ ok: true, copiadas: para.length });
});

app.put('/api/niveis', exigirAdmin, (req, res) => {
  const niveis = req.body?.niveis || {};
  db.exec('BEGIN');
  db.exec('DELETE FROM niveis');
  for (const [nivel, mult] of Object.entries(niveis)) {
    if (texto(nivel)) db.prepare('INSERT INTO niveis (nivel, multiplo) VALUES (?, ?)').run(texto(nivel, 120), numero(mult));
  }
  db.exec('COMMIT');
  registrar('Administrador', 'Alterou a tabela de PPR por nível', `${Object.keys(niveis).length} nível(is)`);
  res.json({ ok: true });
});

// ----- relatório contábil: listas da contabilidade e vínculos (item → conta, centro de custo → CC contábil) -----

function lerContabil() {
  const linha = db.prepare("SELECT valor FROM config WHERE chave = 'contabil'").get();
  let c = {};
  try { c = JSON.parse(linha?.valor || '{}'); } catch { c = {}; }
  return {
    terceiro: 'N/A Custom1', cc_padrao: 'N/A Centro de Custo', contas: [], ccs: [], mapa_rubricas: {}, mapa_cc: {}, cc_rubricas: {},
    epm_empresas: [], epm_ccs: [], mapa_empresa: {}, epm_padrao: 'EMP_ANT_Input', epm_unico: false,
    pacotes: ['PESSOAL', 'BENEFÍCIOS', 'PROVISÕES TRABALHISTAS', 'TERCEIROS'], mapa_pacotes: {}, ...c,
  };
}

app.get('/api/contabil', exigirAdmin, (req, res) => res.json(lerContabil()));

app.put('/api/contabil', exigirAdmin, (req, res) => {
  const atual = lerContabil();
  const b = req.body || {};
  const lista = v => (Array.isArray(v) ? [...new Set(v.map(x => texto(x, 160)).filter(Boolean))].slice(0, 2000) : null);
  const mapa = (v, chaveOk) => (v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => chaveOk(k)).map(([k, x]) => [texto(k, 60), texto(x, 160)]).filter(([, x]) => x))
    : null);
  const novo = {
    pacotes: lista(b.pacotes) ?? atual.pacotes,
    mapa_pacotes: mapa(b.mapa_pacotes, k => RUBRICAS_VALIDAS.has(k)) ?? atual.mapa_pacotes,
    terceiro: b.terceiro != null ? texto(b.terceiro, 60) : atual.terceiro,
    cc_padrao: b.cc_padrao != null ? texto(b.cc_padrao, 160) : atual.cc_padrao,
    contas: lista(b.contas) ?? atual.contas,
    ccs: lista(b.ccs) ?? atual.ccs,
    mapa_rubricas: mapa(b.mapa_rubricas, k => RUBRICAS_VALIDAS.has(k)) ?? atual.mapa_rubricas,
    mapa_cc: mapa(b.mapa_cc, k => texto(k) !== '') ?? atual.mapa_cc,
    // Centro de custo fixo de um item (ex.: fretado no 25506); '-' = o centro de custo de cada colaborador.
    cc_rubricas: mapa(b.cc_rubricas, k => RUBRICAS_VALIDAS.has(k)) ?? atual.cc_rubricas,
    // Formato EPM: códigos de empresa ("EMP_2197|2197 - UTE Cuiaba") e de centro de custo (CC_17093), filial → empresa
    epm_empresas: lista(b.epm_empresas) ?? atual.epm_empresas,
    epm_ccs: lista(b.epm_ccs) ?? atual.epm_ccs,
    mapa_empresa: mapa(b.mapa_empresa, k => texto(k) !== '') ?? atual.mapa_empresa,
    epm_padrao: b.epm_padrao != null ? texto(b.epm_padrao, 60) : atual.epm_padrao,
    epm_unico: b.epm_unico != null ? Boolean(b.epm_unico) : atual.epm_unico,
  };
  db.prepare("INSERT INTO config (chave, valor) VALUES ('contabil', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(novo));
  registrar('Administrador', 'Alterou a configuração do relatório contábil', `${novo.contas.length} contas · ${novo.ccs.length} centros de custo`);
  res.json(novo);
});

// ----- coordenadores -----

app.get('/api/usuarios', exigirAdmin, (req, res) => {
  const lista = db.prepare('SELECT id, nome, login, regionais, perfil, ativo, criado_em, ultimo_acesso FROM usuarios ORDER BY nome').all()
    .map(u => ({ ...u, regionais: JSON.parse(u.regionais || '[]') }));
  res.json(lista);
});

app.post('/api/usuarios', exigirAdmin, (req, res) => {
  const nome = texto(req.body?.nome, 120);
  const login = texto(req.body?.login, 80).toLowerCase();
  const senha = String(req.body?.senha ?? '');
  const regionais = (Array.isArray(req.body?.regionais) ? req.body.regionais : []).map(r => texto(r, 80).toUpperCase()).filter(Boolean);
  if (!nome || !login || login === 'admin') return res.status(400).json({ erro: 'Informe nome e um login diferente de "admin".' });
  if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login)) return res.status(400).json({ erro: 'Este login já existe.' });
  const perfil = req.body?.perfil === 'leitura' ? 'leitura' : 'coordenador';
  db.prepare('INSERT INTO usuarios (nome, login, senha_hash, regionais, perfil) VALUES (?, ?, ?, ?, ?)').run(nome, login, hashSenha(senha), JSON.stringify(regionais), perfil);
  registrar('Administrador', perfil === 'leitura' ? 'Criou acesso somente visualização' : 'Criou acesso de coordenador', `${nome} (${login}) · ${regionais.join(', ').replace('*', 'todas as regionais')}`);
  res.json({ ok: true });
});

app.put('/api/usuarios/:id', exigirAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const nome = texto(req.body?.nome, 120) || u.nome;
  const regionais = Array.isArray(req.body?.regionais) ? req.body.regionais.map(r => texto(r, 80).toUpperCase()).filter(Boolean) : JSON.parse(u.regionais);
  const ativo = req.body?.ativo == null ? u.ativo : (req.body.ativo ? 1 : 0);
  const perfil = req.body?.perfil == null ? u.perfil : req.body.perfil === 'leitura' ? 'leitura' : 'coordenador';
  let hash = u.senha_hash;
  if (req.body?.senha) {
    if (String(req.body.senha).length < 6) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
    hash = hashSenha(req.body.senha);
  }
  db.prepare('UPDATE usuarios SET nome = ?, regionais = ?, ativo = ?, senha_hash = ?, perfil = ? WHERE id = ?').run(nome, JSON.stringify(regionais), ativo, hash, perfil, u.id);
  registrar('Administrador', 'Alterou acesso de coordenador', `${nome} (${u.login})`);
  res.json({ ok: true });
});

app.delete('/api/usuarios/:id', exigirAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(u.id);
  registrar('Administrador', 'Removeu acesso de coordenador', `${u.nome} (${u.login})`);
  res.json({ ok: true });
});

// ----- solicitações de ajuste -----

app.get('/api/solicitacoes', exigirLogin, (req, res) => {
  const u = req.usuario;
  const lista = db.prepare('SELECT * FROM solicitacoes ORDER BY CASE status WHEN \'aberta\' THEN 0 WHEN \'em_analise\' THEN 1 ELSE 2 END, id DESC').all()
    .filter(s => podeVerRegional(u, s.regional));
  res.json(lista);
});

app.post('/api/solicitacoes', exigirLogin, (req, res) => {
  if (bloquearLeitura(req, res)) return;
  const u = req.usuario;
  const b = req.body || {};
  const regional = texto(b.regional, 80).toUpperCase();
  const mensagem = texto(b.mensagem, 2000);
  if (!regional || !podeVerRegional(u, regional)) return res.status(403).json({ erro: 'Regional fora do seu acesso.' });
  if (!mensagem) return res.status(400).json({ erro: 'Descreva o ajuste necessário.' });
  const tipo = ['colaborador', 'premissa', 'vaga', 'dissidio', 'geral'].includes(b.tipo) ? b.tipo : 'geral';
  db.prepare(`INSERT INTO solicitacoes (usuario_id, autor, regional, filial, tipo, alvo_id, alvo_desc, campo, valor_atual, valor_sugerido, mensagem)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u.admin ? null : u.id, u.nome, regional, texto(b.filial, 120) || null, tipo, texto(b.alvo_id, 60) || null, texto(b.alvo_desc, 240) || null,
      texto(b.campo, 80) || null, texto(b.valor_atual, 120) || null, texto(b.valor_sugerido, 120) || null, mensagem);
  registrar(u.nome, 'Enviou pedido de ajuste', `${b.filial || regional} · ${texto(b.alvo_desc, 100)}`);
  res.json({ ok: true });
});

app.put('/api/solicitacoes/:id', exigirLogin, (req, res) => {
  const s = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(req.params.id);
  const u = req.usuario;
  if (!s || !podeVerRegional(u, s.regional)) return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  if (bloquearLeitura(req, res)) return;
  if (!u.admin) {
    // O coordenador só pode cancelar um pedido próprio que ainda não foi tratado.
    if (s.usuario_id !== u.id || s.status !== 'aberta') return res.status(403).json({ erro: 'Só é possível cancelar pedidos em aberto.' });
    db.prepare('DELETE FROM solicitacoes WHERE id = ?').run(s.id);
    return res.json({ ok: true });
  }
  const status = STATUS_SOLIC.includes(req.body?.status) ? req.body.status : s.status;
  const resposta = req.body?.resposta != null ? texto(req.body.resposta, 2000) : s.resposta;
  db.prepare("UPDATE solicitacoes SET status = ?, resposta = ?, atualizado_em = datetime('now') WHERE id = ?").run(status, resposta, s.id);
  registrar('Administrador', `Pedido de ajuste #${s.id}: ${status.replace('_', ' ')}`, resposta || '');
  res.json({ ok: true });
});

// ----- histórico e backup -----

app.get('/api/historico', exigirAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM historico ORDER BY id DESC LIMIT 300').all());
});

app.get('/api/backup', exigirAdmin, (req, res) => {
  const destino = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  res.download(destino, `orcamento-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.rm(destino, () => {}));
});

// no-cache: o navegador sempre confere se há versão nova (evita telas antigas depois de um deploy).
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Orçamento de Pessoal · Âmbar em http://localhost:${PORT}`));
}

module.exports = app;
