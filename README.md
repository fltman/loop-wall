# Loop Wall

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

Ett publikt, interaktivt konstverk: en videovägg där förbipasserande spelar musik med
kroppen. Kameran ser dig, väggen visar bara en lysande streckgubbe, aldrig kamerabilden,
och musiken går hela tiden. Kroppen vrider på rattarna, ungefär som när man vrider på
rattarna i en modulärsynt.

Allt körs i webbläsaren: MediaPipe Pose läser kroppen lokalt (ingen bild lämnar datorn
och ingen bild sparas), ljudet syntetiseras med Web Audio och finalens effekter är
[Patchwerks](https://github.com/fltman/patchwerk) GLSL-noder.

## Lägen

### Grundflödet: `?flow`

En låt byggs lager för lager av främlingar, ett instrument i taget och i fast ordning:
**trummor** (sätter takten), **bas**, **ackord**, **melodi**, **slagverk**, **arpeggio**.

1. En dämpad kick-puls går hela tiden.
2. Kliv in: du får nästa instrument, och det svarar på armarna direkt.
3. Lyft en arm: inspelningen börjar på nästa taktslag.
4. Spela så länge du vill. Sänk armarna och stå still, så är lagret klart (1, 2, 4 eller
   8 takter). Själva sänkningen spelas inte in.
5. Ditt spöke ställer sig i kören och vrider rattarna som du gjorde. Står du kvar får du
   nästa instrument.
6. När alla sex lager finns blir det en minuts final: hela låten med fyra olika
   Patchwerk-looks, olika varje runda, med dansarna i formationer. Sedan börjar allt om.

### Livejammet: `?jam`

Bilden delas i sex zoner från vänster till höger, en per instrument. Du styr dockan i
zonen där du står, och byter instrument genom att byta plats. Alla zoner utan människa
spelas av en docka, så folk kan hoppa in och av. Människor markeras med spotlight;
dockorna är dämpade. `?jam&nopuppets` = bara människor.

## Rattarna

Varje instrument har tre rattar, och samma regel gäller överallt: nere eller nära är mörkt
och glest, uppe eller isär ljust och tätt.

| Instrument | Vänster arm | Höger arm | Avståndet mellan händerna |
|---|---|---|---|
| Trummor | energi | ton | röststötar |
| Bas | cutoff | toner i sekvensern | squelch |
| Ackord | cutoff | ackord per stöt | längd |
| Melodi | cutoff | toner i sekvensern | eko |
| Slagverk | energi | tonhöjd | bitcrush |
| Arpeggio | cutoff | toner i sekvensern | oktaver |

Armens vinkel från axeln är rattens läge: hängande arm är noll, rakt upp är fullt. För de
tonala instrumenten är höger arm en penna som flyttar tonerna i sekvensern (syns som en
stegrad): rakt ut ändrar inget, högre flyttar uppåt, lägre nedåt, alltid i skalan.

## Kör

```bash
npm install
npm run models   # hämtar MediaPipe-modellerna till models/
npm start        # http://127.0.0.1:8340/?flow
```

| Parameter | |
|---|---|
| `?flow` / `?jam` | grundflödet / livejammet |
| `?debug` (tangent `d`) | rattarna, faser, kamerabilden i hörnet med modellens punkter |
| `?puppet` | en docka dansar i stället för kameran (grundflödet) |
| `?autostart` | kiosk: Chrome med `--autoplay-policy=no-user-gesture-required` |
| `?bpm=` `?bars=` `?rest=` `?show=` | tempo, fast lagerlängd, vila efter en tagning, finalens längd i sekunder |
| `?cam=43` `?camera=<namn>` | hela 4:3-sensorn (mer av benen), välj kamera (t.ex. `iphone`) |

Tangenter: `d` debug, `f` helskärm, `c` töm väggen.

Tidigare prototyper finns kvar: `?inst=drums` / `?inst=melody` (synliga instrument runt
axlarna) och läget utan parameter (den första kartan).

## Test

```bash
npm test         # logik, kroppsmått, sekvenser, lager, zoner, finalens urval
npm run smoke    # riktig Chrome: dockan bygger lager, låtsaskamera genom MediaPipe
```

Testerna dansas av en docka (`src/puppet.js`). De visar att kedjan hänger ihop, inte att
gränserna stämmer för alla kroppar; det avgörs framför kameran med `?debug`.

## Tack

- [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (Apache 2.0) för kroppspunkterna.
- [Patchwerk](https://github.com/fltman/patchwerk) (MIT) för finalens effekter, kopierat till `src/vendor/patchwerk/`.

## Licens

MIT, se [LICENSE](LICENSE).
