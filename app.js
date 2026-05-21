// =============================================================
// Mangalargada 2026 - App de captura de passagens
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
  timestampFoto: null
};

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const hhmmss = d => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
const ddmmyyyy = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();

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
// Relógio + estado da câmera
// ====================================================================

function tickRelogio() {
  const agora = new Date();
  $('relogio').textContent = hhmmss(agora);
  if (!estado.fotoBlob) $('ts-hora').textContent = hhmmss(agora);
}
setInterval(tickRelogio, 250);
tickRelogio();

// ====================================================================
// Câmera
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
    $('btn-camera-label').textContent = 'Capturar';
  } catch (err) {
    alert('Não foi possível acessar a câmera. Verifique as permissões nas configurações do navegador.');
    $('preview-foto').style.display = 'none';
  }
}

function capturarFoto() {
  const agora = new Date();
  estado.horaFoto = hhmmss(agora);
  estado.timestampFoto = agora.toISOString();

  const video = $('video-stream');
  const canvas = $('canvas-foto');

  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 960;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Carimbar timestamp e posto
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
  $('btn-camera-label').textContent = 'Refazer foto';
  $('ts-hora').textContent = estado.horaFoto;
  $('hora-foto-val').textContent = estado.horaFoto;
  $('hora-foto').style.display = 'inline';
}

$('btn-camera').addEventListener('click', () => {
  if (estado.cameraAtiva) {
    capturarFoto();
  } else {
    estado.fotoBlob = null;
    estado.fotoCanvas = null;
    estado.horaFoto = null;
    estado.timestampFoto = null;
    $('hora-foto').style.display = 'none';
    abrirCamera();
  }
});

// ====================================================================
// Inputs dos coletes
// ====================================================================

['colete1', 'colete2', 'colete3'].forEach(id => {
  $(id).addEventListener('input', e => {
    let v = e.target.value.replace(/[^0-9]/g, '');
    // Validar faixa 1-100 quando completar dígitos
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
  const agora = new Date();
  const dataFoto = new Date(estado.timestampFoto);

  const fotoBase64 = await blobParaBase64(estado.fotoBlob);

  const registro = {
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    coletes: cs,
    posto: estado.posto,
    fiscal: estado.nomeFiscal,
    data: ddmmyyyy(dataFoto),
    hora: estado.horaFoto,
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
  estado.fotoBlob = null;
  estado.fotoCanvas = null;
  estado.horaFoto = null;
  estado.timestampFoto = null;
  $('preview-foto').style.display = 'none';
  $('hora-foto').style.display = 'none';
  $('btn-camera-label').textContent = 'Tirar foto';
  atualizarBotaoSalvar();
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
          // Apagar foto base64 para economizar espaço local depois de sincronizar
          delete reg.foto_base64;
          await dbSalvar(reg);
        } else {
          reg.tentativas = (reg.tentativas || 0) + 1;
          await dbSalvar(reg);
        }
      } catch (err) {
        reg.tentativas = (reg.tentativas || 0) + 1;
        await dbSalvar(reg);
        // se erro de rede, sai do loop e tenta de novo depois
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

// Sync periódico a cada 30 segundos
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
    return `<div class="fila-item ${classe}">
      <span class="esq">${ico} <strong>${coletes}</strong> · ${r.posto.replace('PC', 'PC ')}</span>
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

  // Restaurar sessão se já tiver logado antes
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
