"""Svenska butikskategorier — placera varje ingrediens i en typisk supermarket-sektion.

Keyword-baserad matcher med svensk + lite engelsk täckning. Ordningen i CATEGORIES
används för UI-sortering i ShoppingList.
"""

import re

CATEGORIES = [
    "Frukt & Grönt",
    "Kött & Fisk",
    "Mejeri",
    "Skafferi",
    "Fryst",
    "Bröd",
    "Övrigt",
]

# Lägre = mer specifik, ta först. Multiords får företräde framför enstaka ord
# eftersom vi sorterar nycklar efter längd innan vi söker.
_KEYWORDS: dict[str, list[str]] = {
    "Frukt & Grönt": [
        "tomat", "körsbärstomat", "gurka", "paprika", "lök", "rödlök", "gul lök",
        "vitlök", "schalottenlök", "salladslök", "purjolök",
        "potatis", "sötpotatis", "morot", "morötter", "selleri", "rotfrukt",
        "broccoli", "blomkål", "kål", "vitkål", "rödkål", "spetskål", "grönkål",
        "spenat", "ruccola", "sallad", "isbergssallad", "babyspenat", "majs",
        "äpple", "päron", "banan", "apelsin", "citron", "lime", "mango", "kiwi", "ananas",
        "vindruvor", "hallon", "blåbär", "jordgubb", "bär",
        "ingefära", "chili", "färsk koriander", "persilja", "dill", "basilika",
        "mynta", "timjan", "rosmarin", "oregano",
        "avokado", "champinjon", "champinjoner", "svamp", "kantarell", "ärt",
        "haricot", "gröna bönor", "auberg", "zucchini", "squash",
    ],
    "Kött & Fisk": [
        "kyckling", "kycklingfilé", "kycklinglår", "kycklingbröst",
        "nötfärs", "fläskfärs", "blandfärs", "köttfärs",
        "fläsk", "fläskfilé", "fläskkarré", "skinka", "bacon",
        "nötkött", "biff", "entrecôte", "ryggbiff", "innanlår",
        "kebabkött", "korv", "falukorv", "chorizo", "bratwurst", "isterband",
        "kalkon", "lamm",
        "lax", "torsk", "kolja", "sej", "räkor", "räka", "krabba", "musslor",
        "tonfisk", "makrill", "ansjovis", "sill", "fisk",
    ],
    "Mejeri": [
        "mjölk", "minimjölk", "mellanmjölk", "standardmjölk", "havremjölk",
        "smör", "margarin", "bregott",
        "ost", "hårdost", "färskost", "philadelphia", "feta", "halloumi",
        "parmesan", "cheddar", "präst", "mozzarella",
        "grädde", "vispgrädde", "matlagningsgrädde",
        "yoghurt", "kvarg", "keso", "cottage cheese", "fil", "creme fraiche", "crème fraiche",
        "kesella", "ägg", "äggula", "äggvita",
    ],
    "Fryst": [
        "fryst", "frysta", "djupfryst", "djupfrysta",
        "glass", "ärtor", "majskolv", "fryst sp",
    ],
    "Bröd": [
        "bröd", "tunnbröd", "knäckebröd", "rågkaka", "hamburgerbröd", "korvbröd",
        "tortilla", "wraps", "pitabröd", "naan", "limpa", "baguette",
    ],
    "Skafferi": [
        "pasta", "spaghetti", "makaroner", "lasagneplattor", "penne", "fusilli",
        "ris", "basmati", "jasmin", "fullkornsris",
        "couscous", "bulgur", "quinoa",
        "mjöl", "vetemjöl", "rågmjöl", "havregryn", "müsli", "flingor",
        "olja", "olivolja", "rapsolja", "smör", "vinäger", "balsamico",
        "soja", "fisksås", "ostronsås", "hoisin", "sriracha",
        "salt", "peppar", "kryddor", "paprikapulver", "spiskummin", "kanel", "kardemumma",
        "buljong", "fond", "tärning",
        "tomatkross", "krossade tomater", "tomatpuré", "ketchup", "majonnäs",
        "kokosmjölk", "kokosgrädde", "kokos",
        "bönor", "kikärtor", "linser", "kidneybönor", "svarta bönor",
        "honung", "sirap", "socker", "strösocker", "florsocker", "farinsocker",
        "choklad", "kakao",
        "jäst", "bakpulver", "vaniljsocker", "bikarbonat",
        "ajvar", "tahini", "hummus",
        "nötter", "mandel", "valnötter", "cashew", "jordnötter", "frön",
    ],
}

# Pre-compute compiled regexes — longest first to avoid "lök" matching "vitlök"
_COMPILED = []
for cat, words in _KEYWORDS.items():
    for w in sorted(words, key=len, reverse=True):
        # \b only works on word-chars; å/ä/ö are word-chars in unicode so OK
        _COMPILED.append((cat, re.compile(rf"\b{re.escape(w)}", re.IGNORECASE)))


def categorize(name: str) -> str:
    """Return the supermarket section for an ingredient name."""
    if not name:
        return "Övrigt"
    text = name.lower()
    for cat, rx in _COMPILED:
        if rx.search(text):
            return cat
    return "Övrigt"


def sort_key(category: str) -> int:
    try:
        return CATEGORIES.index(category)
    except ValueError:
        return len(CATEGORIES)
