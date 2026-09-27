/*
 * PF2e RA Item Mystification — a Foundry VTT macro for disguising items
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
 * The full licence text is also available at
 * <https://www.gnu.org/licenses/gpl-3.0.html> and in the LICENSE file
 * distributed with this program.
 *
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   Drop an item into the window, pick something to disguise it as, and
 *   the script fills the item's "Mystified" tab (name, image, description).
 *   The drop window stays open, so several items can be done in a row.
 *   Close it with the Close button when finished.
 *
 * MATCHING RULES
 *   Categories are grouped: potions, oils and elixirs are interchangeable
 *   with each other, talismans only with talismans. A candidate must also
 *   match the target's magical status — a magical item can only be
 *   disguised as another magical item, a mundane one only as mundane.
 *   "Magical" means any trait in MAGIC_TRAITS: the remaster "magical"
 *   trait, or a legacy tradition trait (arcane, divine, occult, primal).
 *
 *   If an item's category is not one of the supported ones, but it counts
 *   as consumable and has a supported category as a trait, it is treated
 *   as that category (mutagens are category "mutagen" with the "elixir"
 *   trait, so they count as elixirs). Failing that, if its name contains
 *   "potion", "oil" or "elixir" as a whole word, it is treated as that
 *   category. The hint that appears
 *   earliest in the name wins ("Oil of Potency" -> oil).
 *   "Counts as consumable" means item type consumable, or one of the
 *   traits in CONSUMABLE_TRAITS — alchemical is included, which is what
 *   lets oddities such as snake oil through.
 *
 *   "by price" and "by level" rank the whole pool by closeness and show
 *   the nearest MAX candidates, so these two modes always return a full
 *   list when one exists. Items with no price (or a price of 0) are left
 *   out of "by price"; the window opens in "by level" when the target
 *   itself has no price. The percentage and level difference are printed
 *   on each row, so a poor match is visible rather than hidden. Only the
 *   combined "both" mode applies hard bands (TOLERANCE, LEVEL_SPAN),
 *   since an intersection needs thresholds to mean anything.
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later (uses DialogV2).
 *   The Pathfinder Second Edition system module, which this macro depends
 *   on: candidates are read at runtime from its bundled compendiums.
 *   Macro type: script.
 *
 * THIRD-PARTY CONTENT
 *   This macro reads game content from the PF2e system's compendiums at
 *   runtime. It does not contain or redistribute any Paizo content. Names,
 *   images and descriptions remain the property of their respective owners
 *   and are used here only within the user's own game world. Paizo game
 *   content is used under the Open Game License / ORC as applicable to the
 *   PF2e system module; this macro is not affiliated with or endorsed by
 *   Paizo Inc.
 */

(async () => {
  // ============ SETTINGS ============
  const PACKS      = ["pf2e.equipment-srd"]; // add your own compendiums here
  const GROUPS     = [                       // categories that may disguise
    ["potion", "oil", "elixir"],             // each other
    ["talisman"]
  ];
  const NAME_HINTS = ["potion", "oil", "elixir"];    // name-based fallback
  const CONSUMABLE_TRAITS = ["consumable", "alchemical"]; // counts as consumable
  const MAGIC_TRAITS = ["magical", "arcane", "divine", "occult", "primal"];
  const TOLERANCE  = 0.25;  // +/-25% price band, "both" mode only
  const LEVEL_SPAN = 1;     // +/-1 level band,  "both" mode only
  const MAX        = 15;    // how many candidates to show
  const SET_STATUS = false; // true  - mystify the item immediately
                            // false - only prepare the disguise
  // ==================================

  const SUPPORTED = GROUPS.flat();

  // --- helpers ---
  const cp = (price) => {
    const v = price?.value;
    if (!v) return null;
    const per = price?.per || 1;
    const total = (v.pp ?? 0) * 1000 + (v.gp ?? 0) * 100
                + (v.sp ?? 0) * 10  + (v.cp ?? 0);
    return total > 0 ? total / per : null;     // no price -> exclude
  };

  const traitsOf = (doc) => doc?.system?.traits?.value ?? [];

  const isMagical    = (doc) => traitsOf(doc).some((t) => MAGIC_TRAITS.includes(t));
  const isConsumable = (doc) => doc?.type === "consumable"
    || traitsOf(doc).some((t) => CONSUMABLE_TRAITS.includes(t));

  // Whole words only, so "Boiling" or "Soil" do not count as oil.
  const HINT_RE = new RegExp(`\\b(${NAME_HINTS.join("|")})s?\\b`, "i");

  // Effective category: the declared one, then a supported category
  // carried as a trait (mutagens are category "mutagen" but have the
  // "elixir" trait), then a name-based guess for consumables.
  const catOf = (doc) => {
    const raw = doc?.system?.category
             ?? doc?.system?.consumableType?.value
             ?? null;
    if (SUPPORTED.includes(raw)) return raw;
    if (!isConsumable(doc))      return raw;
    const trait = traitsOf(doc).find((t) => SUPPORTED.includes(t));
    if (trait) return trait;
    const hit = String(doc?.name ?? "").match(HINT_RE);
    return hit ? hit[1].toLowerCase() : raw;
  };

  const groupOf = (cat) => GROUPS.find((g) => g.includes(cat)) ?? null;

  const fmt = (c) => {
    if (c === null) return "—";
    const gp = c / 100;
    return Number.isInteger(gp) ? `${gp} gp` : `${gp.toFixed(2)} gp`;
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // --- candidates, read from the compendiums once per macro run ---
  // Everything that does not depend on the dropped item is worked out
  // here, so each drop only filters and sorts an in-memory list.
  const loadCandidates = async () => {
    const all = [];
    for (const key of PACKS) {
      const pack = game.packs.get(key);
      if (!pack) { ui.notifications.warn(`Compendium ${key} not found`); continue; }
      const index = await pack.getIndex({ fields: [
        "type", "img", "system.price", "system.category",
        "system.consumableType", "system.level", "system.traits"
      ]});
      for (const e of index) {
        if (!isConsumable(e)) continue;
        const cat = catOf(e);
        if (!SUPPORTED.includes(cat)) continue;
        all.push({
          _id: e._id,
          pack: key,
          name: e.name,
          img: e.img,
          cat,
          magical: isMagical(e),
          price: cp(e.system?.price),
          level: e.system?.level?.value ?? null
        });
      }
    }
    return all;
  };
  const candidatesReady = loadCandidates();   // starts while the GM drags

  // --- the whole flow for one dropped item ---
  // Returns a short status line for the drop window, or null if nothing
  // was applied.
  const mystify = async (item) => {
    if (item.documentName !== "Item") {
      ui.notifications.error("Only items can be mystified");
      return null;
    }
    if (!item.isOwner || item.compendium?.locked) {
      ui.notifications.error("You do not have permission to modify this item");
      return null;
    }

    const targetCat   = catOf(item);
    const targetGroup = groupOf(targetCat);

    if (!targetGroup) {
      ui.notifications.warn(
        `Category "${targetCat ?? "—"}" is not supported yet. ` +
        `type=${item.type}, traits=[${traitsOf(item).join(", ")}]. ` +
        `Supported: ${SUPPORTED.join(", ")}`);
      return null;
    }

    const targetMagical = isMagical(item);
    const targetPrice   = cp(item.system.price);
    const targetLevel   = item.system.level?.value ?? null;

    if (targetPrice === null && targetLevel === null) {
      ui.notifications.error("This item has neither a price nor a level");
      return null;
    }

    const pool = (await candidatesReady).filter((x) =>
      x.magical === targetMagical
      && targetGroup.includes(x.cat)
      && x.name !== item.name);

    if (!pool.length) {
      ui.notifications.warn(
        `No ${targetMagical ? "magical" : "non-magical"} ` +
        `${targetGroup.join("/")} found in the compendiums`);
      return null;
    }

    // --- three matching modes ---
    const priceGap = (x) => Math.abs(x.price - targetPrice);
    const levelGap = (x) => Math.abs(x.level - targetLevel);

    // Nearest by price, no cut-off — the badge shows how far off each is.
    const buildByPrice = () => {
      if (targetPrice === null) return [];
      return pool
        .filter((x) => x.price !== null)
        .sort((a, b) => priceGap(a) - priceGap(b));
    };

    // Nearest by level, ties broken by price so the list is stable.
    const buildByLevel = () => {
      if (targetLevel === null) return [];
      return pool
        .filter((x) => x.level !== null)
        .sort((a, b) => (levelGap(a) - levelGap(b))
                     || ((targetPrice === null || a.price === null
                          || b.price === null) ? 0 : priceGap(a) - priceGap(b)));
    };

    // The only mode with hard bands: an intersection needs thresholds.
    const buildBoth = () => {
      if (targetPrice === null || targetLevel === null) return [];
      return pool
        .filter((x) => x.price !== null && x.level !== null
                    && x.price >= targetPrice * (1 - TOLERANCE)
                    && x.price <= targetPrice * (1 + TOLERANCE)
                    && levelGap(x) <= LEVEL_SPAN)
        .sort((a, b) => priceGap(a) - priceGap(b));
    };

    const lists = {};
    const build = (mode) => lists[mode] ??= (
        mode === "price" ? buildByPrice()
      : mode === "level" ? buildByLevel()
      : buildBoth()).slice(0, MAX);

    // --- selection window ---
    const badge = (x) => {
      const bits = [];
      if (x.cat !== targetCat) bits.push(x.cat);
      if (x.price !== null) {
        if (x.price === targetPrice) bits.push("exact price");
        else if (targetPrice !== null) {
          const d = Math.round((x.price / targetPrice - 1) * 100);
          bits.push(`${d > 0 ? "+" : ""}${d}%`);
        }
      }
      if (x.level !== null) {
        const d = targetLevel === null ? null : x.level - targetLevel;
        bits.push(d === 0 || d === null ? `lvl ${x.level}`
                                        : `lvl ${x.level} (${d > 0 ? "+" : ""}${d})`);
      }
      return bits.join(" · ");
    };

    const renderList = (mode) => {
      const list = build(mode);
      if (!list.length)
        return `<p style="opacity:.7;padding:1rem 0;">Nothing found in this mode.</p>`;
      return list.map((x, i) => `
        <label style="display:flex;gap:.5rem;align-items:center;
                      padding:.3rem .2rem;border-bottom:1px solid rgba(128,128,128,.2);">
          <input type="radio" name="pick" value="${i}" ${i ? "" : "checked"}>
          <img src="${esc(x.img)}" width="30" height="30" style="border:none;flex:0 0 auto;">
          <span style="flex:1 1 auto;">${esc(x.name)}</span>
          <span style="opacity:.65;font-size:.85em;white-space:nowrap;">
            ${esc(fmt(x.price))} · ${esc(badge(x))}
          </span>
        </label>`).join("");
    };

    let currentMode = targetPrice !== null ? "price" : "level";
    const modeRadio = (value, label) => `<label><input type="radio" name="mode"
      value="${value}" ${value === currentMode ? "checked" : ""}> ${label}</label>`;

    const header = `
      <p style="opacity:.75;margin:0 0 .5rem 0;">
        <b>${esc(item.name)}</b> — ${esc(fmt(targetPrice))}${
          targetLevel !== null ? `, level ${targetLevel}` : ""}<br>
        <span style="font-size:.85em;">${esc(targetCat)}${
          targetMagical ? ", magical" : ", non-magical"} —
          showing ${esc(targetGroup.join("/"))}, ${pool.length} candidates</span>
      </p>
      <div style="display:flex;gap:1rem;margin-bottom:.5rem;">
        ${modeRadio("price", "by price")}
        ${modeRadio("level", "by level")}
        ${modeRadio("both", "both")}
      </div>`;

    const picked = await new Promise((resolve) => {
      const dlg = new foundry.applications.api.DialogV2({
        window: { title: `Disguise "${item.name}" as…`, resizable: true },
        position: { width: 520 },
        content: `${header}<div id="myst-list"
                     style="max-height:420px;overflow:auto;">${renderList(currentMode)}</div>`,
        buttons: [
          { action: "ok", label: "Apply", default: true,
            callback: (ev, btn) => {
              const sel = btn.form.elements.pick;
              return sel ? build(currentMode)[Number(sel.value)] ?? null : null;
            }},
          { action: "cancel", label: "Cancel", callback: () => null }
        ],
        submit: (result) => resolve(result ?? null),
        close: () => resolve(null)   // no-op if submit already resolved
      });

      dlg.render(true).then(() => {
        const root = dlg.element;
        root.querySelectorAll('input[name="mode"]').forEach((r) => {
          r.addEventListener("change", (ev) => {
            currentMode = ev.target.value;
            root.querySelector("#myst-list").innerHTML = renderList(currentMode);
          });
        });
      });
    });

    if (!picked) return null;

    // --- apply the disguise ---
    const pack = game.packs.get(picked.pack);
    const fake = await pack.getDocument(picked._id);
    if (!fake) {
      ui.notifications.error("Could not load the selected item");
      return null;
    }

    await item.update({
      "system.identification.unidentified.name": fake.name,
      "system.identification.unidentified.img": fake.img,
      "system.identification.unidentified.data.description.value":
        fake.system.description?.value ?? "",
      ...(SET_STATUS ? { "system.identification.status": "unidentified" } : {})
    });

    if (SET_STATUS) {
      ui.notifications.info(`${item.name} is now mystified as "${fake.name}"`);
    } else {
      ui.notifications.info(
        `Disguise ready: ${item.name} → "${fake.name}". Mystify it manually.`);
    }

    return `${item.name} → ${fake.name}`;
  };

  // --- persistent drop window ---
  let busy = false;

  const dropDlg = new foundry.applications.api.DialogV2({
    window: { title: "Mystify — drop an item" },
    content: `
      <div id="myst-drop" style="border:2px dashed #888;padding:2.5rem;
           text-align:center;border-radius:6px;opacity:.85;">
        Drop an item here
      </div>
      <p id="myst-status" style="opacity:.65;font-size:.85em;
         margin:.5rem 0 0 0;min-height:1.2em;text-align:center;"></p>`,
    buttons: [{ action: "close", label: "Close" }]
  });

  await dropDlg.render(true);

  const zone   = dropDlg.element.querySelector("#myst-drop");
  const status = dropDlg.element.querySelector("#myst-status");

  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (!busy) zone.style.background = "rgba(120,160,255,.15)";
  });
  zone.addEventListener("dragleave", () => { zone.style.background = ""; });

  zone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    zone.style.background = "";
    if (busy) return;

    let doc;
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      doc = await fromUuid(data.uuid);
      if (!doc) throw new Error("no doc");
    } catch (e) {
      ui.notifications.error("Could not read the dropped item");
      return;
    }

    busy = true;
    zone.textContent = `Working on ${doc.name}…`;
    try {
      const result = await mystify(doc);
      if (result) status.textContent = `Last: ${result}`;
    } catch (e) {
      console.error("PF2e RA Mystification", e);
      ui.notifications.error("Something went wrong — see the console");
    } finally {
      busy = false;
      zone.textContent = "Drop an item here";
    }
  });
})();
