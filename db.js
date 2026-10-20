// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências nativas).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'orcamento.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Base importada (até a coluna salário). mes_inicio/mes_fim permitem prever admissões, vagas e desligamentos.
CREATE TABLE IF NOT EXISTS colaboradores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula  TEXT,
  nome       TEXT NOT NULL,
  regional   TEXT NOT NULL,
  filial     TEXT NOT NULL,
  situacao   TEXT,
  funcao     TEXT,
  cargo      TEXT,
  cc_cod     TEXT,
  cc_nome    TEXT,
  salario    REAL NOT NULL DEFAULT 0,
  mes_inicio INTEGER NOT NULL DEFAULT 1,
  mes_fim    INTEGER NOT NULL DEFAULT 12,
  vaga       INTEGER NOT NULL DEFAULT 0,
  excecoes   TEXT NOT NULL DEFAULT '{}',
  sexo       TEXT NOT NULL DEFAULT '',
  gestor     TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_colab_filial ON colaboradores(regional, filial);

-- Parâmetros de cada filial: dissídio (reajuste salarial) e reajuste de benefícios, com o mês em que passam a valer.
CREATE TABLE IF NOT EXISTS filiais (
  filial         TEXT PRIMARY KEY,
  regional       TEXT NOT NULL,
  dissidio_pct   REAL NOT NULL DEFAULT 0,
  dissidio_mes   INTEGER NOT NULL DEFAULT 1,
  reaj_benef_pct REAL NOT NULL DEFAULT 0,
  reaj_benef_mes INTEGER NOT NULL DEFAULT 1,
  conferencia    TEXT NOT NULL DEFAULT 'pendente',
  conferida_por  TEXT,
  conferida_em   TEXT
);

-- Premissas por escopo: '*' (todas as filiais), 'R:<regional>' ou o nome da filial. Uma linha por rubrica.
CREATE TABLE IF NOT EXISTS premissas (
  escopo  TEXT NOT NULL,
  rubrica TEXT NOT NULL,
  dados   TEXT NOT NULL,
  PRIMARY KEY (escopo, rubrica)
);

-- Múltiplo de salários do PPR por nível do cargo (ex.: 05-Gerentes → 5).
CREATE TABLE IF NOT EXISTS niveis (
  nivel    TEXT PRIMARY KEY,
  multiplo REAL NOT NULL
);

-- Coordenadores regionais (acesso de conferência).
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  login      TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  regionais  TEXT NOT NULL DEFAULT '[]',
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_acesso TEXT
);

-- Pedidos de ajuste enviados pelos coordenadores e tratados pelo admin.
CREATE TABLE IF NOT EXISTS solicitacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  autor         TEXT NOT NULL,
  regional      TEXT NOT NULL,
  filial        TEXT,
  tipo          TEXT NOT NULL,
  alvo_id       TEXT,
  alvo_desc     TEXT,
  campo         TEXT,
  valor_atual   TEXT,
  valor_sugerido TEXT,
  mensagem      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'aberta',
  resposta      TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Outros lançamentos: custos fora dos colaboradores (consultoria, Gupy, rescisão de um CC num mês…), com filial,
-- centro de custo, item/conta contábil e o valor de cada mês.
CREATE TABLE IF NOT EXISTS lancamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao   TEXT NOT NULL,
  regional    TEXT NOT NULL,
  filial      TEXT NOT NULL DEFAULT '',
  cc_cod      TEXT NOT NULL DEFAULT '',
  cc_nome     TEXT NOT NULL DEFAULT '',
  cc_contabil TEXT NOT NULL DEFAULT '',
  rubrica     TEXT NOT NULL DEFAULT 'outras',
  conta       TEXT NOT NULL DEFAULT '',
  pacote      TEXT NOT NULL DEFAULT '',
  meses       TEXT NOT NULL DEFAULT '[]',
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS historico (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  quando  TEXT NOT NULL DEFAULT (datetime('now')),
  quem    TEXT NOT NULL,
  acao    TEXT NOT NULL,
  detalhe TEXT
);
`);

// Atualizações de esquema em bancos já existentes.
const colunas = db.prepare('PRAGMA table_info(colaboradores)').all().map(c => c.name);
if (!colunas.includes('excecoes')) db.exec("ALTER TABLE colaboradores ADD COLUMN excecoes TEXT NOT NULL DEFAULT '{}'");
if (!colunas.includes('sexo')) db.exec("ALTER TABLE colaboradores ADD COLUMN sexo TEXT NOT NULL DEFAULT ''");
if (!colunas.includes('gestor')) db.exec("ALTER TABLE colaboradores ADD COLUMN gestor TEXT NOT NULL DEFAULT ''");
const colFiliais = db.prepare('PRAGMA table_info(filiais)').all().map(c => c.name);
if (!colFiliais.includes('uf')) db.exec('ALTER TABLE filiais ADD COLUMN uf TEXT');

if (!db.prepare("SELECT 1 FROM config WHERE chave = 'ano'").get()) {
  db.prepare("INSERT INTO config (chave, valor) VALUES ('ano', ?)").run(String(new Date().getFullYear() + 1));
}

// PPR da Holding (matriz, regional Sudeste): target de salários por nível do cargo.
// Gravado uma única vez; depois disso a regra é editada pela tela de Premissas (filial HOLDING) e não é sobrescrita.
const PPR_HOLDING = {
  '07-Supervisores': 2, '09-Administrativo': 1, '06-Coordenação': 3, '05-Gerentes': 5, '01-Diretores': 10,
  '15-Operação - Produção': 1, '11-Operação - Nivel Superior': 1, '19-Engenheiros': 2, '08-Especialistas': 2, '04-Gerentes Executivo': 5,
};
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'ppr_holding'").get()) {
  db.prepare("INSERT OR IGNORE INTO premissas (escopo, rubrica, dados) VALUES ('HOLDING', 'ppr', ?)").run(JSON.stringify({
    metodo: 'multiplo', valor: 1, base: 'salario', periodo: 'anual_diluido', mes: 12, rateio: 'hc', teto: null,
    por_nivel: true, niveis: PPR_HOLDING, quem: [], ultimo_metodo: null,
  }));
  db.prepare("INSERT INTO config (chave, valor) VALUES ('ppr_holding', 'ok')").run();
}

// Auxílio óculos é pago uma vez no ano: o valor (da regra ou da base) é dividido em 12 meses.
// Ajusta uma única vez as regras já gravadas em R$ por colaborador (ou "não tem"); total da filial fica como está.
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'oculos_anual'").get()) {
  const gravar = db.prepare("UPDATE premissas SET dados = ? WHERE escopo = ? AND rubrica = 'aux_oculos'");
  for (const r of db.prepare("SELECT escopo, dados FROM premissas WHERE rubrica = 'aux_oculos'").all()) {
    const p = JSON.parse(r.dados);
    if (p.metodo === 'rateio' || p.periodo === 'por_mes') continue;
    gravar.run(JSON.stringify({ ...p, periodo: 'anual_diluido' }), r.escopo);
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES ('oculos_anual', 'ok')").run();
}

// Regra do ADM de pessoal: férias, 13º, FGTS e INSS sobre salário + adicionais + horas extras; INSS de 29%.
// Ajusta uma única vez as regras já gravadas (mantém os percentuais; só troca a base). Depois, vale o que for editado na tela.
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'encargos_folha'").get()) {
  const gravar = db.prepare('UPDATE premissas SET dados = ? WHERE escopo = ? AND rubrica = ?');
  for (const r of db.prepare("SELECT escopo, rubrica, dados FROM premissas WHERE rubrica IN ('ferias', 'decimo', 'fgts', 'inss')").all()) {
    let p = JSON.parse(r.dados);
    if (p.metodo === 'pct' && ['salario', 'remuneracao'].includes(p.base || 'salario')) p = { ...p, base: 'folha' };
    else if (r.rubrica === 'inss' && r.escopo === '*' && p.metodo === 'nao') p = { ...p, metodo: 'pct', valor: 29, base: 'folha' };
    else continue;
    gravar.run(JSON.stringify(p), r.escopo, r.rubrica);
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES ('encargos_folha', 'ok')").run();
}

// Férias passam a ser férias + 1/3 (base ÷ 9 = 11,1111%) no lugar de só o 1/3 (base ÷ 36 = 2,7778%). Uma única vez.
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'ferias_terco'").get()) {
  const gravar = db.prepare("UPDATE premissas SET dados = ? WHERE escopo = ? AND rubrica = 'ferias'");
  for (const r of db.prepare("SELECT escopo, dados FROM premissas WHERE rubrica = 'ferias'").all()) {
    const p = JSON.parse(r.dados);
    if (p.metodo === 'pct' && Math.abs(Number(p.valor) - 2.7778) < 0.001) gravar.run(JSON.stringify({ ...p, valor: 100 / 9 }), r.escopo);
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES ('ferias_terco', 'ok')").run();
}

// 11 meses de salário + 1 de férias: o INSS do mês de férias entra pelo INSS férias (29%). Uma única vez, na regra geral.
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'inss_ferias'").get()) {
  const r = db.prepare("SELECT dados FROM premissas WHERE escopo = '*' AND rubrica = 'inss_ferias'").get();
  if (r && JSON.parse(r.dados).metodo === 'nao') {
    db.prepare("UPDATE premissas SET dados = ? WHERE escopo = '*' AND rubrica = 'inss_ferias'")
      .run(JSON.stringify({ ...JSON.parse(r.dados), metodo: 'pct', valor: 29, base: 'ferias' }));
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES ('inss_ferias', 'ok')").run();
}

// VT fica no centro de custo de cada colaborador (só o fretado vai para o 25506): desfaz, uma vez, um 25506 salvo no VT.
if (!db.prepare("SELECT 1 FROM config WHERE chave = 'vt_cc_colab'").get()) {
  const r = db.prepare("SELECT valor FROM config WHERE chave = 'contabil'").get();
  if (r) {
    const c = JSON.parse(r.valor || '{}');
    if (String(c.cc_rubricas?.vt || '').startsWith('25506')) {
      delete c.cc_rubricas.vt;
      db.prepare("UPDATE config SET valor = ? WHERE chave = 'contabil'").run(JSON.stringify(c));
    }
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES ('vt_cc_colab', 'ok')").run();
}

// Horas extras passam a ser só o total do ano de cada filial (distribuído pela ferramenta): apaga, uma vez, a HE que veio
// da planilha da base para cada colaborador. Ajustes feitos à mão no cadastro (sem origem 'base') ficam.
// (rodada de novo em 'he_sem_base_2': uma reimportação feita com a tela antiga em cache trouxe a HE da base de volta)
for (const marca of ['he_sem_base', 'he_sem_base_2']) if (!db.prepare('SELECT 1 FROM config WHERE chave = ?').get(marca)) {
  const gravar = db.prepare('UPDATE colaboradores SET excecoes = ? WHERE id = ?');
  let n = 0;
  for (const c of db.prepare("SELECT id, excecoes FROM colaboradores WHERE excecoes LIKE '%horas_extras%'").all()) {
    const e = JSON.parse(c.excecoes || '{}');
    if (e.horas_extras?.origem !== 'base') continue;
    delete e.horas_extras;
    gravar.run(JSON.stringify(e), c.id);
    n++;
  }
  db.prepare("INSERT INTO config (chave, valor) VALUES (?, 'ok')").run(marca);
  if (n) db.prepare('INSERT INTO historico (quem, acao, detalhe) VALUES (?, ?, ?)').run('Sistema', 'Removeu a HE vinda da base', `${n} colaborador(es): HE passa a ser o total do ano de cada filial`);
}

function registrar(quem, acao, detalhe = '') {
  db.prepare('INSERT INTO historico (quem, acao, detalhe) VALUES (?, ?, ?)').run(quem, acao, String(detalhe).slice(0, 500));
}

/** Garante uma linha em `filiais` para cada filial que aparece na base de colaboradores. */
// Estado (UF) sugerido pelo nome da filial — só quando o nome indica a cidade; o resto fica "a definir" para ajuste na tela.
const UF_POR_NOME = [
  ['HOLDING NORTE', 'AM'], ['CUIABA', 'MT'], ['CACERES', 'MT'], ['GOIANIA', 'GO'],
  ['ANAMA', 'AM'], ['ANORI', 'AM'], ['APARECIDA', 'AM'], ['CAAPIRANGA', 'AM'], ['CODAJAS', 'AM'], ['JAPIIM', 'AM'], ['JARAQUI', 'AM'],
  ['MAUA', 'AM'], ['PIRARUCU', 'AM'], ['PORAQUE', 'AM'], ['TAMBAQUI', 'AM'], ['TUCUNARE', 'AM'], ['MANACAPURU', 'AM'],
  ['CRUZEIRO DO SUL', 'AC'], ['FEIJO', 'AC'], ['TARAUACA', 'AC'], ['UTE FLORESTA', 'AC'], ['MONTE CRISTO', 'RR'],
  ['ARAUCARIA', 'PR'], ['CANDIOTA', 'RS'], ['URUGUAIANA', 'RS'], ['LAGES BIO', 'SC'], ['SANTA CATARINA', 'SC'],
  ['SANTA CRUZ', 'RJ'], ['NORTE FLUMINENSE', 'RJ'], ['ANDRADINA', 'SP'],
];
const UF_POR_REGIONAL = { 'RIO DE JANEIRO': 'RJ' };
function ufSugerida(filial, regional) {
  const n = String(filial || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const achado = UF_POR_NOME.find(([chave]) => n.includes(chave));
  return achado ? achado[1] : UF_POR_REGIONAL[String(regional || '').toUpperCase()] || null;
}

function sincronizarFiliais() {
  db.exec(`
    INSERT OR IGNORE INTO filiais (filial, regional)
    SELECT filial, MIN(regional) FROM colaboradores GROUP BY filial;
    UPDATE filiais SET regional = (SELECT MIN(regional) FROM colaboradores c WHERE c.filial = filiais.filial)
     WHERE EXISTS (SELECT 1 FROM colaboradores c WHERE c.filial = filiais.filial);
  `);
  // Estado sugerido só para quem ainda não tem (não sobrescreve o que foi ajustado na tela)
  const sem = db.prepare("SELECT filial, regional FROM filiais WHERE uf IS NULL OR uf = ''").all();
  const gravar = db.prepare('UPDATE filiais SET uf = ? WHERE filial = ?');
  for (const f of sem) { const uf = ufSugerida(f.filial, f.regional); if (uf) gravar.run(uf, f.filial); }
}

module.exports = { db, DATA_DIR, registrar, sincronizarFiliais, ufSugerida, PPR_HOLDING };

// Bancos que já existiam antes da coluna de estado: preenche a sugestão uma vez.
sincronizarFiliais();
