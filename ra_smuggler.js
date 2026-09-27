/*
 * PF2e RA Smuggler — a Foundry VTT macro for selling items at half price
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
 *   Opens a window with a drop zone. Drag items from the party stash (or
 *   from any character sheet) into it to build a sell list. Adjust the
 *   quantity per row if you only want to sell part of a stack. Press Sell
 *   and each item is removed and the coins are added to the inventory it
 *   came from — so items dragged out of the stash pay into the stash.
 *
 *   Remove a row by double-clicking it or with the ✕ on the right. The
 *   window stays open until you close it. Rows that fail to sell stay in
 *   the list; everything that was removed is always paid for.
 *
 * MYSTIFIED ITEMS
 *   Mystification changes an item's apparent name, image and description,
 *   not its price, and the trader is never fooled — so a disguise has no
 *   effect on what is paid. The sell list shows the item exactly as it
 *   presents itself, with no hint that anything is disguised; only the GM
 *   whisper records both names, so the log shows what was handed over as
 *   well as what it actually was. When a player runs the macro the true
 *   name is left out of the whisper, since its author can read it too.
 *
 * PRICING
 *   Items sell at RATE (half by default) of their listed price. Batch
 *   pricing (arrows and other ammunition) is handled via price.per, so the
 *   unit price is the listed price divided by the batch size. Fractions of
 *   a copper are rounded down per row.
 *
 *   Treasure (gems, art objects, trade goods) sells at TREASURE_RATE —
 *   full price by default, as the rules allow. Rows priced at something
 *   other than RATE show their rate under the name.
 *
 *   Coins cannot be sold, and items with no listed price are rejected, as
 *   are temporary and infused items (made for free, so selling them would
 *   create money) and containers that still hold something.
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later (uses DialogV2).
 *   The Pathfinder Second Edition system module.
 *   Macro type: script. GM permission on the actors being sold from.
 */

(async () => {
  // ============ SETTINGS ============
  const RATE = 0.5;           // fraction of list price paid out
  const TREASURE_RATE = 1;    // gems, art objects, trade goods: full price
  const USE_PLATINUM = false; // true  - pay out in pp/gp/sp/cp
                              // false - gp/sp/cp only
  // ==================================

  // --- helpers ---
  // Price of a single unit, in copper. Returns null when there is no price.
  const unitCp = (price) => {
    const v = price?.value;
    if (!v) return null;
    const per = price?.per ?? 1;
    const total = (v.pp ?? 0) * 1000 + (v.gp ?? 0) * 100
                + (v.sp ?? 0) * 10  + (v.cp ?? 0);
    if (!total) return null;
    return total / per;
  };

  const toCoins = (cp) => {
    let rest = cp;
    const out = {};
    if (USE_PLATINUM) { out.pp = Math.floor(rest / 1000); rest -= out.pp * 1000; }
    out.gp = Math.floor(rest / 100); rest -= out.gp * 100;
    out.sp = Math.floor(rest / 10);  rest -= out.sp * 10;
    out.cp = rest;
    return out;
  };

  const fmt = (cp) => {
    const c = toCoins(cp);
    const bits = [];
    if (c.pp) bits.push(`${c.pp} pp`);
    if (c.gp) bits.push(`${c.gp} gp`);
    if (c.sp) bits.push(`${c.sp} sp`);
    if (c.cp || !bits.length) bits.push(`${c.cp} cp`);
    return bits.join(" ");
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const isCoins = (item) => item?.type === "treasure"
    && item?.system?.stackGroup === "coins";

  const rateOf = (item) => item?.type === "treasure" ? TREASURE_RATE : RATE;

  // Items that should not be sold at all: temporary or infused items made
  // for free (quick alchemy, daily preparations) would be free money.
  const isTemporary = (item) => !!item?.system?.temporary
    || (item?.system?.traits?.value ?? []).includes("infused");

  // Contents are not counted in a container's price, and deleting the
  // container would take them along, so only empty containers are sold.
  const hasContents = (item) =>
    !!item?.actor?.items?.some((i) => i.system?.containerId === item.id);

  // The name the item currently presents itself under, or null when it is
  // not mystified. Used for the log only — it does not affect the price.
  const fakeNameOf = (item) => {
    const id = item?.system?.identification;
    if (!id || id.status === "identified") return null;
    const name = id.unidentified?.name;
    return name ? String(name) : null;
  };

  // The true name. The system overrides Item#name to return the disguised
  // name while an item is unidentified, so that cannot be used here.
  const realNameOf = (item) =>
    item?.system?.identification?.identified?.name
    ?? item?._source?.name
    ?? item?.name;

  // --- state ---
  const cart = new Map();
  // uuid -> { uuid, name, fakeName, img, unit, rate, max, qty, actorName }

  const rowValue = (r) => Math.floor(r.unit * r.qty * r.rate);

  // What the user running the macro may see: never the true name of a
  // disguised item unless they are the GM.
  const visibleName = (r) => r.fakeName ?? r.name;
  const logName = (r) => r.fakeName && game.user.isGM
    ? `${r.fakeName} — really ${r.name}`
    : visibleName(r);

  // --- rendering ---
  const renderCart = () => {
    if (!cart.size)
      return `<p style="opacity:.6;padding:1rem 0;text-align:center;">
                Nothing to sell yet.</p>`;

    const rows = [...cart.values()].map((r) => `
      <tr data-uuid="${esc(r.uuid)}" title="Double-click to remove">
        <td style="width:34px;vertical-align:top;padding:.25rem 0;">
          <img src="${esc(r.img)}" width="28" height="28" style="border:none;">
        </td>
        <td style="vertical-align:top;padding:.25rem 0;">
          ${esc(visibleName(r))}
          <div style="opacity:.55;font-size:.8em;">${esc(r.actorName)}${
            r.rate !== RATE ? ` · ${r.rate * 100}% of list` : ""}</div>
        </td>
        <td style="width:70px;text-align:center;vertical-align:top;padding:.25rem 0;">
          <input type="number" class="qt-qty" min="1" max="${r.max}"
                 value="${r.qty}" style="width:60px;text-align:center;">
          <div style="opacity:.55;font-size:.8em;">of ${r.max}</div>
        </td>
        <td style="width:110px;text-align:right;white-space:nowrap;
                   vertical-align:top;padding:.25rem 0;">
          ${esc(fmt(rowValue(r)))}
        </td>
        <td style="width:24px;text-align:center;vertical-align:top;padding:.25rem 0;">
          <a class="qt-remove" title="Remove" style="cursor:pointer;">✕</a>
        </td>
      </tr>`).join("");

    const total = [...cart.values()].reduce((s, r) => s + rowValue(r), 0);

    return `
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;margin:.6rem 0 0 0;font-size:1.05em;">
        <b>Total: ${esc(fmt(total))}</b>
        <span style="opacity:.55;font-size:.8em;"> at ${RATE * 100}% of list</span>
      </p>`;
  };

  const refresh = () => {
    const el = dlg.element.querySelector("#qt-list");
    if (el) el.innerHTML = renderCart();
  };

  // --- window ---
  const dlg = new foundry.applications.api.DialogV2({
    window: { title: "RA Smuggler — sell at half price", resizable: true },
    position: { width: 520 },
    content: `
      <div id="qt-drop" style="border:2px dashed #888;padding:1.6rem;
           text-align:center;border-radius:6px;opacity:.85;margin-bottom:.6rem;">
        Drop items here
      </div>
      <div id="qt-list" style="max-height:340px;overflow:auto;"></div>
      <div style="display:flex;gap:.5rem;margin-top:.8rem;">
        <button type="button" id="qt-sell" style="flex:2 1 auto;">Sell</button>
        <button type="button" id="qt-clear" style="flex:1 1 auto;">Clear</button>
      </div>`,
    buttons: [{ action: "close", label: "Close" }]
  });

  await dlg.render(true);

  const root = dlg.element;
  const zone = root.querySelector("#qt-drop");
  const list = root.querySelector("#qt-list");
  refresh();

  // --- dropping ---
  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    zone.style.background = "rgba(120,160,255,.15)";
  });
  zone.addEventListener("dragleave", () => { zone.style.background = ""; });

  zone.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    zone.style.background = "";

    let item;
    try {
      const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      item = await fromUuid(data.uuid);
      if (!item) throw new Error("no doc");
    } catch (e) {
      return ui.notifications.error("Could not read the dropped item");
    }

    if (!item.actor)
      return ui.notifications.warn(
        `"${item.name}" does not belong to an actor — drag it from a sheet or the stash`);

    if (!item.isOwner)
      return ui.notifications.error(`You cannot modify "${item.name}"`);

    if (isCoins(item))
      return ui.notifications.warn("Coins cannot be sold");

    if (isTemporary(item))
      return ui.notifications.warn(
        `"${item.name}" is temporary or infused and cannot be sold`);

    if (hasContents(item))
      return ui.notifications.warn(`Empty "${item.name}" before selling it`);

    if (cart.has(item.uuid))
      return ui.notifications.info(`"${item.name}" is already in the list`);

    const unit = unitCp(item.system?.price);
    if (unit === null)
      return ui.notifications.warn(`"${item.name}" has no price and cannot be sold`);

    cart.set(item.uuid, {
      uuid: item.uuid,
      name: realNameOf(item),
      fakeName: fakeNameOf(item),
      img: item.img,
      unit,
      rate: rateOf(item),
      max: Math.max(1, item.system?.quantity ?? 1),
      qty: Math.max(1, item.system?.quantity ?? 1),
      actorName: item.actor.name
    });

    refresh();
  });

  // --- list interaction (delegated, the list is re-rendered on change) ---
  list.addEventListener("change", (ev) => {
    const input = ev.target.closest(".qt-qty");
    if (!input) return;
    const row = cart.get(input.closest("tr")?.dataset.uuid);
    if (!row) return;
    const q = Number(input.value);
    row.qty = Math.min(row.max, Math.max(1, Number.isFinite(q) ? Math.floor(q) : 1));
    refresh();
  });

  // Enter in a number field would submit the dialog form, which closes
  // the window and loses the list. Commit the value instead.
  list.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.closest(".qt-qty")) return;
    ev.preventDefault();
    ev.target.blur();
  });

  list.addEventListener("click", (ev) => {
    if (!ev.target.closest(".qt-remove")) return;
    const uuid = ev.target.closest("tr")?.dataset.uuid;
    if (uuid) { cart.delete(uuid); refresh(); }
  });

  // Double-click anywhere on a row removes it, except on the controls.
  list.addEventListener("dblclick", (ev) => {
    if (ev.target.closest("input, a")) return;
    const uuid = ev.target.closest("tr")?.dataset.uuid;
    if (uuid) { cart.delete(uuid); refresh(); }
  });

  root.querySelector("#qt-clear").addEventListener("click", () => {
    cart.clear();
    refresh();
  });

  // --- selling ---
  let busy = false;
  const sellBtn = root.querySelector("#qt-sell");

  sellBtn.addEventListener("click", async () => {
    if (busy) return;
    if (!cart.size) return ui.notifications.warn("Nothing to sell");

    busy = true;
    sellBtn.disabled = true;

    const payouts = new Map(); // actor -> copper
    const lines   = [];
    const sold    = [];
    let failed    = 0;

    // Each row is handled on its own, so one bad item does not stop the
    // rest, and whatever was removed is always paid for below.
    for (const row of cart.values()) {
      try {
        const item = await fromUuid(row.uuid);
        if (!item?.actor) {
          ui.notifications.warn(`"${visibleName(row)}" is no longer available — skipped`);
          sold.push(row.uuid);
          continue;
        }
        if (hasContents(item)) {
          ui.notifications.warn(`"${visibleName(row)}" is not empty — skipped`);
          continue;
        }

        const have = item.system?.quantity ?? 1;
        const qty  = Math.min(row.qty, have);
        if (qty < 1) { sold.push(row.uuid); continue; }

        const value = Math.floor(row.unit * qty * row.rate);
        const actor = item.actor;

        if (qty >= have) await item.delete();
        else await item.update({ "system.quantity": have - qty });

        payouts.set(actor, (payouts.get(actor) ?? 0) + value);
        lines.push(`${qty} × ${logName(row)} — ${fmt(value)}`);
        sold.push(row.uuid);
      } catch (e) {
        console.error("PF2e RA Smuggler", e);
        failed++;
      }
    }

    try {
      for (const [actor, cp] of payouts) {
        if (typeof actor.inventory?.addCoins !== "function") {
          ui.notifications.error(
            `Cannot add coins to ${actor.name} — this actor type has no inventory`);
          continue;
        }
        if (cp > 0) await actor.inventory.addCoins(toCoins(cp));
      }

      if (lines.length) {
        const total = [...payouts.values()].reduce((s, v) => s + v, 0);
        await ChatMessage.create({
          content: `
            <h3>Sold</h3>
            <ul style="margin:.2rem 0 .4rem 1rem;padding:0;">
              ${lines.map((l) => `<li>${esc(l)}</li>`).join("")}
            </ul>
            <p><b>Total: ${esc(fmt(total))}</b> paid to
               ${esc([...payouts.keys()].map((a) => a.name).join(", "))}</p>`,
          whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
        });
        ui.notifications.info(
          `Sold ${lines.length} entr${lines.length === 1 ? "y" : "ies"}`);
      }
    } catch (e) {
      console.error("PF2e RA Smuggler", e);
      ui.notifications.error("Items were sold but paying out failed — see the console");
    } finally {
      if (failed) ui.notifications.error(
        `${failed} entr${failed === 1 ? "y" : "ies"} could not be sold — see the console`);
      for (const uuid of sold) cart.delete(uuid);
      refresh();
      busy = false;
      sellBtn.disabled = false;
    }
  });
})();
