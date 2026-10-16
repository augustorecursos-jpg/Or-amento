// Dados de demonstração (fictícios): colaboradores, premissas, dissídio e um coordenador.
// Uso: npm run seed   (apaga a base atual de colaboradores, premissas e pedidos)
const crypto = require('node:crypto');
const { db, sincronizarFiliais, PPR_HOLDING } = require('../db');

const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Karina', 'Lucas', 'Marina', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Sérgio', 'Tatiane', 'Vinícius'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Freitas', 'Gomes', 'Henriques', 'Lima', 'Moraes', 'Nogueira', 'Oliveira', 'Pereira', 'Queiroz', 'Ribeiro', 'Santos', 'Teixeira', 'Vieira'];

// Estrutura de exemplo: regional → filiais com headcount aproximado.
const ESTRUTURA = {
  NORTE: { APARECIDA: 26, 'MAUA 3': 30, JARAQUI: 22, 'HOLDING NORTE': 18, 'CRUZEIRO DO SUL': 10 },
  SUL: { CANDIOTA: 60, ARAUCARIA: 22, URUGUAIANA: 16 },
  'CENTRO OESTE': { CUIABA: 26, 'GOIÂNIA II': 8, 'PCH SALTO DO PASSO VELHO': 5 },
  'RIO DE JANEIRO': { 'SANTA CRUZ': 30, 'UTE NORTE FLUMINENSE': 28, MGAS: 8 },
  SUDESTE: { HOLDING: 40, COMERCIALIZADORA: 10, FLUXUS: 8 },
};

const FUNCOES = [
  { funcao: 'Operador I', cargo: '15-Operação - Produção', cc: ['17150', 'OPERAÇÃO'], sal: [3200, 4300], peso: 6 },
  { funcao: 'Operador II', cargo: '15-Operação - Produção', cc: ['17150', 'OPERAÇÃO'], sal: [4300, 5600], peso: 4 },
  { funcao: 'Mecânico II', cargo: '14-Operação - Apoio', cc: ['17151', 'MANUTENÇÃO'], sal: [4400, 5800], peso: 4 },
  { funcao: 'Eletricista I', cargo: '14-Operação - Apoio', cc: ['17151', 'MANUTENÇÃO'], sal: [3600, 4600], peso: 3 },
  { funcao: 'Supervisor de Operações', cargo: '07-Supervisores', cc: ['17150', 'OPERAÇÃO'], sal: [8200, 11500], peso: 1 },
  { funcao: 'Técnico de Segurança', cargo: '11-Operação - Nivel Superior', cc: ['17147', 'SSMA'], sal: [4800, 6400], peso: 1 },
  { funcao: 'Analista Administrativo Jr', cargo: '09-Administrativo', cc: ['22153', 'ADMINISTRATIVO'], sal: [3800, 4800], peso: 2 },
  { funcao: 'Analista de Suprimentos Pl', cargo: '09-Administrativo', cc: ['17148', 'SUPRIMENTOS'], sal: [5600, 7200], peso: 1 },
  { funcao: 'Engenheiro de Manutenção', cargo: '19-Engenheiros', cc: ['17149', 'PLANEJAMENTO E ENGENHARIA'], sal: [11000, 15500], peso: 1 },
  { funcao: 'Gerente de Operações', cargo: '05-Gerentes', cc: ['17150', 'OPERAÇÃO'], sal: [19000, 24000], peso: 0.3 },
];
const FUNCOES_ESCRITORIO = [
  { funcao: 'Analista Financeiro Pl', cargo: '09-Administrativo', cc: ['24356', 'FINANCEIRO'], sal: [6500, 8500], peso: 4 },
  { funcao: 'Analista de RH Pl', cargo: '09-Administrativo', cc: ['17093', 'RECURSOS HUMANOS'], sal: [5800, 7800], peso: 3 },
  { funcao: 'Advogado Pl', cargo: '08-Especialistas', cc: ['17098', 'JURÍDICO'], sal: [11000, 15000], peso: 1 },
  { funcao: 'Analista de TI Sr', cargo: '09-Administrativo', cc: ['17138', 'TI'], sal: [10000, 14000], peso: 2 },
  { funcao: 'Coordenador Financeiro', cargo: '06-Coordenação', cc: ['24356', 'FINANCEIRO'], sal: [14000, 17000], peso: 1 },
  { funcao: 'Gerente de Controladoria', cargo: '05-Gerentes', cc: ['17129', 'CONTROLADORIA'], sal: [26000, 32000], peso: 0.6 },
  { funcao: 'Trader Sr', cargo: '08-Especialistas', cc: ['17643', 'COMERCIAL'], sal: [15000, 19000], peso: 1 },
];
const ESCRITORIO = new Set(['HOLDING', 'COMERCIALIZADORA', 'FLUXUS', 'HOLDING NORTE', 'MGAS']);

let semente = 42;
const aleat = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
const sortear = lista => {
  const total = lista.reduce((s, f) => s + f.peso, 0);
  let x = aleat() * total;
  return lista.find(f => (x -= f.peso) <= 0) || lista[0];
};

db.exec('BEGIN');
db.exec('DELETE FROM colaboradores; DELETE FROM premissas; DELETE FROM solicitacoes; DELETE FROM filiais; DELETE FROM niveis;');
const ins = db.prepare(`INSERT INTO colaboradores (matricula, nome, regional, filial, situacao, funcao, cargo, cc_cod, cc_nome, salario, mes_inicio, mes_fim, vaga)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
let mat = 10000;
for (const [regional, filiais] of Object.entries(ESTRUTURA)) {
  for (const [filial, hc] of Object.entries(filiais)) {
    const funcoes = ESCRITORIO.has(filial) ? [...FUNCOES_ESCRITORIO, ...FUNCOES.slice(6, 8)] : FUNCOES;
    for (let i = 0; i < hc; i++) {
      const f = sortear(funcoes);
      const nome = `${NOMES[Math.floor(aleat() * NOMES.length)]} ${SOBRENOMES[Math.floor(aleat() * SOBRENOMES.length)]} ${SOBRENOMES[Math.floor(aleat() * SOBRENOMES.length)]}`.toUpperCase();
      const sal = Math.round((f.sal[0] + aleat() * (f.sal[1] - f.sal[0])) * 100) / 100;
      const situacao = aleat() < 0.05 ? 'Férias' : 'Ativo';
      const fim = aleat() < 0.02 ? 6 + Math.floor(aleat() * 6) : 12;
      ins.run(String(mat++), nome, regional, filial, situacao, f.funcao, f.cargo, f.cc[0], f.cc[1], sal, 1, fim, 0);
    }
    if (hc >= 20) {
      const f = funcoes[0];
      ins.run('', `NOVA VAGA · ${f.funcao.toUpperCase()}`, regional, filial, 'Nova Vaga', f.funcao, f.cargo, f.cc[0], f.cc[1], f.sal[0], 4, 12, 1);
    }
  }
}
sincronizarFiliais();

const prem = db.prepare('INSERT INTO premissas (escopo, rubrica, dados) VALUES (?, ?, ?)');
const P = (escopo, rubrica, dados) => prem.run(escopo, rubrica, JSON.stringify({ base: 'salario', periodo: 'mensal', mes: 12, rateio: 'hc', teto: null, por_nivel: false, quem: [], valor: 0, ...dados }));
const OPERACAO = ['cc:17150', 'cc:17151', 'cc:17147'];

// Regra geral (vale para todas as filiais)
P('*', 'periculosidade', { metodo: 'pct', valor: 30, quem: OPERACAO });
P('*', 'horas_extras', { metodo: 'rateio', valor: 96000, periodo: 'anual_diluido', quem: OPERACAO });
P('*', 'va', { metodo: 'fixo', valor: 1480 });
P('*', 'vt', { metodo: 'fixo', valor: 430 });
P('*', 'assist_medica', { metodo: 'fixo', valor: 1500 });
P('*', 'assist_odonto', { metodo: 'fixo', valor: 30 });
P('*', 'seguro_vida', { metodo: 'pct', valor: 0.282, teto: 235 });
P('*', 'cesta_natalina', { metodo: 'fixo', valor: 274, periodo: 'anual_mes', mes: 12 });
P('*', 'ppr', { metodo: 'multiplo', valor: 2.4, periodo: 'anual_diluido' });
P('*', 'endomarketing', { metodo: 'fixo', valor: 25 });
P('*', 'confraternizacoes', { metodo: 'fixo', valor: 300, periodo: 'anual_mes', mes: 12 });
P('*', 'treinamento', { metodo: 'rateio', valor: 12000, periodo: 'anual_diluido' });

// Regionais
P('R:NORTE', 'va', { metodo: 'fixo', valor: 1600 });
P('R:NORTE', 'farmacia', { metodo: 'fixo', valor: 800 });
P('R:NORTE', 'assist_medica', { metodo: 'fixo', valor: 2300 });
P('R:NORTE', 'aux_creche', { metodo: 'rateio', valor: 2400, periodo: 'mensal' });
P('R:SUL', 'va', { metodo: 'fixo', valor: 1900 });
P('R:SUL', 'va_natal', { metodo: 'fixo', valor: 3800, periodo: 'anual_mes', mes: 12 });
P('R:RIO DE JANEIRO', 'assist_medica', { metodo: 'fixo', valor: 2360 });
P('R:RIO DE JANEIRO', 'farmacia', { metodo: 'fixo', valor: 400 });
P('R:SUDESTE', 'va', { metodo: 'fixo', valor: 290 });
P('R:SUDESTE', 'refeitorio', { metodo: 'fixo', valor: 27 });
P('R:SUDESTE', 'fretado', { metodo: 'fixo', valor: 23 });
P('R:SUDESTE', 'periculosidade', { metodo: 'nao' });

// Exceções por filial
P('CANDIOTA', 'ppr', { metodo: 'multiplo', valor: 1.4, periodo: 'anual_diluido' });
P('CANDIOTA', 'fretado', { metodo: 'rateio', valor: 75000, periodo: 'mensal' });
P('CANDIOTA', 'horas_extras', { metodo: 'rateio', valor: 312000, periodo: 'anual_diluido', quem: OPERACAO });
P('MAUA 3', 'horas_extras', { metodo: 'rateio', valor: 216000, periodo: 'anual_diluido', quem: OPERACAO });
P('UTE NORTE FLUMINENSE', 'fretado', { metodo: 'rateio', valor: 110000, periodo: 'mensal' });
P('UTE NORTE FLUMINENSE', 'adic_turno', { metodo: 'pct', valor: 8, quem: ['cc:17150'] });
P('SANTA CRUZ', 'penosidade', { metodo: 'pct', valor: 6, quem: ['cc:17150'] });

// PPR da matriz (Holding): target por nível do cargo. As demais filiais seguem 2,4 salários.
P('HOLDING', 'ppr', { metodo: 'multiplo', valor: 1, periodo: 'anual_diluido', por_nivel: true, niveis: PPR_HOLDING });

// Sucedidos (vindos da empresa anterior) com benefícios diferentes da regra da filial
for (const c of db.prepare("SELECT id FROM colaboradores WHERE filial = 'UTE NORTE FLUMINENSE' AND vaga = 0 LIMIT 4").all()) {
  db.prepare('UPDATE colaboradores SET excecoes = ? WHERE id = ?')
    .run(JSON.stringify({ va: { metodo: 'fixo', valor: 2350 }, assist_medica: { metodo: 'fixo', valor: 3100 }, aux_oculos: { metodo: 'fixo', valor: 60 } }), c.id);
}

// Dissídio por filial (data-base e % de exemplo)
const dissidio = { NORTE: [4.5, 5], SUL: [4.2, 5], 'CENTRO OESTE': [4.22, 5], 'RIO DE JANEIRO': [4.8, 9], SUDESTE: [4.29, 9] };
for (const f of db.prepare('SELECT filial, regional FROM filiais').all()) {
  const [pct, mes] = dissidio[f.regional];
  db.prepare('UPDATE filiais SET dissidio_pct = ?, dissidio_mes = ?, reaj_benef_pct = ?, reaj_benef_mes = ? WHERE filial = ?').run(pct, mes, 5, 1, f.filial);
}

// Coordenador de demonstração: login "coord.norte", senha "norte123"
const sal = crypto.randomBytes(16).toString('hex');
db.prepare('DELETE FROM usuarios WHERE login = ?').run('coord.norte');
db.prepare('INSERT INTO usuarios (nome, login, senha_hash, regionais) VALUES (?, ?, ?, ?)')
  .run('Coordenação Norte', 'coord.norte', `${sal}:${crypto.scryptSync('norte123', sal, 64).toString('hex')}`, JSON.stringify(['NORTE']));
const coord = db.prepare('SELECT id FROM usuarios WHERE login = ?').get('coord.norte');
const exemplo = db.prepare("SELECT * FROM colaboradores WHERE filial = 'JARAQUI' AND vaga = 0 LIMIT 1").get();
db.prepare(`INSERT INTO solicitacoes (usuario_id, autor, regional, filial, tipo, alvo_id, alvo_desc, campo, valor_atual, valor_sugerido, mensagem)
            VALUES (?, 'Coordenação Norte', 'NORTE', 'JARAQUI', 'colaborador', ?, ?, 'Salário', ?, 'R$ 5.150,00', 'Teve promoção em setembro, o salário já está atualizado na folha.')`)
  .run(coord.id, String(exemplo.id), `${exemplo.nome} · ${exemplo.funcao}`, `R$ ${exemplo.salario.toFixed(2).replace('.', ',')}`);
db.prepare(`INSERT INTO solicitacoes (usuario_id, autor, regional, filial, tipo, alvo_id, alvo_desc, campo, valor_atual, valor_sugerido, mensagem)
            VALUES (?, 'Coordenação Norte', 'NORTE', 'MAUA 3', 'premissa', 'horas_extras', 'Horas extras · MAUA 3', 'Horas extras', 'R$ 18.000,00 total da filial', 'R$ 24.000,00', 'Com a parada programada de junho o volume de HE deve subir.')`)
  .run(coord.id);
db.exec('COMMIT');

const n = db.prepare('SELECT COUNT(*) AS n FROM colaboradores').get().n;
console.log(`Base de demonstração criada: ${n} registros. Coordenador de teste: coord.norte / norte123`);
