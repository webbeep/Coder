# slugify

`slugify(title)` turns a title into a URL slug:

1. Lowercase it.
2. Remove accents (é → e, ü → u, ñ → n).
3. Replace every run of characters that are not a-z or 0-9 with a single `-`.
4. Remove `-` from the start and end.
5. If the result is longer than 50 characters, cut it to 50 and remove any trailing `-`.

`slugify("")` is `""`.
