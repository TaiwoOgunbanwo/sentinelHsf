const SOURCE = 'deb-scanner';

const createApiClient = () => {
  const send = (payload) =>
    new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            source: SOURCE,
            ...payload
          },
          (response) => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || response.ok !== true) {
              reject(new Error(response?.error || 'Background request failed.'));
              return;
            }
            resolve(response.data ?? null);
          }
        );
      } catch (error) {
        reject(error);
      }
    });

  const proxy = (path, payload, options = {}) =>
    send({
      type: 'proxy-fetch',
      path,
      payload,
      context: options.context ?? 'scan'
    });

  return {
    send,
    proxy
  };
};

export { createApiClient };
