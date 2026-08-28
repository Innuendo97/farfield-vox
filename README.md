# Farfield

Portfolio 3D esplorabile di Daniele Galasso.

## Comandi

```
npm install
npm run dev       # server di sviluppo
npm run build     # build di produzione in dist/
npm run preview   # anteprima locale della build
```

Aggiungi `?dev` all'URL per l'HUD di sviluppo (FPS, frame time, draw call,
triangoli) e per i tasti qui sotto. Con `?dev&baketest` viene caricata anche la
scena di verifica della pipeline asset, esclusa dalla build di produzione.

| tasto | cosa fa |
|---|---|
| `P` | porta la camera alla posa di riferimento |
| `G` | spegne uno stadio del composite per volta, e poi li riaccende tutti |
| `B` | rifà la taratura della qualità da zero |
| `V` | erba sì/no (l'unica cosa disegnata in tempo reale) |
| `C` | nuvole sì/no |
| `R` | **gocce di pioggia sulla visuale**: l'anteprima dell'effetto meteo |

`?dev&t0` ferma l'orologio del mondo (il velo d'arrivo tiene invece di
dissolversi: è l'unico modo di fotografare due volte la stessa composizione).
`?dev&pioggia` parte con le gocce già accese.

### L'occhio

Sopra il composite ci sono gli effetti d'ottica di `src/core/eye.js`:

- **fuoco come accomodazione dello sguardo.** Dove l'occhio è a fuoco è la
  **profondità al centro dello schermo**, letta dal fotogramma stesso e seguita
  con un focus pull smorzato: guarda una faccia e il piano ci va sopra, guarda
  il crinale e ci va sopra il crinale. Non è mai «la distanza del monolite più
  vicino», che è quello che era e il motivo per cui girando la testa si vedeva
  tutto sfocato. **Quanto** si vede è invece l'attenzione: il monolite dev'essere
  a portata di `E` **e lo devi stare guardando** (l'intensità sale dolcemente
  entro una trentina di gradi di scarto e sfuma in mezzo secondo se guardi
  altrove), oppure tieni premuto il tasto destro, che è più marcato. Passare
  accanto a un blocco senza guardarlo non accende niente.
- **adattamento luminoso** secondo dove si guarda, quasi mezzo stop di corsa in
  due-tre secondi. Guarda il sole, poi guarda il prato: si sente l'occhio
  aprirsi.
- **il sole in vista**, e adesso **dentro la luce di scena e non sopra il quadro
  finito**: quello che il sole aggiunge passa per l'esposizione e per la curva
  come ogni altra cosa luminosa, quindi si arrotola invece di tagliare. Raggi
  che nascono dove il cielo lascia passare e si spengono contro la pietra; un
  flare sobrio — un alone, una stria anamorfica e tre ghost sull'asse verso il
  centro del quadro — che **sfuma quando il disco finisce dietro un monolite**;
  e sotto tutto il velo d'abbaglio, che è una legge dell'angolo e c'è anche col
  disco fuori quadro — ma **non dietro una pietra**: ogni cosa disegnata AL sole
  chiede se il disco è scoperto, velo compreso. La stria **respira**, di poco e
  senza mai un ciclo riconoscibile, e solo nello spessore. Raggi e flare
  esistono **solo mentre il disco è sul vetro**: fuori quadro il cielo sigillato
  è esattamente quello di sempre.
- **gocce sulla visuale** (tasto `R`): **poche grandi e molte piccole**, che è la
  distribuzione che ha la pioggia vera; le piccole restano incollate dove sono
  cadute e solo le grandi corrono, perché sotto una taglia critica il vetro le
  trattiene. Scendono quasi verticali con un micro-scarto — non serpeggiano —
  a strappi come fa l'acqua, e **non risalgono mai**: la discesa è monotona per
  costruzione. Sono **appuntate al vetro** — girare la testa non le sposta di un
  pixel — e sono **una forma sola**, un menisco allungato dalla gravità che si
  assottiglia nella sua scia senza nessun confine in mezzo. Finiscono
  assottigliandosi o fondendosi con un'altra, mai sparendo di colpo. Sotto, un
  velo di micro-gocce e una lente bagnata su tutto il quadro.

**Tutti tacciono finché non si è fatto il primo passo, e tornano a riposo esatto
appena qualcuno PIAZZA il camminatore** (tasto `P`, pose di survey,
`window.setDevPose`, la taratura): alle pose di misura il fotogramma è quello di
prima che questi effetti esistessero, e su 13 pose su 13 lo è entro il pavimento
dello strumento.

Si tarano camminando, da console, e il valore cambiato vale dal fotogramma dopo:

```js
farfield.renderer.post.params.eye   // quanto fuoco, quanto sole, le gocce
farfield.eye.tuning                 // quando, e con che tempi
farfield.renderer.post.stages       // focus · adaptation · glare · sun · rain
```

Tre scale già pronte, se si vuole una parola invece di dieci numeri:

| | fuoco (`focusStrength` · `focusSpread` · `focusReach`) | sole (`glareStrength` · `raysAmount` · `flareHalo`) |
|---|---|---|
| **accennato** | `0.55` · `1.8` · `9` | `0.08` · `0.25` · `0.30` |
| **consegnato** | `1.0` · `2.6` · `13` | `0.14` · `0.40` · `0.45` |
| **marcato** | `1.3` · `3.6` · `18` | `0.22` · `0.70` · `0.70` |

`focusSpread` è la manopola della **gradualità**: più basso, più il passaggio da
nitido a morbido è disteso sulla profondità; più alto, più diventa un
interruttore. `focusReach` è quanto è larga la sfocatura, in pixel, e non cambia
il costo. Le ampiezze del sole sono in **unità di luce**, non in livelli del
quadro finito: i numeri della consegna precedente non vogliono più dire quello
che volevano dire.

E le manopole della quarta passata, con quello che fanno:

```js
farfield.renderer.post.params.eye.focusFloorPx  // [1.5, 4.0] — il cerchio, IN PIXEL,
//   sotto il quale la copia sfocata non dice niente. Sotto un pixel e mezzo non
//   c'è nulla che otto bit possano portare; a quattro il cerchio è largo quanto
//   UN TEXEL del buffer da cui si legge. È quello che toglie l'alone attorno
//   alle incisioni a fuoco, e non tocca il prato né il crinale.
farfield.renderer.post.params.eye.streakBreath  // 0.16 — di quanto RESPIRA lo
//   spessore della stria anamorfica. A ZERO la stria è identica al bit a quella
//   consegnata. Solo lo spessore si muove: lunghezza e intensità lo compensano
//   con esponenti esatti, così la luce che ci sta dentro non pulsa mai.
farfield.renderer.post.params.eye.rainDrag      // 0.0 — quanto il girare della
//   testa trascina una goccia sul vetro. A zero le gocce sono APPUNTATE al
//   vetro, che è quello che fa un vetro. A uno si torna alla dose che le faceva
//   nuotare dietro la camera; qualcosa come 0.15 è un'inerzia appena percepibile.
```

E quelle della quinta:

```js
farfield.renderer.post.params.eye.focusInkKeep  // 1.0 — se l'INCHIOSTRO rifiuta
//   di sfocarsi con la pietra in cui è inciso. A uno le incisioni restano
//   nitide ovunque, dentro e fuori dal piano di fuoco, e la pietra attorno a
//   loro resta morbida come deve; a zero si torna a un'ottica onesta, in cui la
//   scritta va morbida insieme alla faccia. Stessa soglia e stesso ginocchio
//   del bloom, e mai una terza — su tutti e due i fotogrammi, il nitido e la
//   copia sfocata, perché tenere nitido il glifo senza togliere la sua luce
//   dalla copia sfocata lo lascia dentro un alone del suo stesso chiarore.
farfield.renderer.post.params.eye.rainTrail     // 0.12 — quanto si vede la PISTA
//   BAGNATA dietro una goccia che scivola. Non è una scia disegnata: è il velo
//   che il film d'acqua lascia sul vetro, largo quanto la goccia e scuro di un
//   cinque per cento appena. Sopra 0.3 comincia a leggersi come un segno.
farfield.renderer.post.params.eye.rainDrying    // 7.0 — quanto in fretta quella
//   pista si asciuga, cioè quanto si accorcia. Sette la porta a due o tre volte
//   la lunghezza della goccia; sotto due arriva in fondo al vetro, e una pista
//   lunga tutto il quadro torna a leggersi come una linea per quanto sia larga.
farfield.renderer.post.params.eye.rainMerge     // 0.09 — di quanto CRESCE una
//   goccia in corsa ogni volta che assorbe una statica sul suo cammino, come
//   quota della taglia con cui è nata. Contata sulla battuta con cui la goccia
//   già si ferma e riparte: si ferma, prende, e va.
```

## Pipeline asset

```
npm run setup:tools    # scarica e verifica gli strumenti KTX
npm run assets:build   # assets-src/ -> public/assets/ (glb meshopt + KTX2)
```

`setup:tools` è idempotente e installa tutto sotto `tools/bin`, che resta fuori
dal repo. I sorgenti degli asset stanno in
`assets-src/` e sono descritti da `assets-src/assets.json`, che dichiara anche
il budget del primo frame camminabile; `assets:build` fallisce se il budget
viene superato.

## Contenuti

Il testo del sito vive in `content/*.json`, un file per sezione. Le voci ancora
da confermare con il committente sono marcate `"stato": "in_attesa_committente"`
e riportano in `"nota"` che cosa manca e in `"fonte"` da dove viene il testo
provvisorio.
