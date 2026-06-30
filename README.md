# Cam Runner

Gra typu "subway surfer" sterowana ruchem ciała przed kamerką.
Wykrywanie pozy i usuwanie tła dzieje się w Pythonie (MediaPipe), gra renderuje się
w przeglądarce na canvasie (HTML/CSS/JS), dane przesyłane są przez WebSocket.

## Dlaczego nie NVIDIA?

Rozwiązania typu NVIDIA Maxine wymagają karty RTX i zamkniętego SDK/kluczy API.
Ten projekt celowo używa **MediaPipe** — w 100% darmowe, open-source, działa na
zwykłym CPU (NVIDIA nie jest wymagana, choć jeśli masz kartę, część operacji może
być przyspieszona automatycznie).

## Struktura plików

```
server.py            -> backend Python: kamera, pose detection, segmentacja tła
requirements.txt     -> zależności Python
templates/index.html -> struktura strony
static/style.css     -> wygląd (główne okno na pełną szerokość, podgląd w rogu)
static/game.js       -> logika gry i renderowanie canvas
```

## Instalacja

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Uruchomienie

```bash
python server.py
```

Następnie otwórz w przeglądarce: **http://localhost:5000**

## Sterowanie

- **Trucht w miejscu** – gra rusza (oscylacja kolan musi być wykrywana)
- **Przechył ramion w lewo/prawo** – zmiana pasa
- **Przysiad** – kucnięcie (omijanie niskich przeszkód)
- **Podskok** – skok (omijanie wysokich przeszkód)
- Przycisk **"Rekalibruj pozycję"** – jeśli sterowanie "dryfuje", ustaw nową pozycję bazową stojąc neutralnie i kliknij go

## Uwagi

- Wymaga działającej kamery internetowej i niezbyt ciemnego pomieszczenia.
- Pierwsze uruchomienie może chwilę trwać (MediaPipe ładuje modele).
- Jeśli masz więcej niż jedną kamerę, zmień `CAMERA_INDEX` w `server.py`.
