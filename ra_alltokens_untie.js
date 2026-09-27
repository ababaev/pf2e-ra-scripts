/*
 * PF2e RA All Tokens Untie — unlink the scene's tokens from their actors
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
 *   Unlinks every token on the current scene from its actor, except the
 *   ones controlled by players (heroes, companions, minions, eidolons,
 *   familiars and so on). After this each monster token keeps its own HP
 *   and conditions, so several copies of one actor can be fought without
 *   sharing damage, and the actor in the sidebar is left untouched.
 *
 *   "Controlled by players" means the actor has at least one player owner.
 *   Tokens that are already unlinked are left alone.
 *
 * REQUIREMENTS
 *   Foundry VTT v13 or later. Macro type: script. GM permission.
 */

(async () => {
  if (!canvas.scene) return ui.notifications.warn("No active scene");

  const tokens  = canvas.scene.tokens;
  const players = tokens.filter((t) => t.actor?.hasPlayerOwner);
  const updates = tokens
    .filter((t) => t.actorLink && !t.actor?.hasPlayerOwner)
    .map((t) => ({ _id: t.id, actorLink: false }));

  if (updates.length)
    await canvas.scene.updateEmbeddedDocuments("Token", updates);

  ui.notifications.info(
    `Unlinked ${updates.length} token${updates.length === 1 ? "" : "s"}. `
    + `Skipped ${players.length} player-controlled. Total on scene: ${tokens.size}`);
})();
