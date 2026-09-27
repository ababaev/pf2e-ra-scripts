/*
 * PF2e RA All Tokens Restore — reset every unlinked token on the scene
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
 *   Resets every unlinked token on the current scene to its base actor:
 *   HP, conditions, effects, spent resources and any other per-token
 *   changes are thrown away. Linked tokens (heroes, anything tied to a
 *   real actor) are not touched. Asks for confirmation first, since this
 *   cannot be undone.
 *
 *   Typical use: re-running an encounter, or cleaning up a scene after
 *   ra_alltokens_untie.js and a fight.
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later (uses DialogV2). Macro type: script.
 *   GM permission.
 */

(async () => {
  if (!canvas.scene) return ui.notifications.warn("No active scene");

  const unlinked = canvas.scene.tokens.filter((t) => !t.actorLink && t.delta);
  if (!unlinked.length)
    return ui.notifications.info("No unlinked tokens on this scene");

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Restore all tokens" },
    content: `<p>Reset ${unlinked.length} unlinked token${
      unlinked.length === 1 ? "" : "s"} to their base actors?</p>
      <p>HP, conditions and effects on these tokens will be lost.</p>`
  });
  if (!ok) return;

  let restored = 0;
  const failed = [];

  for (const doc of unlinked) {
    try {
      await doc.delta.restore();
      restored++;
    } catch (err) {
      failed.push(doc.name);
      console.error(`PF2e RA All Tokens Restore — failed on "${doc.name}"`, err);
    }
  }

  const msg = `Restored ${restored} of ${unlinked.length} unlinked tokens`
    + (failed.length ? `. Failed: ${failed.join(", ")}` : "");
  if (failed.length) ui.notifications.warn(msg);
  else ui.notifications.info(msg);
})();
