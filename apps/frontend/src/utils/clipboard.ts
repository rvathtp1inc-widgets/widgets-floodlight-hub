export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Plain HTTP and restrictive browser policies commonly reject this path.
    }
  }

  if (typeof document === 'undefined') return false;

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.readOnly = true;
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);

  let copied = false;
  try {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textArea.remove();
    activeElement?.focus();
    if (selection && ranges.length) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }

  return copied;
}

export async function copyTextOrThrow(value: string): Promise<void> {
  if (!(await copyText(value))) throw new Error('Unable to copy to clipboard.');
}
