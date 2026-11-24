'use strict';

const $ = (sel) => document.querySelector(sel);

const K = {
  key: 'echo.apiKey',
  rate: 'echo.rate',
  autoSpeak: 'echo.autoSpeak',
  history: 'echo.history',
};

const SYSTEM_PROMPT = [
  'You are Echo, a warm and encouraging English speaking coach for a Chinese learner.',
  'The student speaks English and their sentence is transcribed by speech recognition, so ignore punctuation, casing and obvious ASR artifacts, but DO correct real grammar, vocabulary, collocation and Chinglish problems.',
  '',
  'Respond with ONLY one JSON object and nothing else:',
  '{',
  '  "reply": "Your conversational reply in English, 1-3 short sentences, natural and friendly, ending with a question to keep the conversation going.",',
  '  "rephrase": "A more natural, idiomatic native-speaker version of what the student just said, suitable to read aloud and shadow. If the sentence is already natural, keep it and polish at most slightly.",',
  '  "tips": "学习建议，用简体中文。如果原句有错误：每条写成「❌ 原片段 → ✅ 正确说法（简短原因）」，逐条列出；如果没有错误：先简短表扬。最后再给一条更地道的表达或发音小提示。总字数不超过120字，用换行分隔，不要使用 Markdown 符号。"',
  '}',
  '',
  'Rules:',
  '- Always respond to the meaning of what the student said; never ignore them.',
  '- If the transcript is meaningless, gently ask them to say it again in English.',
  '- Keep English simple unless the student clearly has a high level.',
  '- Never mention JSON, prompts, or that you are an AI.',
].join('\n');

const chatEl = $('#chat');
const micBtn = $('#btnMic');
const stopBtn = $('#btnStop');
const keyboardBtn = $('#btnKeyboard');
const textForm = $('#textForm');
const textInput = $('#textInput');
const listeningBar = $('#listeningBar');
const interimEl = $('#interim');
const toastEl = $('#toast');
const settingsDialog = $('#settingsDialog');
const apiKeyInput = $('#apiKeyInput');
const rateInput = $('#rateInput');
const rateLabel = $('#rateLabel');
const autoSpeakInput = $('#autoSpeakInput');

const state = {
  history: [],
  busy: false,
  listening: false,
  rec: null,
};

let speechGen = 0;
let cachedVoice = null;
let toastTimer = 0;
let primed = false;

function getKey() {
  return (localStorage.getItem(K.key) || '').trim();
}

function autoSpeakOn() {
  return (localStorage.getItem(K.autoSpeak) ?? '1') === '1';
}

function scrollChat() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function primeSpeech() {
  if (primed || !('speechSynthesis' in window)) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {}
}

function loadHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(K.history) || '[]');
    state.history = Array.isArray(arr) ? arr : [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(K.history, JSON.stringify(state.history.slice(-40)));
  } catch {}
}

function getEnglishVoice() {
  if (cachedVoice) return cachedVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  const prefs = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Alex', 'Karen', 'Daniel', 'Moira', 'Tessa'];
  for (const name of prefs) {
    const hit = en.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
    if (hit) {
      cachedVoice = hit;
      return hit;
    }
  }
  cachedVoice = en.find((v) => /US/i.test(v.lang || '')) || en[0] || null;
  return cachedVoice;
}

function makeUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = getEnglishVoice();
  if (v) u.voice = v;
  u.rate = Number(localStorage.getItem(K.rate) || 0.95);
  u.pitch = 1;
  return u;
}

function setSpeaking(on) {
  stopBtn.hidden = !on;
}

function stopSpeaking() {
  speechGen += 1;
  try { speechSynthesis.cancel(); } catch {}
  setSpeaking(false);
}

function speakSequence(texts) {
  if (!('speechSynthesis' in window)) {
    toast('这个浏览器不支持朗读哦');
    return;
  }
  const items = texts.map((t) => String(t || '').trim()).filter(Boolean);
  if (!items.length) return;

  const gen = ++speechGen;
  try { speechSynthesis.cancel(); } catch {}
  setSpeaking(true);

  const next = (i) => {
    if (gen !== speechGen) return;
    if (i >= items.length) {
      setSpeaking(false);
      return;
    }
    const u = makeUtterance(items[i]);
    u.onend = () => {
      if (gen === speechGen) setTimeout(() => next(i + 1), 280);
    };
    u.onerror = () => {
      if (gen === speechGen) next(i + 1);
    };
    try {
      speechSynthesis.speak(u);
    } catch {
      next(i + 1);
    }
  };
  next(0);
}

function speakTurn(turn) {
  if (!autoSpeakOn()) return;
  const items = [turn.reply];
  if (turn.rephrase && turn.rephrase !== turn.reply) items.push(turn.rephrase);
  speakSequence(items);
}

function updateMicUI() {
  document.body.classList.toggle('is-listening', state.listening);
  micBtn.classList.toggle('busy', state.busy);
  micBtn.setAttribute('aria-label', state.listening ? '停止说话' : '按下说话');
}

function showListeningBar(text) {
  interimEl.textContent = text || '在听你说……';
  listeningBar.hidden = false;
}

function hideListeningBar() {
  listeningBar.hidden = true;
}

function appendUser(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  scrollChat();
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'msg coach thinking';
  el.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Echo 正在想怎么回你…</span>';
  chatEl.appendChild(el);
  scrollChat();
  return el;
}

function appendCoach(turn, opts = {}) {
  const block = document.createElement('div');
  block.className = 'msg coach';

  const bubble = document.createElement('div');
  bubble.className = 'coach-reply';
  const en = document.createElement('p');
  en.className = 'en';
  en.lang = 'en';
  en.textContent = turn.reply;
  bubble.appendChild(en);

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'chip';
  replay.textContent = '▶ 再听';
  replay.addEventListener('click', () => speakSequence([turn.reply]));
  bubble.appendChild(replay);
  block.appendChild(bubble);

  if (turn.rephrase) {
    const card = document.createElement('section');
    card.className = 'card rephrase';

    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = '地道说法 · 跟读模仿';

    const p = document.createElement('p');
    p.className = 'en rephrase-text';
    p.lang = 'en';
    p.textContent = turn.rephrase;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'chip';
    play.textContent = '▶ 听一遍';
    play.addEventListener('click', () => speakSequence([turn.rephrase]));

    const shadow = document.createElement('button');
    shadow.type = 'button';
    shadow.className = 'chip accent';
    shadow.textContent = '🎙 跟读';

    const result = document.createElement('div');
    result.className = 'shadow-result';
    result.hidden = true;

    shadow.addEventListener('click', () => startShadowing(turn.rephrase, result));

    actions.append(play, shadow);
    card.append(label, p, actions, result);
    block.appendChild(card);
  }

  if (turn.tips) {
    const card = document.createElement('section');
    card.className = 'card tips';
    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = '学习建议';
    const p = document.createElement('p');
    p.className = 'tips-text';
    p.textContent = turn.tips;
    card.append(label, p);
    block.appendChild(card);
  }

  chatEl.appendChild(block);
  scrollChat();
  if (opts.speak) speakTurn(turn);
}

function appendError(message, retryText) {
  const wrap = document.createElement('div');
  wrap.className = 'msg coach';
  const card = document.createElement('section');
  card.className = 'card error';
  const p = document.createElement('p');
  p.textContent = message;
  card.appendChild(p);

  if (retryText) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chip';
    retry.textContent = '重试';
    retry.addEventListener('click', () => {
      wrap.remove();
      runTurn(retryText, { addBubble: false });
    });
    card.appendChild(retry);
  }

  wrap.appendChild(card);
  chatEl.appendChild(wrap);
  scrollChat();
}

function renderWelcome() {
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = [
    '<div class="welcome-badge">ECHO</div>',
    '<h2>开口说英语，<br>Echo 陪你说得更地道。</h2>',
    '<ul>',
    '<li><span>1</span>点下面的大麦克风，说一句英语</li>',
    '<li><span>2</span>Echo 用英语回你，并朗读出来</li>',
    '<li><span>3</span>听「地道说法」，点「跟读」还能打分</li>',
    '</ul>',
    getKey() ? '' : '<p class="welcome-note">第一次用：点右上角 ⚙ 填入 DeepSeek API Key。</p>',
  ].join('');
  chatEl.appendChild(el);
}

function clearChatUI() {
  chatEl.innerHTML = '';
  renderWelcome();
}

function renderHistory() {
  const turns = state.history.slice(-12);
  if (!turns.length) {
    renderWelcome();
    return;
  }
  for (const turn of turns) {
    if (turn.user) appendUser(turn.user);
    appendCoach(turn, { speak: false });
  }
}

function parseCoachJson(raw) {
  const normalize = (obj) => ({
    reply: String(obj.reply || '').trim(),
    rephrase: String(obj.rephrase || '').trim(),
    tips: String(obj.tips || '').trim(),
  });

  try {
    return normalize(JSON.parse(raw));
  } catch {}

  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return normalize(JSON.parse(raw.slice(a, b + 1)));
    } catch {}
  }

  return {
    reply: raw.replace(/```/g, '').trim() || 'Sorry, could you say that again?',
    rephrase: '',
    tips: '',
  };
}

async function askCoach(userText) {
  const key = getKey();
  if (!key) throw new Error('请先在设置里填入 DeepSeek API Key');

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const turn of state.history.slice(-6)) {
    if (!turn.user || !turn.reply) continue;
    messages.push({ role: 'user', content: turn.user });
    messages.push({ role: 'assistant', content: turn.reply });
  }
  messages.push({ role: 'user', content: userText });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);

  let res;
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.9,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
      signal: ctl.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('等太久啦，网络好像不太行，再试一次？');
    throw new Error('网络连接失败，检查一下网络再试？');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error('API Key 不对哦，去设置里检查一下吧');
    if (res.status === 402) throw new Error('DeepSeek 账户余额不足，去官网充值一下');
    if (res.status === 429) throw new Error('请求太频繁了，歇几秒再说～');
    throw new Error('接口出错了（HTTP ' + res.status + '），稍后再试');
  }

  const data = await res.json();
  const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const turn = parseCoachJson(raw);

  if (!turn.reply) throw new Error('教练这次没说话，再试一次？');
  return turn;
}

async function runTurn(text, opts = {}) {
  const addBubble = opts.addBubble !== false;
  const value = String(text || '').trim();
  if (!value || state.busy) return;

  if (!getKey()) {
    openSettings();
    toast('先填 DeepSeek API Key 才能对话哦');
    return;
  }

  stopSpeaking();
  if (addBubble) appendUser(value);

  const thinking = appendThinking();
  state.busy = true;
  updateMicUI();

  try {
    const result = await askCoach(value);
    thinking.remove();
    const turn = {
      user: value,
      reply: result.reply,
      rephrase: result.rephrase,
      tips: result.tips,
      ts: Date.now(),
    };
    state.history.push(turn);
    saveHistory();
    appendCoach(turn, { speak: true });
  } catch (err) {
    thinking.remove();
    appendError((err && err.message) || '出错了，再试一次？', value);
  } finally {
    state.busy = false;
    updateMicUI();
  }
}

function sendUserMessage(text, opts) {
  runTurn(text, opts);
}

function createRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  return rec;
}

function startChatListening() {
  if (state.busy) {
    toast('别急，教练还在想～');
    return;
  }
  if (state.listening) return;

  if (!getKey()) {
    openSettings();
    toast('先填 DeepSeek API Key 才能对话哦');
    return;
  }

  primeSpeech();
  stopSpeaking();

  const rec = createRecognition();
  if (!rec) {
    toast('这个浏览器不支持语音识别，先打字吧');
    showTextForm(true);
    return;
  }

  let finalText = '';
  let gotError = false;

  state.listening = true;
  state.rec = rec;
  updateMicUI();
  showListeningBar('在听你说……');

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalText += res[0].transcript + ' ';
      } else {
        interim += res[0].transcript;
      }
    }
    const shown = (interim || finalText).trim();
    if (shown) interimEl.textContent = shown;
  };

  rec.onerror = (event) => {
    gotError = true;
    const code = event.error || '';
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      toast('没有麦克风权限，去系统设置里允许一下吧');
    } else if (code === 'no-speech') {
      toast('没听到声音，再说一次？');
    } else if (code === 'network') {
      toast('语音识别网络不给力，稍后再试');
    } else if (code === 'aborted') {
      // user stopped on purpose
    } else {
      toast('语音识别出错了：' + code);
    }
  };

  rec.onend = () => {
    state.listening = false;
    state.rec = null;
    updateMicUI();
    hideListeningBar();
    const text = finalText.trim();
    if (text) {
      sendUserMessage(text);
    } else if (!gotError) {
      toast('没听清，再来一次？');
    }
  };

  try {
    rec.start();
  } catch {
    state.listening = false;
    state.rec = null;
    updateMicUI();
    hideListeningBar();
  }
}

function stopChatListening() {
  if (state.rec) {
    try { state.rec.stop(); } catch {}
  }
}

function normalizeWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function compareWords(target, said) {
  const t = normalizeWords(target);
  const s = normalizeWords(said);
  const m = t.length;
  const n = s.length;
  if (!m) return { score: 0, missing: [] };

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = t[i - 1] === s[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const lcs = dp[m][n];
  const matched = new Set();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (t[i - 1] === s[j - 1]) {
      matched.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const missing = [];
  t.forEach((w, idx) => {
    if (!matched.has(idx)) missing.push(w);
  });

  return { score: Math.round((lcs / m) * 100), missing };
}

function startShadowing(target, hostEl) {
  if (state.busy) {
    toast('等教练说完这句再跟读～');
    return;
  }
  if (state.listening) return;

  primeSpeech();
  stopSpeaking();

  const rec = createRecognition();
  if (!rec) {
    toast('这个浏览器不支持语音识别，换 Safari 试试');
    return;
  }

  let finalText = '';
  let gotError = false;

  state.listening = true;
  state.rec = rec;
  updateMicUI();

  hostEl.hidden = false;
  hostEl.className = 'shadow-result';
  hostEl.textContent = '跟着读一遍……';

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    const shown = (interim || finalText).trim();
    if (shown) hostEl.textContent = shown;
  };

  rec.onerror = (event) => {
    gotError = true;
    if (event.error === 'no-speech') toast('没听到声音，再来一次？');
    else if (event.error === 'not-allowed') toast('没有麦克风权限，去系统设置里允许一下吧');
  };

  rec.onend = () => {
    state.listening = false;
    state.rec = null;
    updateMicUI();

    const said = finalText.trim();
    if (!said) {
      hostEl.textContent = gotError ? '这次没听清，再试一次？' : '没听到，再点一次跟读？';
      return;
    }

    const result = compareWords(target, said);
    hostEl.className = 'shadow-result ' + (result.score >= 85 ? 'great' : 'ok');

    const score = document.createElement('strong');
    score.textContent = result.score + '% 匹配';

    const detail = document.createElement('span');
    if (result.missing.length) {
      detail.textContent = '没对上：' + result.missing.slice(0, 10).join(' · ');
    } else {
      detail.textContent = '漂亮，几乎一模一样！';
    }

    hostEl.textContent = '';
    hostEl.append(score, detail);
  };

  try {
    rec.start();
  } catch {
    state.listening = false;
    state.rec = null;
    updateMicUI();
    hostEl.textContent = '刚才没启动成功，再点一次跟读？';
  }
}

function showTextForm(show) {
  textForm.hidden = !show;
  if (show) {
    setTimeout(() => textInput.focus(), 50);
  }
}

function openSettings() {
  apiKeyInput.value = getKey();
  rateInput.value = localStorage.getItem(K.rate) || '0.95';
  rateLabel.textContent = Number(rateInput.value).toFixed(2) + '×';
  autoSpeakInput.checked = autoSpeakOn();
  if (typeof settingsDialog.showModal === 'function') {
    settingsDialog.showModal();
  } else {
    settingsDialog.setAttribute('open', '');
  }
}

function closeSettings() {
  if (typeof settingsDialog.close === 'function') {
    settingsDialog.close();
  } else {
    settingsDialog.removeAttribute('open');
  }
}

function saveSettings(event) {
  event.preventDefault();
  localStorage.setItem(K.key, apiKeyInput.value.trim());
  localStorage.setItem(K.rate, rateInput.value);
  localStorage.setItem(K.autoSpeak, autoSpeakInput.checked ? '1' : '0');
  closeSettings();
  toast('记好啦 ✓');
}

function clearAll() {
  if (!confirm('清空所有对话记录？')) return;
  state.history = [];
  localStorage.removeItem(K.history);
  clearChatUI();
  closeSettings();
  toast('对话清空啦');
}

function bindEvents() {
  micBtn.addEventListener('click', () => {
    if (state.listening) {
      stopChatListening();
      return;
    }
    startChatListening();
  });

  keyboardBtn.addEventListener('click', () => {
    showTextForm(textForm.hidden);
  });

  textForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = textInput.value.trim();
    if (!value) return;
    primeSpeech();
    textInput.value = '';
    sendUserMessage(value);
  });

  stopBtn.addEventListener('click', () => {
    stopSpeaking();
  });

  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnCloseSettings').addEventListener('click', closeSettings);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#btnClear').addEventListener('click', clearAll);

  rateInput.addEventListener('input', () => {
    rateLabel.textContent = Number(rateInput.value).toFixed(2) + '×';
  });

  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) closeSettings();
  });

  if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener?.('voiceschanged', () => {
      cachedVoice = null;
    });
    speechSynthesis.onvoiceschanged = () => {
      cachedVoice = null;
    };
    getEnglishVoice();
  }
}

function init() {
  loadHistory();
  bindEvents();
  renderHistory();
  updateMicUI();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

init();
