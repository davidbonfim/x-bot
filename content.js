// --- CONFIGURAÇÃO GLOBAL ---
let state = {
  isRunning: false,
  config: {},
  apiKey: '',
  stats: { likes: 0, comments: 0, follows: 0 },
  limits: { likes: 50, comments: 20, follows: 15 },
  customPrompt: null,
  actionCount: 0, // Para pausas aleatórias
  cooldownUntil: null
};
let timer = null;
let modalOpenedAt = null;
let systemPrompt = null;
let systemPromptLoadPromise = null;

// --- DEFAULT PROMPT ---
const DEFAULT_SYSTEM_PROMPT = `Atue como um desenvolvedor experiente especializado em tecnologia e inovação.
CONTEXTO: Você é um profissional engajado em discussões técnicas, valorizando código limpo, boas práticas e compartilhamento de conhecimento. Seu objetivo é construir autoridade no espaço tech através de engajamentos de alto nível, não fazendo promoção excessiva.

REGRA:
1. Detecte o idioma do post e SEMPRE responda no mesmo idioma.
2. Antes de responder, avalie se o post tem qualidade (profundidade técnica, notícias interessantes ou uma pergunta válida). Se for de baixo esforço, spam ou genérico, responda exatamente 'SKIP'.
3. Comente apenas se puder agregar insight técnico acionável ou uma perspectiva profissional; máximo 40 palavras, tom conversacional mas profissional.
4. Quando o tema envolver escalabilidade, segurança, desenvolvimento, arquitetura ou experiência de desenvolvedor:
   - Naturalmente contraste problemas comuns com soluções modernas.
   - OU faça uma pergunta técnica específica relacionada ao post para iniciar um diálogo.
5. SEM hashtags, SEM "confira meu perfil", SEM "para a lua", e evite parecer um embaixador pago. Seja um par.`;

// --- DELAYS BASEADOS NO NÍVEL DE PROTEÇÃO ---
function getProtectionDelays() {
  const level = state.config.protectionLevel || 'advanced';

  switch (level) {
    case 'basic':
      return { min: 5000, max: 15000, pauseMin: 0, pauseMax: 0 };
    case 'intermediate':
      return { min: 10000, max: 30000, pauseMin: 30000, pauseMax: 60000 };
    case 'advanced':
    default:
      return { min: 15000, max: 45000, pauseMin: 30000, pauseMax: 120000 };
  }
}

// --- VERIFICAR LIMITES DIÁRIOS ---
function hasReachedLimit(action) {
  const limit = state.limits[action];
  if (!limit || limit === 0) return false; // 0 = sem limite

  return state.stats[action] >= limit;
}

function shouldTakeRandomPause() {
  const level = state.config.protectionLevel || 'advanced';

  if (level === 'basic') return false;

  // Pausa a cada 5-10 ações
  const pauseFrequency = level === 'intermediate' ? 7 : 5;
  return state.actionCount > 0 && state.actionCount % pauseFrequency === 0;
}

// --- VERIFICAR COOLDOWN ---
function isInCooldown() {
  return state.cooldownUntil && Date.now() < state.cooldownUntil;
}

// --- SIMULAR MOVIMENTO DE MOUSE HUMANO ---
async function simulateHumanMouse(element) {
  if (!element) return;

  try {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Pequeno movimento aleatório
    const randomX = centerX + (Math.random() - 0.5) * 10;
    const randomY = centerY + (Math.random() - 0.5) * 10;

    element.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: randomX,
      clientY: randomY,
      cancelable: true
    }));

    await wait(100 + Math.random() * 200);
  } catch (e) {
    // Silencioso, não é crítico
  }
}

// --- UI HELPERS ---
const statusPanel = document.createElement('div');
statusPanel.style.cssText = `
  position: fixed; bottom: 20px; right: 20px;
  background: rgba(0, 0, 0, 0.9); color: white;
  padding: 12px; border-radius: 8px; font-family: sans-serif;
  z-index: 99999; font-size: 13px; display: none;
  border: 1px solid #1da1f2; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
  max-width: 250px; pointer-events: none;
`;
document.body.appendChild(statusPanel);

function updateStatus(text) {
  statusPanel.innerHTML = `<strong>🤖 X-Bot</strong><br>${text}<br>
  <div style="font-size:10px; color:#aaa; margin-top:5px; display:flex; gap:8px;">
    <span>❤️ ${state.stats.likes}</span>
    <span>💬 ${state.stats.comments}</span>
    <span>➕ ${state.stats.follows}</span>
  </div>`;
  statusPanel.style.display = 'block';
}

function saveStats() {
  try {
    chrome.storage.local.set({ sessionStats: state.stats });
  } catch (e) {
    console.warn('Erro ao salvar estatísticas:', e);
  }
}

// --- SAFE QUERY SELECTOR ---
function safeQuerySelector(selector, context = document) {
  try {
    return context.querySelector(selector);
  } catch (e) {
    console.warn('Selector inválido:', selector);
    return null;
  }
}

function safeQuerySelectorAll(selector, context = document) {
  try {
    return Array.from(context.querySelectorAll(selector));
  } catch (e) {
    console.warn('Selector inválido:', selector);
    return [];
  }
}

// --- INIT ---
chrome.storage.local.get(
  ['isRunning', 'xConfig', 'apiKey', 'dailyLimits', 'customPrompt', 'sessionStats', 'lastResetDate'],
  (res) => {
    // Resetar estatísticas se for um novo dia
    const today = new Date().toDateString();
    if (res.lastResetDate !== today) {
      chrome.storage.local.set({
        sessionStats: { likes: 0, comments: 0, follows: 0 },
        lastResetDate: today
      });
      state.stats = { likes: 0, comments: 0, follows: 0 };
    } else {
      state.stats = res.sessionStats || { likes: 0, comments: 0, follows: 0 };
    }

    if (res.isRunning && res.xConfig) {
      state.isRunning = true;
      state.config = res.xConfig;
      state.apiKey = res.apiKey;
      state.limits = res.dailyLimits || { likes: 50, comments: 20, follows: 15 };
      state.customPrompt = res.customPrompt || null;

      console.log('X-Bot Iniciado', state.config);
      updateStatus('Iniciando motores...');
      runTwitterLoop();
    }
  }
);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.isRunning) {
    if (!changes.isRunning.newValue) {
      state.isRunning = false;
      if (timer) clearTimeout(timer);
      updateStatus('Parado.');
      setTimeout(() => statusPanel.style.display = 'none', 3000);
    } else {
      // Se reactivó
      chrome.storage.local.get(
        ['xConfig', 'apiKey', 'dailyLimits', 'customPrompt', 'sessionStats'],
        (res) => {
          state.isRunning = true;
          state.config = res.xConfig;
          state.apiKey = res.apiKey;
          state.limits = res.dailyLimits || { likes: 50, comments: 20, follows: 15 };
          state.customPrompt = res.customPrompt || null;
          state.stats = res.sessionStats || { likes: 0, comments: 0, follows: 0 };
          runTwitterLoop();
        }
      );
    }
  }

  // Atualizar limites se mudarem
  if (changes.dailyLimits && changes.dailyLimits.newValue) {
    state.limits = changes.dailyLimits.newValue;
  }

  // Atualizar stats se mudarem externamente
  if (changes.sessionStats && changes.sessionStats.newValue) {
    state.stats = changes.sessionStats.newValue;
  }
});

async function loadSystemPrompt() {
  // Usar prompt customizado se disponível
  if (state.customPrompt) {
    return state.customPrompt;
  }

  // Tentar carregar do arquivo prompt.txt
  if (systemPrompt) return systemPrompt;

  if (!systemPromptLoadPromise) {
    const promptUrl = chrome.runtime.getURL('prompt.txt');
    systemPromptLoadPromise = fetch(promptUrl)
      .then(res => {
        if (!res.ok) throw new Error('Arquivo não encontrado');
        return res.text();
      })
      .then(text => {
        systemPrompt = text;
        return systemPrompt;
      })
      .catch(err => {
        console.warn('Não foi possível carregar prompt.txt, usando padrão');
        systemPrompt = DEFAULT_SYSTEM_PROMPT;
        return systemPrompt;
      });
  }

  return systemPromptLoadPromise;
}

// --- OPENAI HELPER COM RETRY ---
async function generateAIComment(text, retries = 2) {
  if (!state.apiKey) return null;
  const prompt = await loadSystemPrompt();
  if (!prompt) return null;

  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: `Tweet: "${text}"` }
          ],
          max_tokens: 60
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limiting - esperar mais tempo
          console.warn('Rate limit detectado, aguardando...');
          await wait(60000);
          continue;
        }
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content?.trim();

      if (!content || content.includes('SKIP')) return null;
      return content.replace(/"/g, '');
    } catch (e) {
      if (e.name === 'AbortError') {
        console.warn('Timeout na API OpenAI');
        if (i < retries) {
          await wait(5000);
          continue;
        }
      } else {
        console.error('Erro na API OpenAI:', e);
      }
      if (i === retries) return null;
    }
  }

  return null;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function forceCloseModal(modal) {
  try {
    const closeButtons = [
      ...safeQuerySelectorAll('[data-testid="app-bar-close"]', modal),
      ...safeQuerySelectorAll('[aria-label="Close"]', modal),
      ...safeQuerySelectorAll('[aria-label="Cerrar"]', modal),
      ...safeQuerySelectorAll('[aria-label="Fechar"]', modal)
    ];

    if (closeButtons.length) {
      closeButtons.forEach(btn => btn.click());
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
    updateStatus('Modal forçado a fechar ⏱️');
  } catch (error) {
    console.warn('Não foi possível fechar o modal automaticamente', error);
  }
}

// Melhorar monitoramento de modais com múltiplos seletores
function monitorModals() {
  const modalSelectors = [
    '[role="dialog"]',
    '[data-testid="dialog"]',
    '.css-1dbjc4n[role="dialog"]'
  ];

  let modal = null;
  for (const selector of modalSelectors) {
    modal = safeQuerySelector(selector);
    if (modal) break;
  }

  if (modal && !modalOpenedAt) {
    modalOpenedAt = Date.now();
  } else if (!modal && modalOpenedAt) {
    modalOpenedAt = null;
  }

  if (modal && modalOpenedAt && Date.now() - modalOpenedAt >= 10000) {
    forceCloseModal(modal);
    modalOpenedAt = null;
  }
}

setInterval(monitorModals, 1000);

// --- DETECTAR SHADOWBAN ---
function isActionBlocked(element) {
  // Verificar se o elemento foi clicado mas não houve resposta
  // ou se há indicadores de bloqueio
  return false; // Implementação básica, pode ser expandida
}

// ==========================================
// DRIVER TWITTER / X
// ==========================================
async function runTwitterLoop() {
  if (!state.isRunning) return;

  // Verificar cooldown
  if (isInCooldown()) {
    const remaining = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
    updateStatus(`Cooldown: ${remaining}s restantes`);
    timer = setTimeout(runTwitterLoop, 5000);
    return;
  }

  try {
    // Verificar limites diários globais
    if (hasReachedLimit('likes') && hasReachedLimit('comments') && hasReachedLimit('follows')) {
      updateStatus('Limite diário atingido! 🛑');
      state.isRunning = false;
      chrome.storage.local.set({ isRunning: false });
      setTimeout(() => statusPanel.style.display = 'none', 5000);
      return;
    }

    const tweets = safeQuerySelectorAll('article');

    // Buscar um tweet visível que não hayamos procesado
    const target = tweets.find(t => {
      const r = t.getBoundingClientRect();
      return r.top > 50 && r.top < window.innerHeight - 100 && !t.hasAttribute('data-bot-proc');
    });

    if (target) {
      target.setAttribute('data-bot-proc', 'true');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await wait(1000);

      const alreadyLiked = !!safeQuerySelector('[data-testid="unlike"]', target);

      if (alreadyLiked) {
        updateStatus('Pulando post já curtido 👍');
      } else {
        // Decidir aleatoriamente quais ações fazer (comportamento mais humano)
        const shouldLike = !hasReachedLimit('likes') && Math.random() > 0.1; // 90% chance de like
        const shouldComment = !hasReachedLimit('comments') && state.config.comments && state.apiKey && Math.random() > 0.5; // 50% chance
        const shouldFollow = !hasReachedLimit('follows') && state.config.follow && Math.random() > 0.6; // 40% chance

        // 1. LIKE
        if (shouldLike) {
          const likeBtn = safeQuerySelector('[data-testid="like"]', target);
          if (likeBtn) {
            await simulateHumanMouse(likeBtn);
            likeBtn.click();
            state.stats.likes++;
            saveStats();
            updateStatus('Like ❤️');
            await wait(1000 + Math.random() * 1000);
          }
        }

        // 2. FOLLOW (Si está habilitado)
        if (shouldFollow) {
          const userLink = safeQuerySelector('[data-testid="User-Name"] a', target);
          if (userLink) {
            updateStatus('Verificando follow...');
            userLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await wait(2500); // Esperar popup

            // Buscar botón seguir com múltiplos idiomas
            const followBtn = safeQuerySelectorAll('[role="button"]')
              .find(b => {
                const txt = b.innerText.toLowerCase().trim();
                return txt === 'follow' || txt === 'seguir' || txt === 'follow back';
              });

            if (followBtn && !followBtn.disabled) {
              await simulateHumanMouse(followBtn);
              followBtn.click();
              state.stats.follows++;
              saveStats();
              updateStatus('Seguido ➕');
              await wait(1000 + Math.random() * 500);
            }
            userLink.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
          }
        }

        // 3. COMMENT (Si está habilitado y hay API Key)
        if (shouldComment) {
          const txtElement = safeQuerySelector('[data-testid="tweetText"]', target);
          if (txtElement && !hasReachedLimit('comments')) {
            const txt = txtElement.innerText;
            updateStatus('Pensando 🧠...');

            const comment = await generateAIComment(txt);

            if (comment) {
              const replyBtn = safeQuerySelector('[data-testid="reply"]', target);
              if (replyBtn) {
                replyBtn.click();
                await wait(2000);

                // Editor de resposta
                const editor = safeQuerySelector('[data-testid="tweetTextarea_0"]');
                if (editor) {
                  editor.focus();
                  document.execCommand('insertText', false, comment);
                  await wait(1000);

                  const sendBtn = safeQuerySelector('[data-testid="tweetButton"]');
                  if (sendBtn && !sendBtn.disabled) {
                    sendBtn.click();
                    state.stats.comments++;
                    saveStats();
                    updateStatus('Comentado 💬');
                    await wait(2000);
                  }
                }
              }
            }
          }
        }
      }

      state.actionCount++;

      // Verificar pausa aleatória
      if (shouldTakeRandomPause()) {
        const delays = getProtectionDelays();
        const pauseDuration = delays.pauseMin + Math.random() * (delays.pauseMax - delays.pauseMin);
        updateStatus(`Pausa aleatória ⏸️ (${Math.round(pauseDuration / 1000)}s)`);
        await wait(pauseDuration);
      }

      // Esperar un poco antes de seguir
      const delays = getProtectionDelays();
      const actionDelay = delays.min + Math.random() * (delays.max - delays.min);
      await wait(actionDelay);

    } else {
      // Si no hay target visible, scroll con randomização
      const scrollAmount = 300 + Math.random() * 300;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      await wait(1000);
    }

  } catch (e) {
    console.error('Erro do Bot', e);
    updateStatus('Erro: ' + e.message);

    // Se houver erro repetido, entrar em cooldown
    if (e.message.includes('timeout') || e.message.includes('network')) {
      state.cooldownUntil = Date.now() + 60000; // 1 minuto de cooldown
      updateStatus('Erro de rede - cooldown de 1min');
    }
  }

  // Loop
  if (state.isRunning) {
    const delays = getProtectionDelays();
    const baseDelay = (state.config.interval * 1000) || delays.min;
    const randomDelay = Math.random() * 5000;
    timer = setTimeout(runTwitterLoop, baseDelay + randomDelay);
  }
}
