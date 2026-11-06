// Allt som går att skruva på, samlat på ett ställe. Några värden går att
// skriva över med URL-parametrar (?bpm=, ?bars=, ?latency=, ?rest=).

export function makeConfig(search = '') {
  const q = new URLSearchParams(search);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && Number.isFinite(+q.get(k)) ? +q.get(k) : d);
  return {
    bpm: num('bpm', 112),
    beatsPerBar: 4,
    // Lagret blir så långt som man dansar: står man still i stillBeats slag slutar
    // tagningen, avrundad till hela takter (1 till maxBars). ?bars=N ger fast längd.
    // (Vid 112 BPM är en takt 2,1 s.)
    maxBars: 8,
    showSeconds: num('show', 60), // finalen när alla sex lager finns
    stillBeats: 2,
    fixedBars: q.has('bars') ? num('bars', 4) : null,
    stepsPerBeat: 4,
    restBars: num('rest', 4), // vila efter en tagning (högst lika lång som lagret), sedan nästa
    minNotes: 3, // färre toner än så = personen stod still, inget lager
    latency: num('latency', 0.1), // sekunder från rörelse till att vi ser den (kamera, modell, slagdetektor)
    commitAhead: 0.4, // slag före tagningens slut då lagret lämnas till schemat
    presence: { enter: 0.6, leave: 1.5, minScale: 0.06, xMin: 0.15, xMax: 0.85 },
    // Kroppsmåtten. Hastigheter i torsolängder per sekund, höjder i torsolängder
    // över axlarna. Gränserna är gissningar tills någon har dansat framför kameran.
    meter: {
      deadZone: 0.5, // torsolängder/s som räknas som stillhet per kroppsdel
      // Känsligheten följer dansaren: den starkaste rörelsen på sistone lyfts
      // mot target, högst maxGain gånger. Under floor räknas det som stillhet.
      gain: { target: 0.55, maxGain: 3, floor: 0.04, halfLife: 8 },
      posTau: 0.06,
      moveTau: 0.25,
      armsTau: 0.15,
      handTau: 0.08, // handens höjd → tonhöjd: snabbt, så att tonen följer handen
      handMoveTau: 0.12, // handens fart → om och hur ofta den spelar
      arms: [-1.1, 1.0],
      armsMove: [0.6, 4.5],
      legs: [0.4, 3.0],
      energy: [0.2, 3.5],
      spread: [0.5, 2.8],
      side: [-1.4, 1.4], // händernas mitt, torsolängder till vänster/höger om kroppen
      // Slag i rörelsen: nedåtfart i torsolängder/s, sedan under on × rearm innan nästa.
      accent: { on: 1.6, rearm: 0.5, refractory: 0.1 },
    },
    scale: [0, 3, 5, 7, 10], // moll-pentatonisk på D: kan inte låta fel
  };
}
