const sensitivityInput = document.getElementById('sensitivity');
const statusElement = document.getElementById('status');
const saveButton = document.getElementById('save');
const styleInputs = Array.from(document.querySelectorAll('input[name="highlightStyle"]'));

async function saveOptions() {
  if (!sensitivityInput || !statusElement || styleInputs.length === 0) {
    return;
  }

  const value = parseFloat(sensitivityInput.value);
  const selectedStyle = styleInputs.find((input) => input.checked)?.value ?? 'highlight';

  await chrome.storage.sync.set({ sensitivity: value, highlightStyle: selectedStyle });

  statusElement.textContent = 'Options saved!';

  setTimeout(() => {
    statusElement.textContent = '';
  }, 1000);
}

async function restoreOptions() {
  if (!sensitivityInput || styleInputs.length === 0) {
    return;
  }

  const { sensitivity = 0.8, highlightStyle = 'highlight' } = await chrome.storage.sync.get([
    'sensitivity',
    'highlightStyle'
  ]);

  sensitivityInput.value = sensitivity;
  styleInputs.forEach((input) => {
    input.checked = input.value === highlightStyle;
  });
}

document.addEventListener('DOMContentLoaded', restoreOptions);

if (saveButton) {
  saveButton.addEventListener('click', saveOptions);
}
