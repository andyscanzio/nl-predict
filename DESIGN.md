---
name: NL Predict
description: An arena scoreboard for the Swiss National League's projected final table.
colors:
  amber: "light-dark(#966000, #ffb000)"
  amber-lit: "#ffb000"
  on-amber: "#000000"
  led-red: "light-dark(#d61f1f, #ff4545)"
  playoffs-cyan: "light-dark(#0079a8, #29d3ff)"
  play-in-amber: "light-dark(#966000, #ffb000)"
  eliminated-slate: "light-dark(#9aa6b2, #56616d)"
  up-green: "light-dark(#0a7d3a, #32e07a)"
  down-red: "light-dark(#d61f1f, #ff4545)"
  win-green: "light-dark(#0f9a4a, #32e07a)"
  loss-red: "light-dark(#d61f1f, #ff4545)"
  arena-floor: "light-dark(#e9edf2, #07090c)"
  panel: "light-dark(#ffffff, #10151c)"
  panel-strip: "light-dark(#f3f6f9, #151c25)"
  inset: "light-dark(#f6f8fa, #0b0f14)"
  ink: "light-dark(#0c1117, #eef3f8)"
  muted: "light-dark(#56636f, #8593a2)"
  line: "light-dark(#d6dde5, #1f2833)"
  rule: "light-dark(#85919e, #5a6673)"
  switch-track: "light-dark(#f3f6f9, #000000)"
  led-screen: "light-dark(#ffffff, #000000)"
  led-text: "light-dark(#8f5a00, #ffb000)"
  led-bright: "light-dark(#0c1117, #ffffff)"
  warning-bg: "light-dark(#fff4d6, #2a1f05)"
typography:
  display:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.04em"
  display-compact:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.04em"
  numeral-lg:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  numeral-md:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: "tnum"
  numeral:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    fontFeature: "tnum"
  title:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    letterSpacing: "0.03em"
  title-sm:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    letterSpacing: "0.02em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.3
  legend:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
  label:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    letterSpacing: "0.2em"
  label-sm:
    fontFamily: "Oxanium Variable, system-ui, sans-serif"
    fontSize: "0.62rem"
    fontWeight: 600
    letterSpacing: "0.1em"
rounded:
  chip: "1px"
  tag: "2px"
  segment: "3px"
  control: "4px"
  track: "5px"
  inset: "6px"
  panel: "8px"
  pill: "999px"
spacing:
  xs: "0.3rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  panel-heading:
    backgroundColor: "{colors.panel-strip}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "0.65rem 1rem"
  inset-box:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.inset}"
    padding: "0.5rem 0.75rem"
  model-option:
    textColor: "{colors.muted}"
    rounded: "{rounded.segment}"
    padding: "0.35rem 0.7rem"
  model-picker-track:
    backgroundColor: "{colors.switch-track}"
    rounded: "{rounded.track}"
    padding: "2px"
  model-option-picked:
    backgroundColor: "{colors.amber-lit}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.segment}"
  segmented-toggle:
    textColor: "{colors.muted}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.control}"
    padding: "0.2rem 0.55rem"
  segmented-toggle-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  what-if-button:
    textColor: "{colors.muted}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.control}"
    padding: "0.3rem 0.6rem"
  what-if-button-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  banner-button:
    textColor: "{colors.ink}"
    rounded: "{rounded.inset}"
    padding: "0.25rem 0.75rem"
  banner-button-hover:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.arena-floor}"
  led-clock:
    backgroundColor: "{colors.led-screen}"
    textColor: "{colors.led-text}"
    rounded: "{rounded.control}"
    padding: "0.1rem 0.6rem"
  headline:
    backgroundColor: "{colors.led-screen}"
    textColor: "{colors.led-text}"
    rounded: "{rounded.panel}"
    padding: "0.6rem 0.8rem"
  headline-tag:
    backgroundColor: "{colors.amber-lit}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.tag}"
    padding: "0.15rem 0.45rem"
  win-split-overtime:
    textColor: "{colors.muted}"
    typography: "{typography.label-sm}"
  form-chip:
    backgroundColor: "{colors.win-green}"
    rounded: "{rounded.chip}"
    size: "10px"
  bracket-tie:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.inset}"
  bracket-champion:
    backgroundColor: "{colors.led-screen}"
    textColor: "{colors.led-text}"
    rounded: "{rounded.panel}"
    padding: "0.9rem 0.6rem"
  what-if-pill:
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.2rem 0.15rem 0.55rem"
  warning:
    backgroundColor: "{colors.warning-bg}"
    rounded: "{rounded.panel}"
    padding: "0.6rem 1rem"
---

# Design System: NL Predict

## Overview

**Creative North Star: "The Arena Scoreboard"**

NL Predict is the scoreboard hanging over the rink, rebuilt for the stats-minded fan. Panels are scoreboard modules, set against a dark arena floor. Labels are stencilled in wide, spaced capitals. Numbers are shown in a square-shouldered display face. The few things that matter right now light up: the snapshot clock, the Headline, the picked Projection Model and the Champion glow like LED segments. Everything else stays quiet so the numbers can be read.

The system is dense on purpose. A phone has to hold a full Projected Table with Season Simulation percentages, so rows stay tight, the type is small but heavy, and columns give way in a fixed order rather than wrapping. Hierarchy comes from typeface (Oxanium for labels and numbers, system-ui for prose), from weight and from colour that carries meaning, not from size jumps or decoration.

Light and dark are equal partners. Each colour is a `light-dark()` pair designed in both directions. In dark the LED screens are true black with an amber glow. In light the same elements become plain bordered panels with deeper amber text, so the light theme never pretends to be lit.

**Key Characteristics:**
- Flat panels on a tonal arena floor. Depth comes from surface steps and hairlines, not from shadows.
- Oxanium in uppercase with wide tracking for every label, team name and number; system-ui for running prose.
- Amber is the brand accent and the colour of "lit": picked states, LED screens, focus rings, hover.
- Cut Line colours (cyan playoffs, amber play-in, slate eliminated) mean only those zones.
- Tabular numerals everywhere numbers line up.
- Every colour has a light and a dark value.

## Colors

A cool, near-neutral arena of blue-greys, lit by one warm amber and a small set of colours that carry meaning.

### Primary
- **Scoreboard Amber** (`amber`; `amber-lit` is the fixed dark value, used on segments that stay amber in both themes, always inked in **On-Amber** black, `on-amber`, with 11.5:1 contrast): The brand accent. Use it for picked and lit states, LED clock and Headline text (through `led-text`), focus outlines (2px), hover text on links and expandable rows, the warning border, and the outline on the What-If banner's buttons and pills. It is deeper in light (#966000) so even 9px text keeps 4.5:1 on every light surface it sits on, the warning wash and the arena floor included.

### Secondary
- **Goal-Light Red** (`led-red`): The red dot in the "NL ● Predict" wordmark. Reserved for the brand mark. It shares its value with `down-red` and `loss-red`, but its role is identity, not data.

### Tertiary (meaning colours)
- **Rink Cyan** (`playoffs-cyan`): Playoff zone. Rank cell inset bar and colour, rank-distribution bars and legend for ranks 1–6.
- **Play-In Amber** (`play-in-amber`): Play-in zone (ranks 7–10) and seeds arriving via the Play-In. It shares its value with the brand amber; zone context (rank bar, legend, bracket seed) tells the two apart.
- **Eliminated Slate** (`eliminated-slate`): Eliminated zone bars, legend bar and rank-distribution bars, and empty sides of the win split. It is a fill, never text: below 3:1 in both themes, so eliminated rank numerals, rows below the last Cut Line and "out" exits in the bracket are set in `muted`.
- **Climb Green / Drop Red** (`up-green`, `down-red`): Movement ▲▼ and What-If Changes.
- **Win Green / Loss Red** (`win-green`, `loss-red`): Form chips only.

### Neutral
- **Arena Floor** (`arena-floor`): The page background behind every panel.
- **Panel** (`panel`): Module surfaces. Also the text colour on ink-filled pressed buttons.
- **Panel Strip** (`panel-strip`): Panel heading strips, day headings, the Play-In band, row hover.
- **Inset** (`inset`): Boxes nested inside panels (Form Windows, charts, Round Chances, bracket ties).
- **Ink** (`ink`): Primary text, the home side of the win split, the filled state of pressed toggles, chart lines.
- **Muted** (`muted`): Labels, headings, secondary numbers, the away side of the win split.
- **Hairline** (`line`): All 1px borders and row dividers.
- **Switch Track** (`switch-track`): The model picker's recessed track: `panel-strip` in light, the LED screen's black in dark.
- **Rule** (`rule`): Lines that carry structure rather than separate, such as the Projected Bracket's 2px connectors; 3:1 on a panel in both themes.
- **LED Screen / LED Text / LED Bright** (`led-screen`, `led-text`, `led-bright`): The clock, Headline and Champion: a black screen with amber digits and white emphasis in dark mode, a white bordered panel with deep amber and ink in light mode.
- **Warning Wash** (`warning-bg`): The background of warning and What-If banners.

### Named Rules
**The Zone Colour Rule.** Cyan, play-in amber and slate mean playoffs, play-in and eliminated, and nothing else. Home and away are told apart with `ink` and `muted`, never with zone colours.

**The Never-Colour-Alone Rule.** Every meaning colour comes with a second cue: an arrow (▲▼), a fill pattern (solid, half or empty Form chips; striped OT/SO slices), position, or a legend label. This is how the system meets WCAG 2.2 AA for colour-blind readers.

**The Paired Value Rule.** Every new colour is added as a `light-dark(light, dark)` custom property on `:root` and checked for contrast in both themes. No colour exists in only one theme. The two fixed values, `amber-lit` and `on-amber`, are tokens too: lit segments look the same in both themes on purpose. Translucent variants (the Start switch's 40% and 65% black, the glows) are mixed from them with `color-mix()`, never written as literals.

**The Fill Is Not Text Rule.** A colour that passes as a bar or a bar's edge may still fail as type. Zone and accent colours that carry text must reach 4.5:1 on the surface they sit on; otherwise the shape carries the colour and the text goes `muted` or `ink`.

## Typography

**Display Font:** Oxanium Variable (self-hosted via `@fontsource-variable/oxanium`, falling back to system-ui)
**Body Font:** system-ui (-apple-system, Segoe UI, Roboto, sans-serif)

**Character:** Oxanium's squared, engineered letterforms read as scoreboard segments, and they carry every label, team name and number. The system body face carries only explanatory prose, so reading text feels native to the device and the scoreboard voice stays reserved for data.

### Hierarchy
- **Display** (700, 2rem, 1.1, 0.04em, uppercase): The "NL ● Predict" wordmark only; **Display Compact** (1.6rem) at phone width.
- **Numeral Large** (700, 1.45rem, line-height 1, tabular): Projected Points. The clock uses the same face at 1.5rem.
- **Numeral Medium** (700, 1.2rem, tabular): Round Chances, and Projected Points and the clock below 36rem.
- **Numeral** (700, 1.05rem, tabular): Rank and Current Table Points, and Projected Points below 24rem.
- **Title** (600, 0.95rem, 0.03em, uppercase): Team names in tables. **Title Small** (0.9rem) for Upcoming Games teams, bracket ties and table cells below 36rem.
- **Body** (400, 1rem, 1.5): Explanations; 0.9rem in the model explanation. **Body Small** (0.85rem) for notes, the rank summary, Form Window tables and the footer. **Caption** (0.72rem, 1.3) for the model picker's one-line summaries.
- **Legend** (Oxanium 500, 0.75rem): Legend keys under the tables and the bracket.
- **Label** (600, 0.8rem, 0.2em, uppercase, muted): Panel headings.
- **Label Small** (600, 0.58–0.72rem, 0.08–0.14em, uppercase): Table headers, day headings, toggles, chart labels, tags.

### Named Rules
**The Two Voices Rule.** If it is a label, a team, a number or a control, it is Oxanium in uppercase. If it is a sentence of explanation, it is system-ui in sentence case. Never set prose in Oxanium capitals.

**The Tabular Rule.** Any column, clock or percentage that can change sits on `font-variant-numeric: tabular-nums`, so digits never jitter between updates or what-ifs.

## Layout

A single centred column with a 60rem maximum width and 1rem side padding (1.5rem top, 2rem bottom). Panels stack with 1rem between them. Inside a panel, the body inset is 0.75rem × 1rem, and table outer cells keep that 1rem edge. Nested boxes sit on a 0.5rem × 1rem grid gap.

The layout is phone-first in priority, not in authoring: the full layout is designed at 60rem, then columns give way in a fixed order as space shrinks:
- **62rem:** team names in the Team column and Form Window opponents become acronyms, leaving room for the percentages. The two Form Windows always share their row in equal halves, never wider than the detail.
- **50rem:** Form columns go.
- **44rem:** the home and away Form Windows stack, one above the other.
- **40rem and up:** Round Chances go four across (two by two below).
- **36rem:** the bracket switches to acronyms in three tight columns, the Play-In stacks with its arrow turned down, and the Champion becomes a banner below.
- **30rem:** Now, Left and Pts drop so the Season Simulation percentages fit without horizontal scroll, and the What-If toggles stretch to the Game's full width as tap targets.
- **24rem:** cells tighten to 0.15rem sides, header tracking drops to 0.04em, Projected Points step down to Numeral, and the percentage headers lose their % sign (the legend names them), so the Projected Table fits a 320px phone.

Within Upcoming Games, a 2.9rem start-time column plus a 0.6rem gap sets a shared indent that the points line, win split and What-If toggles all align to.

## Elevation & Depth

The system is flat. Depth comes from three tonal steps (arena floor → panel → inset) and 1px hairlines. Shadows exist only as light: in dark mode, the LED elements and the picked model glow amber. Inset `box-shadow` is also used as a crisp 1px or 3px stroke (zone bars, chip outlines, LED edges) where a border would shift layout.

### Shadow Vocabulary
- **LED Text Glow** (`text-shadow: 0 0 10px rgb(255 176 0 / 0.55)`, dark only): Clock digits.
- **Lit Segment Glow** (`box-shadow: 0 0 10px rgb(255 176 0 / 0.45)`): The picked Projection Model.
- **Champion Glow** (`box-shadow: 0 0 18px rgb(255 176 0 / 0.55)`, dark only): The Champion card.
- **Zone Bar** (`box-shadow: inset 3px 0 0 <zone colour>`): The left edge of a Projected Table rank cell.

### Named Rules
**The Glow Means Lit Rule.** A shadow is light coming from an LED, never a drop shadow showing height. Nothing floats; things only light up. The glow is transparent in the light theme.

## Shapes

Small, engineered corners that get rounder as elements get bigger: 1px Form chips, 2px Headline tag, 3px model segments, 4px controls and the clock, 6px inset boxes and bracket ties, 8px panels, Headline and Champion. The only fully round shape is the What-If result pill (999px), which marks it as a removable token. Borders are always 1px hairlines in `line`. Heavier strokes carry meaning: a 2px Cut Line rule between zones, a 3px zone bar, a 4px warning edge.

## Components

### Panels
The scoreboard module. Everything sits in one.
- **Corner Style:** 8px, with `overflow: hidden` so the heading strip and tables clip cleanly.
- **Background:** `panel`, with a 1px `line` border.
- **Heading:** a `panel-strip` band with a muted Label (0.8rem, 0.2em tracking, uppercase) and a hairline below.
- **Internal Padding:** 0.75rem × 1rem. Tables run edge to edge.

### Model Picker (signature)
A scoreboard switch: four segments in a recessed track (`panel-strip` in light, black in dark, 2px gutters, 5px track radius, 3px segments).
- **Unpicked:** muted name (0.72rem Oxanium, 0.12em, uppercase) over a system-ui summary. Hover turns the name amber.
- **Picked:** the whole segment fills with `amber-lit` (#ffb000) in both themes, text goes black, and it glows. The Elo Model's Start switch sits inside the lit segment, inked black on amber.
- **Focus:** 2px amber outline, 1px offset.

### Segmented Toggles
The theme toggle, chart metric toggle and Elo Start switch.
- **Shape:** a 1px `line` border, 4px radius, hairline dividers between segments.
- **Default:** muted Label Small text. Hover shows it in `ink`.
- **Pressed:** filled with `ink`, text in `panel` (the chart metric toggle uses `arena-floor`).
- **Focus:** 2px amber outline, inset −2px.
- **Size:** at least 24px tall (WCAG 2.2 target size), even where the label is Label Small.

### Buttons
- **What-If toggles:** outlined 4px buttons in Label Small (0.62rem, uppercase). Hover strengthens the border and text. Pressed fills with `ink`, the same as the segmented toggle, because amber is too faint for this small text in light mode. At phone width they span the Game's width.
- **Banner buttons:** 6px, amber 1px outline, ink text. Hover fills with amber.
- **Expand rows:** the whole team row is the button. The row background goes to `panel-strip` on hover, the team name turns amber, and a muted chevron shows the state.

### Chips
- **Form chips:** 10px squares with a 1px radius. Solid `win-green` for a regulation win, half-filled green with an outline for an OT/SO win, half-filled red with an outline for an OT/SO loss, an empty red outline for a regulation loss.
- **What-If result pills:** 999px, 1px amber border, with a round remove button inside, at least 24×24px.
- **Low Sample tag:** a 4px outlined tag in Label Small, muted, with a help cursor.

### LED Screens (signature)
The snapshot clock, the Headline and the Champion.
- **Dark:** a black screen with amber `led-text` and white `led-bright` emphasis. The clock glows, and the Champion has an amber border and glow.
- **Light:** a `panel`-white surface with a 1px `line` edge, deeper amber text and ink emphasis, and no glow.
- **Headline tag:** a solid #ffb000 label with black text and a 2px radius, the same in both themes. It reads Projection, What-if, or Simulating while a new pick is being projected.

### Pending Picks
The Season Simulation runs in a Web Worker and takes a moment on a phone, so neither the first paint nor a pick waits on it. On load, the scoreboard paints at once with the Headline screen tagged Simulating ("Playing out the remaining games 10,000 times") until the first projection arrives. After a pick, the pressed What-If toggle or the lit model segment paints at once, the Headline tag reads Simulating, `main` is `aria-busy`, and the figures the pick will change (the Headline sentence, Projected Table rows, the bracket and win splits) step back to 0.5 opacity until its projection arrives. Picks made while the worker is busy replace each other, so only the newest is simulated next.

### Tables
- Collapsed borders, hairline row dividers, tabular numerals, tight 0.45rem × 0.4rem cells, no wrapping.
- Header in muted Label Small. The rank cell is centred Numeral with its zone bar, in the zone colour for playoffs and play-in and in `muted` for eliminated. A 2px muted rule marks each Cut Line.
- Where a team shows as its acronym, screen readers still hear its full name.
- An expanded row opens a detail area of inset boxes: Round Chances, Rank Distribution, Projection History, and Home and Away Form Windows.

### Win Split
A single 0.6rem bar per Game: the home share in `ink` from the left and the away share in `muted` from the right, each with a striped, lighter OT/SO slice next to a 2px panel-coloured seam, and percentages either side. Under each side, a muted Label Small figure gives the part of its chance won in OT/SO ("14% in OT/SO"), so all four Outcome Probabilities read without hovering. Screen readers get them as one sentence instead of the bar.

### Projected Bracket
A left-to-right tree of inset tie cards (6px). Connectors are 2px `rule` borders reaching halfway across each gap. The winner's row is ink at weight 600 with its percentage in `led-text`. The Champion is an LED screen at the end, or a banner below at phone width.

### Warning & What-If Banner
A `warning-bg` wash with a 1px amber border, a 4px amber left edge and an 8px radius. The strong lead-in is Oxanium in uppercase amber. The same panel, with a Reload banner button and a link to report it, replaces the page when a projection fails, so an error never leaves a blank page. Without JavaScript, a plain panel says the page needs it.

### Forced Colours
In Windows High Contrast, the win split, Form chips, rank-distribution bars and legend swatches keep their own colours (`forced-color-adjust: none`). Picked and pressed controls fill with the system `Highlight`. The rank cell's zone bar becomes a `CanvasText` edge, with the Cut Line rules and legend carrying the zones.

## Do's and Don'ts

### Do:
- **Do** add every colour as a `light-dark()` pair on `:root` and check it in both themes.
- **Do** use amber as the brand accent for lit, picked, focused and hovered states, deepening it in light mode (#a86a00) wherever it carries text.
- **Do** set labels, team names and numbers in Oxanium, uppercase and tracked; prose in system-ui.
- **Do** use tabular numerals for any figure that can change.
- **Do** pair every meaning colour with a shape, fill, arrow or label.
- **Do** keep surfaces flat: arena floor → panel → inset, separated by 1px `line` hairlines.
- **Do** decide what gives way at each breakpoint instead of letting tables scroll sideways on phones.
- **Do** use a 2px amber focus outline on every interactive element, the Projection History chart included (its arrow keys step through the season).
- **Do** keep every tap target at least 24px in both directions.

### Don't:
- **Don't** use cyan, play-in amber or slate for anything except Cut Line zones. When amber is used as a brand accent next to zone data, make sure the zone still reads through its bar, legend or position.
- **Don't** use drop shadows to show height. A glow is LED light and appears only in dark mode.
- **Don't** add club logos, club colours or league marks. Teams appear by name in Oxanium.
- **Don't** set prose in uppercase Oxanium, or numbers in the system font.
- **Don't** add a colour, glow or effect that exists only in one theme.
- **Don't** fill a pressed small-text toggle with amber in light mode. Use `ink`.
- **Don't** set text in `eliminated-slate`, or fade text at rest with opacity; step it down to `muted` instead. Only the brief pending state dims.
