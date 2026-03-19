// Default system prompt (em português)
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

document.addEventListener('DOMContentLoaded', () => {
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const statusMessage = document.getElementById('statusMessage');

  // Inputs
  const hashtagInput = document.getElementById('hashtag');
  const intervalInput = document.getElementById('interval');
  const enableComments = document.getElementById('enableComments');
  const enableFollow = document.getElementById('enableFollow');
  const apiKeyInput = document.getElementById('apiKey');
  const customPromptInput = document.getElementById('customPrompt');
  const protectionLevelSelect = document.getElementById('protectionLevel');
  const protectionBadge = document.getElementById('protectionBadge');

  // Limites Diários
  const limitLikesInput = document.getElementById('limitLikes');
  const limitCommentsInput = document.getElementById('limitComments');
  const limitFollowsInput = document.getElementById('limitFollows');

  // Estatísticas
  const statLikes = document.getElementById('statLikes');
  const statComments = document.getElementById('statComments');
  const statFollows = document.getElementById('statFollows');

  // Botões auxiliares
  const btnResetPrompt = document.getElementById('btnResetPrompt');
  const btnClearPrompt = document.getElementById('btnClearPrompt');
  const btnResetStats = document.getElementById('btnResetStats');

  // Debounce para evitar múltiplos cliques
  let isProcessing = false;

  // Atualizar badge de proteção
  function updateProtectionBadge() {
    const level = protectionLevelSelect.value;
    protectionBadge.className = `protection-badge ${level}`;
    const labels = {
      basic: 'Básico',
      intermediate: 'Intermediário',
      advanced: 'Avançado'
    };
    protectionBadge.textContent = labels[level] || 'Básico';

    // Ajustar intervalo mínimo baseado no nível
    const minIntervals = { basic: 5, intermediate: 10, advanced: 15 };
    intervalInput.min = minIntervals[level];
    if (parseInt(intervalInput.value) < minIntervals[level]) {
      intervalInput.value = minIntervals[level];
    }
  }

  // Carregar configuração salva
  chrome.storage.local.get(
    ['xConfig', 'apiKey', 'isRunning', 'customPrompt', 'dailyLimits', 'sessionStats'],
    (result) => {
      if (result.apiKey) apiKeyInput.value = result.apiKey;

      if (result.xConfig) {
        hashtagInput.value = result.xConfig.hashtag || '';
        intervalInput.value = result.xConfig.interval || 10;
        enableComments.checked = result.xConfig.comments || false;
        enableFollow.checked = result.xConfig.follow || false;
        protectionLevelSelect.value = result.xConfig.protectionLevel || 'advanced';
        updateProtectionBadge();
      }

      if (result.customPrompt) {
        customPromptInput.value = result.customPrompt;
      }

      if (result.dailyLimits) {
        limitLikesInput.value = result.dailyLimits.likes || 50;
        limitCommentsInput.value = result.dailyLimits.comments || 20;
        limitFollowsInput.value = result.dailyLimits.follows || 15;
      }

      updateStatsDisplay(result.sessionStats || { likes: 0, comments: 0, follows: 0 });

      if (result.isRunning) {
        setRunningState(true);
      }
    }
  );

  // Atualizar display de estatísticas
  function updateStatsDisplay(stats) {
    statLikes.textContent = stats.likes || 0;
    statComments.textContent = stats.comments || 0;
    statFollows.textContent = stats.follows || 0;
  }

  // Salvar prompt customizado ao digitar
  let promptSaveTimeout;
  customPromptInput.addEventListener('input', () => {
    clearTimeout(promptSaveTimeout);
    promptSaveTimeout = setTimeout(() => {
      try {
        chrome.storage.local.set({ customPrompt: customPromptInput.value.trim() });
      } catch (e) {
        console.warn('Erro ao salvar prompt:', e);
      }
    }, 500);
  });

  // Salvar limites ao alterar
  function saveLimits() {
    try {
      const limits = {
        likes: Math.max(0, parseInt(limitLikesInput.value) || 0),
        comments: Math.max(0, parseInt(limitCommentsInput.value) || 0),
        follows: Math.max(0, parseInt(limitFollowsInput.value) || 0)
      };
      chrome.storage.local.set({ dailyLimits: limits });
    } catch (e) {
      console.warn('Erro ao salvar limites:', e);
    }
  }

  limitLikesInput.addEventListener('change', saveLimits);
  limitCommentsInput.addEventListener('change', saveLimits);
  limitFollowsInput.addEventListener('change', saveLimits);

  // Proteção level change
  protectionLevelSelect.addEventListener('change', updateProtectionBadge);

  // Botão resetar prompt
  btnResetPrompt.addEventListener('click', () => {
    customPromptInput.value = DEFAULT_SYSTEM_PROMPT;
    chrome.storage.local.set({ customPrompt: DEFAULT_SYSTEM_PROMPT });
    showStatus('Prompt restaurado com sucesso', false, 'success');
  });

  // Botão limpar prompt
  btnClearPrompt.addEventListener('click', () => {
    customPromptInput.value = '';
    chrome.storage.local.set({ customPrompt: '' });
    showStatus('Prompt limpo - usando padrão', false, 'success');
  });

  // Botão resetar estatísticas
  btnResetStats.addEventListener('click', () => {
    const emptyStats = { likes: 0, comments: 0, follows: 0 };
    chrome.storage.local.set({ sessionStats: emptyStats });
    updateStatsDisplay(emptyStats);
    showStatus('Estatísticas resetadas', false, 'success');
  });

  // Validar formato da API Key
  function isValidApiKey(key) {
    return key && key.trim().startsWith('sk-') && key.trim().length > 20;
  }

  // Validar limites diários
  function isValidLimits() {
    const likes = parseInt(limitLikesInput.value) || 0;
    const comments = parseInt(limitCommentsInput.value) || 0;
    const follows = parseInt(limitFollowsInput.value) || 0;
    return likes >= 0 && comments >= 0 && follows >= 0;
  }

  // Iniciar Bot
  btnStart.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const hashtag = hashtagInput.value.trim();
      const apiKey = apiKeyInput.value.trim();

      if (!hashtag) {
        showStatus('Digite uma hashtag por favor', true);
        return;
      }

      if (enableComments.checked && !isValidApiKey(apiKey)) {
        showStatus('API Key inválida. Deve começar com "sk-"', true);
        return;
      }

      if (!isValidLimits()) {
        showStatus('Os limites diários devem ser números positivos', true);
        return;
      }

      const intervalValue = parseInt(intervalInput.value) || 10;
      const level = protectionLevelSelect.value;
      const minIntervals = { basic: 5, intermediate: 10, advanced: 15 };

      if (intervalValue < minIntervals[level]) {
        showStatus(`Intervalo mínimo para ${level}: ${minIntervals[level]}s`, true);
        return;
      }

      // Resetar estatísticas se for um novo dia
      const today = new Date().toDateString();
      chrome.storage.local.get(['lastResetDate', 'sessionStats'], (result) => {
        if (result.lastResetDate !== today) {
          const emptyStats = { likes: 0, comments: 0, follows: 0 };
          chrome.storage.local.set({
            sessionStats: emptyStats,
            lastResetDate: today
          });
          updateStatsDisplay(emptyStats);
        }
      });

      // Guardar config
      const config = {
        hashtag,
        interval: intervalValue,
        comments: enableComments.checked,
        follow: enableFollow.checked,
        protectionLevel: level
      };

      await chrome.storage.local.set({
        xConfig: config,
        apiKey: apiKey,
        isRunning: true
      });

      setRunningState(true);

      // Navegar a X
      const searchUrl = `https://x.com/search?q=%23${encodeURIComponent(hashtag)}&src=typed_query`;

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          showStatus('Erro ao acessar abas. Tente novamente.', true);
          return;
        }

        const tab = tabs[0];
        if (tab.url && (tab.url.includes('x.com') || tab.url.includes('twitter.com'))) {
          chrome.tabs.update(tab.id, { url: searchUrl }, () => {
            if (chrome.runtime.lastError) {
              showStatus('Erro ao navegar para X.com', true);
            }
          });
        } else {
          chrome.tabs.create({ url: searchUrl }, () => {
            if (chrome.runtime.lastError) {
              showStatus('Erro ao abrir nova aba', true);
            }
          });
        }
      });

    } finally {
      setTimeout(() => { isProcessing = false; }, 500);
    }
  });

  // Detener Bot
  btnStop.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      await chrome.storage.local.set({ isRunning: false });
      setRunningState(false);
    } finally {
      setTimeout(() => { isProcessing = false; }, 300);
    }
  });

  // Escudar mudanças no storage para atualizar estatísticas em tempo real
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.sessionStats) {
      updateStatsDisplay(changes.sessionStats.newValue || { likes: 0, comments: 0, follows: 0 });
    }
  });

  function setRunningState(running) {
    if (running) {
      btnStart.disabled = true;
      btnStop.disabled = false;
      document.querySelector('.container').style.opacity = '0.9';
      showStatus('BOT ATIVO 🚀', false, 'success');
    } else {
      btnStart.disabled = false;
      btnStop.disabled = true;
      document.querySelector('.container').style.opacity = '1';
      showStatus('Parado');
    }
  }

  function showStatus(msg, error = false, type = '') {
    statusMessage.textContent = msg;
    statusMessage.className = 'status';
    if (error) {
      statusMessage.classList.add('error');
    } else if (type === 'success') {
      statusMessage.classList.add('success');
    } else {
      statusMessage.style.color = '#657786';
    }
  }
});
