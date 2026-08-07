#!/usr/bin/env python3
"""Build compiled Knowledge Packs from packs/src/*.txt.

Source format supports:
  # Pack Name / @key: value      — pack metadata
  === Chapter ===  or  ## Chapter — chapter header
  lhs = rhs                      — formula line (prompt becomes "lhs = ?",
                                    answerTokens = splitRhs(rhs))
  Q: / A: / D: / T:              — explicit item format (backward compatible)

Outputs:
  packs/<slug>.json          — compiled packs (importable / testable)
  js/data/sample-packs.js    — window.FT_SAMPLE_PACKS = [...] (bundled for seeding)

Deterministic (seeded RNG) so rebuilds produce identical packs.
Usage: python3 packs/build_packs.py
"""
import json
import os
import random
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "packs", "src")
OUT_DIR = os.path.join(ROOT, "packs")
JS_OUT = os.path.join(ROOT, "js", "data", "sample-packs.js")
SEED = 20260807
SCHEMA_VERSION = 1

GENERIC_DISTRACTORS = ["x", "y", "1", "0", "2", "π", "√", "²", "θ", "=", "+", "−"]

# chapter name -> default difficulty (used when a formula line has no D:)
CHAPTER_DIFF = {
    "double angle": 2,
    "half angle": 3,
    "triple angle": 4,
    "product to sum": 3,
    "sum to product": 4,
}


def tokenize(text):
    """Exact tokenizer — kept for the explicit Q:/A: format (matches core.js)."""
    out = []
    for part in text.split():
        for atom in re.split(r"([=+\-\u00d7\u00f7\u00b7/\^\u221a()\[\]{}<>\u2264\u2265\u2248\u00b1\u007e])", part):
            atom = atom.strip()
            if atom:
                out.append(atom)
    return out


def split_rhs(rhs):
    """Port of engine splitRhs(): split RHS into buildable parts."""
    s = rhs.strip()
    if not s:
        return []
    ops = set("+-/\u00b7\u00d7")
    depth = 0
    segs = []
    cur = ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0 and ch in ops:
            if cur.strip():
                segs.append(cur.strip())
            segs.append("\u2212" if ch == "-" else ch)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        segs.append(cur.strip())

    folded = []
    i = 0
    while i < len(segs):
        if i == 0 and segs[i] in ops and i + 1 < len(segs):
            folded.append(segs[i] + segs[i + 1])
            i += 2
        else:
            folded.append(segs[i])
            i += 1

    out = []
    token_start = re.compile(r"[A-Za-z0-9(\u221a\u03c0\u03b8]")
    for seg in folded:
        if seg in ops:
            out.append(seg)
            continue
        chunk = ""
        for idx, ch in enumerate(seg):
            nxt = seg[idx + 1] if idx + 1 < len(seg) else ""
            chunk += ch
            if ch == ")" and nxt and token_start.match(nxt):
                out.append(chunk)
                chunk = ""
        if chunk:
            out.append(chunk)
    return out


def slug(s):
    s = re.sub(r"[^a-z0-9\u0e00-\u0e7f]+", "-", s.lower()).strip("-")
    return s[:40] or "pack"


def parse_pack(path):
    meta = {}
    items = []
    chapter = ""
    cur = None

    def flush():
        nonlocal cur
        if cur is not None:
            if not cur["answer"]:
                raise ValueError(f"{path}: item '{cur['prompt']}' missing answer")
            items.append(cur)
            cur = None

    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n").strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("@"):
                key, _, val = line[1:].partition(":")
                meta[key.strip()] = val.strip()
                continue
            if line.startswith("===") or line.startswith("##"):
                chapter = line.strip("= #").strip()
                continue
            if line.startswith("Q:"):
                flush()
                cur = {"prompt": line[2:].strip(), "answer": "", "difficulty": 2, "tags": [], "chapter": chapter, "formula": False}
                continue
            if line.startswith("A:"):
                if cur is None:
                    raise ValueError(f"{path}: A: without Q: ({line})")
                cur["answer"] = line[2:].strip()
                continue
            if line.startswith("D:"):
                if cur is not None:
                    cur["difficulty"] = int(line[2:].strip())
                continue
            if line.startswith("T:"):
                if cur is not None:
                    cur["tags"] = [t.strip() for t in line[2:].split(",") if t.strip()]
                continue
            if "=" in line and not line.startswith(("Q", "A", "D", "T")):
                # formula line: lhs = rhs
                flush()
                lhs, _, rhs = line.partition("=")
                diff = CHAPTER_DIFF.get(chapter.strip().lower(), 2)
                cur = {
                    "prompt": f"{lhs.strip()} = ?",
                    "answer": rhs.strip(),
                    "difficulty": diff,
                    "tags": [slug(chapter) or "identity"],
                    "chapter": chapter,
                    "formula": True,
                }
                flush()
                continue
            raise ValueError(f"{path}: cannot parse line: {line!r}")
    flush()

    for key in ("id", "name", "version", "subject"):
        if key not in meta:
            raise ValueError(f"{path}: missing @{key}")
    meta.setdefault("author", "")
    meta.setdefault("description", "")
    meta["schemaVersion"] = SCHEMA_VERSION
    return meta, items


def decompose_rhs(rhs):
    """Port of engine decomposeRhs(): content parts + structure template.
    '@' marks a content slot; '/' and grouping parens are pre-provided
    structure; '√'/'±√' prefixes mark a radical whose paren group is the
    radicand. Operators (+/−) stay in content."""
    parts = []
    structure = []

    def walk(plist):
        for p in plist:
            if p == "/":
                structure.append("/")
            elif p.startswith("(") and p.endswith(")"):
                structure.append("(")
                walk(split_rhs(p[1:-1]))
                structure.append(")")
            else:
                m = re.match(r"^(±?√)(.*)$", p)
                if m and m.group(2).startswith("(") and m.group(2).endswith(")"):
                    structure.append(m.group(1))
                    structure.append("(")
                    walk(split_rhs(m.group(2)[1:-1]))
                    structure.append(")")
                else:
                    structure.append("@")
                    parts.append(p)

    walk(split_rhs(rhs))
    return structure, parts


def build_pack(meta, items):
    bank = set(GENERIC_DISTRACTORS)
    tokenized = []
    structures = []
    for it in items:
        if it["formula"]:
            structure, toks = decompose_rhs(it["answer"])
            structures.append(structure)
        else:
            toks = tokenize(it["answer"])
            structures.append(None)
        bank.update(toks)
        tokenized.append(toks)

    rng = random.Random(SEED + len(meta["id"]))
    available = []
    for toks in tokenized:
        answer_set = set(toks)
        pool = sorted(bank - answer_set)
        n = min(10, max(4, len(toks) + 3))
        distractors = rng.sample(pool, min(n, len(pool)))
        avail = toks + distractors
        rng.shuffle(avail)
        available.append(avail)

    items_out = []
    for i, it in enumerate(items):
        entry = {
            "id": f"{meta['id']}-{i+1:02d}",
            "prompt": it["prompt"],
            "answerTokens": tokenized[i],
            "availableTokens": available[i],
            "metadata": {
                "difficulty": it["difficulty"],
                "tags": it["tags"],
                "chapter": it["chapter"],
            },
        }
        if structures[i] is not None:
            entry["structure"] = structures[i]
        items_out.append(entry)

    return {
        "metadata": meta,
        "items": items_out,
    }


def main():
    os.makedirs(JS_OUT.rsplit("/", 1)[0], exist_ok=True)
    packs = []
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith(".txt"):
            continue
        path = os.path.join(SRC_DIR, fn)
        meta, items = parse_pack(path)
        pack = build_pack(meta, items)
        out = os.path.join(OUT_DIR, meta["id"] + ".json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(pack, f, ensure_ascii=False, indent=2)
        packs.append(pack)
        print(f"{meta['id']}: {len(items)} items -> {os.path.relpath(out, ROOT)}")

    with open(JS_OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by packs/build_packs.py — do not edit. */\n")
        f.write("window.FT_SAMPLE_PACKS = ")
        json.dump(packs, f, ensure_ascii=False)
        f.write(";\n")
    print(f"bundled {len(packs)} packs -> {os.path.relpath(JS_OUT, ROOT)}")


if __name__ == "__main__":
    main()
