# Profile page — design directions

Three visual directions for `/u/[username]`, drawn against the real design
system (`tailwind.config.ts` + `app/globals.css`): Instrument Sans / IBM Plex
Mono, the `terminal.*` palette, radii 6/8/10, and the colour discipline —
up/down for price only, amber for revenue and rank, accent for actions.

| Artboard | Direction | Idea |
| --- | --- | --- |
| `Main.dc.html` | A — Player card | Identity as the hero; the curve bleeds edge to edge; stats lose their boxes for a hairline band. |
| `DirectionB.dc.html` | B — Terminal readout | No panels at all. Hairline rules, mono throughout, price axis, TOTAL line, blotter. |
| `DirectionC.dc.html` | C — Editorial | One large number and a full-bleed curve; space separates instead of borders. |

The problem all three answer: the page is seven `.panel` boxes with identical
1px borders, so nothing outranks anything else and the eye has nowhere to
land — and on a page about a person, the person is the smallest thing on it.

`render.mjs` unwraps each artboard into plain HTML and screenshots it, which is
how these were checked; the artboards are static, so it is a faithful preview.

To rebuild the canvas (the published file is gitignored — it is 2.5 MB of
baked editor):

    node <design-skill>/seed-canvas.mjs \
      --template <design-skill>/payload.template.html \
      --out saas-exchange-profile.html \
      --title "SAAS EXCHANGE Profile" \
      --artboard Main.dc.html --artboard DirectionB.dc.html \
      --artboard DirectionC.dc.html --canvas canvas.json
