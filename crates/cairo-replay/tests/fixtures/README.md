# Synthetic font fixtures

`font-a.ttf` and `font-b.ttf` are original MIT-licensed test data for this project,
not third-party typefaces. Both use the family `Pliflo Fixture` and contain only
rectangular glyphs for `A`, `中`, `.notdef`, and a blank space. Their advances are
500 and 800 units respectively (1000 units per em).

Matching family names with different metrics test that separate render sessions
cannot replace each other's embedded fonts. These files are never bundled with
the application and do not add Python or fontTools as project dependencies.
