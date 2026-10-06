// Funções usadas pelo app do guincheiro (index.html) e pela página do cliente (cliente.html)
"use strict";
const $ = id => document.getElementById(id);

// ---------- números e textos ----------
/** Aceita "6,49", "6.49", "1.234,5" e "R$ 150". */
function num(s) {
  s = String(s ?? "").replace(/R\$|\s/g, "");
  if (!s) return 0;
  if (!s.includes(",") && (s.match(/\./g) || []).length === 1) return parseFloat(s) || 0;
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}
const fmt = (v, c = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const moeda = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoje = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dataBr = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
const duracao = seg => { const m = Math.max(1, Math.round(seg / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
const soDigitos = s => String(s || "").replace(/\D/g, "");
/** Telefone brasileiro para o formato do wa.me (55 + DDD + número). */
function telZap(s) {
  let t = soDigitos(s);
  if (t.length === 10 || t.length === 11) t = "55" + t;
  return t.length >= 12 ? t : "";
}

/** Mesmo cálculo do programa do PC. */
function calc(v) {
  const kmTotal = v.KmBasePartida + v.KmPartidaDescarga + v.KmDescargaBase;
  const kmCobrado = (v.CobrarIda ? v.KmBasePartida : 0) + v.KmPartidaDescarga + (v.CobrarRetorno ? v.KmDescargaBase : 0);
  const litros = v.ConsumoKmL > 0 ? kmTotal / v.ConsumoKmL : 0;
  const custo = litros * v.PrecoDiesel;
  const valorKm = kmCobrado * v.ValorKm;
  const valor = v.TaxaSaida + valorKm + v.Ajuste;
  return { kmTotal, kmCobrado, litros, custo, valorKm, valor, lucro: valor - custo };
}

// Objeto <-> texto seguro para URL (pedido do cliente vai no link)
function paraB64(obj) {
  let s = "";
  new TextEncoder().encode(JSON.stringify(obj)).forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64(t) {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0))));
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("ver");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("ver"), 3200);
}

// ---------- mapas (OpenStreetMap: Nominatim + OSRM) ----------
const RE_COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const RE_NUMERO = /^\d+[A-Za-z]?$/;
const cacheGeo = new Map();
let ultimaConsulta = 0;

/** Nominatim aceita no máximo 1 consulta por segundo. */
async function buscar(url) {
  // reserva o horário antes de esperar, para consultas simultâneas fazerem fila
  const agora = Date.now(), inicio = Math.max(agora, ultimaConsulta + 1100);
  ultimaConsulta = inicio;
  if (inicio > agora) await new Promise(r => setTimeout(r, inicio - agora));
  const r = await fetch(url, { headers: { "Accept-Language": "pt-BR" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Serviço de mapas respondeu ${r.status}. Tente de novo.`);
  return r.json();
}

const semAcento = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// "Rua X, 500, São Paulo, SP" -> "sao paulo" (ignora número, UF, CEP e "Brasil")
function cidadeDigitada(endereco) {
  const partes = endereco.split(/,| - /).map(s => s.trim())
    .filter(s => s && !RE_NUMERO.test(s) && !/^[A-Za-z]{2}$/.test(s) && !/^brasil$/i.test(s) && !/^\d{5}-?\d{3}$/.test(s));
  return partes.length >= 2 ? semAcento(partes[partes.length - 1]) : "";
}
const naCidade = (r, cid) => ["city", "town", "village", "municipality"].some(k => semAcento(r.address?.[k]) === cid);
const consultarGeo = q => buscar("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=br&q=" + encodeURIComponent(q));

/** Endereço ou coordenada "lat, lon" -> {lat, lon, nome}. */
async function localizar(endereco) {
  endereco = endereco.trim();
  const m = endereco.match(RE_COORD);
  if (m) return { lat: +m[1], lon: +m[2], nome: "Coordenada " + endereco };
  const chave = endereco.toLowerCase();
  if (cacheGeo.has(chave)) return cacheGeo.get(chave);

  // O Nominatim às vezes prefere o mesmo número numa rua parecida de outra cidade:
  // escolhe o candidato que está na cidade digitada; se nenhum, tenta sem o número.
  const lista = await consultarGeo(endereco);
  let r = lista[0];
  const cid = cidadeDigitada(endereco);
  if (cid) {
    r = lista.find(x => naCidade(x, cid));
    if (!r) {
      const semNumero = endereco.split(",").map(s => s.trim()).filter(s => !RE_NUMERO.test(s)).join(", ");
      if (semNumero !== endereco) r = (await consultarGeo(semNumero)).find(x => naCidade(x, cid));
      r ??= lista[0];
    }
  }
  if (!r) throw new Error(`Endereço não encontrado: “${endereco}”. Tente “Rua, número, cidade, UF” ou use o GPS.`);
  const p = { lat: +r.lat, lon: +r.lon, nome: r.display_name };
  cacheGeo.set(chave, p);
  return p;
}

/** Rota de carro passando pelos pontos; devolve um trecho {km, seg} por par de pontos. */
async function calcularRota(pontos) {
  const coords = pontos.map(p => `${p.lon},${p.lat}`).join(";");
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Serviço de rotas respondeu ${r.status}. Tente de novo.`);
  const j = await r.json();
  if (j.code !== "Ok") throw new Error("Não foi possível traçar a rota entre os endereços.");
  return j.routes[0].legs.map(l => ({ km: l.distance / 1000, seg: l.duration }));
}

function mensagemErroMapa(e) {
  if (e.name === "TimeoutError") return "O serviço de mapas demorou demais. Tente de novo.";
  if (e instanceof TypeError) return "Sem internet no momento.";
  return e.message;
}

async function enderecoDaCoordenada(lat, lon) {
  try {
    const j = await buscar(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
    return j.display_name || "";
  } catch { return ""; }
}

/** GPS do aparelho -> {lat, lon, precisao, texto: "lat, lon"}. */
function obterGPS() {
  return new Promise((ok, falha) => {
    if (!navigator.geolocation) return falha(new Error("Este aparelho não tem GPS disponível."));
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        ok({ lat, lon, precisao: Math.round(accuracy), texto: `${lat.toFixed(6)}, ${lon.toFixed(6)}` });
      },
      err => falha(new Error(err.code === 1
        ? "Permissão de localização negada. Libere a localização para este site nas configurações do navegador."
        : "Não foi possível obter a localização. Tente de novo ou digite o endereço.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}

const ICONE_GPS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

// ---------- wizard (passo a passo) ----------
/**
 * raiz: elemento com .wiz-progresso, .wiz-num, .wiz-titulo e vários .passo[data-titulo].
 * validar(i) devolve mensagem de erro (ou "") antes de avançar do passo i.
 * aoEntrar(i) roda sempre que um passo é exibido.
 */
function criarWizard(raiz, { voltar, proximo, validar = () => "", aoEntrar = () => {} }) {
  const passos = [...raiz.querySelectorAll(".passo")];
  const prog = raiz.querySelector(".wiz-progresso");
  prog.innerHTML = passos.map((p, i) =>
    `<button type="button" class="wiz-ponto" data-i="${i}" aria-label="Passo ${i + 1}: ${esc(p.dataset.titulo)}"></button>`).join("");
  const pontos = [...prog.children];
  let atual = 0, liberado = 0;

  function desenhar() {
    passos.forEach((p, i) => p.classList.toggle("ativo", i === atual));
    pontos.forEach((b, i) => {
      b.classList.toggle("atual", i === atual);
      b.classList.toggle("feito", i !== atual && i <= liberado);
      b.disabled = i > liberado;
    });
    raiz.querySelector(".wiz-num").textContent = `Passo ${atual + 1} de ${passos.length}`;
    raiz.querySelector(".wiz-titulo").textContent = passos[atual].dataset.titulo;
    voltar.style.visibility = atual === 0 ? "hidden" : "visible";
    proximo.style.visibility = atual === passos.length - 1 ? "hidden" : "visible";
  }
  function ir(i) {
    atual = Math.max(0, Math.min(i, passos.length - 1));
    liberado = Math.max(liberado, atual);
    desenhar();
    window.scrollTo(0, 0);
    aoEntrar(atual);
  }
  function avancar() {
    const erro = validar(atual);
    if (erro) { toast(erro); return; }
    ir(atual + 1);
  }
  proximo.addEventListener("click", avancar);
  voltar.addEventListener("click", () => ir(atual - 1));
  prog.addEventListener("click", e => { const b = e.target.closest(".wiz-ponto"); if (b && !b.disabled) ir(+b.dataset.i); });
  // "Ir/Próximo" do teclado do celular avança o passo
  raiz.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); avancar(); }
  });

  return {
    ir, avancar,
    get atual() { return atual; },
    total: passos.length,
    /** liberarTudo: permite pular para qualquer passo (viagem já preenchida). */
    reiniciar(liberarTudo = false) { liberado = liberarTudo ? passos.length - 1 : 0; },
  };
}
