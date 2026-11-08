import {mountAman} from './app.mjs';

// Native component: styles, IDs and local navigation are scoped to its shadow root.
class AmanMonitor extends HTMLElement {
  async connectedCallback() {
    const generation = this.generation = (this.generation || 0) + 1;
    const root = this.shadowRoot || this.attachShadow({mode: 'open'});
    this.controller = new AbortController();
    try {
      const response = await fetch(new URL('./template.html', import.meta.url), {
        signal: this.controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-cache',
      });
      if (!response.ok) throw new Error('Template unavailable');
      const markup = await response.text();
      if (!this.isConnected || this.generation !== generation) return;
      const template = document.createElement('template');
      template.innerHTML = markup;
      // Only bundled markup reaches this template. API records use textContent.
      template.content.querySelectorAll('[href^="./"],[href^="../"]').forEach(link => {
        link.href = new URL(link.getAttribute('href'), import.meta.url).href;
      });
      const style = document.createElement('link');
      style.rel = 'stylesheet'; style.href = new URL('./style.css', import.meta.url).href;
      root.replaceChildren(style, template.content.cloneNode(true));
      this.cleanup = mountAman(root);
    } catch (error) {
      if (!this.isConnected || error.name === 'AbortError') return;
      root.textContent = 'تعذّر تحميل لوحة أمان. أعد تحميل الصفحة للمحاولة مجددًا.';
    }
  }
  disconnectedCallback() {
    this.generation++;
    this.controller?.abort();
    this.cleanup?.(); this.cleanup = null;
    this.shadowRoot?.replaceChildren();
  }
}
if (!customElements.get('aman-monitor')) customElements.define('aman-monitor', AmanMonitor);
