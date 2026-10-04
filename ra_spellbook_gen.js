/*
 * PF2e RA Spellbook Generator — write a character's prepared spells into a book
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
 *   Select one or more tokens and run. With no token selected, it uses
 *   your assigned character (the one shown next to your name in the
 *   Players list). For each actor it collects the spells from every
 *   PREPARED spellcasting entry (cantrips included), groups them by
 *   tradition, and writes them into a Spellbook item in the inventory,
 *   replacing the item's default description.
 *
 *   - Several prepared entries with the same tradition are merged into
 *     one section.
 *   - Spells are listed at their base rank and de-duplicated by name.
 *   - Focus spells and rituals are left out; empty ranks are omitted.
 *   - Running it again on the same actor updates the book it created
 *     earlier instead of adding a second one.
 *
 * LINKS
 *   LINK_MODE decides how spell names are written:
 *     "actor"      - @UUID link to the spell item on this actor
 *     "compendium" - @UUID link to the compendium spell it came from,
 *                    falling back to "actor" when there is none
 *     "none"       - plain text
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later.
 *   The Pathfinder Second Edition system module: the book itself is taken
 *   from its equipment compendium (a plain item is made if not found).
 *   Macro type: script. Permission to edit the actors it runs on.
 */

(async () => {
  // ============ SETTINGS ============
  const LINK_MODE      = "actor";               // "actor" | "compendium" | "none"
  const EQUIPMENT_PACK = "pf2e.equipment-srd";  // where the Spellbook item comes from
  const LABELS = {
    author: "Author",
    total: "Total spells",
    cantrips: "Cantrips",
    rank: (r) => `${ordinal(r)} rank`,
    traditions: { arcane: "Arcane", divine: "Divine", occult: "Occult", primal: "Primal" }
  };
  // ==================================

  const TRADITION_ORDER = ["arcane", "divine", "occult", "primal"];
  const FLAG_SCOPE = "world";
  const FLAG_KEY   = "spellbookGenerator";

  // --- helpers ---
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // tradition -> Map(rank -> Map(nameKey -> { name, uuid, sourceUuid }));
  // rank 0 = cantrips
  const collectSpells = (actor, entries) => {
    const byTradition = new Map();

    for (const entry of entries) {
      const tradition = entry.system?.tradition?.value;
      if (!tradition) continue;

      const spells = actor.itemTypes.spell.filter((s) => s.system?.location?.value === entry.id);
      for (const spell of spells) {
        const traits = spell.system?.traits?.value ?? [];
        if (traits.includes("focus") || spell.system?.ritual) continue;

        const isCantrip = spell.isCantrip ?? traits.includes("cantrip");
        const rank = isCantrip ? 0 : Number(spell.baseRank ?? spell.system?.level?.value ?? 1);

        if (!byTradition.has(tradition)) byTradition.set(tradition, new Map());
        const ranks = byTradition.get(tradition);
        if (!ranks.has(rank)) ranks.set(rank, new Map());
        const bucket = ranks.get(rank);

        const name = spell.name.trim();
        const key = name.toLocaleLowerCase();
        if (!bucket.has(key)) {
          const sourceUuid =
            spell.sourceId ?? spell._stats?.compendiumSource ?? spell.flags?.core?.sourceId ?? null;
          bucket.set(key, { name, uuid: spell.uuid ?? null, sourceUuid });
        }
      }
    }
    return byTradition;
  };

  const buildHtml = (authorName, byTradition) => {
    const collator = new Intl.Collator(game.i18n.lang, { sensitivity: "base", numeric: true });
    const orderOf = (t) => {
      const i = TRADITION_ORDER.indexOf(t);
      return i === -1 ? TRADITION_ORDER.length : i;
    };
    const link = (s) => {
      const uuid =
        LINK_MODE === "compendium" ? s.sourceUuid ?? s.uuid
        : LINK_MODE === "actor" ? s.uuid
        : null;
      return uuid ? `@UUID[${uuid}]{${esc(s.name)}}` : esc(s.name);
    };

    const traditions = [...byTradition.keys()]
      .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));

    let body = "";
    let total = 0;
    for (const tradition of traditions) {
      const ranks = byTradition.get(tradition);
      body += `<h2>${esc(LABELS.traditions[tradition] ?? tradition.capitalize())}</h2>`;
      for (const rank of [...ranks.keys()].sort((a, b) => a - b)) {
        const list = [...ranks.get(rank).values()].sort((a, b) => collator.compare(a.name, b.name));
        if (!list.length) continue;
        total += list.length;
        const heading = rank === 0 ? LABELS.cantrips : LABELS.rank(rank);
        body += `<h3>${esc(heading)} (${list.length})</h3>`
              + `<ul>${list.map((s) => `<li>${link(s)}</li>`).join("")}</ul>`;
      }
    }

    const header =
      `<p><strong>${esc(LABELS.author)}:</strong> ${esc(authorName)}</p>` +
      `<p><strong>${esc(LABELS.total)}:</strong> ${total}</p>`;
    return header + body;
  };

  // Spellbook from the PF2e equipment compendium; a plain equipment item
  // if not found.
  const getSpellbookData = async () => {
    const pack = game.packs.get(EQUIPMENT_PACK);
    if (pack) {
      const index = await pack.getIndex({ fields: ["system.slug"] });
      const slugOf = (e) => e.system?.slug ?? "";
      const hit =
        index.find((e) => ["spellbook-blank", "spellbook"].includes(slugOf(e))) ??
        index.find((e) => slugOf(e).startsWith("spellbook")) ??
        index.find((e) => /^spellbook/i.test(e.name));
      if (hit) {
        const doc = await pack.getDocument(hit._id);
        if (doc) return game.items.fromCompendium(doc);
      }
    }
    return {
      name: "Spellbook",
      type: "equipment",
      system: { bulk: { value: 0.1 }, price: { value: { gp: 1 } } }
    };
  };

  // --- the whole flow for one actor ---
  const generateSpellbook = async (actor, name) => {
    if (!actor) return ui.notifications.warn(`${name} has no actor`);

    const entries = (actor.itemTypes.spellcastingEntry ?? []).filter(
      (e) => e.system?.prepared?.value === "prepared");
    if (!entries.length)
      return ui.notifications.warn(`${name} has no prepared spellcasting entries`);

    const byTradition = collectSpells(actor, entries);
    if (!byTradition.size)
      return ui.notifications.warn(`${name}'s prepared entries contain no spells`);

    const html = buildHtml(name, byTradition);

    const existing = actor.items.find((i) => i.flags?.[FLAG_SCOPE]?.[FLAG_KEY]);
    if (existing) {
      await existing.update({ "system.description.value": html });
      return ui.notifications.info(`Updated "${existing.name}" for ${name}`);
    }

    const data = await getSpellbookData();
    data.system ??= {};
    data.system.description = { ...(data.system.description ?? {}), value: html };
    data.system.quantity = 1;
    data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
      [FLAG_SCOPE]: { [FLAG_KEY]: { generated: true } }
    });

    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    ui.notifications.info(`Created "${item?.name ?? "Spellbook"}" for ${name}`);
  };

  // --- run: selected tokens first, otherwise the user's character ---
  const controlled = canvas?.tokens?.controlled ?? [];
  const targets = controlled.length
    ? controlled.map((t) => ({ actor: t.actor, name: t.name }))
    : game.user.character
      ? [{ actor: game.user.character, name: game.user.character.name }]
      : [];

  if (!targets.length)
    return ui.notifications.warn(
      "Select a token, or assign yourself a character "
      + "(right-click your name in the Players list → User Configuration)");

  for (const { actor, name } of targets) {
    try {
      await generateSpellbook(actor, name);
    } catch (err) {
      console.error("PF2e RA Spellbook Generator", err);
      ui.notifications.error(`Spellbook for ${name}: ${err.message}`);
    }
  }
})();
