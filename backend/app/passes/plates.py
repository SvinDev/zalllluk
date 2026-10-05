"""Нормализация автомобильных номеров.

В российских номерах используются 12 букв, совпадающих по начертанию с латиницей
(А В Е К М Н О Р С Т У Х). Охрана вбивает номер как получится — латиницей,
кириллицей, с пробелами, — поэтому сравниваем номера только в нормализованном виде.
"""

import re

_LATIN_TO_CYRILLIC = str.maketrans("ABEKMHOPCTYX", "АВЕКМНОРСТУХ")
_ALLOWED = re.compile(r"^[0-9А-ЯЁA-Z]{4,12}$")


def normalize_plate(raw: str) -> str:
    compact = re.sub(r"[\s\-_.]", "", raw).upper()
    return compact.translate(_LATIN_TO_CYRILLIC)


def is_valid_plate(normalized: str) -> bool:
    return bool(_ALLOWED.match(normalized))
