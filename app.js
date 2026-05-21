// =============================================================
// Mangalargada 2026 - App de captura de passagens
// v3 - botões reorganizados (salvar em cima, refazer em vermelho embaixo)
// =============================================================

const URL_APPS_SCRIPT = 'https://script.google.com/macros/s/AKfycbzUMB3R5-Yx1_WvXV3bV_4_5SDvcjgWxTSkDu4FV6KQ62HOZzmMfV-SH-3a16gPW1R6/exec';

const ICONES_POSTO = {
  'Largada': '🏁',
  'PC1': '📍',
  'PC2': '📍',
  'PC3': '📍',
  'Chegada': '🏆'
};

let estado = {
  posto: null,
  nomeFiscal: '',
  online: navigator.onLine,
  cameraAtiva: false,
  stream: null,
  fotoBlob: null,
  fotoCanvas: null,
  horaFoto: null,
  timestampFoto: null,
  ajusteSeg: 0,
  motivoAjuste: ''
};

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const hhmmss = d => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
const ddmmyyyy = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();

function aplicarAjuste(timestampISO, segundos) {
  const d = new Date(timestampISO);
  d.setSeconds(d.getSeconds() + (segundos || 0));
  return d;
}

// ====================================================================
// IndexedDB
// ====================================================================

let db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mangalargada-2026', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('registros')) {
        const store = d.createObjectStore('registros', { keyPath: 'id' });
        store.createIndex('sincronizado', 'sincronizado', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!d.objectStoreNames.contains('config')) {
        d.createObjectStore('config', { keyPath: 'chave' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function dbSalvar(registro) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('registros', 'readwrite');
    tx.objectStore('registros').put(registro);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

function dbListarTodos() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('registros', 'readonly');
    const req = tx.objectStore('registros').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    req.onerror = e => reject(e.target.error);
  });
}

function dbListarPendentes() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('registros', 'readonly');
    const req = tx.objectStore('registros').getAll();
    req.onsuccess = () => resolve(req.result.filter(r => !r.sincronizado));
    req.onerror = e => reject(e.target.error);
  });
}

function configSalvar(chave, valor) {
  return new Promise((resolve) => {
    const tx = db.transaction('config', 'readwrite');
    tx.objectStore('config').put({ chave, valor });
    tx.oncomplete = () => resolve();
  });
}

function configLer(chave) {
  return new Promise((resolve) => {
    const tx = db.transaction('config', 'readonly');
    const req = tx.objectStore('config').get(chave);
    req.onsuccess = () => resolve(req.result ? req.result.valor : null);
  });
}

// ====================================================================
// Login do fiscal
// ====================================================================

function atualizarBotaoEntrar() {
  const nome = $('nome-fiscal').value.trim();
  const ok = nome.length > 0 && estado.posto !== null;
  $('btn-entrar').disabled = !ok;
}

$('nome-fiscal').addEventListener('input', atualizarBotaoEntrar);

document.querySelectorAll('.btn-posto').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.btn-posto').forEach(x => x.classList.remove('ativo'));
    b.classList.add('ativo');
    estado.posto = b.dataset.posto;
    atualizarBotaoEntrar();
  });
});

$('btn-entrar').addEventListener('click', async () => {
  if ($('btn-entrar').disabled) return;
  estado.nomeFiscal = $('nome-fiscal').value.trim();
  await configSalvar('nomeFiscal', estado.nomeFiscal);
  await configSalvar('posto', estado.posto);
  entrarPosto();
});

function entrarPosto() {
  $('ico-posto').textContent = ICONES_POSTO[estado.posto];
  $('lbl-posto').textContent = estado.posto.replace('PC', 'PC ');
  $('lbl-fiscal').textContent = '· ' + estado.nomeFiscal.split(' ')[0];
  $('ts-posto').textContent = estado.posto.replace('PC', 'PC ');
  $('tela-login').style.display = 'none';
  $('tela-captura').style.display = 'block';
  renderFila();
}

$('btn-trocar').addEventListener('click', async () => {
  const pendentes = await dbListarPendentes();
  if (pendentes.length > 0) {
    if (!confirm('Há ' + pendentes.length + ' registro(s) não sincronizado(s). Trocar de posto mesmo assim?')) {
      return;
    }
  }
  limparFormulario();
  $('tela-captura').style.display = 'none';
  $('tela-login').style.display = 'block';
});

// ====================================================================
// Relógio
// ====================================================================

function tickRelogio() {
  const agora = new Date();
  $('relogio').textContent = hhmmss(agora);
  if (!estado.fotoBlob) $('ts-hora').textContent = hhmmss(agora);
}
setInterval(tickRelogio, 250);
tickRelogio();

// ====================================================================
// Câmera (3 botões: tirar, capturar, refazer)
// ====================================================================

async function abrirCamera() {
  $('preview-foto').style.display = 'block';
  const video = $('video-stream');
  const canvas = $('canvas-foto');
  try {
    estado.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    video.srcObject = estado.stream;
    video.style.display = 'block';
    canvas.style.display = 'none';
    estado.cameraAtiva = true;
  } catch (err) {
    alert('Não foi possível acessar a câmera. Verifique as permissões nas configurações do navegador.');
    $('preview-foto').style.display = 'none';
    $('btn-camera').style.display = 'flex';
    $('btn-capturar').style.display = 'none';
  }
}

function capturarFoto() {
  const agora = new Date();
  estado.horaFoto = hhmmss(agora);
  estado.timestampFoto = agora.toISOString();
  estado.ajusteSeg = 0;
  estado.motivoAjuste = '';

  const video = $('video-stream');
  const canvas = $('canvas-foto');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 960;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const fontSize = Math.max(36, canvas.width * 0.05);
  ctx.font = 'bold ' + fontSize + 'px monospace';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'white';
  ctx.fillText(estado.horaFoto, 20, canvas.height - 20);
  ctx.font = '500 ' + (fontSize * 0.45) + 'px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(estado.posto.replace('PC', 'PC '), canvas.width - 20, canvas.height - 20);
  ctx.shadowBlur = 0;

  canvas.style.display = 'block';
  video.style.display = 'none';
  if (estado.stream) {
    estado.stream.getTracks().forEach(t => t.stop());
    estado.stream = null;
  }

  canvas.toBlob(b => {
    estado.fotoBlob = b;
    estado.fotoCanvas = canvas;
    atualizarBotaoSalvar();
  }, 'image/jpeg', 0.82);

  estado.cameraAtiva = false;
  // Esconder "Tirar foto" e "Capturar", mostrar "Refazer foto"
  $('btn-camera').style.display = 'none';
  $('btn-capturar').style.display = 'none';
  $('btn-refazer').style.display = 'block';
  $('ts-hora').textContent = estado.horaFoto;
  $('hora-foto-val').textContent = estado.horaFoto;
  $('hora-foto').style.display = 'inline';
  $('btn-ajustar-hora').style.display = 'block';
  atualizarLabelAjuste();
}

function iniciarCaptura() {
  // Ao clicar em "Tirar foto", abre a câmera e troca pro botão "Capturar"
  $('btn-camera').style.display = 'none';
  $('btn-capturar').style.display = 'flex';
  abrirCamera();
}

function resetarCaptura() {
  estado.fotoBlob = null;
  estado.fotoCanvas = null;
  estado.horaFoto = null;
  estado.timestampFoto = null;
  estado.ajusteSeg = 0;
  estado.motivoAjuste = '';
  $('preview-foto').style.display = 'none';
  $('hora-foto').style.display = 'none';
  $('btn-ajustar-hora').style.display = 'none';
  $('btn-camera').style.display = 'flex';
  $('btn-capturar').style.display = 'none';
  $('btn-refazer').style.display = 'none';
  atualizarLabelAjuste();
  atualizarBotaoSalvar();
}

$('btn-camera').addEventListener('click', iniciarCaptura);
$('btn-capturar').addEventListener('click', capturarFoto);
$('btn-refazer').addEventListener('click', () => {
  if (confirm('Refazer a foto descarta a atual. Confirmar?')) {
    resetarCaptura();
    iniciarCaptura();
  }
});

// ====================================================================
// Modal de ajuste de hora
// ====================================================================

let modalAjusteTemp = 0;

function abrirModalAjuste() {
  modalAjusteTemp = estado.ajusteSeg;
  $('aj-hora-foto').textContent = estado.horaFoto;
  $('aj-input').value = modalAjusteTemp || '';
  $('aj-motivo').value = estado.motivoAjuste || '';
  renderModalHoraFinal();
  validarModalConfirmar();
  $('modal-ajuste').classList.add('aberto');
}

function fecharModalAjuste() {
  $('modal-ajuste').classList.remove('aberto');
}

function renderModalHoraFinal() {
  if (!estado.timestampFoto) return;
  const ajustada = aplicarAjuste(estado.timestampFoto, modalAjusteTemp);
  const sinal = modalAjusteTemp > 0 ? '+' : '';
  $('aj-hora-final').textContent = hhmmss(ajustada) + (modalAjusteTemp !== 0 ? '  (' + sinal + modalAjusteTemp + 's)' : '');
}

function validarModalConfirmar() {
  const motivo = $('aj-motivo').value.trim();
  if (modalAjusteTemp === 0) {
    $('aj-confirmar').disabled = false;
  } else {
    $('aj-confirmar').disabled = motivo.length < 3;
  }
}

document.querySelectorAll('.ajuste-botoes button').forEach(b => {
  b.addEventListener('click', () => {
    const delta = parseInt(b.dataset.aj, 10);
    if (delta === 0) {
      modalAjusteTemp = 0;
    } else {
      modalAjusteTemp += delta;
    }
    if (modalAjusteTemp > 3600) modalAjusteTemp = 3600;
    if (modalAjusteTemp < -3600) modalAjusteTemp = -3600;
    $('aj-input').value = modalAjusteTemp;
    renderModalHoraFinal();
    validarModalConfirmar();
  });
});

$('aj-input').addEventListener('input', e => {
  let v = parseInt(e.target.value, 10);
  if (isNaN(v)) v = 0;
  if (v > 3600) v = 3600;
  if (v < -3600) v = -3600;
  modalAjusteTemp = v;
  renderModalHoraFinal();
  validarModalConfirmar();
});

$('aj-motivo').addEventListener('input', validarModalConfirmar);

$('aj-cancelar').addEventListener('click', fecharModalAjuste);

$('aj-confirmar').addEventListener('click', () => {
  estado.ajusteSeg = modalAjusteTemp;
  estado.motivoAjuste = $('aj-motivo').value.trim();
  atualizarLabelAjuste();
  fecharModalAjuste();
});

$('btn-ajustar-hora').addEventListener('click', abrirModalAjuste);

function atualizarLabelAjuste() {
  const btn = $('btn-ajustar-hora');
  const lbl = $('lbl-ajustar');
  if (estado.ajusteSeg === 0) {
    btn.classList.remove('ajustado');
    lbl.textContent = 'ajustar hora da passagem';
  } else {
    btn.classList.add('ajustado');
    const ajustada = aplicarAjuste(estado.timestampFoto, estado.ajusteSeg);
    const sinal = estado.ajusteSeg > 0 ? '+' : '';
    lbl.textContent = '⏱️ hora ajustada: ' + hhmmss(ajustada) + ' (' + sinal + estado.ajusteSeg + 's) — toque para editar';
  }
}

// ====================================================================
// Inputs dos coletes
// ====================================================================

['colete1', 'colete2', 'colete3'].forEach(id => {
  $(id).addEventListener('input', e => {
    let v = e.target.value.replace(/[^0-9]/g, '');
    if (v.length >= 1) {
      const n = parseInt(v, 10);
      if (n > 100) {
        v = v.slice(0, -1);
        e.target.value = v;
      }
    }
    e.target.value = v;
    atualizarBotaoSalvar();
  });
});

function coletesPreenchidos() {
  return [$('colete1'), $('colete2'), $('colete3')]
    .map(i => i.value.trim())
    .filter(v => v.length > 0 && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 100);
}

function atualizarBotaoSalvar() {
  const cs = coletesPreenchidos();
  const ok = estado.posto && cs.length >= 1 && estado.fotoBlob;
  $('btn-salvar').disabled = !ok;
}

// ====================================================================
// Salvar registro
// ====================================================================

$('btn-salvar').addEventListener('click', async () => {
  if ($('btn-salvar').disabled) return;

  const cs = coletesPreenchidos();
  const dataAjustada = aplicarAjuste(estado.timestampFoto, estado.ajusteSeg);

  const fotoBase64 = await blobParaBase64(estado.fotoBlob);

  const registro = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    coletes: cs,
    posto: estado.posto,
    fiscal: estado.nomeFiscal,
    data: ddmmyyyy(dataAjustada),
    hora: hhmmss(dataAjustada),
    hora_foto: estado.horaFoto,
    ajuste_seg: estado.ajusteSeg,
    motivo_ajuste: estado.motivoAjuste,
    timestamp: estado.timestampFoto,
    foto_base64: fotoBase64,
    sincronizado: false,
    tentativas: 0
  };

  await dbSalvar(registro);
  toast('Registro salvo!');
  limparFormulario();
  await renderFila();

  if (estado.online) tentarSync();
});

function limparFormulario() {
  $('colete1').value = '';
  $('colete2').value = '';
  $('colete3').value = '';
  resetarCaptura();
}

function blobParaBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

// ====================================================================
// Sync com Apps Script
// ====================================================================

let sincronizando = false;

async function tentarSync() {
  if (sincronizando || !estado.online) return;
  sincronizando = true;

  try {
    const pendentes = await dbListarPendentes();
    for (const reg of pendentes) {
      try {
        const dadosEnvio = {
          id: reg.id,
          data: reg.data,
          hora: reg.hora,
          hora_foto: reg.hora_foto,
          ajuste_seg: reg.ajuste_seg,
          motivo_ajuste: reg.motivo_ajuste,
          posto: reg.posto,
          coletes: reg.coletes,
          fiscal: reg.fiscal,
          foto_base64: reg.foto_base64
        };
        const resp = await fetch(URL_APPS_SCRIPT, {
          method: 'POST',
          body: JSON.stringify(dadosEnvio)
        });
        const json = await resp.json();
        if (json.ok) {
          reg.sincronizado = true;
          reg.sincronizado_em = new Date().toISOString();
          reg.link_foto = json.link || '';
          delete reg.foto_base64;
          await dbSalvar(reg);
        } else {
          reg.tentativas = (reg.tentativas || 0) + 1;
          await dbSalvar(reg);
        }
      } catch (err) {
        reg.tentativas = (reg.tentativas || 0) + 1;
        await dbSalvar(reg);
        break;
      }
    }
    await renderFila();
  } finally {
    sincronizando = false;
  }
}

$('btn-sync').addEventListener('click', () => {
  if (!estado.online) {
    toast('Sem sinal. Aguarde voltar.', true);
    return;
  }
  tentarSync();
});

setInterval(() => {
  if (estado.online) tentarSync();
}, 30000);

// ====================================================================
// Estado online/offline
// ====================================================================

function atualizarStatusRede() {
  estado.online = navigator.onLine;
  const pill = $('net-pill');
  if (estado.online) {
    pill.textContent = 'online';
    pill.className = 'pill pill-online';
    tentarSync();
  } else {
    pill.textContent = 'sem sinal';
    pill.className = 'pill pill-offline';
  }
}

window.addEventListener('online', atualizarStatusRede);
window.addEventListener('offline', atualizarStatusRede);

// ====================================================================
// Lista da fila
// ====================================================================

async function renderFila() {
  const lista = await dbListarTodos();
  $('fila-contador').textContent = lista.length + ' registro' + (lista.length === 1 ? '' : 's');
  const ul = $('fila-lista');
  if (lista.length === 0) {
    ul.innerHTML = '<div class="fila-vazia">Nenhum registro ainda.</div>';
    return;
  }
  ul.innerHTML = lista.slice(0, 20).map(r => {
    const ico = r.sincronizado ? '☁️✓' : '☁️↑';
    const classe = r.sincronizado ? 'fila-sync' : 'fila-pendente';
    const coletes = r.coletes.map(c => '#' + c).join(' · ');
    const marcaAjuste = (r.ajuste_seg && r.ajuste_seg !== 0) ? ' ⏱️' : '';
    return `<div class="fila-item ${classe}">
      <span class="esq">${ico} <strong>${coletes}</strong> · ${r.posto.replace('PC', 'PC ')}${marcaAjuste}</span>
      <span class="hora">${r.hora}</span>
    </div>`;
  }).join('');
}

// ====================================================================
// Toast
// ====================================================================

let toastTimeout = null;
function toast(msg, erro) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast visivel' + (erro ? ' erro' : '');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    t.className = 'toast' + (erro ? ' erro' : '');
  }, 2000);
}

// ====================================================================
// Inicialização
// ====================================================================

async function inicializar() {
  await abrirDB();
  atualizarStatusRede();
  const nome = await configLer('nomeFiscal');
  const posto = await configLer('posto');
  if (nome && posto) {
    estado.nomeFiscal = nome;
    estado.posto = posto;
    entrarPosto();
  }
}

inicializar().catch(err => {
  console.error('Erro inicializando:', err);
  alert('Erro ao inicializar o app. Recarregue a página.');
});
