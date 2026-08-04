# Effect resolution

Card Eater resolves interactions as one deterministic event instead of letting cards and items mutate the same value in an accidental call order.

| Layer | Purpose | Examples |
| --- | --- | --- |
| replacement | Rewrite the event before it happens | double a future point change |
| prevention | Cancel or prevent the rewritten event | protect a card from losing points or being destroyed |
| set | Set a base value | first card becomes 0, use the better side |
| additive | Add flat values | printed points, rules, items and quests |
| multiplicative | Apply multipliers | score ×2, stacked last-card multipliers |
| boundary | Apply only explicitly declared limits | “吃分最高 12” |
| triggered | Resolve each triggered card or item instance | card text and each copy of 双层吸管 |
| aftermath | React to the resolved event | restored-point growth, destruction rewards |
| state-based / cleanup | Commit and remove temporary state | write permanent points, temporary-card cleanup |

`js/effect-processor.js` owns layer ordering, stable timestamps, nested effects, once keys, cancellation and the resolution safety limit. An effect may enqueue another effect in the same or a later layer. It may not enqueue an earlier layer after that layer has passed, so effects cannot change an event retroactively.

`js/permanent-points.js` is the only entry point for permanent point changes. It applies all replacement multipliers, then prevention, then explicit limits, and synchronizes every physical copy of the card.

When adding an effect:

1. Give every owned item a distinct `instance_id`; use that identity for once-per-round counters.
2. Use `changePermanentCard`, `setPermanentCardStat`, or `growPermanentCard` for permanent point mutations.
3. Use `capWhenDeclared(value, effect.max_bonus)` for optional score caps. Do not provide a fallback gameplay cap.
4. Put `max_bonus`, `max_eat_points`, or another point boundary in data only when the player-facing description states that boundary.
5. Treat idempotent replacements such as “always use the higher side” differently from numerical effects: multiple copies do not change the answer, while each multiplier or triggered ability remains an independent source.
