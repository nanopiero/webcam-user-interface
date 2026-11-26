# Interface languages

`languages.ts` lists the menu choices, native names, formatting locales and startup
language for each of the 33 EUMETNET member countries. The country coverage follows
the [EUMETNET member list](https://www.eumetnet.eu/wp-content/uploads/2026/07/List-of-current-Members-as-pdf-updateFeb25_final.pdf),
checked on 26 November 2026. Dutch also covers Flemish. Finnish appears once.
Irish, Luxembourgish, Albanian, Turkish and Montenegrin are separate choices.

The menu is immediately before Admin in the header. On narrow screens it displays
the short language code; its options retain their native language names.

## Startup and preferences

The order of precedence is:

1. A valid menu choice previously saved in this browser.
2. An explicit `language` in the frontend configuration, for example `"fr"`.
3. The first country in the configured ROI when `language` is `"roi"` or omitted.
4. English for an ROI country without a registered default.

This uses the configured ROI, not the webcam country fields, browser language or
optional bordering countries. France starts in French; Finland starts in Finnish.
The default for multilingual Belgium is Dutch, Switzerland German, Luxembourg
French, and Ireland English. A deployment can override these choices in its
frontend configuration, and viewers can choose any menu language.

Only a successfully loaded choice is saved. If browser storage is unavailable,
switching still works for the current visit. Timestamps remain UTC. Interface
numbers, country names and chart date labels use the selected formatting locale.

## Catalogues

`locales/en.json` defines the English source messages. Each other JSON file has
the same keys and interpolation fields. Source messages are readable English;
values are plain text, rendered through React rather than HTML injection.

The additional catalogues were prepared with machine-assisted translation.
All catalogues have been checked for complete messages and unchanged placeholders.
Weather labels were reviewed across every language, correcting ambiguity in
coverage extent, visibility, observation age, qualification, sites and marker
styles. Missing entries were completed directly after the drafting service was
rate-limited. This is a meaning and consistency review, not native-speaker
certification of every sentence. The less familiar languages remain drafts. These
are application translations, not official translations endorsed by EUMETNET;
native speakers can improve wording directly in the corresponding JSON file.

French retains **timestamp** and uses **couverture**, without “couverture
neigeuse”. Coverage classes remain distinct from snow depth, qualification and
observation freshness. Published threshold values and classification codes are
never translated or reinterpreted.

Provider-supplied webcam names, tags, descriptions, identifiers and model names
remain as published. Raster-map place labels and source attribution remain with
the map provider. No translation request containing webcam data is made.

Catalogues are bundled as separate local assets and loaded on demand. There is
no runtime translation service, external translation dependency or API key.
Changing language preserves map filters, camera selection, chart ranges and zoom;
it does not reload observations or provider images.

## Maintenance

Update the English source catalogue and every language catalogue together.
Keep fields such as `{count}` or `{duration}` unchanged; their surrounding words
can be reordered. Add a language to `LANGUAGES`, its JSON file, and any relevant
ROI default. The i18n tests verify country coverage, catalogue completeness,
interpolation, preferences and French terminology. Browser tests exercise every
menu language and verify that map/history state and API request counts stay stable.
