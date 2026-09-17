# Farfield

Il portfolio di Daniele Galasso, in forma di mondo: un prato di voxel da
esplorare a piedi, e sei monoliti di pietra che raccontano chi sono, i
progetti, la carriera, le competenze, gli obiettivi e come contattarmi.

Costruito con three.js e Vite. Il suolo è un campo di voxel calcolato per
raggi, la pietra è muratura di cubi veri, le nuvole sono cumuli di cubi, la
luce del giorno è fittata su un'immagine di riferimento.

## Come si visita

- `W A S D` per muoversi, `Shift` per correre, mouse per guardare.
- `E` davanti a un monolite per aprirne il pannello.
- `V` alterna prima e terza persona.
- `TAB` menu, `M` mappa.

## Sviluppo

```
npm install
npm run dev       # server di sviluppo
npm run build     # build di produzione in dist/
npm run preview   # anteprima locale della build
npm run guard:all # le guardie: misure e autotest sul mondo consegnato
```

Con `?dev` nell'indirizzo compaiono la sovrimpressione di sviluppo (fps,
tempo di fotogramma, draw, triangoli) e i tasti di misura: `P` porta la
camera alla posa di riferimento, `G` spegne uno stadio del composito per
volta, `B` rifà la taratura della qualità.

## Struttura

- `src/` il motore e il mondo: `world/voxel/` il suolo e la muratura,
  `world/` monoliti, vegetazione, cornice, nuvole, camminatore, `core/`
  cielo, luce, post, qualità.
- `content/` i testi delle sei sezioni, presi dal curriculum.
- `assets-src/` le sorgenti degli asset e le misure di riferimento;
  `public/assets/` ciò che il sito consegna.
- `tools/` gli strumenti di misura, di cottura e le guardie.

## Licenza

Codice sotto licenza MIT. I testi e i dati personali in `content/` sono
dell'autore.
