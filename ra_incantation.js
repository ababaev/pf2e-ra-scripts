/*
 * PF2e RA Incantation — prepend a Latin incantation to a spell description
 * Copyright (C) 2026  Arkady Babaev <https://github.com/ababaev>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   Drop a spell (or any item with a description) into the window, type
 *   the incantation in English, press Translate, edit the Latin if you
 *   want, and Apply. The Latin is inserted at the top of the description
 *   as a blockquote. The window stays open for the next spell.
 *
 * SPELL TRAITS
 *   A spell with the manipulate trait gets "Manipulate." in front of the
 *   incantation, and a subtle spell gets "Silently." — these are written
 *   as they are, not translated. A subtle spell has no spoken words, so
 *   the English box is left empty and the Latin is optional. Any other
 *   spell has the English box prefilled with its traditions and its name
 *   ("Arcane occult force barrage"), ready to translate or rewrite.
 *
 * TRANSLATION
 *   There is no free official Google Translate API. This uses the
 *   unofficial endpoint that Google's own web client calls, and falls
 *   back to MyMemory if that fails. Both are free, neither is promised
 *   to keep working, and both are rate-limited. If translation stops
 *   working one day, that is why — type the Latin yourself into the
 *   second box and Apply still works.
 *
 *   Machine-translated Latin is unreliable. It is usually fine for a few
 *   words of flavour and frequently wrong for anything longer. Always
 *   read what comes back before applying it; that is what the editable
 *   box is for.
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later (uses DialogV2). Macro type: script.
 *   Permission to edit the items you drop in.
 */

(async () => {
  // ============ SETTINGS ============
  const TARGET_LANG = "la";  // la = Latin. Any Google code works.
  const SOURCE_LANG = "en";
  const KEEP_ENGLISH = false; // true - also keep the English under the Latin
  // ==================================

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // --- translation back ends ---
  const viaGoogle = async (text) => {
    const url = "https://translate.googleapis.com/translate_a/single"
      + `?client=gtx&sl=${SOURCE_LANG}&tl=${TARGET_LANG}&dt=t`
      + `&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`google ${res.status}`);
    const data = await res.json();
    const out = (data?.[0] ?? []).map((chunk) => chunk?.[0] ?? "").join("");
    if (!out) throw new Error("google returned nothing");
    return out;
  };

  const viaMyMemory = async (text) => {
    const url = "https://api.mymemory.translated.net/get"
      + `?q=${encodeURIComponent(text)}`
      + `&langpair=${SOURCE_LANG}|${TARGET_LANG}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mymemory ${res.status}`);
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    if (!out) throw new Error("mymemory returned nothing");
    return out;
  };

  const translate = async (text) => {
    try { return await viaGoogle(text); }
    catch (e) {
      console.warn("PF2e RA Incantation — google failed, trying mymemory", e);
      return viaMyMemory(text);
    }
  };

  const traitsOf = (doc) => doc?.system?.traits?.value ?? [];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // The untranslated lead-in written before the Latin.
  const prefixOf = (doc) => [
    traitsOf(doc).includes("manipulate") ? "Manipulate." : null,
    traitsOf(doc).includes("subtle")     ? "Silently."   : null
  ].filter(Boolean).join(" ");

  // English prefilled for translation: traditions, then the spell name,
  // as one phrase. Subtle spells are cast without words, so they get nothing.
  const englishOf = (doc) => {
    if (doc?.type !== "spell" || traitsOf(doc).includes("subtle")) return "";
    const trads = doc.system?.traits?.traditions ?? [];
    return cap([...trads, doc.name].join(" ").toLowerCase());
  };

  // --- state ---
  let target = null; // the dropped document
  let prefix = "";   // prefixOf(target)

  // --- window ---
  const dlg = new foundry.applications.api.DialogV2({
    window: { title: "Incantation — Latin flavour for a spell", resizable: true },
    position: { width: 520 },
    content: `
      <div id="in-drop" style="border:2px dashed #888;padding:1.2rem;
           text-align:center;border-radius:6px;opacity:.85;">
        Drop a spell here
      </div>
      <p id="in-target" style="text-align:center;margin:.4rem 0;
         opacity:.6;font-size:.9em;">nothing loaded</p>

      <label style="font-size:.9em;opacity:.8;">English</label>
      <textarea id="in-src" rows="3" style="width:100%;resize:vertical;"
        placeholder="Let the simplest magic do my bidding"></textarea>

      <div style="text-align:center;margin:.5rem 0;">
        <button type="button" id="in-translate">Translate to Latin ↓</button>
      </div>

      <label style="font-size:.9em;opacity:.8;">Latin — edit freely</label>
      <textarea id="in-out" rows="3" style="width:100%;resize:vertical;"></textarea>

      <div style="display:flex;gap:.5rem;margin-top:.8rem;">
        <button type="button" id="in-apply" style="flex:2 1 auto;" disabled>
          Apply to description</button>
        <button type="button" id="in-clear" style="flex:1 1 auto;">Clear</button>
      </div>`,
    buttons: [{ action: "close", label: "Close" }]
  });

  await dlg.render(true);

  const root     = dlg.element;
  const zone     = root.querySelector("#in-drop");
  const label    = root.querySelector("#in-target");
  const srcBox   = root.querySelector("#in-src");
  const outBox   = root.querySelector("#in-out");
  const btnTrans = root.querySelector("#in-translate");
  const btnApply = root.querySelector("#in-apply");

  const refreshApply = () => {
    btnApply.disabled = !target || !(prefix || outBox.value.trim());
  };

  const showTarget = () => {
    label.style.opacity = target ? "1" : ".6";
    label.textContent = !target ? "nothing loaded"
      : prefix ? `${target.name} — ${prefix}` : target.name;
  };

  outBox.addEventListener("input", refreshApply);

  // --- dropping ---
  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    zone.style.background = "rgba(120,160,255,.15)";
  });
  zone.addEventListener("dragleave", () => { zone.style.background = ""; });

  zone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    zone.style.background = "";

    let doc;
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      doc = await fromUuid(data.uuid);
      if (!doc) throw new Error("no doc");
    } catch (e) {
      return ui.notifications.error("Could not read the dropped item");
    }

    if (typeof doc.system?.description?.value !== "string")
      return ui.notifications.warn(`"${doc.name}" has no description to edit`);

    if (!doc.isOwner)
      return ui.notifications.error(`You cannot modify "${doc.name}"`);

    target = doc;
    prefix = prefixOf(doc);
    srcBox.value = englishOf(doc);
    outBox.value = "";
    showTarget();
    refreshApply();
  });

  // --- translate ---
  btnTrans.addEventListener("click", async () => {
    const text = srcBox.value.trim();
    if (!text) return ui.notifications.warn("Write something in English first");

    btnTrans.disabled = true;
    const was = btnTrans.textContent;
    btnTrans.textContent = "Translating…";
    try {
      outBox.value = await translate(text);
      refreshApply();
    } catch (e) {
      console.error("PF2e RA Incantation", e);
      ui.notifications.error(
        "Translation failed — both services refused. Type the Latin yourself.");
    } finally {
      btnTrans.disabled = false;
      btnTrans.textContent = was;
    }
  });

  // --- apply ---
  btnApply.addEventListener("click", async () => {
    if (!target) return;
    const latin = outBox.value.trim();
    if (!prefix && !latin) return;

    btnApply.disabled = true;
    try {
      const line = [
        prefix ? `<strong>${esc(prefix)}</strong>` : "",
        latin  ? `<em>${esc(latin)}</em>` : ""
      ].filter(Boolean).join(" ");
      const quote = `<blockquote><p>${line}</p>${
        KEEP_ENGLISH && srcBox.value.trim()
          ? `<p style="opacity:.7;font-size:.9em;">${esc(srcBox.value.trim())}</p>`
          : ""}</blockquote>`;

      const current = target.system.description.value ?? "";
      await target.update({
        "system.description.value": `${quote}\n${current}`
      });

      ui.notifications.info(`Incantation added to ${target.name}`);
      target = null;
      prefix = "";
      showTarget();
      srcBox.value = "";
      outBox.value = "";
    } catch (e) {
      console.error("PF2e RA Incantation", e);
      ui.notifications.error("Could not update the description — see the console");
    } finally {
      refreshApply();
    }
  });

  root.querySelector("#in-clear").addEventListener("click", () => {
    srcBox.value = "";
    outBox.value = "";
    refreshApply();
  });
})();
