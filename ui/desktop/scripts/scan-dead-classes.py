#!/usr/bin/env python3
"""Report Tailwind token classes that generate no CSS.

A class whose theme token was never registered in `src/styles/main.css`'s
`@theme inline` block produces no rule at all: the name lands in the DOM and
nothing styles it. That is silent — the build passes, typecheck passes, unit
tests pass — so it can only be caught by comparing the source against the CSS
the bundler actually emitted.

Usage (needs the vite dev server running):

    cd ui/desktop
    python3 scripts/scan-dead-classes.py
    python3 scripts/scan-dead-classes.py --css /tmp/gen.css --out snapshot.txt

Exit code is 0 even when dead classes are found; this is a report, not a gate.
Wire it into CI as a non-blocking report first, then decide.
"""

import argparse
import glob
import re
import sys
import urllib.request
from collections import Counter, defaultdict

CSS_URL = "http://localhost:5173/src/styles/main.css?direct"

# Utilities that are stock Tailwind (sizes, palette, layout) rather than theme
# tokens. Only theme tokens are reported, so these are excluded.
STOCK = re.compile(
    r"-(sm|xs|md|lg|xl|2xl|red|blue|green|yellow|purple|gray|grey|white|black"
    r"|transparent|left|right|center|full|none|current|top|bottom)$"
)

# A colour token, optionally carrying a Tailwind opacity modifier
# (`bg-red-900/20`). The modifier must be captured together with the class:
# the emitted selector carries it too, so without this a working class is
# reported dead purely because the two spellings differ.
_TOKEN = r"(?:bg|text|border|ring|fill|stroke)-[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*(?:\/[0-9]+)?"

# The negative lookbehind keeps token-definition object keys
# (`'--color-text-tertiary'` in theme-tokens.ts) from matching: a real utility
# class is never preceded by `-` or a word character.
CLASS_RE = re.compile(
    rf"(?<![-\w])(?:[a-z][a-z0-9-]*:)+{_TOKEN}"  # optional variant prefixes
    rf"|(?<![-\w]){_TOKEN}"
)


def fetch_css(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.read().decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 - report and continue
        print(f"warning: could not fetch {url}: {error}", file=sys.stderr)
        print("         pass --css with a pre-downloaded copy", file=sys.stderr)
        return ""


def class_is_generated(unescaped_css: str, class_name: str) -> bool:
    """True when `class_name` appears as a class in the compiled CSS.

    Emitted selectors escape `:` and `/` and append attribute/pseudo parts
    (`data-[variant=destructive]:focus:bg-x/10[data-variant=destructive]:focus`),
    so an exact selector comparison is unreliable. Matching the class as a
    bounded substring tolerates those decorations while still refusing partial
    names (`text-info` must not match inside `text-text-info`).
    """
    return (
        re.search(
            r"(?<![-\w])" + re.escape(class_name) + r"(?=[\s,{:\[])",
            unescaped_css,
        )
        is not None
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--css", help="path to the generated CSS (skips fetching)")
    parser.add_argument("--out", help="also write the report here")
    parser.add_argument(
        "--fail-on-dead",
        action="store_true",
        help="exit 1 when any dead class is found (use as a CI gate)",
    )
    args = parser.parse_args()

    css = open(args.css).read() if args.css else fetch_css(CSS_URL)
    if not css:
        return 2
    # Tailwind escapes `/` and `:` in emitted selectors; undo the escaping once
    # so source and emitted spellings compare equal.
    unescaped = css.replace("\\", "")

    files = glob.glob("src/**/*.tsx", recursive=True) + glob.glob("src/**/*.ts", recursive=True)
    counts: Counter[str] = Counter()
    where: defaultdict[str, set[str]] = defaultdict(set)

    for path in files:
        with open(path) as handle:
            for raw in CLASS_RE.findall(handle.read()):
                core = raw.split(":")[-1]
                if STOCK.search(core) or len(core) < 8:
                    continue
                if class_is_generated(unescaped, raw) or class_is_generated(
                    unescaped, core
                ):
                    continue
                counts[raw] += 1
                where[raw].add(path)

    affected = {path for paths in where.values() for path in paths}
    lines = [
        f"SCANNED_FILES={len(files)}  TOTAL={sum(counts.values())}  "
        f"KINDS={len(counts)}  FILES_AFFECTED={len(affected)}",
        "",
    ]
    for name, uses in sorted(counts.items(), key=lambda kv: (-len(where[kv[0]]), -kv[1])):
        paths = sorted(where[name])
        sample = ",".join(p.replace("src/", "") for p in paths[:4])
        lines.append(f"{name}\t{uses}\t{len(paths)}\t" + sample + (" …" if len(paths) > 4 else ""))

    report = "\n".join(lines)
    print(report)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(report + "\n")
        print(f"\nwritten to {args.out}", file=sys.stderr)
    return 1 if args.fail_on_dead and counts else 0


if __name__ == "__main__":
    sys.exit(main())