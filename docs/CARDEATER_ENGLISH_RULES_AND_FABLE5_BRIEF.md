# CardEater Classic — Rules, Design Model, and Fable5 Card-Design Brief

> Archive notice (v0.17): this document records the 62-card pre-review baseline supplied to Fable5. The accepted 27-card response is now implemented, so the live pool contains 89 cards. For the current full-art regeneration manifest, use [`CARD_ART_SPRITESHEET_PROMPTS_V0.17.md`](./CARD_ART_SPRITESHEET_PROMPTS_V0.17.md).

Status: source-aligned design brief for the current Classic prototype  
Last updated: 2026-07-23  
Primary source of truth: `js/config.js`, `js/data.js`, `js/engine.js`, `js/plate.js`, `js/reshuffle.js`, `js/rules.js`, `js/items.js`, and `js/shop.js`

## 1. High concept

CardEater Classic is a 15-round, mobile-first deck-building roguelite played by resolving one card at a time from a plate.

### Runtime mode addendum (v0.18)

- **Normal mode** keeps the 15-round structure and the cumulative checkpoints at rounds 5 / 10 / 15: 100 / 300 / 500 score.
- The first locally recorded victory permanently unlocks **Endless mode** and **Hard mode** in that browser.
- **Endless mode** is identical to Normal through the 500-point gate. After passing that gate it continues from round 16 with no further cumulative score checkpoints.
- **Hard mode** keeps the Normal checkpoints and adds a mandatory three-choice dangerous quest at rounds 4, 8, and 12. The chosen penalty applies immediately, the requirement is evaluated only in that round, and success grants an advanced item at the start of the next round.
- Every mode grants one bankable free card removal after each five completed rounds.
- A shop can be locked so its remaining card and item offers carry into the next shop instead of being rerolled.
- The in-game menu stores separate music and sound-effect toggles plus small / medium / large UI text settings, and exposes a full 89-card compendium.

The player has three verbs:

1. **Eat** the current card.
2. **Discard** the current card.
3. **Postpone** the current card to the end of this plate without resolving it.

The permanent deck survives between rounds. Only a number of cards up to the permanent plate capacity appear in a round. After each successful round, the player enters a shop and must choose how to spend limited gold among cards, plate capacity, items, rerolls, and card removal.

The intended emotional arc is:

- Early game: read food affinity, establish a small engine, and avoid fatal purchases.
- Mid game: choose an archetype and decide whether capacity is worth more than another card.
- Late game: convert stored growth, combos, generated cards, and carefully arranged order into explosive rounds.

The game must reward planning without becoming an automatic spreadsheet. A good turn should contain a visible dilemma between immediate score, future score, economy, and card order.

## 2. Run structure and victory conditions

- A Normal or Hard run lasts at most **15 rounds**; Endless continues after passing the round-15 gate.
- Cumulative score checkpoints are:
  - End of round 5: at least **100** total score.
  - End of round 10: at least **300** total score.
  - End of round 15: at least **500** total score.
- Missing a checkpoint immediately ends the run in defeat.
- Passing the round-15 checkpoint ends a Normal or Hard run in victory; Endless continues without further score gates.
- There is no permanent metagame power progression in the current design.

The per-round loop is:

1. Draft one persistent contract if the player does not already have one.
2. Shuffle the permanent deck.
3. Randomly place up to the plate-capacity limit onto the plate.
4. Resolve every plate card through Eat, Discard, or Postpone.
5. Automatically spend any available reshuffle charges when the plate becomes empty.
6. Calculate round score, contract gold, speed gold, and card-generated gold.
7. Check a milestone if the round is 5, 10, or 15.
8. If still alive, enter the shop.

## 3. Core numerical model

### 3.1 Printed sides

Every card has an Eat value and a Discard value.

- **Edible baseline:** Eat is usually `+1` or `+2`; Discard is usually `-1`.
- **Inedible baseline:** Eat is usually `-1` or `-2`; Discard is usually `+1` or `+2`.
- A normal common fast-food card should not exceed `+2` Eat.
- A printed positive value above `+2` is already large and should require at least one of:
  - higher rarity;
  - a permanent downside;
  - a gold payment;
  - self-destruction;
  - setup requirements;
  - meaningful future opportunity cost.

Choosing the side that contradicts affinity is called a **Wrong-Affinity Action** or **Hard Eat**. It is not forbidden. It normally uses the worse printed side, but dedicated cards and items can convert this loss into an archetype.

### 3.2 Card-action score

The current engine computes an action approximately as:

```text
Action Score =
  (Printed Side
   + Contract/Card Rule Additions
   + Existing Buff Additions
   + Item Additions
   + Legacy Quest Modifier)
  × Existing Buff Multipliers
  + Immediate Effect Bonus
```

New buffs created by a card affect future cards, not the card that created them, unless the effect explicitly grants an immediate bonus.

Round card score is the sum of resolved action scores. Final multipliers from eligible items are then multiplied together. Current contracts do not grant score multipliers.

### 3.3 Gold

- The first time each physical card instance is eaten in a round, it grants **+1 base gold**.
- Reshuffling and eating the same physical instance again does not grant that base gold twice.
- Finishing within 12 seconds grants **+1 gold**.
- Finishing within 8 seconds grants another **+1 gold**, for +2 total speed gold.
- Contracts and card/item effects may add gold.
- Eating is therefore the default economic action, while discarding is usually the safer scoring action for inedible cards.

This creates the intended base tension: correct eating supports economy; correct discarding supports score; wrong-affinity builds deliberately violate that rule for specialized payoffs.

## 4. Plate, reserve, and deck size

- Initial plate capacity: **10**.
- Maximum permanent deck size: **160**.
- Maximum plate capacity: **160**.
- Cards drawn each round: `min(permanent deck size, plate capacity)`.
- Cards beyond capacity remain in the reserve and do not appear that round.
- The permanent deck is reshuffled and the plate subset is rerandomized every round.

The plate is the primary large-deck balancing mechanism. A larger deck offers breadth and redundancy, but buying more cards does not increase the number of actions unless the player also invests in plate capacity.

Capacity upgrade base cost after `n` previous upgrades is:

```text
2 + n(n + 1) / 2
```

The resulting early sequence is `2, 3, 5, 8, 12, ...`, before item discounts.

## 5. Postpone: exact current behavior

**Postpone** moves the current card to the final position of the current plate.

- The base action grants no score, but an armed card effect may reward it.
- It grants no gold.
- It consumes no action.
- It is available whenever at least two cards remain.
- Each physical card can be Postponed at most once per round.
- The per-card marker survives automatic reshuffles in the same round.
- Left/right swiping previews the next card while committing Postpone; a button offers the same action.
- Cards can remember that they were postponed and reward later resolution.
- Courier and Sorting Tray can alter or reward a later Postpone.

Implementation-wise, the current card is the last element of the draw-pile array. Postpone removes that element and inserts it at the beginning, which is the final resolution position.

### 5.1 Implemented control against deterministic sorting

The previous unlimited form acted as a rotation operation and allowed the player to sort nearly any remaining order. The current physical-card limit preserves tactical rotation while preventing one card from being cycled repeatedly. A reshuffle does not reset the limit.

Elapsed real time remains an additional opportunity cost because excessive sorting may lose up to 2 speed gold. That cost disappears or weakens when:

- the player no longer values 1–2 gold;
- Pluto freezes the timer while preserving speed rewards;
- an engine's order payoff exceeds the small speed reward.

The former “use Postpone 2 times” and “use Postpone 5 times” contracts were removed. Their replacements require one or two actual Postpone-linked card-effect triggers, so meaningless rotation cannot complete them.

## 6. Automatic reshuffle

- Reshuffle is not a permanent player resource.
- Cards and items can grant one or more reshuffle charges for the current round.
- Charges stack.
- When the plate becomes empty, the game automatically and seamlessly spends a charge if reshuffling is legal.
- It returns already resolved physical cards that still exist in the permanent deck to the draw pile.
- Destroyed cards cannot return.
- Automatic reshuffle is currently legal only while permanent deck size is **10 or less**.
- There is no manual reshuffle button.

Reshuffle allows a compact deck to replay a dense engine. It should not become a universal multiplier or a rule condition that can be impossible to execute.

## 7. Persistent contracts

- The player may hold exactly one active contract.
- When no contract is active, three eligible contracts are offered.
- Eligibility considers current round, deck contents, target types, and required keywords.
- A failed contract has no direct punishment and persists into later rounds.
- A completed contract grants its gold once, is marked complete, and disappears.
- A new contract is drafted on a later round after the previous one has been completed.
- Contracts grant gold, not score multipliers and not permanent card stats.

Current contract families include correct sorting, no negative actions, Eat/Discard counts, alternating actions, fruit combo, type-specific actions, Postpone-effect triggers, Destroy/Generate/Grow events, unique types, first/last action patterns, wrong-affinity actions, and raw round-card score.

The old dangerous-task system and its Void-card punishment are disabled.

## 8. Shop and economy

Every shop offers:

- 3 weighted random cards;
- 3 cards from one shared category in a themed shelf;
- 2 low-tier items;
- one permanent plate-capacity upgrade;
- paid card removal;
- a paid full-shop reroll.

Card base prices:

| Rarity | Base price | Base shop weight | Intended baseline | Synergy ceiling |
|---|---:|---:|---:|---:|
| Common | 5 | 58 | 1 | 3 |
| Uncommon | 8 | 27 | 2 | 7 |
| Rare | 12 | 12 | 3 | 16 |
| Legendary | 18 | 3 | 1 | 40 |

Other rules:

- Rare cards are strongly suppressed before round 3.
- Legendary cards cannot appear before round 8.
- Rerolls cost `2, 3, 4, ...` within a shop, unless a free-reroll effect applies.
- Buying a card does not automatically refill its slot.
- The first removal costs 0; later removals cost `3, 6, 9, ...`.
- Removing a card never grants a refund or a score reward.
- Cards and items may lower prices, but card price cannot fall below 1.

The central economic decision is **buy a card vs. buy capacity vs. remove a card**. New economy cards must not dominate all three branches at once.

## 9. Keywords in English

| Keyword | Exact meaning |
|---|---|
| Destroy | Permanently remove the specified physical card from the run deck. |
| Adjacent | Read the original neighboring card or cards specified by the effect. |
| Growth | Permanently change the written Eat or Discard value of that physical card. |
| Generate | Add a new physical card to the permanent deck, subject to limits. |
| Reshuffle | Return eligible resolved cards to the current round's draw pile. |
| Purify | Restore only red reductions below original values; preserve green growth. |
| History | Read already completed actions or scores without retriggering them. |
| Primed | Store a bonus for a later matching card; nonmatching cards do not consume it. |
| Position | Check an explicitly defined place in the action order. Prefer first, last, or adjacency over arbitrary numbered slots. |
| Scale | Calculate from permanent deck size, category count, name count, or reserve. |
| Copy | Copy a score value, never the copied card's effect. |
| Economy | Change gold, prices, reroll cost, or plate-upgrade cost. |
| Store | Keep a value on a physical card across rounds until its cash-out resets it. |
| Forecast | Read unresolved cards without resolving or triggering them. |
| Fruit Combo | Consecutive eaten Fruits raise the combo; eating a non-Fruit or discarding breaks it. |
| Appetite Loss | Each time this Fast Food is eaten, permanently lower Eat and raise Discard as written. |
| Retain | Discarding this Dessert permanently raises its Eat value until a threshold cash-out resets it. |
| Weakened | A generated card destroys itself after either Eat or Discard resolution. |
| Postpone | Move the current card to the end of this plate without resolving it or spending an action. |
| Mechanism | Directly alter order, timer, reshuffle, or unresolved printed sides. |
| Hard Eat | Deliberately use the wrong-affinity side and build around the loss or special payoff. |

All card text must use one canonical term. In particular, remove, consume, clear away, swallow, and exhaust must not be used as synonyms for **Destroy** when permanent removal is meant.

## 10. Archetype design

### Fruit — sequencing and visible combo

- Fruit wants consecutive Eat actions.
- Each combo Fruit advances Fruit Combo and usually has a second identity-defining effect.
- Generation helps the deck reach critical Fruit density.
- Postpone can move non-Fruits out of the current chain.
- Fruit should feel immediately readable, then become explosive through sequencing rather than raw printed stats.

### Fast Food — front-loaded value and conversion

- Fast Food starts with strong Eat values.
- Appetite Loss converts repeated eating into lower Eat and higher Discard.
- The player should decide when a card has “changed sides.”
- Larger printed values require payment, self-destruction, or stronger permanent deterioration.

### Dessert — deferred investment and cash-out

- Discarding Retain cards grows their Eat side across rounds.
- Threshold eating multiplies score and then resets the card.
- Dessert is slow, economically fragile, and capable of a large planned burst.
- The delay must be short enough to matter before the next milestone.

### Drink — one-shot tempo and economy

- Most Drinks destroy themselves after activation.
- They grant immediate gold, future typed buffs, purification, generation, or reshuffle.
- Generated cards and self-destruction should form a loop rather than unbounded deck inflation.
- Weakened is the preferred safety valve for temporary generated value.

### Animal — ecosystem, generation, and consumption

- Animals interact with cards inside and outside their own category.
- They may Destroy a previous card, grow from prey, or generate Fruits/Animals.
- Rabbit is a current successful simple build-around: its Discard payoff scales with Rabbit count.
- Not every Animal needs a complex effect; readable ecosystem anchors are useful.

### Celestial — rule-changing cards

- Celestials alter core mechanisms rather than only adding numbers.
- Current axes include swapping remaining sides, automatic reshuffle, timer freeze, mass discard, random generation, Hard Eat history, and Postpone payoff.
- These effects need especially strict exploit analysis because they can bypass normal costs.

### Person — cross-archetype bridges

- People connect categories and convert history into score, gold, or generated cards.
- A Person should make two otherwise separate mechanics worth combining.
- Avoid “same trigger, different category” templates unless the payoff changes the decision itself.

### Utility — repair and alternative rules

- Utility includes Purify, stat transfer, shop discounts, and Hard Eat support.
- Purify restores red reductions but never erases green growth.
- Utility should create a build decision, not become an always-correct generic purchase.

## 11. Current starter deck

The seven-card starter deck contains four edible and three inedible cards:

| Card | Affinity | Eat / Discard | Teaching purpose |
|---|---|---:|---|
| Banana | Edible | +1 / -1 | Fruit Combo and generation threshold |
| Watermelon | Edible | +2 / -1 | Fruit Combo payoff |
| Hamburger | Edible | +2 / -1 | Blank fast-food baseline |
| Doughnut | Edible | +2 / -1 | Retain growth and threshold cash-out |
| Orange Cat | Inedible | -1 / +2 | Blank inedible baseline |
| Turtle | Inedible | -1 / +2 | Blank inedible baseline |
| Rabbit | Inedible | -1 / +1 | Simple deck-count build-around |

Flavor-only cards should not display fake rules text. A few blank cards are intentional onboarding tools; the wider pool should not be dominated by blanks.

## 12. Current 62-card catalogue

This catalogue exists to prevent proposed cards from duplicating existing decision patterns. Values are Eat / Discard.

### Fruit

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| F001 | Apple | Common | +1 / -1 | Blank Fruit baseline. |
| F002 | Banana | Common | +1 / -1 | Combo +1; at combo 3, once per round generate an Apple. |
| F003 | Watermelon | Rare | +2 / -1 | Combo +1; at combo 3 gain +3. |
| F004 | Strawberry | Uncommon | +1 / -1 | Combo +2; gains current combo as score, capped at +8. |
| F005 | Golden Apple | Common | +2 / -1 | Combo +1; at combo 4 permanently gains +1 Eat. |
| F006 | Rotten Apple | Uncommon | -1 / -2 | Combo +1; opening it at zero combo grants +4. |
| F007 | Fruit Platter | Rare | +2 / -1 | Combo +2; at combo 4 generate one random Weakened Fruit once per round. |
| F008 | Dragon Fruit | Legendary | +3 / -2 | Combo +1; at combo 5 doubles Fruit Combo bonus. |
| F009 | Pear | Common | +1 / -1 | Combo +1 without receiving combo score. |
| F010 | Candied Plum | Uncommon | +1 / -1 | Combo +1; once per round, after a broken combo, resume from the round's best combo, capped at 5 before this card's gain. |
| F011 | Dried Persimmon | Uncommon | 0 / -1 | Eat gains the number of Fruits eaten earlier this round, capped at +4. |
| F012 | Pomegranate | Rare | +2 / -1 | Eat destroys itself; two full-effect Pears enter the permanent deck for the next round. |
| F013 | Cape Gooseberry | Common | +1 / -1 | Eat gains 1 gold. |

### Fast Food

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| K001 | Hamburger | Common | +2 / -1 | Blank Fast Food baseline. |
| K002 | Ramen | Common | +2 / -1 | After Eat: permanently Eat -1, Discard +1. |
| K003 | Fries | Uncommon | +3 / -1 | Pay 1 gold to Eat; then Appetite Loss -1/+1; unpaid cost becomes -3 score. |
| K004 | Mega Burger | Rare | +4 / -2 | After Eat: permanently Eat -2, Discard +2. |
| K005 | Spoiled Takeout | Uncommon | +3 / -2 | Scores its Eat value, then destroys itself. |
| K006 | Coin-Operated Chicken Bucket | Uncommon | +4 / -2 | Pay 2 gold; Appetite Loss -1/+2; each unpaid gold costs 3 score. |
| K007 | Spicy Wings | Rare | +3 / -1 | Appetite Loss -1/+1; primes the next Drink for +2 Eat. |
| K008 | Sandwich | Common | +2 / -1 | Blank Fast Food baseline. |

### Dessert

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| D001 | Doughnut | Common | +2 / -1 | Discard: permanent Eat +2; at 10+, Eat doubles and resets. |
| D002 | Strawberry Cake | Uncommon | +3 / -1 | Retain +3, or +5 after a Fruit; 10+ Eat doubles and resets. |
| D003 | Caramel Pudding | Common | +2 / -1 | Retain +1, or +3 if Postponed this round; 10+ Eat doubles and resets. |
| D004 | Ice Cream | Uncommon | +1 / -1 | Retain +4 up to 12; 10+ Eat doubles and resets. |
| D005 | Candy | Common | +1 / -1 | Retain +2; at 8+, Eat doubles, gives +1 gold, and resets. |
| D006 | Wedding Cake | Legendary | +2 / -2 | Retain +5; at 12+, Eat triples and resets. |
| D007 | Sandwich Cookie | Rare | +2 / -1 | Retain +2; at 10+, Eat doubles, shop card price -1, then resets. |

### Drink

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| B001 | Water | Common | +1 / -1 | Eat and self-Destroy; Purify the deck's red stat losses. |
| B002 | Soda | Common | +1 / -1 | Eat and self-Destroy; next matching Fast Food Eat score ×2. |
| B003 | Black Coffee | Uncommon | +1 / -1 | Eat and self-Destroy; next card +4. |
| B004 | Fresh Juice | Uncommon | +1 / -1 | Eat and self-Destroy; generate a random Weakened Fruit. |
| B005 | Energy Drink | Rare | +1 / -1 | Eat and self-Destroy; gain one automatic reshuffle charge. |
| B006 | Milk | Common | +1 / -1 | Eat and self-Destroy; next matching Dessert score ×2. |
| B007 | Deposit Bottle | Common | -2 / -2 | First Discard each round: take -2 score and gain 2 gold immediately. |
| B008 | Bitter Supplement | Uncommon | +1 / -2 | Wrong-affinity Discard destroys it and primes the next wrong-affinity action for +4. |
| B009 | Herbal Tea | Uncommon | +1 / -1 | Eat and self-Destroy; Discards no longer break Fruit Combo this round, while eating a non-Fruit still does. |

### Animal

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| A001 | Orange Cat | Common | -1 / +2 | Blank inedible baseline. |
| A002 | Hungry Dog | Common | -2 / +2 | Discard: destroy previous edible card and permanently gain 1–2 Discard. |
| A003 | Tired Monkey | Uncommon | -2 / +3 | First Discard: generate Weakened Banana, permanently lose 1 Discard, self-Destroy at zero. |
| A004 | Rabbit | Common | -1 / +1 | Discard gains +1 for every Rabbit in the permanent deck, capped at +12. |
| A005 | Taotie | Legendary | -3 / +3 | Discard: destroy previous card and gain 1–4 permanent Discard from its larger absolute side. |
| A006 | Shedding Snake | Rare | -2 / +2 | First Discard: drain 1 permanent Eat from another edible card and gain 1 permanent Discard. |
| A007 | Fox | Uncommon | -2 / +2 | First Discard: generate a random Weakened Fruit. |
| A008 | Turtle | Common | -1 / +2 | Blank inedible baseline. |
| A009 | Grooming Cat | Common | -1 / +2 | If Postponed this round, Discard Purifies one random tied instance of the deck's largest red reduction. |

### Celestial

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| C001 | Star | Common | -2 / +2 | First Discard: generate a random Weakened card. |
| C002 | Moon | Uncommon | -2 / +2 | Discard: swap Eat and Discard values of all remaining plate cards this round. |
| C003 | Sun | Rare | -2 / +2 | Discard, self-Destroy, and gain one automatic reshuffle charge. |
| C004 | Comet | Common | -2 / +2 | If Postponed this round, later Discard gains +6. |
| C005 | Meteor | Rare | -3 / +4 | Discard and immediately discard/resolve all remaining plate cards. |
| C006 | Pluto | Legendary | -2 / +2 | Discard: freeze the timer for the rest of the round while preserving speed rewards. |
| C007 | Black-Hole Stomach | Rare | -3 / +2 | Wrong-affinity Eat gains +2 per prior wrong-affinity action, capped at +12. |

### Person

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| P001 | Fruit Merchant | Common | -2 / +2 | First Discard: +1 settlement gold per Fruit eaten earlier, capped at +8. |
| P002 | Debt Broker | Uncommon | -2 / -3 | First Discard: take -3 score and immediately gain 3 gold. |
| P003 | Animal Keeper | Uncommon | -2 / +2 | Discard gains +2 per Animal discarded earlier this round, capped at +8. |
| P004 | Astronomer | Rare | -2 / +2 | First Discard: generate a random Weakened Celestial. |
| P005 | Magician | Rare | -2 / +2 | First Discard: generate a Weakened Rabbit. |
| P006 | Food Challenger | Uncommon | -2 / +2 | Wrong-affinity Eat gains streak ×2, capped at +8; correct affinity breaks streak. |
| P007 | Delivery Courier | Common | -1 / +1 | Discard: the next Postpone pulls the plate's final card into the current position instead of sending the current card to the final position. |

### Utility

| ID | Card | Rarity | Values | Core identity |
|---|---|---|---:|---|
| U001 | Purifier | Common | -2 / +2 | Discard: restore all red stat reductions while preserving green growth. |
| U002 | Score Juicer | Rare | -2 / +2 | First Discard: drain 1 Eat from each Fruit and gain the actual drained total as permanent Discard, capped at +4. |
| U003 | Discount Coupon | Common | -2 / +2 | First Discard: next shop's card prices -1, minimum 1. |
| U004 | Iron-Stomach Badge | Common | -1 / +2 | Wrong-affinity Eat gains +3. |
| U005 | Sorting Tray | Uncommon | -1 / +1 | Discard: the next two Postpones this round each grant +1 score, capped at +2. |

## 13. Onboarding and feedback requirements

The current onboarding is a replayable first-run story tutorial led by **Crunch**, a living card presented through a pixel dialogue box. A new player may skip it, and an experienced player may replay it from the top bar.

The guide does not replace play with a slideshow. It watches and acknowledges real game actions:

1. Select a persistent contract.
2. Correctly Eat one edible card.
3. Postpone one card to change the plate order without resolving it.
4. Correctly Discard one inedible card.
5. Understand that Fruit Combo and Postpone can interact.

Card designs must support legible feedback. A triggered effect should tell the player what changed, why it changed, and whether the change is temporary, permanent, stored, or consumed. Permanent point increases use green values; permanent reductions use red values; unchanged values remain neutral white. Fruit Combo, Hard Eat, Destroy, Generate, Growth, economy changes, and automatic Reshuffle each require a distinguishable presentation cue.

New cards should not increase onboarding burden without adding a meaningful decision. If a card introduces a new state that cannot be understood from the card text and one concise effect cue, identify the additional tutorial or interface requirement explicitly.

## 14. Qualitative playtest evidence from two external testers

This section summarizes two short player conversations supplied on 2026-07-23. It is **directional qualitative evidence, not statistical proof**. The sample is only two players, their play exposure was uneven, and at least one tester had tried only Fruit and Animal builds. Fable5 must separate observed player perception from inferred system causes.

### 14.1 Shared signals

- Both testers recognized that the newer design makes archetype building more direct.
- Both focused on Postpone as the change with the greatest effect on play.
- Greater control and more direct mechanical feedback can feel satisfying, but both conversations raised concern that uncertainty, trade-offs, or adaptation may have decreased.
- The game appears promising rather than fundamentally broken. One tester described it as good, full of potential, and reminiscent of Balatro.
- Neither conversation supports adding broad permanent progression as a quick retention fix. The immediate problem is the quality and variety of decisions inside a run.

### 14.2 Tester A: clarity improved, construction still feels shallow

- The opening felt somewhat too simple, although the tester understood that later difficulty could increase.
- The tester believed repeated Postpone could arrange the order almost arbitrarily. This made order manipulation feel cumbersome rather than like satisfying mastery.
- The tester asked whether any effects trigger after Postpone and reported not encountering such an effect across roughly three runs. This is a discoverability and availability warning: a mechanic may exist in the data but still be functionally invisible to players.
- Build identity felt weak because the tester perceived that they could usually add only one card per round. This is a perceived acquisition-cadence problem, not a literal one-card purchase limit.
- Lower card prices were suggested as a way to create more shop choices. However, the same tester also noted that buying matching-archetype cards was already enough to clear the game easily. Price reduction alone could therefore make solved mono-type drafting even stronger.
- The Animal Keeper was cited as a representative problem: many easy Animal picks make the payoff scale, so the player can keep drafting Animals until a payoff arrives and end the search. The concern is not merely its number; it is a low-friction setup-to-payoff path with few competing incentives.
- The tester suggested stricter or more discriminating synergy requirements, more genuinely different branches within each category, or a lower density of interchangeable same-type enablers.
- Overall judgment was positive: the game was described as enjoyable and promising, but Postpone remained awkward and the desired correction was unclear.

### 14.3 Tester B: stronger feedback, weaker deliberation

- The tester initially felt that the new version was not dramatically different from the previous version.
- The main perceived change was that construction became more direct and individual effects became more pronounced.
- Postpone was considered more influential than before.
- The tester felt the game had somewhat less strategic bargaining or trade-off. Their choices produced clearer immediate feedback and were slightly more satisfying, but felt more like reacting to or regretting a committed choice than planning among competing futures.
- The tester did not reject the project, but recommended more repeated design-and-play cycles before drawing conclusions. The useful signal is that better feedback alone did not create a stronger sense of long-term decision depth.

### 14.4 Design hypotheses to test, not conclusions to assume

1. **Unlimited Postpone may convert order from a random constraint into deterministic labor.** The result can be more control but less adaptation, with extra swipes acting as friction rather than strategy.
2. **Archetype labels may currently solve drafting too early.** If “buy every card of my category” is usually correct, categories provide direction but not meaningful branching.
3. **Build cadence may feel slow while build completion is still too easy.** These are not contradictory: the player may buy few cards, yet every affordable matching card may be an obvious upgrade.
4. **Postpone-payoff density or presentation may be too low.** A player can use Postpone repeatedly without learning why a specific card wants to be Postponed.
5. **Direct effect feedback may have improved faster than decision depth.** Presentation should be preserved while the underlying choices gain competing costs and alternate lines.
6. **Simple global price cuts are risky.** They may improve shopping activity but worsen mono-type autopilot and reduce the value of capacity and removal decisions.

Any recommendation based on this feedback must state a competing explanation and a playtest that could falsify it.

## 15. Non-negotiable card-design rules

1. Do not create numerical reskins of existing cards.
2. A new card must change a decision axis: order, timing, information, economy, deck composition, permanence, reserve, generated-card lifecycle, or side selection.
3. State every amount, cap, duration, reset rule, target, and timing window explicitly.
4. Use canonical keywords. Permanent removal is always **Destroy**.
5. “The next matching card” remains stored until a matching card resolves; nonmatching cards do not erase it.
6. Generated value needs a sink. Prefer Weakened cards, self-Destruction, conversion, or a meaningful stat/payment cost.
7. Long-term investments must become relevant before the next checkpoint under realistic play.
8. Common cards should be readable. Complexity belongs in rarity, but rarity alone does not excuse unusable text.
9. Economy must trade away score, time, permanence, or consistency. Never make a card that strictly dominates both score and gold alternatives.
10. Position design should prefer adjacency, first/last, unresolved reserve, or Postpone history. Avoid arbitrary “exactly the third/fifth/seventh card” checks.
11. A card may support more than one archetype, but it must have one clear primary job.
12. Every proposed payoff must name its setup cost and its fail state.

## 16. Archived questions answered by the Fable5 review

This section records the questions that produced the current experimental rule. It is historical input, not a description of the live baseline. The implemented answer is one Postpone per physical card per round, preserved through reshuffles, plus replacement of raw-count contracts with Postpone-effect contracts.

1. Prove or disprove that unlimited rotation lets the player realize any desired resolution permutation of the remaining plate.
2. Does next-card preview create meaningful uncertainty, or does repeated free preview merely add input friction before deterministic sorting?
3. Is losing at most 1–2 speed gold a sufficient cost for full sequence control in early, mid, and late game?
4. How do Pluto, automatic reshuffle, Fruit Combo, Retain, Comet, and Postpone-count contracts change the answer?
5. Does full order control improve build expression, or does it erase adaptation and make every successful deck play identically each round?
6. If a constraint is needed, compare at least these options:
   - limited Postpones per round;
   - increasing gold or score cost;
   - one Postpone per physical card per round;
   - Postpone adds a temporary downside to the moved card;
   - partial rather than exact next-card information;
   - a bounded “hand” or staging area;
   - keep unlimited Postpone but remove Postpone-count contracts and strengthen time pressure.
7. Recommend the smallest rule change that preserves tactile agency. Do not stack several restrictions unless evidence shows one rule is insufficient.

## 17. Archived copy-paste prompt used for the completed Fable5 review

```text
You are a senior roguelite card-game designer and systems mathematician. You are designing cards for CardEater Classic, not a cooking game and not a combat game.

Read the attached document in full. Treat every numeric rule, timing rule, keyword definition, current-card entry, and non-negotiable constraint as binding unless your audit explicitly identifies a problem.

Your tasks:

1. Audit the current game's decision structure. Explain what the player is trying to optimize in the early game, mid game, and late game. Identify repeated effects, solved decisions, missing bridge cards, weak archetype entry points, and economy traps. Explicitly test whether category labels currently make “buy every matching card” an automatic strategy.

2. Perform a formal Postpone analysis. The action moves the current card to the end of the plate, costs no action, has no usage limit, and repeated side swipes reveal the next card. Determine whether this makes the remaining resolution order effectively arbitrary. Discuss the interaction with the 8/12-second speed-gold rule, Pluto's timer freeze, automatic reshuffle, Fruit Combo, Retain, Comet, and Postpone-count contracts. Recommend one minimal rule, or recommend no change, with explicit reasoning and exploit examples.

3. Analyze the two-tester qualitative evidence in Section 14. Do not vote-count opinions or treat them as proven causes. Build an evidence matrix with: player observation, likely design risk, at least one competing explanation, confidence level, telemetry or playtest needed, and a falsifiable success criterion. Address all of these tensions:
   - direct feedback versus long-term deliberation;
   - order control versus deterministic sorting labor;
   - slow perceived acquisition versus easy mono-type completion;
   - visible Postpone action versus invisible Postpone payoff;
   - cheaper cards versus preservation of buy/capacity/remove trade-offs.

4. Design 32 candidate cards: exactly 4 for each of the eight categories (Fruit, Fast Food, Dessert, Drink, Animal, Celestial, Person, Utility). Then select the strongest 16 for implementation.

5. Every candidate must use a genuinely different decision dimension, not the same trigger with different numbers or category labels. Explore underused dimensions such as reserve composition, physical-card identity, temporary side locking, controlled generation sinks, timing versus speed gold, risk that persists until a matching target, deck dilution, card aging, delayed purification, shop opportunity cost, and information gained through Postpone. Each category must contain at least two incompatible internal branches so that category identity guides drafting without making every same-category purchase automatic.

6. Obey the numeric model:
   - ordinary edible commons usually Eat for +1 or +2 and Discard for -1;
   - ordinary inedible commons usually Eat for -1 or -2 and Discard for +1 or +2;
   - printed positive values above +2 require rarity and/or a real downside;
   - economy must trade score, time, permanence, or consistency;
   - investments must matter before the next score checkpoint;
   - generated cards require a lifecycle or sink;
   - all amounts, caps, timing, targets, and reset behavior must be explicit.

7. Do not duplicate any of the 62 current cards. Do not use arbitrary exact-numbered positions such as “the fifth card.” Prefer first, last, adjacency, reserve, Postpone history, or matching-card delayed triggers. Permanent removal must always use the keyword Destroy.

8. Do not recommend a global card-price reduction without modeling how it changes expected purchases per shop, plate-capacity upgrades, card removal, rerolls, and mono-type consistency. If acquisition cadence is changed, propose at least one alternative to price cuts and identify what data would choose between them.

9. Treat discoverability as part of balance. A Postpone payoff that exists but is not seen across several runs cannot teach the mechanic. For every Postpone-related proposal, specify expected appearance timing, how the player recognizes the payoff before buying, and whether it creates an actual choice rather than rewarding free repeated rotation.

For each candidate, output:

- English name
- Category
- Rarity
- Affinity
- Printed Eat / Discard values
- Canonical keywords
- Exact rules text
- Primary archetype and optional bridge archetype
- Setup cost
- Payoff
- Fail state
- Earliest realistic payoff round
- Expected early/mid/late score contribution
- Expected gold contribution or cost
- Why this decision is not already present in the current pool
- Postpone interaction and possible exploit
- Teaching burden and the exact visual/audio feedback cue required

After the 32-card table, provide:

A. The qualitative evidence matrix requested above.
B. A ranked shortlist of 16 cards.
C. Five two-card synergies and three three-card engines using both current and proposed cards.
D. At least six adversarial exploit tests, including mono-type autopilot and unlimited Postpone sorting.
E. A revised archetype map showing at least two internal branches per category, with early enablers, midgame engines, and late payoffs.
F. A build-cadence comparison covering the current economy, a price-cut scenario, and at least one non-price alternative.
G. A balance-risk list. Mark any recommendation that requires an engine feature not currently implemented.

Do not write code. Do not invent a metaprogression system. Do not replace the plate, Eat, Discard, or permanent-deck foundations.
```

## 18. Expected quality bar

A useful Fable5 response should make the game's next design decision easier, not merely produce flavorful card names. Reject the response if:

- most cards are “gain +N if category X happened”;
- values are given without expected timing or downside;
- it ignores the existing 62-card catalogue;
- it treats Postpone as automatically good or automatically bad without reachability analysis;
- it proposes several global restrictions before testing one minimal constraint;
- it uses vague phrases such as “gain some score,” “grow a little,” or “occasionally generate”; or
- its best cards only work after the run would already have failed a milestone.
