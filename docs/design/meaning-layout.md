# The meaning layout

The map lays out what the code is *for* – its intent – not where files live
or which language they are in. Code: `web/src/views/map/meaning.ts` (the
algorithm), `views/map/flowKit.tsx` (placement), `flow/agentMark.tsx`
(agents).

## Inputs
- **Plain words** from the user's own model, via the `kula-map` skill
  (`kula map explain todo|apply`, stored on `refs/kula/map`): per block a
  `plain` name, a `sentence`, and an optional **`area`** – at most 3 words
  for the product area, what the person is trying to get done ("Agent
  safety", "History and changes"). The skill asks for 5–9 areas over the
  whole codebase.
- **Flows** between sections (the map's call/data flow weights).

## Steps
1. **Words → vectors.** Each section's text (its words, plus the words of
   every block inside it; theme and function names only when no model words
   exist yet) is tokenised, stop words dropped, lightly stemmed and weighted
   TF-IDF.
2. **Affinity.** `sim(a, b) = 0.75 · cosine(words) + 0.25 · √(flow / maxFlow)`.
3. **Zones.** If ≥ 60% of sections carry a model area, the areas *are* the
   zones; a section without one joins the zone it is most like. Otherwise
   average-linkage clustering on `sim` to k ≈ 1.2 √n zones (3–10), with a
   size penalty so no zone swallows the map. Tests always form their own zone.
4. **Names.** The zone's majority area; else its two most distinctive words
   (zone-mean TF-IDF over map-mean); else its medoid's plain name.
5. **Order.** Zones left to right by net outflow (out – in): where work
   starts sits left, where it ends up sits right. Zones with < 8% of the
   busiest zone's outside flow follow the main line; tests come last.
6. **Within a zone.** Members sorted by the barycentre of the zones they
   talk to (two sweeps), filled into columns – a wire leaves a square on the
   side it heads towards.
7. **Colour = zone.** Hues step round the wheel by the golden angle
   (`oklch(0.74 0.13 h)`), so neighbouring zones never share a colour.
   Squares carry their zone's hue; the glyph is the plain name's initials.

## Wires
- **Roads between zones:** one wire per zone pair, as thick as the flow
  between them (each zone's top two, plus any ≥ 25% of the busiest), in a
  gradient from one zone's hue to the other's. Neighbours get a direct
  curve; a road that skips zones runs metro-style in its own lane under
  the map (shorter spans in upper lanes), so it never crosses a zone it
  skips.
- **Within a zone:** each section's two heaviest flows.
- A picked value flow still draws its own section wires across zones.

## Agents
- A fenced agent sits **inside** the zone holding most of the code it may
  change, in a row along the zone's top; its wires fan down from its bottom
  edge into each square it is fenced to.
- An agent with no fence sits left of the single **Whole codebase** square
  (banded by zone shares).
- Each agent has its own mark: a damped harmonograph whose frequency ratio,
  detune, phases and damping are hashed from its name, drawn in its own
  two-hue gradient (`agentGradient`) – the same gradient runs along every
  wire it owns.
