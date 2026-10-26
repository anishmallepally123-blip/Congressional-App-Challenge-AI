// TinyGPT in the browser: the small model we built and trained from scratch, running right
// in this page with plain JavaScript. No server, no graphics card, no library.
// The math matches chatbot/tinygpt.py (and experiments/tiny-gpt/model.py), written out by hand.

const MODEL_URL = "https://raw.githubusercontent.com/anishmallepally123-blip/Congressional-App-Challenge-AI/"
  + "main/experiments/tiny-gpt/release/tinygpt-shakespeare.bin";

// ---------- Reading the model file ----------
// Layout: "TGPT", version (uint32), header length (uint32), a JSON header, then every
// tensor's numbers as little-endian 32-bit floats, in the order the header lists them.

function parseModel(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "TGPT") throw new Error("That isn't a TinyGPT model file.");
  if (view.getUint32(4, true) !== 1) throw new Error("This TinyGPT file is from a newer version.");
  const headLen = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headLen)));
  let offset = 12 + headLen;
  const w = {};
  for (const t of header.tensors) {
    const count = t.shape.reduce((a, b) => a * b, 1);
    // slice() copies, so the floats line up even when the header length isn't a multiple of 4.
    const flat = new Float32Array(buffer.slice(offset, offset + 4 * count));
    offset += 4 * count;
    w[t.name] = { data: flat, rows: t.shape[0], cols: t.shape[1] || 1 };
  }
  if (offset !== buffer.byteLength) throw new Error("The TinyGPT file is damaged (wrong size).");
  const cfg = header.config;
  return {
    w, chars: header.chars, stoi: new Map(header.chars.map((c, i) => [c, i])),
    blockSize: cfg.block_size, nEmbd: cfg.n_embd, nHead: cfg.n_head, nLayer: cfg.n_layer,
    info: { steps: header.steps, valLoss: header.val_loss, trainedOn: header.trained_on },
  };
}

// ---------- The math ----------

function matvec(m, bias, x) {
  const out = new Float32Array(m.rows);
  for (let r = 0; r < m.rows; r++) {
    let s = bias.data[r];
    const base = r * m.cols;
    for (let c = 0; c < m.cols; c++) s += m.data[base + c] * x[c];
    out[r] = s;
  }
  return out;
}

function layerNorm(x, w, b, eps = 1e-5) {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const s = 1 / Math.sqrt(variance / x.length + eps);
  return x.map((v, i) => (v - mean) * s * w.data[i] + b.data[i]);
}

// JavaScript has no erf(), so this uses a standard approximation (accurate to about 1e-7).
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
const gelu = (v) => 0.5 * v * (1 + erf(v / Math.SQRT2));

// Run one character through the model. cache[layer] holds the earlier characters' keys and values,
// so each new character needs only one pass.
function step(model, token, pos, cache) {
  const { w, nEmbd: C, nHead: H, nLayer } = model;
  const hs = C / H;
  const scale = 1 / Math.sqrt(hs);
  let x = new Float32Array(C);
  for (let i = 0; i < C; i++) x[i] = w["token_emb.weight"].data[token * C + i] + w["pos_emb.weight"].data[pos * C + i];
  for (let l = 0; l < nLayer; l++) {
    const p = `blocks.${l}.`;
    let h = layerNorm(x, w[p + "ln1.weight"], w[p + "ln1.bias"]);
    const qkv = matvec(w[p + "attn.qkv.weight"], w[p + "attn.qkv.bias"], h);
    const q = qkv.subarray(0, C);
    const { keys, values } = cache[l];
    keys.push(qkv.slice(C, 2 * C));
    values.push(qkv.slice(2 * C));
    const out = new Float32Array(C);
    for (let hd = 0; hd < H; hd++) {
      const a = hd * hs;
      const scores = keys.map((k) => {
        let s = 0;
        for (let i = 0; i < hs; i++) s += q[a + i] * k[a + i];
        return s * scale;
      });
      const top = Math.max(...scores);
      const exps = scores.map((s) => Math.exp(s - top));
      const total = exps.reduce((s, e) => s + e, 0);
      exps.forEach((e, j) => {
        const wgt = e / total;
        for (let i = 0; i < hs; i++) out[a + i] += wgt * values[j][a + i];
      });
    }
    const proj = matvec(w[p + "attn.proj.weight"], w[p + "attn.proj.bias"], out);
    x = x.map((v, i) => v + proj[i]);
    h = layerNorm(x, w[p + "ln2.weight"], w[p + "ln2.bias"]);
    const hidden = matvec(w[p + "ff.net.0.weight"], w[p + "ff.net.0.bias"], h).map(gelu);
    const ff = matvec(w[p + "ff.net.2.weight"], w[p + "ff.net.2.bias"], hidden);
    x = x.map((v, i) => v + ff[i]);
  }
  x = layerNorm(x, w["ln_f.weight"], w["ln_f.bias"]);
  return matvec(w["head.weight"], w["head.bias"], x);
}

function prime(model, ids) {
  const cache = Array.from({ length: model.nLayer }, () => ({ keys: [], values: [] }));
  let logits = null;
  ids.forEach((t, pos) => { logits = step(model, t, pos, cache); });
  return { logits, cache };
}

// Pick the next character: keep the top_k likeliest, soften by temperature, roll the dice.
function sample(logits, temperature, topK = 20) {
  const best = [...logits.keys()].sort((a, b) => logits[b] - logits[a]).slice(0, topK);
  const weights = best.map((i) => Math.exp((logits[i] - logits[best[0]]) / temperature));
  let roll = Math.random() * weights.reduce((s, v) => s + v, 0);
  for (let i = 0; i < best.length; i++) if ((roll -= weights[i]) <= 0) return best[i];
  return best[best.length - 1];
}

// Yields new characters one at a time, continuing the prompt.
function* generate(model, prompt, temperature, maxChars) {
  let ids = [...prompt].filter((c) => model.stoi.has(c)).map((c) => model.stoi.get(c));
  if (!ids.length) ids = [model.stoi.get("\n") ?? 0];
  ids = ids.slice(-model.blockSize);
  let { logits, cache } = prime(model, ids);
  for (let n = 0; n < maxChars; n++) {
    const next = sample(logits, Math.max(temperature, 0.05));
    ids.push(next);
    yield model.chars[next];
    if (cache[0].keys.length >= model.blockSize) {
      // Its memory is full: start over from the newest half so positions stay within training.
      ({ logits, cache } = prime(model, ids.slice(-(model.blockSize / 2))));
    } else {
      logits = step(model, next, cache[0].keys.length, cache);
    }
  }
}

// ---------- The page ----------

const $ = (id) => document.getElementById(id);
let model = null;
let running = false;

async function loadModel() {
  $("status").textContent = "Downloading TinyGPT (3.3 MB)...";
  try {
    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error(`the download failed (${resp.status})`);
    model = parseModel(await resp.arrayBuffer());
  } catch (err) {
    $("status").textContent = `Couldn't load TinyGPT: ${err.message}. Check your internet connection and reload.`;
    return;
  }
  const weights = Object.values(model.w).reduce((s, t) => s + t.data.length, 0);
  $("status").textContent = `Ready. ${Math.round(weights / 1000)} thousand weights, trained for ${model.info.steps.toLocaleString()} steps on Shakespeare's plays.`;
  $("go").disabled = false;
}

async function run() {
  if (running) { running = false; return; }
  running = true;
  $("go").textContent = "■ Stop";
  const prompt = $("prompt").value || "\n";
  const out = $("output");
  out.textContent = "";
  out.append(Object.assign(document.createElement("b"), { textContent: prompt }));
  const written = document.createTextNode("");
  out.append(written);
  const started = performance.now();
  let count = 0;
  const gen = generate(model, prompt, Number($("temperature").value), Number($("length").value));
  // A few characters per frame keeps the page smooth and lets you watch it write.
  await new Promise((done) => {
    const frame = () => {
      for (let i = 0; i < 3 && running; i++) {
        const next = gen.next();
        if (next.done) { running = false; break; }
        written.data += next.value;
        count++;
      }
      out.scrollTop = out.scrollHeight;
      running ? requestAnimationFrame(frame) : done();
    };
    requestAnimationFrame(frame);
  });
  const secs = (performance.now() - started) / 1000;
  $("speed").textContent = `${count} characters in ${secs.toFixed(1)} s, all on your device.`;
  $("go").textContent = "✨ Write";
}

$("go").addEventListener("click", run);
$("temperature").addEventListener("input", (e) => { $("temperature-value").textContent = Number(e.target.value).toFixed(1); });
document.querySelectorAll("[data-prompt]").forEach((b) => b.addEventListener("click", () => {
  $("prompt").value = b.dataset.prompt;
  if (!running && model) run();
}));
loadModel();
