import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "PromptLora";
const LORA_REGEX = /<lora:([^:>]+)(?::([0-9.\-]+))?(?::([0-9.\-]+))?>/g;

function normalizeName(name) {
    return name.split(/[\\/]/).pop().replace(/\.safetensors$/i, "").trim().toLowerCase();
}

function makeElement(tag, styles = {}, text = "") {
    const element = document.createElement(tag);
    Object.assign(element.style, styles);
    if (text !== "") element.textContent = text;
    return element;
}

function parseSelectedFromPrompt(promptText) {
    const selected = [];
    let match;
    LORA_REGEX.lastIndex = 0;
    while ((match = LORA_REGEX.exec(promptText)) !== null) {
        const rawName = match[1].trim();
        const mw = match[2] ? Number(match[2]) : 1.0;
        selected.push({ rawName, weight: mw, matchStr: match[0] });
    }
    return selected;
}

async function fetchLoras() {
    const response = await api.fetchApi("/promptlora/loras");
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error);
    return payload.loras || [];
}

function syncNodeSize(node) {
    if (!node.size) return;
    const minSize = node.computeSize();
    if (Math.abs(node.size[1] - minSize[1]) > 2) {
        node.setSize([node.size[0], minSize[1]]);
        node.setDirtyCanvas?.(true, true);
    }
}

function updatePromptWidget(promptWidget, newText, newPos) {
    promptWidget.value = newText;
    if (promptWidget.inputEl) promptWidget.inputEl.value = newText;
    promptWidget.callback?.(newText);
    
    if (newPos !== undefined) {
        promptWidget._lastCursor = newPos;
        if (promptWidget.inputEl && document.activeElement === promptWidget.inputEl) {
            promptWidget.inputEl.setSelectionRange(newPos, newPos);
        }
    }
}

function applyWeightDelta(node, rawName, delta) {
    const promptWidget = node.widgets?.find((w) => w.name === "prompt");
    if (!promptWidget) return;

    const normTarget = normalizeName(rawName);
    let newText = promptWidget.value.replace(LORA_REGEX, (m, p1, p2) => {
        if (normalizeName(p1) === normTarget) {
            let w = p2 ? Number(p2) : 1.0;
            w = Math.round((w + delta) * 100) / 100;
            return `<lora:${p1}:${w}>`;
        }
        return m;
    });

    updatePromptWidget(promptWidget, newText);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    node._spl_refresh_manager?.();
    syncNodeSize(node);
}

function removeLoraFromPrompt(node, rawName) {
    const promptWidget = node.widgets?.find((w) => w.name === "prompt");
    if (!promptWidget) return;
    
    const normTarget = normalizeName(rawName);
    let currentPrompt = promptWidget.value || "";
    const loraData = node._spl_loras?.find(l => normalizeName(l.name) === normTarget);
    
    const cleanName = rawName.split(/[\\/]/).pop().replace(/\.safetensors$/i, "");
    const tags = loraData && loraData.tags ? loraData.tags.replace(/[\[\]]/g, '').replace(/[,\s]+$/, '').trim() : "";
    
    let regexStr = `<lora:${cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}(?::[^>]+)?>`;
    if (tags) {
        const tagsEscaped = tags.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
        regexStr += `(?:\\s*,\\s*${tagsEscaped})?`;
    }
    
    const fullRegex = new RegExp(`(?:\\s*,\\s*)?${regexStr}(?:\\s*,\\s*)?`, 'gi');
    let newPrompt = currentPrompt.replace(fullRegex, ' ');
    
    newPrompt = newPrompt.replace(/\s{2,}/g, ' ').trim();
    newPrompt = newPrompt.replace(/^\s*,\s*|\s*,\s*$/g, '');
    newPrompt = newPrompt.replace(/,\s*,/g, ',');
    
    updatePromptWidget(promptWidget, newPrompt);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    
    node._spl_refresh_manager?.();
    syncNodeSize(node);
}

function changeLoraWeight(node, rawName, currentWeight, mouseX, mouseY) {
    const existing = document.getElementById("spl-weight-input");
    if (existing) existing.remove();

    const promptWidget = node.widgets?.find((w) => w.name === "prompt");
    if (!promptWidget) return;

    const div = document.createElement("div");
    div.id = "spl-weight-input";
    div.style.position = "fixed";
    div.style.left = `${mouseX - 30}px`;
    div.style.top = `${mouseY - 15}px`;
    div.style.zIndex = "100005";
    div.style.background = "#1e1e1e";
    div.style.border = "1px solid #555";
    div.style.borderRadius = "4px";
    div.style.padding = "2px";
    div.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";

    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.05";
    input.value = currentWeight;
    input.style.width = "60px";
    input.style.background = "#111";
    input.style.color = "#fff";
    input.style.border = "none";
    input.style.outline = "none";
    input.style.padding = "4px";
    input.style.textAlign = "center";
    input.style.fontSize = "12px";

    const apply = () => {
        const val = Number(input.value);
        if (Number.isFinite(val)) {
            const normTarget = normalizeName(rawName);
            let newText = promptWidget.value.replace(LORA_REGEX, (m, p1) => {
                if (normalizeName(p1) === normTarget) return `<lora:${p1}:${val}>`;
                return m;
            });
            updatePromptWidget(promptWidget, newText);
            node.setDirtyCanvas?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true);
            node._spl_refresh_manager?.();
            syncNodeSize(node);
        }
        div.remove();
    };

    input.onkeydown = (e) => {
        if (e.key === "Enter") apply();
        if (e.key === "Escape") div.remove();
    };
    
    let isFocused = false;
    input.onfocus = () => { isFocused = true; };
    input.onblur = () => { if (isFocused) setTimeout(apply, 150); };

    div.appendChild(input);
    document.body.appendChild(div);
    setTimeout(() => { input.focus(); input.select(); }, 50);
}

function openInfoModal(lora, node, onSaveCb) {
    document.getElementById("spl-info-modal")?.remove();

    const meta = lora.raw_meta || {};

    let tagList = [];
    if (meta.ss_tag_frequency) {
        try {
            let freqObj = meta.ss_tag_frequency;
            if (typeof freqObj === "string") freqObj = JSON.parse(freqObj);
            
            let allTags = {};
            for (const dataset in freqObj) {
                for (const [tag, count] of Object.entries(freqObj[dataset])) {
                    if (tag !== "[EOS]" && tag !== "[BOS]") {
                        allTags[tag] = (allTags[tag] || 0) + count;
                    }
                }
            }
            tagList = Object.entries(allTags).map(([tag, count]) => ({ tag, count }));
            tagList.sort((a, b) => b.count - a.count);
        } catch (e) { console.error("Failed to parse tags", e); }
    }

    const overlay = makeElement("div", {
        position: "fixed", inset: "0", zIndex: "100010",
        background: "rgba(0,0,0,0.7)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "20px"
    });
    overlay.id = "spl-info-modal";

    const panel = makeElement("div", {
        background: "#222", border: "1px solid #555", borderRadius: "8px",
        width: "850px", maxWidth: "95vw", maxHeight: "90vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 10px 30px rgba(0,0,0,0.8)", color: "#ddd",
        fontFamily: "Arial, sans-serif"
    });

    const header = makeElement("div", { padding: "15px", borderBottom: "1px solid #444", display: "flex", justifyContent: "space-between", alignItems: "center" });
    header.appendChild(makeElement("h2", { margin: "0", fontSize: "18px", color: "#fff" }, lora.title || lora.name));
    const closeBtn = makeElement("button", { background: "none", border: "none", color: "#f66", fontSize: "20px", cursor: "pointer" }, "✕");
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const content = makeElement("div", { padding: "15px", display: "flex", gap: "20px", overflowY: "auto", flexWrap: "wrap" });

    const infoDiv = makeElement("div", { flex: "1", minWidth: "300px", display: "flex", flexDirection: "column", gap: "15px" });
    
    const table = makeElement("table", { width: "100%", borderCollapse: "collapse", fontSize: "12px" });
    const addRow = (key, val) => {
        if (!val) return;
        const tr = makeElement("tr");
        tr.appendChild(makeElement("td", { padding: "6px", borderBottom: "1px solid #444", color: "#aaa", width: "40%" }, key));
        tr.appendChild(makeElement("td", { padding: "6px", borderBottom: "1px solid #444", color: "#fff", wordBreak: "break-all" }, val));
        table.appendChild(tr);
    };
    addRow("Filename", lora.name);
    addRow("File size", `${lora.file_size} MB`);
    addRow("Model", meta["ss_sd_model_name"] || meta["civitai_base_model"]);
    addRow("Date trained", meta["ss_training_date"] || meta["ss_training_finished_at"]);
    addRow("Dataset size", meta["ss_num_train_images"]);
    infoDiv.appendChild(table);

    if (meta["civitai_description"]) {
        const descBox = makeElement("div", { fontSize: "12px", color: "#ccc", background: "#1a1a1a", padding: "10px", borderRadius: "4px", maxHeight: "120px", overflowY: "auto", border: "1px solid #333" });
        // Render third-party metadata as text, never as executable HTML.
        descBox.textContent = String(meta["civitai_description"]).replace(/<[^>]*>/g, " ").trim();
        infoDiv.appendChild(makeElement("div", { fontSize: "13px", fontWeight: "bold", color: "#ccc", marginBottom: "4px" }, "Description"));
        infoDiv.appendChild(descBox);
    }

    const previewDiv = makeElement("div", { width: "240px", height: "320px", background: "#111", borderRadius: "6px", overflow: "hidden", flexShrink: 0 });
    if (lora.preview_url) {
        const img = makeElement("img", { width: "100%", height: "100%", objectFit: "cover" });
        img.src = lora.preview_url;
        previewDiv.appendChild(img);
    } else {
        previewDiv.appendChild(makeElement("div", { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }, "No Image"));
    }
    
    content.appendChild(infoDiv);
    content.appendChild(previewDiv);
    panel.appendChild(content);

    const form = makeElement("div", { padding: "0 15px 15px 15px", display: "flex", flexDirection: "column", gap: "10px" });
    
    const createField = (label, id, val, isTextarea = false) => {
        const wrap = makeElement("div", { display: "flex", flexDirection: "column", gap: "4px" });
        wrap.appendChild(makeElement("label", { fontSize: "12px", color: "#aaa" }, label));
        
        let el;
        if (isTextarea) {
            el = makeElement("textarea", { padding: "8px", background: "#111", border: "1px solid #444", borderRadius: "4px", color: "#fff", fontSize: "13px", minHeight: "60px", resize: "vertical" });
            el.value = val || "";
        } else {
            el = makeElement("input", { padding: "8px", background: "#111", border: "1px solid #444", borderRadius: "4px", color: "#fff", fontSize: "13px" });
            el.value = val || "";
        }
        el.id = id;
        wrap.appendChild(el);
        form.appendChild(wrap);
        return el;
    };

    let defaultActivation = meta["activation text"] || meta["triggers"] || "";
    if (!defaultActivation && meta["civitai_trained_words"]) {
        defaultActivation = Array.isArray(meta["civitai_trained_words"]) ? meta["civitai_trained_words"].join(", ") : meta["civitai_trained_words"];
    }

    const actTextInput = createField("Activation Text", "spl-act-text", defaultActivation);
    createField("Preferred Weight", "spl-pref-weight", meta["preferred weight"] || "0");
    createField("Negative Prompt", "spl-neg-text", meta["negative text"] || "", true);
    createField("Notes", "spl-notes", meta["notes"] || "", true);

    if (tagList.length > 0) {
        const tagSection = makeElement("div", { display: "flex", flexDirection: "column", gap: "8px", order: "-1" });
        tagSection.appendChild(makeElement("div", { fontSize: "13px", fontWeight: "bold", color: "#ccc" }, "Training Dataset Tags"));
        
        const tagCloud = makeElement("div", { display: "flex", flexWrap: "wrap", gap: "4px", maxHeight: "160px", overflowY: "auto", paddingRight: "5px" });
        const tagElements = [];

        const updateTagStyles = () => {
            const currentText = actTextInput.value.toLowerCase();
            const currentTags = currentText.split(',').map(t => t.trim());
            
            tagElements.forEach(el => {
                const tagName = el.dataset.tag.toLowerCase();
                if (currentTags.includes(tagName)) {
                    el.style.outline = "2px solid #fff";
                    el.style.boxShadow = "0 0 5px rgba(255,255,255,0.5)";
                    el.style.opacity = "1";
                } else {
                    el.style.outline = "1px solid rgba(255,255,255,0.2)";
                    el.style.boxShadow = "none";
                    el.style.opacity = "0.8";
                }
            });
        };

        actTextInput.addEventListener("input", updateTagStyles);

        const maxTags = Math.min(tagList.length, 40);
        
        for (let i = 0; i < maxTags; i++) {
            const item = tagList[i];
            const hue = Math.max(0, 280 - (i * 7));
            const bgColor = `hsl(${hue}, 65%, 45%)`;
            
            const tagEl = makeElement("span", {
                background: bgColor, color: "#fff", padding: "2px 6px",
                borderRadius: "4px", fontSize: "11px", border: "1px solid transparent",
                display: "inline-flex", alignItems: "center", gap: "4px",
                cursor: "pointer", userSelect: "none", transition: "outline 0.1s, opacity 0.1s"
            });
            tagEl.appendChild(document.createTextNode(String(item.tag)));
            tagEl.appendChild(makeElement("b", { fontSize: "10px", opacity: "0.8" }, String(item.count)));
            tagEl.dataset.tag = item.tag;
            tagEl.title = "Click to add/remove from Activation Text";

            tagEl.onclick = () => {
                let text = actTextInput.value;
                let parts = text.split(',').map(t => t.trim()).filter(t => t !== "");
                const tagLower = item.tag.toLowerCase();
                const index = parts.findIndex(p => p.toLowerCase() === tagLower);

                if (index !== -1) {
                    parts.splice(index, 1);
                } else {
                    parts.push(item.tag);
                }

                actTextInput.value = parts.join(', ');
                updateTagStyles();
            };

            tagElements.push(tagEl);
            tagCloud.appendChild(tagEl);
        }
        
        tagSection.appendChild(tagCloud);
        infoDiv.appendChild(tagSection);
        setTimeout(updateTagStyles, 10);
    }

    if (tagList.length > 0) {
        const randWrap = makeElement("div", { display: "flex", flexDirection: "column", gap: "4px", marginTop: "5px" });
        randWrap.appendChild(makeElement("label", { fontSize: "12px", color: "#aaa" }, "Random Prompt"));
        
        const row = makeElement("div", { display: "flex", gap: "10px" });
        const randInput = makeElement("textarea", { flex: "1", padding: "8px", background: "#111", border: "1px solid #444", borderRadius: "4px", color: "#fff", fontSize: "13px", minHeight: "60px", resize: "vertical" });
        const genBtn = makeElement("button", { padding: "0 15px", background: "#555", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }, "Generate");
        
        genBtn.onclick = () => {
            const shuffled = [...tagList].sort(() => 0.5 - Math.random());
            const count = Math.floor(Math.random() * 5) + 15;
            const selected = shuffled.slice(0, count).map(t => t.tag);
            randInput.value = selected.join(", ");
        };

        row.appendChild(randInput);
        row.appendChild(genBtn);
        randWrap.appendChild(row);
        form.appendChild(randWrap);
    }

    panel.appendChild(form);

    const footer = makeElement("div", { padding: "15px", borderTop: "1px solid #444", display: "flex", justifyContent: "flex-end", gap: "10px", background: "#2a2a2a" });
    const saveBtn = makeElement("button", { padding: "8px 20px", background: "#4caf50", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }, "Save");
    
    saveBtn.onclick = async () => {
        saveBtn.textContent = "Saving...";
        const payload = {
            name: lora.name,
            activation_text: actTextInput.value,
            preferred_weight: document.getElementById("spl-pref-weight").value,
            negative_text: document.getElementById("spl-neg-text").value,
            notes: document.getElementById("spl-notes").value,
        };
        
        try {
            const res = await api.fetchApi("/promptlora/save_metadata", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error("Failed to save");
            
            lora.raw_meta["activation text"] = payload.activation_text;
            lora.raw_meta["preferred weight"] = payload.preferred_weight;
            lora.raw_meta["negative text"] = payload.negative_text;
            lora.raw_meta["notes"] = payload.notes;
            
            lora.tags = payload.activation_text || lora.tags;
            
            overlay.remove();
            if (onSaveCb) onSaveCb();
        } catch (e) {
            alert("Save error: " + e.message);
            saveBtn.textContent = "Save";
        }
    };

    const cancelBtn = makeElement("button", { padding: "8px 20px", background: "#444", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }, "Cancel");
    cancelBtn.onclick = () => overlay.remove();

    footer.append(cancelBtn, saveBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
}

function openManager(node) {
    document.getElementById("spl-manager-panel")?.remove();

    const promptWidget = node.widgets?.find((w) => w.name === "prompt");
    if (!promptWidget) return;

    let activeCategory = localStorage.getItem("spl_active_category") || "Favorites";
    let favorites = JSON.parse(localStorage.getItem("spl_favorites") || "[]");
    let cardSize = localStorage.getItem("spl_card_size") || "M";

    const panel = makeElement("div", {
        position: "fixed", top: "100px", left: "100px", zIndex: "100000",
        width: "1000px", height: "700px", maxWidth: "95vw", maxHeight: "90vh",
        background: "#2b2b2b", color: "#eee", border: "1px solid #444",
        borderRadius: "8px", boxShadow: "0 12px 50px rgba(0,0,0,0.8)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        fontFamily: "Arial, sans-serif", resize: "both"
    });
    panel.id = "spl-manager-panel";

    const header = makeElement("div", {
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 15px", borderBottom: "1px solid #444",
        flexWrap: "wrap", cursor: "grab", background: "#333",
    });
    // Keep the manager name distinct from the node type for existing workflows.
    const heading = makeElement("strong", { fontSize: "16px", marginRight: "auto", pointerEvents: "none", color: "#ddd" }, "PromptLora Manager");

    const search = makeElement("input", { width: "200px", padding: "6px 10px", color: "#eee", background: "#222", border: "1px solid #555", borderRadius: "4px", fontSize: "13px" });
    search.placeholder = "Search...";

    const everywhereLabel = makeElement("label", { display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", cursor: "pointer", color: "#aaa" });
    const everywhereCb = document.createElement("input"); everywhereCb.type = "checkbox";
    everywhereLabel.append(everywhereCb, document.createTextNode("everywhere"));

    const refreshBtn = makeElement("button", { padding: "6px 10px", color: "#ccc", background: "#444", border: "0", borderRadius: "4px", cursor: "pointer" }, "⟳");
    
    const sizeGroup = makeElement("div", { display: "flex", gap: "2px" });
    const btnList = makeElement("button", { padding: "6px 10px", color: "#ccc", background: cardSize === "List" ? "#555" : "#333", border: "1px solid #555", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }, "≡");
    const btnS = makeElement("button", { padding: "6px 10px", color: "#ccc", background: cardSize === "S" ? "#555" : "#333", border: "1px solid #555", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }, "S");
    const btnM = makeElement("button", { padding: "6px 10px", color: "#ccc", background: cardSize === "M" ? "#555" : "#333", border: "1px solid #555", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }, "M");
    const btnL = makeElement("button", { padding: "6px 10px", color: "#ccc", background: cardSize === "L" ? "#555" : "#333", border: "1px solid #555", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }, "L");
    
    btnList.onclick = () => { cardSize = "List"; localStorage.setItem("spl_card_size", cardSize); updateSizeButtons(); render(); };
    btnS.onclick = () => { cardSize = "S"; localStorage.setItem("spl_card_size", cardSize); updateSizeButtons(); render(); };
    btnM.onclick = () => { cardSize = "M"; localStorage.setItem("spl_card_size", cardSize); updateSizeButtons(); render(); };
    btnL.onclick = () => { cardSize = "L"; localStorage.setItem("spl_card_size", cardSize); updateSizeButtons(); render(); };
    
    function updateSizeButtons() {
        btnList.style.background = cardSize === "List" ? "#555" : "#333";
        btnS.style.background = cardSize === "S" ? "#555" : "#333";
        btnM.style.background = cardSize === "M" ? "#555" : "#333";
        btnL.style.background = cardSize === "L" ? "#555" : "#333";
    }
    
    sizeGroup.append(btnList, btnS, btnM, btnL);

    const close = makeElement("button", { padding: "6px 12px", color: "white", background: "#a33", border: "0", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", marginLeft: "10px" }, "✕");

    header.append(heading, search, everywhereLabel, refreshBtn, sizeGroup, close);
    panel.appendChild(header);

    const body = makeElement("div", { display: "flex", flex: "1", overflow: "hidden" });
    const sidebar = makeElement("div", { width: "200px", background: "#222", borderRight: "1px solid #444", overflowY: "auto", display: "flex", flexDirection: "column", padding: "10px 0" });
    const rightPanel = makeElement("div", { flex: "1", display: "flex", flexDirection: "column", overflow: "hidden" });
    const status = makeElement("div", { padding: "10px 15px", color: "#aaa", fontSize: "12px", borderBottom: "1px solid #444" }, "Loading...");
    rightPanel.appendChild(status);

    const grid = makeElement("div", { padding: "15px", display: "grid", overflowY: "auto", alignContent: "start", flex: "1", alignItems: "start", gridAutoRows: "max-content" });
    rightPanel.appendChild(grid);

    body.append(sidebar, rightPanel);
    panel.appendChild(body);

    let isDragging = false; let startX, startY, startLeft, startTop;
    header.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "BUTTON") return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        const rect = panel.getBoundingClientRect(); startLeft = rect.left; startTop = rect.top;
        header.style.cursor = "grabbing"; document.body.style.userSelect = "none";
    });
    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        panel.style.left = `${startLeft + e.clientX - startX}px`;
        panel.style.top = `${startTop + e.clientY - startY}px`;
    });
    window.addEventListener("mouseup", () => { if (isDragging) { isDragging = false; header.style.cursor = "grab"; document.body.style.userSelect = ""; } });

    let loras = []; let loading = false;

    function getInsertPos() {
        if (promptWidget.inputEl && promptWidget.inputEl === document.activeElement) return promptWidget.inputEl.selectionStart;
        return promptWidget._lastCursor !== undefined ? promptWidget._lastCursor : promptWidget.value.length;
    }

    function toggleLora(loraName, weightInput) {
        const currentPrompt = promptWidget.value || "";
        const normTarget = normalizeName(loraName);
        const loraData = loras.find(l => l.name === loraName);
        
        let found = false;
        let match;
        const checkRegex = new RegExp(`<lora:([^:>]+)(?::[0-9.\\-]+)?(?::[0-9.\\-]+)?>`, 'g');
        while ((match = checkRegex.exec(currentPrompt)) !== null) { if (normalizeName(match[1]) === normTarget) { found = true; break; } }
        
        if (found) {
            removeLoraFromPrompt(node, loraName);
        } else {
            const weight = Number(weightInput ? weightInput.value : 1.0) || 1.0;
            const cleanName = loraName.split(/[\\/]/).pop().replace(/\.safetensors$/i, "");
            let tagStr = `<lora:${cleanName}:${weight}>`;
            
            if (loraData && loraData.tags) {
                let cleanTags = loraData.tags.replace(/[\[\]]/g, '').replace(/[,\s]+$/, '').trim();
                if (cleanTags) tagStr += `, ${cleanTags}`;
            }

            const insertPos = getInsertPos();
            const before = currentPrompt.slice(0, insertPos);
            const after = currentPrompt.slice(insertPos);
            
            const beforeClean = before.replace(/[,\s]+$/, '');
            const afterClean = after.replace(/^[,\s]+/, '');
            
            let result = beforeClean;
            if (result.length > 0) result += ", ";
            result += tagStr;
            const nextPos = result.length; 
            if (afterClean.length > 0) result += ", " + afterClean;
            
            updatePromptWidget(promptWidget, result, nextPos);
            node.setDirtyCanvas?.(true, true);
            app.graph?.setDirtyCanvas?.(true, true); 
            syncNodeSize(node);
            render(); 
        }
    }

    function renderSidebar() {
        sidebar.replaceChildren();
        
        const favBtn = makeElement("div", { 
            padding: "8px 15px", cursor: "pointer", fontSize: "13px", 
            color: activeCategory === "Favorites" ? "#fff" : "#aaa",
            background: activeCategory === "Favorites" ? "#444" : "transparent",
            textAlign: "left"
        }, "★ Favorites");
        favBtn.onclick = () => { activeCategory = "Favorites"; localStorage.setItem("spl_active_category", activeCategory); renderSidebar(); render(); };
        sidebar.appendChild(favBtn);

        const cats = [...new Set(loras.map(l => l.category).filter(Boolean))].sort();
        for (const cat of cats) {
            const btn = makeElement("div", { 
                padding: "8px 15px", cursor: "pointer", fontSize: "13px", 
                color: activeCategory === cat ? "#fff" : "#aaa",
                background: activeCategory === cat ? "#444" : "transparent", 
                wordBreak: "break-all", textAlign: "left"
            }, cat.replace(/\//g, "/"));
            btn.onclick = () => { activeCategory = cat; localStorage.setItem("spl_active_category", activeCategory); renderSidebar(); render(); };
            sidebar.appendChild(btn);
        }
    }

    function sortItems(items) {
        const list = [...items];
        list.sort((a, b) => a.title.localeCompare(b.title));
        return list;
    }

    function render() {
        grid.replaceChildren();
        const query = search.value.trim().toLowerCase();
        const isEverywhere = everywhereCb.checked;
        
        const selectedNow = parseSelectedFromPrompt(promptWidget.value || "");

        if (cardSize === "List") {
            grid.style.gridTemplateColumns = "1fr";
            grid.style.gap = "0";
        } else if (cardSize === "S") {
            grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(130px, 160px))";
            grid.style.gap = "10px";
        } else if (cardSize === "L") {
            grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(240px, 300px))";
            grid.style.gap = "16px";
        } else {
            grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 220px))";
            grid.style.gap = "12px";
        }

        let visible = loras.filter((lora) => {
            const isFav = favorites.includes(lora.name);
            if (!isEverywhere) {
                if (activeCategory === "Favorites") { if (!isFav) return false; }
                else if (activeCategory !== "All" && lora.category !== activeCategory) return false;
            }
            return !query || `${lora.name} ${lora.tags || ""}`.toLowerCase().includes(query);
        });
        visible = sortItems(visible);

        status.textContent = `${visible.length} of ${loras.length} LoRAs.`;

        if (!visible.length) { 
            grid.appendChild(makeElement("div", { color: "#aaa", padding: "20px" }, "No LoRAs found.")); 
            return; 
        }

        for (const lora of visible) {
            const normName = normalizeName(lora.name);
            const current = selectedNow.find(s => normalizeName(s.rawName) === normName);
            const isFav = favorites.includes(lora.name);

            let prefWeight = 1.0;
            if (lora.raw_meta && lora.raw_meta["preferred weight"] !== undefined) {
                const pw = parseFloat(lora.raw_meta["preferred weight"]);
                if (!isNaN(pw) && pw > 0) prefWeight = pw;
            }

            if (cardSize === "List") {
                const row = makeElement("div", {
                    display: "flex", alignItems: "center", padding: "6px 12px",
                    borderBottom: "1px solid #333", cursor: "pointer",
                    background: current ? "#2c3a31" : "transparent",
                    transition: "background 0.1s", flexShrink: 0
                });
                row.onmouseenter = () => { if (!current) row.style.background = "#3a3a3a"; };
                row.onmouseleave = () => { if (!current) row.style.background = "transparent"; };

                const title = makeElement("div", { flex: "1", fontSize: "13px", color: current ? "#dfe" : "#ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, lora.title || lora.name);
                
                const infoBtn = makeElement("div", { cursor: "pointer", color: "#8af", marginRight: "15px", flexShrink: 0, fontSize: "14px" }, "⚙");
                infoBtn.onclick = (e) => { e.stopPropagation(); openInfoModal(lora, node, () => render()); };

                const weight = makeElement("input", { width: "50px", marginRight: "15px", padding: "2px 4px", color: "#eee", background: "#111", border: "1px solid #555", borderRadius: "3px", textAlign: "center" });
                weight.type = "number"; weight.step = "0.05"; weight.min = "-2"; weight.max = "2";
                
                weight.value = current ? current.weight : prefWeight;
                
                weight.onclick = (e) => e.stopPropagation();
                weight.onchange = (e) => {
                    if (current) {
                        const val = Number(weight.value);
                        if (Number.isFinite(val)) {
                            const normTarget = normalizeName(lora.name);
                            let newText = promptWidget.value.replace(LORA_REGEX, (m, p1) => {
                                if (normalizeName(p1) === normTarget) return `<lora:${p1}:${val}>`;
                                return m;
                            });
                            updatePromptWidget(promptWidget, newText);
                            node.setDirtyCanvas?.(true, true);
                            app.graph?.setDirtyCanvas?.(true, true);
                            node._spl_refresh_manager?.();
                            syncNodeSize(node);
                        }
                    }
                };

                const star = makeElement("div", { color: isFav ? "#ffd700" : "#666", cursor: "pointer", fontSize: "16px", width: "20px", textAlign: "center", flexShrink: 0 }, isFav ? "★" : "☆");
                star.onclick = (e) => {
                    e.stopPropagation();
                    if (isFav) favorites = favorites.filter(f => f !== lora.name);
                    else favorites.push(lora.name);
                    localStorage.setItem("spl_favorites", JSON.stringify(favorites));
                    render();
                };

                row.append(title, infoBtn, weight, star);
                row.onclick = () => toggleLora(lora.name, weight);
                grid.appendChild(row);
                continue;
            }

            const card = makeElement("div", {
                background: current ? "#303b35" : "#2a2e35",
                border: `1px solid ${current ? "#4c9868" : "#444"}`,
                borderRadius: "6px", padding: "0", display: "flex",
                flexDirection: "column", minWidth: "0", cursor: "pointer",
                transition: "border-color 0.2s", position: "relative",
                height: "fit-content", overflow: "hidden"
            });
            
            card.onmouseenter = () => { if (!current) card.style.borderColor = "#888"; };
            card.onmouseleave = () => { if (!current) card.style.borderColor = "#444"; };

            const imgWrapper = makeElement("div", {
                width: "100%", aspectRatio: "1 / 1", background: "#17191d",
                position: "relative", flexShrink: 0
            });

            if (lora.preview_url) {
                const image = makeElement("img", { 
                    width: "100%", height: "100%", objectFit: "cover",
                    position: "absolute", top: "0", left: "0"
                });
                image.src = lora.preview_url; image.loading = "lazy"; image.onerror = () => image.remove();
                imgWrapper.appendChild(image);
            } else {
                imgWrapper.appendChild(makeElement("div", { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#737982", fontSize: "12px" }, "No preview"));
            }

            const star = makeElement("div", {
                position: "absolute", top: "6px", right: "6px", cursor: "pointer",
                color: isFav ? "#ffd700" : "#ccc", fontSize: "16px", background: "rgba(0,0,0,0.6)",
                borderRadius: "50%", width: "24px", height: "24px", display: "flex",
                justifyContent: "center", alignItems: "center", zIndex: "10"
            }, isFav ? "★" : "☆");
            star.onclick = (e) => {
                e.stopPropagation();
                if (isFav) favorites = favorites.filter(f => f !== lora.name);
                else favorites.push(lora.name);
                localStorage.setItem("spl_favorites", JSON.stringify(favorites));
                render();
            };
            imgWrapper.appendChild(star);

            const infoIcon = makeElement("div", {
                position: "absolute", top: "6px", left: "6px", cursor: "pointer",
                color: "#ccc", fontSize: "14px", background: "rgba(0,0,0,0.6)",
                borderRadius: "50%", width: "24px", height: "24px", display: "flex",
                justifyContent: "center", alignItems: "center", zIndex: "10"
            }, "⚙");
            infoIcon.onclick = (e) => { e.stopPropagation(); openInfoModal(lora, node, () => render()); };
            imgWrapper.appendChild(infoIcon);

            card.appendChild(imgWrapper);

            const infoBox = makeElement("div", { padding: "8px", display: "flex", flexDirection: "column", gap: "4px", background: "rgba(0,0,0,0.4)", flex: "1" });
            
            const titleEl = makeElement("div", { fontSize: "12px", fontWeight: "bold", overflowWrap: "anywhere", lineHeight: "1.2" }, lora.title || lora.name);
            infoBox.appendChild(titleEl);

            if (lora.category) {
                infoBox.appendChild(makeElement("div", { fontSize: "10px", color: "#8aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, `📁 ${lora.category}`));
            }

            const weightRow = makeElement("div", { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", color: "#bbb", marginTop: "4px" }, "Weight");
            const weight = makeElement("input", { width: "50px", padding: "2px 4px", color: "#eee", background: "#111", border: "1px solid #555", borderRadius: "3px", textAlign: "center" });
            weight.type = "number"; weight.step = "0.05"; weight.min = "-2"; weight.max = "2";
            
            weight.value = current ? current.weight : prefWeight;
            
            weight.onclick = (e) => e.stopPropagation();
            weight.onchange = (e) => {
                if (current) {
                    const val = Number(weight.value);
                    if (Number.isFinite(val)) {
                        const normTarget = normalizeName(lora.name);
                        let newText = promptWidget.value.replace(LORA_REGEX, (m, p1) => {
                            if (normalizeName(p1) === normTarget) return `<lora:${p1}:${val}>`;
                            return m;
                        });
                        updatePromptWidget(promptWidget, newText);
                        node.setDirtyCanvas?.(true, true);
                        app.graph?.setDirtyCanvas?.(true, true);
                        node._spl_refresh_manager?.();
                        syncNodeSize(node);
                    }
                }
            };
            weightRow.appendChild(weight);
            infoBox.appendChild(weightRow);

            card.appendChild(infoBox);
            card.onclick = () => toggleLora(lora.name, weight);
            grid.appendChild(card);
        }
    }

    async function loadLoras() {
        if (loading) return; loading = true; status.style.color = "#aaa"; status.textContent = "Loading...";
        try {
            loras = await fetchLoras(); 
            node._spl_loras = loras;
            renderSidebar(); 
            render();
        } catch (error) {
            status.textContent = `Error: ${error.message}`; status.style.color = "#ff8888";
        } finally { loading = false; }
    }

    node._spl_refresh_manager = () => { render(); };

    close.onclick = () => { panel.remove(); node._spl_refresh_manager = null; };
    search.addEventListener("input", render);
    everywhereCb.addEventListener("change", render);
    refreshBtn.addEventListener("click", loadLoras);

    document.body.appendChild(panel);
    loadLoras();
}

app.registerExtension({
    name: "PromptLora",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);

            const stackWidget = this.widgets?.find((widget) => widget.name === "lora_stack");
            if (stackWidget) { stackWidget.type = "hidden"; stackWidget.hidden = true; stackWidget.computeSize = () => [0, -4]; }
            const appendWidget = this.widgets?.find((widget) => widget.name === "append_trigger_words");
            if (appendWidget) { appendWidget.type = "hidden"; appendWidget.hidden = true; appendWidget.computeSize = () => [0, -4]; }

            const promptWidget = this.widgets?.find(w => w.name === "prompt");
            if (promptWidget) {
                const trackCursor = () => {
                    if (promptWidget.inputEl) promptWidget._lastCursor = promptWidget.inputEl.selectionStart;
                };
                const attachEvents = () => {
                    if (promptWidget.inputEl && !promptWidget.inputEl._spl_attached) {
                        promptWidget.inputEl.addEventListener("mouseup", trackCursor);
                        promptWidget.inputEl.addEventListener("keyup", trackCursor);
                        promptWidget.inputEl.addEventListener("blur", trackCursor);
                        promptWidget.inputEl._spl_attached = true; trackCursor();
                    }
                };
                attachEvents();
                const origDraw = this.onDrawForeground;
                this.onDrawForeground = function() { attachEvents(); if (origDraw) origDraw.apply(this, arguments); };
                
                const origPromptCallback = promptWidget.callback;
                promptWidget.callback = function() {
                    if (origPromptCallback) origPromptCallback.apply(this, arguments);
                    syncNodeSize(this);
                };
            }

            this.addWidget("button", "Open LoRA Manager", null, () => openManager(this));
            
            const btnIndex = this.widgets.findIndex(w => w.type === "button");
            
            const dummy = {
                name: "spl_custom_list",
                type: "custom",
                value: "",
                last_y: 0,
                options: { serialize: false },
                computeSize: function(width) {
                    const pW = this.node?.widgets?.find(w => w.name === "prompt");
                    if (!pW) return [width, 0];
                    const selected = parseSelectedFromPrompt(pW.value || "");
                    const rows = Math.max(1, selected.length);
                    return [width, (rows * 28) + 10]; 
                },
                draw: function(ctx, node, width, posY, height) {
                    try {
                        const pW = node.widgets.find(w => w.name === "prompt");
                        if (!pW) return;
                        const selected = parseSelectedFromPrompt(pW.value || "");
                        
                        const panelX = 10; 
                        const panelW = width - 20;
                        const startY = posY + 5; 

                        node._loraChipZones = [];

                        if (selected.length === 0) {
                            ctx.save();
                            ctx.fillStyle = "#2a2e35";
                            ctx.strokeStyle = "#444";
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(panelX, startY, panelW, 24, 4);
                            else ctx.rect(panelX, startY, panelW, 24);
                            ctx.fill();
                            ctx.stroke();
                            ctx.fillStyle = "#777";
                            ctx.font = "12px sans-serif";
                            ctx.textAlign = "center";
                            ctx.textBaseline = "middle";
                            ctx.fillText("No LoRAs selected", panelX + panelW/2, startY + 12);
                            ctx.restore();
                            return;
                        }

                        ctx.save();
                        ctx.textBaseline = "middle";
                        ctx.textAlign = "left";

                        selected.forEach((item, index) => {
                            const y = startY + index * 28;
                            
                            ctx.fillStyle = "#4caf50";
                            ctx.beginPath();
                            ctx.arc(panelX + 10, y + 12, 6, 0, Math.PI * 2);
                            ctx.fill();

                            const delW = 22;
                            const delX = panelX + panelW - delW;
                            ctx.fillStyle = "#3a2222";
                            ctx.strokeStyle = "#553333";
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(delX, y, delW, 24, 4);
                            else ctx.rect(delX, y, delW, 24);
                            ctx.fill();
                            ctx.stroke();
                            ctx.fillStyle = "#ff6b6b";
                            ctx.font = "12px sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText("✕", delX + delW / 2, y + 12);
                            
                            node._loraChipZones.push({ x: delX, y: y, w: delW, h: 24, type: "remove", name: item.rawName });

                            const strW = 56;
                            const strX = delX - strW - 6;
                            ctx.fillStyle = "#222";
                            ctx.strokeStyle = "#444";
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(strX, y, strW, 24, 4);
                            else ctx.rect(strX, y, strW, 24);
                            ctx.fill();
                            ctx.stroke();
                            ctx.fillStyle = "#DDDDDD";
                            ctx.font = "11px sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText(`◄ ${item.weight.toFixed(2)} ►`, strX + strW / 2, y + 12);

                            node._loraChipZones.push({ x: strX, y: y, w: strW, h: 24, type: "weight", name: item.rawName, weight: item.weight });

                            const nameX = panelX + 24;
                            const nameW = strX - nameX - 6;
                            ctx.fillStyle = "#222";
                            ctx.strokeStyle = "#444";
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(nameX, y, nameW, 24, 4);
                            else ctx.rect(nameX, y, nameW, 24);
                            ctx.fill();
                            ctx.stroke();

                            ctx.save();
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(nameX, y, nameW, 24, 4);
                            else ctx.rect(nameX, y, nameW, 24);
                            ctx.clip();
                            ctx.fillStyle = "#DDDDDD";
                            ctx.font = "11px sans-serif";
                            ctx.textAlign = "left";
                            const shortName = item.rawName.split(/[\\/]/).pop();
                            ctx.fillText(shortName, nameX + 8, y + 12);
                            ctx.restore();
                        });
                        ctx.restore();
                    } catch (e) { console.error("PromptLora draw error:", e); }
                },
                mouse: function(e, pos, node) {
                    if (e.type === "pointerdown" || e.type === "mousedown") {
                        for (const zone of (node._loraChipZones || [])) {
                            if (pos[0] >= zone.x && pos[0] <= zone.x + zone.w && pos[1] >= zone.y && pos[1] <= zone.y + zone.h) {
                                if (zone.type === "remove") removeLoraFromPrompt(node, zone.name);
                                else if (zone.type === "weight") {
                                    const localX = pos[0] - zone.x;
                                    if (localX < 18) applyWeightDelta(node, zone.name, -0.05);
                                    else if (localX > zone.w - 18) applyWeightDelta(node, zone.name, 0.05);
                                    else changeLoraWeight(node, zone.name, zone.weight, e.clientX, e.clientY);
                                }
                                return true; 
                            }
                        }
                    }
                    return false;
                }
            };
            dummy.node = this;
            
            this.widgets.splice(btnIndex, 0, dummy);

            setTimeout(() => {
                if (this.size[0] < 350) this.size[0] = 350;
                syncNodeSize(this);
            }, 100);

            const origOnConfigure = this.onConfigure;
            this.onConfigure = function(o) {
                if (origOnConfigure) origOnConfigure.apply(this, arguments);
                setTimeout(() => syncNodeSize(this), 50);
            };

            return result;
        };
    }
});