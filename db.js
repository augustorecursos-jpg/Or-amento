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
