# pf2e-ra-scripts

Collection of scripts I use as a GameMaster.
Verified for foundry v14.363-368

## ra_smuggler

Simply sells items without a requirement to create a trader. Treasures are sold for the full price, other items for the half.
Allows to do it in batches.

## ra_item_mystification

A script with an interface to mystify items when a player had failed identification critically. Just drop the item to the script's opened window, and it will suggest similar items (potions, elixirs, oils and etc) of similar price to mystify. It will replace all the descriptions and etc in the mystification tab properly.
Can be done on the fly during the game.

## ra_incantation

Was inspired by a player, Daniil, who used to rephrase each spell in latin language, so that his character had actually pronounced a spell (if it was not subtle) while casting it.
In the opened window you can throw a spell of your NPC, and it will suggest a phrase in english (usually a name and a casting tradition).
The phrase in English can be modified, so that your spells can become unique.
Then it will translate it using API of a free translator, and then apply it to the description of the spell.
So when your NPC is casting a spell, you can actually describe, how is it happening.
Instead of "I am casting Stupify!" you can say "Occultas retusa mens tua est"

## ra_alltokens_untie and ra_alltoken_restore

Usually after players went over the scene, there are dead tokens of their enemies without items, pillaged stashes and treasures. And sometimes scenes contain some work (for example, from https://github.com/ababaev/pf2e-foundry-exploration-automation), so you would prefer to reuse them.

Those simple scripts allow:
- to unties all the tokens from their actors on a map, except tokens of players, eidolons, familiars and companions. So modification of a token doesn't modify the actor.
- to restore a state of untied tokens using the state of his actor. Which in one click restores all the treasures and all the items in the pockets of killed NPCs, also restores the state of those NPCs.
