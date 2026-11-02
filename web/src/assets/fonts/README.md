# Vendored web fonts

The web app vendors only the latin file it uses so `next build` does not make
network requests to Google Fonts. Apple devices render San Francisco from the
system stack (see `globals.css`); this Inter file is the fallback everywhere else.

- Inter variable normal: `@fontsource-variable/inter@5.2.8`

The package publishes the Google Fonts binary under the SIL Open Font License
1.1. The family directory includes the corresponding `OFL.txt`. Source package:

- https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8
