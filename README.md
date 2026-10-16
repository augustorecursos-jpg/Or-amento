# Orçamento de Pessoal · Âmbar Energia

Ferramenta para montar o orçamento de pessoal por filial: o admin sobe a base (até a coluna **salário**), define
**premissas e regras** por filial, simula o **dissídio mês a mês** e libera o acesso dos **coordenadores regionais**
para conferir e pedir ajustes, que chegam ao admin numa caixa de pedidos.

Mesma identidade visual das outras ferramentas da Âmbar (azul-marinho `#0e3b5c`, laranja `#ec6b24`, lateral com onda).

## Como rodar

Requisito: **Node.js 22.5+** (usa o SQLite nativo do Node, sem banco externo).

```bash
npm install
npm run seed      # opcional: dados fictícios de demonstração + coordenador coord.norte / norte123
npm start         # http://localhost:3000  (usuário: admin · senha: ambar-orcamento)
npm test          # testes do motor de cálculo
```

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_PASSWORD` | Senha do usuário `admin` | `ambar-orcamento` (**troque antes de publicar**) |
| `PORT` | Porta HTTP | `3000` |
| `DATA_DIR` | Pasta do banco (`orcamento.db`) | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `data/` |
| `NODE_ENV=production` | Cookies só via HTTPS e senha obrigatória | – |

## Publicação no Render

O `render.yaml` já descreve o serviço (Node + disco persistente de 1 GB para o banco):

1. render.com → **New → Blueprint** → escolha este repositório.
2. Informe o valor de `ADMIN_PASSWORD` quando o Render pedir.
3. Após o deploy, o link `https://….onrender.com` é o endereço que os coordenadores usam.

Custo aproximado: plano Starter (US$ 7/mês) + disco (US$ 0,25/mês). O Render faz snapshot diário do disco e a tela
**Histórico** tem o botão **Backup do banco**. Sem disco (plano free) os dados se perdem a cada deploy.

> O repositório é público: **não** suba as planilhas reais (o `.gitignore` já ignora `*.xlsx`). A base é carregada
> pela própria ferramenta e fica só no disco do servidor.

## Telas

**Admin**
- **Painel** – custo anual, média mensal, headcount, custo médio por colaborador, impacto do dissídio, gráfico mês a mês
  por grupo, composição, ranking por filial (ou por centro de custo) e status da conferência das filiais.
- **Simulação mês a mês** – tabela Jan–Dez por rubrica, filial, centro de custo ou colaborador (R$ ou R$ mil) e o
  **simulador de dissídio**: altere o % e o mês da data-base de cada filial e o custo muda na hora; nada é salvo até
  clicar em *Aplicar ao orçamento*. Exporta Excel com resumo mensal, por filial, por centro de custo e por colaborador
  (formato próximo da planilha BZO).
- **Premissas e regras** – três níveis com herança: **regra geral → regional → filial**. Cada rubrica tem método
  (% sobre base, R$ por colaborador, total da filial rateado, nº de salários), *quem recebe* (centros de custo / níveis
  de cargo), periodicidade (todo mês, uma vez no ano, anual ÷ 12), teto e rateio por headcount ou salário. Mostra o
  custo anual de cada rubrica antes de salvar e a **distribuição por centro de custo e colaborador** (🔍). Na filial:
  dissídio e reajuste de benefícios com mês de início. Copiar regras de uma filial para outras, dissídio em lote e
  tabela de **PPR por nível do cargo**.
- **Base de colaboradores** – importa as planilhas das regionais (várias de uma vez; acha sozinho a linha de cabeçalho
  e a aba BZO). Modo *substituir as regionais do arquivo* ou *adicionar*. Inclui **vagas** (mês de admissão) e
  **desligamentos previstos** (mês de saída).
- **Pedidos de ajuste** – caixa de entrada com status (aberta, em análise, ajustada, recusada), resposta ao coordenador
  e botão **Abrir item**, que leva direto ao colaborador ou à premissa da filial.
- **Acessos dos coordenadores** – login, senha e regionais de cada coordenador.
- **Histórico** – registro de todas as alterações e backup.

**Coordenador** (só as regionais liberadas, sem alterar valores)
- Painel e simulação da regional.
- **Conferência** – cards por filial; premissas aplicadas e lista de colaboradores/vagas com custo mensal e anual.
  Botão **💬** em cada linha para pedir ajuste (salário, centro de custo, desligamento, transferência…), pedido de vaga,
  pedido geral e **Marcar como conferida**.
- **Meus pedidos** – status e resposta do admin.

## Rubricas (todas as que aparecem nas planilhas das regionais)

| Grupo | Rubricas |
|---|---|
| Remuneração | Salário, Periculosidade, Insalubridade, Penosidade, Adicionais de turno, Horas extras |
| Provisões | Férias (1/3), 13º salário, Rescisão |
| Encargos | FGTS, FGTS férias, FGTS 13º, INSS, INSS férias, INSS 13º |
| Benefícios | PPR, VA/VR, VA natal / 13º VR, Vale-transporte, Auxílio-creche, Auxílio educacional, Material escolar, Auxílio óculos, Oftalmo, Assistência médica, Coparticipação convênio médico, Assistência odontológica, Farmácia, Seguro de vida, Refeitório, Fretado, Fretado (overall), Cesta natalina |
| Demais | Saúde ocupacional, Endomarketing, Treinamento, Viagens, Confraternizações |

Padrões do sistema (iguais às fórmulas da planilha BZO e ajustáveis): periculosidade 30% do salário; férias
(1/3) = remuneração ÷ 36; 13º = salário ÷ 12; FGTS 8% (sobre salário, férias e 13º); PPR 2,4 salários/ano.
O salário importado é **sem dissídio**: o reajuste entra a partir do mês da data-base de cada filial.

## Estrutura

```
server.js            API (admin e coordenadores) + arquivos estáticos
db.js                esquema SQLite
public/js/motor.js   motor de cálculo (o mesmo arquivo roda no navegador e no servidor)
public/js/app.js     telas
scripts/seed-demo.js dados de demonstração (fictícios)
test/                testes do motor
```
