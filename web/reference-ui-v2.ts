import { ReferenceAssistant as BaseReferenceAssistant } from "./reference-ui.js";

export class ReferenceAssistant extends BaseReferenceAssistant {
  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./reference-v3-worker.js", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "reference-status") {
        this.panel.hidden = false;
        this.statusEl.textContent = msg.detail || msg.stage;
        this.onStatus(msg.detail || msg.stage, Number(msg.progress || 0));
      } else if (msg.type === "reference-warning") {
        this.statusEl.textContent = msg.message || "Recognition warning";
      } else if (msg.type === "reference-result") {
        const pending = this.pending;
        this.pending = null;
        this.result = msg;
        this.selectedIndex = Number.isInteger(msg.selectedIndex) ? msg.selectedIndex : -1;
        this.lastSubject = msg.subject || "";
        this.render();
        this.persistSelected().catch((error) => console.warn("Could not persist reference", error));
        pending?.resolve(msg);
      } else if (msg.type === "reference-error") {
        const pending = this.pending;
        this.pending = null;
        const error = new Error(msg.message || "Reference analysis failed");
        this.showError(error);
        pending?.reject(error);
      }
    });
    this.worker.addEventListener("error", (event) => {
      const pending = this.pending;
      this.pending = null;
      const error = new Error(event.message || "Reference worker failed");
      this.showError(error);
      pending?.reject(error);
    });
    return this.worker;
  }

  render() {
    super.render();
    const selected = this.result?.candidates?.[this.selectedIndex];
    let line = this.panel.querySelector("[data-ref-alignment]");
    if (!line) {
      line = document.createElement("p");
      line.dataset.refAlignment = "";
      line.className = "reference-debug__guesses";
      this.sixWrap?.insertAdjacentElement("afterbegin", line);
    }
    const anchors = selected?.alignment?.anchors || [];
    if (!anchors.length) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    const mapping = anchors.map((item) => `${item.target}←${item.source} ${(Number(item.score || 0) * 100).toFixed(0)}%`).join(" · ");
    const margin = Number(selected.alignment?.margin || 0);
    line.textContent = `Fixed-centre alignment: ${mapping}${Number.isFinite(margin) ? ` · margin ${(margin * 100).toFixed(1)}%` : ""}`;
  }
}
