# Carp Diem — Clan War Tracker

Web stranica za praćenje clan war fightova (kao u tvojim primjerima "tablica1" i "tablica2"):
kalendar po danima, unos podataka prije/poslije fighta, i automatsko generiranje tablice
s rank pozicijom svakog igrača po danu ("-" ako igrač nije igrao taj dan, prazno ako
igrač tada još nije bio član).

## Kako hostati na GitHub Pages (besplatno)

1. Napravi novi repozitorij na GitHubu, npr. `carp-diem-tracker`.
2. Ubaci u njega sve datoteke iz ovog foldera (`index.html`, `style.css`, `app.js`, `README.md`).
   - Najlakše preko web sučelja: "Add file" → "Upload files" → povuci sve 3 datoteke → Commit.
3. Idi u repozitoriju na **Settings → Pages**.
4. Pod "Build and deployment" → "Source" odaberi **Deploy from a branch**, grana `main`, folder `/ (root)`, pa Save.
5. Za par minuta stranica će biti dostupna na `https://<tvoj-username>.github.io/carp-diem-tracker/`.

Nije potreban nikakav backend, build proces ni baza podataka — sve je čisti HTML/CSS/JS.

## Kako radi

### Kalendar
Otvori se na kartici "Kalendar". Klikneš na dan da otvoriš unos za taj fight. Dani s
unesenim podacima obojani su zeleno (WIN) ili narančasto (LOSS).

### Unos po danu (prije/poslije fighta)
- **Prije fighta**: učitaš screenshot(ove) ekrana s podacima o meču (naš klan i protivnik,
  trofeji/pozicija/liga). Aplikacija pokuša automatski pročitati brojeve sa slike (OCR,
  radi lokalno u pregledniku preko Tesseract.js) i unaprijed popuni polja — **uvijek
  provjeri i po potrebi ispravi** jer OCR na stiliziranom sučelju igre nije 100% pouzdan.
  Ispod je i "sirovi OCR tekst" za ručnu provjeru.
- **Poslije fighta**: učitaš screenshot(ove) konačnog rezultata (može ih biti više, jer
  igra prikazuje rang listu igrača na više ekrana/stranica). Aplikacija pokuša pročitati
  rank, ime i score svakog igrača i final score obje strane. Redovi koji se pojave na
  više screenshotova (isti rank) se automatski ne dupliciraju.
- Svako polje možeš ručno dodati/izmijeniti/obrisati prije spremanja.
- WIN/LOSS se automatski određuje usporedbom finalnih rezultata.

### Novi igrači
Kad upišeš ime igrača kojeg tablica još nema, automatski se dodaje kao novi red u tablici
(abecedno sortirano, kao u primjeru).

### Tablica
Kartica "Tablica" generira prikaz identičan tvojim primjerima: mjesec je podijeljen na
blokove 1-14 i 15-kraj mjeseca, stupac po danu kad postoji unos, redak po igraču. Klik na
WIN/LOSS ćeliju otvara taj dan za uređivanje.

### Spremanje podataka
Svi podaci se spremaju u `localStorage` tvog preglednika (na tom računalu/pregledniku).
- **Export JSON** — skini sigurnosnu kopiju svih podataka.
- **Import JSON** — učitaj podatke (npr. na drugom računalu, ili nakon brisanja cache-a).

> Napomena: budući da je ovo statična GitHub Pages stranica bez servera, podaci se ne
> sinkroniziraju sami automatski između više uređaja/ljudi. Ako više ljudi treba unositi
> podatke i vidjeti istu tablicu uživo, potreban je pravi backend (npr. besplatna baza
> tipa Firebase/Supabase) — javi ako to želiš pa mogu to dodati.

## Ograničenje automatskog čitanja sa slike (OCR)

Stranica koristi Tesseract.js (OCR knjižnica koja radi u pregledniku, bez slanja slika
ikamo) da pokuša pročitati brojeve i imena sa screenshotova. To je dobra pomoć za brže
popunjavanje, ali OCR na igricama s ikonicama, bojama i posebnim fontovima nikad nije
100% točan — zato su sva polja uvijek uređivana i ništa se ne sprema dok ti sam ne
potvrdiš "Spremi".
