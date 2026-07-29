# Card art v0.17 source sheets

Received and applied:

- `sheet-01-fruit-fastfood.png` — F001–F013, K001–K003
- `sheet-02-fastfood-dessert.png` — K004–K012, D001–D007
- `sheet-03-dessert-drink.png` — D008–D011, B001–B012
- `sheet-04-animal-celestial.png` — A001–A012, C001–C004
- `sheet-05-celestial-person.png` — C005–C011, P001–P009
- `sheet-06-person-utility.png` — P010, U001–U008

All six sheets are present. All 89 cards use `assets/cards/v017/*-v3.png`.

The source PNGs are preserved unchanged. Their visible checkerboard is baked
into RGB pixels rather than stored as an alpha channel; the slicing script
therefore performs edge-connected background removal and component ownership
selection before normalizing each sprite. The source artwork's own outline is
preserved without adding another artificial border.
