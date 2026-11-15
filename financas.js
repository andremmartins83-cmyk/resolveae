/*
 * Resolve Aê: motor financeiro (modelo v2).
 * Contrato: docs/MODELO-V2.md
 *
 * Script clássico: no navegador expõe window.Fin; no Node, module.exports.
 * Sem DOM, sem rede, sem localStorage.
 * Dinheiro guardado em reais com 2 casas; todo cálculo em centavos inteiros.
 * Funções de cálculo não mutam a entrada. Só mutam: pagarParcela,
 * desfazerPagamento, amortizar, propagarFixa, editarValores, virarAno,
 * pagarFatura, desfazerFatura, encerrar/reabrirDespesa, setConfig/marcar/setDivClasse,
 * setDim/renomearMeta, setCategoria/addCategoria e converterEmDivida/desfazerConversao.
 */
(function (root) {
  'use strict';

  var Fin = {};
  var TOL = 1; // tolerância de 1 centavo
  var STATUS_DESP = ['', 'Pago', 'Pendente', 'N/A'];
  var SITUACOES = ['radar', 'ativa', 'encerrada'];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // ===================== dinheiro =====================
  function c(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    var x = Number((n * 100).toFixed(6)); // limpa o resíduo de float (1415.8999999999999)
    return x < 0 ? -Math.round(-x) : Math.round(x);
  }
  function r(cent) { return Math.round(cent) / 100; }
  function rd(v) { return r(c(v)); } // arredonda reais a centavos
  function somaC(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += c(arr[i]); return s; }
  function fmt(v) {
    var cent = c(v), neg = cent < 0; cent = Math.abs(cent);
    var int = String(Math.floor(cent / 100)), dec = String(cent % 100);
    if (dec.length < 2) dec = '0' + dec;
    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + int + ',' + dec;
  }
  Fin.c = c;
  Fin.r = r;
  Fin.arred = rd;
  Fin.soma = function (arr) { return r(somaC(arr || [])); };
  Fin.fmt = fmt;
  Fin.TOL_CENTAVOS = TOL;

  // ===================== competência 'YYYY-MM' =====================
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ym(ano, mes0) {
    var a = Number(ano), m = Number(mes0);
    a += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return a + '-' + pad2(m + 1);
  }
  function ymParse(s) {
    var mm = /^(\d{4})-(\d{2})$/.exec(String(s == null ? '' : s));
    if (!mm) return null;
    var m = Number(mm[2]) - 1;
    if (m < 0 || m > 11) return null;
    return { ano: Number(mm[1]), mes0: m };
  }
  function ymAdd(s, n) { var p = ymParse(s); return p ? ym(p.ano, p.mes0 + Number(n || 0)) : ''; }
  function ymCmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function ymHoje(d) { d = d || new Date(); return ym(d.getFullYear(), d.getMonth()); }
  function ymRotulo(s) { var p = ymParse(s); return p ? MESES[p.mes0] + '/' + p.ano : String(s); }
  Fin.ym = ym;
  Fin.ymParse = ymParse;
  Fin.ymValido = function (s) { return !!ymParse(s); };
  Fin.ymAdd = ymAdd;
  Fin.ymCmp = ymCmp;
  Fin.ymHoje = ymHoje;
  Fin.ymRotulo = ymRotulo;

  // ===================== utilidades =====================
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function z12() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function s12() { return ['', '', '', '', '', '', '', '', '', '', '', '']; }
  function normNome(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  Fin.normNome = normNome;

  function hex8() {
    var cr = (typeof root !== 'undefined' && root && root.crypto) ||
      (typeof globalThis !== 'undefined' && globalThis.crypto);
    var s = '';
    if (cr && cr.getRandomValues) {
      var b = new Uint8Array(4);
      cr.getRandomValues(b);
      for (var i = 0; i < 4; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s;
    }
    for (var j = 0; j < 8; j++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  Fin.novoId = function (prefixo) { return (prefixo || 'id') + '-' + hex8(); };

  // ===================== dívidas =====================
  function qtdDe(dv) { var q = Math.floor(Number(dv && dv.qtd) || 0); return q > 0 ? q : 0; }

  Fin.planoParcelas = function (dv) {
    if (!dv || !ymParse(dv.inicio)) return [];
    var q = qtdDe(dv), v = c(dv.parcela);
    if (q < 1 || v <= 0) return [];
    var out = [];
    for (var k = 1; k <= q; k++) out.push({ k: k, ym: ymAdd(dv.inicio, k - 1), valor: r(v) });
    return out;
  };

  function inconsistenciasDiv(dv, totalPagoC) {
    var out = [];
    var q = qtdDe(dv), pc = c(dv.parcela), tc = c(dv.total);
    if (dv.situacao !== 'radar' && q > 0 && pc > 0) {
      var planoC = pc * q;
      var lim = Math.max(100, Math.round(Math.abs(tc) / 100)); // max(R$ 1, 1%)
      if (Math.abs(planoC - tc) > lim) out.push('total ≠ parcela × qtd');
    }
    if (totalPagoC > tc + TOL) out.push('pago maior que o total');
    return out;
  }

  // Cobertura de cada parcela do plano:
  //  1) pagamento da própria competência (até o valor da parcela);
  //  2) pagoInicial cobre as primeiras parcelas em aberto (pago antes do plano / fora do app);
  //  3) excedentes (amortização acima da parcela e pagamentos fora do plano) cobrem as últimas.
  function analisar(dv) {
    var plano = Fin.planoParcelas(dv);
    var pagC = {}, ks = Object.keys((dv && dv.pagamentos) || {}), i;
    var somaPagC = 0, ultimoPag = null;
    for (i = 0; i < ks.length; i++) {
      var vc = c(dv.pagamentos[ks[i]]);
      if (!ymParse(ks[i]) || vc === 0) continue;
      pagC[ks[i]] = vc;
      somaPagC += vc;
      if (vc > 0 && (ultimoPag === null || ks[i] > ultimoPag)) ultimoPag = ks[i];
    }
    var noPlano = {}, excesso = 0, ps = [];
    for (i = 0; i < plano.length; i++) {
      var p = plano[i], valC = c(p.valor), mesC = pagC[p.ym] || 0;
      noPlano[p.ym] = true;
      var own = Math.max(0, Math.min(mesC, valC));
      if (mesC > valC) excesso += mesC - valC;
      ps.push({ k: p.k, ym: p.ym, valorC: valC, pagoMesC: mesC, cobertoC: own });
    }
    for (i = 0; i < ks.length; i++) if (pagC[ks[i]] && !noPlano[ks[i]]) excesso += pagC[ks[i]];
    var ini = Math.max(0, c(dv && dv.pagoInicial));
    for (i = 0; i < ps.length && ini > 0; i++) {
      var falta = ps[i].valorC - ps[i].cobertoC;
      if (falta > 0) { var t = Math.min(falta, ini); ps[i].cobertoC += t; ini -= t; }
    }
    for (i = ps.length - 1; i >= 0 && excesso > 0; i--) {
      var falta2 = ps[i].valorC - ps[i].cobertoC;
      if (falta2 > 0) { var t2 = Math.min(falta2, excesso); ps[i].cobertoC += t2; excesso -= t2; }
    }
    var totalPagoC = c(dv && dv.pagoInicial) + somaPagC;
    var totalC = c(dv && dv.total);
    var saldoC = Math.max(0, totalC - totalPagoC);
    var incons = inconsistenciasDiv(dv || {}, totalPagoC);
    var todasPagas = ps.length > 0 && ps.every(function (x) { return x.cobertoC >= x.valorC - TOL; });
    // Com 'total ≠ parcela × qtd' o total digitado não é confiável: vale só o critério das parcelas
    // (evita que um total errado, ex. 7,66 no lugar de 7.662,96, esconda as parcelas restantes).
    var totalConfiavel = incons.indexOf('total ≠ parcela × qtd') < 0;
    var quitada = !!dv && dv.situacao !== 'radar' &&
      ((totalConfiavel && totalC > 0 && saldoC <= TOL) || todasPagas);
    return { parcelas: ps, pagC: pagC, totalPagoC: totalPagoC, totalC: totalC, saldoC: saldoC,
      quitada: quitada, ultimoPag: ultimoPag, inconsistencias: incons };
  }

  Fin.divResumo = function (dv, hojeYM) {
    var hoje = hojeYM || ymHoje();
    var a = analisar(dv);
    var pagas = 0, atrasadas = 0, proxima = null, fim = null, i, p;
    for (i = 0; i < a.parcelas.length; i++) {
      p = a.parcelas[i];
      var ok = a.quitada || p.cobertoC >= p.valorC - TOL;
      if (ok) { pagas++; continue; }
      if (!proxima) proxima = { ym: p.ym, valor: r(p.valorC), falta: r(p.valorC - p.cobertoC) };
      fim = p.ym;
      if (p.ym < hoje) atrasadas++;
    }
    if (!fim && a.parcelas.length) fim = a.ultimoPag && a.ultimoPag < a.parcelas[a.parcelas.length - 1].ym ? a.ultimoPag : a.parcelas[a.parcelas.length - 1].ym;
    var status;
    if (dv.situacao === 'encerrada') status = 'encerrada';
    else if (dv.situacao === 'radar') status = 'radar';
    else if (a.quitada) status = 'quitada';
    else if (atrasadas > 0) status = 'atrasada';
    else status = 'em-dia';
    return {
      totalPago: r(a.totalPagoC), saldo: r(a.saldoC), quitada: a.quitada, status: status,
      pagas: pagas, restantes: a.parcelas.length - pagas, proxima: dv.situacao === 'radar' ? null : proxima,
      fimPrevisto: dv.situacao === 'radar' ? null : fim, atrasadas: atrasadas,
      inconsistencias: a.inconsistencias
    };
  };

  function linhasDoMes(DB, alvo, cache) {
    var out = [], dvs = (DB && DB.dividas) || [];
    for (var i = 0; i < dvs.length; i++) {
      var dv = dvs[i];
      if (!dv || dv.situacao === 'radar') continue;
      var a = cache ? (cache[dv.id] || (cache[dv.id] = analisar(dv))) : analisar(dv);
      var p = null;
      for (var j = 0; j < a.parcelas.length; j++) if (a.parcelas[j].ym === alvo) { p = a.parcelas[j]; break; }
      var mesC = a.pagC[alvo] || 0;
      var linha = { dvId: dv.id, name: '[DIV] ' + dv.name, venc: dv.venc || '', credor: dv.credor || '', ym: alvo };
      if (dv.situacao === 'encerrada') {
        // Encerrada: some o que ainda não foi pago, mas o que já saiu do caixa continua no mês em que saiu.
        if (mesC <= 0) continue;
        linha.k = p ? p.k : null; linha.qtd = a.parcelas.length; if (!p) linha.avulso = true;
        linha.valor = r(mesC); linha.pago = r(mesC); linha.status = 'Pago';
      } else if (p) {
        // Quitada: não gera parcela depois do último pagamento (quitou antes, por amortização ou fora do app).
        if (a.quitada && mesC <= 0 && (a.ultimoPag === null || alvo > a.ultimoPag)) continue;
        linha.k = p.k; linha.qtd = a.parcelas.length;
        linha.valor = r(Math.max(p.valorC, mesC));
        linha.pago = r(mesC);
        linha.status = (a.quitada || p.cobertoC >= p.valorC - TOL) ? 'Pago' : (p.cobertoC > 0 ? 'Parcial' : 'Pendente');
      } else if (mesC > 0) {
        // pagamento fora do plano (amortização avulsa): é saída de caixa daquele mês
        linha.k = null; linha.qtd = a.parcelas.length; linha.avulso = true;
        linha.valor = r(mesC); linha.pago = r(mesC); linha.status = 'Pago';
      } else continue;
      out.push(linha);
    }
    return out;
  }

  Fin.parcelasDoMes = function (DB, ano, mes0) { return linhasDoMes(DB, ym(ano, mes0), {}); };

  function parcelaDoPlano(dv, alvo) {
    var pl = Fin.planoParcelas(dv);
    for (var i = 0; i < pl.length; i++) if (pl[i].ym === alvo) return pl[i].valor;
    return null;
  }
  Fin.pagarParcela = function (dv, alvo, valor) {
    if (!ymParse(alvo)) throw new Error('Competência inválida: ' + alvo);
    var v = valor;
    if (v === undefined || v === null || v === '') {
      v = parcelaDoPlano(dv, alvo);
      if (v === null) throw new Error('Não há parcela de ' + ymRotulo(alvo) + ' no plano; informe o valor.');
    }
    if (!dv.pagamentos || typeof dv.pagamentos !== 'object') dv.pagamentos = {};
    if (c(v) <= 0) delete dv.pagamentos[alvo];
    else dv.pagamentos[alvo] = rd(v);
    return dv;
  };
  Fin.desfazerPagamento = function (dv, alvo) {
    if (dv.pagamentos) delete dv.pagamentos[alvo];
    return dv;
  };
  Fin.amortizar = function (dv, alvo, valor) {
    if (!ymParse(alvo)) throw new Error('Competência inválida: ' + alvo);
    if (c(valor) <= 0) throw new Error('Valor da amortização deve ser maior que zero.');
    if (!dv.pagamentos || typeof dv.pagamentos !== 'object') dv.pagamentos = {};
    dv.pagamentos[alvo] = r(c(dv.pagamentos[alvo]) + c(valor));
    return dv;
  };

  Fin.validarDivida = function (dv) {
    var e = [];
    if (!dv || !String(dv.name || '').trim()) e.push('Informe o nome da dívida.');
    if (!dv || c(dv.total) <= 0) e.push('O total precisa ser maior que zero.');
    if (dv && SITUACOES.indexOf(dv.situacao) < 0) e.push('Situação inválida.');
    if (dv && dv.situacao === 'ativa') {
      var falta = [];
      if (c(dv.parcela) <= 0) falta.push('valor da parcela');
      if (qtdDe(dv) < 1) falta.push('quantidade de parcelas');
      if (!ymParse(dv.inicio)) falta.push('mês de início');
      if (falta.length) e.push('Plano incompleto: falta ' + falta.join(', ') + '.');
    }
    return e;
  };

  // ===================== totais =====================
  function ano0(DB, ano) { return DB && DB.years ? DB.years[String(ano)] : null; }
  function vC(item, m) { return c(item && item.values ? item.values[m] : 0); }

  function celulaAutoPendente(item, ano, mes0, hojeYM) {
    if (!item || item.tipo !== 'fixa') return false;
    var st = item.status ? (item.status[mes0] || '') : '';
    return vC(item, mes0) > 0 && st === '' && ym(ano, mes0) <= (hojeYM || ymHoje());
  }
  Fin.celulaAutoPendente = celulaAutoPendente;
  // Derivação (não grava): {idDoItem: [12 booleanos]} das células de despesa fixa que aparecem como Pendente.
  Fin.autoPendente = function (db, ano, hojeYM) {
    var Y = ano0(db, ano), out = {};
    if (!Y) return out;
    (Y.despesas || []).forEach(function (d, idx) {
      var arr = [];
      for (var m = 0; m < 12; m++) arr.push(celulaAutoPendente(d, ano, m, hojeYM));
      out[d.id || ('#' + idx)] = arr;
    });
    return out;
  };
  // Status para exibir: o gravado ou 'Pendente' derivado.
  Fin.statusExibido = function (item, ano, mes0, hojeYM) {
    var st = item && item.status ? (item.status[mes0] || '') : '';
    return celulaAutoPendente(item, ano, mes0, hojeYM) ? 'Pendente' : st;
  };

  function totaisAnoInterno(DB, ano, hojeYM, memo, cache) {
    var k = String(ano);
    if (memo[k]) return memo[k];
    var Y = ano0(DB, k);
    if (!Y) return null;
    var prev = totaisAnoInterno(DB, Number(k) - 1, hojeYM, memo, cache);
    var sobraC = prev ? c(prev[11].saldo) : 0;
    var out = [], raw = cfgDadosRO(DB), cfg = cfgNorm(raw), meta = metaMapa(raw);
    // obrigação de cada renda (meta > listas): item nas duas listas conta só como financiamento
    var obrR = (Y.renda || []).map(function (x) { return obrigRenda(cfg, meta, x); });
    for (var m = 0; m < 12; m++) {
      var rendaC = 0, extraC = 0, finC = 0, despC = 0, resC = 0, pend = 0, i;
      (Y.renda || []).forEach(function (x, ix) {
        var v = vC(x, m); rendaC += v;
        if (obrR[ix] === 'financiamento') finC += v;
        else if (obrR[ix] === 'extra') extraC += v;
      });
      (Y.reserva || []).forEach(function (x) { resC += vC(x, m); });
      for (i = 0; i < (Y.despesas || []).length; i++) {
        var d = Y.despesas[i], st = d.status ? (d.status[m] || '') : '';
        if (st !== 'N/A') despC += vC(d, m);
        if (st === 'Pendente' || (hojeYM && celulaAutoPendente(d, k, m, hojeYM))) pend++;
      }
      var linhas = linhasDoMes(DB, ym(k, m), cache), parcC = 0;
      for (i = 0; i < linhas.length; i++) { parcC += c(linhas[i].valor); if (linhas[i].status !== 'Pago') pend++; }
      var totDespC = despC + parcC;
      var saldoC = rendaC + sobraC - totDespC;
      var operC = rendaC - extraC - finC;
      out.push({
        renda: r(rendaC), rendaExtra: r(extraC), rendaFinanc: r(finC),
        rendaOperacional: r(operC), rendaRegular: r(operC),
        resultado: r(rendaC - totDespC), resultadoSemExtras: r(operC - totDespC),
        despProprias: r(despC), parcelas: r(parcC), despesas: r(totDespC),
        reserva: r(resC), sobraAnterior: r(sobraC), saldo: r(saldoC),
        comprometimento: rendaC > 0 ? Math.round(totDespC / rendaC * 10000) / 10000 : 0,
        comprometimentoDividas: rendaC > 0 ? Math.round(parcC / rendaC * 10000) / 10000 : 0,
        pendentes: pend
      });
      sobraC = saldoC;
    }
    memo[k] = out;
    return out;
  }
  // 12 meses de uma vez (mais barato para telas e relatórios). null se o ano não existe.
  Fin.totaisAno = function (DB, ano, hojeYM) { return totaisAnoInterno(DB, ano, hojeYM, {}, {}); };
  Fin.totaisMes = function (DB, ano, mes0, hojeYM) {
    var t = Fin.totaisAno(DB, ano, hojeYM);
    return t ? t[mes0] : null;
  };

  Fin.reservaAcumulada = function (DB, ano, mes0) {
    var tot = 0, alvo = Number(ano);
    Object.keys((DB && DB.years) || {}).forEach(function (y) {
      var n = Number(y);
      if (n > alvo) return;
      var lim = n === alvo ? mes0 : 11;
      (DB.years[y].reserva || []).forEach(function (x) { for (var m = 0; m <= lim; m++) tot += vC(x, m); });
    });
    return r(tot);
  };

  // ===================== configuração do app e contas encerradas =====================
  // A configuração mora num registro da lista de divergências (tipo 'config'), porque a planilha
  // já guarda esse registro com um campo JSON livre. Não é divergência: as telas o ignoram.
  Fin.CFG_ID = 'cfg-app';
  function temNome(lista, nome) {
    var n = normNome(nome);
    for (var i = 0; i < (lista || []).length; i++) if (normNome(lista[i]) === n) return true;
    return false;
  }
  Fin.temNome = temNome;
  var CLASSES_DIV = ['emprestimo', 'compra', 'outra'];
  Fin.CLASSES_DIVIDA = CLASSES_DIV.slice();
  var LISTAS_CFG = ['rendaExtra', 'despDivida', 'assinaturas', 'rendaFinanc'];
  function cfgRegistro(DB) {
    var gs = (DB && DB.divergencias) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i] && gs[i].id === Fin.CFG_ID) return gs[i];
    return null;
  }
  // chaves conhecidas, sempre presentes e com tipo certo
  function cfgNorm(d) {
    d = d || {};
    var out = {}, i;
    for (i = 0; i < LISTAS_CFG.length; i++) out[LISTAS_CFG[i]] = Array.isArray(d[LISTAS_CFG[i]]) ? d[LISTAS_CFG[i]].map(String) : [];
    var dc = {}, src = (d.divClasse && typeof d.divClasse === 'object' && !Array.isArray(d.divClasse)) ? d.divClasse : {};
    Object.keys(src).forEach(function (k) { if (CLASSES_DIV.indexOf(src[k]) >= 0) dc[k] = src[k]; });
    out.divClasse = dc;
    return out;
  }
  // dados crus do registro de configuração (SOMENTE LEITURA: não mutar o retorno)
  function cfgDadosRO(DB) {
    var g = cfgRegistro(DB);
    return (g && g.dados && typeof g.dados === 'object' && !Array.isArray(g.dados)) ? g.dados : {};
  }
  function objOuVazio(o) { return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  function metaMapa(raw) { return objOuVazio(raw && raw.meta); }
  // {rendaExtra, despDivida, assinaturas, rendaFinanc: [nomes], divClasse: {dvId: classe}} (cópia)
  Fin.config = function (DB) {
    var g = cfgRegistro(DB);
    return cfgNorm(g && g.dados);
  };
  // Grava por cima do que já existe: chave ausente em cfg é preservada (inclusive chaves desconhecidas).
  Fin.setConfig = function (DB, cfg) {
    if (!Array.isArray(DB.divergencias)) DB.divergencias = [];
    var g = cfgRegistro(DB), dados = clone((g && g.dados) || {}) || {};
    Object.keys(cfg || {}).forEach(function (k) { if (cfg[k] !== undefined) dados[k] = clone(cfg[k]); });
    var n = cfgNorm(dados);
    Object.keys(n).forEach(function (k) { dados[k] = n[k]; });
    if (g) { g.dados = dados; return DB; }
    DB.divergencias.push({ id: Fin.CFG_ID, tipo: 'config', origem: 'app', descricao: 'Configuração do app (não é divergência)', dados: dados, status: 'resolvida' });
    return DB;
  };
  Fin.ehDivergencia = function (g) { return !!g && g.tipo !== 'config'; };
  // liga/desliga um nome numa lista da configuração (rendaExtra | despDivida | assinaturas | rendaFinanc)
  Fin.marcar = function (DB, lista, nome, ligado) {
    if (LISTAS_CFG.indexOf(lista) < 0) throw new Error('Lista de configuração inválida: ' + lista);
    var cfg = Fin.config(DB), l = cfg[lista] || [], n = normNome(nome);
    l = l.filter(function (x) { return normNome(x) !== n; });
    if (ligado) l.push(String(nome));
    cfg[lista] = l;
    // escrita pelas listas antigas: a obrigação explícita (meta) daquele nome sai, e as listas voltam a valer
    var meta = clone(metaMapa(cfgDadosRO(DB)));
    var chave = (lista === 'rendaExtra' || lista === 'rendaFinanc' ? 'r:' : 'd:') + n;
    if (meta[chave] && meta[chave].obrigacao !== undefined) {
      delete meta[chave].obrigacao;
      if (!Object.keys(meta[chave]).length) delete meta[chave];
      cfg.meta = meta;
    }
    return Fin.setConfig(DB, cfg);
  };
  // Conta encerrada: do mês em diante, tudo "N/A" e sem valor (até dezembro).
  Fin.encerradaDesde = function (item, mes0) {
    if (!item || !item.status) return false;
    for (var k = mes0; k < 12; k++) if (item.status[k] !== 'N/A' || c(item.values ? item.values[k] : 0) > 0) return false;
    return true;
  };
  // primeiro mês do encerramento (0-11) ou -1
  Fin.mesEncerramento = function (item) {
    if (!Fin.encerradaDesde(item, 11)) return -1;
    var m = 11;
    while (m > 0 && Fin.encerradaDesde(item, m - 1)) m--;
    return m;
  };
  function mesmosNomesDepois(DB, ano, nome) {
    var out = [];
    Object.keys(DB.years || {}).forEach(function (y) {
      if (Number(y) <= Number(ano)) return;
      (DB.years[y].despesas || []).forEach(function (d) { if (normNome(d.name) === normNome(nome)) out.push(d); });
    });
    return out;
  }
  // Encerra a conta a partir do mês (inclusive) e nos anos seguintes. Meses anteriores ficam como estão.
  Fin.encerrarDespesa = function (DB, ano, id, mes0) {
    var Y = DB.years[String(ano)], d = null;
    (Y && Y.despesas || []).forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return null;
    if (!d.status) d.status = s12();
    for (var k = mes0; k < 12; k++) { d.values[k] = 0; d.status[k] = 'N/A'; }
    mesmosNomesDepois(DB, ano, d.name).forEach(function (o) { o.values = z12(); o.status = ['N/A','N/A','N/A','N/A','N/A','N/A','N/A','N/A','N/A','N/A','N/A','N/A']; });
    return d;
  };
  // Reabre: tira o "N/A" do mês em diante (valores continuam zerados para preencher).
  Fin.reabrirDespesa = function (DB, ano, id, mes0) {
    var Y = DB.years[String(ano)], d = null;
    (Y && Y.despesas || []).forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return null;
    for (var k = mes0; k < 12; k++) if (d.status[k] === 'N/A') d.status[k] = '';
    mesmosNomesDepois(DB, ano, d.name).forEach(function (o) { for (var j = 0; j < 12; j++) if (o.status[j] === 'N/A') o.status[j] = ''; });
    return d;
  };

  // Ativo de mes0 em diante: algum mês k >= mes0 com valor > 0 e status diferente de 'N/A'.
  Fin.ativoDesde = function (item, mes0) {
    if (!item) return false;
    for (var k = Math.max(0, Number(mes0) || 0); k < 12; k++) {
      var st = item.status ? item.status[k] : '';
      if (vC(item, k) > 0 && st !== 'N/A') return true;
    }
    return false;
  };

  // ===================== classificação: cartões, dívidas, despesas =====================
  Fin.CARTOES = [{ k: 'nubank', n: 'Nubank' }, { k: 'itau', n: 'Itaú' }, { k: 'santander', n: 'Santander' }];
  // chave do cartão citado no texto ('Limite Itaú', 'Mercado (Nubank)', 'nubank') ou null
  function cartaoDe(txt) {
    var n = normNome(txt);
    if (!n) return null;
    for (var i = 0; i < Fin.CARTOES.length; i++) {
      var cd = Fin.CARTOES[i];
      if (n === cd.k || n.indexOf(normNome(cd.n)) >= 0) return cd.k;
    }
    return null;
  }
  Fin.cartaoDe = cartaoDe;

  var RE_EMPRESTIMO = /financiamento|empr[eé]stimo|cons[oó]rcio/i;
  function classeDivCfg(cfg, dv) {
    if (!dv) return 'outra';
    var ov = cfg.divClasse[dv.id];
    if (CLASSES_DIV.indexOf(ov) >= 0) return ov;
    if (RE_EMPRESTIMO.test(String(dv.name || ''))) return 'emprestimo';
    if (cartaoDe(dv.credor) || cartaoDe(dv.name)) return 'compra';
    return 'outra';
  }
  // cartão da dívida pela heurística antiga: null quando é empréstimo/financiamento ou não cita cartão
  function cartaoDivCfg(cfg, dv) {
    if (!dv || classeDivCfg(cfg, dv) === 'emprestimo') return null;
    return cartaoDe(dv.credor) || cartaoDe(dv.name);
  }
  function temProp(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function chaveCartaoValida(k) {
    for (var i = 0; i < Fin.CARTOES.length; i++) if (Fin.CARTOES[i].k === k) return true;
    return false;
  }
  // cartão explícito na meta: '' = "sem cartão" (null); chave válida = aquele cartão; ausente = automático (undefined)
  function cartaoMeta(mt) {
    if (!temProp(mt, 'cartao')) return undefined;
    if (mt.cartao === '' || mt.cartao === null) return null;
    return chaveCartaoValida(mt.cartao) ? mt.cartao : undefined;
  }
  function cartaoDivMeta(cfg, meta, dv) {
    if (!dv) return null;
    var cm = cartaoMeta(meta['dv:' + dv.id]);
    return cm !== undefined ? cm : cartaoDivCfg(cfg, dv);
  }
  function cartaoDespMeta(meta, d) {
    if (!d) return null;
    var cm = cartaoMeta(meta['d:' + normNome(d.name)]);
    return cm !== undefined ? cm : cartaoDe(d.name);
  }
  // 'emprestimo' | 'compra' | 'outra' (override da configuração > nome > cartão no credor/nome)
  Fin.classeDivida = function (DB, dv) { return classeDivCfg(Fin.config(DB), dv); };
  // chave do cartão da dívida (meta > heurística); null quando empréstimo ou sem cartão
  Fin.cartaoDivida = function (DB, dv) { var raw = cfgDadosRO(DB); return cartaoDivMeta(cfgNorm(raw), metaMapa(raw), dv); };
  // classe null/'' remove o override
  Fin.setDivClasse = function (DB, dvId, classe) {
    var cfg = Fin.config(DB);
    if (classe === null || classe === undefined || classe === '') delete cfg.divClasse[dvId];
    else if (CLASSES_DIV.indexOf(classe) >= 0) cfg.divClasse[dvId] = classe;
    else throw new Error('Classe de dívida inválida: ' + classe);
    return Fin.setConfig(DB, cfg);
  };

  // Fin.cartaoDespesa(d): só pelo nome (compatibilidade). Fin.cartaoDespesa(DB, d): dimensão cartão (meta > nome).
  Fin.cartaoDespesa = function (a, b) {
    if (arguments.length >= 2) return cartaoDespMeta(metaMapa(cfgDadosRO(a)), b);
    return cartaoDe(a && a.name);
  };
  // 'assinatura' | 'cartao' | 'divida' | 'fixa' | 'variavel' (obrigação 'conta' vira o tipo do item)
  Fin.classeDespesa = function (DB, d) {
    var raw = cfgDadosRO(DB), o = obrigDesp(cfgNorm(raw), metaMapa(raw), d);
    return o === 'conta' ? (d && d.tipo === 'fixa' ? 'fixa' : 'variavel') : o;
  };

  // ===================== [15/11 b] dimensões do registro =====================
  // ref = {kind:'desp', ano, item} | {kind:'renda', ano, item} | {kind:'div', item: dv}
  // meta em config.meta: 'd:'+normNome(nome) | 'r:'+normNome(nome) | 'dv:'+id (cópias planejadas de anos
  // diferentes compartilham a meta pelo nome).
  var OBRIGACOES = {
    desp: ['conta', 'assinatura', 'cartao', 'divida'],
    renda: ['renda', 'extra', 'financiamento'],
    div: ['compra', 'emprestimo', 'outra']
  };
  var MEIOS = ['pix', 'dinheiro', 'debito', 'credito', 'boleto', 'transferencia', ''];
  var COMPORTAMENTOS = ['fixa', 'variavel'];
  var CAMPOS_DIM = ['obrigacao', 'comportamento', 'categoria', 'subcategoria', 'meio', 'cartao'];
  Fin.OBRIGACOES = clone(OBRIGACOES);
  Fin.MEIOS = MEIOS.slice();

  function checarRef(ref) {
    if (!ref || !ref.item || !OBRIGACOES[ref.kind]) throw new Error('Referência de registro inválida.');
  }
  function chaveMeta(ref) {
    checarRef(ref);
    if (ref.kind === 'div') return 'dv:' + ref.item.id;
    return (ref.kind === 'desp' ? 'd:' : 'r:') + normNome(ref.item.name);
  }
  Fin.chaveMeta = chaveMeta;

  function obrigDesp(cfg, meta, d) {
    var nome = d && d.name, mt = meta['d:' + normNome(nome)];
    if (mt && OBRIGACOES.desp.indexOf(mt.obrigacao) >= 0) return mt.obrigacao;
    if (temNome(cfg.assinaturas, nome)) return 'assinatura';
    if (cartaoDespMeta(meta, d)) return 'cartao';
    if (temNome(cfg.despDivida, nome)) return 'divida';
    return 'conta';
  }
  function obrigRenda(cfg, meta, x) {
    var nome = x && x.name, mt = meta['r:' + normNome(nome)];
    if (mt && OBRIGACOES.renda.indexOf(mt.obrigacao) >= 0) return mt.obrigacao;
    if (temNome(cfg.rendaFinanc, nome)) return 'financiamento';
    if (temNome(cfg.rendaExtra, nome)) return 'extra';
    return 'renda';
  }

  function dimInterno(DB, raw, ref) {
    var cfg = cfgNorm(raw), meta = metaMapa(raw), key = chaveMeta(ref), mt = objOuVazio(meta[key]);
    var it = ref.item, kind = ref.kind, icones = objOuVazio(raw.icones), o = {};
    o.natureza = kind === 'desp' ? 'despesa' : (kind === 'renda' ? 'renda' : 'divida');
    if (kind === 'desp') o.obrigacao = obrigDesp(cfg, meta, it);
    else if (kind === 'renda') o.obrigacao = obrigRenda(cfg, meta, it);
    else o.obrigacao = classeDivCfg(cfg, it);
    // desp/renda: o comportamento mora em item.tipo (setDim grava em todas as cópias de mesmo nome)
    if (kind === 'div') o.comportamento = COMPORTAMENTOS.indexOf(mt.comportamento) >= 0 ? mt.comportamento : 'variavel';
    else o.comportamento = it.tipo === 'fixa' ? 'fixa' : 'variavel';
    var ic = icones[normNome(it.name)];
    o.categoria = (typeof mt.categoria === 'string' && mt.categoria) ? mt.categoria
      : ((typeof ic === 'string' && ic) ? ic : Fin.categoriaPorNome(it.name));
    o.subcategoria = typeof mt.subcategoria === 'string' ? mt.subcategoria : '';
    if (kind === 'div') o.cartao = cartaoDivMeta(cfg, meta, it);
    else if (kind === 'desp') o.cartao = cartaoDespMeta(meta, it);
    else { var cr = cartaoMeta(mt); o.cartao = cr === undefined ? null : cr; }
    if (temProp(mt, 'meio') && MEIOS.indexOf(mt.meio) >= 0) o.meio = mt.meio;
    else if (kind === 'div') o.meio = o.obrigacao === 'compra' ? 'credito' : '';
    else if (kind === 'desp') o.meio = (o.obrigacao === 'cartao' || o.cartao) ? 'credito' : '';
    else o.meio = '';
    if (kind === 'div') {
      var res = Fin.divResumo(it, ymHoje()), q = qtdDe(it);
      o.recorrencia = it.situacao === 'radar' ? 'indefinida' : (q > 1 ? 'parcelada' : (q === 1 ? 'unica' : 'indefinida'));
      o.parcelas = { qtd: q, pagas: res.pagas, restantes: res.restantes };
    } else {
      o.recorrencia = (o.comportamento === 'fixa' || o.obrigacao === 'assinatura') ? 'mensal' : 'variavel';
      o.parcelas = null;
    }
    o.chave = key;
    return o;
  }
  // todas as dimensões do registro: meta quando gravada; senão derivadas das listas antigas e do nome
  Fin.dim = function (DB, ref) { return dimInterno(DB, cfgDadosRO(DB), ref); };

  function itensMesmoNome(DB, kind, nome) {
    var out = [], n = normNome(nome), lista = kind === 'desp' ? 'despesas' : 'renda';
    Object.keys((DB && DB.years) || {}).forEach(function (y) {
      ((DB.years[y] || {})[lista] || []).forEach(function (x) { if (x && normNome(x.name) === n) out.push(x); });
    });
    return out;
  }
  function listaSet(cfg, lista, nome, ligado) {
    var n = normNome(nome);
    cfg[lista] = (cfg[lista] || []).filter(function (x) { return normNome(x) !== n; });
    if (ligado) cfg[lista].push(String(nome));
  }

  // Grava as dimensões (só os campos conhecidos). null/undefined = volta ao automático.
  // Nunca mexe em valores, status nem pagamentos. Devolve Fin.dim atualizado.
  Fin.setDim = function (DB, ref, patch) {
    var key = chaveMeta(ref), kind = ref.kind, it = ref.item;
    patch = patch || {};
    var campos = Object.keys(patch).filter(function (k) { return CAMPOS_DIM.indexOf(k) >= 0; });
    var cats = null;
    // 1) valida tudo antes de gravar qualquer coisa
    campos.forEach(function (k) {
      var v = patch[k];
      if (v === null || v === undefined) return;
      if (k === 'obrigacao' && OBRIGACOES[kind].indexOf(v) < 0) throw new Error('Obrigação inválida para este registro: ' + v);
      if (k === 'comportamento' && COMPORTAMENTOS.indexOf(v) < 0) throw new Error('Comportamento inválido: ' + v);
      if (k === 'meio' && MEIOS.indexOf(v) < 0) throw new Error('Meio de pagamento inválido: ' + v);
      if (k === 'cartao' && v !== '' && !chaveCartaoValida(v)) throw new Error('Cartão inválido: ' + v);
      if (k === 'categoria') {
        cats = cats || Fin.categorias(DB);
        if (!cats.some(function (c0) { return c0.k === v; })) throw new Error('Categoria inexistente: ' + v);
      }
      if (k === 'subcategoria' && typeof v !== 'string') throw new Error('Subcategoria deve ser texto.');
    });
    // 2) aplica
    var raw = cfgDadosRO(DB), cfg = cfgNorm(raw), meta = clone(metaMapa(raw));
    var icones = clone(objOuVazio(raw.icones)), mexeuIcones = false;
    var mt = objOuVazio(meta[key]), nIc = normNome(it.name);
    campos.forEach(function (k) {
      var v = patch[k], limpar = v === null || v === undefined;
      if (k === 'obrigacao') {
        if (kind === 'div') {
          if (limpar) delete cfg.divClasse[it.id]; else cfg.divClasse[it.id] = v;
        } else if (kind === 'desp') {
          if (limpar) delete mt.obrigacao; else mt.obrigacao = v;
          listaSet(cfg, 'assinaturas', it.name, v === 'assinatura');
          listaSet(cfg, 'despDivida', it.name, v === 'divida');
        } else {
          if (limpar) delete mt.obrigacao; else mt.obrigacao = v;
          listaSet(cfg, 'rendaExtra', it.name, v === 'extra');
          listaSet(cfg, 'rendaFinanc', it.name, v === 'financiamento');
        }
      } else if (k === 'comportamento') {
        if (limpar) { if (kind === 'div') delete mt.comportamento; return; }
        if (kind === 'div') { mt.comportamento = v; return; }
        it.tipo = v;
        itensMesmoNome(DB, kind, it.name).forEach(function (x) { x.tipo = v; });
      } else if (k === 'categoria') {
        mexeuIcones = true;
        if (limpar) { delete mt.categoria; delete icones[nIc]; } else { mt.categoria = v; icones[nIc] = v; }
      } else if (k === 'subcategoria') {
        var s = limpar ? '' : String(v).trim();
        if (s) mt.subcategoria = s; else delete mt.subcategoria;
      } else if (k === 'meio' || k === 'cartao') {
        if (limpar) delete mt[k]; else mt[k] = v;
      }
    });
    if (Object.keys(mt).length) meta[key] = mt; else delete meta[key];
    var upd = { rendaExtra: cfg.rendaExtra, despDivida: cfg.despDivida, assinaturas: cfg.assinaturas,
      rendaFinanc: cfg.rendaFinanc, divClasse: cfg.divClasse, meta: meta };
    if (mexeuIcones) upd.icones = icones;
    Fin.setConfig(DB, upd);
    return Fin.dim(DB, ref);
  };

  // Leva a meta (e a presença nas listas antigas e em 'icones') do nome antigo para o novo.
  // kind 'desp' | 'renda'. Dívida usa o id: nada a mover. Não renomeia os itens.
  Fin.renomearMeta = function (DB, kind, nomeAntigo, nomeNovo) {
    if (kind !== 'desp' && kind !== 'renda') return DB;
    var a = normNome(nomeAntigo), b = normNome(nomeNovo);
    if (!b) throw new Error('Informe o novo nome.');
    var raw = cfgDadosRO(DB), cfg = cfgNorm(raw), meta = clone(metaMapa(raw)), icones = clone(objOuVazio(raw.icones));
    var pre = kind === 'desp' ? 'd:' : 'r:';
    if (meta[pre + a] && a !== b) {
      var junto = objOuVazio(meta[pre + b]), velho = meta[pre + a];
      Object.keys(velho).forEach(function (k) { junto[k] = velho[k]; });
      meta[pre + b] = junto;
      delete meta[pre + a];
    }
    var listas = kind === 'desp' ? ['assinaturas', 'despDivida'] : ['rendaExtra', 'rendaFinanc'];
    listas.forEach(function (l) {
      if (!temNome(cfg[l], nomeAntigo)) return;
      listaSet(cfg, l, nomeAntigo, false);
      listaSet(cfg, l, nomeNovo, true);
    });
    var upd = { meta: meta };
    listas.forEach(function (l) { upd[l] = cfg[l]; });
    if (temProp(icones, a) && a !== b) { icones[b] = icones[a]; delete icones[a]; upd.icones = icones; }
    return Fin.setConfig(DB, upd);
  };

  // ---------- atividade, visibilidade e status do mês (independentes da classificação) ----------
  function anoRef(ref) { return String(ref && ref.ano ? ref.ano : new Date().getFullYear()); }
  // desp: 'ativa' | 'sem-cobranca' | 'encerrada' ('cancelada' se assinatura); renda: 'ativa' | 'sem-cobranca';
  // div: 'ativa' | 'radar' | 'quitada' | 'encerrada'
  Fin.atividade = function (DB, ref, mes0) {
    checarRef(ref);
    var it = ref.item, m = Math.max(0, Math.min(11, Math.floor(Number(mes0) || 0)));
    if (ref.kind === 'div') {
      var st = Fin.divResumo(it, ym(anoRef(ref), m)).status;
      if (st === 'quitada' || st === 'encerrada' || st === 'radar') return st;
      return 'ativa';
    }
    if (ref.kind === 'desp' && Fin.encerradaDesde(it, m)) {
      var raw = cfgDadosRO(DB);
      return obrigDesp(cfgNorm(raw), metaMapa(raw), it) === 'assinatura' ? 'cancelada' : 'encerrada';
    }
    return Fin.ativoDesde(it, m) ? 'ativa' : 'sem-cobranca';
  };
  // 'principal' (ativa ou radar) | 'historico'
  Fin.visivel = function (DB, ref, mes0) {
    var a = Fin.atividade(DB, ref, mes0);
    return a === 'ativa' || a === 'radar' ? 'principal' : 'historico';
  };
  // status de pagamento só daquele mês. desp: statusExibido; div: status da linha do mês ou null; renda: gravado ou null
  Fin.statusMes = function (DB, ref, mes0, hojeYM) {
    checarRef(ref);
    var ano = anoRef(ref);
    if (ref.kind === 'desp') return Fin.statusExibido(ref.item, ano, mes0, hojeYM);
    if (ref.kind === 'renda') return ref.item.status ? (ref.item.status[mes0] || '') : null;
    var ls = linhasDoMes(DB, ym(ano, mes0), {});
    for (var i = 0; i < ls.length; i++) if (ls[i].dvId === ref.item.id) return ls[i].status;
    return null;
  };

  // ---------- filtros por dimensão ----------
  Fin.FILTROS = ['todas', 'fixas', 'variaveis', 'assinaturas', 'cartoes', 'dividas'];
  Fin.passaFiltro = function (DB, ref, chave) {
    if (Fin.FILTROS.indexOf(chave) < 0) throw new Error('Filtro inválido: ' + chave);
    if (chave === 'todas') return true;
    var d = Fin.dim(DB, ref);
    switch (chave) {
      case 'fixas': return d.comportamento === 'fixa' && d.obrigacao === 'conta';
      case 'variaveis': return d.comportamento === 'variavel' && d.obrigacao === 'conta';
      case 'assinaturas': return d.obrigacao === 'assinatura';
      case 'cartoes': return d.cartao !== null || d.obrigacao === 'cartao' || (d.natureza === 'divida' && d.obrigacao === 'compra');
      default: return d.natureza === 'divida' || d.obrigacao === 'divida';
    }
  };

  // ---------- categorias ----------
  Fin.CATEGORIAS = [
    { k: 'casa', n: 'Casa e moradia', icone: '🏠' },
    { k: 'contas', n: 'Luz, água e gás', icone: '💡' },
    { k: 'telefone', n: 'Telefone e internet', icone: '📱' },
    { k: 'mercado', n: 'Mercado', icone: '🛒' },
    { k: 'alimentacao', n: 'Restaurante e delivery', icone: '🍽️' },
    { k: 'transporte', n: 'Transporte e carro', icone: '🚗' },
    { k: 'saude', n: 'Saúde', icone: '🩺' },
    { k: 'educacao', n: 'Educação', icone: '🎓' },
    { k: 'lazer', n: 'Lazer e assinaturas', icone: '🎬' },
    { k: 'roupas', n: 'Roupas e beleza', icone: '👕' },
    { k: 'presentes', n: 'Presentes', icone: '🎁' },
    { k: 'itens-casa', n: 'Itens para casa', icone: '🛋️' },
    { k: 'viagem', n: 'Viagem', icone: '✈️' },
    { k: 'pets', n: 'Pets', icone: '🐾' },
    { k: 'financeiro', n: 'Banco, taxas e empréstimos', icone: '🏦' },
    { k: 'impostos', n: 'Impostos e documentos', icone: '📋' },
    { k: 'renda', n: 'Salário e renda', icone: '💰' },
    { k: 'outros', n: 'Outros', icone: '📌' }
  ];
  // ordem importa: o primeiro grupo com a palavra inteira (ou no plural com 's') ganha
  var PALAVRAS_CAT = [
    ['impostos', ['das', 'iptu', 'ipva', 'imposto']],
    ['financeiro', ['emprestimo', 'consorcio', 'financiamento', 'limite', 'banco']],
    ['casa', ['aluguel', 'condominio', 'garagem', 'limpeza', 'moradia']],
    ['contas', ['luz', 'agua', 'gas', 'energia']],
    ['telefone', ['vivo', 'claro', 'tim', 'internet']],
    ['mercado', ['mercado', 'supermercado', 'padaria']],
    ['alimentacao', ['restaurante', 'ifood', 'delivery']],
    ['transporte', ['uber', 'gasolina', 'combustivel', 'carro', 'seguro carro', 'licenciamento', 'multa', 'tag', 'estacionamento']],
    ['saude', ['farmacia', 'convenio', 'dentista', 'remedio', 'gympass', 'academia']],
    ['educacao', ['faculdade', 'curso', 'livro', 'kindle', 'escola']],
    ['lazer', ['netflix', 'spotify', 'spotfy', 'claude', 'icloud', 'amazon']],
    ['roupas', ['renner', 'c&a', 'h&m', 'roupa', 'tenis', 'barbearia', 'barbeiro', 'maquiagem', 'perfume']],
    ['presentes', ['presente']],
    ['viagem', ['viagem', 'airbnb', 'passeio']],
    ['pets', ['pet', 'racao', 'veterinario']],
    ['renda', ['salario', 'comissao', '13º', '13°', 'ferias', 'plr', 'vale']]
  ];
  function palavras(s) { return normNome(s).replace(/[^a-z0-9º°&]+/g, ' ').trim(); }
  // chave de categoria adivinhada pelo nome; 'outros' quando nada bate
  Fin.categoriaPorNome = function (nome) {
    var p = palavras(nome);
    if (!p) return 'outros';
    var s = ' ' + p + ' ';
    for (var i = 0; i < PALAVRAS_CAT.length; i++) {
      var ws = PALAVRAS_CAT[i][1];
      for (var j = 0; j < ws.length; j++) {
        var w = palavras(ws[j]);
        if (s.indexOf(' ' + w + ' ') >= 0 || s.indexOf(' ' + w + 's ') >= 0) return PALAVRAS_CAT[i][0];
      }
    }
    return 'outros';
  };
  function catsCfg(raw) { return objOuVazio(raw && raw.categorias); }
  // padrões (com nome/ícone editados) + personalizadas: [{k, n, icone, padrao}]
  Fin.categorias = function (DB) {
    var ov = catsCfg(cfgDadosRO(DB)), out = [], vistos = {};
    Fin.CATEGORIAS.forEach(function (c0) {
      var o = objOuVazio(ov[c0.k]);
      out.push({ k: c0.k, n: (typeof o.n === 'string' && o.n.trim()) ? o.n : c0.n,
        icone: (typeof o.icone === 'string' && o.icone) ? o.icone : c0.icone, padrao: true });
      vistos[c0.k] = true;
    });
    Object.keys(ov).forEach(function (k) {
      if (vistos[k]) return;
      var o = objOuVazio(ov[k]);
      if (typeof o.n !== 'string' || !o.n.trim()) return;
      out.push({ k: k, n: o.n, icone: (typeof o.icone === 'string' && o.icone) ? o.icone : '📌', padrao: false });
    });
    return out;
  };
  // edita nome e/ou ícone de uma categoria existente (padrão ou personalizada)
  Fin.setCategoria = function (DB, k, dados) {
    if (!Fin.categorias(DB).some(function (c0) { return c0.k === k; })) throw new Error('Categoria inexistente: ' + k);
    dados = dados || {};
    var cats = clone(catsCfg(cfgDadosRO(DB))), o = objOuVazio(cats[k]);
    if (dados.n !== undefined) {
      var n = String(dados.n == null ? '' : dados.n).trim();
      if (!n) throw new Error('Informe o nome da categoria.');
      o.n = n;
    }
    if (dados.icone !== undefined && String(dados.icone || '').trim()) o.icone = String(dados.icone).trim();
    cats[k] = o;
    Fin.setConfig(DB, { categorias: cats });
    return k;
  };
  // cria categoria personalizada; devolve a chave (slug único)
  Fin.addCategoria = function (DB, dados) {
    dados = dados || {};
    var n = String(dados.n == null ? '' : dados.n).trim();
    if (!n) throw new Error('Informe o nome da categoria.');
    var base = normNome(n).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'categoria';
    var existentes = {};
    Fin.categorias(DB).forEach(function (c0) { existentes[c0.k] = true; });
    var k = base, i = 2;
    while (existentes[k]) k = base + '-' + (i++);
    var cats = clone(catsCfg(cfgDadosRO(DB)));
    cats[k] = { n: n, icone: String(dados.icone || '').trim() || '📌' };
    Fin.setConfig(DB, { categorias: cats });
    return k;
  };
  Fin.iconeCategoria = function (DB, k) {
    var cs = Fin.categorias(DB);
    for (var i = 0; i < cs.length; i++) if (cs[i].k === k) return cs[i].icone;
    return '📌';
  };

  // ---------- conversão de despesa em dívida (prévia, aplicação, desfazer) ----------
  // Meses do ano com valor > 0 e status ≠ 'N/A'. Pagamentos só dos meses 'Pago' (nunca inventa datas).
  // Para o saldo de cada mês ficar idêntico, os meses precisam ser seguidos e com o mesmo valor
  // (a dívida tem parcela única); senão ok=false e motivo explica.
  Fin.previaConverterEmDivida = function (DB, ano, despId) {
    var d = despesaPorId(DB, ano, despId);
    if (!d) throw new Error('Despesa não encontrada.');
    var meses = [], pag = {}, i, totC = 0;
    for (var m = 0; m < 12; m++) {
      var st = d.status ? (d.status[m] || '') : '';
      if (vC(d, m) <= 0 || st === 'N/A') continue;
      meses.push(m);
      totC += vC(d, m);
      if (st === 'Pago') pag[ym(ano, m)] = r(vC(d, m));
    }
    var out = { nome: d.name, total: r(totC), qtd: meses.length, inicio: meses.length ? ym(ano, meses[0]) : '',
      parcela: meses.length ? r(vC(d, meses[0])) : 0, pagamentos: pag, mesesAfetados: meses, ok: true, motivo: '' };
    if (!meses.length) { out.ok = false; out.motivo = 'A despesa não tem meses com valor neste ano.'; return out; }
    for (i = 1; i < meses.length; i++) {
      if (meses[i] !== meses[i - 1] + 1) { out.ok = false; out.motivo = 'Os meses com valor não são seguidos: a parcela cairia em mês sem cobrança.'; return out; }
      if (vC(d, meses[i]) !== vC(d, meses[0])) { out.ok = false; out.motivo = 'Os valores mudam de um mês para outro: a dívida tem parcela única.'; return out; }
    }
    return out;
  };
  // opcoes: {credor, classe:'compra'|'emprestimo'|'outra', cartao, agora: Date|ISO}. Muta DB; devolve token.
  Fin.converterEmDivida = function (DB, ano, despId, opcoes) {
    opcoes = opcoes || {};
    var pv = Fin.previaConverterEmDivida(DB, ano, despId);
    if (!pv.ok) throw new Error(pv.motivo);
    if (opcoes.classe != null && opcoes.classe !== '' && CLASSES_DIV.indexOf(opcoes.classe) < 0) throw new Error('Classe de dívida inválida: ' + opcoes.classe);
    if (opcoes.cartao != null && opcoes.cartao !== '' && !chaveCartaoValida(opcoes.cartao)) throw new Error('Cartão inválido: ' + opcoes.cartao);
    var d = despesaPorId(DB, ano, despId);
    var iso = (opcoes.agora ? new Date(opcoes.agora) : new Date()).toISOString();
    var raw0 = cfgDadosRO(DB), tinhaCfg = !!cfgRegistro(DB), tinhaMeta = temProp(raw0, 'meta');
    var cat = dimInterno(DB, raw0, { kind: 'desp', ano: String(ano), item: d }).categoria;
    var dKey = 'd:' + normNome(d.name), metaAntes = temProp(metaMapa(raw0), dKey) ? clone(metaMapa(raw0)[dKey]) : null;
    var dv = {
      id: Fin.novoId('dv'), name: d.name, credor: String(opcoes.credor || ''),
      obs: 'Convertida da despesa "' + d.name + '" em ' + iso.slice(0, 10), venc: d.venc || '',
      total: pv.total, situacao: 'ativa', parcela: pv.parcela, qtd: pv.qtd, inicio: pv.inicio,
      pagoInicial: 0, pagamentos: clone(pv.pagamentos), flags: [], criadoEm: iso
    };
    var valores = [], status = [];
    if (!d.status) d.status = s12();
    pv.mesesAfetados.forEach(function (m) {
      valores.push(d.values[m]); status.push(d.status[m] || '');
      d.values[m] = 0; d.status[m] = 'N/A';
    });
    if (!Array.isArray(DB.dividas)) DB.dividas = [];
    DB.dividas.push(dv);
    var meta = clone(metaMapa(cfgDadosRO(DB))), cfg = Fin.config(DB);
    var mtD = objOuVazio(meta[dKey]);
    mtD.convertido = { para: dv.id, meses: pv.mesesAfetados.slice(), valores: valores.slice(), status: status.slice() };
    meta[dKey] = mtD;
    var mtV = { categoria: cat };
    if (opcoes.cartao != null) mtV.cartao = opcoes.cartao;
    meta['dv:' + dv.id] = mtV;
    var upd = { meta: meta };
    if (opcoes.classe) { cfg.divClasse[dv.id] = opcoes.classe; upd.divClasse = cfg.divClasse; }
    Fin.setConfig(DB, upd);
    return { ano: String(ano), despId: despId, dvId: dv.id, meses: pv.mesesAfetados.slice(), valores: valores,
      status: status, metaKey: dKey, metaAntes: metaAntes, tinhaCfg: tinhaCfg, tinhaMeta: tinhaMeta };
  };
  // restaura exatamente o estado anterior à conversão (despesa, dívida e o que a conversão gravou na configuração)
  Fin.desfazerConversao = function (DB, token) {
    if (!token || !token.dvId) return DB;
    var d = despesaPorId(DB, token.ano, token.despId);
    if (d) {
      if (!d.status) d.status = s12();
      token.meses.forEach(function (m, i) { d.values[m] = token.valores[i]; d.status[m] = token.status[i]; });
    }
    DB.dividas = (DB.dividas || []).filter(function (x) { return !x || x.id !== token.dvId; });
    if (!token.tinhaCfg) {
      DB.divergencias = (DB.divergencias || []).filter(function (g) { return !g || g.id !== Fin.CFG_ID; });
      return DB;
    }
    var meta = clone(metaMapa(cfgDadosRO(DB))), cfg = Fin.config(DB);
    delete meta['dv:' + token.dvId];
    if (token.metaAntes) meta[token.metaKey] = clone(token.metaAntes); else delete meta[token.metaKey];
    delete cfg.divClasse[token.dvId];
    Fin.setConfig(DB, { meta: meta, divClasse: cfg.divClasse });
    if (!token.tinhaMeta && !Object.keys(meta).length) delete cfgRegistro(DB).dados.meta;
    return DB;
  };

  // ===================== faturas de cartão =====================
  function dividaPorId(DB, id) {
    var dvs = (DB && DB.dividas) || [];
    for (var i = 0; i < dvs.length; i++) if (dvs[i] && dvs[i].id === id) return dvs[i];
    return null;
  }
  function despesaPorId(DB, ano, id) {
    var Y = ano0(DB, ano), ds = (Y && Y.despesas) || [];
    for (var i = 0; i < ds.length; i++) if (ds[i] && ds[i].id === id) return ds[i];
    return null;
  }
  // { itens:[...], total, pago, falta } em reais. Parcela com status 'Pago' (coberta por pagoInicial ou
  // amortização, mesmo sem pagamento no mês) conta como paga por inteiro.
  Fin.faturaDoMes = function (DB, ano, mes0, cartaoKey) {
    var raw = cfgDadosRO(DB), cfg = cfgNorm(raw), meta = metaMapa(raw), itens = [], totC = 0, pagoC = 0;
    if (!cartaoKey) return { itens: itens, total: 0, pago: 0, falta: 0 };
    Fin.parcelasDoMes(DB, ano, mes0).forEach(function (l) {
      var dv = dividaPorId(DB, l.dvId);
      if (!dv || cartaoDivMeta(cfg, meta, dv) !== cartaoKey) return;
      var valC = c(l.valor), pC = l.status === 'Pago' ? valC : Math.min(valC, c(l.pago));
      itens.push({ tipo: 'parcela', dvId: l.dvId, name: dv.name, valor: r(valC), pago: r(pC), status: l.status, k: l.k, qtd: l.qtd });
      totC += valC; pagoC += pC;
    });
    var Y = ano0(DB, ano);
    ((Y && Y.despesas) || []).forEach(function (d) {
      if (cartaoDespMeta(meta, d) !== cartaoKey) return;
      var st = d.status ? (d.status[mes0] || '') : '', valC = vC(d, mes0);
      if (valC <= 0 || st === 'N/A') return;
      itens.push({ tipo: 'despesa', id: d.id, name: d.name, valor: r(valC), status: st });
      totC += valC;
      if (st === 'Pago') pagoC += valC;
    });
    return { itens: itens, total: r(totC), pago: r(pagoC), falta: r(Math.max(0, totC - pagoC)) };
  };
  // Paga a fatura inteira do mês (muta DB). Parcela em aberto recebe pagamentos[ym] = valor da linha
  // (a linha continua com o mesmo valor: não há dupla contagem); despesa do cartão vira 'Pago'.
  // Devolve o token para desfazerFatura.
  Fin.pagarFatura = function (DB, ano, mes0, cartaoKey) {
    var tok = { parc: [], desp: [] }, alvo = ym(ano, mes0), raw = cfgDadosRO(DB), cfg = cfgNorm(raw), meta = metaMapa(raw);
    if (!cartaoKey) return tok;
    Fin.parcelasDoMes(DB, ano, mes0).forEach(function (l) {
      var dv = dividaPorId(DB, l.dvId);
      if (!dv || cartaoDivMeta(cfg, meta, dv) !== cartaoKey || l.status === 'Pago') return;
      var tem = dv.pagamentos && Object.prototype.hasOwnProperty.call(dv.pagamentos, alvo);
      tok.parc.push({ dvId: dv.id, ym: alvo, antes: tem ? dv.pagamentos[alvo] : null });
      Fin.pagarParcela(dv, alvo, l.valor);
    });
    var Y = ano0(DB, ano);
    ((Y && Y.despesas) || []).forEach(function (d) {
      if (cartaoDespMeta(meta, d) !== cartaoKey || vC(d, mes0) <= 0) return;
      if (!d.status) d.status = s12();
      var st = d.status[mes0] || '';
      if (st === 'Pago' || st === 'N/A') return;
      tok.desp.push({ ano: String(ano), id: d.id, m: mes0, antes: st });
      d.status[mes0] = 'Pago';
    });
    return tok;
  };
  Fin.desfazerFatura = function (DB, token) {
    var i, t;
    var parc = (token && token.parc) || [], desp = (token && token.desp) || [];
    for (i = parc.length - 1; i >= 0; i--) {
      t = parc[i];
      var dv = dividaPorId(DB, t.dvId);
      if (!dv) continue;
      if (!dv.pagamentos || typeof dv.pagamentos !== 'object') dv.pagamentos = {};
      if (t.antes === null || t.antes === undefined) delete dv.pagamentos[t.ym];
      else dv.pagamentos[t.ym] = t.antes;
    }
    for (i = desp.length - 1; i >= 0; i--) {
      t = desp[i];
      var d = despesaPorId(DB, t.ano, t.id);
      if (!d) continue;
      if (!d.status) d.status = s12();
      d.status[t.m] = t.antes || '';
    }
    return DB;
  };

  // ===================== mutações de planejamento =====================
  Fin.virarAno = function (DB, novoAno) {
    var k = String(novoAno);
    if (!DB.years) DB.years = {};
    if (DB.years[k]) return null; // nunca sobrescreve
    var anteriores = Object.keys(DB.years).filter(function (y) { return Number(y) < Number(k); })
      .sort(function (a, b) { return Number(a) - Number(b); });
    var src = anteriores.length ? DB.years[anteriores[anteriores.length - 1]] : { despesas: [], renda: [], reserva: [] };
    function doze(x) { var v = rd(x && x.values ? x.values[11] : 0); return [v, v, v, v, v, v, v, v, v, v, v, v]; }
    var novo = {
      despesas: (src.despesas || []).filter(function (d) { return !Fin.encerradaDesde(d, 11); }).map(function (d) {
        return { id: Fin.novoId('d'), name: d.name, venc: d.venc || '', tipo: d.tipo === 'fixa' ? 'fixa' : 'variavel',
          values: d.tipo === 'fixa' ? doze(d) : z12(), status: s12() };
      }),
      renda: (src.renda || []).map(function (x) {
        return { id: Fin.novoId('r'), name: x.name, tipo: x.tipo === 'fixa' ? 'fixa' : 'variavel',
          values: x.tipo === 'fixa' ? doze(x) : z12() };
      }),
      reserva: (src.reserva || []).map(function (x) { return { id: Fin.novoId('s'), name: x.name, values: z12() }; })
    };
    DB.years[k] = novo;
    return novo;
  };

  Fin.propagarFixa = function (item, mes0, valor) {
    var v = rd(valor);
    if (!item.values) item.values = z12();
    item.values[mes0] = v;
    for (var i = mes0 + 1; i < 12; i++) {
      var st = item.status ? item.status[i] : '';
      if (st === 'Pago' || st === 'N/A') continue;
      item.values[i] = v;
    }
    return item;
  };

  // Grava o mesmo valor de de..ate (0-11) num item planejado. Pula meses 'Pago'/'N/A', salvo
  // opcoes.incluirPagos. Nunca mexe no status. Devolve {alterados:[k], pulados:[k]}.
  Fin.editarValores = function (item, de, ate, valor, opcoes) {
    var v = rd(valor), incl = !!(opcoes && opcoes.incluirPagos), out = { alterados: [], pulados: [] };
    var a = Math.max(0, Math.floor(Number(de) || 0));
    var b = (ate === undefined || ate === null || ate === '') ? 11 : Math.min(11, Math.floor(Number(ate)));
    if (!isFinite(b)) b = 11;
    if (!item.values) item.values = z12();
    for (var k = a; k <= b; k++) {
      var st = item.status ? item.status[k] : '';
      if (!incl && (st === 'Pago' || st === 'N/A')) { out.pulados.push(k); continue; }
      item.values[k] = v;
      out.alterados.push(k);
    }
    return out;
  };

  // ===================== normalização, contagem, assinatura =====================
  function idOk(id) { return typeof id === 'string' && id.trim() !== ''; }
  function vals12(v) {
    var out = z12();
    if (Array.isArray(v)) for (var i = 0; i < 12; i++) out[i] = rd(v[i] || 0);
    return out;
  }
  function st12(s) {
    var out = s12();
    if (Array.isArray(s)) for (var i = 0; i < 12; i++) out[i] = STATUS_DESP.indexOf(s[i]) >= 0 ? s[i] : '';
    return out;
  }
  function normDesp(d) {
    var o = clone(d) || {};
    o.id = idOk(o.id) ? o.id : Fin.novoId('d');
    o.name = String(o.name == null ? '' : o.name);
    o.venc = String(o.venc == null ? '' : o.venc);
    o.tipo = o.tipo === 'fixa' ? 'fixa' : 'variavel';
    o.values = vals12(o.values);
    o.status = st12(o.status);
    return o;
  }
  function normRenda(x) {
    var o = clone(x) || {};
    o.id = idOk(o.id) ? o.id : Fin.novoId('r');
    o.name = String(o.name == null ? '' : o.name);
    o.tipo = o.tipo === 'fixa' ? 'fixa' : 'variavel';
    o.values = vals12(o.values);
    if (o.status !== undefined) o.status = st12(o.status);
    return o;
  }
  function normRes(x) {
    var o = clone(x) || {};
    o.id = idOk(o.id) ? o.id : Fin.novoId('s');
    o.name = String(o.name == null ? '' : o.name);
    o.values = vals12(o.values);
    return o;
  }
  function normDiv(x) {
    var o = clone(x) || {};
    o.id = idOk(o.id) ? o.id : Fin.novoId('dv');
    o.name = String(o.name == null ? '' : o.name);
    o.credor = String(o.credor == null ? '' : o.credor);
    o.obs = String(o.obs == null ? '' : o.obs);
    o.venc = String(o.venc == null ? '' : o.venc);
    o.total = rd(o.total);
    o.situacao = SITUACOES.indexOf(o.situacao) >= 0 ? o.situacao : 'ativa';
    o.parcela = rd(o.parcela);
    o.qtd = qtdDe(o);
    o.inicio = ymParse(o.inicio) ? o.inicio : '';
    o.pagoInicial = rd(o.pagoInicial);
    var pg = {}, src = (o.pagamentos && typeof o.pagamentos === 'object') ? o.pagamentos : {};
    Object.keys(src).sort().forEach(function (k) { if (ymParse(k) && c(src[k]) !== 0) pg[k] = rd(src[k]); });
    o.pagamentos = pg;
    o.flags = Array.isArray(o.flags) ? o.flags.map(String) : [];
    o.criadoEm = typeof o.criadoEm === 'string' && o.criadoEm ? o.criadoEm : new Date().toISOString();
    return o;
  }
  function normDivg(x) {
    var o = clone(x) || {};
    o.id = idOk(o.id) ? o.id : Fin.novoId('dg');
    o.tipo = String(o.tipo || 'cadastro');
    o.origem = String(o.origem || 'app-antigo');
    o.descricao = String(o.descricao || '');
    o.dados = (o.dados && typeof o.dados === 'object') ? o.dados : {};
    o.status = o.status === 'resolvida' ? 'resolvida' : 'aberta';
    return o;
  }
  function pareceV1(db) {
    if (db.versao === 2) return false;
    var ys = db.years || {};
    return Object.keys(ys).some(function (y) { return ys[y] && Array.isArray(ys[y].dividas); }) || !Array.isArray(db.dividas);
  }

  Fin.normalizarDB = function (db) {
    if (!db || typeof db !== 'object') db = {};
    if (db.versao !== 2 && db.years && pareceV1(db)) return Fin.normalizarDB(Fin.migrarV1(db));
    var o = clone(db);
    o.versao = 2;
    var ys = {}, src = o.years || {};
    Object.keys(src).sort().forEach(function (y) {
      if (!/^\d{4}$/.test(y) || !src[y] || typeof src[y] !== 'object') return;
      ys[y] = {
        despesas: (src[y].despesas || []).map(normDesp),
        renda: (src[y].renda || []).map(normRenda),
        reserva: (src[y].reserva || []).map(normRes)
      };
    });
    o.years = ys;
    o.dividas = (Array.isArray(o.dividas) ? o.dividas : []).map(normDiv);
    o.divergencias = (Array.isArray(o.divergencias) ? o.divergencias : []).map(normDivg);
    o.lancamentos = Array.isArray(o.lancamentos) ? o.lancamentos : [];
    o.filaLanc = Array.isArray(o.filaLanc) ? o.filaLanc : [];
    var anos = Object.keys(ys);
    o.curYear = ys[String(o.curYear)] ? String(o.curYear) : (anos.length ? anos[anos.length - 1] : String(new Date().getFullYear()));
    return o;
  };

  Fin.contarItens = function (db) {
    if (!db || !db.years) return 0;
    var n = 0;
    Object.keys(db.years).forEach(function (y) {
      var Y = db.years[y] || {};
      n += (Y.despesas || []).length + (Y.renda || []).length + (Y.reserva || []).length;
      if (Array.isArray(Y.dividas)) n += Y.dividas.length; // DB v1
    });
    return n + (Array.isArray(db.dividas) ? db.dividas.length : 0);
  };

  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  Fin.canonico = canon;
  Fin.assinatura = function (db) {
    db = db || {};
    return canon({ years: db.years || {}, dividas: db.dividas || [], divergencias: db.divergencias || [] });
  };

  // ===================== migração v1 → v2 =====================
  // v1: years[ano] = {despesas, renda, reserva, dividas}; dívida v1 = name, credor, total, pago,
  // status radar|resolvendo|quitada, parcela, mesInicio 0-11, qtdParcelas; despesas "[DIV] nome" geradas.
  var PREFIXO_DIV = /^\s*\[DIV\]\s*/;

  Fin.migrarV1Detalhado = function (dbV1) {
    var src = dbV1 || {};
    var relatorio = [];
    var divergencias = [];
    var anos = Object.keys(src.years || {}).filter(function (y) { return /^\d{4}$/.test(y); })
      .sort(function (a, b) { return Number(a) - Number(b); });
    var agora = new Date().toISOString();

    function divergencia(tipo, descricao, dados, status) {
      divergencias.push({ id: Fin.novoId('dg'), tipo: tipo, origem: 'app-antigo', descricao: descricao,
        dados: dados || {}, status: status || 'aberta' });
    }

    // --- 1) dívidas: identidade por nome normalizado; o primeiro ano define o plano
    var porNome = {}, ordem = [];
    anos.forEach(function (ano) {
      (src.years[ano].dividas || []).forEach(function (x) {
        var nn = normNome(x.name);
        if (!nn) return;
        var q = Math.max(0, Math.floor(Number(x.qtdParcelas) || 0));
        var mi = Math.min(11, Math.max(0, Math.floor(Number(x.mesInicio) || 0)));
        if (!porNome[nn]) {
          var temPlano = q > 0 && c(x.parcela) > 0;
          var dv = {
            id: Fin.novoId('dv'), name: String(x.name).trim(), credor: String(x.credor || ''), obs: '', venc: '',
            total: rd(x.total),
            situacao: x.status === 'radar' ? 'radar' : 'ativa',
            parcela: rd(x.parcela), qtd: q,
            inicio: (x.status !== 'radar' || temPlano) ? ym(ano, mi) : '',
            pagoInicial: 0, pagamentos: {}, flags: [], criadoEm: agora
          };
          porNome[nn] = { dv: dv, ano1: ano, v1: x, porAno: {} };
          ordem.push(nn);
        } else {
          var base = porNome[nn].v1;
          var dif = c(base.parcela) !== c(x.parcela) || (Number(base.qtdParcelas) || 0) !== q ||
            (Number(base.mesInicio) || 0) !== mi || c(base.total) !== c(x.total);
          if (dif) {
            var tx = 'plano diferente em ' + ano + ': ' + q + ' x ' + fmt(x.parcela) + ' a partir de ' +
              MESES[mi] + ', total ' + fmt(x.total) + ' (vale o de ' + porNome[nn].ano1 + ': ' +
              (Number(base.qtdParcelas) || 0) + ' x ' + fmt(base.parcela) + ' a partir de ' +
              MESES[Number(base.mesInicio) || 0] + ', total ' + fmt(base.total) + ')';
            porNome[nn].dv.flags.push(tx);
            divergencia('cadastro', 'Dívida "' + porNome[nn].dv.name + '": ' + tx,
              { dvId: porNome[nn].dv.id, nome: porNome[nn].dv.name, ano: ano,
                planoUsado: { ano: porNome[nn].ano1, total: rd(base.total), parcela: rd(base.parcela), qtd: Number(base.qtdParcelas) || 0, mesInicio: Number(base.mesInicio) || 0 },
                planoIgnorado: { ano: ano, total: rd(x.total), parcela: rd(x.parcela), qtd: q, mesInicio: mi } });
          }
        }
        porNome[nn].porAno[ano] = x;
      });
    });

    // --- 2) pagamentos a partir das linhas "[DIV] nome" com status Pago
    var removidasPorAno = {};
    anos.forEach(function (ano) {
      removidasPorAno[ano] = 0;
      (src.years[ano].despesas || []).forEach(function (d) {
        if (!PREFIXO_DIV.test(String(d.name || ''))) return;
        var nn = normNome(String(d.name).replace(PREFIXO_DIV, ''));
        var reg = porNome[nn];
        if (!reg) return; // órfã: tratada no passo 3
        var dv = reg.dv, plano = Fin.planoParcelas(dv);
        var ini = plano.length ? plano[0].ym : null, fim = plano.length ? plano[plano.length - 1].ym : null;
        for (var m = 0; m < 12; m++) {
          var st = d.status ? d.status[m] : '';
          var vc = vC(d, m);
          if (st !== 'Pago' || vc <= 0) continue;
          var k = ym(ano, m);
          if (ini && k >= ini && k <= fim) {
            dv.pagamentos[k] = r(c(dv.pagamentos[k]) + vc);
          } else {
            relatorio.push({ tipo: 'pagamento-fora-do-plano', divida: dv.name, ym: k, valor: r(vc),
              texto: '"[DIV] ' + dv.name + '" Pago em ' + ymRotulo(k) + ' (R$ ' + fmt(r(vc)) + ') fora do plano ' +
                (ini ? ymRotulo(ini) + ' a ' + ymRotulo(fim) : '(sem plano)') + ': não migrou como pagamento' });
          }
        }
      });
    });

    // --- 3) pagoInicial, inconsistências, situação
    var dividas = ordem.map(function (nn) {
      var reg = porNome[nn], dv = reg.dv, ano1 = reg.ano1;
      var somaAno1 = 0;
      Object.keys(dv.pagamentos).forEach(function (k) { if (k.slice(0, 4) === ano1) somaAno1 += c(dv.pagamentos[k]); });
      dv.pagoInicial = r(Math.max(0, c(reg.v1.pago) - somaAno1));
      var res = Fin.divResumo(dv, ym(Number(ano1) + 100, 0));
      res.inconsistencias.forEach(function (inc) {
        var det = inc === 'total ≠ parcela × qtd'
          ? 'total ' + fmt(dv.total) + '; ' + dv.qtd + ' x ' + fmt(dv.parcela) + ' = ' + fmt(r(c(dv.parcela) * dv.qtd))
          : 'pago ' + fmt(res.totalPago) + ' > total ' + fmt(dv.total);
        dv.flags.push(inc + ' (' + det + ')');
        divergencia('cadastro', 'Dívida "' + dv.name + '": ' + inc + ' (' + det + ')',
          { dvId: dv.id, nome: dv.name, total: dv.total, parcela: dv.parcela, qtd: dv.qtd, totalPago: res.totalPago });
      });
      if (reg.v1.status === 'quitada' && dv.situacao !== 'radar' && !res.quitada) {
        var tx = 'estava quitada no app antigo, mas falta ' + fmt(res.saldo);
        dv.flags.push(tx);
        divergencia('cadastro', 'Dívida "' + dv.name + '": ' + tx, { dvId: dv.id, nome: dv.name, saldo: res.saldo });
      }
      return dv;
    });

    // --- 4) despesas, rendas e reservas
    var years = {};
    var orfas = {};
    anos.forEach(function (ano) {
      var Y = src.years[ano] || {};
      var desp = [];
      (Y.despesas || []).forEach(function (d) {
        var nome = String(d.name || '');
        if (PREFIXO_DIV.test(nome)) {
          var nn = normNome(nome.replace(PREFIXO_DIV, ''));
          if (porNome[nn]) { removidasPorAno[ano]++; return; } // vira parcela derivada
          if (!orfas[nn]) orfas[nn] = { nome: nome, anos: {} };
          orfas[nn].anos[ano] = { soma: r(somaC(d.values || [])),
            somaPago: r((d.values || []).reduce(function (s, v, m) { return s + ((d.status || [])[m] === 'Pago' ? c(v) : 0); }, 0)),
            values: vals12(d.values) };
        }
        var o = normDesp(d);
        delete o.dvKey;
        for (var m = 0; m < 12; m++) {
          if (o.status[m] === 'N/A' && c(o.values[m]) > 0) {
            relatorio.push({ tipo: 'na-com-valor', ano: ano, item: o.name, mes0: m, valor: o.values[m],
              texto: '"' + o.name + '" ' + MESES[m] + '/' + ano + ' N/A com R$ ' + fmt(o.values[m]) + ': mantido, fora do total (regra v2)' });
          }
        }
        desp.push(o);
      });
      years[ano] = {
        despesas: desp,
        renda: (Y.renda || []).map(normRenda),
        reserva: (Y.reserva || []).map(normRes)
      };
      relatorio.push({ tipo: 'div-removida', ano: ano, qtd: removidasPorAno[ano],
        texto: ano + ': ' + removidasPorAno[ano] + ' linhas "[DIV]" viraram parcelas derivadas das dívidas' });
    });

    // --- 5) órfãs: migram como despesa normal, com divergência (pode ser dupla contagem)
    Object.keys(orfas).forEach(function (nn) {
      var o = orfas[nn], suspeitas = [];
      Object.keys(o.anos).forEach(function (ano) {
        if (!c(o.anos[ano].soma)) return;
        (src.years[ano].despesas || []).forEach(function (d) {
          if (!PREFIXO_DIV.test(String(d.name || '')) || normNome(String(d.name).replace(PREFIXO_DIV, '')) === nn) return;
          var vs = vals12(d.values), igual = true;
          for (var m = 0; m < 12; m++) if (c(vs[m]) !== c(o.anos[ano].values[m])) { igual = false; break; }
          if (igual && suspeitas.indexOf(d.name) < 0) suspeitas.push(String(d.name));
        });
      });
      var resumo = Object.keys(o.anos).map(function (a) { return a + ': R$ ' + fmt(o.anos[a].soma) + ' (pago ' + fmt(o.anos[a].somaPago) + ')'; }).join('; ');
      divergencia('orfa', 'Despesa "' + o.nome + '" sem dívida correspondente; migrou como despesa normal. ' + resumo +
        (suspeitas.length ? '. Mesma série de valores de ' + suspeitas.join(', ') + ': pode ser dupla contagem' : ''),
        { nome: o.nome, anos: Object.keys(o.anos).reduce(function (acc, a) { acc[a] = { soma: o.anos[a].soma, somaPago: o.anos[a].somaPago }; return acc; }, {}),
          mesmaSerieDe: suspeitas });
    });

    var db = {
      versao: 2, years: years, dividas: dividas, divergencias: divergencias,
      lancamentos: Array.isArray(src.lancamentos) ? clone(src.lancamentos) : [],
      filaLanc: Array.isArray(src.filaLanc) ? clone(src.filaLanc) : [],
      curYear: years[String(src.curYear)] ? String(src.curYear) : (anos.length ? anos[anos.length - 1] : String(new Date().getFullYear()))
    };
    ['mo', 'pg', 'fD', 'fR'].forEach(function (k) { if (src[k] !== undefined) db[k] = src[k]; });
    return { db: db, relatorio: relatorio, origem: porNome };
  };

  Fin.migrarV1 = function (dbV1) {
    if (dbV1 && dbV1.versao === 2) return Fin.normalizarDB(dbV1);
    return Fin.migrarV1Detalhado(dbV1).db;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Fin;
  else root.Fin = Fin;
})(this);
