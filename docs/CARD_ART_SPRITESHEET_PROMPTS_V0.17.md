# Card Eater — Unified Card Art Sprite-Sheet Prompts (89 Cards)

Version: `0.17`  
Purpose: regenerate every current card illustration as one coherent pixel-art set.  
Coverage: 89 cards — 13 Fruit, 12 Fast Food, 11 Dessert, 12 Drink, 12 Animal, 11 Celestial, 10 Person, 8 Utility.

## Recommended batch layout

Use **five 4×4 square sheets plus one 3×3 square sheet**:

- Sheets 1–5: 16 sprites each, 80 sprites total.
- Sheet 6: 9 sprites, bringing the total to 89.
- Generate every sheet as the highest-resolution **square** image available.
- After approval, crop at exact equal grid boundaries and resize each crop to `256×256` with nearest-neighbour resampling.

This is more reliable than a 4×5 sheet. Square outputs preserve equal square cells, subjects have more room, and 16 distinct subjects per prompt are less likely to drift or merge than 20. The final 3×3 sheet avoids asking the model to keep seven cells empty.

## Recommended workflow

1. Generate Sheet 1 first.
2. Check silhouette readability at thumbnail size, exact grid placement, black outlines, shadow direction, transparent background, and whether every subject matches its cell.
3. If Sheet 1 is good, attach it as the **style reference image** for Sheets 2–6. Say that only style, palette, outline, scale and lighting may be copied; subjects and positions must follow the new manifest.
4. Do not ask the model to write card IDs or names into the image. IDs below are cutting metadata only.
5. If one cell is wrong, edit that cell or regenerate a single sprite. Do not repeatedly regenerate an otherwise approved full sheet.

The prompt layout follows OpenAI's recommended pattern: scene/background first, then subject, then visual details, then invariants and exclusions. Reference: <https://developers.openai.com/cookbook/examples/multimodal/image-gen-1.5-prompting_guide>

## Master style block

Paste this block at the beginning of **every** sheet prompt:

```text
Create a production-ready square pixel-art sprite sheet for a dark, warm-toned Chinese roguelike card game.

LAYOUT
- Use the exact grid specified below. Every cell is an equal square.
- Each cell contains exactly one isolated sprite, centered both horizontally and vertically.
- Keep the complete silhouette inside the central 68% of its cell, with at least 14% clear padding on every side.
- No subject may cross a grid boundary. Do not merge neighbouring subjects.
- The grid itself is invisible: no grid lines, separators, frames, labels, numbers or captions.
- Use a genuinely transparent background across the entire sheet.

PIXEL-ART STYLE
- Authentic low-resolution game sprite aesthetic, as if designed on a 64×64 logical pixel canvas and then enlarged with nearest-neighbour scaling.
- Crisp hard pixel clusters; absolutely no smooth vector edges, painterly brushwork, photorealism, 3D rendering or anti-aliased blur.
- Strong chunky near-black outline around every silhouette, 2–4 logical pixels thick, with a few dark brown interior contour pixels.
- Warm restrained palette: cream highlights, amber gold, muted red, moss green, dusty violet and deep plum shadows.
- Use only 3–5 value steps per material. Highlights are small deliberate pixel clusters, never airbrushed gradients.
- Consistent three-quarter front view unless the subject is naturally frontal.
- A compact hard-edged pixel shadow sits directly below and slightly to the right of every subject. Use the same shadow size, opacity and direction in every cell.
- All sprites must have the same apparent scale, outline weight, light direction and pixel density.
- The result must read clearly when each cell is reduced to a 96×96 thumbnail.

STRICT INVARIANTS
- Follow the row-and-column manifest exactly, left to right and top to bottom.
- Exactly one main subject per cell. Small attached props are allowed only when explicitly requested.
- No card borders, card frames, plates, UI panels, badges, rarity gems, arrows, score symbols or gameplay text.
- No letters, Chinese characters, English words, digits, logos, watermarks or signatures.
- No realistic photography, soft drop shadows, depth-of-field, glow spilling into another cell, or coloured background patches.
- Do not replace an unusual requested object with a generic food icon.
```

## Sheet 1 prompt — Fruit 1–13 + Fast Food 1–3

Append this block after the master style block:

```text
SHEET 1 — EXACT 4×4 GRID

Row 1:
1. F001 Apple — one clean red apple with a short brown stem and one small green leaf.
2. F002 Banana — one curved ripe yellow banana, intact peel, brown tip.
3. F003 Watermelon — one thick triangular watermelon wedge, red flesh, dark seeds, green striped rind.
4. F004 Strawberry — one plump red strawberry with visible seeds and a leafy green crown.

Row 2:
1. F005 Golden Apple — one magical metallic-gold apple, restrained amber shine, dark leaf, no glow outside its cell.
2. F006 Rotten Apple — one bruised olive-brown apple with a bite-like rotten patch and a tiny curled worm; still readable as an apple.
3. F007 Fruit Platter — a shallow wooden platter holding a compact arrangement of apple slices, banana, berries and melon; one unified silhouette.
4. F008 Dragon Fruit — one vivid magenta dragon fruit with chunky green-tipped scales, whole fruit.

Row 3:
1. F009 Pear — one ripe yellow-green pear with mottled pixels, brown stem and green leaf.
2. F010 Candied Plum — one dark red-purple candied plum coated in amber syrup, mounted on a tiny wooden pick, glossy pixel highlights.
3. F011 Dried Persimmon — one wrinkled orange dried persimmon with a dark leafy cap and a short hanging cord, clearly sun-dried rather than fresh.
4. F012 Pomegranate — one whole deep-red pomegranate with crown beside one cut half showing clustered ruby seeds; compose as one compact icon.

Row 4:
1. F013 Lantern Berry — one golden cape gooseberry emerging from a papery lantern-shaped husk, delicate but strongly outlined.
2. K001 Hamburger — one simple classic hamburger with sesame bun, patty, lettuce and tomato; compact, not oversized.
3. K002 Ramen — one ceramic ramen bowl with noodles, half egg and two green garnish pixels; no text on bowl.
4. K003 French Fries — one red paper carton filled with golden fries; blank carton with no logo or letters.
```

## Sheet 2 prompt — Fast Food 4–12 + Dessert 1–7

```text
SHEET 2 — EXACT 4×4 GRID

Row 1:
1. K004 Mega Burger — one exaggerated double-patty burger with cheese and sauce, taller than K001 but still fully contained.
2. K005 Spoiled Takeout — one greasy open takeout box with discoloured leftovers, a few green spoilage pixels and subtle stink curls; no gross realism.
3. K006 Coin-Operated Fried Chicken Bucket — one fried-chicken bucket with a small brass coin slot and one coin attached to the bucket; blank bucket, no logo.
4. K007 Spicy Wings — a compact basket of red-orange chicken wings with two tiny chilli peppers and heat pixels.

Row 2:
1. K008 Sandwich — one triangular toasted sandwich with lettuce and tomato layers, matching the current simple food readability.
2. K009 Microwave Dinner — one black compartment meal tray with rice, vegetables and sauce under a partly peeled clear film; compact top-three-quarter view.
3. K010 Heat-Lamp Counter — one small stainless food counter with two trays under a glowing amber heat lamp; the counter and lamp form one icon.
4. K011 Leftover Box — one closed translucent leftover container with mismatched food visible inside and a slightly crooked lid.

Row 3:
1. K012 Doggy Bag — one folded brown paper takeaway bag tied at the top, with a tiny plain bone-shaped tag but no text.
2. D001 Donut — one pink-glazed ring donut with sparse sprinkles.
3. D002 Strawberry Cake — one slice of cream layer cake topped by a strawberry.
4. D003 Caramel Pudding — one small flan pudding with dark caramel top on a simple saucer.

Row 4:
1. D004 Ice Cream — one melting two-scoop ice-cream cone, pastel cream and pink, readable chunky drips.
2. D005 Candy — two wrapped hard candies in red and amber wrappers, grouped as one crossed compact icon.
3. D006 Wedding Cake — one small three-tier cream wedding cake with berry decorations; no bride/groom topper and no text.
4. D007 Sandwich Cookie — one round dark sandwich cookie with a visible cream layer and a small bite missing.
```

## Sheet 3 prompt — Dessert 8–11 + Drink 1–12

```text
SHEET 3 — EXACT 4×4 GRID

Row 1:
1. D008 Melting Sundae — one glass sundae cup with visibly collapsing ice cream, syrup and chunky drips pooling at the base.
2. D009 Piping Bag — one cream-filled pastry piping bag with a metal star nozzle and one small piped rosette beside it; one compact composition.
3. D010 Display Cake — one ornate whole cake protected by a clear glass display dome on a dark base; cake remains clearly visible.
4. D011 Fortune Cookie — one cracked-open golden fortune cookie; a blank white paper strip emerges with absolutely no writing.

Row 2:
1. B001 Water — one clear tumbler filled with cool water and two bright pixel highlights.
2. B002 Soda — one red aluminium soda can with silver top and bubbles; blank can, no logo or letters.
3. B003 Black Coffee — one dark ceramic coffee cup with black coffee and two restrained steam curls.
4. B004 Fresh Juice — one glass of orange-yellow juice with a citrus slice and short straw; no label.

Row 3:
1. B005 Energy Drink — one slim electric-blue and amber can with a simple lightning-shaped colour patch but no symbol, logo or text.
2. B006 Milk — one small glass milk bottle beside a filled glass; blank bottle with no label.
3. B007 Deposit Bottle — one empty green glass returnable bottle with a small metal deposit coin attached by a string; no label.
4. B008 Bitter Supplement — one tiny dark medicine vial with cork and a bitter olive liquid; blank label area, no writing.

Row 4:
1. B009 Herbal Tea — one earthy ceramic teacup containing amber-green tea, with two mint leaves and a small herbal bundle.
2. B010 Refill Mug — one sturdy diner mug with a circular refill arrow implied only by a looping stream of coffee, not a drawn UI arrow or symbol.
3. B011 Espresso Shot — one tiny white espresso cup with very dark coffee, crema rim and compact steam.
4. B012 Bubble Tea — one transparent cup of milk tea with large dark tapioca pearls and a wide straw; blank cup.
```

## Sheet 4 prompt — Animal 1–12 + Celestial 1–4

```text
SHEET 4 — EXACT 4×4 GRID

Row 1:
1. A001 Orange Cat — one cute seated orange tabby cat, round face, curled tail, calm expression.
2. A002 Hungry Dog — one eager small brown dog holding an empty food bowl, tongue slightly out.
3. A003 Tired Monkey — one slumped small monkey with drooping eyelids holding a bruised banana peel.
4. A004 Rabbit — one alert white rabbit with long ears and a tiny carrot leaf, compact seated pose.

Row 2:
1. A005 Taotie — one stylised Chinese taotie glutton beast, squat dark jade-and-bronze body, huge mouth, horned mask face; cute-menacing rather than realistic.
2. A006 Shedding Snake — one green-brown snake emerging from a translucent discarded skin loop; both form one readable silhouette.
3. A007 Fox — one clever seated red fox with white chest and curled tail, holding one tiny berry.
4. A008 Turtle — one small olive turtle walking slowly, side-three-quarter view, patterned shell.

Row 3:
1. A009 Grooming Cat — one seated cream cat grooming itself with a small purple comb beside its paw.
2. A010 Sheepdog — one energetic black-and-white sheepdog in a herding stance, with one tiny wool tuft as the only prop.
3. A011 Magpie — one black, white and blue magpie perched on a small branch, holding one shiny coin in its beak.
4. A012 Truffle Pig — one pink-brown pig sniffing a dark truffle emerging from soil, both inside one compact ground patch.

Row 4:
1. C001 Star — one chunky five-point golden star with a warm centre highlight; no face.
2. C002 Crescent Moon — one golden crescent moon with a few dark crater pixels; no face.
3. C003 Sun — one round amber sun with alternating short and long pixel rays; no face.
4. C004 Comet — one small icy comet angled down-left, dark rock head with a bright blue-gold pixel tail contained inside the cell.
```

## Sheet 5 prompt — Celestial 5–11 + Person 1–9

```text
SHEET 5 — EXACT 4×4 GRID

Row 1:
1. C005 Meteor — one larger burning meteor rock descending diagonally, orange flame envelope and a very short contained smoke tail.
2. C006 Pluto — one tiny dusky violet dwarf planet with a pale heart-shaped surface patch and a thin partial orbit arc; no astronomical text.
3. C007 Black-Hole Stomach — one surreal black-hole vortex shaped like a hungry stomach opening, deep plum centre and restrained amber accretion ring; readable as one emblem.
4. C008 Gravity Well — one dark indigo funnel in space pulling three tiny stone fragments inward; compact circular silhouette, no UI arrows.

Row 2:
1. C009 Tide Moon — one silver crescent moon hovering directly above a curling teal ocean wave; moon and wave form one balanced icon.
2. C010 Supernova — one explosive starburst with white-hot cream centre, amber and magenta pixel rays, fully contained and no soft glow beyond its outline.
3. C011 Nebula — one compact swirling violet, teal and dusty-pink cosmic cloud with a few embedded star pixels and a strong dark outer contour.
4. P001 Fruit Merchant — one friendly market seller wearing an apron and holding a small basket of colourful fruit; full upper body, no stall sign.

Row 3:
1. P002 Debt Broker — one sharp-suited broker clutching a small ledger and coin pouch, slightly severe expression; no readable writing.
2. P003 Animal Keeper — one practical caretaker in green work clothes holding a feed bucket, with one tiny paw-print patch but no text.
3. P004 Astronomer — one robed astronomer looking through a short brass telescope, star-pattern trim without literal star UI icons.
4. P005 Magician — one stage magician with dark cape and top hat, presenting a tiny white rabbit; one compact figure group.

Row 4:
1. P006 Food Challenger — one determined eater with headband holding an oversized spoon and empty bowl, dynamic but contained pose.
2. P007 Delivery Courier — one bicycle food courier in jacket and cap carrying a square insulated delivery backpack; no company logo.
3. P008 Auctioneer — one energetic auctioneer holding a small wooden gavel and a blank bid paddle; no numbers.
4. P009 Curator — one elegant museum curator with white gloves holding a framed miniature fruit still life; no plaque or text.
```

## Sheet 6 prompt — Person 10 + Utility 1–8

Use the master style block, but replace its grid sentence with: **Use an exact 3×3 grid of equal square cells.** Then append:

```text
SHEET 6 — EXACT 3×3 GRID

Row 1:
1. P010 Food Critic — one discerning critic with dark coat, small tasting spoon and closed blank notebook, raised eyebrow; no readable writing.
2. U001 Purifier — one brass-and-glass tabletop purifier containing clear blue liquid, with a clean crystal filter core; no symbols or text.
3. U002 Score Juicer — one eccentric hand-crank fruit juicer with red fruit entering the top and golden droplets exiting; no score digits or UI marks.

Row 2:
1. U003 Discount Coupon — one golden paper coupon with a notched edge and a simple blank seal; absolutely no percent sign, number, letters or writing.
2. U004 Iron-Stomach Badge — one heavy bronze shield badge shaped like a stylised stomach, with dark iron rim; no text.
3. U005 Sorting Tray — one shallow wooden card-sorting tray with three slots and three blank face-down mini cards; no visible card symbols.

Row 3:
1. U006 Repair Kit — one compact red-brown toolbox opened to show a wrench, screwdriver and two patches; no brand.
2. U007 Layaway Ticket — one cream ticket clipped to a small coin pouch with a dark binder clip; ticket is completely blank.
3. U008 Laminator — one small retro desktop laminating machine feeding a blank card into a glossy clear sleeve; no buttons with text.
```

## Negative correction prompt

If a generated sheet becomes too smooth, realistic, crowded or inconsistent, use this edit prompt:

```text
Keep the exact subjects and exact grid positions. Restyle the complete sheet into authentic low-resolution game sprites: reduce every object to deliberate chunky pixel clusters, remove all anti-aliasing and painterly texture, add a consistent 2–4 logical-pixel near-black outline, constrain each material to 3–5 value steps, and restore the same compact hard-edged shadow below-right in every cell. Recenter every complete silhouette inside the central 68% of its cell. Preserve a truly transparent background. Do not add text, card frames, plates, UI symbols, labels, extra props or grid lines.
```

## Cutting manifest and filenames

Crop left-to-right, top-to-bottom. Save transparent PNG files using the exact lowercase filenames below.

### Sheet 1 (4×4)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `f001-v3.png` | `f002-v3.png` | `f003-v3.png` | `f004-v3.png` |
| 2 | `f005-v3.png` | `f006-v3.png` | `f007-v3.png` | `f008-v3.png` |
| 3 | `f009-v3.png` | `f010-v3.png` | `f011-v3.png` | `f012-v3.png` |
| 4 | `f013-v3.png` | `k001-v3.png` | `k002-v3.png` | `k003-v3.png` |

### Sheet 2 (4×4)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `k004-v3.png` | `k005-v3.png` | `k006-v3.png` | `k007-v3.png` |
| 2 | `k008-v3.png` | `k009-v3.png` | `k010-v3.png` | `k011-v3.png` |
| 3 | `k012-v3.png` | `d001-v3.png` | `d002-v3.png` | `d003-v3.png` |
| 4 | `d004-v3.png` | `d005-v3.png` | `d006-v3.png` | `d007-v3.png` |

### Sheet 3 (4×4)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `d008-v3.png` | `d009-v3.png` | `d010-v3.png` | `d011-v3.png` |
| 2 | `b001-v3.png` | `b002-v3.png` | `b003-v3.png` | `b004-v3.png` |
| 3 | `b005-v3.png` | `b006-v3.png` | `b007-v3.png` | `b008-v3.png` |
| 4 | `b009-v3.png` | `b010-v3.png` | `b011-v3.png` | `b012-v3.png` |

### Sheet 4 (4×4)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `a001-v3.png` | `a002-v3.png` | `a003-v3.png` | `a004-v3.png` |
| 2 | `a005-v3.png` | `a006-v3.png` | `a007-v3.png` | `a008-v3.png` |
| 3 | `a009-v3.png` | `a010-v3.png` | `a011-v3.png` | `a012-v3.png` |
| 4 | `c001-v3.png` | `c002-v3.png` | `c003-v3.png` | `c004-v3.png` |

### Sheet 5 (4×4)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| 1 | `c005-v3.png` | `c006-v3.png` | `c007-v3.png` | `c008-v3.png` |
| 2 | `c009-v3.png` | `c010-v3.png` | `c011-v3.png` | `p001-v3.png` |
| 3 | `p002-v3.png` | `p003-v3.png` | `p004-v3.png` | `p005-v3.png` |
| 4 | `p006-v3.png` | `p007-v3.png` | `p008-v3.png` | `p009-v3.png` |

### Sheet 6 (3×3)

| Row | Col 1 | Col 2 | Col 3 |
|---|---|---|---|
| 1 | `p010-v3.png` | `u001-v3.png` | `u002-v3.png` |
| 2 | `u003-v3.png` | `u004-v3.png` | `u005-v3.png` |
| 3 | `u006-v3.png` | `u007-v3.png` | `u008-v3.png` |

## Acceptance checklist

- Exactly 89 valid cells and 89 unique subjects.
- Every subject matches its manifest position.
- Complete silhouette visible; nothing is cropped at the tile edge.
- Main subject centre is within 5% of the tile centre.
- Apparent subject size differs by no more than roughly 10% across the set.
- Transparent background, no accidental coloured rectangle.
- Near-black chunky outline is visible on light and dark card-art panels.
- Hard-edged shadow is below-right and never touches another tile.
- No letters, numbers, logos, plate graphics, UI arrows or card borders.
- At `96×96`, Apple, Hamburger, Donut, Mug, Cat, Moon, Merchant and Toolbox remain immediately distinguishable.

When the six source sheets are ready, keep the untouched originals. The game should use the individually cropped `*-v3.png` files so mobile cropping, centring and per-card replacement remain easy to verify.
