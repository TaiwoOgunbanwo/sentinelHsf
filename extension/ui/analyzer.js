const createAnalyzer = ({ endpoints = [], inputEl, resultEl, status }) => {
  const analyze = async () => {
    if (!inputEl || !resultEl) {
      return;
    }

    const text = inputEl.value.trim();
    if (!text) {
      resultEl.textContent = 'Enter text to analyze.';
      return;
    }

    resultEl.textContent = 'Analyzing...';
    status.setAPIStatus('working', 'Analyzing…');
    status.setStatus('Analyzing…');

    let lastError;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        const score = typeof result.score === 'number' ? result.score.toFixed(4) : 'n/a';
        resultEl.textContent = result?.label ? `${result.label} (${score})` : 'No label returned.';
        status.setAPIStatus('ok', 'Analysis OK');
        status.setStatus('Analysis complete.', { clearAfter: 2000 });
        return;
      } catch (error) {
        lastError = error;
        console.warn('Manual analysis endpoint failed:', endpoint, error);
      }
    }

    console.error('Manual analysis failed:', lastError);
    resultEl.textContent =
      lastError && lastError.message && lastError.message.includes('ERR_CERT')
        ? 'Certificate not trusted. Open https://localhost:5000 once to proceed.'
        : 'Analysis failed. Check console.';
    status.setAPIStatus('error', 'Analysis failed');
    status.setStatus('Analysis failed. Check console.');
  };

  const attach = () => {
    if (!inputEl || !resultEl) {
      return;
    }
    const handler = async () => {
      await analyze();
    };
    return handler;
  };

  return {
    analyze,
    attach
  };
};

export { createAnalyzer };
